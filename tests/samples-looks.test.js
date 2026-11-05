import test from 'node:test';
import assert from 'node:assert/strict';
import { renderCoast, renderSample, SAMPLES } from '../src/core/samples.js';
import { LOOKS, LOOK_GROUPS, lookById } from '../src/core/looks.js';
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
      } else if (k === 'curves') {
        for (const pts of Object.values(v)) for (const [x, y] of pts) assert.ok(x >= 0 && x <= 1 && y >= 0 && y <= 1, `${l.id}.curves`);
      } else if (k === 'hsl') {
        for (const arr of Object.values(v)) for (const n of arr) assert.ok(n >= -100 && n <= 100, `${l.id}.hsl`);
      } else {
        assert.ok(v >= RANGES[k][0] && v <= RANGES[k][1], `${l.id}.${k}=${v}`);
      }
    }
  }
  assert.ok(LOOKS.length >= 15);
  for (const l of LOOKS) assert.ok(LOOK_GROUPS.includes(l.group), `${l.id} has no group`);
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

test('Neon night keeps pink pink and does not flatten a vivid scene', async () => {
  const { makeImage } = await import('../src/core/image.js');
  const look = lookById('neon-night');
  const px = makeImage(1, 1); px.data.set([230, 60, 190, 255]);        // hot pink
  const out = applyAdjustments(px, combine(makeAdjustments(), look.adj, 1));
  const hue = (r, g, b) => { const mx = Math.max(r, g, b), d = mx - Math.min(r, g, b); const h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return h * 60; };
  const before = hue(230, 60, 190), after = hue(out.data[0], out.data[1], out.data[2]);
  assert.ok(Math.abs(after - before) <= 12, `pink hue moved ${before.toFixed(0)} -> ${after.toFixed(0)}`);
  // stacked on a strong edit it must still leave most of a vivid ramp distinguishable
  const ramp = makeImage(1, 128);
  for (let y = 0; y < 128; y++) ramp.data.set([Math.round(30 + y * 0.3), Math.round(40 + y * 0.4), Math.round(120 + y), 255], y * 4);
  const mine = makeAdjustments({ exposure: 0.3, contrast: 20, saturation: 25 });
  const o2 = applyAdjustments(ramp, combine(mine, look.adj, 1));
  const seen = new Set(); for (let y = 0; y < 128; y++) seen.add(`${o2.data[y * 4]},${o2.data[y * 4 + 1]},${o2.data[y * 4 + 2]}`);
  assert.ok(seen.size >= 60, `only ${seen.size} distinct colours survived`);
});
