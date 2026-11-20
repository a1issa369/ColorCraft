// How close one photo's look is to another's, in six plain dimensions a person can reason about.
// Works on LookProfile (what the reference matcher already learns), so a reference photo never has to be kept around.
import { TONE_BANDS, quantile } from './transfer.ts';
import type { LookProfile } from './transfer.ts';

export type DialId = 'brightness' | 'contrast' | 'warmth' | 'colour' | 'shadowTint' | 'highlightTint';
export const DIALS: readonly DialId[] = ['brightness', 'contrast', 'warmth', 'colour', 'shadowTint', 'highlightTint'];

export const DIAL_LABEL: Record<DialId, string> = {
  brightness: 'Brightness', contrast: 'Contrast', warmth: 'Warmth', colour: 'Colour strength', shadowTint: 'Shadow tint', highlightTint: 'Highlight tint',
};

/** Measured features of a look. L is lightness 0..100; a and b are Lab colour axes (a: green to red, b: blue to yellow). */
export interface Traits {
  q: Record<'p02' | 'p10' | 'p25' | 'p50' | 'p75' | 'p90' | 'p98', number>;
  a: number; b: number;                // average colour of the whole photo
  colourful: number;                   // average colour strength
  shadow: [number, number];            // average colour of the dark tones
  highlight: [number, number];         // average colour of the bright tones
}

/** One full step of each dimension corresponds to roughly this much difference, so scores are comparable between dials. */
const SCALE: Record<DialId, number> = { brightness: 20, contrast: 25, warmth: 14, colour: 14, shadowTint: 12, highlightTint: 12 };

export function traitsOf(p: LookProfile): Traits {
  const Q = (q: number) => quantile(p.cdf, q);
  let w = 0, a = 0, b = 0, col = 0;
  const part = (from: number, to: number): [number, number] => {
    let pw = 0, pa = 0, pb = 0;
    for (let k = from; k <= to; k++) { const band = p.bands[k]; pw += band.weight; pa += band.weight * band.meanA; pb += band.weight * band.meanB; }
    return pw > 0 ? [pa / pw, pb / pw] : [0, 0];
  };
  for (const band of p.bands) {
    w += band.weight; a += band.weight * band.meanA; b += band.weight * band.meanB;
    col += band.weight * Math.sqrt(band.meanA ** 2 + band.meanB ** 2 + band.stdA ** 2 + band.stdB ** 2);
  }
  const last = TONE_BANDS.length - 1;
  return {
    q: { p02: Q(0.02), p10: Q(0.1), p25: Q(0.25), p50: Q(0.5), p75: Q(0.75), p90: Q(0.9), p98: Q(0.98) },
    a: w ? a / w : 0, b: w ? b / w : 0, colourful: w ? col / w : 0,
    shadow: part(0, 1), highlight: part(last - 1, last),
  };
}

export type Distances = Record<DialId, number>;

/** How far apart two looks are on each dimension, in the units of that dimension. 0 means identical. */
export function distances(user: Traits, ref: Traits): Distances {
  return {
    brightness: Math.abs(user.q.p50 - ref.q.p50),
    contrast: 0.6 * Math.abs((user.q.p90 - user.q.p10) - (ref.q.p90 - ref.q.p10)) + 0.4 * Math.abs((user.q.p98 - user.q.p02) - (ref.q.p98 - ref.q.p02)),
    warmth: Math.hypot(user.a - ref.a, user.b - ref.b),
    colour: Math.abs(user.colourful - ref.colourful),
    shadowTint: Math.hypot(user.shadow[0] - ref.shadow[0], user.shadow[1] - ref.shadow[1]),
    highlightTint: Math.hypot(user.highlight[0] - ref.highlight[0], user.highlight[1] - ref.highlight[1]),
  };
}

export interface Closeness {
  overall: number;                     // 0..100
  dials: Record<DialId, number>;       // each 0..100
}

/** 100 means the same on that dimension; 0 means a full scale or more apart. */
export const dialScore = (id: DialId, distance: number): number => 100 * Math.max(0, 1 - distance / SCALE[id]);

export function closenessOf(d: Distances): Closeness {
  const dials = {} as Record<DialId, number>;
  let sum = 0;
  for (const id of DIALS) { dials[id] = dialScore(id, d[id]); sum += dials[id]; }
  return { overall: sum / DIALS.length, dials };
}

