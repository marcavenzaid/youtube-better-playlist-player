/** Transport buttons, shuffle controls, the settings modal, keyboard shortcuts. */

import { SEEK_STEP_SEC } from '../config.js';
import { state, save, buildOrder, reset } from '../state.js';
import { emit, on, EV } from '../events.js';
import { $, toast, fmtTime, paintRange } from '../utils.js';
import * as playback from '../playback.js';
import * as titles from '../titles.js';
import * as env from '../env.js';
import * as queue from './queue.js';

const ICON_VOL =
  '<path d="M4 9v6h4l5 4V5L8 9H4zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/>';
const ICON_MUTED =
  '<path d="M4 9v6h4l5 4V5L8 9H4zm15.1 3 2.2-2.2-1.1-1.1L18 10.9l-2.2-2.2-1.1 1.1L16.9 12' +
  'l-2.2 2.2 1.1 1.1L18 13.1l2.2 2.2 1.1-1.1z"/>';

/* A screen rather than a camcorder: the button hides the video pane, it does not stop
   the video. Each shape is its own <path> so overlapping fills never cancel out. */
const ICON_SCREEN =
  '<path d="M20 4H4c-1.1 0-2 .9-2 2v9c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2z' +
  'm0 11H4V6h16v9z"/>';
const ICON_STAND = '<path d="M13 17h-2v2H8v1.5h8V19h-3z"/>';
const ICON_VIDEO = ICON_SCREEN + '<path d="M10.5 7.5v6l5-3z"/>' + ICON_STAND;
const ICON_VIDEO_OFF =
  ICON_SCREEN + ICON_STAND + '<path d="M4.2 2.8 2.8 4.2l16.5 16.5 1.4-1.4z"/>';

/**
 * @param {() => void} onLoad handler for the Load button
 * @param {() => void} onCancel handler for that same button mid-load
 */
export function init(onLoad, onCancel) {
  wireTransport();
  wireShuffle();
  wireThumbs();
  wirePlaylists();
  wireVolume();
  wireSeek();
  wireSettings();
  wireKeyboard();

  // One button for both: there is nothing to load while a load is running, and
  // without this a slow playlist can only be escaped by reloading the page.
  let loading = false;
  $('btnLoad').addEventListener('click', () => (loading ? onCancel() : onLoad()));

  on(EV.LOADING, ({ busy, message }) => {
    loading = busy;
    $('btnLoad').textContent = busy ? 'Cancel' : 'Load';
    $('btnLoad').classList.toggle('primary', !busy);
    $('loadStatus').textContent = message || '';
  });

  syncButtons();
}

function wireTransport() {
  $('btnPlay').addEventListener('click', () => playback.togglePlay());
  $('btnNext').addEventListener('click', () => playback.next());
  $('btnPrev').addEventListener('click', () => playback.prev());

  $('btnVideo').addEventListener('click', () => {
    state.audioOnly = !state.audioOnly;
    syncButtons();
    save();
    toast(state.audioOnly ? 'Video off - the audio keeps playing.' : 'Video on.');
  });

  $('btnRepeat').addEventListener('click', () => {
    state.repeat = { off: 'all', all: 'one', one: 'off' }[state.repeat];
    syncButtons();
    save();
    toast({
      off: 'Repeat off - stops at the end of the queue.',
      all: 'Repeating the whole queue.',
      one: 'Repeating this track.'
    }[state.repeat]);
  });
}

function wireShuffle() {
  $('btnShuffle').addEventListener('click', () => {
    state.shuffled = !state.shuffled;
    // A fresh draw every time, and the queue restarts from whatever now leads it.
    buildOrder();
    syncButtons();
    emit(EV.ORDER);
    playback.playFirst();
    queue.scrollToCurrent();
    save();
    toast(state.shuffled ? 'Shuffled - new random order.' : 'Back to original playlist order.');
  });
}

function wireThumbs() {
  $('btnThumbs').addEventListener('click', () => {
    state.thumbs = !state.thumbs;
    syncButtons();
    // The rows carry the <img> only while thumbnails are on, so the class
    // syncButtons() flips changes the padding but cannot add or remove the
    // images themselves. Rebuilding is what actually applies the toggle.
    queue.render();
    save();
    toast(state.thumbs ? 'Thumbnails shown.' : 'Thumbnails hidden.');
  });
}

// No toast here: unlike the queue toggles, the panel opening or closing is
// the whole feedback, and one on every click would be noise.
function wirePlaylists() {
  $('btnPlaylists').addEventListener('click', () => {
    state.playlistsOpen = !state.playlistsOpen;
    syncButtons();
    save();
  });
}

function wireVolume() {
  $('btnMute').addEventListener('click', () => {
    playback.toggleMute();
    syncButtons();
  });

  $('vol').addEventListener('input', (e) => {
    playback.setVolume(Number(e.target.value));
    syncButtons();
  });
}

function wireSeek() {
  const seek = $('seek');

  const begin = () => playback.setScrubbing(true);
  const end = () => {
    if (!playback.isScrubbing()) return;
    playback.setScrubbing(false);
    playback.seekToFraction(Number(seek.value) / 1000);
  };

  seek.addEventListener('mousedown', begin);
  seek.addEventListener('touchstart', begin, { passive: true });
  seek.addEventListener('mouseup', end);
  seek.addEventListener('touchend', end);
  seek.addEventListener('change', end);

  // Keyboard users get no mousedown, so treat a bare keypress as a full scrub.
  seek.addEventListener('keydown', begin);
  seek.addEventListener('keyup', end);

  seek.addEventListener('input', () => {
    paintRange(seek);
    const total = playback.duration();
    if (total) $('tCur').textContent = fmtTime(total * (Number(seek.value) / 1000));
  });
}

