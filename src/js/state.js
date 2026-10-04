/**
 * Application state, persistence, and play-order construction.
 *
 * `tracks` is the flat pool of everything loaded, in the order the playlists
 * were read. `order` is an array of indices into it - the actual play order.
 * Shuffling rewrites `order` and never touches `tracks`, so switching back to
 * "original order" is free and lossless.
 */

import { LS_STATE, SOURCE_COLORS } from './config.js';
import * as storage from './storage.js';
import { fisherYates } from './shuffle.js';

/**
 * @typedef {object} Source
 * @property {string} uid       stable id, survives reordering and reloads
 * @property {string} raw       exactly what the user typed
 * @property {string|null} plId parsed playlist id
 * @property {string} name      display label once loaded
 * @property {string} [title]   the playlist's own name, '' until looked up
 * @property {''|'ok'|'err'|'warn'} status  'warn' is loaded but incomplete
 * @property {string} [error] the message shown under the row. Named for the
 *   'err' case it was added for, but 'warn' reuses it so that every existing
 *   `delete source.error` reset keeps clearing the row on its own.
 * @property {boolean} enabled
 * @property {string} color
 *
 * @typedef {object} Track
 * @property {string} vid
 * @property {string} title   '' until resolved; the UI falls back to vid
 * @property {string} author
 * @property {string} srcUid  which Source it came from
 * @property {string} srcName
 * @property {string} color
 * @property {boolean} bad    failed to play; skipped by next()/prev()
 */

export const state = {
  /** @type {Source[]} */
  sources: [],
  /** @type {Track[]} */
  tracks: [],
  /** @type {number[]} indices into tracks */
  order: [],
  /** index into order, or -1 */
  pos: -1,

  shuffled: true,
  /** whether the queue shows thumbnails */
  thumbs: true,
  /** whether the sidebar playlists section is expanded */
  playlistsOpen: true,
  /** @type {'off'|'all'|'one'} */
  repeat: 'all',

  volume: 100,
  muted: false,
  audioOnly: false,
  apiKey: ''
};

let uidCounter = 1;

/**
 * @param {string} [raw]
 * @returns {Source}
 */
export function newSource(raw = '') {
  return {
    uid: `s${uidCounter++}_${Date.now().toString(36)}`,
    raw,
    plId: null,
    name: '',
    title: '',
    status: '',
    enabled: true,
    color: SOURCE_COLORS[state.sources.length % SOURCE_COLORS.length]
  };
}

/* ------------------------------------------------------------ persistence */

let saveTimer = null;

/** Debounced; called from lots of hot paths (volume drags, seeks). */
export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 300);
}

export function saveNow() {
  clearTimeout(saveTimer);
  storage.write(LS_STATE, {
    sources: state.sources.map((s) => ({
      uid: s.uid, raw: s.raw, plId: s.plId, name: s.name, title: s.title || '',
      enabled: s.enabled, color: s.color
    })),
    tracks: state.tracks,
    order: state.order,
    pos: state.pos,
    shuffled: state.shuffled,
    thumbs: state.thumbs,
    playlistsOpen: state.playlistsOpen,
    repeat: state.repeat,
    volume: state.volume,
    muted: state.muted,
    audioOnly: state.audioOnly,
    apiKey: state.apiKey
  });
}

/**
 * Restore the previous session.
 * @returns {boolean} whether anything was restored
 */
export function restore() {
  const saved = storage.read(LS_STATE, null);
  if (!saved) return false;

  Object.assign(state, {
    sources: Array.isArray(saved.sources) ? saved.sources : [],
    tracks: Array.isArray(saved.tracks) ? saved.tracks : [],
    order: Array.isArray(saved.order) ? saved.order : [],
    pos: Number.isInteger(saved.pos) ? saved.pos : -1,
    shuffled: saved.shuffled !== false,
    thumbs: saved.thumbs !== false,
    playlistsOpen: saved.playlistsOpen !== false,
    repeat: saved.repeat || 'all',
    volume: typeof saved.volume === 'number' ? saved.volume : 100,
    muted: Boolean(saved.muted),
    audioOnly: Boolean(saved.audioOnly),
    apiKey: saved.apiKey || ''
  });

  // Storage can be edited or half-written; never trust indices from it.
  state.order = state.order.filter(
    (i) => Number.isInteger(i) && i >= 0 && i < state.tracks.length
  );
  if (state.pos >= state.order.length) state.pos = state.order.length ? 0 : -1;

  // Colour is cosmetic and belongs to the palette, not to the saved session.
  // Re-derive it on every restore rather than trusting what was written: both
  // sources and tracks persist a colour, so editing SOURCE_COLORS would
  // otherwise leave every existing session showing the retired palette.
  const colorByUid = new Map();
  state.sources.forEach((source, i) => {
    source.color = SOURCE_COLORS[i % SOURCE_COLORS.length];
    colorByUid.set(source.uid, source.color);
  });
  for (const track of state.tracks) {
    const color = colorByUid.get(track.srcUid);
    if (color) track.color = color;
  }

  // Keep generated uids from colliding with restored ones.
  uidCounter = state.sources.length + 1;

  return true;
}

export function reset() {
  storage.remove(LS_STATE);
}

/* -------------------------------------------------------------- ordering */

export function currentTrackIndex() {
  return state.pos >= 0 && state.pos < state.order.length ? state.order[state.pos] : -1;
}

/** @returns {Track|null} */
export function currentTrack() {
  const i = currentTrackIndex();
  return i >= 0 ? state.tracks[i] : null;
}

/**
 * Rebuild `order` from `tracks` according to the shuffle settings.
 *
 * @param {{keepCurrent?: boolean}} [options]
 *   keepCurrent follows whatever is playing to wherever it lands in the new
 *   order, so the audio is never interrupted. It moves `pos`, not the track:
 *   the playing track is shuffled with everything else and gets a slot as
 *   random as any other. The Shuffle toggle deliberately omits it - that one
 *   restarts the queue from the top.
 */
export function buildOrder({ keepCurrent = false } = {}) {
  const keep = keepCurrent ? currentTrackIndex() : -1;
  const all = state.tracks.map((_, i) => i);

  const order = state.shuffled ? fisherYates(all) : all;

  if (keep >= 0) {
    const at = order.indexOf(keep);
    state.pos = at >= 0 ? at : (order.length ? 0 : -1);
  }

  state.order = order;
}
