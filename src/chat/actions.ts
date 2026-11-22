// What the chat assistant is allowed to do. The language model can only ask for these few actions, each with a
// small set of named, clamped values, so nothing it says (or is tricked into saying) can do more than move
// sliders, add a gradient or oval mask, pick a look, run the match, or undo. Everything is undoable.
// This file has no DOM and no editor state, so the server and the page both use it to check the same rules.
import { RANGES } from '../core/adjust.ts';
import { LOOKS } from '../core/looks.ts';
import { MASK_KEYS } from '../core/mask.ts';
import type { MaskInput, MaskKey } from '../core/mask.ts';
import type { SliderKey } from '../core/types.ts';

export const SLIDER_KEYS = Object.keys(RANGES) as SliderKey[];
export const MASK_AREAS = ['sky', 'ground', 'bright_areas', 'dark_areas', 'center', 'edges', 'left', 'right'] as const;
export type MaskArea = (typeof MASK_AREAS)[number];
export const LOOK_IDS: readonly string[] = LOOKS.map((l) => l.id);
export const MAX_ACTIONS = 6;

export interface Tint { hue: number; amount: number }

export type Action =
  | { tool: 'edit_photo'; adj: Partial<Record<SliderKey, number>>; shadowTint?: Tint; highlightTint?: Tint; look?: string | null; lookStrength?: number }
  | { tool: 'add_mask'; area: MaskArea; adj: Partial<Record<MaskKey, number>> }
  | { tool: 'clear_masks' }
  | { tool: 'reset_all' }
  | { tool: 'match_reference' }
  | { tool: 'undo' };

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const roundTo = (v: number, step: number) => Number((Math.round(v / step) * step).toFixed(2));

/** Where each named area sits on the photo. Fractions of the photo, like every mask. */
export const AREA_MASKS: Record<MaskArea, MaskInput> = {
  sky: { kind: 'linear', x1: 0.5, y1: 0, x2: 0.5, y2: 0.55 },
  ground: { kind: 'linear', x1: 0.5, y1: 1, x2: 0.5, y2: 0.45 },
  left: { kind: 'linear', x1: 0, y1: 0.5, x2: 0.55, y2: 0.5 },
  right: { kind: 'linear', x1: 1, y1: 0.5, x2: 0.45, y2: 0.5 },
  bright_areas: { kind: 'range', lo: 0.65, hi: 1, soft: 0.2 },
  dark_areas: { kind: 'range', lo: 0, hi: 0.35, soft: 0.2 },
  center: { kind: 'radial', x1: 0.5, y1: 0.5, rx: 0.28, ry: 0.3, feather: 0.5 },
  edges: { kind: 'radial', x1: 0.5, y1: 0.5, rx: 0.5, ry: 0.5, feather: 0.7, invert: true },
};

const tint = (hue: unknown, amount: unknown): Tint | undefined => {
  const a = num(amount);
  if (a === undefined) return undefined;
  const h = num(hue);
  return { hue: roundTo(((h ?? 0) % 360 + 360) % 360, 1), amount: roundTo(clamp(a, 0, 1), 0.01) };
};

/** Turn one tool call from the model into a checked action, or null if it asks for nothing real. Never throws. */
export function cleanAction(name: string, input: unknown): Action | null {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  switch (name) {
    case 'edit_photo': {
      const adj: Partial<Record<SliderKey, number>> = {};
      for (const k of SLIDER_KEYS) {
        const v = num(i[k]);
        if (v === undefined) continue;
        const [lo, hi] = RANGES[k];
        adj[k] = roundTo(clamp(v, lo, hi), k === 'exposure' ? 0.05 : k === 'fade' ? 0.01 : 1);
      }
      const out: Action = { tool: 'edit_photo', adj };
      const st = tint(i.shadow_tint_hue, i.shadow_tint_amount), ht = tint(i.highlight_tint_hue, i.highlight_tint_amount);
      if (st) out.shadowTint = st;
      if (ht) out.highlightTint = ht;
      if (i.look === 'none') out.look = null;
      else if (typeof i.look === 'string' && LOOK_IDS.includes(i.look)) {
        out.look = i.look;
        out.lookStrength = roundTo(clamp(num(i.look_strength) ?? 1, 0, 1), 0.05);
      }
      const changes = Object.keys(adj).length + (st ? 1 : 0) + (ht ? 1 : 0) + (out.look !== undefined ? 1 : 0);
      return changes ? out : null;
    }
    case 'add_mask': {
      if (typeof i.area !== 'string' || !(MASK_AREAS as readonly string[]).includes(i.area)) return null;
      const adj: Partial<Record<MaskKey, number>> = {};
      for (const k of MASK_KEYS) {
        const v = num(i[k]);
        if (v === undefined || v === 0) continue;
        adj[k] = k === 'exposure' ? roundTo(clamp(v, -2, 2), 0.05) : roundTo(clamp(v, -100, 100), 1);
      }
      return Object.keys(adj).length ? { tool: 'add_mask', area: i.area as MaskArea, adj } : null;
    }
    case 'clear_masks': return { tool: 'clear_masks' };
    case 'reset_all': return { tool: 'reset_all' };
    case 'match_reference': return { tool: 'match_reference' };
    case 'undo': return { tool: 'undo' };
    default: return null;
  }
}

export function cleanActions(calls: { name: string; input: unknown }[]): Action[] {
  const out: Action[] = [];
  for (const c of calls) {
    const a = cleanAction(c.name, c.input);
    if (a) out.push(a);
    if (out.length >= MAX_ACTIONS) break;
  }
  return out;
}
