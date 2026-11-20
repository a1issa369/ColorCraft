import test from 'node:test';
import assert from 'node:assert/strict';
import { closeness, closenessOf, describeGaps, describeLook, dialScore, distances, tintName, toneDistance, traitsOf, DIALS } from '../src/core/matchscore.ts';
import { lookProfile } from '../src/core/transfer.ts';
import { applyAdjustments, makeAdjustments } from '../src/core/adjust.ts';
import { fromFn, randomImage } from './helpers.ts';

const scene = (seed: number) => randomImage(96, 64, seed);
const graded = (img: ReturnType<typeof scene>, adj: Parameters<typeof makeAdjustments>[0]) => applyAdjustments(img, makeAdjustments(adj));

test('a photo is perfectly close to itself, on every dial', () => {
  const p = lookProfile(scene(1));
  const c = closeness(p, p);
  assert.equal(c.overall, 100);
  for (const id of DIALS) assert.equal(c.dials[id], 100, id);
});

test('each dial reacts to the thing it is named for and mostly to nothing else', () => {
  const img = scene(2), ref = lookProfile(img);
  const bright = closeness(lookProfile(graded(img, { exposure: 0.9 })), ref);
  const warm = closeness(lookProfile(graded(img, { temperature: 60 })), ref);
  const vivid = closeness(lookProfile(graded(img, { saturation: 80 })), ref);
  assert.ok(bright.dials.brightness < 70 && bright.dials.brightness < bright.dials.shadowTint);
  assert.ok(warm.dials.warmth < 70 && warm.dials.warmth < warm.dials.brightness);
  assert.ok(vivid.dials.colour < 80 && vivid.dials.colour < vivid.dials.brightness);
});

test('a bigger difference always scores lower, and scores stay between 0 and 100', () => {
  const img = scene(3), ref = lookProfile(img);
  const scores = [0, 0.3, 0.6, 1, 1.6].map((e) => closeness(lookProfile(graded(img, { exposure: e })), ref).overall);
  for (let i = 1; i < scores.length; i++) assert.ok(scores[i] < scores[i - 1], `${scores}`);
  for (const s of scores) assert.ok(s >= 0 && s <= 100);
  assert.equal(dialScore('warmth', 1000), 0);
  assert.equal(dialScore('warmth', 0), 100);
});

test('the overall score is the plain average of the six dials', () => {
  const c = closenessOf({ brightness: 10, contrast: 0, warmth: 0, colour: 0, shadowTint: 0, highlightTint: 0 });
  assert.ok(Math.abs(c.overall - (100 * 5 + 50) / 6) < 1e-9);
});

test('traits read brightness, contrast and colour the way a person would', () => {
  const dark = traitsOf(lookProfile(fromFn(64, 64, (x) => { const v = 20 + (x % 8) * 4; return [v, v, v]; })));
  const light = traitsOf(lookProfile(fromFn(64, 64, (x) => { const v = 190 + (x % 8) * 6; return [v, v, v]; })));
  assert.ok(light.q.p50 > dark.q.p50 + 40);
  const flat = traitsOf(lookProfile(fromFn(64, 64, (x) => { const v = 120 + (x % 4) * 3; return [v, v, v]; })));
  const punchy = traitsOf(lookProfile(fromFn(64, 64, (x) => { const v = (x % 2) ? 230 : 20; return [v, v, v]; })));
  assert.ok(punchy.q.p90 - punchy.q.p10 > flat.q.p90 - flat.q.p10 + 80);
  const warm = traitsOf(lookProfile(fromFn(32, 32, () => [200, 150, 90])));
  const cool = traitsOf(lookProfile(fromFn(32, 32, () => [90, 140, 200])));
  assert.ok(warm.b > 10 && cool.b < -10);
  assert.ok(Math.abs(traitsOf(lookProfile(fromFn(32, 32, () => [128, 128, 128]))).colourful) < 1);
});

test('shadow and highlight tints are read from the dark and bright tones separately', () => {
  // Dark half is blue-ish, bright half is orange-ish.
  const img = fromFn(64, 32, (x) => (x < 32 ? [20, 40, 90] : [240, 200, 140]));
  const t = traitsOf(lookProfile(img));
  assert.ok(t.shadow[1] < -5, `shadow b ${t.shadow[1]}`);
  assert.ok(t.highlight[1] > 5, `highlight b ${t.highlight[1]}`);
  assert.equal(tintName(0, 20), 'yellow');
  assert.equal(tintName(0, -20), 'blue');
  assert.equal(tintName(20, 0), 'pink');
  assert.equal(tintName(-20, 0), 'green');
  assert.equal(tintName(0.5, 0.5), '');
});

test('plain-English gaps name the biggest difference first, and say nothing when the photos match', () => {
  const img = scene(4), p = lookProfile(img);
  assert.deepEqual(describeGaps(traitsOf(p), traitsOf(p)), []);
  const ref = traitsOf(p), user = traitsOf(lookProfile(graded(img, { exposure: -0.8, temperature: -20 })));
  const gaps = describeGaps(user, ref);
  assert.ok(gaps.length >= 2);
  assert.match(gaps.join(' '), /darker/);
  assert.match(gaps.join(' '), /cooler/);
});

test('a look is described in a short phrase that includes tints when they are strong enough', () => {
  const night = fromFn(64, 32, (x) => (x < 32 ? [10, 30, 60] : [90, 140, 150]));
  const txt = describeLook(traitsOf(lookProfile(night)));
  assert.match(txt, /dark|mid-tone/);
  assert.match(txt, /(blue|teal) (shadows|highlights)/);
});

test('tone distance is zero for the same tones and grows with the gap', () => {
  const img = scene(5), ref = traitsOf(lookProfile(img));
  assert.equal(toneDistance(ref, ref), 0);
  const a = toneDistance(traitsOf(lookProfile(graded(img, { exposure: 0.3 }))), ref);
  const b = toneDistance(traitsOf(lookProfile(graded(img, { exposure: 1 }))), ref);
  assert.ok(a > 0 && b > a);
  assert.equal(distances(ref, ref).brightness, 0);
});
