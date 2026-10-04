/**
 * Server-provided configuration.
 *
 * A page served as static files cannot read a .env file - only the process
 * serving it can. tools/serve.mjs parses .env and exposes the parts the page
 * is allowed to see at GET /api/config; this module fetches that once at boot.
 *
 * The endpoint is absent when the folder is served by anything else (the
 * python fallback in serve.cmd, say), so a failure here is not an error: the
 * app simply falls back to the key typed into Settings.
 */

let config = { youtubeApiKey: '' };
let loaded = false;

/**
 * Fetch /api/config. Never throws.
 * @returns {Promise<{youtubeApiKey: string}>}
 */
export async function load() {
  try {
    const res = await fetch('/api/config', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const body = await res.json();
    config = { youtubeApiKey: String(body.youtubeApiKey || '').trim() };
    loaded = true;
  } catch {
    config = { youtubeApiKey: '' };
    loaded = false;
  }
  return config;
}

/** The key from .env, or '' when there is none. */
export function apiKey() {
  return config.youtubeApiKey;
}

/** Whether a key arrived from .env. */
export function hasApiKey() {
  return Boolean(config.youtubeApiKey);
}

/** Whether /api/config answered at all - false under a plain static server. */
export function isAvailable() {
  return loaded;
}
