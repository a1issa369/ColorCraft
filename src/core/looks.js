// Starting points, not magic: each look is just slider values, a curve and a colour mix, so the person can see
// exactly what it changed. Looks are grouped by feel.
import { hslBands } from './hsl.js';

const flat = [[0, 0], [1, 1]];
const curves = (o) => ({ rgb: flat, r: flat, g: flat, b: flat, ...o });

export const LOOK_GROUPS = ['Natural', 'Film', 'Cinematic', 'Moody', 'Mono'];

export const LOOKS = [
  // Natural
  { id: 'natural', group: 'Natural', name: 'Natural', blurb: 'A touch of contrast and colour. Hard to dislike.',
    adj: { contrast: 8, saturation: 6 } },
  { id: 'bright', group: 'Natural', name: 'Clean and bright', blurb: 'Lifted, airy and slightly cool. Good for daylight and food.',
    adj: { exposure: 0.25, contrast: 6, highlights: -15, shadows: 20, saturation: 4, temperature: -4 } },
  { id: 'soft-skin', group: 'Natural', name: 'Soft skin', blurb: 'Gentler contrast, warmer tones and calmer reds. Kind to portraits.',
    adj: { exposure: 0.15, contrast: -6, highlights: -10, shadows: 14, temperature: 6, saturation: -3,
           hsl: hslBands({ red: { s: -18, l: 8 }, orange: { s: -10, l: 10 }, yellow: { s: -12 } }) } },

  // Film
  { id: 'film', group: 'Film', name: 'Warm film', blurb: 'Warm highlights, soft blacks and a little fade.',
    adj: { temperature: 16, tint: 3, contrast: 10, saturation: -8, fade: 0.35,
           splitShadow: { hue: 185, amount: 0.3 }, splitHighlight: { hue: 35, amount: 0.35 } } },
  { id: 'gold-400', group: 'Film', name: 'Golden 400', blurb: 'Rich yellows, creamy highlights and a hint of grain-era warmth.',
    adj: { temperature: 18, tint: 4, contrast: 10, saturation: 6,
           curves: curves({ b: [[0, 0.03], [0.5, 0.46], [1, 0.94]], r: [[0, 0], [0.5, 0.53], [1, 1]] }),
           hsl: hslBands({ yellow: { s: 22, h: -6 }, orange: { s: 8 }, green: { h: -14, s: -10 }, blue: { s: -12 } }) } },
  { id: 'matte', group: 'Film', name: 'Matte', blurb: 'Lifted blacks, softened whites. A calm, printed feel.',
    adj: { contrast: 6, saturation: -6, curves: curves({ rgb: [[0, 0.07], [0.5, 0.5], [1, 0.94]] }) } },
  { id: 'faded', group: 'Film', name: 'Faded', blurb: 'Lifted blacks and soft colour, like an old print.',
    adj: { fade: 0.6, contrast: -10, saturation: -12, temperature: 6 } },

  // Cinematic
  { id: 'teal-orange', group: 'Cinematic', name: 'Teal and orange', blurb: 'Blues slide to teal, skin and sand get warmer. The blockbuster look.',
    adj: { contrast: 14, saturation: 4, splitShadow: { hue: 195, amount: 0.5 }, splitHighlight: { hue: 30, amount: 0.45 },
           hsl: hslBands({ orange: { s: 18, l: 4 }, blue: { h: -55, s: 10 }, aqua: { s: 12 }, green: { h: -25, s: -25 } }) } },
  { id: 'golden-hour', group: 'Cinematic', name: 'Golden hour', blurb: 'Late sun: warm light, glowing highlights, softened shadows.',
    adj: { temperature: 28, tint: 3, highlights: -14, shadows: 18, contrast: 8, saturation: 8,
           splitHighlight: { hue: 40, amount: 0.4 }, hsl: hslBands({ yellow: { s: 14 }, orange: { s: 12 }, blue: { s: -15, h: -20 } }) } },
  { id: 'neon-night', group: 'Cinematic', name: 'Neon night', blurb: 'Deep blue shadows with hot magenta and cyan lights. For city nights.',
    adj: { exposure: -0.1, contrast: 20, shadows: -8, saturation: 10, temperature: -6,
           splitShadow: { hue: 225, amount: 0.55 }, splitHighlight: { hue: 335, amount: 0.35 },
           hsl: hslBands({ magenta: { s: 30, l: 4 }, aqua: { s: 24, l: 6 }, blue: { s: 18 }, orange: { s: 8 } }),
           curves: curves({ rgb: [[0, 0], [0.25, 0.19], [0.75, 0.82], [1, 1]] }) } },
  { id: 'dream', group: 'Cinematic', name: 'Dreamy', blurb: 'Hazy glow, lifted shadows and creamy colour. Summer evenings.',
    adj: { exposure: 0.2, contrast: -12, highlights: -8, shadows: 20, saturation: 4, temperature: 10, fade: 0.25,
           curves: curves({ rgb: [[0, 0.04], [0.5, 0.54], [1, 0.97]] }), splitHighlight: { hue: 45, amount: 0.3 } } },

  // Moody
  { id: 'moody', group: 'Moody', name: 'Moody', blurb: 'Darker, quieter colour and cooler shadows.',
    adj: { exposure: -0.3, contrast: 18, highlights: -25, shadows: -10, saturation: -14, temperature: -6,
           splitShadow: { hue: 215, amount: 0.35 } } },
  { id: 'forest', group: 'Moody', name: 'Deep forest', blurb: 'Greens turn dark and cool, everything else holds still.',
    adj: { exposure: -0.2, contrast: 16, shadows: -6, saturation: -4,
           hsl: hslBands({ green: { h: -22, s: -12, l: -30 }, yellow: { h: -20, s: -20, l: -16 }, aqua: { l: -12 } }) } },
  { id: 'cold', group: 'Moody', name: 'Cold steel', blurb: 'Cool, drained and crisp. Winter and concrete.',
    adj: { temperature: -26, contrast: 14, saturation: -14, highlights: -8, splitShadow: { hue: 220, amount: 0.4 } } },

  // Mono
  { id: 'bw', group: 'Mono', name: 'Black and white', blurb: 'No colour, so light and shape do all the work.',
    adj: { saturation: -100, contrast: 16 } },
  { id: 'bw-punch', group: 'Mono', name: 'Punchy mono', blurb: 'Deep blacks and bright whites with a strong S curve.',
    adj: { saturation: -100, contrast: 24, curves: curves({ rgb: [[0, 0], [0.25, 0.16], [0.75, 0.86], [1, 1]] }) } },
  { id: 'bw-film', group: 'Mono', name: 'Silver film', blurb: 'Soft blacks and a gentle roll-off, like a scanned negative.',
    adj: { saturation: -100, contrast: 10, fade: 0.3, curves: curves({ rgb: [[0, 0.04], [0.5, 0.5], [1, 0.95]] }) } },
];

export const lookById = (id) => LOOKS.find((l) => l.id === id) || null;
