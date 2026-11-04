import test from 'node:test';
import assert from 'node:assert/strict';
import { labStats, transferColor } from '../src/core/transfer.js';
import { rgb8ToLab } from '../src/core/color.js';
import { renderCoast } from '../src/core/samples.js';
import { applyAdjustments, makeAdjustments } from '../src/core/adjust.js';
import { solid, fromFn, maxDiff } from './helpers.js';

const coast = renderCoast(160, 107);
const warm = applyAdjustments(coast, makeAdjustments({ temperature: 80, contrast: 30, exposure: -0.4 }));

test('statistics of a flat colour have zero spread and the right mean', () => {
  const s = labStats(solid(20, 20, 200, 40, 40));
  const lab = [0, 0, 0];
  rgb8ToLab(200, 40, 40, lab);
  for (let c = 0; c < 3; c++) {
    assert.ok(Math.abs(s.mean[c] - lab[c]) < 1e-6);
    assert.ok(s.std[c] < 1e-6);
  }
});

test('statistics of two halves are the mean and spread of the halves', () => {
  const img = fromFn(40, 10, (x) => (x < 20 ? [0, 0, 0] : [255, 255, 255]));
  const s = labStats(img);
  assert.ok(Math.abs(s.mean[0] - 50) < 1);
  assert.ok(Math.abs(s.std[0] - 50) < 1);
});

test('strength 0 returns the source unchanged (within rounding)', () => {
  const out = transferColor(coast, labStats(coast), labStats(warm), 0);
  assert.ok(maxDiff(out, coast) <= 1);
});

test('strength 1 moves the average colour to the reference', () => {
  const ref = labStats(warm);
  const out = transferColor(coast, labStats(coast), ref, 1);
  const got = labStats(out);
  assert.ok(Math.abs(got.mean[0] - ref.mean[0]) < 3, `L ${got.mean[0]} vs ${ref.mean[0]}`);
  assert.ok(Math.abs(got.mean[1] - ref.mean[1]) < 3, `a ${got.mean[1]} vs ${ref.mean[1]}`);
  assert.ok(Math.abs(got.mean[2] - ref.mean[2]) < 3, `b ${got.mean[2]} vs ${ref.mean[2]}`);
});

test('strength 0.5 lands about half way', () => {
  const src = labStats(coast);
  const ref = labStats(warm);
  const got = labStats(transferColor(coast, src, ref, 0.5));
  for (let c = 0; c < 3; c++) {
    const half = (src.mean[c] + ref.mean[c]) / 2;
    assert.ok(Math.abs(got.mean[c] - half) < 3, `channel ${c}: ${got.mean[c]} vs ${half}`);
  }
});

test('matching a photo to itself changes nothing', () => {
  const s = labStats(coast);
  assert.ok(maxDiff(transferColor(coast, s, s, 1), coast) <= 2);
});

test('the spread change is capped so a flat photo is not blown out by a busy reference', () => {
  const flat = fromFn(40, 40, (x) => [120 + (x % 2), 120, 120]);
  const busy = labStats(coast);
  const out = transferColor(flat, labStats(flat), busy, 1);
  const s = labStats(out);
  assert.ok(s.std[0] < 5, `L spread exploded to ${s.std[0]}`);
});

test('the source is not modified and strength is clamped', () => {
  const copy = new Uint8ClampedArray(coast.data);
  const a = labStats(coast), b = labStats(warm);
  const over = transferColor(coast, a, b, 7);
  assert.deepEqual(coast.data, copy);
  assert.ok(maxDiff(over, transferColor(coast, a, b, 1)) === 0);
  assert.ok(maxDiff(transferColor(coast, a, b, -3), coast) <= 1);
});

test('matching a near-flat photo to a busy reference never stretches its spread more than 1.6x', () => {
  const flat = fromFn(64, 8, (x) => { const v = 120 + (x % 2); return [v, v, v]; });
  const busy = fromFn(64, 8, (x) => { const v = (x * 4) % 256; return [v, 255 - v, 128]; });
  const s = labStats(flat), r = labStats(busy);
  const out = transferColor(flat, s, r, 1);
  const o = labStats(out);
  assert.ok(o.std[0] <= s.std[0] * 1.6 + 1.5, `lightness spread grew to ${o.std[0]} from ${s.std[0]}`);
});

test('matching a busy photo to a near-flat reference never squeezes its spread below 0.6x', () => {
  const flat = fromFn(64, 8, (x) => { const v = 120 + (x % 2); return [v, v, v]; });
  const busy = fromFn(64, 8, (x) => { const v = (x * 4) % 256; return [v, 255 - v, 128]; });
  const s = labStats(busy), r = labStats(flat);
  const o = labStats(transferColor(busy, s, r, 1));
  assert.ok(o.std[0] >= s.std[0] * 0.6 - 1.5, `lightness spread shrank to ${o.std[0]} from ${s.std[0]}`);
});
