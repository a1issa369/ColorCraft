import test from 'node:test';
import assert from 'node:assert/strict';
import { downscale, cloneImage, makeImage } from '../src/core/image.js';
import { solid, fromFn, pixel } from './helpers.js';

test('downscale returns the same image when it is already small enough', () => {
  const img = solid(40, 30, 1, 2, 3);
  assert.equal(downscale(img, 40), img);
  assert.equal(downscale(img, 100), img);
});

test('downscale sets the long edge and keeps the aspect ratio', () => {
  const out = downscale(solid(400, 200, 10, 20, 30), 100);
  assert.deepEqual([out.width, out.height], [100, 50]);
  const tall = downscale(solid(200, 400, 10, 20, 30), 100);
  assert.deepEqual([tall.width, tall.height], [50, 100]);
});

test('downscale keeps a solid colour exactly', () => {
  const out = downscale(solid(300, 200, 12, 99, 201), 60);
  for (let i = 0; i < out.data.length; i += 4) assert.deepEqual([...out.data.slice(i, i + 4)], [12, 99, 201, 255]);
});

test('downscale averages a checkerboard to mid grey', () => {
  const img = fromFn(64, 64, (x, y) => ((x + y) % 2 ? [255, 255, 255] : [0, 0, 0]));
  const out = downscale(img, 16);
  const [r] = pixel(out, 5, 5);
  assert.ok(Math.abs(r - 127.5) < 1.5, `got ${r}`);
});

test('downscale handles a 1 pixel wide image', () => {
  const out = downscale(solid(1, 500, 5, 6, 7), 50);
  assert.equal(out.width, 1);
  assert.equal(out.height, 50);
});

test('cloneImage copies the data', () => {
  const a = solid(4, 4, 9, 9, 9);
  const b = cloneImage(a);
  b.data[0] = 0;
  assert.equal(a.data[0], 9);
  assert.equal(makeImage(2, 3).data.length, 24);
});

test('downscale lands exactly on the requested long edge', () => {
  const out = downscale(makeImage(1000, 500), 100);
  assert.equal(out.width, 100);
  assert.equal(out.height, 50);
});
