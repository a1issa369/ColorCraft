import test from 'node:test';
import assert from 'node:assert/strict';
import { matchAgent, minimise, findHorizon, cropRows, describeChanges, hueName } from '../src/state/agent.ts';
import type { AgentStep } from '../src/state/agent.ts';
import { makeSettings, cloneSettings } from '../src/state/store.ts';
import { gradeImage } from '../src/state/grade.ts';
import { AlphaCache } from '../src/core/mask.ts';
import * as maskModule from '../src/core/mask.ts';
import { closeness } from '../src/core/matchscore.ts';
import { lookProfile } from '../src/core/transfer.ts';
import { applyAdjustments, makeAdjustments } from '../src/core/adjust.ts';
import { downscale } from '../src/core/image.ts';
import { fromFn, randomImage } from './helpers.ts';

const drain = (g: Generator<AgentStep, any>) => { const steps: AgentStep[] = []; let r = g.next(); while (!r.done) { steps.push(r.value); r = g.next(); } return { steps, result: r.value }; };
const score = (img: any, s: any, ref: any) => closeness(lookProfile(gradeImage(img, s, new AlphaCache(12))), ref.profile).overall;

// A scene with a sky above a clear horizon and ground below, in a chosen palette.
const landscape = (sky: [number, number, number], ground: [number, number, number], w = 200, h = 130) =>
  fromFn(w, h, (x, y) => {
    const t = y / h, n = ((x * 7 + y * 13) % 17) - 8;
    const c = t < 0.5 ? sky.map((v, i) => v * (1 - t * (i === 2 ? 0.2 : 0.5))) : ground.map((v, i) => v * (0.8 + (t - 0.5) * (i === 0 ? 0.5 : 0.3)));
    return c.map((v) => Math.max(0, Math.min(255, v + n)));
  });

test('the search helper never returns something worse than where it started, and finds the dip', () => {
  const f = (x: number) => (x - 3.2) ** 2;
  const best = minimise(f, -10, 10, 0);
  assert.ok(Math.abs(best - 3.2) < 0.15, `${best}`);
  // Starting at the minimum, nothing beats it by enough to move.
  assert.equal(minimise(f, -10, 10, 3.2), 3.2);
  // A flat function leaves the start alone.
  assert.equal(minimise(() => 5, -10, 10, 1.5), 1.5);
});

test('a photo graded wrongly is pulled back toward its reference, step by step', () => {
  const ref = randomImage(120, 80, 7);
  const refP = { profile: lookProfile(ref), thumb: downscale(ref, 120) };
  const wrong = applyAdjustments(ref, makeAdjustments({ exposure: -0.7, contrast: -35, temperature: -30, saturation: -40 }));
  const { steps, result } = drain(matchAgent(wrong, makeSettings(), refP));
  const before = score(wrong, makeSettings(), refP);
  const after = score(wrong, result.settings, refP);
  assert.ok(after > before + 15, `${before} -> ${after}`);
  assert.ok(after > 80, `after ${after}`);
  assert.ok(Math.abs(result.after - after) < 8, 'the agent\'s own reading agrees with an independent measurement');
  assert.equal(steps[0].kind, 'read');
  assert.equal(steps[steps.length - 1].kind, 'verify');
  // It fixed the right things, in the right directions.
  assert.ok(result.settings.adj.exposure > 0.3);
  assert.ok(result.settings.adj.temperature > 8);
});

test('every kept step helped or at least did no harm, every dropped step changed nothing, and each step carries a full snapshot', () => {
  const ref = randomImage(100, 70, 11);
  const refP = { profile: lookProfile(ref), thumb: downscale(ref, 120) };
  const wrong = applyAdjustments(ref, makeAdjustments({ exposure: 0.6, tint: 25, saturation: 50 }));
  const { steps } = drain(matchAgent(wrong, makeSettings(), refP));
  for (const s of steps) {
    assert.ok(s.title && s.why, s.id);
    if (s.kept && s.kind !== 'read' && s.kind !== 'verify') assert.ok(s.after >= s.before - 0.51, `${s.id} ${s.before} -> ${s.after}`);
    if (!s.kept) { assert.deepEqual(s.changes, []); assert.equal(s.after, s.before); }
    assert.ok(s.settings.adj && Array.isArray(s.settings.masks));
  }
  // Snapshots are independent copies, not one object seen many times.
  const adjs = new Set(steps.map((s) => s.settings.adj));
  assert.equal(adjs.size, steps.length);
});

test('the agent never ends worse than it started, and a photo that already matches is left almost alone', () => {
  const ref = randomImage(100, 70, 21);
  const refP = { profile: lookProfile(ref), thumb: downscale(ref, 120) };
  const { result } = drain(matchAgent(ref, makeSettings(), refP));
  assert.ok(result.after >= result.before);
  assert.ok(result.before > 97);
  assert.ok(Math.abs(result.settings.adj.exposure) < 0.3 && Math.abs(result.settings.adj.contrast) < 12);
  const other = randomImage(100, 70, 22);
  const o = drain(matchAgent(other, makeSettings(), refP));
  assert.ok(o.result.after >= o.result.before);
});