export const closeness = (user: LookProfile, ref: LookProfile): Closeness => closenessOf(distances(traitsOf(user), traitsOf(ref)));

/** How far apart the two tone curves are over the whole range, as a root mean square of lightness differences. */
export function toneDistance(user: Traits, ref: Traits): number {
  const keys = ['p02', 'p10', 'p25', 'p50', 'p75', 'p90', 'p98'] as const;
  let s = 0;
  for (const k of keys) s += (user.q[k] - ref.q[k]) ** 2;
  return Math.sqrt(s / keys.length);
}

// ---- plain English ----
const HUES: [number, string][] = [[0, 'pink'], [45, 'orange'], [90, 'yellow'], [135, 'lime'], [180, 'green'], [225, 'teal'], [270, 'blue'], [315, 'purple']];

/** A colour name for a direction in the a/b plane. Empty when the colour is too weak to name. */
export function tintName(a: number, b: number, minStrength = 3): string {
  if (Math.hypot(a, b) < minStrength) return '';
  const deg = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  let best = HUES[0];
  for (const h of HUES) {
    const d = Math.min(Math.abs(deg - h[0]), 360 - Math.abs(deg - h[0]));
    const bd = Math.min(Math.abs(deg - best[0]), 360 - Math.abs(deg - best[0]));
    if (d < bd) best = h;
  }
  return best[1];
}

/** The reference's look in a short phrase, like "bright, punchy, warm, rich colour, teal shadows". */
export function describeLook(t: Traits): string {
  const parts: string[] = [];
  parts.push(t.q.p50 < 38 ? 'dark' : t.q.p50 > 62 ? 'bright' : 'mid-tone');
  const spread = t.q.p90 - t.q.p10;
  parts.push(spread < 38 ? 'soft and flat' : spread > 62 ? 'punchy' : 'balanced contrast');
  if (t.q.p02 > 14) parts.push('lifted blacks');
  parts.push(t.b > 6 ? 'warm' : t.b < -4 ? 'cool' : 'neutral in warmth');
  parts.push(t.colourful > 28 ? 'rich colour' : t.colourful < 12 ? 'muted colour' : 'moderate colour');
  const sh = tintName(t.shadow[0], t.shadow[1], 4), hi = tintName(t.highlight[0], t.highlight[1], 4);
  if (sh) parts.push(`${sh} shadows`);
  if (hi) parts.push(`${hi} highlights`);
  return parts.join(', ');
}

/** What is different between the two photos, in plain sentences, biggest gap first. Only gaps big enough to matter. */
export function describeGaps(user: Traits, ref: Traits): string[] {
  const d = distances(user, ref);
  const out: { size: number; text: string }[] = [];
  const add = (id: DialId, text: string, min: number) => { if (d[id] >= min) out.push({ size: d[id] / SCALE[id], text }); };
  add('brightness', `Your photo is ${user.q.p50 < ref.q.p50 ? 'darker' : 'brighter'} than the reference (middle brightness ${Math.round(user.q.p50)} against ${Math.round(ref.q.p50)}).`, 4);
  add('contrast', `Your photo has ${(user.q.p90 - user.q.p10) < (ref.q.p90 - ref.q.p10) ? 'less' : 'more'} contrast than the reference.`, 5);
  add('warmth', user.b === ref.b && user.a === ref.a ? '' : `Your photo is ${user.b < ref.b ? 'cooler' : 'warmer'}${Math.abs(user.a - ref.a) > Math.abs(user.b - ref.b) ? ` and leans ${user.a < ref.a ? 'greener' : 'more magenta'}` : ''} than the reference.`, 3);
  add('colour', `Your colours are ${user.colourful < ref.colourful ? 'weaker' : 'stronger'} than the reference's.`, 3);
  const rs = tintName(ref.shadow[0], ref.shadow[1], 3);
  add('shadowTint', rs ? `The reference's shadows lean ${rs}; yours do not.` : 'The reference has neutral shadows; yours are tinted.', 3);
  const rh = tintName(ref.highlight[0], ref.highlight[1], 3);
  add('highlightTint', rh ? `The reference's highlights lean ${rh}; yours do not.` : 'The reference has neutral highlights; yours are tinted.', 3);
  return out.filter((o) => o.text).sort((a, b) => b.size - a.size).map((o) => o.text);
}
