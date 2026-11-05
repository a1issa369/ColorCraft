import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAdjustments, makeAdjustments, combine, isNeutral, DEFAULTS } from '../src/core/adjust.js';
import { SRGB_TO_LIN, rgb8ToLab } from '../src/core/color.js';
import { solid, fromFn, pixel, maxDiff, randomImage, rng } from './helpers.js';

const adj = (o) => makeAdjustments(o);
const lum = ([r, g, b]) => 0.2126 * SRGB_TO_LIN[Math.round(r)] + 0.7152 * SRGB_TO_LIN[Math.round(g)] + 0.0722 * SRGB_TO_LIN[Math.round(b)];
const chroma = ([r, g, b]) => { const lab = [0, 0, 0]; rgb8ToLab(Math.round(r), Math.round(g), Math.round(b), lab); return Math.hypot(lab[1], lab[2]); };

test('neutral adjustments leave the picture alone (within one level)', () => {
  const img = randomImage(40, 40, 1);
  assert.ok(isNeutral(adj({})));
  assert.ok(maxDiff(applyAdjustments(img, adj({})), img) <= 1);
});

test('the source image is never modified', () => {
  const img = randomImage(16, 16, 2);
  const copy = new Uint8ClampedArray(img.data);
  applyAdjustments(img, adj({ exposure: 1, contrast: 40, saturation: 30, temperature: 50, fade: 0.5 }));
  assert.deepEqual(img.data, copy);
});

test('alpha is preserved', () => {
  const img = solid(4, 4, 100, 100, 100);
  img.data[3] = 77;
  assert.equal(applyAdjustments(img, adj({ exposure: 1 })).data[3], 77);
});

test('+1 stop doubles linear light and -1 stop halves it', () => {
  const img = solid(2, 2, 90, 90, 90);
  const base = lum(pixel(img));
  assert.ok(Math.abs(lum(pixel(applyAdjustments(img, adj({ exposure: 1 })))) / base - 2) < 0.04);
  assert.ok(Math.abs(lum(pixel(applyAdjustments(img, adj({ exposure: -1 })))) / base - 0.5) < 0.02);
});

test('exposure is monotonic', () => {
  const img = solid(2, 2, 100, 100, 100);
  let prev = -1;
  for (let ev = -2; ev <= 2; ev += 0.25) {
    const v = pixel(applyAdjustments(img, adj({ exposure: ev })))[0];
    assert.ok(v >= prev);
    prev = v;
  }
});

test('contrast leaves middle grey where it is, deepens darks and brightens lights', () => {
  const mid = Math.round(0.5 * 255);
  const out = (v, c) => pixel(applyAdjustments(solid(2, 2, v, v, v), adj({ contrast: c })))[0];
  assert.ok(Math.abs(out(mid, 60) - mid) <= 1.5);
  assert.ok(out(60, 60) < 60);
  assert.ok(out(200, 60) > 200);
  assert.ok(out(60, -60) > 60);
  assert.ok(out(200, -60) < 200);
});

test('contrast never creates values outside 0..255 and keeps black and white', () => {
  for (const c of [-100, 100]) {
    assert.equal(pixel(applyAdjustments(solid(2, 2, 0, 0, 0), adj({ contrast: c })))[0], 0);
    assert.equal(pixel(applyAdjustments(solid(2, 2, 255, 255, 255), adj({ contrast: c })))[0], 255);
  }
});

test('pulling highlights down darkens bright pixels far more than dark ones', () => {
  const out = (v) => pixel(applyAdjustments(solid(2, 2, v, v, v), adj({ highlights: -80 })))[0];
  assert.ok(240 - out(240) > 15);
  assert.ok(Math.abs(40 - out(40)) < 3);
});

test('lifting shadows brightens dark pixels far more than bright ones', () => {
  const out = (v) => pixel(applyAdjustments(solid(2, 2, v, v, v), adj({ shadows: 80 })))[0];
  assert.ok(out(40) - 40 > 15);
  assert.ok(Math.abs(out(235) - 235) < 3);
});

