/**
 * The queue panel on the right.
 *
 * The list is virtualised: only the rows you can see exist in the DOM, with a
 * spacer above and below sized so the scrollbar still describes the whole
 * queue. A few thousand tracks rendered in full is ~10,000 elements, and at
 * that size the browser stalls on things that have nothing to do with us -
 * right-clicking, hovering, opening a menu - because every one of them walks
 * the tree. The windowing maths lives in ./queue-window.js so it can be tested
 * without a DOM.
 *
 * The trade: the browser's own find-in-page only sees what is on screen. The
 * filter box above the list is the replacement, and it searches the model.
 */

import { state } from '../state.js';
import { on, EV } from '../events.js';
import { $, esc } from '../utils.js';
import * as playback from '../playback.js';
import { buildView, windowRange, nearestScrollTop } from './queue-window.js';

/** Rows to render before the panel has been laid out and can be measured. */
const BOOTSTRAP_ROWS = 40;

/** Long enough to swallow a fast typist and a held backspace. */
const FILTER_DEBOUNCE_MS = 120;

const EMPTY_QUEUE =
  '<div class="empty">Queue is empty.<br>' +
  'Paste a playlist ID above and press <b>Load</b>.</div>';

const EMPTY_FILTER = '<div class="empty">Nothing in the queue matches that filter.</div>';

/** @type {number[]} queue positions surviving the filter, in queue order */
let view = [];
/** @type {Map<number, number>} queue position -> its index in `view` */
let viewIndex = new Map();
/** The filter text `view` was built from, trimmed and lowercased. */
let filterText = '';

/** Row height and scroller padding, in CSS pixels, read back out of the CSS. */
let metrics = { rowH: 0, padTop: 0, thumbs: null };

/** The slice currently in the DOM, so an unchanged window repaints nothing. */
let painted = { start: -1, end: -1 };

let frame = 0;
let forceNext = false;
let filterTimer = null;

/** A position waiting to be scrolled to once the panel has a height. */
let pendingReveal = -1;

export function init() {
  const list = $('qList');

  $('qFilter').addEventListener('input', onFilterInput);
  list.addEventListener('click', onClick);
  list.addEventListener('scroll', () => schedulePaint(), { passive: true });

  observeResize(list);

  on(EV.ORDER, render);
  on(EV.TRACK, syncCurrentRow);
  // Backfilling titles fires one of these per track. Repainting from the model
  // once a frame is cheaper than finding and patching each row as it lands.
  on(EV.TITLE, () => schedulePaint(true));

  render();
}

function onClick(event) {
  const row = event.target.closest('.q-item');
  if (!row) return;

  // Explicitly choosing a track clears any earlier failure - the video may
  // simply have been unavailable at the time.
  const pos = Number(row.dataset.pos);
  const track = state.tracks[state.order[pos]];
  if (track) track.bad = false;
  playback.playAt(pos);
}

function onFilterInput() {
  clearTimeout(filterTimer);
  // A timer rather than a frame: every keystroke gets its own frame anyway, so
  // rAF would coalesce nothing.
  filterTimer = setTimeout(render, FILTER_DEBOUNCE_MS);
}

/* ------------------------------------------------------------------ shell */

/**
 * Build the scaffolding once. The scroller keeps its identity across renders,
 * so its scroll position and the delegated click listener both survive.
 */
function ensureShell(list) {
  if (list.querySelector('.q-win')) return;
  list.innerHTML =
    '<div class="q-pad" data-pad="top"></div>' +
    '<div class="q-win"></div>' +
    '<div class="q-pad" data-pad="bot"></div>';
}

/** @param {boolean} thumbs */
function probeInner(thumbs) {
  return (
    '<span class="dot sm"></span>' +
    '<span class="q-num">0</span>' +
    // No src: .q-thumb is a fixed 52x30, so an unloaded image measures right.
    (thumbs ? '<img class="q-thumb" alt="">' : '') +
    '<div class="q-body"><div class="q-title">M</div><div class="q-src">M</div></div>'
  );
}

/**
 * Refresh `metrics` if they are stale. CSS owns the row height; this only reads
 * it back, so restyling a row needs no change here.
 *
 * @returns {boolean} false when the panel has no layout yet and rowH is unusable
 */
