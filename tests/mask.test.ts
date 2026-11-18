import test from 'node:test';
import assert from 'node:assert/strict';
import { makeMask, linearAlpha, applyMasks, AlphaCache, maskIsNeutral, masksAreNeutral, cloneMasks, MASK_STARTERS, MAX_MASKS } from '../src/core/mask.ts';
import { applyAdjustments, makeAdjustments } from '../src/core/adjust.ts';
import { solid, fromFn, maxDiff, pixel } from './helpers.ts';
import { cloneImage } from '../src/core/image.ts';

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

// ---- brightness (range) masks ----
import { lumaMap, rangeAlpha, RANGE_STARTERS } from '../src/core/mask.ts';

const grey = (n) => fromFn(n, 1, (x) => { const v = Math.round((x / (n - 1)) * 255); return [v, v, v]; });

test('luma weights green most and blue least, and reads black as 0 and white as 1', () => {
  const l = lumaMap(fromFn(4, 1, (x) => [[0, 0, 0], [255, 255, 255], [0, 255, 0], [0, 0, 255]][x]));
  assert.equal(l[0], 0);
  assert.ok(Math.abs(l[1] - 1) < 1e-6);
  assert.ok(l[2] > 0.7 && l[3] < 0.08);
});

test('a range mask is full inside its range, nothing well outside it, and half way down each fade', () => {
  const m = makeMask({ kind: 'range', lo: 0.4, hi: 0.6, soft: 0.1 });
  const luma = Float32Array.from([0.1, 0.3, 0.35, 0.4, 0.5, 0.6, 0.65, 0.7, 0.9]);
  const a = rangeAlpha(m, luma);
  assert.equal(a[0], 0);
  assert.ok(a[1] < 1e-6);
  assert.ok(Math.abs(a[2] - 0.5) < 1e-6);   // half way up the lower fade
  assert.equal(a[3], 1);
  assert.equal(a[4], 1);
  assert.equal(a[5], 1);
  assert.ok(Math.abs(a[6] - 0.5) < 1e-6);   // half way down the upper fade
  assert.ok(a[7] < 1e-6);
  assert.equal(a[8], 0);
});

test('softness 0 is a hard cut, and inverting a range mask picks everything else', () => {
  const luma = Float32Array.from([0.2, 0.5, 0.8]);
  const hard = rangeAlpha(makeMask({ kind: 'range', lo: 0.4, hi: 0.6, soft: 0 }), luma);
  assert.deepEqual([...hard], [0, 1, 0]);
  const flipped = rangeAlpha(makeMask({ kind: 'range', lo: 0.4, hi: 0.6, soft: 0, invert: true }), luma);
  assert.deepEqual([...flipped], [1, 0, 1]);
});

test('a range reaching 0 or 1 does not fade away at the ends of the scale', () => {
  const dark = rangeAlpha(makeMask({ kind: 'range', lo: 0, hi: 0.3, soft: 0.2 }), Float32Array.from([0]));
  const bright = rangeAlpha(makeMask({ kind: 'range', lo: 0.7, hi: 1, soft: 0.2 }), Float32Array.from([1]));
  assert.equal(dark[0], 1);
  assert.equal(bright[0], 1);
});

test('a brightness mask only changes the pixels it picks, wherever they are', () => {
  const img = fromFn(40, 4, (x, y) => { const v = (x + y) % 2 ? 230 : 25; return [v, v, v]; });   // bright and dark scattered
  const before = cloneImage(img);
  const m = makeMask({ kind: 'range', lo: 0.7, hi: 1, soft: 0.05, adj: { exposure: -1 } });
  applyMasks(img, [m], new AlphaCache(2));
  for (let y = 0; y < 4; y++) for (let x = 0; x < 40; x++) {
    const was = pixel(before, x, y)[0], now = pixel(img, x, y)[0];
    if (was === 25) assert.equal(now, 25); else assert.ok(now < was - 20);
  }
});

test('a brightness mask reads brightness before any mask edits, so masks do not chase each other', () => {
  const img = grey(32);
  const up = makeMask({ adj: { exposure: 2 }, x1: 0, y1: 0, x2: 0, y2: 0, invert: true });     // lifts everything
  const dark = makeMask({ kind: 'range', lo: 0, hi: 0.3, soft: 0, adj: { saturation: 0, exposure: -1 } });
  const alone = cloneImage(img);
  applyMasks(alone, [dark], new AlphaCache(2));
  const both = cloneImage(img);
  applyMasks(both, [up, dark], new AlphaCache(2));
  const lifted = cloneImage(img);
  applyMasks(lifted, [up], new AlphaCache(2));
  // The picked pixels are the ones that were dark in the original, so the same pixels change in both runs.
  for (let x = 0; x < 32; x++) {
    const picked = pixel(alone, x)[0] !== pixel(img, x)[0];
    const pickedAfterLift = pixel(both, x)[0] !== pixel(lifted, x)[0];
    assert.equal(pickedAfterLift, picked, `x=${x}`);
  }
});

