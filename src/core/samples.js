// Practice photos, drawn in code so the app works with no uploads and the tests have known inputs.
// A midday coast is rendered once, then degraded in specific, nameable ways.
import { makeImage } from './image.js';
import { applyAdjustments, makeAdjustments } from './adjust.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mix = (a, b, t) => a + (b - a) * t;

export function renderCoast(width = 960, height = 640, seed = 7) {
  const img = makeImage(width, height);
  const rand = rng(seed);
  const horizon = 0.52;
  const sunU = 0.68;
  const sunV = horizon - 0.1;
  const aspect = width / height;
  const sky = [[84, 124, 182], [124, 160, 210], [172, 200, 226], [220, 226, 232]];
  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) / height;
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width;
      let r, g, b;
      if (v < horizon) {
        const t = v / horizon;
        const seg = Math.min(2, Math.floor(t * 3));
        const k = t * 3 - seg;
        r = mix(sky[seg][0], sky[seg + 1][0], k);
        g = mix(sky[seg][1], sky[seg + 1][1], k);
        b = mix(sky[seg][2], sky[seg + 1][2], k);
        const dist = Math.hypot((u - sunU) * aspect, v - sunV);
        const glow = Math.max(0, 1 - dist / 0.42);
        const g2 = glow * glow;
        r = mix(r, 255, g2 * 0.55);
        g = mix(g, 244, g2 * 0.5);
        b = mix(b, 214, g2 * 0.35);
        if (dist < 0.03) { r = 255; g = 250; b = 238; }
      } else {
        const t = (v - horizon) / (1 - horizon);
        const wave = Math.sin(v * 350 + Math.sin(u * 11.5) * 3) * 0.5 + 0.5;
        const refl = Math.max(0, 1 - Math.abs(u - sunU) / (0.05 + 0.18 * t));
        r = mix(64, 78, t) + wave * 12 + refl * 120 * (1 - t * 0.4) * (0.6 + wave * 0.4);
        g = mix(104, 116, t) + wave * 14 + refl * 110 * (1 - t * 0.4) * (0.6 + wave * 0.4);
        b = mix(112, 122, t) + wave * 14 + refl * 90 * (1 - t * 0.4) * (0.6 + wave * 0.4);
        // pale sand along the bottom: a neutral surface, so white balance can be judged
        const sandEdge = 0.74 + Math.sin(u * 19) * 0.01;
        if (v > sandEdge) {
          const k = 0.86 + 0.14 * Math.sin(u * 48 + v * 20) + (rand() - 0.5) * 0.08;
          const blend = Math.min(1, (v - sandEdge) * height / 8);
          r = mix(r, 188 * k, blend);
          g = mix(g, 160 * k, blend);
          b = mix(b, 118 * k, blend);
        }
        // dark cliffs on the left
        if (u < 0.5) {
          const fall = 1 - u / 0.5;
          const cliffTop = horizon + 0.06 - (0.5 - u) * 0.18 - Math.abs(Math.sin(u * 29)) * 0.022;
          if (v < cliffTop + 0.3 * fall && v > cliffTop - 0.25 * fall) {
            r = 22 + rand() * 8; g = 24 + rand() * 8; b = 30 + rand() * 8;
          }
        }
      }
      const noise = (rand() - 0.5) * 6;
      const i = (y * width + x) * 4;
      img.data[i] = r + noise;
      img.data[i + 1] = g + noise;
      img.data[i + 2] = b + noise;
      img.data[i + 3] = 255;
    }
  }
  return img;
}

export const SAMPLES = [
  { id: 'dark-cool', name: 'Dark and blue', note: 'Underexposed with a cold cast',
    degrade: { exposure: -1.7, temperature: -60, saturation: -8 } },
  { id: 'flat', name: 'Flat and hazy', note: 'Low contrast, washed out',
    degrade: { contrast: -55, saturation: -30, fade: 0.8 } },
  { id: 'orange', name: 'Too orange', note: 'Heavy warm cast, a bit bright',
    degrade: { temperature: 90, tint: 10, exposure: 0.1 } },
];

export function renderSample(id, width = 960, height = 640) {
  const base = renderCoast(width, height);
  const sample = SAMPLES.find((s) => s.id === id);
  if (!sample) return base;
  return applyAdjustments(base, makeAdjustments(sample.degrade));
}