function measure(list) {
  if (metrics.rowH > 0 && metrics.thumbs === state.thumbs) return true;

  metrics.padTop = parseFloat(getComputedStyle(list).paddingTop) || 0;

  // Always a purpose-built probe, never a row already on screen: the one moment
  // this runs is the moment the rows are wrong. The thumbs toggle flips
  // state.thumbs and re-measures while the DOM still holds the old markup, so a
  // live row would report the height of the mode we just left.
  const probe = document.createElement('div');
  probe.className = 'q-item q-probe';
  probe.innerHTML = probeInner(state.thumbs);
  list.appendChild(probe);

  // getBoundingClientRect, not offsetHeight: rounding a 40.4px row would drift
  // hundreds of pixels over a long queue and the scrollbar would lie.
  const height = probe.getBoundingClientRect().height;
  probe.remove();

  if (!(height > 0)) {
    metrics.rowH = 0;
    return false;
  }
  metrics.rowH = height;
  metrics.thumbs = state.thumbs;
  return true;
}

function observeResize(list) {
  const invalidate = () => {
    // Zoom and a late font swap both change the row height.
    metrics.rowH = 0;
    schedulePaint(true);
    if (pendingReveal >= 0) {
      const pos = pendingReveal;
      requestAnimationFrame(() => revealPos(pos));
    }
  };

  if (typeof ResizeObserver === 'function') {
    // Measuring inside the rAF rather than here avoids the "ResizeObserver loop
    // completed with undelivered notifications" warning.
    new ResizeObserver(invalidate).observe(list);
  } else {
    window.addEventListener('resize', invalidate);
  }
}

/* ----------------------------------------------------------------- paint */

/**
 * One row, byte for byte what the unvirtualised list produced. Titles are
 * attacker-ish input - anyone can name a video anything - so everything
 * user-derived goes through esc().
 *
 * @param {number} pos position in the queue, which is also what .q-num shows
 * @param {import('../state.js').Track} track
 * @param {boolean} thumbs
 */
function rowHtml(pos, track, thumbs) {
  const classes = ['q-item'];
  if (pos === state.pos) classes.push('current');
  if (track.bad) classes.push('bad');

  return (
    `<div class="${classes.join(' ')}" data-pos="${pos}" data-vid="${esc(track.vid)}">` +
      `<span class="dot sm" style="background:${esc(track.color)}"></span>` +
      `<span class="q-num">${pos + 1}</span>` +
      (thumbs
        ? `<img class="q-thumb" loading="lazy" alt=""` +
               ` src="https://i.ytimg.com/vi/${esc(track.vid)}/default.jpg">`
        : '') +
      '<div class="q-body">' +
        `<div class="q-title">${esc(track.title || track.vid)}</div>` +
        '<div class="q-src">' +
          esc(track.author || track.srcName) +
        '</div>' +
      '</div>' +
    '</div>'
  );
}

/**
 * Coalesce repaints into the next frame.
 * @param {boolean} [force] repaint even if the window did not move, because the
 *   rows themselves changed - a new title, a new current track
 */
function schedulePaint(force = false) {
  forceNext = forceNext || force;
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    const wanted = forceNext;
    forceNext = false;
    paint(wanted);
  });
}

function showEmpty(list, win, html) {
  list.querySelector('[data-pad="top"]').style.height = '0px';
  list.querySelector('[data-pad="bot"]').style.height = '0px';
  win.innerHTML = html;
  painted = { start: -1, end: -1 };
}