test('a neutral brightness mask changes nothing, and the gradient cache refuses brightness masks', () => {
  const img = grey(16), before = cloneImage(img);
  applyMasks(img, [makeMask({ kind: 'range', lo: 0, hi: 1 })], new AlphaCache(2));
  assert.equal(maxDiff(img, before), 0);
  assert.throws(() => new AlphaCache(2).get(makeMask({ kind: 'range' }), 4, 4));
});

test('range starters are valid, bounded and not neutral', () => {
  for (const s of RANGE_STARTERS) {
    const m = makeMask(s.mask);
    assert.equal(m.kind, 'range', s.id);
    assert.ok(!maskIsNeutral(m), s.id);
    assert.ok(m.lo >= 0 && m.hi <= 1 && m.lo < m.hi && m.soft >= 0 && m.soft <= 0.5, s.id);
  }
  const copy = cloneMasks([makeMask(RANGE_STARTERS[0].mask)])[0];
  assert.equal(copy.kind, 'range');
  assert.equal(copy.lo, RANGE_STARTERS[0].mask.lo);
});

// ---- oval and brush masks ----
import { radialAlpha, brushAlpha, OVAL_STARTERS, BRUSH_STARTERS } from '../src/core/mask.ts';

test('an oval is full in the middle, nothing outside, and softer toward its rim', () => {
  const m = makeMask({ kind: 'radial', x1: 0.5, y1: 0.5, rx: 0.3, ry: 0.3, feather: 0.5 });
  const w = 100, h = 100, a = radialAlpha(m, w, h);
  assert.ok(at(a, w, 50, 50) > 0.999);
  assert.ok(at(a, w, 5, 5) < 0.001);
  const mid = at(a, w, 50, 50 + 22), rim = at(a, w, 50, 50 + 29);
  assert.ok(mid > rim && rim > 0 && rim < 0.2);
  assert.ok(at(a, w, 50, 50 + 31) < 0.001);          // just outside the rim
});

test('an oval is measured in real pixels: radii are fractions of width and height', () => {
  const m = makeMask({ kind: 'radial', x1: 0.5, y1: 0.5, rx: 0.4, ry: 0.2, feather: 0.1 });
  const w = 200, h = 100, a = radialAlpha(m, w, h);
  assert.ok(at(a, w, 100 + 80 - 12, 50) > 0.99 && at(a, w, 100 + 80 + 2, 50) < 0.01);   // 80px across either way
  assert.ok(at(a, w, 100, 50 + 20 - 4) > 0.99 && at(a, w, 100, 50 + 20 + 2) < 0.01); // 20px up and down
  for (let x = 1; x < 100; x++) assert.ok(Math.abs(at(a, w, 100 - x, 50) - at(a, w, 99 + x, 50)) < 1e-6);   // symmetric
});

test('flipping an oval gives its complement, and a feather of 0 does not break it', () => {
  const m = makeMask({ kind: 'radial', rx: 0.25, ry: 0.25, x1: 0.5, y1: 0.5 });
  const n = makeMask({ kind: 'radial', rx: 0.25, ry: 0.25, x1: 0.5, y1: 0.5, invert: true });
  const a = radialAlpha(m, 40, 40), b = radialAlpha(n, 40, 40);
  for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i] + b[i] - 1) < 1e-6);
  assert.ok(radialAlpha(makeMask({ kind: 'radial', feather: 0 }), 10, 10).every((v) => v >= 0 && v <= 1 && !Number.isNaN(v)));
});

const stroke = (pts, over = {}) => ({ pts, size: 0.1, soft: 0.5, erase: false, ...over });

test('a brush stroke paints under the brush and nowhere far from it', () => {
  const m = makeMask({ kind: 'brush', strokes: [stroke([0.5, 0.5])] });
  const w = 100, h = 100, a = brushAlpha(m, w, h);
  assert.ok(at(a, w, 50, 50) > 0.99);
  assert.ok(at(a, w, 50, 50 + 4) > 0.5);
  assert.equal(at(a, w, 50 + 12, 50), 0);
  assert.equal(at(a, w, 5, 5), 0);
});

