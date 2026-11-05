// Match the colour of one photo to another: Reinhard et al., "Color Transfer between Images" (2001).
// Move the source's Lab mean and spread toward the reference's, per channel.
import { SRGB_TO_LIN, linearToLab, labToRgb8, clamp } from './color.js';
import { makeImage } from './image.js';
import { simplifyTo } from './curves.js';

const MAX_SAMPLES = 60000;

/** Mean and standard deviation of L, a and b, from an evenly strided sample of pixels. */
export function labStats(img) {
  const n = img.width * img.height;
  const step = Math.max(1, Math.floor(n / MAX_SAMPLES));
  const lab = [0, 0, 0];
  const sum = [0, 0, 0];
  const sq = [0, 0, 0];
  let count = 0;
  for (let p = 0; p < n; p += step) {
    const i = p * 4;
    linearToLab(SRGB_TO_LIN[img.data[i]], SRGB_TO_LIN[img.data[i + 1]], SRGB_TO_LIN[img.data[i + 2]], lab);
    for (let c = 0; c < 3; c++) {
      sum[c] += lab[c];
      sq[c] += lab[c] * lab[c];
    }
    count++;
  }
  const mean = sum.map((s) => s / count);
  const std = sq.map((s, c) => Math.sqrt(Math.max(s / count - mean[c] * mean[c], 0)));
  return { mean, std };
}

// A near-flat source would be stretched enormously to match a busy reference; cap how far the spread may change.
const MIN_RATIO = 0.6;
const MAX_RATIO = 1.6;

/**
 * @param {*} src image to recolour
 * @param {{mean:number[],std:number[]}} srcStats labStats of the (ungraded or graded) source
 * @param {{mean:number[],std:number[]}} refStats labStats of the reference
 * @param {number} strength 0..1: 0 leaves the source alone, 1 fully matches mean and spread
 */
export function transferColor(src, srcStats, refStats, strength, dst = makeImage(src.width, src.height)) {
  const s = clamp(strength, 0, 1);
  const n = src.width * src.height;
  const ratio = [0, 1, 2].map((c) => clamp(refStats.std[c] / Math.max(srcStats.std[c], 1e-3), MIN_RATIO, MAX_RATIO));
  const lab = [0, 0, 0];
  const out = [0, 0, 0];
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    linearToLab(SRGB_TO_LIN[src.data[i]], SRGB_TO_LIN[src.data[i + 1]], SRGB_TO_LIN[src.data[i + 2]], lab);
    const L = lab[0] + s * ((lab[0] - srcStats.mean[0]) * ratio[0] + refStats.mean[0] - lab[0]);
    const a = lab[1] + s * ((lab[1] - srcStats.mean[1]) * ratio[1] + refStats.mean[1] - lab[1]);
    const b = lab[2] + s * ((lab[2] - srcStats.mean[2]) * ratio[2] + refStats.mean[2] - lab[2]);
    labToRgb8(clamp(L, 0, 100), a, b, out);
    dst.data[i] = out[0];
    dst.data[i + 1] = out[1];
    dst.data[i + 2] = out[2];
    dst.data[i + 3] = src.data[i + 3];
  }
  return dst;
}

// ---------------------------------------------------------------------------------------------------------------
// Look matching: learn a photo's grade (its tones and its colour toning) and apply it to another photo.
//
// Two ideas on top of the plain mean-and-spread transfer above:
//  1. Tones: match the brightness histogram. Each pixel moves to the brightness the reference has at the same rank.
//  2. Toning: measure the reference's colour separately for darks, mids and brights, so "teal shadows, orange
//     highlights" survives. A single global average would wash that out to grey.
// ---------------------------------------------------------------------------------------------------------------
export const TONE_BANDS = [8, 24, 40, 56, 72, 88];   // lightness centres, on the 0..100 scale
const L_BINS = 101;
const MIN_BAND_SAMPLES = 40;
const MAX_SHIFT = 30;       // never move a or b by more than this in Lab units
const MIN_SPREAD = 0.6;
const MAX_SPREAD = 1.6;

