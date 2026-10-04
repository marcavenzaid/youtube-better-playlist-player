import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePlaylistId } from '../src/js/playlists.js';

test('accepts a bare playlist ID', () => {
  assert.equal(
    parsePlaylistId('PLrAXtmRdnEQy6nuLMHjMZOz59Oq8B9CtI'),
    'PLrAXtmRdnEQy6nuLMHjMZOz59Oq8B9CtI'
  );
  assert.equal(parsePlaylistId('OLAK5uy_kM8sPqRtY2wZx'), 'OLAK5uy_kM8sPqRtY2wZx');
});

test('extracts list= from playlist URLs', () => {
  assert.equal(
    parsePlaylistId('https://www.youtube.com/playlist?list=PLabc123def456'),
    'PLabc123def456'
  );
  assert.equal(
    parsePlaylistId('https://music.youtube.com/playlist?list=PLxyz789abcd'),
    'PLxyz789abcd'
  );
});

test('extracts list= from a watch URL opened inside a playlist', () => {
  assert.equal(
    parsePlaylistId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=OLAK5uy_kM8s&index=3'),
    'OLAK5uy_kM8s'
  );
});

test('tolerates surrounding whitespace', () => {
  assert.equal(
    parsePlaylistId('   https://www.youtube.com/playlist?list=PLxyz789abcd  '),
    'PLxyz789abcd'
  );
});

test('rejects input that is not a playlist reference', () => {
  assert.equal(parsePlaylistId('not a playlist'), null);
  assert.equal(parsePlaylistId(''), null);
  assert.equal(parsePlaylistId('   '), null);
  assert.equal(parsePlaylistId(null), null);
  assert.equal(parsePlaylistId(undefined), null);
});

test('rejects a plain video URL with no list parameter', () => {
  assert.equal(parsePlaylistId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), null);
});

test('passes through the un-embeddable special lists', () => {
  // These cannot play, but they should reach the player so the user gets a
  // real explanation rather than "that does not look like a playlist ID".
  assert.equal(parsePlaylistId('WL'), 'WL');
  assert.equal(parsePlaylistId('LL'), 'LL');
});
