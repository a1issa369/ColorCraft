import test from 'node:test';
import assert from 'node:assert/strict';
import { makeMask, linearAlpha, applyMasks, AlphaCache, maskIsNeutral, masksAreNeutral, cloneMasks, MASK_STARTERS, MAX_MASKS } from '../src/core/mask.js';
import { applyAdjustments, makeAdjustments } from '../src/core/adjust.js';
import { solid, fromFn, maxDiff, pixel } from './helpers.js';
import { cloneImage } from '../src/core/image.js';

const at = (a, w, x, y) => a[y * w + x];

test('a gradient is full at its start, nothing at its end, and half way between', () => {
  const m = makeMask({ x1: 0.5, y1: 0, x2: 0.5, y2: 1 });
  const w = 20, h = 100, a = linearAlpha(m, w, h);
  assert.ok(at(a, w, 10, 0) > 0.99);
  assert.ok(at(a, w, 10, 99) < 0.01);
  assert.ok(Math.abs(at(a, w, 10, 49) - 0.5) < 0.03);
});

test('a gradient only changes along its direction and never rises moving away from the start', () => {
  const m = makeMask({ x1: 0.5, y1: 0.1, x2: 0.5, y2: 0.9 });
  const w = 30, h = 80, a = linearAlpha(m, w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 1; x < w; x++) assert.equal(at(a, w, x, y), at(a, w, 0, y));   // same across a row
    if (y) assert.ok(at(a, w, 0, y) <= at(a, w, 0, y - 1) + 1e-9);               // falls as you go down
  }
});

test('invert swaps where the effect lands', () => {
  const m = makeMask({ x1: 0.5, y1: 0, x2: 0.5, y2: 1 });
  const n = makeMask({ x1: 0.5, y1: 0, x2: 0.5, y2: 1, invert: true });
  const a = linearAlpha(m, 10, 40), b = linearAlpha(n, 10, 40);
  for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i] + b[i] - 1) < 1e-6);
});

test('a sloped gradient is measured in real pixels, so its angle is true on a wide photo', () => {
  // From the left edge to the right edge of a 200x50 photo the fade is horizontal, regardless of the photo being wide.
  const m = makeMask({ x1: 0, y1: 0.5, x2: 1, y2: 0.5 });
  const w = 200, h = 50, a = linearAlpha(m, w, h);
  assert.ok(at(a, w, 0, 25) > 0.99 && at(a, w, 199, 25) < 0.01);
  assert.ok(Math.abs(at(a, w, 100, 0) - at(a, w, 100, 49)) < 1e-9);
  // A 45 degree gradient on a square photo: points on the same diagonal line share a value.
  const d = makeMask({ x1: 0, y1: 0, x2: 1, y2: 1 });
  const s = linearAlpha(d, 50, 50);
  assert.ok(Math.abs(at(s, 50, 10, 30) - at(s, 50, 30, 10)) < 1e-6);
});

test('a gradient whose ends coincide is a flat 0, or 1 when inverted, not a crash', () => {
  const a = linearAlpha(makeMask({ x1: 0.3, y1: 0.3, x2: 0.3, y2: 0.3 }), 6, 6);
  assert.ok(a.every((v) => v === 0));
  const b = linearAlpha(makeMask({ x1: 0.3, y1: 0.3, x2: 0.3, y2: 0.3, invert: true }), 6, 6);
  assert.ok(b.every((v) => v === 1));
});

test('a mask with every slider at zero changes nothing', () => {
  const img = fromFn(16, 16, (x, y) => [x * 15, y * 15, 120]);
  const before = cloneImage(img);
  const m = makeMask({ x1: 0.5, y1: 0, x2: 0.5, y2: 1 });
  assert.ok(maskIsNeutral(m) && masksAreNeutral([m]) && masksAreNeutral([]));
  applyMasks(img, [m], new AlphaCache());
  assert.equal(maxDiff(img, before), 0);
});

test('the edit lands in full at the start, not at all past the end, and part way between', () => {
  const w = 10, h = 100;
  const src = solid(w, h, 100, 100, 100);
  const m = makeMask({ x1: 0.5, y1: 0.2, x2: 0.5, y2: 0.8, adj: { exposure: 1 } });
  const img = cloneImage(src);
  applyMasks(img, [m], new AlphaCache());
  const edited = applyAdjustments(src, makeAdjustments({ exposure: 1 }));
  const top = pixel(img, 5, 5), mid = pixel(img, 5, 50), bottom = pixel(img, 5, 95), full = pixel(edited, 5, 5), none = pixel(src, 5, 5);
  assert.deepEqual(top, full);
  assert.deepEqual(bottom, none);
  assert.ok(mid[0] > none[0] + 5 && mid[0] < full[0] - 5, `middle ${mid[0]} should sit between ${none[0]} and ${full[0]}`);
});

test('masks apply in order, each on top of the one before', () => {
  const src = solid(8, 8, 90, 90, 90);
  const full = (adj) => makeMask({ x1: 0.5, y1: 0, x2: 0.5, y2: 100, adj });  // fades so slowly it is ~1 everywhere
  const two = cloneImage(src);
  applyMasks(two, [full({ exposure: 0.5 }), full({ exposure: 0.5 })], new AlphaCache());
  const one = cloneImage(src);
  applyMasks(one, [full({ exposure: 0.5 })], new AlphaCache());
  assert.ok(pixel(two, 4, 4)[0] > pixel(one, 4, 4)[0] + 8);
});

test('each mask uses its own sliders and does not leak into the global edit', () => {
  const src = solid(8, 8, 90, 90, 90);
  const glob = applyAdjustments(src, makeAdjustments({ contrast: 30 }));
  const before = cloneImage(glob);
  applyMasks(glob, [makeMask({ x1: 0.5, y1: 1, x2: 0.5, y2: 1.5, adj: { saturation: 50 } })], new AlphaCache());
  // a grey photo has nothing to saturate, so a saturation-only mask must leave it alone
  assert.ok(maxDiff(glob, before) <= 1);
});

test('the alpha cache reuses maps for the same shape and rebuilds when anything changes', () => {
  const c = new AlphaCache(2);
  const m = makeMask({ x1: 0.5, y1: 0, x2: 0.5, y2: 1 });
  const a = c.get(m, 10, 10);
  assert.equal(c.get(m, 10, 10), a);
  assert.notEqual(c.get(m, 12, 10), a);                       // other size
  assert.notEqual(c.get({ ...m, y2: 0.9 }, 10, 10), a);       // moved handle
  assert.notEqual(c.get({ ...m, invert: true }, 10, 10), a);  // flipped
  assert.ok(c.map.size <= 2);
});

test('cloning masks is deep and starters are valid, bounded gradients', () => {
  const list = [makeMask({ adj: { exposure: 0.3 } })];
  const copy = cloneMasks(list);
  copy[0].adj.exposure = 1; copy[0].x1 = 0.9;
  assert.equal(list[0].adj.exposure, 0.3);
  assert.equal(list[0].x1, 0.5);
  assert.equal(copy[0].id, list[0].id);
  assert.ok(MAX_MASKS >= 1);
  for (const s of MASK_STARTERS) {
    const m = makeMask(s.mask);
    assert.ok(!maskIsNeutral(m), s.id);
    assert.ok([m.x1, m.y1, m.x2, m.y2].every((v) => v >= 0 && v <= 1), s.id);
    assert.ok(Math.hypot(m.x2 - m.x1, m.y2 - m.y1) > 0.2, s.id);
  }
});