/** A compact description of a photo's look. Cheap to compute and to store. */
export function lookProfile(img) {
  const n = img.width * img.height;
  const step = Math.max(1, Math.floor(n / MAX_SAMPLES));
  const hist = new Float64Array(L_BINS);
  const nb = TONE_BANDS.length;
  const w = new Float64Array(nb), sa = new Float64Array(nb), sb = new Float64Array(nb), sa2 = new Float64Array(nb), sb2 = new Float64Array(nb);
  const lab = [0, 0, 0];
  let count = 0, ga = 0, gb = 0, ga2 = 0, gb2 = 0;
  for (let p = 0; p < n; p += step) {
    const i = p * 4;
    linearToLab(SRGB_TO_LIN[img.data[i]], SRGB_TO_LIN[img.data[i + 1]], SRGB_TO_LIN[img.data[i + 2]], lab);
    const L = clamp(lab[0], 0, 100), a = lab[1], b = lab[2];
    hist[Math.round(L)]++;
    count++; ga += a; gb += b; ga2 += a * a; gb2 += b * b;
    const { i0, i1, t } = bandPos(L);
    for (const [bi, wt] of [[i0, 1 - t], [i1, t]]) {
      if (wt <= 0) continue;
      w[bi] += wt; sa[bi] += wt * a; sb[bi] += wt * b; sa2[bi] += wt * a * a; sb2[bi] += wt * b * b;
    }
  }
  const cdf = new Float64Array(L_BINS);
  let run = 0;
  for (let i = 0; i < L_BINS; i++) { run += hist[i]; cdf[i] = count ? run / count : i / (L_BINS - 1); }
  const gm = [count ? ga / count : 0, count ? gb / count : 0];
  const gs = [Math.sqrt(Math.max(count ? ga2 / count - gm[0] ** 2 : 0, 0)), Math.sqrt(Math.max(count ? gb2 / count - gm[1] ** 2 : 0, 0))];
  const bands = [];
  for (let k = 0; k < nb; k++) {
    if (w[k] < MIN_BAND_SAMPLES) { bands.push({ meanA: gm[0], meanB: gm[1], stdA: gs[0], stdB: gs[1], weight: w[k] }); continue; }
    const ma = sa[k] / w[k], mb = sb[k] / w[k];
    bands.push({ meanA: ma, meanB: mb, stdA: Math.sqrt(Math.max(sa2[k] / w[k] - ma * ma, 0)), stdB: Math.sqrt(Math.max(sb2[k] / w[k] - mb * mb, 0)), weight: w[k] });
  }
  return { cdf, bands, samples: count };
}

function bandPos(L) {
  const nb = TONE_BANDS.length;
  if (L <= TONE_BANDS[0]) return { i0: 0, i1: 0, t: 0 };
  if (L >= TONE_BANDS[nb - 1]) return { i0: nb - 1, i1: nb - 1, t: 0 };
  let i = 0;
  while (L > TONE_BANDS[i + 1]) i++;
  return { i0: i, i1: i + 1, t: (L - TONE_BANDS[i]) / (TONE_BANDS[i + 1] - TONE_BANDS[i]) };
}

/** Lightness of the reference at a given rank (0..1), with linear interpolation between bins. */
function quantile(cdf, q) {
  let lo = 0, hi = L_BINS - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cdf[mid] < q) lo = mid; else hi = mid; }
  if (q <= cdf[lo]) return lo;
  const span = cdf[hi] - cdf[lo];
  return span > 1e-9 ? lo + (q - cdf[lo]) / span : hi;
}

function rankOf(cdf, L) {
  const f = clamp(L, 0, 100);
  const k = Math.min(Math.floor(f), L_BINS - 2);
  const t = f - k;
  return cdf[k] * (1 - t) + cdf[k + 1] * t;
}

/**
 * @param src image to recolour
 * @param srcProfile lookProfile(src)
 * @param refProfile lookProfile(reference)
 * @param opts {tone: 0..1, color: 0..1}
 */
