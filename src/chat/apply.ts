// Carries out the assistant's checked actions on a copy of the settings. Pure: it returns what the settings
// should become, plus a plain list of what changed. The caller decides how to commit it as one undo step.
import { MAX_MASKS, makeMask } from '../core/mask.ts';
import { describeChanges } from '../state/agent.ts';
import { cloneSettings, makeSettings } from '../state/store.ts';
import type { Settings } from '../state/types.ts';
import { AREA_MASKS } from './actions.ts';
import type { Action } from './actions.ts';

export interface Applied {
  settings: Settings;
  changes: string[];     // short, in the words of the controls
  undo: boolean;         // the model asked to undo; nothing else was applied
  match: boolean;        // the model asked to run the reference match
  problems: string[];    // things that could not be done, in plain words
}

export function applyActions(base: Settings, actions: Action[]): Applied {
  if (actions.some((a) => a.tool === 'undo')) return { settings: base, changes: [], undo: true, match: false, problems: [] };
  let next = cloneSettings(base);
  let match = false;
  const problems: string[] = [];
  for (const a of actions) {
    switch (a.tool) {
      case 'edit_photo':
        for (const [k, v] of Object.entries(a.adj)) (next.adj as unknown as Record<string, number>)[k] = v;
        if (a.shadowTint) next.adj.splitShadow = { ...a.shadowTint };
        if (a.highlightTint) next.adj.splitHighlight = { ...a.highlightTint };
        if (a.look !== undefined) {
          next.look = a.look;
          if (a.look) next.lookStrength = a.lookStrength ?? 1;
        }
        break;
      case 'add_mask': {
        if (next.masks.length >= MAX_MASKS) { problems.push(`You already have ${MAX_MASKS} masks, the most there can be.`); break; }
        const m = makeMask({ ...AREA_MASKS[a.area], adj: a.adj });
        next.masks.push(m); next.maskSel = m.id;
        break;
      }
      case 'clear_masks': next.masks = []; next.maskSel = null; break;
      case 'reset_all': next = makeSettings(); break;
      case 'match_reference': match = true; break;
    }
  }
  // "Contrast 0 to +15" reads better in a chat bubble as "Contrast +15".
  const changes = describeChanges(base, next).map((c) => c.replace(/^(.*?) \S+(?: stops)? to (.*)$/, '$1 $2'));
  return { settings: next, changes, undo: false, match, problems };
}

/** True when two settings differ in anything the person can see or edit. */
export function differs(a: Settings, b: Settings): boolean {
  return JSON.stringify([a.adj, a.look, a.lookStrength, a.masks]) !== JSON.stringify([b.adj, b.look, b.lookStrength, b.masks]);
}
