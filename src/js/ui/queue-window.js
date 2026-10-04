/**
 * The arithmetic behind the virtualised queue.
 *
 * A queue of a few thousand tracks is far more DOM than a browser wants to
 * carry: every row is seven elements plus a thumbnail, and at that size even
 * right-clicking pauses while the engine walks the tree. So ui/queue.js keeps
 * only the rows you can actually see, and pads the scroller top and bottom to
 * the height the full list would have had.
 *
 * Nothing here touches the DOM, so this module is safe to import from tests -
 * which is the point, since off-by-one errors in windowing show up as blank
 * gaps rather than exceptions.
 */

/**
 * Rows rendered above and below the viewport. Big enough that a flick of the
 * wheel lands inside the window and repaints nothing; small enough that the
 * window stays cheap.
 */
export const OVERSCAN = 8;

/**
 * @param {{title: string, vid: string, author: string, srcName: string}} track
 * @param {string} filter already trimmed and lowercased; '' matches everything
 */
export function matchesFilter(track, filter) {
  if (!filter) return true;
  // Untitled tracks show their id, so that is what the filter has to match.
  const label = track.title || track.vid;
  return `${label} ${track.author} ${track.srcName}`.toLowerCase().includes(filter);
}

/**
 * The queue positions that survive the filter, in queue order.
 *
 * These are positions - indices into `order` - and never visual indices. A
 * filtered list still shows each row's real queue number, and `data-pos` stays
 * the argument playAt() expects, so clicking the third visible row plays the
 * track it is numbered as rather than the third track in the queue.
 *
 * @param {number[]} order
 * @param {Array<{title: string, vid: string, author: string, srcName: string}>} tracks
 * @param {string} filter already trimmed and lowercased
 * @returns {number[]}
 */
export function buildView(order, tracks, filter) {
  const view = [];
  for (let pos = 0; pos < order.length; pos++) {
    const track = tracks[order[pos]];
    // Storage can be edited or half-written; a position with no track behind it
    // is skipped rather than rendered as a hole.
    if (track && matchesFilter(track, filter)) view.push(pos);
  }
  return view;
}

/**
 * Which slice of the view to render, given where the scroller sits.
 *
 * `padTop` is the scroller's own top padding: the first row starts that far
 * down, so it has to come off scrollTop before dividing by the row height.
 *
 * @param {object} options
 * @param {number} options.scrollTop
 * @param {number} options.viewportH the scroller's clientHeight
 * @param {number} options.rowH
 * @param {number} options.padTop
 * @param {number} options.count how many rows the view holds
 * @param {number} [options.overscan]
 * @returns {{start: number, end: number}} end is exclusive
 */
export function windowRange({
  scrollTop, viewportH, rowH, padTop = 0, count, overscan = OVERSCAN
}) {
  // Before first layout there is no row height to divide by. An empty window is
  // the honest answer; the caller falls back to a provisional slice.
  if (!(rowH > 0) || !(count > 0) || !(viewportH > 0)) return { start: 0, end: 0 };

  const top = Math.max(0, scrollTop - padTop);
  // floor/ceil rather than round: a row half off the top edge is still visible.
  const first = Math.floor(top / rowH);
  const last = Math.ceil((top + viewportH) / rowH);

  const start = Math.max(0, Math.min(count, first - overscan));
  const end = Math.max(start, Math.min(count, last + overscan));
  return { start, end };
}

/**
 * `scrollIntoView({block: 'nearest'})` as arithmetic: scroll only when the row
 * is out of view, and only far enough to bring it flush with the nearer edge.
 *
 * Doing it by hand rather than calling scrollIntoView keeps this off the DOM -
 * and scrollIntoView silently does nothing on a panel that has not been laid
 * out yet, which is exactly when the queue wants to jump to the restored track.
 *
 * @param {object} options
 * @param {number} options.index position within the view, not within the queue
 * @param {number} options.rowH
 * @param {number} options.padTop
 * @param {number} options.scrollTop
 * @param {number} options.viewportH
 * @returns {number} the scrollTop to use; equal to the input when no scroll is needed
 */
export function nearestScrollTop({ index, rowH, padTop = 0, scrollTop, viewportH }) {
  const top = padTop + index * rowH;
  const bottom = top + rowH;

  // Above the viewport, or taller than it: line the top up and show the start.
  if (top < scrollTop) return Math.max(0, top);
  if (bottom > scrollTop + viewportH) {
    return Math.max(0, Math.min(top, bottom - viewportH));
  }
  return scrollTop;
}
