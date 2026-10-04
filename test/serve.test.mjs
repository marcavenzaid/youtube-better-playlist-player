import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEnv, resolvePath } from '../tools/serve.mjs';

/* ------------------------------------------------------------- parseEnv --- */

test('parses a plain key=value', () => {
  assert.deepEqual(parseEnv('YOUTUBE_API_KEY=abc123'), { YOUTUBE_API_KEY: 'abc123' });
});

test('ignores comments and blank lines', () => {
  const env = parseEnv(`
# a comment
   # an indented comment

YOUTUBE_API_KEY=abc123

# trailing comment
`);
  assert.deepEqual(env, { YOUTUBE_API_KEY: 'abc123' });
});

test('trims whitespace around keys and values', () => {
  assert.deepEqual(parseEnv('  KEY  =  value  '), { KEY: 'value' });
});

test('strips matching quotes', () => {
  assert.equal(parseEnv('KEY="quoted value"').KEY, 'quoted value');
  assert.equal(parseEnv("KEY='quoted value'").KEY, 'quoted value');
  // A lone quote is part of the value, not a delimiter.
  assert.equal(parseEnv('KEY="unbalanced').KEY, '"unbalanced');
});

test('strips a trailing comment from an unquoted value', () => {
  assert.equal(parseEnv('KEY=abc123  # my key').KEY, 'abc123');
});

test('keeps a # that is part of the value', () => {
  assert.equal(parseEnv('KEY=abc#123').KEY, 'abc#123');
  assert.equal(parseEnv('KEY="abc # 123"').KEY, 'abc # 123');
});

test('accepts an export prefix', () => {
  assert.equal(parseEnv('export YOUTUBE_API_KEY=abc123').YOUTUBE_API_KEY, 'abc123');
});

test('keeps = characters inside a value', () => {
  assert.equal(parseEnv('KEY=a=b=c').KEY, 'a=b=c');
});

test('treats an empty value as empty, not missing', () => {
  const env = parseEnv('YOUTUBE_API_KEY=');
  assert.equal(env.YOUTUBE_API_KEY, '');
  assert.ok('YOUTUBE_API_KEY' in env);
});

test('handles CRLF line endings', () => {
  assert.deepEqual(parseEnv('A=1\r\nB=2\r\n'), { A: '1', B: '2' });
});

test('skips malformed lines', () => {
  assert.deepEqual(parseEnv('novalue\n=noname\nGOOD=yes'), { GOOD: 'yes' });
});

/* ---------------------------------------------------------- resolvePath --- */

const ROOT = process.platform === 'win32' ? 'C:\\app\\' : '/app/';

test('resolves normal paths inside the root', () => {
  assert.ok(resolvePath('/index.html', ROOT));
  assert.ok(resolvePath('/src/js/main.js', ROOT));
});

test('serves index.html for the root path', () => {
  assert.match(resolvePath('/', ROOT), /index\.html$/);
});

test('refuses dotfiles so .env is never served', () => {
  // The whole point of .env is that the page asks the server for the key
  // rather than being able to fetch the file.
  assert.equal(resolvePath('/.env', ROOT), null);
  assert.equal(resolvePath('/.env.example', ROOT), null);
  assert.equal(resolvePath('/.git/config', ROOT), null);
  assert.equal(resolvePath('/src/../.env', ROOT), null);
});

test('never resolves outside the root', () => {
  // `..` is clamped at the root by normalize() rather than rejected, so
  // "/../../etc/passwd" becomes "/etc/passwd" *inside* the root. That is the
  // usual static-server behaviour and is safe; the invariant that matters is
  // that no input can ever produce a path outside ROOT.
  const attacks = [
    '/../../etc/passwd',
    '/src/../../secret.txt',
    '/%2e%2e%2f%2e%2e%2fsecret.txt',      // ../../ percent-encoded
    '/..%2f..%2fsecret.txt',
    '/C:/Windows/win.ini',                 // absolute path as a request path
    '//server/share/x',                    // UNC-looking path
    '/src/js/../../../../../../etc/passwd'
  ];

  for (const attack of attacks) {
    const resolved = resolvePath(attack, ROOT);
    if (resolved === null) continue;       // rejected outright is also fine
    assert.ok(
      resolved.startsWith(ROOT),
      `"${attack}" escaped the root: ${resolved}`
    );
  }
});

test('survives malformed percent-encoding', () => {
  assert.equal(resolvePath('/%', ROOT), null);
});

test('ignores the query string when resolving', () => {
  assert.match(resolvePath('/index.html?v=2', ROOT), /index\.html$/);
});
