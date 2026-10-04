import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OVERSCAN, matchesFilter, buildView, windowRange, nearestScrollTop
} from '../src/js/ui/queue-window.js';

/** @returns {{vid: string, title: string, author: string, srcName: string}} */
const track = (over = {}) => ({
  vid: 'v0', title: 'Title', author: 'Author', srcName: 'Source', ...over
});

/* ----------------------------------------------------------- matchesFilter */

test('an empty filter matches everything', () => {
  assert.equal(matchesFilter(track(), ''), true);
  assert.equal(matchesFilter(track({ title: '', author: '', srcName: '' }), ''), true);
});

test('matchesFilter searches title, author and source name', () => {
  const t = track({ title: 'Bohemian Rhapsody', author: 'Queen', srcName: 'Rock Mix' });
  assert.equal(matchesFilter(t, 'rhapsody'), true);
  assert.equal(matchesFilter(t, 'queen'), true);
  assert.equal(matchesFilter(t, 'rock mix'), true);
  assert.equal(matchesFilter(t, 'nothing here'), false);
});

test('matchesFilter is case-insensitive on the track side', () => {
  // The caller lowercases the filter; the track fields are whatever YouTube sent.
  assert.equal(matchesFilter(track({ title: 'LOUD SHOUTING' }), 'shouting'), true);
});

test('an untitled track is matched by its video id', () => {
  // The row displays the id when there is no title, so the filter has to see it.
  const t = track({ title: '', vid: 'dQw4w9WgXcQ' });
  assert.equal(matchesFilter(t, 'dqw4w9'), true);
});

/* --------------------------------------------------------------- buildView */

test('buildView with no filter is every position in order', () => {
  const tracks = [track(), track(), track()];
  const order = [2, 0, 1];
  assert.deepEqual(buildView(order, tracks, ''), [0, 1, 2]);
});

test('buildView skips positions with no track behind them', () => {
  const tracks = [track(), track()];
  const order = [0, 99, 1];  // 99 is out of range, as a half-written save can be
  assert.deepEqual(buildView(order, tracks, ''), [0, 2]);
});

test('buildView returns queue positions, not visual indices', () => {
  // The invariant the whole click path rests on: playAt() takes a position, and
  // .q-num shows position + 1. Filtering must not renumber anything.
  const tracks = [
    track({ title: 'alpha' }), track({ title: 'beta' }),
    track({ title: 'alpha again' }), track({ title: 'gamma' })
  ];
  const order = [0, 1, 2, 3];

  const view = buildView(order, tracks, 'alpha');

  assert.deepEqual(view, [0, 2]);
  // The second visible row is queue position 2, not position 1.
  assert.equal(view[1], 2);
});

test('buildView survives a reordered queue', () => {
  const tracks = [track({ title: 'keep' }), track({ title: 'drop' }), track({ title: 'keep too' })];
  const order = [1, 2, 0];  // shuffled

  const view = buildView(order, tracks, 'keep');

  // Positions 1 and 2 of the shuffled order hold the two "keep" tracks.
  assert.deepEqual(view, [1, 2]);
});

test('buildView returns nothing when the filter matches nothing', () => {
  assert.deepEqual(buildView([0, 1], [track(), track()], 'zzzz'), []);
});

test('buildView handles an empty queue', () => {
  assert.deepEqual(buildView([], [], ''), []);
});

/* ------------------------------------------------------------- windowRange */

const RANGE = { rowH: 40, padTop: 6, viewportH: 400, count: 1000 };

test('windowRange at the top clamps to zero rather than going negative', () => {
  const { start, end } = windowRange({ ...RANGE, scrollTop: 0 });
  assert.equal(start, 0);
  assert.ok(end > 0);
});

test('windowRange at the bottom does not overshoot the count', () => {
  const { start, end } = windowRange({
    ...RANGE, scrollTop: RANGE.count * RANGE.rowH + RANGE.padTop
  });
  assert.equal(end, RANGE.count);
  assert.ok(start < end);
});

test('windowRange includes the partial rows at both edges', () => {
  // Scrolled half a row down: row 10 is cut by the top edge and must be kept.
  const scrollTop = RANGE.padTop + 10 * RANGE.rowH + 20;
  const { start, end } = windowRange({ ...RANGE, scrollTop, overscan: 0 });

  assert.equal(start, 10, 'the half-visible top row is included');
  // 20px of row 10 plus 400px of viewport reaches into row 20.
  assert.equal(end, 21, 'the half-visible bottom row is included');
});