test('warming raises red and lowers blue without changing brightness much', () => {
  const img = solid(2, 2, 128, 128, 128);
  const warm = pixel(applyAdjustments(img, adj({ temperature: 60 })));
  const cool = pixel(applyAdjustments(img, adj({ temperature: -60 })));
  assert.ok(warm[0] > warm[2] + 20);
  assert.ok(cool[2] > cool[0] + 20);
  assert.ok(Math.abs(lum(warm) / lum([128, 128, 128]) - 1) < 0.03);
  assert.ok(Math.abs(lum(cool) / lum([128, 128, 128]) - 1) < 0.03);
});

test('positive tint adds magenta (less green), negative adds green', () => {
  const img = solid(2, 2, 128, 128, 128);
  const mag = pixel(applyAdjustments(img, adj({ tint: 60 })));
  const grn = pixel(applyAdjustments(img, adj({ tint: -60 })));
  assert.ok(mag[1] < mag[0] && mag[1] < mag[2]);
  assert.ok(grn[1] > grn[0] && grn[1] > grn[2]);
});

test('saturation -100 gives grey and positive saturation adds colour', () => {
  const img = solid(2, 2, 200, 90, 60);
  const [r, g, b] = pixel(applyAdjustments(img, adj({ saturation: -100 })));
  assert.ok(Math.abs(r - g) <= 1 && Math.abs(g - b) <= 1);
  assert.ok(chroma(pixel(applyAdjustments(img, adj({ saturation: 40 })))) > chroma(pixel(img)));
  assert.ok(chroma(pixel(applyAdjustments(img, adj({ saturation: -40 })))) < chroma(pixel(img)));
});

test('fade lifts pure black', () => {
  const v = pixel(applyAdjustments(solid(2, 2, 0, 0, 0), adj({ fade: 1 })))[0];
  assert.ok(v >= 24 && v <= 27, `got ${v}`);
  assert.equal(pixel(applyAdjustments(solid(2, 2, 0, 0, 0), adj({ fade: 0 })))[0], 0);
});

test('split toning tints the shadows without touching the highlights', () => {
  const tone = adj({ splitShadow: { hue: 210, amount: 1 } });
  const dark = pixel(applyAdjustments(solid(2, 2, 40, 40, 40), tone));
  const bright = pixel(applyAdjustments(solid(2, 2, 235, 235, 235), tone));
  assert.ok(dark[2] > dark[0] + 5, `dark ${dark}`);
  assert.ok(Math.abs(bright[2] - bright[0]) < 3, `bright ${bright}`);
});

test('split toning of the highlights tints bright pixels toward the chosen hue', () => {
  const tone = adj({ splitHighlight: { hue: 35, amount: 1 } });
  const bright = pixel(applyAdjustments(solid(2, 2, 200, 200, 200), tone));
  const dark = pixel(applyAdjustments(solid(2, 2, 30, 30, 30), tone));
  assert.ok(bright[0] > bright[2] + 5, `bright ${bright}`);
  assert.ok(Math.abs(dark[0] - dark[2]) < 3, `dark ${dark}`);
});

test('combine: strength 0 is the base, 1 adds the look, 0.5 adds half', () => {
  const base = adj({ exposure: 0.2, contrast: 10 });
  const look = { contrast: 20, saturation: -10, splitShadow: { hue: 200, amount: 0.6 } };
  assert.equal(combine(base, look, 0).contrast, 10);
  assert.equal(combine(base, look, 1).contrast, 30);
  assert.equal(combine(base, look, 0.5).contrast, 20);
  assert.equal(combine(base, look, 0.5).saturation, -5);
  assert.equal(combine(base, look, 0.5).splitShadow.amount, 0.3);
  assert.equal(combine(base, look, 1).exposure, 0.2);
  assert.equal(combine(base, null, 1).contrast, 10);
});

test('combine clamps strength and does not mutate its inputs', () => {
  const base = adj({});
  combine(base, { contrast: 50 }, 9);
  assert.equal(base.contrast, 0);
  assert.equal(combine(base, { contrast: 50 }, 9).contrast, 50);
  assert.equal(combine(base, { contrast: 50 }, -3).contrast, 0);
  assert.equal(DEFAULTS.contrast, 0);
});

