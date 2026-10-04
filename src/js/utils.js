/** Small DOM and formatting helpers. */

/** @param {string} id */
export const $ = (id) => document.getElementById(id);

/**
 * Escape for interpolation into an HTML string. Video titles are attacker-ish
 * input (anyone can name a video anything), and the queue is built by string
 * concatenation, so everything user-derived goes through here.
 * @param {*} s
 */
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Seconds to m:ss, or h:mm:ss past an hour.
 * @param {number} sec
 */
export function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * Colour a range input's track up to its current value. The CSS reads --fill;
 * every place that writes `.value` has to call this, since a range input has
 * no way of telling CSS where its thumb sits.
 * @param {HTMLInputElement} el
 */
export function paintRange(el) {
  const min = Number(el.min) || 0;
  const max = Number(el.max) || 100;
  const pct = max > min ? ((Number(el.value) - min) / (max - min)) * 100 : 0;
  el.style.setProperty('--fill', `${pct}%`);
}

let toastTimer = null;

/**
 * @param {string} msg
 * @param {number} [ms]
 */
export function toast(msg, ms = 2600) {
  const el = $('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}
