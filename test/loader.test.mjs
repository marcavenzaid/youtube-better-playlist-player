import test from 'node:test';
import assert from 'node:assert/strict';
import { state } from '../src/js/state.js';
import { API_MAX_PAGES } from '../src/js/config.js';
import { loadAll, isBusy, cancel } from '../src/js/loader.js';

// Nothing in the load path touches the DOM at import time: `toast` looks up an
// element only when it fires, and the hidden embed is never reached while an
// API key is set. Stubbing these two globals plus fetch runs the whole thing
// headlessly, against the real loader rather than a mock of it.
globalThis.window = { YT: { Player: class {} } };
globalThis.document = { getElementById: () => null };

/** The playlist-name lookup, which runs beside every read. */
const isNameLookup = (url) => url.pathname.endsWith('/playlists');

/**
 * Stand in for the Data API: one page per playlist, 404 for anything else.
 * Each known playlist is named "Name of <id>".
 * @param {Record<string, string[]>} byPlaylist video ids keyed by playlist id
 */
function stubApi(byPlaylist) {
  globalThis.fetch = async (url) => {
    if (isNameLookup(url)) {
      const id = url.searchParams.get('id');
      return {
        ok: true,
        json: async () => ({ items: byPlaylist[id] ? [{ snippet: { title: `Name of ${id}` } }] : [] })
      };
    }
    const vids = byPlaylist[url.searchParams.get('playlistId')];
    if (!vids) return { ok: false, status: 404, json: async () => ({}) };
    return {
      ok: true,
      json: async () => ({
        items: vids.map((vid) => ({
          snippet: { resourceId: { videoId: vid }, title: vid.toUpperCase() }
        }))
      })
    };
  };
}

/**
 * @param {Array<{uid: string, raw: string}>} sources
 * @param {string[]} existing video ids already in the queue
 */
function seed(sources, existing) {
  state.sources = sources.map(({ uid, raw }) => ({
    uid, raw, plId: null, name: '', status: '', enabled: true, color: '#fff'
  }));
  state.tracks = existing.map((vid) => ({
    vid, title: vid, author: '', srcUid: 'old', srcName: 'PLOLD',
    color: '#fff', bad: false
  }));
  state.order = state.tracks.map((_, i) => i);
  state.pos = 1;
  state.apiKey = 'test-key';
  state.shuffled = false;
}

const queue = () => state.tracks.map((t) => t.vid);

test('an unreadable playlist ID leaves the queue exactly as it was', async () => {
  seed([{ uid: 'a', raw: 'PLaaaaaaaaaaaa' }, { uid: 'b', raw: '???' }], ['old1', 'old2', 'old3']);
  stubApi({ PLaaaaaaaaaaaa: ['new1', 'new2'] });

  await loadAll(null);

  // Not even the playlist that read back fine is committed.
  assert.deepEqual(queue(), ['old1', 'old2', 'old3']);
  assert.deepEqual(state.order, [0, 1, 2]);
  assert.equal(state.pos, 1, 'whatever was playing keeps playing');
  assert.equal(state.sources[1].status, 'err');
  assert.equal(isBusy(), false, 'Load is usable again');
});

test('a playlist that fails to fetch leaves the queue exactly as it was', async () => {
  seed([{ uid: 'a', raw: 'PLaaaaaaaaaaaa' }, { uid: 'b', raw: 'PLbbbbbbbbbbbb' }], ['old1', 'old2']);
  stubApi({ PLaaaaaaaaaaaa: ['new1'] });

  await loadAll(null);

  assert.deepEqual(queue(), ['old1', 'old2']);
  assert.equal(state.sources[0].status, 'ok');
  assert.equal(state.sources[1].status, 'err');
  assert.match(state.sources[1].error, /404/);
  assert.equal(isBusy(), false);
});

test('the queue is rebuilt once every playlist loads', async () => {
  seed([{ uid: 'a', raw: 'PLaaaaaaaaaaaa' }, { uid: 'b', raw: 'PLbbbbbbbbbbbb' }], ['old1', 'old2']);
  stubApi({ PLaaaaaaaaaaaa: ['new1', 'new2'], PLbbbbbbbbbbbb: ['new3'] });

  await loadAll(null);

  assert.deepEqual(queue(), ['new1', 'new2', 'new3']);
  assert.deepEqual(state.order, [0, 1, 2]);
  assert.equal(state.pos, 0);
  assert.equal(isBusy(), false);
});

