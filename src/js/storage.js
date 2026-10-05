/**
 * localStorage wrapper that never throws.
 *
 * Three things can go wrong with localStorage and all of them are survivable:
 * it is absent (Node, during tests), it throws on access (private browsing,
 * blocked site data), or it rejects a write (quota). In every case we fall back
 * to an in-memory map so the app keeps working for the current session.
 */

const memory = new Map();

const backing = (() => {
  try {
    const probe = '__bpp_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
})();

/** True when writes will survive a reload. */
export const isPersistent = backing !== null;

/**
 * @param {string} key
 * @param {*} fallback returned when missing or unparseable
 */
export function read(key, fallback = null) {
  try {
    const raw = backing ? backing.getItem(key) : memory.get(key);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * @param {string} key
 * @param {*} value JSON-serialisable
 * @returns {boolean} whether it was stored durably
 */
export function write(key, value) {
  const raw = JSON.stringify(value);
  memory.set(key, raw);
  if (!backing) return false;
  try {
    backing.setItem(key, raw);
    return true;
  } catch {
    return false; // quota exceeded - memory copy still holds
  }
}

/**
 * Roughly what a key costs against the quota. Browsers keep the strings as
 * UTF-16, two bytes a character, and count the key's name as well as its value.
 * @param {string} key
 * @returns {number} bytes, 0 when nothing is stored
 */
export function bytes(key) {
  try {
    const raw = backing ? backing.getItem(key) : memory.get(key);
    return raw == null ? 0 : (key.length + raw.length) * 2;
  } catch {
    return 0;
  }
}

/** @param {string} key */
export function remove(key) {
  memory.delete(key);
  try {
    if (backing) backing.removeItem(key);
  } catch { /* nothing useful to do */ }
}
