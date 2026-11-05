// The grading pipeline. Order matters and mirrors how colorists think:
//   1. light:   exposure and white balance, done in linear light (where physics is honest)
//   2. tone:    highlights and shadows, weighted by how bright each pixel is
//   3. look:    contrast curve, saturation, split toning and fade, done on display values
import { SRGB_TO_LIN, encode } from './color.js';
import { makeImage } from './image.js';
import { channelLuts, lutLookup, cloneCurves, curvesAreIdentity, scaleCurve, CHANNELS } from './curves.js';
import { makeHsl, cloneHsl, hslIsNeutral, addHsl, makeHslMixer } from './hsl.js';

export const DEFAULTS = Object.freeze({
  exposure: 0,      // stops, -3..3
  contrast: 0,      // -100..100
  highlights: 0,    // -100..100 (negative recovers bright detail)
  shadows: 0,       // -100..100 (positive lifts dark detail)
  temperature: 0,   // -100 (cool/blue) .. 100 (warm/orange)
  tint: 0,          // -100 (green) .. 100 (magenta)
  saturation: 0,    // -100..100
  fade: 0,          // 0..1 lifts the blacks
  splitShadow: Object.freeze({ hue: 210, amount: 0 }),
  splitHighlight: Object.freeze({ hue: 35, amount: 0 }),
  curves: null,      // tone curves per channel, see curves.js (null means straight lines)
  hsl: null,         // colour mix per colour family, see hsl.js (null means no change)
  lookCurves: null,  // curves contributed by a look, kept apart from the user's own curves
});

export const RANGES = {
  exposure: [-2, 2],
  contrast: [-100, 100],
  highlights: [-100, 100],
  shadows: [-100, 100],
  temperature: [-100, 100],
  tint: [-100, 100],
  saturation: [-100, 100],
  fade: [0, 1],
};

export function makeAdjustments(overrides = {}) {
  return {
    ...DEFAULTS,
    ...overrides,
    splitShadow: { ...DEFAULTS.splitShadow, ...(overrides.splitShadow || {}) },
    splitHighlight: { ...DEFAULTS.splitHighlight, ...(overrides.splitHighlight || {}) },
    curves: overrides.curves ? cloneCurves(overrides.curves) : null,
    hsl: overrides.hsl ? cloneHsl(overrides.hsl) : null,
    lookCurves: overrides.lookCurves ? cloneCurves(overrides.lookCurves) : null,
  };
}

export function isNeutral(adj) {
  return (
    adj.exposure === 0 && adj.contrast === 0 && adj.highlights === 0 && adj.shadows === 0 &&
    adj.temperature === 0 && adj.tint === 0 && adj.saturation === 0 && adj.fade === 0 &&
    adj.splitShadow.amount === 0 && adj.splitHighlight.amount === 0 &&
    curvesAreIdentity(adj.curves) && curvesAreIdentity(adj.lookCurves) && hslIsNeutral(adj.hsl)
  );
}

/** Add a look (scaled by strength 0..1) on top of the user's own adjustments. */
export function combine(base, look, strength = 1) {
  const s = Math.max(0, Math.min(1, strength));
  const out = makeAdjustments(base);
  if (!look) return out;
  for (const k of ['exposure', 'contrast', 'highlights', 'shadows', 'temperature', 'tint', 'saturation', 'fade']) {
    out[k] = base[k] + (look[k] || 0) * s;
  }
  if (look.splitShadow) out.splitShadow = { hue: look.splitShadow.hue, amount: look.splitShadow.amount * s };
  if (look.splitHighlight) out.splitHighlight = { hue: look.splitHighlight.hue, amount: look.splitHighlight.amount * s };
  if (look.curves) {
    out.lookCurves = cloneCurves();
    for (const k of CHANNELS) if (look.curves[k]) out.lookCurves[k] = scaleCurve(look.curves[k], s);
  }
  if (look.hsl) out.hsl = addHsl(base.hsl, look.hsl, s);
  return out;
}

const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function hueToRgb(h) {
  // HSL(h, 100%, 50%) as 0..1 rgb
  const k = (n) => (n + h / 30) % 12;
  const a = 1 * Math.min(0.5, 1 - 0.5);
  const ch = (n) => 0.5 - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [ch(0), ch(8), ch(4)];
}

const CURVE_N = 1024;

function contrastCurve(contrast) {
  // Pivoted power curve: mid grey stays at 0.5, contrast > 0 makes an S, contrast < 0 flattens.
  const p = Math.pow(2, (contrast / 100) * 1.1);
  const lut = new Float32Array(CURVE_N + 1);
  for (let i = 0; i <= CURVE_N; i++) {
    const x = i / CURVE_N;
    lut[i] = x < 0.5 ? 0.5 * Math.pow(2 * x, p) : 1 - 0.5 * Math.pow(2 * (1 - x), p);
  }
  return lut;
}

/**
 * Apply adjustments to an image and return a new image. The source is never modified.
 * @param {{width:number,height:number,data:Uint8ClampedArray}} src
 * @param {typeof DEFAULTS} adj
 */
