/**
 * Playback control.
 *
 * Owns the visible player and the position within `state.order`. Advancing is
 * done here rather than by handing YouTube a playlist, because that is the only
 * way to keep our own ordering authoritative.
 *
 * Emits events; never imports the UI.
 */

import { TICK_MS, SEEK_STEP_SEC, PREV_RESTART_SEC } from './config.js';
import { state, save, buildOrder, currentTrack, currentTrackIndex } from './state.js';
import { emit, EV } from './events.js';
import { toast } from './utils.js';
import * as titles from './titles.js';
import * as yt from './youtube.js';

let player = null;
let tickTimer = null;

/** Set while the user drags the seek bar, so ticks do not fight the drag. */
let scrubbing = false;

/**
 * Build the player. Resolves once it is ready to take commands.
 * @param {string} mountId id of the element to replace with the iframe
 */
export async function init(mountId = 'player') {
  await yt.loadApi();

  await new Promise((resolve) => {
    player = yt.newPlayer(mountId, {
      height: '100%',
      width: '100%',
      playerVars: {
        autoplay: 0, controls: 1, rel: 0, modestbranding: 1, playsinline: 1
      },
      events: {
        onReady: () => {
          player.setVolume(state.volume);
          if (state.muted) player.mute();

          // Restored session: cue the track without playing it, so reopening
          // the page never blasts audio unprompted.
          const track = currentTrack();
          if (track) {
            player.cueVideoById(track.vid);
            emit(EV.TRACK, track);
          }
          resolve();
        },
        onStateChange: onStateChange,
        onError: onError
      }
    });
  });
}

export function isInitialised() {
  return player !== null;
}

/* ----------------------------------------------------------- YT callbacks */

function onStateChange(event) {
  const S = yt.playerStates();

  switch (event.data) {
    case S.PLAYING:
      emit(EV.PLAYSTATE, true);
      startTicking();
      captureMetadata();
      break;

    case S.PAUSED:
      emit(EV.PLAYSTATE, false);
      stopTicking();
      break;

    case S.BUFFERING:
      startTicking();
      break;

    case S.ENDED:
      emit(EV.PLAYSTATE, false);
      stopTicking();
      if (state.repeat === 'one') {
        player.seekTo(0, true);
        player.playVideo();
      } else {
        next(true);
      }
      break;
  }
}

/**
 * The player knows the real title and channel of whatever it just started.
 * This is the fallback that always works, even when oEmbed is unreachable.
 */
function captureMetadata() {
  const track = currentTrack();
  if (!track) return;

  try {
    const data = player.getVideoData();
    if (data?.title) {
      track.title = data.title;
      titles.set(track.vid, data.title);
      titles.persist();
    }
    if (data?.author && !track.author) track.author = data.author;
    emit(EV.TRACK, track);
    save();
  } catch { /* metadata is a bonus, not required */ }
}

function onError(event) {
  const track = currentTrack();
  if (track) {
    track.bad = true;
    save();
    emit(EV.TRACK, track);
    toast(`Skipping: ${yt.describeError(event.data)}`);
  }
  // Let the toast register before the next track starts.
  setTimeout(() => next(true), 700);
}

/* -------------------------------------------------------------- transport */

/**
 * Play the entry at a position in `state.order`.
 * @param {number} pos
 * @param {boolean} [autoplay] false cues without playing
 */
export function playAt(pos, autoplay = true) {
  if (!player || pos < 0 || pos >= state.order.length) return;

  state.pos = pos;
  const track = currentTrack();
  if (!track) return;

  emit(EV.TRACK, track);
  save();

  if (autoplay) player.loadVideoById(track.vid);
  else player.cueVideoById(track.vid);
}

/**
 * Advance, skipping tracks already known to be unplayable.
 * @param {boolean} [auto] true when triggered by a track ending
 */
