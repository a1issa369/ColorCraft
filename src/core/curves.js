// Tone curves, the way Lightroom does them: a handful of draggable points joined by a smooth line.
// Points live in display space (0 = black, 1 = white). The line is a monotone cubic spline, so it can bend but
// can never double back on itself, which would turn bright tones darker than darker ones.
import { clamp } from './color.js';

export const CURVE_STEPS = 4096;
export const IDENTITY = Object.freeze([Object.freeze([0, 0]), Object.freeze([1, 1])]);
export const CHANNELS = ['rgb', 'r', 'g', 'b'];

export const identityCurves = () => ({ rgb: [[0, 0], [1, 1]], r: [[0, 0], [1, 1]], g: [[0, 0], [1, 1]], b: [[0, 0], [1, 1]] });

export function cloneCurves(c) {
  const out = identityCurves();
  if (c) for (const k of CHANNELS) if (c[k]) out[k] = c[k].map((p) => [p[0], p[1]]);
  return out;
}

export function isIdentityPoints(pts) {
  return !pts || pts.every(([x, y]) => Math.abs(x - y) < 1e-9);
}

export const curvesAreIdentity = (c) => !c || CHANNELS.every((k) => isIdentityPoints(c[k]));

/** Sort, clamp and de-duplicate points so the spline is always well defined. */
export function cleanPoints(pts, minGap = 0.01) {
  const sorted = pts
    .map(([x, y]) => [clamp(x, 0, 1), clamp(y, 0, 1)])
    .sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const p of sorted) {
    if (out.length && p[0] - out[out.length - 1][0] < minGap) {
      out[out.length - 1] = out.length === 1 ? [out[out.length - 1][0], p[1]] : p; // later point wins, endpoints keep x
    } else out.push(p);
  }
  if (out[0][0] > 0) out.unshift([0, out[0][1]]);
  if (out[out.length - 1][0] < 1) out.push([1, out[out.length - 1][1]]);
  return out;
}

/** Fritsch-Carlson monotone cubic interpolation. Returns a function y(x). */
export function makeSpline(points) {
  const pts = cleanPoints(points, 1e-6);
  const n = pts.length;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const d = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] <= x) lo = mid; else hi = mid; }
    const h = xs[hi] - xs[lo], t = (x - xs[lo]) / h;
    const t2 = t * t, t3 = t2 * t;
    const y = (2 * t3 - 3 * t2 + 1) * ys[lo] + (t3 - 2 * t2 + t) * h * m[lo] + (-2 * t3 + 3 * t2) * ys[hi] + (t3 - t2) * h * m[hi];
    return clamp(y, 0, 1);
  };
}

/** A lookup table with CURVE_STEPS + 1 entries, ready for fast per-pixel use. */
export function curveLut(points) {
  const f = makeSpline(points);
  const lut = new Float32Array(CURVE_STEPS + 1);
  for (let i = 0; i <= CURVE_STEPS; i++) lut[i] = f(i / CURVE_STEPS);
  return lut;
}

/**
 * One lookup table per colour channel. Each pipeline stage is a set of curves; they are applied in order, and within a
 * stage the combined (RGB) curve runs first and the channel curve second, like Lightroom.
 * Returns null when every stage is a no-op, so the pipeline can skip the work.
 */
export function channelLuts(...stages) {
  const active = stages.filter((s) => s && !curvesAreIdentity(s));
  if (!active.length) return null;
  const luts = [0, 1, 2].map(() => new Float32Array(CURVE_STEPS + 1));
  const keys = ['r', 'g', 'b'];
  for (let c = 0; c < 3; c++) {
    const fns = [];
    for (const s of active) { fns.push(makeSpline(s.rgb || IDENTITY)); fns.push(makeSpline(s[keys[c]] || IDENTITY)); }
    for (let i = 0; i <= CURVE_STEPS; i++) {
      let v = i / CURVE_STEPS;
      for (const f of fns) v = f(v);
      luts[c][i] = v;
    }
  }
  return luts;
}

export function lutLookup(lut, v) {
  // With 4096 steps the nearest entry is within a fraction of one 8-bit level, so no interpolation is needed.
  return lut[(v <= 0 ? 0 : v >= 1 ? CURVE_STEPS : v * CURVE_STEPS + 0.5) | 0];
}

/** Blend a curve toward the straight line. strength 0 is no change, 1 is the full curve. */
export function scaleCurve(points, strength) {
  const s = clamp(strength, 0, 1);
  return points.map(([x, y]) => [x, x + (y - x) * s]);
}

/** Points for the curve "first A, then B", sampled and simplified. */
export function composePoints(a, b, knots = 33, maxPoints = 7) {
  const fa = makeSpline(a), fb = makeSpline(b);
  const pts = [];
  for (let i = 0; i < knots; i++) { const x = i / (knots - 1); pts.push([x, fb(fa(x))]); }
  return simplifyTo(pts, maxPoints);
}

/** Simplify with the smallest tolerance that leaves at most maxPoints, so a baked curve stays easy to drag. */
export function simplifyTo(pts, maxPoints = 7, startTol = 0.004) {
  let tol = startTol, out = simplify(pts, tol);
  while (out.length > maxPoints && tol < 0.5) { tol *= 1.4; out = simplify(pts, tol); }
  return out;
}

/** Ramer-Douglas-Peucker: drop points that sit on the line between their neighbours. */
export function simplify(pts, tol = 0.006) {
  if (pts.length <= 2) return pts.map((p) => [p[0], p[1]]);
  const [x1, y1] = pts[0], [x2, y2] = pts[pts.length - 1];
  let worst = -1, wi = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const t = (pts[i][0] - x1) / (x2 - x1 || 1);
    const dev = Math.abs(pts[i][1] - (y1 + t * (y2 - y1)));
    if (dev > worst) { worst = dev; wi = i; }
  }
  if (worst <= tol) return [[x1, y1], [x2, y2]];
  const left = simplify(pts.slice(0, wi + 1), tol);
  const right = simplify(pts.slice(wi), tol);
  return left.slice(0, -1).concat(right);
}
