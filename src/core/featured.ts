// The photos on the home page (files live in public/samples). Each card loops a before and after wipe so a visitor sees what a grade does at a glance.
// The "after" is made by the same engine the editor uses, from the edit listed here, so it is never a faked picture.
import { applyAdjustments, combine, makeAdjustments } from './adjust.ts';
import { lookById } from './looks.ts';
import type { AdjustmentsInput, Img } from './types.ts';

export interface FeaturedEdit { look: string; strength: number; adj: AdjustmentsInput }
export interface Featured {
  id: string;
  file: string;      // path under public/
  name: string;
  note: string;
  focus: { x: number; y: number };   // where the square crop is centred, 0..1 on each axis
  edit: FeaturedEdit;
}

export const FEATURED: Featured[] = [
  { id: 'night-street', file: 'samples/night-street.jpg', name: 'Night street', note: 'Shadows lifted, Clean and bright look',
    focus: { x: 0.5, y: 0.3 }, edit: { look: 'bright', strength: 1, adj: { exposure: 0.55, shadows: 40 } } },
  { id: 'sunset', file: 'samples/sunset.jpg', name: 'Sunset', note: 'Teal and orange look, deeper contrast',
    focus: { x: 0.45, y: 0.5 }, edit: { look: 'teal-orange', strength: 1, adj: { contrast: 22, saturation: 22, exposure: -0.25 } } },
  { id: 'neon-sign', file: 'samples/neon-sign.jpg', name: 'Neon signs', note: 'Neon night look, deeper contrast',
    focus: { x: 0.5, y: 0.5 }, edit: { look: 'neon-night', strength: 1, adj: { contrast: 22, saturation: 10, exposure: -0.2 } } },
];

/** The edit a card shows as its "after": a look on top of a few adjustments. */
export function gradeEdit(img: Img, edit: FeaturedEdit): Img {
  const look = lookById(edit.look);
  return applyAdjustments(img, combine(makeAdjustments(edit.adj), look ? look.adj : {}, edit.strength));
}
