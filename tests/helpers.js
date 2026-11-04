import { makeImage } from '../src/core/image.js';

export function solid(w, h, r, g, b) {
  const img = makeImage(w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = r;
    img.data[i + 1] = g;
    img.data[i + 2] = b;
    img.data[i + 3] = 255;
  }
  return img;
}

export function fromFn(w, h, fn) {
  const img = makeImage(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fn(x, y);
      const i = (y * w + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  return img;
}

/** Neutral grey ramp from dark to light, left to right. */
export function greyRamp(w = 128, h = 16, lo = 20, hi = 235) {
  return fromFn(w, h, (x) => {
    const v = lo + (x / (w - 1)) * (hi - lo);
    return [v, v, v];
  });
}

export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomImage(w, h, seed) {
  const r = rng(seed);
  return fromFn(w, h, () => [r() * 255, r() * 255, r() * 255]);
}

export function pixel(img, x = 0, y = 0) {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}

export function maxDiff(a, b) {
  let m = 0;
  for (let i = 0; i < a.data.length; i++) m = Math.max(m, Math.abs(a.data[i] - b.data[i]));
  return m;
}
