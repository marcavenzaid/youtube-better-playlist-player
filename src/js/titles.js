/**
 * Video titles.
 *
 * The Data API returns titles alongside the video IDs, but the no-key embed
 * path returns IDs only. This module holds the cache and the best-effort
 * backfill used in that case.
 *
 * Three sources fill the cache, in order of how quickly they land:
 *   1. this cache, from a previous session         - instant
 *   2. oEmbed, requested in parallel below         - seconds, and may be blocked
 *   3. the player itself as each track starts      - always works, one at a time
 */

import { LS_TITLES, OEMBED_WORKERS, OEMBED_MAX_FAILS } from './config.js';
import * as storage from './storage.js';

/** @type {Record<string, string>} */
let cache = storage.read(LS_TITLES, {}) || {};

/** @param {string} videoId */
export function get(videoId) {
  return cache[videoId] || '';
}

/**
 * @param {string} videoId
 * @param {string} title
 */
export function set(videoId, title) {
  if (videoId && title) cache[videoId] = title;
}

export function persist() {
  storage.write(LS_TITLES, cache);
}

export function clear() {
  cache = {};
  persist();
}

export function size() {
  return Object.keys(cache).length;
}

/**
 * Fill in missing titles via YouTube's oEmbed endpoint.
 *
 * Requires no credentials, but is a cross-origin request, so it can be refused
 * depending on how the page was opened. After a few consecutive failures we
 * stop rather than fire hundreds of doomed requests - the player will fill the
 * titles in as tracks play instead.
 *
 * @param {Array<{vid: string, title: string, author: string}>} tracks mutated in place
 * @param {(vid: string, title: string) => void} [onFilled] called per resolved title
 * @returns {Promise<{filled: number, blocked: boolean}>}
 */
export async function hydrate(tracks, onFilled) {
  /** @type {typeof tracks} */
  const pending = [];

  for (const track of tracks) {
    if (track.title) continue;
    const known = get(track.vid);
    if (known) {
      track.title = known;
      onFilled?.(track.vid, known);
      continue;
    }
    pending.push(track);
  }

  if (!pending.length) return { filled: 0, blocked: false };

  let cursor = 0;
  let consecutiveFailures = 0;
  let filled = 0;
  let blocked = false;

  const worker = async () => {
    while (cursor < pending.length && !blocked) {
      const track = pending[cursor++];
      try {
        const target = `https://www.youtube.com/watch?v=${track.vid}`;
        const res = await fetch(
          `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(target)}`
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        consecutiveFailures = 0;

        if (data.title) {
          track.title = data.title;
          set(track.vid, data.title);
          filled++;
          onFilled?.(track.vid, data.title);
        }
        if (data.author_name && !track.author) track.author = data.author_name;
      } catch {
        // A single 404 is just an unavailable video; a run of them means the
        // endpoint is unreachable and every further request would also fail.
        if (++consecutiveFailures >= OEMBED_MAX_FAILS) blocked = true;
      }
    }
  };

  await Promise.all(
    Array.from({ length: OEMBED_WORKERS }, worker)
  );

  persist();
  return { filled, blocked };
}
