import test from 'node:test';
import assert from 'node:assert/strict';
import { encode, decode, rgb8ToLab, labToRgb8, toHex, SRGB_TO_LIN } from '../src/core/color.js';
import { rng } from './helpers.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${a} within ${tol} of ${b}`);

test('encode and decode are inverses', () => {
  for (let i = 0; i <= 200; i++) {
    const x = i / 200;
    near(decode(encode(x)), x, 2e-4, `x=${x}`);
  }
});

test('encode is monotonic and clamps', () => {
  let prev = -1;
  for (let i = 0; i <= 1000; i++) {
    const v = encode(i / 1000);
    assert.ok(v >= prev);
    prev = v;
  }
  assert.equal(encode(-3), 0);
  assert.equal(encode(7), 1);
  assert.equal(encode(NaN), 0);
});

test('18 percent grey is about 0.46 on the sRGB scale', () => {
  near(encode(0.18), 0.4614, 0.002);
});

test('the 8-bit lookup table matches the exact formula at the ends and the middle', () => {
  assert.equal(SRGB_TO_LIN[0], 0);
  near(SRGB_TO_LIN[255], 1, 1e-6);
  near(SRGB_TO_LIN[128], 0.2159, 0.001);
});

test('Lab of white, black and pure red match published values', () => {
  const lab = [0, 0, 0];
  rgb8ToLab(255, 255, 255, lab);
  near(lab[0], 100, 0.05); near(lab[1], 0, 0.05); near(lab[2], 0, 0.05);
  rgb8ToLab(0, 0, 0, lab);
  near(lab[0], 0, 0.05);
  rgb8ToLab(255, 0, 0, lab);
  near(lab[0], 53.24, 0.3); near(lab[1], 80.09, 0.5); near(lab[2], 67.2, 0.5);
  rgb8ToLab(0, 0, 255, lab);
  near(lab[0], 32.3, 0.3); near(lab[1], 79.19, 0.6); near(lab[2], -107.86, 0.8);
});

test('a warm colour has positive b and a blue one has negative b', () => {
  const lab = [0, 0, 0];
  rgb8ToLab(220, 180, 120, lab);
  assert.ok(lab[2] > 10);
  rgb8ToLab(120, 160, 220, lab);
  assert.ok(lab[2] < -10);
});

test('rgb to Lab to rgb round-trips', () => {
  const r = rng(3);
  const lab = [0, 0, 0];
  const back = [0, 0, 0];
  for (let i = 0; i < 500; i++) {
    const c = [Math.floor(r() * 256), Math.floor(r() * 256), Math.floor(r() * 256)];
    rgb8ToLab(c[0], c[1], c[2], lab);
    labToRgb8(lab[0], lab[1], lab[2], back);
    for (let k = 0; k < 3; k++) near(back[k], c[k], 1.2, `channel ${k} of ${c}`);
  }
});

test('toHex pads, rounds and clamps', () => {
  assert.equal(toHex(0, 0, 0), '#000000');
  assert.equal(toHex(255, 128, 1), '#ff8001');
  assert.equal(toHex(300, -5, 127.6), '#ff0080');
});
