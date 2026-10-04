/**
 * Tunable constants. Nothing here touches the DOM, so this module is safe to
 * import from tests.
 */

export const LS_STATE  = 'bpp.state.v1';
export const LS_TITLES = 'bpp.titles.v1';

/**
 * One colour per playlist, cycled. Shown as a dot beside every track.
 */
export const SOURCE_COLORS = [
  '#ff4d5a', '#5b8cff', '#3ecf8e', '#ffc14d',
  '#c07bff', '#4dd8e6', '#ff8a4d', '#8ad14d'
];

/* --- playlist extraction ------------------------------------------------ */

/** How long to wait for a hidden embed to surrender its playlist. */
export const EMBED_TIMEOUT_MS = 20000;
/** How often to ask the hidden embed whether it has the list yet. */
export const EMBED_POLL_MS = 250;
/**
 * What the embed will hand over before it stops, give or take. Not a limit we
 * impose - there is no way to raise it without a key - only the count that
 * means the list came back clipped rather than complete.
 */
export const EMBED_MAX_ITEMS = 200;

/** Data API page size; 50 is the maximum the endpoint allows. */
export const API_PAGE_SIZE = 50;
/**
 * Safety valve so a pathological playlist cannot loop forever. Sized well past
 * the 5000-item ceiling on a user playlist, because a channel uploads list
 * (UU...) has no such ceiling. Paging stops on the first page without a
 * nextPageToken, so this only ever bites a genuinely enormous list.
 */
export const API_MAX_PAGES = 200;
/** Deadline for one page request; fetch has no timeout of its own. */
export const API_TIMEOUT_MS = 60000;

/* --- title backfill ----------------------------------------------------- */

/** Parallel oEmbed requests. Kept low to stay polite. */
export const OEMBED_WORKERS = 4;
/** Consecutive failures before we assume the endpoint is blocked and stop. */
export const OEMBED_MAX_FAILS = 4;

/* --- playback ----------------------------------------------------------- */

/** Progress-bar refresh interval while playing. */
export const TICK_MS = 300;
/** Seconds moved by the arrow-key seek. */
export const SEEK_STEP_SEC = 5;
/** Past this point, "previous" restarts the track instead of going back one. */
export const PREV_RESTART_SEC = 3;
