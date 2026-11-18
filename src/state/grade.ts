// Turning settings into pixels. Pure functions: no DOM, so they run (and are tested) under Node as well as in the browser.
import { applyAdjustments, combine } from '../core/adjust.ts';
import type { Adjustments } from '../core/adjust.ts';
import { lookById } from '../core/looks.ts';
import { applyMasks, AlphaCache, masksAreNeutral } from '../core/mask.ts';
import { lookProfile, matchLook } from '../core/transfer.ts';
import { makeImage } from '../core/image.ts';
import type { Img } from '../core/types.ts';
import type { Settings } from './types.ts';

/** Three scratch images, reused between frames so a drag does not allocate megabytes per frame. */
export interface Buffers { a: Img; b: Img; c: Img }
export const makeBuffers = (img: Img): Buffers => ({
  a: makeImage(img.width, img.height), b: makeImage(img.width, img.height), c: makeImage(img.width, img.height),
});

/** The user's adjustments with the chosen look stacked on top. */
export function effectiveAdj(s: Settings): Adjustments {
  const look = lookById(s.look);
  return look ? combine(s.adj, look.adj, s.lookStrength) : s.adj;
}

/**
 * The full grade: global adjustments and look, then reference matching, then local masks last.
 * With `bufs` the result lives in one of those buffers (valid until the next call); without, it is freshly allocated.
 */
export function gradeImage(img: Img, s: Settings, cache: AlphaCache, bufs?: Buffers): Img {
  let out = applyAdjustments(img, effectiveAdj(s), bufs?.a);
  if (s.ref && (s.ref.tone > 0 || s.ref.color > 0)) {
    out = matchLook(out, lookProfile(out), s.ref.profile, { tone: s.ref.tone, color: s.ref.color }, bufs?.b);
  }
  // `out` is one of our own buffers, so it is safe to blend the masks into it.
  if (!masksAreNeutral(s.masks)) out = applyMasks(out, s.masks, cache, bufs?.c);
  return out;
}
