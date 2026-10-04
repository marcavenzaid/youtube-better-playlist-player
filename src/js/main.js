/**
 * Entry point. Wires the modules together and boots the player.
 *
 * Load order matters: the UI is rendered from restored state first so the page
 * is usable immediately, then the YouTube API is loaded in the background.
 */

import { state, restore, newSource, saveNow } from './state.js';
import { emit, EV } from './events.js';
import { $, toast } from './utils.js';
import * as env from './env.js';
import * as playback from './playback.js';
import * as loader from './loader.js';
import * as sourcesUi from './ui/sources.js';
import * as queueUi from './ui/queue.js';
import * as nowPlayingUi from './ui/nowplaying.js';
import * as controlsUi from './ui/controls.js';

function load() {
  loader.loadAll($('embedHost'));
}

async function boot() {
  const restored = restore();
  if (!state.sources.length) state.sources.push(newSource());

  // Before the UI, so Settings can show whether a key came from .env.
  await env.load();

  sourcesUi.init(load);
  queueUi.init();
  nowPlayingUi.init();
  controlsUi.init(load, loader.cancel);

  if (restored && state.tracks.length) {
    emit(EV.ORDER);
    queueUi.scrollToCurrent();
    toast(`Restored ${state.tracks.length} tracks.`, 3200);
  }

  // Flush pending state on the way out, since save() is debounced.
  window.addEventListener('pagehide', saveNow);

  try {
    await playback.init('player');
  } catch (err) {
    toast(err.message || 'Could not load the YouTube player.', 6000);
    console.error(err);
  }
}

boot();
