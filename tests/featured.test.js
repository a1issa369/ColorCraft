import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { FEATURED, gradeEdit } from '../src/ui/featured.js';
import { lookById } from '../src/core/looks.js';
import { fromFn } from './helpers.js';

const root = new URL('../', import.meta.url);

test('every home page photo exists, is a real JPEG, and names a real look', () => {
  assert.ok(FEATURED.length >= 3);
  const ids = new Set();
  for (const f of FEATURED) {
    assert.ok(!ids.has(f.id), `duplicate id ${f.id}`); ids.add(f.id);
    const url = new URL(f.file, root);
    assert.ok(existsSync(url), `${f.file} is missing`);
    const bytes = readFileSync(url);
    assert.equal(bytes[0], 0xff); assert.equal(bytes[1], 0xd8);                 // JPEG signature
    assert.ok(statSync(url).size > 20_000 && statSync(url).size < 600_000, `${f.file} should be a web sized photo`);
    assert.ok(lookById(f.edit.look), `${f.id} uses an unknown look`);
    assert.ok(f.edit.strength > 0 && f.edit.strength <= 1);
    assert.ok(f.focus.x >= 0 && f.focus.x <= 1 && f.focus.y >= 0 && f.focus.y <= 1);
    assert.ok(f.name && f.note);
  }
});

test('each card edit visibly changes a photo, so the after never matches the before', () => {
  const img = fromFn(32, 32, (x, y) => [60 + x * 4, 50 + y * 3, 90 + ((x + y) % 5) * 10]);
  for (const f of FEATURED) {
    const out = gradeEdit(img, f.edit);
    let diff = 0;
    for (let i = 0; i < img.data.length; i += 4) diff += Math.abs(out.data[i] - img.data[i]) + Math.abs(out.data[i + 1] - img.data[i + 1]) + Math.abs(out.data[i + 2] - img.data[i + 2]);
    assert.ok(diff / (img.data.length / 4) > 6, `${f.id} barely changes anything (${(diff / (img.data.length / 4)).toFixed(1)})`);
  }
});

test('an unknown look falls back to the plain adjustments instead of crashing', () => {
  const img = fromFn(8, 8, () => [100, 100, 100]);
  assert.doesNotThrow(() => gradeEdit(img, { look: 'no-such-look', strength: 1, adj: { exposure: 0.5 } }));
});