/** @param {boolean} [force] */
function paint(force = false) {
  const list = $('qList');
  const win = list.querySelector('.q-win');
  if (!win) return;

  if (!state.order.length) return showEmpty(list, win, EMPTY_QUEUE);
  if (!view.length) return showEmpty(list, win, EMPTY_FILTER);

  // A panel with no height is as unusable here as one with no row height: a
  // window computed from a zero viewport is empty, and with nothing rendered
  // there is nothing to scroll to bring rows back. Both take the provisional
  // path - the first screenful in flow, spacers flat - and the ResizeObserver
  // repaints properly the moment the panel gets a box.
  const laidOut = measure(list) && list.clientHeight > 0;
  const { rowH, padTop } = metrics;

  const { start, end } = laidOut
    ? windowRange({
        scrollTop: list.scrollTop,
        viewportH: list.clientHeight,
        rowH,
        padTop,
        count: view.length
      })
    : { start: 0, end: Math.min(view.length, BOOTSTRAP_ROWS) };

  // The hot path: most scroll frames land inside the overscan and stop here.
  if (!force && start === painted.start && end === painted.end) return;

  const thumbs = state.thumbs;
  let html = '';
  for (let i = start; i < end; i++) {
    const pos = view[i];
    html += rowHtml(pos, state.tracks[state.order[pos]], thumbs);
  }

  list.querySelector('[data-pad="top"]').style.height =
    laidOut ? `${start * rowH}px` : '0px';
  win.innerHTML = html;
  list.querySelector('[data-pad="bot"]').style.height =
    laidOut ? `${(view.length - end) * rowH}px` : '0px';

  painted = { start, end };
}

/* --------------------------------------------------------------- scrolling */

/** The view index sitting at the top of the viewport, for re-anchoring. */
function anchorIndex(list) {
  if (!(metrics.rowH > 0)) return 0;
  return Math.max(0, Math.floor((list.scrollTop - metrics.padTop) / metrics.rowH));
}

/**
 * Bring a queue position into view, if it is in the view at all. Scrolls only
 * when the row is off screen, and only to the nearer edge.
 */
function revealPos(pos) {
  const list = $('qList');
  const index = viewIndex.get(pos);

  // Filtered out: nothing to scroll to, and nothing to remember.
  if (index === undefined) {
    pendingReveal = -1;
    return;
  }

  if (!measure(list) || !list.clientHeight) {
    // The panel is not laid out yet - at boot, or while it is hidden. Hold the
    // request; the ResizeObserver replays it.
    pendingReveal = pos;
    return;
  }
  pendingReveal = -1;

  const next = nearestScrollTop({
    index,
    rowH: metrics.rowH,
    padTop: metrics.padTop,
    scrollTop: list.scrollTop,
    viewportH: list.clientHeight
  });
  if (next !== list.scrollTop) list.scrollTop = next;
}

/* ------------------------------------------------------------------ render */

function rebuildView() {
  view = buildView(state.order, state.tracks, filterText);
  viewIndex = new Map();
  for (let i = 0; i < view.length; i++) viewIndex.set(view[i], i);
}

/**
 * Rebuild the view and repaint. Called on structural changes and on the
 * thumbnails toggle, which changes both what a row contains and how tall it is.
 */
export function render() {
  clearTimeout(filterTimer);

  const list = $('qList');
  ensureShell(list);
  renderCount();

  const next = $('qFilter').value.trim().toLowerCase();
  const filterChanged = next !== filterText;
  filterText = next;

  // Unlike the old full-list render, the spacers keep the scroller's height up,
  // so scrollTop no longer collapses to 0 on its own. Re-anchor deliberately:
  // otherwise the thumbs toggle jumps (rows change height) and a reshuffle
  // leaves you parked at a meaningless offset.
  const anchor = anchorIndex(list);
  rebuildView();

  if (filterChanged) {
    list.scrollTop = 0;
  } else if (measure(list) && anchor > 0) {
    list.scrollTop = metrics.padTop + Math.min(anchor, view.length) * metrics.rowH;
  }

  paint(true);
  if (pendingReveal >= 0) revealPos(pendingReveal);
}

/** The "3 / 120" readout in the queue header. Reads 0 when nothing is playing. */
function renderCount() {
  $('qCount').textContent = `${state.pos + 1} / ${state.order.length}`;
}

/**
 * Follow the current track without rebuilding the view (which would lose the
 * filter's scroll position). The .current and .bad classes come off the model
 * during the repaint, so there is nothing to toggle by hand.
 */
function syncCurrentRow() {
  renderCount();
  revealPos(state.pos);
  paint(true);
}

export function scrollToCurrent() {
  revealPos(state.pos);
  paint(true);
}
