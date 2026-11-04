import test from 'node:test';
import assert from 'node:assert/strict';
import { dominantColors } from '../src/core/palette.js';
import { fromFn, solid } from './helpers.js';
import { renderCoast } from '../src/core/samples.js';

const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

test('two flat halves give those two colours with half the share each', () => {
  const img = fromFn(40, 20, (x) => (x < 20 ? [220, 30, 30] : [30, 60, 220]));
  const p = dominantColors(img, 2);
  assert.equal(p.length, 2);
  for (const c of p) assert.ok(Math.abs(c.share - 0.5) < 0.02);
  const reds = p.filter((c) => hexToRgb(c.hex)[0] > 150);
  assert.equal(reds.length, 1);
  assert.ok(Math.abs(hexToRgb(reds[0].hex)[0] - 220) < 6);
});

test('swatches are sorted from most to least common and shares sum to 1', () => {
  const img = fromFn(100, 10, (x) => (x < 70 ? [200, 200, 60] : x < 90 ? [40, 120, 200] : [90, 20, 20]));
  const p = dominantColors(img, 3);
  for (let i = 1; i < p.length; i++) assert.ok(p[i - 1].share >= p[i].share);
  assert.ok(Math.abs(p.reduce((s, c) => s + c.share, 0) - 1) < 1e-9);
  assert.ok(Math.abs(p[0].share - 0.7) < 0.03);
});

test('the result is deterministic', () => {
  const img = renderCoast(120, 80);
  assert.deepEqual(dominantColors(img, 5), dominantColors(img, 5));
});

test('asking for more colours than exist gives only the ones that exist', () => {
  const p = dominantColors(solid(10, 10, 50, 100, 150), 5);
  assert.ok(p.length >= 1 && p.length <= 5);
  assert.ok(p.every((c) => /^#[0-9a-f]{6}$/.test(c.hex)));
  assert.ok(Math.abs(hexToRgb(p[0].hex)[1] - 100) < 4);
});

test('an empty image gives no swatches', () => {
  assert.deepEqual(dominantColors({ width: 0, height: 0, data: new Uint8ClampedArray(0) }, 5), []);
});
