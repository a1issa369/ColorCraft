// Local edits. A mask is a soft 0..1 map over the photo; its own small set of adjustments is blended in by that map,
// so the edit lands fully where the mask is 1, not at all where it is 0, and fades in between.
import { applyAdjustments, makeAdjustments } from './adjust.ts';
import { makeImage } from './image.ts';
import type { Img, SliderKey } from './types.ts';

export type MaskKey = Extract<SliderKey, 'exposure' | 'contrast' | 'highlights' | 'shadows' | 'temperature' | 'saturation'>;

export type MaskKind = 'linear' | 'range' | 'radial' | 'brush';

/** One painted stroke. Points are x,y pairs as fractions of the photo; size is a radius as a fraction of the photo's width. */
export interface Stroke { pts: number[]; size: number; soft: number; erase: boolean }

/**
 * A mask with its own small set of adjustments. Two kinds share one shape so saving, undo and cloning stay simple:
 * - 'linear' uses the four point fields (fractions of the photo).
 * - 'range' picks pixels by brightness: full effect between lo and hi (0..1), fading out over `soft` either side.
 * - 'radial' is an oval centred on (x1, y1) with radii rx and ry (fractions of width and height), tilted by `angle`, edge softened by `feather`.
 * - 'brush' is painted by hand: the strokes are the mask.
 */
export interface Mask {
  id: string;
  kind: MaskKind;
  x1: number; y1: number; x2: number; y2: number;
  lo: number; hi: number; soft: number;
  rx: number; ry: number; feather: number;
  angle: number;   // radial only: tilt of the oval in radians, clockwise on screen
  strokes: Stroke[];
  invert: boolean;
  adj: Record<MaskKey, number>;
}

export type MaskInput = Partial<Omit<Mask, 'adj'>> & { adj?: Partial<Record<MaskKey, number>> };

export const MASK_KEYS: readonly MaskKey[] = ['exposure', 'contrast', 'highlights', 'shadows', 'temperature', 'saturation'];
export const MAX_MASKS = 10;
/** Total painted points per brush mask, so a long scribble cannot make the preview crawl. */
export const MAX_BRUSH_POINTS = 6000;

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
    rx: 0.3, ry: 0.25, feather: 0.4, angle: 0,
    invert: false,
    ...over,
    strokes: (over.strokes || []).map((t) => ({ ...t, pts: t.pts.slice() })),
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

/** An oval measured in real pixels, so a wide photo gets a wide oval. Full inside, fading to nothing at the rim over `feather`. */
export function radialAlpha(m: Mask, w: number, h: number, out: Float32Array = new Float32Array(w * h)): Float32Array {
  const cx = m.x1 * w, cy = m.y1 * h;
  const rx = Math.max(1, m.rx * w), ry = Math.max(1, m.ry * h);
  const f = Math.min(1, Math.max(0.01, m.feather));
  const inv = m.invert;
  const ca = Math.cos(m.angle), sa = Math.sin(m.angle);
  for (let y = 0; y < h; y++) {
    const py = y + 0.5 - cy;
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - cx;
      const dx = (px * ca + py * sa) / rx, dy = (-px * sa + py * ca) / ry;   // into the oval's own tilted axes
      const a = 1 - smoothstep01((Math.sqrt(dx * dx + dy * dy) - (1 - f)) / f);
      out[y * w + x] = inv ? 1 - a : a;
    }
  }
  return out;
}