test('extreme settings never throw and always give valid pixels', () => {
  const r = rng(11);
  const img = randomImage(24, 24, 5);
  for (let i = 0; i < 40; i++) {
    const out = applyAdjustments(img, adj({
      exposure: (r() - 0.5) * 6, contrast: (r() - 0.5) * 200, highlights: (r() - 0.5) * 200, shadows: (r() - 0.5) * 200,
      temperature: (r() - 0.5) * 200, tint: (r() - 0.5) * 200, saturation: (r() - 0.5) * 200, fade: r(),
      splitShadow: { hue: r() * 360, amount: r() }, splitHighlight: { hue: r() * 360, amount: r() },
    }));
    assert.equal(out.data.length, img.data.length);
  }
});

test('works on a one pixel image and an empty one', () => {
  assert.equal(applyAdjustments(solid(1, 1, 10, 20, 30), adj({ exposure: 1 })).data.length, 4);
  assert.equal(applyAdjustments({ width: 0, height: 0, data: new Uint8ClampedArray(0) }, adj({})).data.length, 0);
});

test('adjusting a gradient keeps it ordered (no tone inversions)', () => {
  const ramp = fromFn(64, 2, (x) => { const v = (x / 63) * 255; return [v, v, v]; });
  const out = applyAdjustments(ramp, adj({ contrast: 50, highlights: -30, shadows: 30, exposure: 0.3 }));
  let prev = -1;
  for (let x = 0; x < 64; x++) {
    const v = pixel(out, x, 0)[0];
    assert.ok(v >= prev - 1, `inversion at ${x}`);
    prev = v;
  }
});

test('contrast curve is smooth and monotonic and keeps mid grey fixed', () => {
  const ramp = fromFn(256, 1, (x) => [x, x, x]);
  for (const c of [-80, 60, 100]) {
    const out = applyAdjustments(ramp, makeAdjustments({ contrast: c }));
    let prev = -1;
    for (let x = 0; x < 256; x++) {
      const v = out.data[x * 4];
      assert.ok(v >= prev, `contrast ${c}: not monotonic at ${x}`);
      assert.ok(x < 3 || x > 252 || v - prev <= 8, `contrast ${c}: jump of ${v - prev} at ${x}`);
      prev = v;
    }
    assert.ok(Math.abs(out.data[128 * 4] - 128) <= 3, `contrast ${c}: mid grey moved to ${out.data[128 * 4]}`);
  }
});

test('a colour pushed past the screen gamut keeps its brightness instead of clipping flat', async () => {
  const { makeImage } = await import('../src/core/image.js');
  const img = makeImage(1, 1);
  img.data.set([40, 70, 230, 255]);
  const out = applyAdjustments(img, makeAdjustments({ exposure: 0.8, saturation: 40 }));
  const [r, g, b] = out.data;
  assert.ok(b <= 255 && r >= 0);
  assert.ok(b >= g && g >= r, `channel order lost: ${r},${g},${b}`);
  // Hard clipping chops the blue and lands near luma 91; pulling toward grey keeps it near 96.
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  assert.ok(luma >= 94, `brightness was lost to clipping: luma ${luma.toFixed(1)}`);
});

test('brightening a vivid ramp does not collapse it into a few flat values', async () => {
  const { makeImage } = await import('../src/core/image.js');
  const img = makeImage(1, 128);
  for (let y = 0; y < 128; y++) img.data.set([Math.round(40 + y * 0.4), Math.round(60 + y * 0.5), Math.round(130 + y), 255], y * 4);
  const out = applyAdjustments(img, makeAdjustments({ exposure: 0.8, saturation: 40, contrast: 20 }));
  const seen = new Set();
  for (let y = 0; y < 128; y++) seen.add(`${out.data[y * 4]},${out.data[y * 4 + 1]},${out.data[y * 4 + 2]}`);
  assert.ok(seen.size >= 103, `only ${seen.size} distinct colours survived`);
});
