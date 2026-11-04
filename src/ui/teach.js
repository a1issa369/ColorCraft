// What each slider does, in plain words. Shown under the slider so the controls teach as they are used.
export const CONTROLS = [
  { key: 'exposure', name: 'Exposure', min: -2, max: 2, step: 0.05, fmt: (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)} stops`,
    tip: 'Overall brightness. One stop doubles or halves the light.' },
  { key: 'contrast', name: 'Contrast', min: -100, max: 100, step: 1,
    tip: 'Pushes brights brighter and darks darker. Too much loses detail at both ends.' },
  { key: 'highlights', name: 'Highlights', min: -100, max: 100, step: 1,
    tip: 'Only the bright parts. Pull down to bring back sky or a bright window.' },
  { key: 'shadows', name: 'Shadows', min: -100, max: 100, step: 1,
    tip: 'Only the dark parts. Lift to see into dark corners, lower for drama.' },
  { key: 'temperature', name: 'Temperature', min: -100, max: 100, step: 1,
    tip: 'Blue to orange. Warm feels like sunset, cool feels like shade or night.' },
  { key: 'tint', name: 'Tint', min: -100, max: 100, step: 1,
    tip: 'Green to magenta. Use it to correct the odd cast from fluorescent light.' },
  { key: 'saturation', name: 'Saturation', min: -100, max: 100, step: 1,
    tip: 'Colour strength. A little goes a long way; skin tones go wrong first.' },
  { key: 'fade', name: 'Fade', min: 0, max: 1, step: 0.01, fmt: (v) => `${Math.round(v * 100)}%`,
    tip: 'Lifts the blacks to grey for a soft, filmic feel.' },
];

export const MATCH_HELP = 'Picks up the reference photo\'s overall colour balance. Works best when both photos are lit similarly.';