export function matchLook(src, srcProfile, refProfile, { tone = 1, color = 1 } = {}, dst = makeImage(src.width, src.height)) {
  const tN = clamp(tone, 0, 1), cN = clamp(color, 0, 1);
  const n = src.width * src.height;
  const nb = TONE_BANDS.length;
  // Per band: how the source's colour should be re-centred and re-scaled to look like the reference's.
  const mapA = [], mapB = [];
  for (let k = 0; k < nb; k++) {
    const s = srcProfile.bands[k], r = refProfile.bands[k];
    const ra = clamp(r.stdA / Math.max(s.stdA, 1e-3), MIN_SPREAD, MAX_SPREAD);
    const rb = clamp(r.stdB / Math.max(s.stdB, 1e-3), MIN_SPREAD, MAX_SPREAD);
    mapA.push({ sm: s.meanA, rm: r.meanA, ratio: ra });
    mapB.push({ sm: s.meanB, rm: r.meanB, ratio: rb });
  }
  const lab = [0, 0, 0], out = [0, 0, 0];
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    linearToLab(SRGB_TO_LIN[src.data[i]], SRGB_TO_LIN[src.data[i + 1]], SRGB_TO_LIN[src.data[i + 2]], lab);
    const L0 = clamp(lab[0], 0, 100);
    let L = L0;
    if (tN > 0) L = L0 + tN * (quantile(refProfile.cdf, rankOf(srcProfile.cdf, L0)) - L0);
    let a = lab[1], b = lab[2];
    if (cN > 0) {
      const { i0, i1, t } = bandPos(L0);
      const ma = mapA[i0], mb2 = mapA[i1], na = mapB[i0], nb2 = mapB[i1];
      const sA = ma.sm * (1 - t) + mb2.sm * t, rA = ma.rm * (1 - t) + mb2.rm * t, kA = ma.ratio * (1 - t) + mb2.ratio * t;
      const sB = na.sm * (1 - t) + nb2.sm * t, rB = na.rm * (1 - t) + nb2.rm * t, kB = na.ratio * (1 - t) + nb2.ratio * t;
      const ta = clamp((a - sA) * kA + rA - a, -MAX_SHIFT, MAX_SHIFT);
      const tb = clamp((b - sB) * kB + rB - b, -MAX_SHIFT, MAX_SHIFT);
      a += cN * ta;
      b += cN * tb;
    }
    labToRgb8(clamp(L, 0, 100), a, b, out);
    dst.data[i] = out[0];
    dst.data[i + 1] = out[1];
    dst.data[i + 2] = out[2];
    dst.data[i + 3] = src.data[i + 3];
  }
  return dst;
}

/**
 * Turn the difference between two versions of the same photo into editable curves. For each colour channel, bin the
 * source by value and average what the result did there. The result is smoothed to a rising line and simplified to a
 * few points a person can drag.
 */
export function fitCurves(before, after, knots = 9, maxPoints = 7) {
  const n = before.width * before.height;
  const out = { rgb: [[0, 0], [1, 1]] };
  const names = ['r', 'g', 'b'];
  const minCount = Math.max(2, n * 0.002);
  for (let c = 0; c < 3; c++) {
    // Each knot sits at the average input value of its bin (not the bin centre, which is biased when pixels bunch up
    // on one side) and records the average output there.
    const sx = new Float64Array(knots), sy = new Float64Array(knots), cnt = new Float64Array(knots);
    for (let p = 0, i = c; p < n; p++, i += 4) {
      const x = before.data[i] / 255;
      const k = Math.round(x * (knots - 1));
      sx[k] += x;
      sy[k] += after.data[i] / 255;
      cnt[k]++;
    }
    const measured = [];
    for (let k = 0; k < knots; k++) if (cnt[k] >= minCount) measured.push([sx[k] / cnt[k], sy[k] / cnt[k]]);
    let pts;
    if (!measured.length) pts = [[0, 0], [1, 1]];
    else {
      const ys = isotonic(measured.map((m) => m[1]));
      pts = measured.map((m, i) => [m[0], clamp(ys[i], 0, 1)]);
      // Past the outermost measured values, keep the nearest measured change (output minus input) going to the edges.
      const first = pts[0], last = pts[pts.length - 1];
      if (first[0] > 0.01) pts.unshift([0, clamp(first[1] - first[0], 0, 1)]);
      if (last[0] < 0.99) pts.push([1, clamp(1 + (last[1] - last[0]), 0, 1)]);
      for (let i = 1; i < pts.length; i++) if (pts[i][1] < pts[i - 1][1]) pts[i][1] = pts[i - 1][1];
    }
    out[names[c]] = simplifyTo(pts, maxPoints, 0.006);
  }
  return out;
}

/** Pool-adjacent-violators: the closest non-decreasing sequence. */
function isotonic(v) {
  const blocks = [];
  for (const y of v) {
    blocks.push({ sum: y, n: 1 });
    while (blocks.length > 1 && blocks[blocks.length - 2].sum / blocks[blocks.length - 2].n > blocks[blocks.length - 1].sum / blocks[blocks.length - 1].n) {
      const b = blocks.pop(), a = blocks.pop();
      blocks.push({ sum: a.sum + b.sum, n: a.n + b.n });
    }
  }
  const out = [];
  for (const b of blocks) for (let i = 0; i < b.n; i++) out.push(b.sum / b.n);
  return out;
}