test('a playlist emptied at the source does empty the queue', async () => {
  seed([{ uid: 'a', raw: 'PLaaaaaaaaaaaa' }], ['old1', 'old2']);
  stubApi({ PLaaaaaaaaaaaa: [] });

  await loadAll(null);

  // Nothing failed - the playlist genuinely holds nothing now.
  assert.deepEqual(queue(), []);
  assert.equal(state.pos, -1);
});

test('cancelling mid-run leaves the queue as it was', async () => {
  seed([{ uid: 'a', raw: 'PLaaaaaaaaaaaa' }, { uid: 'b', raw: 'PLbbbbbbbbbbbb' }], ['old1', 'old2']);

  // Cancel lands while the first request is still open.
  let requests = 0;
  globalThis.fetch = async (url, { signal } = {}) => {
    if (isNameLookup(url)) return { ok: true, json: async () => ({ items: [] }) };
    requests++;
    cancel();
    if (signal?.aborted) throw new Error('aborted');
    return { ok: true, json: async () => ({ items: [] }) };
  };

  await loadAll(null);

  assert.equal(requests, 1, 'the playlists behind it are never requested');
  assert.deepEqual(queue(), ['old1', 'old2']);
  assert.deepEqual(state.order, [0, 1]);
  assert.equal(state.pos, 1, 'whatever was playing keeps playing');
  assert.equal(state.sources[0].status, '', 'the interrupted row is not blamed');
  assert.equal(isBusy(), false, 'Load is usable again');
});

test('cancel does nothing when no load is running', () => {
  seed([{ uid: 'a', raw: 'PLaaaaaaaaaaaa' }], ['old1']);
  cancel();
  assert.deepEqual(queue(), ['old1']);
  assert.equal(isBusy(), false);
});

/**
 * A playlist with no end: every page hands back another nextPageToken, so the
 * read can only ever stop by running out of page budget.
 */
function stubEndlessApi() {
  let pages = 0;
  globalThis.fetch = async (url) => {
    if (isNameLookup(url)) return { ok: true, json: async () => ({ items: [] }) };
    const n = pages++;
    return {
      ok: true,
      json: async () => ({
        items: [`v${n}a`, `v${n}b`].map((vid) => ({
          snippet: { resourceId: { videoId: vid }, title: vid.toUpperCase() }
        })),
        nextPageToken: `page${n + 1}`
      })
    };
  };
  return () => pages;
}

test('a playlist longer than the page budget is kept, but flagged as short', async () => {
  seed([{ uid: 'a', raw: 'PLendlessssss' }], ['old1', 'old2']);
  const pagesRead = stubEndlessApi();

  await loadAll(null);

  // Committed: a short read is still usable, and is not treated as a failure.
  assert.equal(state.tracks.length, API_MAX_PAGES * 2);
  assert.equal(pagesRead(), API_MAX_PAGES);
  assert.notDeepEqual(queue(), ['old1', 'old2']);

  // ...but it does not get to pass for a complete one. The count is derived
  // rather than written in, so lowering the budget to eyeball the warning in
  // the browser does not fail the suite.
  assert.equal(state.sources[0].status, 'warn');
  assert.equal(
    state.sources[0].error,
    `[pageLimit] Loading stopped at ${API_MAX_PAGES * 2} items.`
  );
});

test('a playlist that ends on its own is not flagged', async () => {
  seed([{ uid: 'a', raw: 'PLaaaaaaaaaaaa' }], []);
  stubApi({ PLaaaaaaaaaaaa: ['new1', 'new2'] });

  await loadAll(null);

  assert.equal(state.sources[0].status, 'ok');
  assert.equal(state.sources[0].error, undefined);
});

test('a loaded playlist picks up its name, and its tracks carry it', async () => {
  seed([{ uid: 'a', raw: 'PLaaaaaaaaaaaa' }], []);
  stubApi({ PLaaaaaaaaaaaa: ['new1'] });

  await loadAll(null);

  assert.equal(state.sources[0].title, 'Name of PLaaaaaaaaaaaa');
  assert.equal(state.tracks[0].srcName, 'Name of PLaaaaaaaaaaaa');
});

test('a failed name lookup does not stop the playlist loading', async () => {
  seed([{ uid: 'a', raw: 'PLaaaaaaaaaaaa' }], []);
  stubApi({ PLaaaaaaaaaaaa: ['new1'] });
  const items = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (isNameLookup(url)) throw new Error('offline');
    return items(url, opts);
  };

  await loadAll(null);

  assert.equal(state.sources[0].status, 'ok');
  assert.equal(state.sources[0].title, '');
  assert.equal(state.tracks[0].srcName, 'PLaaaaaaaaaaaa', 'falls back to the ID');
});
