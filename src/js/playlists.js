/**
 * Turning a playlist ID into a list of videos.
 *
 * Two paths, because a Data API key is optional:
 *
 *   fetchViaApi   - needs a key. Titles included, and long enough playlists
 *                   are read whole in practice.
 *   fetchViaEmbed - needs nothing. Cues the playlist into an offscreen player
 *                   and reads the IDs back out. No titles, and YouTube caps
 *                   what the embed exposes at roughly 200 items.
 *
 * Either can come back with less than the playlist holds, so both report it the
 * same way: a `truncated` note on the result, which the caller shows against
 * that playlist. Silence there is a promise that the read was complete.
 */

import {
  API_PAGE_SIZE, API_MAX_PAGES, API_TIMEOUT_MS,
  EMBED_TIMEOUT_MS, EMBED_POLL_MS, EMBED_MAX_ITEMS
} from './config.js';
import * as titles from './titles.js';
import * as yt from './youtube.js';

/** @typedef {{vid: string, title: string, author: string}} PlaylistItem */
/**
 * @typedef {object} PlaylistResult
 * @property {PlaylistItem[]} items
 * @property {string} [truncated] why the read stopped early, ready to show as
 *   is: a bracketed reason, then how far it got. Absent when the whole playlist
 *   was read - the caller distinguishes a complete read from a partial one on
 *   this field alone, so it must not be set speculatively.
 */

/**
 * Pull a playlist ID out of whatever the user pasted: a bare ID, a playlist
 * URL, or a watch URL opened from inside a playlist.
 *
 * @param {string} raw
 * @returns {string|null} null when it clearly is not a playlist reference
 */
export function parsePlaylistId(raw) {
  const s = (raw || '').trim();
  if (!s) return null;

  const fromUrl = s.match(/[?&]list=([A-Za-z0-9_-]+)/);
  if (fromUrl) return fromUrl[1];

  // A bare ID. Real ones are well past 12 characters; the prefix check catches
  // the short special lists (LL, WL) so they reach the player and produce a
  // proper "cannot be embedded" message rather than a parse failure here.
  if (/^[A-Za-z0-9_-]{12,}$/.test(s)) return s;
  if (/^(PL|UU|OL|RD|FL|LL|WL)[A-Za-z0-9_-]*$/.test(s)) return s;

  return null;
}

/**
 * Read a playlist through the YouTube Data API.
 *
 * @param {string} playlistId
 * @param {string} apiKey
 * @param {(count: number) => void} [onProgress] called after each page
 * @param {AbortSignal} [signal] drops the in-flight request when cancelled
 * @returns {Promise<PlaylistResult>}
 */
export async function fetchViaApi(playlistId, apiKey, onProgress, signal) {
  /** @type {PlaylistItem[]} */
  const items = [];
  let pageToken = '';

  for (let page = 0; page < API_MAX_PAGES; page++) {
    const url = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('maxResults', String(API_PAGE_SIZE));
    url.searchParams.set('playlistId', playlistId);
    url.searchParams.set('key', apiKey);
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    // Two ways out: the caller cancelling, and a deadline of our own, because
    // a request left hanging would otherwise hold the whole run open.
    const deadline = AbortSignal.timeout(API_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline
    });
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (body?.error?.message) message = body.error.message;
      } catch { /* keep the status code */ }
      throw new Error(message);
    }

    const body = await res.json();
    for (const entry of body.items || []) {
      const snippet = entry.snippet || {};
      const vid = snippet.resourceId?.videoId;
      if (!vid) continue;
      // Placeholders for videos that are gone; they cannot be played.
      if (snippet.title === 'Private video' || snippet.title === 'Deleted video') continue;

      items.push({
        vid,
        title: snippet.title || '',
        author: snippet.videoOwnerChannelTitle || ''
      });
      titles.set(vid, snippet.title);
    }

    onProgress?.(items.length);
    pageToken = body.nextPageToken || '';
    if (!pageToken) break;
  }

  titles.persist();

  // The loop has two exits and they mean opposite things: a page that came
  // back without a nextPageToken is the end of the playlist, while a token
  // still in hand means the page budget ran out first and there is more up
  // there we did not ask for. Returning a bare array would make those
  // indistinguishable, which is exactly how a truncated queue passes for a
  // complete one.
  return pageToken
    ? { items, truncated: `[pageLimit] Loading stopped at ${items.length} items.` }
    : { items };
}

