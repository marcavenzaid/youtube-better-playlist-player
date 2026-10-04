/** Track title, source line, and the seek bar readout. */

import { currentTrack } from '../state.js';
import { on, EV } from '../events.js';
import { $, fmtTime, paintRange } from '../utils.js';
import * as playback from '../playback.js';

export function init() {
  on(EV.TRACK, render);
  on(EV.TITLE, onTitle);
  on(EV.PROGRESS, onProgress);
  on(EV.PLAYSTATE, setPlayIcon);

  render(currentTrack());
}

/** @param {import('../state.js').Track|null} track */
export function render(track) {
  const title = $('nowTitle');
  const sub = $('nowSub');

  if (!track) {
    title.textContent = 'Nothing loaded';
    sub.textContent = 'Add a playlist in the sidebar and press Load.';
    $('seek').disabled = true;
    $('tCur').textContent = '0:00';
    $('tDur').textContent = '0:00';
    $('seek').value = '0';
    paintRange($('seek'));
    return;
  }

  $('seek').disabled = false;
  title.textContent = track.title || track.vid;
  sub.textContent = track.author || track.srcName;
}

function onTitle({ vid, title }) {
  const track = currentTrack();
  if (track && track.vid === vid && title) $('nowTitle').textContent = title;
}

function onProgress({ current, duration }) {
  $('tDur').textContent = fmtTime(duration);
  if (playback.isScrubbing()) return;
  $('tCur').textContent = fmtTime(current);
  $('seek').value = duration ? String(Math.round((current / duration) * 1000)) : '0';
  paintRange($('seek'));
}

/** @param {boolean} playing */
function setPlayIcon(playing) {
  $('playIcon').innerHTML = playing
    ? '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>'
    : '<path d="M8 5v14l11-7z"/>';
}
