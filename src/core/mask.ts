// Local edits. A mask is a soft 0..1 map over the photo; its own small set of adjustments is blended in by that map,
// so the edit lands fully where the mask is 1, not at all where it is 0, and fades in between.
import { applyAdjustments, makeAdjustments } from './adjust.ts';
import { makeImage } from './image.ts';
import type { Img, SliderKey } from './types.ts';

export type MaskKey = Extract<SliderKey, 'exposure' | 'contrast' | 'highlights' | 'shadows' | 'temperature' | 'saturation'>;

export type MaskKind = 'linear' | 'range';

/**
 * A mask with its own small set of adjustments. Two kinds share one shape so saving, undo and cloning stay simple:
 * - 'linear' uses the four point fields (fractions of the photo).
 * - 'range' picks pixels by brightness: full effect between lo and hi (0..1), fading out over `soft` either side.
 */
export interface Mask {
  id: string;
  kind: MaskKind;
  x1: number; y1: number; x2: number; y2: number;
  lo: number; hi: number; soft: number;
  invert: boolean;
  adj: Record<MaskKey, number>;
}

export type MaskInput = Partial<Omit<Mask, 'adj'>> & { adj?: Partial<Record<MaskKey, number>> };

export const MASK_KEYS: readonly MaskKey[] = ['exposure', 'contrast', 'highlights', 'shadows', 'temperature', 'saturation'];
export const MAX_MASKS = 3;

let nextId = 1;

/**
 * A linear gradient: full effect at the start point, fading to nothing at the end point.
 * Points are fractions of the photo (0..1), so the same mask fits the preview and the full size export.
 */
export function makeMask(over: MaskInput = {}): Mask {
  const adj = {} as Record<MaskKey, number>;
  for (const k of MASK_KEYS) adj[k] = (over.adj && over.adj[k]) || 0;
  return {
    id: over.id || `m${nextId++}`,
    kind: 'linear',
    x1: 0.5, y1: 0, x2: 0.5, y2: 0.5,
    lo: 0.5, hi: 1, soft: 0.15,
    invert: false,
    ...over,
    adj,
  };
}

export const cloneMask = (m: Mask): Mask => makeMask({ ...m, adj: { ...m.adj } });
export const cloneMasks = (list?: Mask[] | null): Mask[] => (list || []).map(cloneMask);
export const maskIsNeutral = (m: Mask): boolean => MASK_KEYS.every((k) => !m.adj[k]);
export const masksAreNeutral = (list?: Mask[] | null): boolean => !list || list.every(maskIsNeutral);

