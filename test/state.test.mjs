import test from 'node:test';
import assert from 'node:assert/strict';
import { state, buildOrder, currentTrack, currentTrackIndex, restore } from '../src/js/state.js';
import * as storage from '../src/js/storage.js';
import { LS_STATE, SOURCE_COLORS } from '../src/js/config.js';

/**
 * @param {number} count
 * @param {string[]} [sources] source uid per track, cycled
 */
function seed(count, sources = ['a']) {
  state.sources = [...new Set(sources)].map((uid) => ({
    uid, raw: uid, plId: uid, name: uid, count: 0,
    status: 'ok', enabled: true, color: '#fff'
  }));
  state.tracks = Array.from({ length: count }, (_, i) => ({
    vid: `v${i}`,
    title: `Track ${i}`,
    author: '',
    srcUid: sources[i % sources.length],
    srcName: sources[i % sources.length],
    color: '#fff',
    bad: false
  }));
  state.order = [];
  state.pos = -1;
}

test('unshuffled order is the original playlist order', () => {
  seed(10);
  state.shuffled = false;
  buildOrder();
  assert.deepEqual(state.order, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('shuffled order contains every track exactly once', () => {
  seed(200);
  state.shuffled = true;
  buildOrder();

  assert.equal(state.order.length, 200);
  assert.equal(new Set(state.order).size, 200);
  assert.notDeepEqual(state.order, state.tracks.map((_, i) => i));
});

test('keepCurrent follows the playing track so audio never cuts', () => {
  seed(50);
  state.shuffled = true;
  buildOrder();

  state.pos = 20;
  const playing = currentTrackIndex();
  const track = currentTrack();

  buildOrder({ keepCurrent: true });

  assert.equal(state.order[state.pos], playing, 'pos should point at the same track');
  assert.equal(currentTrack(), track, 'the same track should still be current');
  assert.equal(new Set(state.order).size, 50, 'no track should be lost in the move');
});

test('the playing track is shuffled like any other, not pinned to the front', () => {
  seed(40);
  state.shuffled = true;
  buildOrder();
  state.pos = 12;

  const slots = new Set();
  for (let i = 0; i < 200; i++) {
    buildOrder({ keepCurrent: true });
    slots.add(state.pos);
  }

  assert.ok(slots.size > 1, 'the playing track should land in varying slots');
  assert.ok(!(slots.size === 1 && slots.has(0)), 'it should not always lead the queue');
});

test('toggling shuffle off restores the original order and keeps the track', () => {
  seed(30);
  state.shuffled = true;
  buildOrder();
  state.pos = 7;
  const track = currentTrack();

  state.shuffled = false;
  buildOrder({ keepCurrent: true });

  assert.equal(currentTrack(), track);
  assert.equal(new Set(state.order).size, 30);
  // The whole queue is back in playlist order, current track included.
  assert.deepEqual(state.order, state.tracks.map((_, i) => i));
});

test('an empty track pool yields an empty order', () => {
  seed(0);
  state.shuffled = true;
  buildOrder();
  assert.deepEqual(state.order, []);
  assert.equal(currentTrack(), null);
});

test('currentTrack is null when nothing is selected', () => {
  seed(5);
  buildOrder();
  state.pos = -1;
  assert.equal(currentTrack(), null);
  assert.equal(currentTrackIndex(), -1);
});

test('restore re-derives colours so a palette change reaches saved sessions', () => {
  // A session saved under the retired palette: both the source and its tracks
  // carry the old hex.
  storage.write(LS_STATE, {
    sources: [
      { uid: 'a', raw: 'a', plId: 'a', name: 'a', enabled: true, color: '#ff4d5a' },
      { uid: 'b', raw: 'b', plId: 'b', name: 'b', enabled: true, color: '#5b8cff' }
    ],
    tracks: [
      { vid: 'v0', title: '', author: '', srcUid: 'a', srcName: 'a', color: '#ff4d5a', bad: false },
      { vid: 'v1', title: '', author: '', srcUid: 'b', srcName: 'b', color: '#5b8cff', bad: false }
    ],
    order: [0, 1],
    pos: 0
  });

  assert.equal(restore(), true);
  assert.deepEqual(
    state.sources.map((s) => s.color),
    [SOURCE_COLORS[0], SOURCE_COLORS[1]]
  );
  // Tracks follow their own source, not their position in the track list.
  assert.deepEqual(
    state.tracks.map((t) => t.color),
    [SOURCE_COLORS[0], SOURCE_COLORS[1]]
  );
});
