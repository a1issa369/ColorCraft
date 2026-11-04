// Measure a photo: brightness, clipping, contrast, color cast and saturation.
import { SRGB_TO_LIN, encode, linearToLab } from './color.js';

export const CHROMA_GRID = 48;
export const CHROMA_RANGE = 60; // the scope shows a* and b* from -60 to +60
const CAST_SIGMA = 60;           // pixels with very strong colour count less toward the cast (soft weight)
const MIN_CAST_SHARE = 0.08;     // below this share of mid and bright pixels there is nothing to judge a cast from

function percentile(hist, total, q) {
  const target = total * q;
  let sum = 0;
  for (let i = 0; i < 256; i++) {
    sum += hist[i];
    if (sum >= target) return i / 255;
  }
  return 1;
}

/**
 * @param {{width:number,height:number,data:Uint8ClampedArray}} img
 */
export function analyze(img) {
  const { width, height, data } = img;
  const n = width * height;
  const luma = new Float64Array(256);
  const hr = new Float64Array(256);
  const hg = new Float64Array(256);
  const hb = new Float64Array(256);
  const grid = new Uint32Array(CHROMA_GRID * CHROMA_GRID);
  const lab = [0, 0, 0];

  let castA = 0, castB = 0, castW = 0, castN = 0;
  let chromaSum = 0, chromaN = 0;
  let sumA = 0, sumB = 0, sumA2 = 0, sumB2 = 0;
  let clipLo = 0, clipHi = 0;

  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const lr = SRGB_TO_LIN[r], lg = SRGB_TO_LIN[g], lb = SRGB_TO_LIN[b];
    const y = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
    const bin = Math.round(encode(y) * 255);
    luma[bin]++;
    hr[r]++;
    hg[g]++;
    hb[b]++;
    if (bin <= 3) clipLo++;
    if (r >= 253 || g >= 253 || b >= 253) clipHi++;

    linearToLab(lr, lg, lb, lab);
    const L = lab[0], a = lab[1], bb = lab[2];
    const C = Math.hypot(a, bb);
    if (L > 5 && L < 95) {
      chromaSum += C;
      chromaN++;
      sumA += a;
      sumB += bb;
      sumA2 += a * a;
      sumB2 += bb * bb;
    }
    // Gray-world estimate over mid and bright pixels. Strongly coloured pixels (a red door, a blue sea) get less weight.
    if (L >= 30 && L <= 92) {
      const w = Math.exp(-(C * C) / (2 * CAST_SIGMA * CAST_SIGMA));
      castA += w * a;
      castB += w * bb;
      castW += w;
      castN++;
    }
    const gx = Math.floor(((a + CHROMA_RANGE) / (2 * CHROMA_RANGE)) * CHROMA_GRID);
    const gy = Math.floor(((bb + CHROMA_RANGE) / (2 * CHROMA_RANGE)) * CHROMA_GRID);
    if (gx >= 0 && gx < CHROMA_GRID && gy >= 0 && gy < CHROMA_GRID) grid[gy * CHROMA_GRID + gx]++;
  }

  // The cast is how far the average colour of the mid and bright pixels sits from grey. This is the classic
  // "gray world" assumption: it works on photos with a mix of colours and is fooled by photos dominated by
  // one colour (a blue sea, a green forest), so the wording of the findings stays hedged.
  const reliable = castN >= MIN_CAST_SHARE * n && castW > 0;
  const meanA = reliable ? castA / castW : 0;
  const meanB = reliable ? castB / castW : 0;

  const norm = (h) => Float32Array.from(h, (v) => v / Math.max(n, 1));
  return {
    width,
    height,
    pixels: n,
    hist: { luma: norm(luma), r: norm(hr), g: norm(hg), b: norm(hb) },
    p1: percentile(luma, n, 0.01),
    p5: percentile(luma, n, 0.05),
    median: percentile(luma, n, 0.5),
    p95: percentile(luma, n, 0.95),
    p99: percentile(luma, n, 0.99),
    shadowClip: n ? clipLo / n : 0,
    highlightClip: n ? clipHi / n : 0,
    spread: percentile(luma, n, 0.95) - percentile(luma, n, 0.05),
    chroma: chromaN ? chromaSum / chromaN : 0,
    // How varied the colours are. A tinted black and white photo has colour but only one hue, so this stays near zero.
    colorSpread: chromaN
      ? Math.sqrt(Math.max(0, sumA2 / chromaN - (sumA / chromaN) ** 2) + Math.max(0, sumB2 / chromaN - (sumB / chromaN) ** 2))
      : 0,
    cast: { a: meanA, b: meanB, magnitude: Math.hypot(meanA, meanB), reliable },
    chromaGrid: grid,
  };
}