/**
 * Settings lives in a modal, so the player behind it is never torn down and the
 * track keeps playing. showModal() is what makes it modal: Escape, the focus
 * trap, returning focus to the gear on close, and the inert page behind are all
 * the dialog's own doing, and none of it is reimplemented here.
 */
function wireSettings() {
  const dlg = $('dlgSettings');

  $('btnSettings').addEventListener('click', () => dlg.showModal());
  $('btnSettingsClose').addEventListener('click', () => dlg.close());

  // A click that lands on the dialog itself came down on the backdrop: the
  // element has no padding of its own, so its children cover all of it.
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close();
  });

  const key = $('apiKey');
  key.value = state.apiKey;

  // Make it obvious where a key is coming from, so an empty box does not look
  // like "no key configured" when .env has one. Same test the loader makes:
  // a typed key wins, .env is the fallback, and neither means the embed path.
  const syncKeyHint = () => {
    const fromEnv = env.hasApiKey();
    key.placeholder = fromEnv ? 'Using the key from .env' : 'AIza...';
    $('envHint').classList.toggle('hidden', !fromEnv);
    $('envHint').textContent = state.apiKey.trim()
      ? 'This key overrides the one in .env.'
      : `Loaded from .env (...${env.apiKey().slice(-4)}).`;

    // With no key to be had, the walkthrough goes up in here and the warning
    // goes up beside Load; with one, both are noise and come down.
    const none = !state.apiKey.trim() && !fromEnv;
    $('apiKeyHelp').classList.toggle('hidden', !none);
    $('noKeyNotice').classList.toggle('hidden', !none);
  };

  $('btnNoKeySettings').addEventListener('click', () => dlg.showModal());

  key.addEventListener('input', (e) => {
    state.apiKey = e.target.value;
    syncKeyHint();
    save();
  });

  syncKeyHint();

  $('btnClearTitles').addEventListener('click', () => {
    const n = titles.size();
    titles.clear();
    toast(`Cleared ${n} cached title${n === 1 ? '' : 's'}.`);
  });

  $('btnReset').addEventListener('click', () => {
    if (!confirm('Clear all playlists, the queue, and settings?')) return;
    reset();
    location.reload();
  });
}

function wireKeyboard() {
  document.addEventListener('keydown', (e) => {
    // Player shortcuts stay out of the modal: Space there belongs to whichever
    // button has focus, and Escape to the dialog, which closes itself.
    if ($('dlgSettings').open) return;

    const tag = e.target.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.ctrlKey || e.metaKey || e.altKey) return;

    switch (e.key.toLowerCase()) {
      case ' ':
        e.preventDefault();
        playback.togglePlay();
        break;
      case 'n': playback.next(); break;
      case 'p': playback.prev(); break;
      case 's': $('btnShuffle').click(); break;
      // Only ours to handle while the mute button is up; with the video on,
      // YouTube's own chrome owns the shortcut.
      case 'm':
        if (state.audioOnly) $('btnMute').click();
        break;
      case 'arrowright':
        e.preventDefault();
        playback.seekBy(SEEK_STEP_SEC);
        break;
      case 'arrowleft':
        e.preventDefault();
        playback.seekBy(-SEEK_STEP_SEC);
        break;
    }
  });
}

/** Push all of `state`'s toggle flags back onto the buttons. */
export function syncButtons() {
  $('btnShuffle').classList.toggle('on', state.shuffled);
  $('btnShuffle').setAttribute('aria-pressed', String(state.shuffled));

  $('btnRepeat').classList.toggle('active', state.repeat !== 'off');
  $('btnRepeat').classList.toggle('dim', state.repeat === 'off');
  $('repeatBadge').classList.toggle('hidden', state.repeat !== 'one');

  $('btnPlaylists').setAttribute('aria-expanded', String(state.playlistsOpen));
  $('playlistsBody').classList.toggle('hidden', !state.playlistsOpen);

  $('btnThumbs').classList.toggle('on', state.thumbs);
  $('btnThumbs').setAttribute('aria-pressed', String(state.thumbs));
  $('qList').classList.toggle('no-thumbs', !state.thumbs);

  const btnVideo = $('btnVideo');
  btnVideo.classList.toggle('active', state.audioOnly);
  btnVideo.setAttribute('aria-pressed', String(state.audioOnly));
  btnVideo.setAttribute('aria-label', state.audioOnly ? 'Video off' : 'Video on');
  btnVideo.title = state.audioOnly
    ? 'Video off - click to show the video'
    : 'Video on - click to hide the video and keep the audio';
  $('videoIcon').innerHTML = state.audioOnly ? ICON_VIDEO_OFF : ICON_VIDEO;
  $('stage').classList.toggle('audio', state.audioOnly);

  // With the video up, YouTube's own chrome already offers a scrubber and
  // volume controls; ours would be a second set of controls for the same
  // thing. Hiding the video takes that chrome away, so ours takes over. The
  // seek row only goes invisible - it is also what holds the two button
  // groups apart.
  $('seekRow').classList.toggle('off', !state.audioOnly);
  $('btnMute').classList.toggle('hidden', !state.audioOnly);
  $('vol').classList.toggle('hidden', !state.audioOnly);

  const silent = state.muted || state.volume === 0;
  $('vol').value = String(silent ? 0 : state.volume);
  paintRange($('vol'));
  $('volIcon').innerHTML = silent ? ICON_MUTED : ICON_VOL;
}
