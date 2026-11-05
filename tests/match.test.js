import test from 'node:test';
import assert from 'node:assert/strict';
import { lookProfile, matchLook, fitCurves } from '../src/core/transfer.js';
import { applyAdjustments, makeAdjustments } from '../src/core/adjust.js';
import { identityCurves, makeSpline } from '../src/core/curves.js';
import { renderCoast } from '../src/core/samples.js';
import { analyze } from '../src/core/analyze.js';
import { fromFn, greyRamp, maxDiff, rng } from './helpers.js';

const coast = renderCoast(200, 134);

test('strength zero for both tone and colour leaves the photo alone', () => {
  const ref = applyAdjustments(coast, makeAdjustments({ exposure: -1, temperature: 60 }));
  const out = matchLook(coast, lookProfile(coast), lookProfile(ref), { tone: 0, color: 0 });
  assert.ok(maxDiff(out, coast) <= 1);
});

test('matching a photo to itself changes almost nothing', () => {
  const p = lookProfile(coast);
  const out = matchLook(coast, p, p, { tone: 1, color: 1 });
  assert.ok(maxDiff(out, coast) <= 6, `max diff ${maxDiff(out, coast)}`);
});

test('tone matching moves a bright photo toward a dark reference, and a dark one toward a bright reference', () => {
  const dark = applyAdjustments(coast, makeAdjustments({ exposure: -1.2 }));
  const bright = applyAdjustments(coast, makeAdjustments({ exposure: 0.8 }));
  const m0 = analyze(coast).median;
  const toDark = analyze(matchLook(coast, lookProfile(coast), lookProfile(dark), { tone: 1, color: 0 })).median;
  const toBright = analyze(matchLook(coast, lookProfile(coast), lookProfile(bright), { tone: 1, color: 0 })).median;
  assert.ok(toDark < m0 - 0.05, `${toDark} vs ${m0}`);
  assert.ok(toBright > m0 + 0.03, `${toBright} vs ${m0}`);
});

test('tone matching only moves lightness; the colour match only moves colour', () => {
  const ref = applyAdjustments(coast, makeAdjustments({ exposure: -1, temperature: -70 }));
  const toneOnly = matchLook(coast, lookProfile(coast), lookProfile(ref), { tone: 1, color: 0 });
  const colorOnly = matchLook(coast, lookProfile(coast), lookProfile(ref), { tone: 0, color: 1 });
  assert.ok(analyze(colorOnly).median > analyze(toneOnly).median, 'colour only should keep the original brightness');
  assert.ok(analyze(colorOnly).cast.b < analyze(coast).cast.b - 1, 'colour match should cool the photo');
});

test('toning is learned per brightness: teal darks and warm lights are carried across', () => {
  // A reference with blue-green shadows and orange highlights, built from a neutral ramp
  const ramp = greyRamp(256, 8, 0, 255);
  const toned = applyAdjustments(ramp, makeAdjustments({ splitShadow: { hue: 190, amount: 1 }, splitHighlight: { hue: 30, amount: 1 } }));
  const ref = fromFn(120, 40, (x, y) => { const v = (x / 119) * 255; return [v, v, v]; });
  const refToned = applyAdjustments(ref, makeAdjustments({ splitShadow: { hue: 190, amount: 1 }, splitHighlight: { hue: 30, amount: 1 } }));
  const grey = greyRamp(256, 8, 0, 255);
  const out = matchLook(grey, lookProfile(grey), lookProfile(refToned), { tone: 0, color: 1 });
  const at = (x) => [out.data[x * 4], out.data[x * 4 + 1], out.data[x * 4 + 2]];
  const dark = at(30), light = at(225);
  assert.ok(dark[2] - dark[0] > 3, `shadows should lean blue/green, got ${dark}`);
  assert.ok(light[0] - light[2] > 3, `highlights should lean warm, got ${light}`);
  assert.ok(toned.width === 256);
});

test('a near-flat photo is not blown up by a very colourful reference (spread is clamped)', () => {
  const flat = fromFn(64, 8, (x) => { const v = 120 + (x % 2); return [v, v, v]; });
  const loud = fromFn(64, 8, (x) => [[230, 40, 40], [40, 200, 60], [50, 60, 230]][x % 3]);
  const out = matchLook(flat, lookProfile(flat), lookProfile(loud), { tone: 0, color: 1 });
  assert.ok(analyze(out).chroma < 45);
});

test('profile of an empty-ish photo does not crash', () => {
  const p = lookProfile(fromFn(1, 1, () => [10, 20, 30]));
  assert.equal(p.bands.length, 6);
  assert.equal(p.samples, 1);
});

test('fitCurves recovers a known curve edit within a small tolerance', () => {
  const photo = renderCoast(160, 107);
  const edit = identityCurves();
  edit.r = [[0, 0], [0.5, 0.62], [1, 1]];
  edit.b = [[0, 0.06], [0.5, 0.44], [1, 0.95]];
  const after = applyAdjustments(photo, makeAdjustments({ curves: edit }));
  const fitted = fitCurves(photo, after);
  const fr = makeSpline(fitted.r), fb = makeSpline(fitted.b), fg = makeSpline(fitted.g);
  const er = makeSpline(edit.r), eb = makeSpline(edit.b);
  for (const x of [0.2, 0.4, 0.6, 0.8]) {
    assert.ok(Math.abs(fr(x) - er(x)) < 0.04, `red at ${x}: ${fr(x)} vs ${er(x)}`);
    assert.ok(Math.abs(fb(x) - eb(x)) < 0.04, `blue at ${x}: ${fb(x)} vs ${eb(x)}`);
    assert.ok(Math.abs(fg(x) - x) < 0.03, `green should stay straight at ${x}`);
  }
});

test('fitted curves are rising, within 0..1 and have few points', () => {
  const rand = rng(5);
  const a = fromFn(60, 60, () => [rand() * 255, rand() * 255, rand() * 255]);
  const b = fromFn(60, 60, () => [rand() * 255, rand() * 255, rand() * 255]);
  const c = fitCurves(a, b);
  for (const k of ['r', 'g', 'b']) {
    assert.ok(c[k].length <= 7, `${k} has ${c[k].length} points`);
    for (let i = 1; i < c[k].length; i++) assert.ok(c[k][i][1] >= c[k][i - 1][1] - 1e-9 && c[k][i][0] > c[k][i - 1][0]);
    for (const [x, y] of c[k]) assert.ok(x >= 0 && x <= 1 && y >= 0 && y <= 1);
  }
});

test('colour match also carries the green to magenta axis', () => {
  const grey = greyRamp(200, 8, 30, 220);
  const magenta = applyAdjustments(grey, makeAdjustments({ tint: 80 }));
  const out = matchLook(grey, lookProfile(grey), lookProfile(magenta), { tone: 0, color: 1 });
  assert.ok(analyze(out).cast.a > analyze(grey).cast.a + 3, `a went from ${analyze(grey).cast.a} to ${analyze(out).cast.a}`);
});

test('fitting an inverted edit gives the best rising line (the average), not a runaway one', () => {
  const ramp = greyRamp(200, 8, 0, 255);
  const inverted = fromFn(200, 8, (x) => { const v = 255 - (x / 199) * 255; return [v, v, v]; });
  const c = fitCurves(ramp, inverted);
  const f = makeSpline(c.r);
  for (const x of [0.3, 0.5, 0.7]) assert.ok(Math.abs(f(x) - 0.5) < 0.15, `at ${x}: ${f(x)}`);
});