test('windowRange offsets by the scroller padding', () => {
  const bare = windowRange({ ...RANGE, padTop: 0, scrollTop: 400, overscan: 0 });
  const padded = windowRange({ ...RANGE, padTop: RANGE.rowH, scrollTop: 400, overscan: 0 });

  // A padTop of exactly one row shifts the band down by one row.
  assert.equal(bare.start - padded.start, 1);
});

test('windowRange applies the overscan on both sides', () => {
  const scrollTop = RANGE.padTop + 100 * RANGE.rowH;
  const tight = windowRange({ ...RANGE, scrollTop, overscan: 0 });
  const loose = windowRange({ ...RANGE, scrollTop, overscan: 5 });

  assert.equal(tight.start - loose.start, 5);
  assert.equal(loose.end - tight.end, 5);
});

test('windowRange returns an empty window for degenerate input', () => {
  const empty = { start: 0, end: 0 };
  assert.deepEqual(windowRange({ ...RANGE, rowH: 0, scrollTop: 0 }), empty);
  assert.deepEqual(windowRange({ ...RANGE, count: 0, scrollTop: 0 }), empty);
  assert.deepEqual(windowRange({ ...RANGE, viewportH: 0, scrollTop: 0 }), empty);
});

test('windowRange stays sane across the whole scroll range', () => {
  const maxScroll = RANGE.count * RANGE.rowH + RANGE.padTop;
  const cap = Math.ceil(RANGE.viewportH / RANGE.rowH) + 2 * OVERSCAN + 1;

  for (let scrollTop = -200; scrollTop <= maxScroll + 200; scrollTop += 37) {
    const { start, end } = windowRange({ ...RANGE, scrollTop });
    assert.ok(start >= 0, `start ${start} went negative`);
    assert.ok(end <= RANGE.count, `end ${end} overshot the count`);
    assert.ok(start <= end, `start ${start} passed end ${end}`);
    assert.ok(end - start <= cap, `window of ${end - start} exceeded ${cap}`);
  }
});

test('windowRange copes with a fractional row height', () => {
  // Row heights come from getBoundingClientRect and are rarely whole pixels.
  const { start, end } = windowRange({
    rowH: 40.4, padTop: 6, viewportH: 400, count: 1400, scrollTop: 20000, overscan: 0
  });
  assert.ok(Number.isInteger(start) && Number.isInteger(end));
  assert.equal(start, Math.floor((20000 - 6) / 40.4));
});

/* --------------------------------------------------------- nearestScrollTop */

const NEAR = { rowH: 40, padTop: 6, viewportH: 400 };

test('nearestScrollTop leaves a fully visible row alone', () => {
  // The "do not scroll" case: this is what block:'nearest' bought us for free.
  const scrollTop = 0;
  assert.equal(nearestScrollTop({ ...NEAR, index: 5, scrollTop }), scrollTop);
});

test('nearestScrollTop scrolls up to a row above the viewport', () => {
  const out = nearestScrollTop({ ...NEAR, index: 3, scrollTop: 1000 });
  assert.equal(out, NEAR.padTop + 3 * NEAR.rowH);
});

test('nearestScrollTop scrolls down only far enough to show the row', () => {
  const out = nearestScrollTop({ ...NEAR, index: 20, scrollTop: 0 });
  // Row 20 ends at 6 + 21*40 = 846; showing it means scrolling to 846 - 400.
  assert.equal(out, 846 - NEAR.viewportH);
});

test('nearestScrollTop shows the top of a row taller than the viewport', () => {
  const out = nearestScrollTop({ index: 2, rowH: 900, padTop: 6, scrollTop: 0, viewportH: 400 });
  assert.equal(out, 6 + 2 * 900, 'the top of the row wins over its bottom');
});

test('nearestScrollTop never returns a negative offset', () => {
  const out = nearestScrollTop({ ...NEAR, index: 0, scrollTop: 5, viewportH: 4000 });
  assert.ok(out >= 0);
});

test('nearestScrollTop accounts for the padding in both directions', () => {
  const bare = nearestScrollTop({ ...NEAR, padTop: 0, index: 30, scrollTop: 0 });
  const padded = nearestScrollTop({ ...NEAR, padTop: 10, index: 30, scrollTop: 0 });
  assert.equal(padded - bare, 10);
});