/**
 * Look up a playlist's own name. Best effort: the name is a label, not part of
 * the load, so every failure comes back as '' rather than a throw.
 *
 * With a key the Data API answers; without one, oEmbed does - it accepts a
 * playlist URL and returns the playlist's title rather than a video's.
 *
 * @param {string} playlistId
 * @param {string} [apiKey]
 * @param {AbortSignal} [signal]
 * @returns {Promise<string>}
 */
export async function fetchPlaylistTitle(playlistId, apiKey, signal) {
  try {
    const deadline = AbortSignal.timeout(API_TIMEOUT_MS);
    const opts = { signal: signal ? AbortSignal.any([signal, deadline]) : deadline };

    if (apiKey) {
      const url = new URL('https://www.googleapis.com/youtube/v3/playlists');
      url.searchParams.set('part', 'snippet');
      url.searchParams.set('id', playlistId);
      url.searchParams.set('key', apiKey);
      const res = await fetch(url, opts);
      if (!res.ok) return '';
      const body = await res.json();
      return body.items?.[0]?.snippet?.title || '';
    }

    const target = `https://www.youtube.com/playlist?list=${playlistId}`;
    const res = await fetch(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(target)}`, opts
    );
    if (!res.ok) return '';
    const data = await res.json();
    return data.title || '';
  } catch {
    return '';
  }
}

/**
 * Read a playlist with no credentials, by cueing it into a hidden player and
 * polling `getPlaylist()` until the IDs appear.
 *
 * @param {string} playlistId
 * @param {HTMLElement} host offscreen container; its contents are replaced
 * @param {AbortSignal} [signal] tears the hidden player down when cancelled
 * @returns {Promise<PlaylistResult>}
 */
export function fetchViaEmbed(playlistId, host, signal) {
  return new Promise((resolve, reject) => {
    const mount = document.createElement('div');
    host.replaceChildren(mount);

    let settled = false;
    let pollTimer = null;
    let timeoutTimer = null;
    let player = null;

    const cleanup = () => {
      clearInterval(pollTimer);
      clearTimeout(timeoutTimer);
      signal?.removeEventListener('abort', onAbort);
      try {
        player?.destroy?.();
      } catch { /* already torn down */ }
      host.replaceChildren();
    };

    /**
     * @param {string[]} ids
     * @param {string} [truncated] set when the list is known to be short
     */
    const succeed = (ids, truncated) => {
      if (settled) return;
      settled = true;
      cleanup();
      const items = ids.map((vid) => ({ vid, title: titles.get(vid), author: '' }));
      resolve(truncated ? { items, truncated } : { items });
    };

    const fail = (message) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(message));
    };

    const onAbort = () => fail('cancelled');

    if (signal?.aborted) {
      fail('cancelled');
      return;
    }
    signal?.addEventListener('abort', onAbort);

    const readPlaylist = () => {
      try {
        return player?.getPlaylist?.() || [];
      } catch {
        return [];
      }
    };

    timeoutTimer = setTimeout(() => {
      const ids = readPlaylist();
      // Partial results beat nothing, but an empty list after this long means
      // the playlist is private, deleted, or not embeddable. Whatever did
      // arrive got cut off mid-read, so it is reported as short rather than
      // handed back as though the playlist simply ended there.
      if (ids.length) {
        succeed(ids, `[timeout] Loading stopped at ${ids.length} items.`);
      } else {
        fail('timed out - private, deleted, or embedding disabled');
      }
    }, EMBED_TIMEOUT_MS);

    // Guarded: a throw here would reject the promise while leaving the timeout
    // above running, and that stray timer would later clear the host out from
    // under whichever playlist is being read by then.
    try {
      player = yt.newPlayer(mount, {
        height: 200,
        width: 200,
        playerVars: { listType: 'playlist', list: playlistId, autoplay: 0, controls: 0 },
        events: {
          onReady: () => {
            try {
              player.mute();
            } catch { /* muting is a courtesy, not a requirement */ }
            pollTimer = setInterval(() => {
              const ids = readPlaylist();
              if (!ids.length) return;
              // The embed hands back at most a couple of hundred entries no
              // matter how long the playlist really is. Landing exactly on
              // the ceiling is the only signal available that it clipped.
              succeed(
                ids,
                ids.length >= EMBED_MAX_ITEMS
                  ? `[embedLimit] Loading stopped at ${ids.length} items.`
                  : undefined
              );
            }, EMBED_POLL_MS);
          },
          onError: (e) => fail(yt.describeError(e.data))
        }
      });
    } catch (err) {
      fail(err?.message || 'could not start the hidden player');
    }
  });
}