export function applyAdjustments(src, adj, dst = makeImage(src.width, src.height)) {
  const a = makeAdjustments(adj);
  const sd = src.data;
  const dd = dst.data;
  const n = src.width * src.height;

  // 1. gains for exposure and white balance (kept luminance-neutral so temperature does not change brightness)
  const tt = a.temperature / 100;
  const tn = a.tint / 100;
  let rg = 1 + 0.5 * tt;
  let gg = 1 - 0.35 * tn;
  let bg = 1 - 0.5 * tt;
  const norm = 1 / (0.2126 * rg + 0.7152 * gg + 0.0722 * bg);
  const ex = Math.pow(2, a.exposure);
  rg *= norm * ex;
  gg *= norm * ex;
  bg *= norm * ex;

  // 2. highlights and shadows: a gain (in stops) looked up by pixel brightness
  const useTone = a.highlights !== 0 || a.shadows !== 0;
  const toneLut = new Float32Array(CURVE_N + 1);
  if (useTone) {
    for (let i = 0; i <= CURVE_N; i++) {
      const e = i / CURVE_N;
      const ws = 1 - smoothstep(0.0, 0.55, e);
      const wh = smoothstep(0.45, 1.0, e);
      toneLut[i] = Math.pow(2, (a.shadows / 100) * 1.6 * ws + (a.highlights / 100) * 1.0 * wh);
    }
  }

  // 3. display-referred finishing
  const curve = a.contrast !== 0 ? contrastCurve(a.contrast) : null;
  const sat = 1 + a.saturation / 100;
  const useSat = a.saturation !== 0;
  const luts = channelLuts(a.curves, a.lookCurves);
  const mixer = makeHslMixer(a.hsl);
  const mixed = [0, 0, 0];
  const fadeAmt = 0.1 * a.fade;
  const sh = a.splitShadow.amount > 0 ? hueToRgb(a.splitShadow.hue) : null;
  const hi = a.splitHighlight.amount > 0 ? hueToRgb(a.splitHighlight.hue) : null;
  const shLuma = sh ? 0.2126 * sh[0] + 0.7152 * sh[1] + 0.0722 * sh[2] : 0;
  const hiLuma = hi ? 0.2126 * hi[0] + 0.7152 * hi[1] + 0.0722 * hi[2] : 0;
  const shAmt = a.splitShadow.amount * 0.35;
  const hiAmt = a.splitHighlight.amount * 0.35;

  for (let p = 0, i = 0; p < n; p++, i += 4) {
    let R = SRGB_TO_LIN[sd[i]] * rg;
    let G = SRGB_TO_LIN[sd[i + 1]] * gg;
    let B = SRGB_TO_LIN[sd[i + 2]] * bg;

    if (useTone) {
      const y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
      const g = toneLut[(encode(y) * CURVE_N + 0.5) | 0];
      R *= g;
      G *= g;
      B *= g;
    }

    let r = encode(R);
    let g2 = encode(G);
    let b = encode(B);

    if (curve) {
      let f = r * CURVE_N, k = f | 0, t = f - k;
      r = curve[k] * (1 - t) + curve[Math.min(k + 1, CURVE_N)] * t;
      f = g2 * CURVE_N; k = f | 0; t = f - k;
      g2 = curve[k] * (1 - t) + curve[Math.min(k + 1, CURVE_N)] * t;
      f = b * CURVE_N; k = f | 0; t = f - k;
      b = curve[k] * (1 - t) + curve[Math.min(k + 1, CURVE_N)] * t;
    }

    if (luts) {
      r = lutLookup(luts[0], r);
      g2 = lutLookup(luts[1], g2);
      b = lutLookup(luts[2], b);
    }

    if (useSat) {
      const l = 0.2126 * r + 0.7152 * g2 + 0.0722 * b;
      r = l + (r - l) * sat;
      g2 = l + (g2 - l) * sat;
      b = l + (b - l) * sat;
    }

    if (mixer) {
      r = r < 0 ? 0 : r > 1 ? 1 : r;
      g2 = g2 < 0 ? 0 : g2 > 1 ? 1 : g2;
      b = b < 0 ? 0 : b > 1 ? 1 : b;
      mixer(r, g2, b, mixed);
      r = mixed[0]; g2 = mixed[1]; b = mixed[2];
    }

    if (sh || hi) {
      const l = 0.2126 * r + 0.7152 * g2 + 0.0722 * b;
      if (sh) {
        const w = (1 - smoothstep(0, 0.6, l)) * shAmt;
        r += (sh[0] - shLuma) * w;
        g2 += (sh[1] - shLuma) * w;
        b += (sh[2] - shLuma) * w;
      }
      if (hi) {
        const w = smoothstep(0.4, 1, l) * hiAmt;
        r += (hi[0] - hiLuma) * w;
        g2 += (hi[1] - hiLuma) * w;
        b += (hi[2] - hiLuma) * w;
      }
    }

    if (fadeAmt) {
      r = r * (1 - fadeAmt) + fadeAmt;
      g2 = g2 * (1 - fadeAmt) + fadeAmt;
      b = b * (1 - fadeAmt) + fadeAmt;
    }

    dd[i] = r * 255;
    dd[i + 1] = g2 * 255;
    dd[i + 2] = b * 255;
    dd[i + 3] = sd[i + 3];
  }
  return dst;
}