test('a dragged stroke is continuous between its points', () => {
  const m = makeMask({ kind: 'brush', strokes: [stroke([0.1, 0.5, 0.9, 0.5], { size: 0.05, soft: 0 })] });
  const w = 100, h = 100, a = brushAlpha(m, w, h);
  for (let x = 10; x <= 90; x++) assert.equal(at(a, w, x, 50), 1, `x=${x}`);
  assert.equal(at(a, w, 50, 70), 0);
});

test('erasing takes paint away, only where the eraser went, and overlapping paint never exceeds 1', () => {
  const paint = stroke([0.2, 0.5, 0.8, 0.5], { size: 0.08, soft: 0 });
  const rub = stroke([0.5, 0.5], { size: 0.06, soft: 0, erase: true });
  const a = brushAlpha(makeMask({ kind: 'brush', strokes: [paint, rub] }), 100, 100);
  assert.equal(at(a, 100, 50, 50), 0);
  assert.equal(at(a, 100, 25, 50), 1);
  const twice = brushAlpha(makeMask({ kind: 'brush', strokes: [paint, paint] }), 100, 100);
  assert.ok(twice.every((v) => v >= 0 && v <= 1));
  assert.equal(at(twice, 100, 25, 50), 1);
  // order matters: erasing first leaves the later paint intact
  const reorder = brushAlpha(makeMask({ kind: 'brush', strokes: [rub, paint] }), 100, 100);
  assert.equal(at(reorder, 100, 50, 50), 1);
});

test('a brush mask covers the same part of the photo at any preview size', () => {
  const m = makeMask({ kind: 'brush', strokes: [stroke([0.3, 0.4, 0.7, 0.6], { size: 0.07, soft: 0.4 })] });
  const share = (w, h) => brushAlpha(m, w, h).reduce((s, v) => s + v, 0) / (w * h);
  assert.ok(Math.abs(share(80, 60) - share(320, 240)) < 0.01);
});

test('flipping a brush mask gives everything that was not painted, and no strokes means nothing painted', () => {
  const m = makeMask({ kind: 'brush', strokes: [stroke([0.5, 0.5])] });
  const n = makeMask({ kind: 'brush', strokes: [stroke([0.5, 0.5])], invert: true });
  const a = brushAlpha(m, 30, 30), b = brushAlpha(n, 30, 30);
  for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i] + b[i] - 1) < 1e-6);
  assert.ok(brushAlpha(makeMask({ kind: 'brush' }), 10, 10).every((v) => v === 0));
});

test('the cache keeps oval and brush maps apart and notices a new stroke or a moved oval', () => {
  const c = new AlphaCache(8);
  const b = makeMask({ kind: 'brush', strokes: [stroke([0.5, 0.5])] });
  const first = c.get(b, 20, 20);
  assert.equal(c.get(b, 20, 20), first);
  const more = { ...b, strokes: [...b.strokes, stroke([0.2, 0.2])] };
  assert.notEqual(c.get(more, 20, 20), first);
  const bigger = { ...b, strokes: [stroke([0.5, 0.5], { size: 0.2 })] };
  assert.notEqual(c.get(bigger, 20, 20), first);
  const o = makeMask({ kind: 'radial' });
  const oa = c.get(o, 20, 20);
  assert.equal(c.get(o, 20, 20), oa);
  assert.notEqual(c.get({ ...o, rx: 0.4 }, 20, 20), oa);
  assert.notEqual(c.get({ ...o, feather: 0.9 }, 20, 20), oa);
  assert.notEqual(c.get({ ...o, invert: true }, 20, 20), oa);
});

test('oval and brush masks edit through applyMasks like the others', () => {
  const img = solid(40, 40, 120, 120, 120);
  const o = makeMask({ kind: 'radial', x1: 0.5, y1: 0.5, rx: 0.2, ry: 0.2, feather: 0.1, adj: { exposure: 1 } });
  applyMasks(img, [o], new AlphaCache(2));
  assert.ok(pixel(img, 20, 20)[0] > 150);
  assert.equal(pixel(img, 2, 2)[0], 120);
  const img2 = solid(40, 40, 120, 120, 120);
  const b = makeMask({ kind: 'brush', strokes: [stroke([0.25, 0.25], { size: 0.1, soft: 0 })], adj: { exposure: 1 } });
  applyMasks(img2, [b], new AlphaCache(2));
  assert.ok(pixel(img2, 10, 10)[0] > 150);
  assert.equal(pixel(img2, 35, 35)[0], 120);
});

