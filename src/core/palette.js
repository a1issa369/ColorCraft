// The handful of colours a photo is made of: k-means in Lab, deterministic so the same photo always gives the same swatches.
import { SRGB_TO_LIN, linearToLab, labToRgb8, toHex } from './color.js';

const MAX_POINTS = 3000;

export function dominantColors(img, k = 5, iterations = 10) {
  const n = img.width * img.height;
  const step = Math.max(1, Math.floor(n / MAX_POINTS));
  const pts = [];
  const lab = [0, 0, 0];
  for (let p = 0; p < n; p += step) {
    const i = p * 4;
    linearToLab(SRGB_TO_LIN[img.data[i]], SRGB_TO_LIN[img.data[i + 1]], SRGB_TO_LIN[img.data[i + 2]], lab);
    pts.push([lab[0], lab[1], lab[2]]);
  }
  if (pts.length === 0) return [];
  k = Math.min(k, pts.length);

  // Deterministic farthest-point start: begin at the point closest to the mean, then keep adding the point farthest from all chosen.
  const mean = [0, 1, 2].map((c) => pts.reduce((s, q) => s + q[c], 0) / pts.length);
  const dist2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
  let first = 0;
  for (let i = 1; i < pts.length; i++) if (dist2(pts[i], mean) < dist2(pts[first], mean)) first = i;
  const centers = [pts[first].slice()];
  while (centers.length < k) {
    let best = -1, bestD = -1;
    for (let i = 0; i < pts.length; i++) {
      const d = Math.min(...centers.map((c) => dist2(pts[i], c)));
      if (d > bestD) { bestD = d; best = i; }
    }
    centers.push(pts[best].slice());
  }

  const assign = new Int32Array(pts.length);
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < pts.length; i++) {
      let bi = 0, bd = Infinity;
      for (let c = 0; c < k; c++) {
        const d = dist2(pts[i], centers[c]);
        if (d < bd) { bd = d; bi = c; }
      }
      assign[i] = bi;
    }
    const sums = Array.from({ length: k }, () => [0, 0, 0, 0]);
    for (let i = 0; i < pts.length; i++) {
      const s = sums[assign[i]];
      s[0] += pts[i][0]; s[1] += pts[i][1]; s[2] += pts[i][2]; s[3]++;
    }
    for (let c = 0; c < k; c++) if (sums[c][3]) centers[c] = [sums[c][0] / sums[c][3], sums[c][1] / sums[c][3], sums[c][2] / sums[c][3]];
  }
  const sizes = new Array(k).fill(0);
  for (const a of assign) sizes[a]++;
  const out = [0, 0, 0];
  return centers
    .map((c, i) => ({ c, size: sizes[i] }))
    .filter((x) => x.size > 0)
    .sort((x, y) => y.size - x.size)
    .map(({ c, size }) => {
      labToRgb8(c[0], c[1], c[2], out);
      return { hex: toHex(out[0], out[1], out[2]), share: size / pts.length };
    });
}