/** Paint every stroke in order into a w*h map. Paint adds to what is there, erase takes away, overlaps never overshoot 1. */
export function brushAlpha(m: Mask, w: number, h: number, out: Float32Array = new Float32Array(w * h)): Float32Array {
  out.fill(0);
  const cover = new Float32Array(w * h);
  for (const st of m.strokes) {
    const R = Math.max(1, st.size * w);
    const core = R * (1 - Math.min(1, Math.max(0, st.soft)));
    const gap = Math.max(1, R * 0.2);
    cover.fill(0);
    const stamp = (cx: number, cy: number) => {
      const x0 = Math.max(0, Math.floor(cx - R)), x1 = Math.min(w - 1, Math.ceil(cx + R));
      const y0 = Math.max(0, Math.floor(cy - R)), y1 = Math.min(h - 1, Math.ceil(cy + R));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
          const v = d <= core ? 1 : d >= R ? 0 : 1 - smoothstep01((d - core) / (R - core));
          if (v > cover[y * w + x]) cover[y * w + x] = v;
        }
      }
    };
    const p = st.pts;
    let px = p[0] * w, py = p[1] * h;
    stamp(px, py);
    for (let i = 2; i + 1 < p.length; i += 2) {
      const qx = p[i] * w, qy = p[i + 1] * h;
      const n = Math.max(1, Math.ceil(Math.hypot(qx - px, qy - py) / gap));
      for (let k = 1; k <= n; k++) stamp(px + ((qx - px) * k) / n, py + ((qy - py) * k) / n);
      px = qx; py = qy;
    }
    if (st.erase) for (let i = 0; i < out.length; i++) out[i] *= 1 - cover[i];
    else for (let i = 0; i < out.length; i++) out[i] += cover[i] - out[i] * cover[i];
  }
  if (m.invert) for (let i = 0; i < out.length; i++) out[i] = 1 - out[i];
  return out;
}

const strokeHash = (list: Stroke[]): string => {
  let h = 2166136261 >>> 0;
  const mix = (v: number) => { h = Math.imul(h ^ Math.round(v * 1e5), 16777619) >>> 0; };
  for (const t of list) { mix(t.size); mix(t.soft); mix(t.erase ? 1 : 0); mix(t.pts.length); for (const v of t.pts) mix(v); }
  return `${list.length}.${h}`;
};

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

/** Remembers the last few position-based maps so a slider drag does not rebuild them every frame. */
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
  /** Masks that depend on position only. A brightness mask depends on the picture, so use rangeAlpha for those. */
  get(m: Mask, w: number, h: number): Float32Array {
    if (m.kind === 'range') throw new Error('AlphaCache holds masks that depend on position only');
    if (m.kind === 'radial' || m.kind === 'brush') {
      const k = m.kind === 'radial'
        ? `${m.id}|o|${m.x1}|${m.y1}|${m.rx}|${m.ry}|${m.feather}|${m.angle}|${m.invert}|${w}x${h}`
        : `${m.id}|b|${strokeHash(m.strokes)}|${m.invert}|${w}x${h}`;
      let hit = this.map.get(k);
      if (hit) { this.map.delete(k); this.map.set(k, hit); return hit; }
      hit = m.kind === 'radial' ? radialAlpha(m, w, h) : brushAlpha(m, w, h);
      this.map.set(k, hit);
      if (this.map.size > this.limit) this.map.delete(this.map.keys().next().value as string);
      return hit;
    }
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
    if (!alpha.some((v) => v > 0)) continue;   // nothing selected (an empty brush, an oval off the photo): skip the whole edit
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

export const OVAL_STARTERS: MaskStarter[] = [
  { id: 'spotlight', name: 'Spotlight the subject', blurb: 'An oval that lifts light and contrast in the middle. Drag it over your subject.',
    mask: { kind: 'radial', x1: 0.5, y1: 0.5, rx: 0.28, ry: 0.3, feather: 0.5, adj: { exposure: 0.4, contrast: 12 } } },
  { id: 'vignette', name: 'Darken the edges', blurb: 'Everything outside a big oval gets darker, which pulls the eye to the middle.',
    mask: { kind: 'radial', x1: 0.5, y1: 0.5, rx: 0.5, ry: 0.5, feather: 0.7, invert: true, adj: { exposure: -0.7 } } },
];

export const BRUSH_STARTERS: MaskStarter[] = [
  { id: 'dodge', name: 'Paint light in', blurb: 'Brush over anything you want brighter, like a face in shade.',
    mask: { kind: 'brush', adj: { exposure: 0.45, shadows: 20 } } },
  { id: 'burn', name: 'Paint light out', blurb: 'Brush over anything you want darker, like a distracting bright patch.',
    mask: { kind: 'brush', adj: { exposure: -0.5 } } },
];
