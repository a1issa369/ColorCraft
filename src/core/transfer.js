// Match the colour of one photo to another: Reinhard et al., "Color Transfer between Images" (2001).
// Move the source's Lab mean and spread toward the reference's, per channel.
import { SRGB_TO_LIN, linearToLab, labToRgb8, clamp } from './color.js';
import { makeImage } from './image.js';

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
