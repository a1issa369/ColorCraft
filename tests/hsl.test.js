import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHslMixer, makeHsl, hslBands, hslIsNeutral, addHsl, BANDS } from '../src/core/hsl.js';
import { applyAdjustments, makeAdjustments, combine, isNeutral } from '../src/core/adjust.js';
import { solid, pixel } from './helpers.js';

const mix = (spec, rgb) => { const m = makeHslMixer(hslBands(spec)); const out = [0, 0, 0]; m(...rgb, out); return out; };

test('a neutral mix does nothing and is reported as neutral', () => {
  assert.equal(makeHslMixer(makeHsl()), null);
  assert.ok(hslIsNeutral(makeHsl()));
  assert.ok(!hslIsNeutral(hslBands({ red: { s: 10 } })));
});

test('reducing red saturation desaturates red and leaves blue alone', () => {
  const red = mix({ red: { s: -100 } }, [0.9, 0.1, 0.1]);
  assert.ok(Math.max(...red) - Math.min(...red) < 0.05, `red stayed colourful: ${red}`);
  const blue = mix({ red: { s: -100 } }, [0.1, 0.2, 0.9]);
  assert.ok(Math.abs(blue[0] - 0.1) < 0.01 && Math.abs(blue[2] - 0.9) < 0.01);
});

test('greys and near greys are untouched whatever the mix', () => {
  const g = mix({ red: { h: 100, s: 100, l: 100 }, blue: { h: -100, s: 100 } }, [0.5, 0.5, 0.5]);
  assert.deepEqual(g, [0.5, 0.5, 0.5]);
});

test('pushing blue hue negative moves blue toward aqua (less red, more green)', () => {
  const out = mix({ blue: { h: -100 } }, [0.1, 0.2, 0.9]);
  assert.ok(out[1] > 0.2 + 0.05, `green should rise, got ${out}`);
  assert.ok(out[2] >= 0.85);
});

test('positive orange saturation makes orange richer and darkening lowers its value', () => {
  const base = [0.8, 0.5, 0.3];
  const rich = mix({ orange: { s: 50 } }, base);
  assert.ok(Math.max(...rich) - Math.min(...rich) > Math.max(...base) - Math.min(...base));
  const dark = mix({ orange: { l: -100 } }, base);
  assert.ok(Math.max(...dark) < Math.max(...base));
});

test('band weights are continuous: nearby hues get nearby results', () => {
  let prev = null;
  for (let h = 0; h <= 360; h += 2) {
    const c = Math.cos((h * Math.PI) / 180), s = Math.sin((h * Math.PI) / 180);
    const rgb = [0.5 + 0.3 * c, 0.5 + 0.3 * Math.sin(((h + 120) * Math.PI) / 180), 0.5 + 0.3 * Math.sin(((h + 240) * Math.PI) / 180)];
    const out = mix({ green: { h: 100, s: 80 }, magenta: { h: -80, l: 60 }, orange: { s: -70 } }, rgb);
    if (prev) for (let k = 0; k < 3; k++) assert.ok(Math.abs(out[k] - prev[k]) < 0.12, `jump at hue ${h}`);
    prev = out;
  }
});

test('the mix runs inside the pipeline, and look mixes are scaled and added', () => {
  const img = solid(2, 2, 230, 40, 40);
  const out = pixel(applyAdjustments(img, makeAdjustments({ hsl: hslBands({ red: { s: -100 } }) })), 0, 0);
  assert.ok(Math.max(...out) - Math.min(...out) < 25);
  const a = combine(makeAdjustments({ hsl: hslBands({ red: { s: 30 } }) }), { hsl: hslBands({ red: { s: 40 } }) }, 0.5);
  assert.equal(a.hsl.sat[0], 50);
  assert.ok(!isNeutral(a));
  assert.equal(addHsl(null, hslBands({ red: { s: 500 } }), 1).sat[0], 100);
  assert.equal(BANDS.length, 8);
});
