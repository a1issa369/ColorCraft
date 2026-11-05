// Local edits. A mask is a soft 0..1 map over the photo; its own small set of adjustments is blended in by that map,
// so the edit lands fully where the mask is 1, not at all where it is 0, and fades in between.
import { applyAdjustments, makeAdjustments } from './adjust.js';
import { makeImage } from './image.js';

export const MASK_KEYS = ['exposure', 'contrast', 'highlights', 'shadows', 'temperature', 'saturation'];
export const MAX_MASKS = 3;

let nextId = 1;

/**
 * A linear gradient: full effect at the start point, fading to nothing at the end point.
 * Points are fractions of the photo (0..1), so the same mask fits the preview and the full size export.
 */
export function makeMask(over = {}) {
  const adj = {};
  for (const k of MASK_KEYS) adj[k] = (over.adj && over.adj[k]) || 0;
  return {
    id: over.id || `m${nextId++}`,
    kind: 'linear',
    x1: 0.5, y1: 0, x2: 0.5, y2: 0.5,
    invert: false,
    ...over,
    adj,
  };
}

export const cloneMask = (m) => makeMask({ ...m, adj: { ...m.adj } });
export const cloneMasks = (list) => (list || []).map(cloneMask);
export const maskIsNeutral = (m) => MASK_KEYS.every((k) => !m.adj[k]);
export const masksAreNeutral = (list) => !list || list.every(maskIsNeutral);

const smoothstep01 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Fill (or allocate) a w*h Float32Array with the mask strength at every pixel. */
export function linearAlpha(m, w, h, out = new Float32Array(w * h)) {
  const px = m.x1 * w, py = m.y1 * h;
  const dx = m.x2 * w - px, dy = m.y2 * h - py;
  const len2 = dx * dx + dy * dy;
  const inv = m.invert ? 1 : 0;
  if (len2 < 1) { out.fill(inv); return out; }   // start and end on top of each other: nothing to fade across
  for (let y = 0; y < h; y++) {
    const ry = (y + 0.5 - py) * dy;
    for (let x = 0; x < w; x++) {
      const t = ((x + 0.5 - px) * dx + ry) / len2;
      const a = 1 - smoothstep01(t);
      out[y * w + x] = inv ? 1 - a : a;
    }
  }
  return out;
}

/** Remembers the last few alpha maps so a slider drag does not rebuild them every frame. */
export class AlphaCache {
  constructor(limit = 8) { this.limit = limit; this.map = new Map(); }
  get(m, w, h) {
    const key = `${m.id}|${m.x1}|${m.y1}|${m.x2}|${m.y2}|${m.invert}|${w}x${h}`;
    let a = this.map.get(key);
    if (a) { this.map.delete(key); this.map.set(key, a); return a; }
    a = linearAlpha(m, w, h);
    this.map.set(key, a);
    if (this.map.size > this.limit) this.map.delete(this.map.keys().next().value);
    return a;
  }
  clear() { this.map.clear(); }
}

/**
 * Blend every non-neutral mask's edit into `img`, in place. `img` must be a buffer you own (a graded copy, never the source).
 * Masks apply in order, each on top of the one before.
 */
export function applyMasks(img, masks, cache, scratch = makeImage(img.width, img.height)) {
  const w = img.width, h = img.height, d = img.data;
  for (const m of masks || []) {
    if (maskIsNeutral(m)) continue;
    const alpha = cache.get(m, w, h);
    const edited = applyAdjustments(img, makeAdjustments(m.adj), scratch);
    const e = edited.data;
    for (let p = 0, i = 0; p < alpha.length; p++, i += 4) {
      const a = alpha[p];
      if (a === 0) continue;
      d[i] += (e[i] - d[i]) * a;
      d[i + 1] += (e[i + 1] - d[i + 1]) * a;
      d[i + 2] += (e[i + 2] - d[i + 2]) * a;
    }
  }
  return img;
}

/** One-tap starting points, so a beginner sees what a mask is for before tuning it. */
export const MASK_STARTERS = [
  { id: 'sky', name: 'Darken the sky', blurb: 'Starts at the top and fades out by the middle. Brings back colour and detail in a bright sky.',
    mask: { x1: 0.5, y1: 0, x2: 0.5, y2: 0.55, adj: { exposure: -0.6, highlights: -30, saturation: 12 } } },
  { id: 'ground', name: 'Lift the ground', blurb: 'Starts at the bottom and fades out by the middle. Opens up a dark foreground.',
    mask: { x1: 0.5, y1: 1, x2: 0.5, y2: 0.45, adj: { exposure: 0.35, shadows: 30 } } },
  { id: 'warm-horizon', name: 'Warm the horizon', blurb: 'A band of warmth from the bottom. Pairs well with a sunset.',
    mask: { x1: 0.5, y1: 0.8, x2: 0.5, y2: 0.3, adj: { temperature: 25, saturation: 10 } } },
];
