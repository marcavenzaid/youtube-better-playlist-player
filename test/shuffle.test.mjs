import test from 'node:test';
import assert from 'node:assert/strict';
import { randInt, fisherYates } from '../src/js/shuffle.js';

test('randInt stays within bounds', () => {
  for (let i = 0; i < 20000; i++) {
    const n = randInt(7);
    assert.ok(n >= 0 && n < 7, `${n} out of range`);
    assert.ok(Number.isInteger(n));
  }
});

test('randInt handles degenerate bounds', () => {
  assert.equal(randInt(1), 0);
  assert.equal(randInt(0), 0);
  assert.equal(randInt(-3), 0);
});

test('randInt is not biased toward low values', () => {
  // Rejection sampling exists to prevent exactly this skew.
  const n = 3;
  const runs = 90000;
  const counts = new Array(n).fill(0);
  for (let i = 0; i < runs; i++) counts[randInt(n)]++;

  const expected = runs / n;
  for (const count of counts) {
    const deviation = Math.abs(count - expected) / expected;
    assert.ok(deviation < 0.04, `bucket off by ${(deviation * 100).toFixed(2)}%`);
  }
});

test('fisherYates returns a true permutation and does not mutate its input', () => {
  const input = Array.from({ length: 5000 }, (_, i) => i);
  const frozen = input.slice();

  const out = fisherYates(input);

  assert.deepEqual(input, frozen, 'input was mutated');
  assert.equal(out.length, 5000);
  assert.equal(new Set(out).size, 5000, 'items were lost or duplicated');
  assert.notDeepEqual(out, frozen, 'output is suspiciously the identity order');
});

test('fisherYates is uniform: every item reaches every slot equally often', () => {
  // The core guarantee. A biased shuffle (the classic "swap with any index"
  // mistake) fails this while still producing valid permutations.
  const n = 6;
  const runs = 120000;
  const base = Array.from({ length: n }, (_, i) => i);

  const counts = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let r = 0; r < runs; r++) {
    const shuffled = fisherYates(base);
    for (let slot = 0; slot < n; slot++) counts[shuffled[slot]][slot]++;
  }

  const expected = runs / n;
  let worst = 0;
  for (const row of counts) {
    for (const count of row) {
      worst = Math.max(worst, Math.abs(count - expected) / expected);
    }
  }
  // ~6 sigma at this sample size; a real bias shows up far larger than this.
  assert.ok(worst < 0.04, `worst cell deviated ${(worst * 100).toFixed(2)}% from uniform`);
});

test('fisherYates handles empty and single-item arrays', () => {
  assert.deepEqual(fisherYates([]), []);
  assert.deepEqual(fisherYates(['only']), ['only']);
});
