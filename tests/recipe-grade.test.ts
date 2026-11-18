import test from 'node:test';
import assert from 'node:assert/strict';
import { AlphaCache, makeMask } from '../src/core/mask.ts';
import { effectiveAdj, gradeImage, makeBuffers } from '../src/state/grade.ts';
import { makeSettings } from '../src/state/store.ts';
import { describeSettings } from '../src/ui/recipe.ts';
import { applyAdjustments, makeAdjustments } from '../src/core/adjust.ts';
import { randomImage, maxDiff } from './helpers.ts';

test('with default settings the grade leaves the photo alone', () => {
  const img = randomImage(16, 12, 3);
  assert.equal(maxDiff(gradeImage(img, makeSettings(), new AlphaCache(2)), img), 0);
});

test('gradeImage with buffers gives the same pixels as without', () => {
  const img = randomImage(20, 14, 5);
  const s = makeSettings();
  s.adj = makeAdjustments({ exposure: 0.4, contrast: 20, temperature: 15 });
  s.look = 'film'; s.lookStrength = 0.7;
  s.masks = [makeMask({ x1: 0.5, y1: 0, x2: 0.5, y2: 0.6, adj: { exposure: -0.5 } })];
  const plain = gradeImage(img, s, new AlphaCache(2));
  const buffered = gradeImage(img, s, new AlphaCache(2), makeBuffers(img));
  assert.equal(maxDiff(plain, buffered), 0);
});

test('a look is stacked on the sliders and scaled by its strength', () => {
  const s = makeSettings();
  s.adj = makeAdjustments({ exposure: 0.2 });
  assert.equal(effectiveAdj(s), s.adj);                 // no look: the adjustments themselves
  s.look = 'film'; s.lookStrength = 0;
  assert.equal(effectiveAdj(s).exposure, 0.2);
  const img = randomImage(8, 8, 9);
  s.lookStrength = 1;
  assert.ok(maxDiff(gradeImage(img, s, new AlphaCache(1)), applyAdjustments(img, s.adj)) > 0);
});

test('masks are applied after the global grade', () => {
  const img = randomImage(12, 12, 2);
  const s = makeSettings();
  s.masks = [makeMask({ x1: 0.5, y1: 0, x2: 0.5, y2: 1, adj: { exposure: 1 } })];
  assert.ok(maxDiff(gradeImage(img, s, new AlphaCache(1)), img) > 0);
});

test('describeSettings says so when nothing changed', () => {
  assert.equal(describeSettings(makeSettings()), 'No changes yet.');
});

test('describeSettings lists sliders, looks, colour mix and gradients in plain words', () => {
  const s = makeSettings();
  s.adj = makeAdjustments({ exposure: 0.5, contrast: -20 });
  s.adj.hsl = { hue: Array(8).fill(0), sat: Array(8).fill(0), lum: Array(8).fill(0) };
  s.adj.hsl.sat[1] = 30;
  s.masks = [makeMask({ x1: 0.5, y1: 0, x2: 0.5, y2: 0.55, invert: true, adj: { exposure: -0.6 } })];
  const text = describeSettings(s);
  assert.match(text, /Exposure: \+0\.50 stops/);
  assert.match(text, /Contrast: -20/);
  assert.match(text, /Orange: saturation \+30/);
  assert.match(text, /Gradient 1 \(flipped, strongest at 50% across and 0% down, gone by 50% across and 55% down\): Exposure -0\.60 stops/);
});

test('the recipe describes a brightness mask by its tones, not by points', () => {
  const s = makeSettings();
  s.masks = [makeMask({ kind: 'range', lo: 0.65, hi: 1, soft: 0.2, adj: { exposure: -0.45 } })];
  assert.match(describeSettings(s), /Brightness 1 \(tones from 65% to 100% brightness, fading over 20%\): Exposure -0\.45 stops/);
  s.masks[0].invert = true;
  assert.match(describeSettings(s), /everything except tones from 65%/);
});
