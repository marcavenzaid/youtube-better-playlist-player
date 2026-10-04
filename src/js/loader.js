/**
 * Turning the configured sources into a queue.
 *
 * Sources are read one at a time rather than in parallel: the no-key path
 * drives a single hidden player, and running several at once would have them
 * overwrite each other's results.
 *
 * The rebuild is all or nothing. Loading replaces the whole track pool, so
 * committing a partial result would mean a playlist that is briefly out of
 * reach - a network blip, a spent API quota - silently costs you every track
 * it contributed, with nothing to undo it. One failure and nothing changes.
 */

import { state, save, buildOrder } from './state.js';
import { emit, EV } from './events.js';
import { toast } from './utils.js';
import * as playlists from './playlists.js';
import * as titles from './titles.js';
import * as playback from './playback.js';
import * as yt from './youtube.js';
import * as env from './env.js';

let busy = false;
/** @type {AbortController|null} */
let controller = null;

export function isBusy() {
  return busy;
}

/**
 * Abandon a run in progress. Nothing is committed until every playlist is in,
 * so a cancelled load leaves the queue and playback exactly as they were.
 */
export function cancel() {
  if (!busy) return;
  controller?.abort();
  emit(EV.LOADING, { busy: true, message: 'Cancelling...' });
}

/**
 * Read every enabled source and, when all of them succeed, rebuild the queue
 * and start playing. If any of them fails, the queue is left as it was.
 *
 * @param {HTMLElement} embedHost offscreen container for the no-key extractor
 */
export async function loadAll(embedHost) {
  if (busy) return;

  if (!yt.isReady()) {
    toast('Still connecting to YouTube...');
    return;
  }

  const active = state.sources.filter((s) => s.enabled && s.raw.trim());
  if (!active.length) {
    toast('Add at least one playlist ID first.');
    return;
  }

  busy = true;
  controller = new AbortController();
  emit(EV.LOADING, { busy: true, message: '' });

  // finally rather than clearing the flag at the end of the run: anything
  // thrown past the per-source catch would otherwise leave Load disabled, and
  // the status frozen mid-message, for the rest of the session.
  try {
    await rebuild(active, embedHost, controller.signal);
  } catch (err) {
    console.error(err);
    toast(err?.message || 'Loading failed unexpectedly.', 4600);
  } finally {
    busy = false;
    controller = null;
    emit(EV.LOADING, { busy: false, message: '' });
  }
}

/**
 * @param {import('./state.js').Source[]} active enabled sources with something typed in
 * @param {HTMLElement} embedHost
 * @param {AbortSignal} signal aborted by cancel()
 */
async function rebuild(active, embedHost, signal) {
  // A key typed into Settings overrides .env, so the UI always wins when both
  // are present and there is a way to try a different key without editing files.
  const apiKey = state.apiKey.trim() || env.apiKey();
  /** @type {import('./state.js').Track[]} */
  const tracks = [];
  const seen = new Set();
  /** @type {string[]} playlists that loaded but came back short */
  const shortened = [];
  let failures = 0;

  for (const source of active) {
    if (signal.aborted) break;

    const playlistId = playlists.parsePlaylistId(source.raw);

    if (!playlistId) {
      source.status = 'err';
      source.error = 'that does not look like a playlist ID';
      failures++;
      emit(EV.SOURCES);
      continue;
    }

    // A name already found for this same ID stays up while it is re-read.
    if (source.plId !== playlistId) source.title = '';
    source.plId = playlistId;
    source.name = playlistId;
    source.status = '';
    delete source.error;
    emit(EV.SOURCES);
    emit(EV.LOADING, { busy: true, message: `Loading ${playlistId}...` });

    // Started alongside the items rather than after them, so it costs no time.
    // Never rejects: a playlist without a name still loads.
    const titleRequest = playlists.fetchPlaylistTitle(playlistId, apiKey, signal);

    try {
      const { items, truncated } = apiKey
        ? await playlists.fetchViaApi(playlistId, apiKey, (n) =>
            emit(EV.LOADING, { busy: true, message: `Loading ${playlistId}... ${n}` }), signal)
        : await playlists.fetchViaEmbed(playlistId, embedHost, signal);

      const title = await titleRequest;
      if (title) source.title = title;
      source.name = source.title || playlistId;

      for (const item of items) {
        // Deduplicated per source, not globally: the same video appearing in
        // two of your playlists is deliberate and should play twice.
        const key = `${source.uid}|${item.vid}`;
        if (seen.has(key)) continue;
        seen.add(key);

        tracks.push({
          vid: item.vid,
          title: item.title || titles.get(item.vid),
          author: item.author || '',
          srcUid: source.uid,
          srcName: source.title || playlistId,
          color: source.color,
          bad: false
        });
      }

      // A short read is still a usable one, so the tracks are kept and the
      // run carries on. It is not counted as a failure - dropping thousands of
      // playable tracks over a missing tail would be the worse outcome - but
      // it does not get to pass for 'ok' either.
      if (truncated) {
        source.status = 'warn';
        source.error = truncated;
        shortened.push(playlistId);
      } else {
        source.status = 'ok';
      }
    } catch (err) {
      // Cancelling drops whatever request was open. That is not this
      // playlist's fault, so its row goes back to saying nothing.
      if (signal.aborted) {
        source.status = '';
        delete source.error;
        break;
      }
      source.status = 'err';
      source.error = err?.message || 'failed to load';
      failures++;
    }

    emit(EV.SOURCES);
  }

  if (signal.aborted) {
    emit(EV.SOURCES);
    save();
    toast('Load cancelled - the queue is unchanged.');
    return;
  }

  if (failures) {
    // Everything read this run is dropped on the floor: the queue, the order,
    // and whatever is playing carry on untouched. Only the per-source
    // messages changed, and those are what say which playlist to look at.
    save();
    toast(
      `${failures} playlist${failures > 1 ? 's' : ''} failed - queue unchanged. ` +
      'See the message under each one.',
      4600
    );
    return;
  }

  state.tracks = tracks;
  buildOrder();
  state.pos = tracks.length ? 0 : -1;

  emit(EV.ORDER);
  save();

  if (!tracks.length) {
    // Not a failure: every playlist answered, and between them they hold
    // nothing. An emptied queue is the honest result.
    emit(EV.TRACK, null);
    toast('Those playlists came back empty.', 4200);
    return;
  }

  // The count is the headline either way; the clause is there so a short read
  // cannot be mistaken for a complete one at a glance. Which playlist was cut
  // and why stays on its own row, where there is room to say it.
  toast(
    shortened.length
      ? `Loaded ${tracks.length} tracks - ${shortened.length} ` +
        `playlist${shortened.length > 1 ? 's' : ''} came back short. See the sidebar.`
      : `Loaded ${tracks.length} tracks.`,
    shortened.length ? 4600 : 2600
  );

  playback.playAt(0);

  // Without a key the tracks arrived as bare IDs; fill the names in behind the
  // playing track rather than blocking the queue on it.
  if (!apiKey) backfillTitles();
}

async function backfillTitles() {
  const { filled, blocked } = await titles.hydrate(
    state.tracks,
    (vid, title) => emit(EV.TITLE, { vid, title })
  );
  if (filled) save();
  if (blocked) {
    toast('Could not reach the title service - names will fill in as tracks play.', 4600);
  }
}
