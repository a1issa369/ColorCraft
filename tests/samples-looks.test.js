import test from 'node:test';
import assert from 'node:assert/strict';
import { renderCoast, renderSample, SAMPLES } from '../src/core/samples.js';
import { LOOKS, lookById } from '../src/core/looks.js';
import { applyAdjustments, makeAdjustments, combine, RANGES } from '../src/core/adjust.js';
import { analyze } from '../src/core/analyze.js';
import { maxDiff, pixel } from './helpers.js';

test('practice photos are deterministic and have the requested size', () => {
  const a = renderSample('dark-cool', 96, 64);
  const b = renderSample('dark-cool', 96, 64);
  assert.deepEqual([a.width, a.height], [96, 64]);
  assert.equal(maxDiff(a, b), 0);
  assert.equal(renderCoast(50, 40).data.length, 50 * 40 * 4);
});

test('the base scene looks the same at different sizes (resolution independent)', () => {
  const small = analyze(renderCoast(120, 80));
  const big = analyze(renderCoast(480, 320));
  assert.ok(Math.abs(small.median - big.median) < 0.03);
  assert.ok(Math.abs(small.spread - big.spread) < 0.06);
  assert.ok(Math.abs(small.chroma - big.chroma) < 2.5);
});

test('every sample differs from the base scene and unknown ids fall back to it', () => {
  const base = renderCoast(80, 60);
  for (const s of SAMPLES) assert.ok(maxDiff(renderSample(s.id, 80, 60), base) > 10, s.id);
  assert.equal(maxDiff(renderSample('nope', 80, 60), base), 0);
});

test('every look has a name, a one-line description and values inside the slider ranges', () => {
  const ids = new Set();
  for (const l of LOOKS) {
    assert.ok(l.name && l.blurb && !/[—–]/.test(l.name + l.blurb), l.id);
    assert.ok(!ids.has(l.id));
    ids.add(l.id);
    for (const [k, v] of Object.entries(l.adj)) {
      if (k === 'splitShadow' || k === 'splitHighlight') {
        assert.ok(v.amount >= 0 && v.amount <= 1 && v.hue >= 0 && v.hue <= 360, `${l.id}.${k}`);
      } else {
        assert.ok(v >= RANGES[k][0] && v <= RANGES[k][1], `${l.id}.${k}=${v}`);
      }
    }
  }
  assert.equal(lookById('film').id, 'film');
  assert.equal(lookById('missing'), null);
});

test('every look changes the picture, and strength 0 is the same as no look', () => {
  const img = renderCoast(80, 60);
  for (const l of LOOKS) {
    const full = applyAdjustments(img, combine(makeAdjustments(), l.adj, 1));
    assert.ok(maxDiff(full, img) > 3, l.id);
    const none = applyAdjustments(img, combine(makeAdjustments(), l.adj, 0));
    assert.ok(maxDiff(none, img) <= 1, l.id);
  }
});

test('the black and white look removes all colour', () => {
  const out = applyAdjustments(renderCoast(80, 60), combine(makeAdjustments(), lookById('bw').adj, 1));
  for (const [x, y] of [[5, 5], [40, 30], [70, 50], [20, 55]]) {
    const [r, g, b] = pixel(out, x, y);
    assert.ok(Math.abs(r - g) <= 1 && Math.abs(g - b) <= 1);
  }
});

test('warm film is warmer and teal and orange cools the shadows', () => {
  const grey = { width: 2, height: 1, data: new Uint8ClampedArray([200, 200, 200, 255, 40, 40, 40, 255]) };
  const film = applyAdjustments(grey, combine(makeAdjustments(), lookById('film').adj, 1));
  assert.ok(pixel(film, 0)[0] > pixel(film, 0)[2]);
  const teal = applyAdjustments(grey, combine(makeAdjustments(), lookById('teal-orange').adj, 1));
  const shadow = pixel(teal, 1);
  assert.ok(shadow[2] > shadow[0] && shadow[1] >= shadow[0], `shadow ${shadow}`);
  const light = pixel(teal, 0);
  assert.ok(light[0] > light[2], `highlight ${light}`);
});
