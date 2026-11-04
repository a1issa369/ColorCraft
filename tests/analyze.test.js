import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../src/core/analyze.js';
import { solid, fromFn, greyRamp } from './helpers.js';

test('mid grey is neutral, unclipped and has no colour', () => {
  const s = analyze(solid(32, 32, 119, 119, 119));
  assert.ok(Math.abs(s.median - 0.467) < 0.02, `median ${s.median}`);
  assert.equal(s.shadowClip, 0);
  assert.equal(s.highlightClip, 0);
  assert.ok(s.chroma < 0.5);
  assert.ok(s.cast.magnitude < 0.5);
  assert.equal(s.cast.reliable, true);
});

test('all black is fully crushed and all white fully blown', () => {
  assert.equal(analyze(solid(16, 16, 0, 0, 0)).shadowClip, 1);
  assert.equal(analyze(solid(16, 16, 255, 255, 255)).highlightClip, 1);
  assert.equal(analyze(solid(16, 16, 0, 0, 0)).highlightClip, 0);
});

test('highlight clipping counts a single saturated channel', () => {
  assert.equal(analyze(solid(16, 16, 255, 120, 120)).highlightClip, 1);
});

test('the share of clipped pixels is measured correctly', () => {
  const img = fromFn(100, 10, (x) => (x < 30 ? [0, 0, 0] : [128, 128, 128]));
  assert.ok(Math.abs(analyze(img).shadowClip - 0.3) < 1e-9);
});

test('a warm tint gives positive b and a cool tint negative b', () => {
  const ramp = (r, g, b) => fromFn(128, 8, (x) => { const v = 60 + x; return [v * r, v * g, v * b]; });
  assert.ok(analyze(ramp(1.15, 1.0, 0.85)).cast.b > 6);
  assert.ok(analyze(ramp(0.85, 1.0, 1.15)).cast.b < -6);
});

test('a green tint gives negative a and a magenta tint positive a', () => {
  const ramp = (r, g, b) => fromFn(128, 8, (x) => { const v = 60 + x; return [v * r, v * g, v * b]; });
  assert.ok(analyze(ramp(1.0, 1.18, 1.0)).cast.a < -6);
  assert.ok(analyze(ramp(1.1, 0.88, 1.1)).cast.a > 6);
});

test('a photo that is almost all very dark gives no cast at all (nothing to judge from)', () => {
  const s = analyze(solid(32, 32, 8, 6, 12));
  assert.equal(s.cast.reliable, false);
  assert.equal(s.cast.magnitude, 0);
});

test('spread and percentiles follow the tonal range', () => {
  const s = analyze(greyRamp(256, 4, 0, 255));
  assert.ok(s.spread > 0.8, `spread ${s.spread}`);
  assert.ok(s.p1 <= s.p5 && s.p5 <= s.median && s.median <= s.p95 && s.p95 <= s.p99);
  const flat = analyze(greyRamp(256, 4, 110, 150));
  assert.ok(flat.spread < 0.2);
});

test('saturated pixels raise the chroma measure', () => {
  assert.ok(analyze(solid(16, 16, 220, 40, 40)).chroma > 60);
  assert.ok(analyze(solid(16, 16, 128, 128, 128)).chroma < 1);
});

test('histograms are normalised and the chroma grid counts every in-range pixel once', () => {
  const s = analyze(greyRamp(64, 8));
  for (const h of [s.hist.luma, s.hist.r, s.hist.g, s.hist.b]) {
    assert.ok(Math.abs(h.reduce((a, b) => a + b, 0) - 1) < 1e-4);
  }
  assert.equal(s.chromaGrid.reduce((a, b) => a + b, 0), 64 * 8);
});

test('an empty image does not crash', () => {
  const s = analyze({ width: 0, height: 0, data: new Uint8ClampedArray(0) });
  assert.equal(s.pixels, 0);
  assert.equal(s.shadowClip, 0);
});

test('colour spread is near zero for one tint over a grey ramp and large for varied colours', () => {
  const sepia = fromFn(128, 8, (x) => { const v = 40 + x; return [v * 1.1, v, v * 0.85]; });
  assert.ok(analyze(sepia).colorSpread < 0.6 * analyze(sepia).chroma, `${analyze(sepia).colorSpread}`);
  const varied = fromFn(90, 8, (x) => [[200, 80, 70], [70, 170, 90], [70, 90, 200]][x % 3]);
  assert.ok(analyze(varied).colorSpread > 20);
});

test('a large patch of vivid colour does not drag the cast estimate with it', () => {
  // 70% faintly warm neutrals, 30% strongly saturated blue. Soft weighting keeps the estimate near the neutrals.
  const img = fromFn(100, 10, (x) => (x < 70 ? [134, 128, 122] : [20, 60, 230]));
  const c = analyze(img).cast;
  assert.ok(c.reliable);
  assert.ok(c.b > -12, `blue patch dominated the cast: b=${c.b.toFixed(1)}`);
});
