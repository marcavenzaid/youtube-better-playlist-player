/**
 * Static file server for local development. No dependencies.
 *
 * Exists for two reasons:
 *   1. The app is built from ES modules, which browsers refuse to load over
 *      file://. It also guarantees .js is served with a JavaScript MIME type -
 *      modules are rejected outright if it is anything else.
 *   2. A static page cannot read a .env file. This server can, and hands the
 *      contents to the page at GET /api/config.
 *
 *   node tools/serve.mjs [port]
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ENV_FILE = join(ROOT, '.env');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

/* --------------------------------------------------------------- .env --- */

/**
 * Parse .env contents. Supports comments, blank lines, `export` prefixes,
 * quoted values, and trailing comments after unquoted values.
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseEnv(text) {
  /** @type {Record<string, string>} */
  const out = {};

  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice(7).trim();

    const eq = line.indexOf('=');
    if (eq < 1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    const quoted =
      value.length > 1 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
       (value.startsWith("'") && value.endsWith("'")));

    if (quoted) {
      value = value.slice(1, -1);
    } else {
      // `KEY=abc  # note` - strip the note, but never a '#' inside the value.
      const comment = value.search(/\s#/);
      if (comment !== -1) value = value.slice(0, comment).trim();
    }

    out[key] = value;
  }

  return out;
}

/**
 * Read .env fresh. Done per request so editing the file only needs a page
 * reload, not a server restart.
 * @returns {Promise<Record<string, string>>}
 */
async function readEnv() {
  try {
    return parseEnv(await readFile(ENV_FILE, 'utf8'));
  } catch {
    return {}; // no .env is a perfectly normal setup
  }
}

/* -------------------------------------------------------------- paths --- */

/**
 * Map a request path to a file inside ROOT, or null if it is not allowed.
 * @param {string} urlPath
 */
export function resolvePath(urlPath, root = ROOT) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null; // malformed percent-encoding
  }

  const relative = normalize(decoded).replace(/^([/\\])+/, '');

  // Never serve dotfiles. Without this, .env and .git would be readable over
  // HTTP - the whole point of putting the key in .env is that the page asks
  // the server for it rather than fetching the file itself.
  if (relative.split(/[/\\]/).some((segment) => segment.startsWith('.'))) {
    return null;
  }

  const full = join(root, relative || 'index.html');
  const prefix = root.endsWith(sep) ? root : root + sep;
  if (!full.startsWith(prefix) && full !== root) return null;

  return full;
}

/* ------------------------------------------------------------- server --- */

const server = createServer(async (req, res) => {
  const url = req.url || '/';

  // Config endpoint: everything the page is allowed to know from .env.
  if (url.split('?')[0] === '/api/config') {
    const env = await readEnv();
    const body = JSON.stringify({ youtubeApiKey: env.YOUTUBE_API_KEY || '' });
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    });
    res.end(body);
    return;
  }

  const path = resolvePath(url);
  if (!path) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  try {
    let target = path;
    const info = await stat(target).catch(() => null);
    if (info?.isDirectory()) target = join(target, 'index.html');

    const body = await readFile(target);
    res.writeHead(200, {
      'content-type': MIME[extname(target).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache' // always revalidate, so edits show on refresh
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port is already in use. Try: node tools/serve.mjs 8124`);
  } else {
    console.error(err.message);
  }
  process.exit(1);
});

// Only listen when run directly. The tests import parseEnv and resolvePath from
// this file, and importing it must not start a server.
const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) await start();

async function start() {
  const env = await readEnv();
  const port = Number(process.argv[2]) || Number(env.PORT) || 8123;

  server.listen(port, () => {
    const url = `http://localhost:${port}/index.html`;
    console.log(`Better Playlist Player -> ${url}`);
    console.log(
      env.YOUTUBE_API_KEY
        ? `Using the YouTube API key from .env (...${env.YOUTUBE_API_KEY.slice(-4)})`
        : 'No YOUTUBE_API_KEY in .env - running in no-key mode.'
    );
    console.log('Press Ctrl+C to stop.');

    if (!process.argv.includes('--no-open')) {
      const opener = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
        : process.platform === 'darwin' ? ['open', [url]]
        : ['xdg-open', [url]];
      import('node:child_process')
        .then(({ spawn }) => spawn(opener[0], opener[1], { stdio: 'ignore', detached: true }).unref())
        .catch(() => { /* opening a browser is a nicety */ });
    }
  });
}
