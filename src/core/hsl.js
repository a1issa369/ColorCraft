// Colour mix: change hue, saturation and brightness of one family of colours without touching the others.
// This is how "teal and orange" really works: blues slide toward teal and oranges get richer.
import { clamp } from './color.js';

export const BANDS = [
  { id: 'red', name: 'Red', hue: 0 },
  { id: 'orange', name: 'Orange', hue: 30 },
  { id: 'yellow', name: 'Yellow', hue: 60 },
  { id: 'green', name: 'Green', hue: 120 },
  { id: 'aqua', name: 'Aqua', hue: 180 },
  { id: 'blue', name: 'Blue', hue: 220 },
  { id: 'purple', name: 'Purple', hue: 270 },
  { id: 'magenta', name: 'Magenta', hue: 320 },
];
const N = BANDS.length;
export const HUE_RANGE_DEG = 30;   // the hue slider at +-100 moves a colour by this many degrees
export const LUM_RANGE = 0.5;      // the brightness slider at +-100 scales the value by up to this much

export const makeHsl = () => ({ hue: new Array(N).fill(0), sat: new Array(N).fill(0), lum: new Array(N).fill(0) });

export function cloneHsl(h) {
  const out = makeHsl();
  if (h) for (const k of ['hue', 'sat', 'lum']) if (h[k]) for (let i = 0; i < N; i++) out[k][i] = h[k][i] || 0;
  return out;
}

export const hslIsNeutral = (h) => !h || ['hue', 'sat', 'lum'].every((k) => h[k].every((v) => v === 0));

/** Build an hsl object from {orange: {h: 10, s: 20, l: -5}}. */
export function hslBands(spec = {}) {
  const out = makeHsl();
  BANDS.forEach((b, i) => {
    const v = spec[b.id];
    if (v) { out.hue[i] = v.h || 0; out.sat[i] = v.s || 0; out.lum[i] = v.l || 0; }
  });
  return out;
}

/** Add a scaled look's colour mix on top of the user's. */
export function addHsl(base, look, strength = 1) {
  const out = cloneHsl(base);
  if (look) for (const k of ['hue', 'sat', 'lum']) for (let i = 0; i < N; i++) out[k][i] = clamp(out[k][i] + (look[k][i] || 0) * strength, -100, 100);
  return out;
}

// Weights: each hue sits between two neighbouring band centres and is shared between them, so the weights always add to 1
// and nothing jumps at a band edge.
const centres = BANDS.map((b) => b.hue);
function bandWeights(h, out) {
  out.fill(0);
  for (let i = 0; i < N; i++) {
    const a = centres[i];
    const b = centres[(i + 1) % N] + (i + 1 === N ? 360 : 0);
    const hh = h < a && i === N - 1 ? h + 360 : h;
    if (hh >= a && hh < b) {
      let t = (hh - a) / (b - a);
      t = t * t * (3 - 2 * t);
      out[i] = 1 - t;
      out[(i + 1) % N] = t;
      return;
    }
  }
  out[0] = 1;
}

/** Returns fn(r, g, b, out) working on 0..1 display values, or null if the mix does nothing. */
export function makeHslMixer(hsl) {
  if (hslIsNeutral(hsl)) return null;
  const w = new Array(N).fill(0);
  return (r, g, b, out) => {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const d = mx - mn;
    if (d < 1e-5) { out[0] = r; out[1] = g; out[2] = b; return; }
    let h;
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = h * 60;
    if (h < 0) h += 360;
    let s = d / mx, v = mx;
    bandWeights(h, w);
    let dh = 0, ds = 0, dl = 0;
    for (let i = 0; i < N; i++) { dh += w[i] * hsl.hue[i]; ds += w[i] * hsl.sat[i]; dl += w[i] * hsl.lum[i]; }
    h = (h + (dh / 100) * HUE_RANGE_DEG + 360) % 360;
    s = clamp(s * (1 + ds / 100), 0, 1);
    v = clamp(v * (1 + (dl / 100) * LUM_RANGE * Math.min(1, s * 2)), 0, 1);
    // HSV back to RGB
    const c = v * s, hp = h / 60, x = c * (1 - Math.abs((hp % 2) - 1)), m = v - c;
    let rr, gg, bb;
    if (hp < 1) { rr = c; gg = x; bb = 0; }
    else if (hp < 2) { rr = x; gg = c; bb = 0; }
    else if (hp < 3) { rr = 0; gg = c; bb = x; }
    else if (hp < 4) { rr = 0; gg = x; bb = c; }
    else if (hp < 5) { rr = x; gg = 0; bb = c; }
    else { rr = c; gg = 0; bb = x; }
    out[0] = rr + m; out[1] = gg + m; out[2] = bb + m;
  };
}
