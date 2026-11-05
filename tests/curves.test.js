import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSpline, curveLut, channelLuts, lutLookup, scaleCurve, composePoints, simplify, simplifyTo, identityCurves, curvesAreIdentity, CURVE_STEPS } from '../src/core/curves.js';
import { applyAdjustments, makeAdjustments, combine, isNeutral } from '../src/core/adjust.js';
import { solid, fromFn, greyRamp, pixel } from './helpers.js';

test('a straight two point curve is the identity', () => {
  const f = makeSpline([[0, 0], [1, 1]]);
  for (const x of [0, 0.13, 0.5, 0.99, 1]) assert.ok(Math.abs(f(x) - x) < 1e-9);
});

test('the spline passes through every control point', () => {
  const pts = [[0, 0.05], [0.25, 0.18], [0.6, 0.7], [1, 0.95]];
  const f = makeSpline(pts);
  for (const [x, y] of pts) assert.ok(Math.abs(f(x) - y) < 1e-9, `at ${x}`);
});

test('the spline never overshoots or goes backwards, even for an aggressive S', () => {
  const f = makeSpline([[0, 0], [0.2, 0.02], [0.5, 0.5], [0.8, 0.98], [1, 1]]);
  let prev = -1;
  for (let i = 0; i <= 1000; i++) {
    const y = f(i / 1000);
    assert.ok(y >= prev - 1e-12, `dropped at ${i / 1000}`);
    assert.ok(y >= 0 && y <= 1);
    prev = y;
  }
});

test('points given out of order still make a valid curve', () => {
  const f = makeSpline([[1, 1], [0.5, 0.3], [0, 0]]);
  assert.ok(Math.abs(f(0.5) - 0.3) < 1e-9);
});

test('a curve that does not reach the edges is extended flat to them', () => {
  const f = makeSpline([[0.2, 0.3], [0.8, 0.7]]);
  assert.ok(Math.abs(f(0) - 0.3) < 1e-9);
  assert.ok(Math.abs(f(1) - 0.7) < 1e-9);
});

test('curveLut has the expected size and endpoints', () => {
  const lut = curveLut([[0, 0.1], [1, 0.9]]);
  assert.equal(lut.length, CURVE_STEPS + 1);
  assert.ok(Math.abs(lut[0] - 0.1) < 1e-6 && Math.abs(lut[CURVE_STEPS] - 0.9) < 1e-6);
});

test('channelLuts is null for straight curves and runs the RGB curve before the channel curve', () => {
  assert.equal(channelLuts(identityCurves()), null);
  const c = identityCurves();
  c.rgb = [[0, 0], [0.5, 0.25], [1, 1]];       // darkens mid grey
  c.r = [[0, 0], [0.25, 0.5], [1, 1]];         // then brightens the red channel at 0.25
  const luts = channelLuts(c);
  // x = 0.5: rgb curve gives 0.25, then the red curve maps 0.25 to 0.5
  assert.ok(Math.abs(lutLookup(luts[0], 0.5) - 0.5) < 0.01, `${lutLookup(luts[0], 0.5)}`);
  assert.ok(Math.abs(lutLookup(luts[1], 0.5) - 0.25) < 0.01);
});

test('scaleCurve blends toward a straight line', () => {
  const pts = [[0, 0], [0.5, 0.8], [1, 1]];
  assert.deepEqual(scaleCurve(pts, 0), [[0, 0], [0.5, 0.5], [1, 1]]);
  assert.deepEqual(scaleCurve(pts, 1), pts);
  assert.ok(Math.abs(scaleCurve(pts, 0.5)[1][1] - 0.65) < 1e-9);
});

test('composePoints is "first A, then B"', () => {
  const a = [[0, 0], [0.5, 0.25], [1, 1]];
  const b = [[0, 0], [0.25, 0.5], [1, 1]];
  const c = makeSpline(composePoints(a, b));
  assert.ok(Math.abs(c(0.5) - 0.5) < 0.02, `${c(0.5)}`);
});

test('simplify drops points on a straight line but keeps a real bend', () => {
  assert.equal(simplify([[0, 0], [0.5, 0.5], [1, 1]]).length, 2);
  assert.equal(simplify([[0, 0], [0.5, 0.8], [1, 1]]).length, 3);
});

test('the RGB curve brightens all channels; a red curve changes only red', () => {
  const grey = solid(4, 4, 100, 100, 100);
  const lift = identityCurves(); lift.rgb = [[0, 0], [0.4, 0.6], [1, 1]];
  const out = pixel(applyAdjustments(grey, makeAdjustments({ curves: lift })), 0, 0);
  assert.ok(out[0] > 100 && out[1] > 100 && out[2] > 100);
  assert.equal(out[0], out[1]);
  const redOnly = identityCurves(); redOnly.r = [[0, 0], [0.4, 0.6], [1, 1]];
  const o2 = pixel(applyAdjustments(grey, makeAdjustments({ curves: redOnly })), 0, 0);
  assert.ok(o2[0] > 100);
  assert.equal(o2[1], 100);
  assert.equal(o2[2], 100);
});

test('a curve that pulls the blacks up fades the photo, and one pushing them down crushes it', () => {
  const ramp = greyRamp(64, 2, 0, 255);
  const fade = identityCurves(); fade.rgb = [[0, 0.15], [1, 1]];
  assert.ok(pixel(applyAdjustments(ramp, makeAdjustments({ curves: fade })), 0, 0)[0] >= 36);
  const crush = identityCurves(); crush.rgb = [[0, 0], [0.3, 0], [1, 1]];
  assert.equal(pixel(applyAdjustments(ramp, makeAdjustments({ curves: crush })), 10, 0)[0] <= 2, true);
});

test('curves are part of what makes an adjustment non-neutral, and are copied, not shared', () => {
  assert.ok(isNeutral(makeAdjustments()));
  const c = identityCurves(); c.g = [[0, 0], [0.5, 0.6], [1, 1]];
  const a = makeAdjustments({ curves: c });
  assert.ok(!isNeutral(a));
  c.g[1][1] = 0.9;
  assert.equal(a.curves.g[1][1], 0.6);
  assert.ok(curvesAreIdentity(identityCurves()));
});

test('a look curve is scaled by strength and stays separate from the user curves', () => {
  const user = identityCurves(); user.rgb = [[0, 0], [0.5, 0.4], [1, 1]];
  const look = { curves: { rgb: [[0, 0.1], [1, 1]] } };
  const half = combine(makeAdjustments({ curves: user }), look, 0.5);
  assert.deepEqual(half.curves.rgb, user.rgb);
  assert.ok(Math.abs(half.lookCurves.rgb[0][1] - 0.05) < 1e-9);
  const none = combine(makeAdjustments(), look, 0);
  assert.ok(curvesAreIdentity(none.lookCurves));
});

test('simplifyTo never returns more than the requested number of points but keeps the endpoints', () => {
  const wiggly = Array.from({ length: 40 }, (_, i) => [i / 39, i / 39 + 0.05 * Math.sin(i)]);
  const out = simplifyTo(wiggly, 5);
  assert.ok(out.length <= 5);
  assert.deepEqual(out[0], wiggly[0]);
  assert.deepEqual(out[out.length - 1], wiggly[39]);
});
