/**
 * Minimal pub/sub.
 *
 * Exists to keep the dependency graph acyclic: playback and loading emit,
 * the UI modules subscribe. Nothing in src/js/ imports src/js/ui/.
 */

/** @type {Map<string, Set<Function>>} */
const listeners = new Map();

/** Event names, so typos fail loudly instead of silently never firing. */
export const EV = {
  /** The current track changed. Payload: the track object, or null. */
  TRACK: 'track',
  /** Play/pause changed. Payload: boolean isPlaying. */
  PLAYSTATE: 'playstate',
  /** Playback position moved. Payload: { current, duration }. */
  PROGRESS: 'progress',
  /** The queue contents or ordering changed. No payload. */
  ORDER: 'order',
  /**
   * A single title was resolved. Payload: { vid, title }.
   * Separate from ORDER so backfilling hundreds of titles patches the rows in
   * place instead of re-rendering the whole queue hundreds of times.
   */
  TITLE: 'title',
  /** A source's status/name/count changed. No payload. */
  SOURCES: 'sources',
  /** Loading started or finished. Payload: { busy, message }. */
  LOADING: 'loading'
};

/**
 * @param {string} name
 * @param {Function} fn
 * @returns {() => void} unsubscribe
 */
export function on(name, fn) {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name).add(fn);
  return () => listeners.get(name)?.delete(fn);
}

/**
 * @param {string} name
 * @param {*} [payload]
 */
export function emit(name, payload) {
  const set = listeners.get(name);
  if (!set) return;
  // Copy first: a handler may unsubscribe itself mid-dispatch.
  for (const fn of [...set]) {
    try {
      fn(payload);
    } catch (err) {
      console.error(`[events] handler for "${name}" threw`, err);
    }
  }
}