const smoothstep01 = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Fill (or allocate) a w*h Float32Array with the mask strength at every pixel. */
export function linearAlpha(m: Mask, w: number, h: number, out: Float32Array = new Float32Array(w * h)): Float32Array {
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

/** Brightness of every pixel, 0..1, using the standard weights for how bright each colour looks. */
export function lumaMap(img: Img, out: Float32Array = new Float32Array(img.width * img.height)): Float32Array {
  const d = img.data;
  for (let p = 0, i = 0; p < out.length; p++, i += 4) out[p] = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
  return out;
}

/** Mask strength from brightness: 1 between lo and hi, fading to 0 over `soft` outside them. */
export function rangeAlpha(m: Mask, luma: Float32Array, out: Float32Array = new Float32Array(luma.length)): Float32Array {
  const lo = m.lo, hi = Math.max(m.hi, m.lo), s = m.soft, inv = m.invert;
  for (let p = 0; p < luma.length; p++) {
    const l = luma[p];
    const rise = s > 0 ? smoothstep01((l - (lo - s)) / s) : (l >= lo ? 1 : 0);
    const fall = s > 0 ? 1 - smoothstep01((l - hi) / s) : (l <= hi ? 1 : 0);
    const a = rise * fall;
    out[p] = inv ? 1 - a : a;
  }
  return out;
}

/** Remembers the last few gradient maps so a slider drag does not rebuild them every frame. */
export class AlphaCache {
  limit: number;
  map = new Map<string, Float32Array>();
  private tmp: Float32Array[] = [];
  constructor(limit = 8) { this.limit = limit; }
  /** A reusable buffer of exactly n values, for work that depends on the picture and so cannot be cached by position. */
  scratch(slot: number, n: number): Float32Array {
    if (!this.tmp[slot] || this.tmp[slot].length !== n) this.tmp[slot] = new Float32Array(n);
    return this.tmp[slot];
  }
  /** Gradient masks only. A brightness mask depends on the picture, so use rangeAlpha for those. */
  get(m: Mask, w: number, h: number): Float32Array {
    if (m.kind !== 'linear') throw new Error('AlphaCache only holds gradient masks');
    const key = `${m.id}|${m.x1}|${m.y1}|${m.x2}|${m.y2}|${m.invert}|${w}x${h}`;
    let a = this.map.get(key);
    if (a) { this.map.delete(key); this.map.set(key, a); return a; }
    a = linearAlpha(m, w, h);
    this.map.set(key, a);
    if (this.map.size > this.limit) this.map.delete(this.map.keys().next().value as string);
    return a;
  }
  clear(): void { this.map.clear(); }
}

/**
 * Blend every non-neutral mask's edit into `img`, in place. `img` must be a buffer you own (a graded copy, never the source).
 * Masks apply in order, each on top of the one before.
 */
export function applyMasks(img: Img, masks: Mask[] | null | undefined, cache: AlphaCache, scratch: Img = makeImage(img.width, img.height)): Img {
  const w = img.width, h = img.height, d = img.data;
  const list = masks || [];
  // Brightness is read once, before any mask edits, so one mask's result never moves where the next one lands.
  const luma = list.some((m) => m.kind === 'range' && !maskIsNeutral(m)) ? lumaMap(img, cache.scratch(0, w * h)) : null;
  for (const m of list) {
    if (maskIsNeutral(m)) continue;
    const alpha = m.kind === 'range' ? rangeAlpha(m, luma!, cache.scratch(1, w * h)) : cache.get(m, w, h);
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
export interface MaskStarter { id: string; name: string; blurb: string; mask: MaskInput }

export const MASK_STARTERS: MaskStarter[] = [
  { id: 'sky', name: 'Darken the sky', blurb: 'Starts at the top and fades out by the middle. Brings back colour and detail in a bright sky.',
    mask: { x1: 0.5, y1: 0, x2: 0.5, y2: 0.55, adj: { exposure: -0.6, highlights: -30, saturation: 12 } } },
  { id: 'ground', name: 'Lift the ground', blurb: 'Starts at the bottom and fades out by the middle. Opens up a dark foreground.',
    mask: { x1: 0.5, y1: 1, x2: 0.5, y2: 0.45, adj: { exposure: 0.35, shadows: 30 } } },
  { id: 'warm-horizon', name: 'Warm the horizon', blurb: 'A band of warmth from the bottom. Pairs well with a sunset.',
    mask: { x1: 0.5, y1: 0.8, x2: 0.5, y2: 0.3, adj: { temperature: 25, saturation: 10 } } },
];

/** Starting points that pick pixels by how bright they are, wherever they sit in the photo. */
export const RANGE_STARTERS: MaskStarter[] = [
  { id: 'bright', name: 'Tame the brights', blurb: 'Picks the brightest parts, wherever they are. Pulls back blown highlights.',
    mask: { kind: 'range', lo: 0.65, hi: 1, soft: 0.2, adj: { exposure: -0.45, highlights: -35 } } },
  { id: 'dark', name: 'Open the darks', blurb: 'Picks the darkest parts, wherever they are. Brings out shadow detail.',
    mask: { kind: 'range', lo: 0, hi: 0.35, soft: 0.2, adj: { exposure: 0.4, shadows: 30 } } },
  { id: 'cool-shadows', name: 'Cool the shadows', blurb: 'Adds a cooler tint to dark areas only. A classic way to make warm light feel warmer.',
    mask: { kind: 'range', lo: 0, hi: 0.4, soft: 0.25, adj: { temperature: -22, saturation: 8 } } },
];
