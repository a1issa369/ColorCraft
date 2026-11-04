// Starting points, not magic: each look is just a set of adjustment values, so the person can see exactly what it changed.
export const LOOKS = [
  { id: 'natural', name: 'Natural', blurb: 'A touch of contrast and colour. Hard to dislike.',
    adj: { contrast: 8, saturation: 6 } },
  { id: 'bright', name: 'Clean and bright', blurb: 'Lifted, airy and slightly cool. Good for daylight and food.',
    adj: { exposure: 0.25, contrast: 6, highlights: -15, shadows: 20, saturation: 4, temperature: -4 } },
  { id: 'film', name: 'Warm film', blurb: 'Warm highlights, soft blacks and a little fade.',
    adj: { temperature: 16, tint: 3, contrast: 10, saturation: -8, fade: 0.35,
           splitShadow: { hue: 185, amount: 0.3 }, splitHighlight: { hue: 35, amount: 0.35 } } },
  { id: 'teal-orange', name: 'Teal and orange', blurb: 'Cool shadows against warm skin and light. The blockbuster look.',
    adj: { contrast: 14, saturation: 6, splitShadow: { hue: 195, amount: 0.55 }, splitHighlight: { hue: 30, amount: 0.5 } } },
  { id: 'moody', name: 'Moody', blurb: 'Darker, quieter colour and cooler shadows.',
    adj: { exposure: -0.3, contrast: 18, highlights: -25, shadows: -10, saturation: -14, temperature: -6,
           splitShadow: { hue: 215, amount: 0.35 } } },
  { id: 'bw', name: 'Black and white', blurb: 'No colour, so light and shape do all the work.',
    adj: { saturation: -100, contrast: 16 } },
  { id: 'faded', name: 'Faded', blurb: 'Lifted blacks and soft colour, like an old print.',
    adj: { fade: 0.6, contrast: -10, saturation: -12, temperature: 6 } },
];

export const lookById = (id) => LOOKS.find((l) => l.id === id) || null;
