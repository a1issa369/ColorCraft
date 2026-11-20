import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorStore, HISTORY_LIMIT, cloneSettings, makeSettings } from '../src/state/store.ts';
import { MAX_MASKS } from '../src/core/mask.ts';
import type { Finding } from '../src/core/suggest.ts';

const finding: Finding = { id: 'ok', severity: 0, title: 'Balanced', detail: '', fix: null };
const open = () => { const s = new EditorStore(); s.openPhoto([finding]); return s; };

test('a new store has no photo and nothing to undo', () => {
  const s = new EditorStore();
  assert.equal(s.getState().hasPhoto, false);
  assert.equal(s.getState().canUndo, false);
  assert.equal(s.getState().canRedo, false);
});

test('opening a photo resets settings and history, and counts photos', () => {
  const s = open();
  s.edit((d) => { d.adj.exposure = 1; }, { commit: true });
  s.openPhoto([finding]);
  assert.equal(s.getState().photoId, 2);
  assert.equal(s.getState().settings.adj.exposure, 0);
  assert.equal(s.getState().canUndo, false);
  assert.equal(s.getState().findings.length, 1);
});

test('edit leaves the previous state untouched and notifies subscribers once', () => {
  const s = open();
  const before = s.getState();
  let calls = 0;
  s.subscribe(() => { calls++; });
  s.edit((d) => { d.adj.contrast = 30; });
  assert.equal(before.settings.adj.contrast, 0);
  assert.equal(s.getState().settings.adj.contrast, 30);
  assert.notEqual(s.getState().settings, before.settings);
  assert.equal(calls, 1);
});

test('undo and redo step through committed edits only', () => {
  const s = open();
  s.edit((d) => { d.adj.exposure = 0.5; });          // live drag, not committed
  s.edit((d) => { d.adj.exposure = 1; }, { commit: true });
  s.edit((d) => { d.look = 'film'; }, { commit: true });
  assert.equal(s.getState().canUndo, true);
  s.undo();
  assert.equal(s.getState().settings.look, null);
  assert.equal(s.getState().settings.adj.exposure, 1);
  s.undo();
  assert.equal(s.getState().settings.adj.exposure, 0);
  assert.equal(s.getState().canUndo, false);
  assert.equal(s.getState().canRedo, true);
  s.redo(); s.redo();
  assert.equal(s.getState().settings.look, 'film');
  assert.equal(s.getState().canRedo, false);
});

test('committing an unchanged edit does not add an undo step', () => {
  const s = open();
  s.edit((d) => { d.adj.exposure = 1; }, { commit: true });
  s.commit(); s.commit();
  s.undo();
  assert.equal(s.getState().settings.adj.exposure, 0);
  assert.equal(s.getState().canUndo, false);
});

test('an edit after an undo drops the redo branch', () => {
  const s = open();
  s.edit((d) => { d.adj.exposure = 1; }, { commit: true });
  s.undo();
  s.edit((d) => { d.adj.contrast = 10; }, { commit: true });
  assert.equal(s.getState().canRedo, false);
});

test('history is capped', () => {
  const s = open();
  for (let i = 1; i <= HISTORY_LIMIT + 20; i++) s.edit((d) => { d.adj.exposure = i / 100; }, { commit: true });
  let steps = 0;
  while (s.getState().canUndo) { s.undo(); steps++; }
  assert.ok(steps <= HISTORY_LIMIT, `${steps} undo steps`);
});

test('reset clears every edit but can itself be undone', () => {
  const s = open();
  s.edit((d) => { d.adj.exposure = 1; d.look = 'film'; }, { commit: true });
  s.addMask({ x1: 0.5, y1: 0, x2: 0.5, y2: 0.5, adj: { exposure: -0.5 } });
  s.reset();
  assert.equal(s.getState().settings.adj.exposure, 0);
  assert.equal(s.getState().settings.look, null);
  assert.equal(s.getState().settings.masks.length, 0);
  s.undo();
  assert.equal(s.getState().settings.masks.length, 1);
});

test('masks: add selects it and shows the full result, the count is capped, remove picks another', () => {
  const s = open();
  assert.equal(s.getState().split, 0.5);
  s.addMask({});
  assert.equal(s.getState().split, 0);
  assert.equal(s.getState().settings.maskSel, s.getState().settings.masks[0].id);
  for (let i = 0; i < MAX_MASKS + 2; i++) s.addMask({});
  assert.equal(s.getState().settings.masks.length, MAX_MASKS);
  const all = s.getState().settings.masks;
  const first = all[0], last = all[all.length - 1];
  s.selectMask(first.id);
  s.removeSelectedMask();
  assert.equal(s.getState().settings.masks.length, MAX_MASKS - 1);
  assert.equal(s.getState().settings.maskSel, last.id);
});

test('undo restores a valid mask selection', () => {
  const s = open();
  s.addMask({});
  s.removeSelectedMask();
  s.undo();
  assert.equal(s.getState().settings.masks.length, 1);
  assert.equal(s.getState().settings.maskSel, s.getState().settings.masks[0].id);
});

