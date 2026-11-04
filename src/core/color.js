// Color math: sRGB <-> linear light <-> CIE Lab (D65). Everything else is built on this.

export const SRGB_TO_LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

const LUT_N = 8192;
const LIN_TO_SRGB = new Float32Array(LUT_N + 1);
for (let i = 0; i <= LUT_N; i++) {
  const x = i / LUT_N;
  LIN_TO_SRGB[i] = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

/** Linear light (0..1) to sRGB-encoded (0..1). Values outside 0..1 are clamped. */
export function encode(x) {
  if (!(x > 0)) return 0;
  if (x >= 1) return 1;
  const f = x * LUT_N;
  const i = f | 0;
  const t = f - i;
  return LIN_TO_SRGB[i] * (1 - t) + LIN_TO_SRGB[i + 1] * t;
}

/** sRGB-encoded (0..1) to linear light (0..1), exact formula. */
export function decode(c) {
  if (!(c > 0)) return 0;
  if (c >= 1) return 1;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

const XN = 0.95047;
const YN = 1.0;
const ZN = 1.08883;
const EPS = 216 / 24389;
const KAPPA = 24389 / 27;

const f = (t) => (t > EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116);
const finv = (t) => {
  const t3 = t * t * t;
  return t3 > EPS ? t3 : (116 * t - 16) / KAPPA;
};

/** Linear sRGB (0..1 each) to Lab, written into out[0..2]. */
export function linearToLab(r, g, b, out) {
  const x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = 0.0193339 * r + 0.119192 * g + 0.9503041 * b;
  const fx = f(x / XN);
  const fy = f(y / YN);
  const fz = f(z / ZN);
  out[0] = 116 * fy - 16;
  out[1] = 500 * (fx - fy);
  out[2] = 200 * (fy - fz);
}

/** Lab to linear sRGB (not clamped), written into out[0..2]. */
export function labToLinear(L, a, b, out) {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const x = XN * finv(fx);
  const y = YN * finv(fy);
  const z = ZN * finv(fz);
  out[0] = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  out[1] = -0.969266 * x + 1.8760108 * y + 0.041556 * z;
  out[2] = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;
}

/** 8-bit sRGB to Lab. */
export function rgb8ToLab(r, g, b, out) {
  linearToLab(SRGB_TO_LIN[r], SRGB_TO_LIN[g], SRGB_TO_LIN[b], out);
}

/** Lab to 8-bit sRGB (0..255, clamped to gamut), written into out[0..2]. */
export function labToRgb8(L, a, b, out) {
  labToLinear(L, a, b, out);
  out[0] = encode(out[0]) * 255;
  out[1] = encode(out[1]) * 255;
  out[2] = encode(out[2]) * 255;
}

export function toHex(r, g, b) {
  const h = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
