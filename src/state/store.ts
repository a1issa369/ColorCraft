// The editor's state. A small external store: plain data in, subscribers told on every change.
// React reads it with useSyncExternalStore (see hooks.ts); the render engine subscribes directly, so dragging a
// slider never has to wait for React to finish a render before the photo can redraw.
import { makeAdjustments } from '../core/adjust.ts';
import { History } from '../core/history.ts';
import { MAX_MASKS, cloneMasks, makeMask } from '../core/mask.ts';
import type { MaskInput } from '../core/mask.ts';
import type { Analysis } from '../core/analyze.ts';
import type { Finding } from '../core/suggest.ts';
import type { EditorState, RefMatch, Settings, TabId } from './types.ts';

export const HISTORY_LIMIT = 100;

export const makeSettings = (): Settings => ({
  adj: makeAdjustments(), look: null, lookStrength: 1, ref: null, masks: [], maskSel: null,
});

export function cloneSettings(s: Settings): Settings {
  return {
    adj: makeAdjustments(s.adj),
    look: s.look,
    lookStrength: s.lookStrength,
    ref: s.ref ? { ...s.ref } : null,
    masks: cloneMasks(s.masks),
    maskSel: s.maskSel,
  };
}

const signature = (s: Settings): string =>
  JSON.stringify([s.adj, s.look, s.lookStrength, s.ref && [s.ref.id, s.ref.tone, s.ref.color], s.masks]);

const initial = (): EditorState => ({
  photoId: 0, hasPhoto: false, settings: makeSettings(), split: 0.5, hold: false, tab: 'read', maskArea: true,
  brush: { size: 0.05, soft: 0.5, erase: false },
  findings: [], stats: null, canUndo: false, canRedo: false, notice: '', error: '',
});

export class EditorStore {
  private state: EditorState = initial();
  private listeners = new Set<() => void>();
  private history = new History<Settings>(HISTORY_LIMIT);
  private refCounter = 0;

  // Arrow properties so they can be handed straight to useSyncExternalStore.
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getState = (): EditorState => this.state;

  private set(patch: Partial<EditorState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of [...this.listeners]) l();
  }

  // ---- photo ----
  openPhoto(findings: Finding[]): void {
    this.history.reset();
    const settings = makeSettings();
    this.set({ photoId: this.state.photoId + 1, hasPhoto: true, settings, split: 0.5, hold: false, tab: 'read', findings, stats: null, error: '', notice: '' });
    this.commit();
  }
  closePhoto(): void { this.set({ hasPhoto: false, stats: null }); }

  // ---- settings ----
  /** Change the settings. `fn` may mutate the draft it is handed; the previous state is left alone. */
  edit(fn: (draft: Settings) => void, opts: { commit?: boolean } = {}): void {
    const draft = cloneSettings(this.state.settings);
    fn(draft);
    this.set({ settings: draft });
    if (opts.commit) this.commit();
  }

  /** Make the current settings an undo step (if they differ from the last one). */
  commit(): void {
    if (!this.state.hasPhoto) return;
    const snap = cloneSettings(this.state.settings);
    if (this.history.commit(snap, signature(snap))) this.syncHistory();
  }

  private restore(snap: Settings | null): void {
    if (!snap) return;
    const settings = cloneSettings(snap);
    settings.maskSel = settings.masks.some((m) => m.id === snap.maskSel) ? snap.maskSel : (settings.masks[0]?.id ?? null);
    this.set({ settings, canUndo: this.history.canUndo, canRedo: this.history.canRedo });
  }
  undo(): void { this.restore(this.history.undo()); }
  redo(): void { this.restore(this.history.redo()); }
  private syncHistory(): void { this.set({ canUndo: this.history.canUndo, canRedo: this.history.canRedo }); }

  reset(): void {
    this.set({ settings: makeSettings() });
    this.commit();
  }

  // ---- reference photo ----
  nextRefId(): number { return ++this.refCounter; }
  setRef(ref: RefMatch | null): void { this.edit((d) => { d.ref = ref; }, { commit: true }); }

  // ---- masks ----
  addMask(spec: MaskInput): void {
    if (this.state.settings.masks.length >= MAX_MASKS) return;
    const m = makeMask(spec);
    this.edit((d) => { d.masks.push(m); d.maskSel = m.id; }, { commit: true });
    this.set({ split: 0 });
  }
  removeSelectedMask(): void {
    this.edit((d) => {
      d.masks = d.masks.filter((m) => m.id !== d.maskSel);
      d.maskSel = d.masks.length ? d.masks[d.masks.length - 1].id : null;
    }, { commit: true });
  }
  selectMask(id: string): void { this.edit((d) => { d.maskSel = id; }); }

  // ---- view ----
  setTab(tab: TabId): void {
    // The left of the photo shows the original, which would hide a mask's effect; show the full result.
    this.set({ tab, split: tab === 'masks' && this.state.split > 0 ? 0 : this.state.split });
  }
  setSplit(split: number): void { this.set({ split: Math.min(1, Math.max(0, split)) }); }
  setHold(hold: boolean): void { if (hold !== this.state.hold) this.set({ hold }); }
  toggleMaskArea(): void { this.set({ maskArea: !this.state.maskArea }); }
  setBrush(b: Partial<EditorState['brush']>): void { this.set({ brush: { ...this.state.brush, ...b } }); }
  setStats(stats: Analysis): void { this.set({ stats }); }
  setNotice(notice: string): void { this.set({ notice }); }
  setError(error: string): void { this.set({ error }); }
}