test('entering the masks tab shows the full result; other tabs leave the split alone', () => {
  const s = open();
  s.setSplit(0.7);
  s.setTab('adjust');
  assert.equal(s.getState().split, 0.7);
  s.setTab('masks');
  assert.equal(s.getState().split, 0);
});

test('split is kept inside 0..1', () => {
  const s = open();
  s.setSplit(-3); assert.equal(s.getState().split, 0);
  s.setSplit(9); assert.equal(s.getState().split, 1);
});

test('cloneSettings is deep for everything an edit can change', () => {
  const a = makeSettings();
  a.adj.hsl = { hue: Array(8).fill(0), sat: Array(8).fill(0), lum: Array(8).fill(0) };
  a.masks.push(...(() => { const s = new EditorStore(); s.openPhoto([]); s.addMask({}); return s.getState().settings.masks; })());
  const b = cloneSettings(a);
  b.adj.hsl!.sat[0] = 50; b.masks[0].adj.exposure = 1; b.adj.exposure = 2;
  assert.equal(a.adj.hsl!.sat[0], 0);
  assert.equal(a.masks[0].adj.exposure, 0);
  assert.equal(a.adj.exposure, 0);
});

test('closing the photo hides the editor but keeps nothing stale on screen', () => {
  const s = open();
  s.closePhoto();
  assert.equal(s.getState().hasPhoto, false);
  assert.equal(s.getState().stats, null);
});

test('a brush stroke is one undo step, and the brush tool settings are not part of the edit', () => {
  const s = open();
  s.addMask({ kind: 'brush', adj: { exposure: 0.3 } });
  const id = s.getState().settings.maskSel;
  const paint = (x: number) => s.edit((d) => { d.masks.find((m) => m.id === id)!.strokes.push({ pts: [x, 0.5], size: 0.05, soft: 0.5, erase: false }); });
  paint(0.2); paint(0.4);
  s.commit();
  s.setBrush({ size: 0.12, erase: true });
  assert.equal(s.getState().canUndo, true);
  assert.equal(s.getState().settings.masks[0].strokes.length, 2);
  s.undo();
  assert.equal(s.getState().settings.masks[0].strokes.length, 0);
  s.redo();
  assert.equal(s.getState().settings.masks[0].strokes.length, 2);
  assert.equal(s.getState().brush.size, 0.12);
  assert.equal(s.getState().brush.erase, true);
  assert.equal(s.getState().brush.soft, 0.5);
});

// ---- match agent ----
import type { AgentStep } from '../src/state/agent.ts';
import type { RefMatch } from '../src/state/types.ts';

const fakeRef = { id: 7, color: 0.5, tone: 0.5, swatches: [], profile: {}, thumb: { width: 1, height: 1, data: new Uint8ClampedArray(4) } } as unknown as RefMatch;
const stepWith = (id: string, exposure: number, before = 50, after = 60): AgentStep => {
  const settings = cloneSettings(makeSettings()); settings.adj.exposure = exposure;
  return { id, kind: 'brightness', title: id, why: '', changes: [], before, after, kept: true, settings };
};

test('choosing a reference clears an earlier run', () => {
  const s = open();
  s.setAgentRef(fakeRef);
  s.agentBegin();
  s.agentApplyStep(stepWith('a', 0.5), { first: true });
  s.setAgentRef(fakeRef);
  assert.equal(s.getState().agent.steps.length, 0);
  assert.equal(s.getState().agent.status, 'idle');
  assert.equal(s.getState().agent.ref, fakeRef);
});

test('each agent step is one undo step and records where the run began', () => {
  const s = open();
  s.setAgentRef(fakeRef);
  s.agentBegin();
  s.agentApplyStep(stepWith('a', 0.5, 40, 55), { first: true });
  s.agentApplyStep(stepWith('b', 1, 55, 70));
  s.agentEnd();
  const a = s.getState().agent;
  assert.equal(a.status, 'done');
  assert.equal(a.steps.length, 2);
  assert.equal(a.before, 40);
  assert.equal(s.getState().settings.adj.exposure, 1);
  s.undo();
  assert.equal(s.getState().settings.adj.exposure, 0.5);
  s.undo();
  assert.equal(s.getState().settings.adj.exposure, 0);
});

test('going back to a step restores it as a new undo step', () => {
  const s = open();
  s.agentBegin();
  s.agentApplyStep(stepWith('a', 0.5), { first: true });
  s.agentApplyStep(stepWith('b', 1));
  s.jumpToStep(0);
  assert.equal(s.getState().settings.adj.exposure, 0.5);
  assert.equal(s.getState().agent.steps.length, 2);
  s.undo();
  assert.equal(s.getState().settings.adj.exposure, 1);
  s.jumpToStep(99);
  assert.equal(s.getState().settings.adj.exposure, 1);
});

test('a new photo keeps the reference but drops the run', () => {
  const s = open();
  s.setAgentRef(fakeRef);
  s.agentBegin();
  s.agentApplyStep(stepWith('a', 0.5), { first: true });
  s.openPhoto([finding]);
  assert.equal(s.getState().agent.ref, fakeRef);
  assert.equal(s.getState().agent.steps.length, 0);
  assert.equal(s.getState().agent.status, 'idle');
});