export function next(auto = false) {
  if (!state.order.length) return;

  let pos = state.pos;

  for (let guard = 0; guard <= state.order.length; guard++) {
    pos++;

    if (pos >= state.order.length) {
      if (state.repeat === 'off') {
        if (auto) {
          emit(EV.PLAYSTATE, false);
          toast('End of queue.');
        }
        return;
      }

      // A full cycle finished. Draw a fresh permutation rather than
      // re-randomising partway through - that is the bug being avoided.
      if (state.shuffled && auto) {
        const justPlayed = currentTrackIndex();
        buildOrder();
        if (state.order.length > 1 && state.order[0] === justPlayed) {
          [state.order[0], state.order[1]] = [state.order[1], state.order[0]];
        }
        emit(EV.ORDER);
        toast('Queue finished - reshuffled.');
      }
      pos = 0;
    }

    const track = state.tracks[state.order[pos]];
    if (track && !track.bad) {
      playAt(pos);
      return;
    }
  }

  toast('No playable tracks left in the queue.');
}

/** Restart the track, or step back if already near its start. */
export function prev() {
  if (!state.order.length) return;

  if (currentTime() > PREV_RESTART_SEC) {
    player.seekTo(0, true);
    return;
  }

  let pos = state.pos;
  for (let guard = 0; guard <= state.order.length; guard++) {
    pos--;
    if (pos < 0) pos = state.order.length - 1;
    const track = state.tracks[state.order[pos]];
    if (track && !track.bad) {
      playAt(pos);
      return;
    }
  }
}

/**
 * Start the queue from the top, skipping tracks already known to be unplayable.
 * Used when the order is redrawn from scratch and playback should restart with
 * whatever now leads the queue.
 */
export function playFirst() {
  for (let pos = 0; pos < state.order.length; pos++) {
    const track = state.tracks[state.order[pos]];
    if (track && !track.bad) {
      playAt(pos);
      return;
    }
  }

  state.pos = -1;
  if (state.order.length) toast('No playable tracks left in the queue.');
}

export function togglePlay() {
  if (!player?.getPlayerState) return;

  if (state.pos < 0 && state.order.length) {
    playAt(0);
    return;
  }

  const S = yt.playerStates();
  const current = player.getPlayerState();
  if (current === S.PLAYING || current === S.BUFFERING) player.pauseVideo();
  else player.playVideo();
}

/* ---------------------------------------------------------------- volume */

/** @param {number} value 0-100 */
export function setVolume(value) {
  state.volume = Math.max(0, Math.min(100, value));
  state.muted = state.volume === 0;
  if (player?.setVolume) {
    player.setVolume(state.volume);
    if (state.muted) player.mute();
    else player.unMute();
  }
  save();
}

export function toggleMute() {
  state.muted = !state.muted;
  if (player?.mute) {
    if (state.muted) player.mute();
    else player.unMute();
  }
  save();
}

/* ------------------------------------------------------------------ seek */

export function duration() {
  try {
    return player?.getDuration?.() || 0;
  } catch {
    return 0;
  }
}

export function currentTime() {
  try {
    return player?.getCurrentTime?.() || 0;
  } catch {
    return 0;
  }
}

/** @param {number} fraction 0-1 */
export function seekToFraction(fraction) {
  const total = duration();
  if (total) player.seekTo(total * fraction, true);
}

/** @param {number} [seconds] negative to rewind */
export function seekBy(seconds = SEEK_STEP_SEC) {
  if (!player?.seekTo) return;
  player.seekTo(Math.max(0, currentTime() + seconds), true);
}

export function setScrubbing(value) {
  scrubbing = value;
}

export function isScrubbing() {
  return scrubbing;
}

/* ------------------------------------------------------------- progress */

function startTicking() {
  if (!tickTimer) tickTimer = setInterval(tick, TICK_MS);
}

function stopTicking() {
  clearInterval(tickTimer);
  tickTimer = null;
}

function tick() {
  emit(EV.PROGRESS, { current: currentTime(), duration: duration() });
}
