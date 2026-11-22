// Puts a chat reply's actions into the editor. All edits from one reply become a single undo step.
import type { EditorStore } from '../state/store.ts';
import type { Settings } from '../state/types.ts';
import { cleanActions } from './actions.ts';
import type { Action } from './actions.ts';
import { applyActions, differs } from './apply.ts';

export interface Result { changed: boolean; changes: string[]; extra: string }

export function commitSettings(store: EditorStore, next: Settings): void {
  store.edit((d) => { d.adj = next.adj; d.look = next.look; d.lookStrength = next.lookStrength; d.masks = next.masks; d.maskSel = next.maskSel; d.ref = next.ref; }, { commit: true });
}

/** `actions` come from a server, so they are checked again here before anything touches the editor. */
export function perform(store: EditorStore, engine: { runAgent(): Promise<void> }, raw: Action[]): Result {
  const actions = cleanActions(raw.map((a) => ({ name: (a as { tool?: string }).tool ?? '', input: toInput(a) })));
  const before = store.getState().settings;
  const r = applyActions(before, actions);
  if (r.undo) { store.undo(); return { changed: true, changes: ['Undid the last change'], extra: '' }; }
  const changed = differs(before, r.settings);
  if (changed) commitSettings(store, r.settings);
  const extra: string[] = [...r.problems];
  if (r.match) {
    if (store.getState().agent.ref) void engine.runAgent();
    else extra.push('Add a reference photo with the photo button, then ask me to match it.');
  }
  return { changed: changed || r.match && !!store.getState().agent.ref, changes: r.changes, extra: extra.join(' ') };
}

/** Actions arrive in their checked form; turn them back into the flat tool input `cleanAction` reads. */
function toInput(a: Action): Record<string, unknown> {
  switch (a.tool) {
    case 'edit_photo': return {
      ...a.adj,
      ...(a.shadowTint ? { shadow_tint_hue: a.shadowTint.hue, shadow_tint_amount: a.shadowTint.amount } : {}),
      ...(a.highlightTint ? { highlight_tint_hue: a.highlightTint.hue, highlight_tint_amount: a.highlightTint.amount } : {}),
      ...(a.look !== undefined ? { look: a.look ?? 'none', look_strength: a.lookStrength } : {}),
    };
    case 'add_mask': return { area: a.area, ...a.adj };
    default: return {};
  }
}