test('it switches off a live reference match and says so, and keeps the user\'s own masks', () => {
  const ref = randomImage(100, 70, 31);
  const refP = { profile: lookProfile(ref), thumb: downscale(ref, 120) };
  const s = makeSettings();
  s.ref = { id: 1, profile: refP.profile, color: 1, tone: 1, thumb: refP.thumb, swatches: [] };
  const own = { kind: 'range', adj: { exposure: -0.2 } } as const;
  s.masks = [maskModule.makeMask(own)];
  const { steps, result } = drain(matchAgent(randomImage(100, 70, 32), s, refP));
  assert.equal(result.settings.ref, null);
  assert.match(steps[0].why, /live match/);
  assert.ok(result.settings.masks.some((m) => m.id === s.masks[0].id));
});

test('the horizon finder spots a clear sky and ground edge, and nothing in a flat or noisy photo', () => {
  const h = findHorizon(landscape([120, 150, 210], [50, 60, 40]));
  assert.ok(h && Math.abs(h.y - 0.5) < 0.06, JSON.stringify(h));
  assert.equal(findHorizon(fromFn(120, 80, () => [128, 128, 128])), null);
  assert.equal(findHorizon(randomImage(120, 80, 5)), null);
  assert.equal(findHorizon(fromFn(4, 4, () => [0, 0, 0])), null);
});

test('rows can be cut out of a photo', () => {
  const img = fromFn(6, 10, (_, y) => [y * 20, 0, 0]);
  const c = cropRows(img, 3, 6);
  assert.equal(c.height, 3);
  assert.equal(c.data[0], 60);
  assert.equal(c.data[c.data.length - 4], 100);
  assert.equal(cropRows(img, 0, 100).height, 10);
});

test('with a clear horizon in both photos, the agent matches sky and ground with their own masks', () => {
  const ref = landscape([230, 140, 80], [30, 30, 40]);          // warm sunset sky over a dark shore
  const user = landscape([110, 150, 215], [120, 110, 90]);      // blue sky over light sand
  const refP = { profile: lookProfile(ref), thumb: downscale(ref, 120) };
  const { steps, result } = drain(matchAgent(user, makeSettings(), refP));
  const region = steps.find((s) => s.kind === 'region');
  assert.ok(region, 'a region step was taken');
  assert.ok(result.settings.masks.length >= 1 && result.settings.masks.length <= 2);
  assert.ok(region.changes.some((c) => /mask/.test(c)));
  // The masks are ordinary gradient masks, so they show in the Masks tab and can be edited there.
  for (const m of result.settings.masks) assert.equal(m.kind, 'linear');
  // Without them it is worse: the regional pass earned its place.
  const noMasks = cloneSettings(result.settings); noMasks.masks = [];
  const small = downscale(user, 160);
  assert.ok(score(small, result.settings, refP) > score(small, noMasks, refP) - 0.5);
});

test('without a horizon in the reference, no masks are added and the step is skipped', () => {
  const ref = randomImage(100, 70, 41);
  const refP = { profile: lookProfile(ref), thumb: downscale(ref, 120) };
  const { steps, result } = drain(matchAgent(landscape([110, 150, 215], [120, 110, 90]), makeSettings(), refP));
  assert.equal(steps.find((s) => s.kind === 'region'), undefined);
  assert.equal(result.settings.masks.length, 0);
});

test('the agent respects the ten mask limit', () => {
  const ref = landscape([230, 140, 80], [30, 30, 40]);
  const refP = { profile: lookProfile(ref), thumb: downscale(ref, 120) };
  const s = makeSettings();
  s.masks = Array.from({ length: 9 }, () => maskModule.makeMask({ kind: 'range', adj: { exposure: 0.1 } }));
  const { result } = drain(matchAgent(landscape([110, 150, 215], [120, 110, 90]), s, refP));
  assert.ok(result.settings.masks.length <= 10);
});

test('changes are described in the words of the controls, with tints named by colour', () => {
  const a = makeSettings(), b = cloneSettings(a);
  b.adj.exposure = 0.45; b.adj.contrast = -12; b.adj.splitShadow = { hue: 190, amount: 0.3 };
  const out = describeChanges(a, b);
  assert.ok(out.includes('Exposure +0.00 stops to +0.45 stops') || out.some((x) => /Exposure .* to \+0\.45 stops/.test(x)));
  assert.ok(out.some((x) => /Contrast 0 to -12/.test(x)));
  assert.ok(out.includes('Shadow tint teal at 30%'));
  assert.deepEqual(describeChanges(a, cloneSettings(a)), []);
  assert.equal(hueName(30), 'orange'); assert.equal(hueName(359), 'red'); assert.equal(hueName(180), 'teal');
});

test('when sky and ground already match, no masks are added', () => {
  const img = landscape([230, 140, 80], [30, 30, 40]);
  const refP = { profile: lookProfile(img), thumb: downscale(img, 120) };
  const { result } = drain(matchAgent(img, makeSettings(), refP));
  assert.equal(result.settings.masks.length, 0);
});
