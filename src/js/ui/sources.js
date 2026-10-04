/** The playlist rows in the right sidebar. */

import { state, newSource, save } from '../state.js';
import { on, emit, EV } from '../events.js';
import { $, esc } from '../utils.js';

const ICON_X =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
  '<path d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7l1.4-1.4' +
  ' 6.3 6.3 6.3-6.3z"/></svg>';

let onSubmit = () => {};

/**
 * @param {() => void} submitHandler invoked when a row is submitted with Enter
 */
export function init(submitHandler) {
  onSubmit = submitHandler;

  $('btnAdd').addEventListener('click', () => {
    state.sources.push(newSource());
    render();
    save();
    const inputs = $('sources').querySelectorAll('input');
    inputs[inputs.length - 1]?.focus();
  });

  on(EV.SOURCES, render);
  render();
}

/**
 * A failure, or a load that came back short, gets a line under the input.
 * Progress belongs next to Load. Anything else leaves the row closed up.
 *
 * Returned as plain text rather than markup so the same string can go in the
 * title attribute: the line is a single clipped row, and without a tooltip the
 * end of a long message is unreadable.
 *
 * @returns {string} '' when there is nothing to say
 */
function statusText(source) {
  if (source.status === 'warn') {
    // No playlist label: the message already leads with its reason, and the ID
    // it refers to is in the input directly above.
    return source.error || 'Loading stopped early.';
  }
  if (source.status !== 'err') return '';
  // A failure can come from anywhere - a bad paste, an HTTP status, the embed -
  // so it stays labelled with whatever names the row.
  return `${source.name || source.raw}: ${source.error || 'could not load'}`;
}

/**
 * The marker beside the section heading. The per-row lines live inside the
 * body, which the user can collapse and leave collapsed across sessions - so
 * on a short load this is the only part of the report still on screen once the
 * toast expires, and the only thing saying the section is worth opening.
 */
function renderWarnDot() {
  const dot = $('plWarnDot');
  if (!dot) return;
  dot.classList.toggle('hidden', !state.sources.some((s) => s.status === 'warn'));
}

export function render() {
  const host = $('sources');
  host.replaceChildren();
  renderWarnDot();

  state.sources.forEach((source, index) => {
    const row = document.createElement('div');
    row.className = 'src';
    // The name goes on its own line rather than in place of the ID: the input
    // is what gets edited, and a name is only known once a load has run.
    row.innerHTML = `
      <div class="src-line">
        <span class="dot sm" style="background:${esc(source.color)}"></span>
        <div class="grow">
          <input type="text" spellcheck="false"
                 placeholder="Playlist ID, or any YouTube URL with list=..."
                 aria-label="Playlist ${index + 1}"
                 value="${esc(source.raw)}">
        </div>
        <button class="toggle ${source.enabled ? 'on' : ''}" type="button"
                role="switch" aria-checked="${source.enabled}"
                title="Include this playlist in the queue"></button>
        <button class="icon-btn" type="button" title="Remove this playlist"
                aria-label="Remove playlist ${index + 1}">${ICON_X}</button>
      </div>
      <div class="src-name" title="${esc(source.title || '')}">${esc(source.title || '')}</div>
      <div class="src-meta ${source.status}"
           title="${esc(statusText(source))}">${esc(statusText(source))}</div>`;

    const [input] = row.getElementsByTagName('input');
    const toggle = row.querySelector('.toggle');
    const remove = row.querySelector('.icon-btn');

    input.addEventListener('input', () => {
      source.raw = input.value;
      // The old result no longer describes what is typed here.
      source.status = '';
      source.name = '';
      source.title = '';
      delete source.error;
      const name = row.querySelector('.src-name');
      name.textContent = '';
      name.removeAttribute('title');
      const meta = row.querySelector('.src-meta');
      meta.className = 'src-meta';
      meta.textContent = '';
      meta.removeAttribute('title');
      renderWarnDot();
      save();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') onSubmit();
    });

    toggle.addEventListener('click', () => {
      source.enabled = !source.enabled;
      toggle.classList.toggle('on', source.enabled);
      toggle.setAttribute('aria-checked', String(source.enabled));
      save();
    });

    remove.addEventListener('click', () => {
      state.sources.splice(index, 1);
      // Always leave one empty row, so there is somewhere to paste.
      if (!state.sources.length) state.sources.push(newSource());
      save();
      emit(EV.SOURCES);
    });

    host.appendChild(row);
  });
}
