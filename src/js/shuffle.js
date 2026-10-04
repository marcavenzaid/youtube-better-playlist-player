/**
 * Randomisation.
 *
 * The whole reason this project exists. YouTube's shuffle picks a *next* track
 * semi-randomly each time, so some tracks resurface constantly while others sit
 * untouched. This module instead produces a full permutation up front, which is
 * played to completion before anything repeats.
 *
 * Pure functions, no DOM, no imports - see test/shuffle.test.mjs.
 */

const _buf = new Uint32Array(1);

/**
 * Unbiased random integer in [0, n).
 *
 * `crypto.getRandomValues() % n` alone would be biased: 2^32 is not divisible
 * by most n, so the lowest values would come up slightly more often. Rejection
 * sampling discards the short tail of the range to remove that skew.
 *
 * @param {number} n exclusive upper bound
 * @returns {number}
 */
export function randInt(n) {
  if (n <= 1) return 0;
  const limit = Math.floor(0x100000000 / n) * n;
  let x;
  do {
    crypto.getRandomValues(_buf);
    x = _buf[0];
  } while (x >= limit);
  return x % n;
}

/**
 * Fisher-Yates shuffle. Every one of the n! orderings is equally likely.
 * Returns a new array; the input is left alone.
 *
 * @template T
 * @param {T[]} arr
 * @returns {T[]}
 */
export function fisherYates(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}