test('cloning a brush mask copies its strokes, and the new starters are valid', () => {
  const list = [makeMask({ kind: 'brush', strokes: [stroke([0.1, 0.1, 0.2, 0.2])], adj: { exposure: 0.3 } })];
  const copy = cloneMasks(list);
  copy[0].strokes[0].pts[0] = 0.9; copy[0].strokes.push(stroke([0.5, 0.5]));
  assert.equal(list[0].strokes.length, 1);
  assert.equal(list[0].strokes[0].pts[0], 0.1);
  for (const s of [...OVAL_STARTERS, ...BRUSH_STARTERS]) {
    const m = makeMask(s.mask);
    assert.ok(!maskIsNeutral(m), s.id);
    if (m.kind === 'radial') assert.ok(m.rx > 0 && m.ry > 0 && m.x1 >= 0 && m.x1 <= 1 && m.feather > 0 && m.feather <= 1, s.id);
  }
});

test('brush size is a fraction of the photo width, even on a wide or tall photo', () => {
  const m = makeMask({ kind: 'brush', strokes: [stroke([0.5, 0.5], { size: 0.1, soft: 0 })] });
  const wide = brushAlpha(m, 200, 50);       // radius 20px
  assert.equal(at(wide, 200, 100 + 18, 25), 1);
  assert.equal(at(wide, 200, 100 + 22, 25), 0);
  const tall = brushAlpha(m, 50, 200);       // radius 5px
  assert.equal(at(tall, 50, 25 + 3, 100), 1);
  assert.equal(at(tall, 50, 25 + 8, 100), 0);
  assert.equal(at(tall, 50, 25, 100 + 8), 0);
});

test('the cache tells a painted stroke from an erase stroke over the same points', () => {
  const c = new AlphaCache(4);
  const painted = makeMask({ kind: 'brush', strokes: [stroke([0.5, 0.5])] });
  const erased = { ...painted, strokes: [stroke([0.5, 0.5], { erase: true })] };
  assert.notEqual(c.get(painted, 20, 20), c.get(erased, 20, 20));
});

test('a tilted oval turns about its centre: 90 degrees swaps its width and height', () => {
  const w = 100, h = 100;
  const flat = makeMask({ kind: 'radial', x1: 0.5, y1: 0.5, rx: 0.4, ry: 0.1, feather: 0.05 });
  const turned = makeMask({ kind: 'radial', x1: 0.5, y1: 0.5, rx: 0.4, ry: 0.1, feather: 0.05, angle: Math.PI / 2 });
  const a = radialAlpha(flat, w, h), b = radialAlpha(turned, w, h);
  assert.ok(at(a, w, 80, 50) > 0.99 && at(a, w, 50, 80) < 0.01);   // wide
  assert.ok(at(b, w, 50, 80) > 0.99 && at(b, w, 80, 50) < 0.01);   // now tall
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) assert.ok(Math.abs(at(b, w, x, y) - at(a, w, y, x)) < 1e-5);
});

test('a 45 degree oval lies along the diagonal and is symmetric about its centre', () => {
  const m = makeMask({ kind: 'radial', x1: 0.5, y1: 0.5, rx: 0.4, ry: 0.08, feather: 0.1, angle: Math.PI / 4 });
  const w = 100, h = 100, a = radialAlpha(m, w, h);
  assert.ok(at(a, w, 70, 70) > 0.99);       // down-right along the long axis
  assert.ok(at(a, w, 30, 30) > 0.99);
  assert.ok(at(a, w, 70, 30) < 0.01);       // across it
  assert.ok(at(a, w, 30, 70) < 0.01);
  for (let i = 1; i < 40; i++) assert.ok(Math.abs(at(a, w, 50 + i, 50 + i / 2) - at(a, w, 49 - i, 49 - i / 2)) < 1e-5);
});

test('the cache notices a rotated oval, and ten masks are allowed', () => {
  const c = new AlphaCache(4);
  const o = makeMask({ kind: 'radial' });
  assert.notEqual(c.get({ ...o, angle: 0.5 }, 20, 20), c.get(o, 20, 20));
  assert.equal(MAX_MASKS, 10);
});

test('a mask that selects nothing leaves the photo untouched', () => {
  const img = solid(20, 20, 100, 100, 100), before = cloneImage(img);
  applyMasks(img, [makeMask({ kind: 'brush', adj: { exposure: 2 } }), makeMask({ kind: 'radial', x1: 5, y1: 5, rx: 0.1, ry: 0.1, adj: { exposure: 2 } })], new AlphaCache(4));
  assert.equal(maxDiff(img, before), 0);
});
