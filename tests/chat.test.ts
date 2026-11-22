import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanAction, cleanActions, MAX_ACTIONS } from '../src/chat/actions.ts';
import type { Action } from '../src/chat/actions.ts';
import { applyActions } from '../src/chat/apply.ts';
import { describeContext } from '../src/chat/context.ts';
import { perform } from '../src/chat/perform.ts';
import { ask } from '../src/chat/session.ts';
import { MAX_MASKS } from '../src/core/mask.ts';
import { EditorStore, makeSettings } from '../src/state/store.ts';
import type { Finding } from '../src/core/suggest.ts';
import type { RefMatch } from '../src/state/types.ts';

const finding: Finding = { id: 'f', severity: 1, title: 'Too dark', detail: 'The middle is dark.', fix: null };
const open = () => { const s = new EditorStore(); s.openPhoto([finding]); return s; };
const noEngine = () => { const calls = { n: 0 }; return { calls, engine: { runAgent: async () => { calls.n++; } } }; };

test('cleanAction clamps values, rounds them, and drops what it does not know', () => {
  const a = cleanAction('edit_photo', { temperature: 900, exposure: 0.33, contrast: NaN, bogus: 5, fade: 3, shadow_tint_hue: 400, shadow_tint_amount: 2 }) as Extract<Action, { tool: 'edit_photo' }>;
  assert.deepEqual(a.adj, { temperature: 100, exposure: 0.35, fade: 1 });
  assert.deepEqual(a.shadowTint, { hue: 40, amount: 1 });
  assert.equal(cleanAction('edit_photo', {}), null);
  assert.equal(cleanAction('edit_photo', { look: 'not-a-look' }), null);
  assert.equal(cleanAction('format_disk', {}), null);
  assert.equal(cleanAction('edit_photo', null), null);
});

test('looks must exist, and "none" clears the look', () => {
  const on = cleanAction('edit_photo', { look: 'moody', look_strength: 5 }) as Extract<Action, { tool: 'edit_photo' }>;
  assert.equal(on.look, 'moody'); assert.equal(on.lookStrength, 1);
  const off = cleanAction('edit_photo', { look: 'none' }) as Extract<Action, { tool: 'edit_photo' }>;
  assert.equal(off.look, null);
});

test('masks need a known area and at least one real adjustment', () => {
  assert.equal(cleanAction('add_mask', { area: 'sky' }), null);
  assert.equal(cleanAction('add_mask', { area: 'moon', exposure: 1 }), null);
  const m = cleanAction('add_mask', { area: 'sky', exposure: -5, saturation: 12.4, contrast: 0 }) as Extract<Action, { tool: 'add_mask' }>;
  assert.deepEqual(m.adj, { exposure: -2, saturation: 12 });
});

test('no more than six actions are kept', () => {
  const calls = Array.from({ length: 10 }, () => ({ name: 'undo', input: {} }));
  assert.equal(cleanActions(calls).length, MAX_ACTIONS);
});

test('edit_photo changes sliders, tints and the look, and says what changed', () => {
  const base = makeSettings();
  const r = applyActions(base, [{ tool: 'edit_photo', adj: { exposure: 0.4, temperature: 20 }, shadowTint: { hue: 185, amount: 0.3 }, look: 'moody', lookStrength: 0.6 }]);
  assert.equal(r.settings.adj.exposure, 0.4);
  assert.equal(r.settings.adj.splitShadow.hue, 185);
  assert.equal(r.settings.look, 'moody');
  assert.equal(r.settings.lookStrength, 0.6);
  assert.equal(base.adj.exposure, 0);                       // the original is untouched
  assert.ok(r.changes.some((c) => /Exposure/.test(c)) && r.changes.some((c) => /Shadow tint/.test(c)));
});

test('masks land in the right part of the photo and respect the limit', () => {
  const sky = applyActions(makeSettings(), [{ tool: 'add_mask', area: 'sky', adj: { exposure: -0.5 } }]).settings.masks[0];
  assert.equal(sky.kind, 'linear'); assert.ok(sky.y1 < sky.y2); assert.equal(sky.adj.exposure, -0.5);
  const ground = applyActions(makeSettings(), [{ tool: 'add_mask', area: 'ground', adj: { shadows: 20 } }]).settings.masks[0];
  assert.ok(ground.y1 > ground.y2);
  const dark = applyActions(makeSettings(), [{ tool: 'add_mask', area: 'dark_areas', adj: { exposure: 0.3 } }]).settings.masks[0];
  assert.equal(dark.kind, 'range'); assert.ok(dark.hi < 0.5);
  const edges = applyActions(makeSettings(), [{ tool: 'add_mask', area: 'edges', adj: { exposure: -0.5 } }]).settings.masks[0];
  assert.equal(edges.kind, 'radial'); assert.equal(edges.invert, true);
  let s = makeSettings();
  for (let i = 0; i < MAX_MASKS; i++) s = applyActions(s, [{ tool: 'add_mask', area: 'center', adj: { exposure: 0.1 } }]).settings;
  const over = applyActions(s, [{ tool: 'add_mask', area: 'center', adj: { exposure: 0.1 } }]);
  assert.equal(over.settings.masks.length, MAX_MASKS);
  assert.equal(over.problems.length, 1);
});

test('clear, reset, undo and match are reported without surprises', () => {
  const withMask = applyActions(makeSettings(), [{ tool: 'edit_photo', adj: { contrast: 30 } }, { tool: 'add_mask', area: 'sky', adj: { exposure: -1 } }]).settings;
  assert.equal(applyActions(withMask, [{ tool: 'clear_masks' }]).settings.masks.length, 0);
  assert.equal(applyActions(withMask, [{ tool: 'clear_masks' }]).settings.adj.contrast, 30);
  assert.equal(applyActions(withMask, [{ tool: 'reset_all' }]).settings.adj.contrast, 0);
  assert.equal(applyActions(withMask, [{ tool: 'match_reference' }]).match, true);
  const u = applyActions(withMask, [{ tool: 'edit_photo', adj: { contrast: 90 } }, { tool: 'undo' }]);
  assert.equal(u.undo, true); assert.equal(u.settings.adj.contrast, 30);     // undo wins and applies nothing else
});

test('one reply is one undo step, and it is checked again before it touches the editor', () => {
  const store = open(); const { engine, calls } = noEngine();
  const r = perform(store, engine, [
    { tool: 'edit_photo', adj: { temperature: 9999 as number, exposure: 0.2 } },
    { tool: 'add_mask', area: 'sky', adj: { exposure: -0.4 } },
  ]);
  assert.equal(r.changed, true);
  assert.equal(store.getState().settings.adj.temperature, 100);
  assert.equal(store.getState().settings.masks.length, 1);
  store.undo();
  assert.equal(store.getState().settings.adj.temperature, 0);
  assert.equal(store.getState().settings.masks.length, 0);
  assert.equal(calls.n, 0);
});

test('forged or nonsense actions change nothing', () => {
  const store = open(); const { engine } = noEngine();
  const r = perform(store, engine, [{ tool: 'rm_rf' } as unknown as Action, { tool: 'edit_photo', adj: { exposure: NaN } }, { tool: 'add_mask', area: 'moon' } as unknown as Action]);
  assert.equal(r.changed, false);
  assert.equal(store.getState().canUndo, false);
});

test('undo from chat steps the editor back', () => {
  const store = open(); const { engine } = noEngine();
  perform(store, engine, [{ tool: 'edit_photo', adj: { exposure: 0.5 } }]);
  perform(store, engine, [{ tool: 'undo' }]);
  assert.equal(store.getState().settings.adj.exposure, 0);
});

test('matching needs a reference: without one the person is told, with one the agent runs', () => {
  const store = open(); const { engine, calls } = noEngine();
  const r = perform(store, engine, [{ tool: 'match_reference' }]);
  assert.equal(calls.n, 0);
  assert.match(r.extra, /reference photo/);
  store.setAgentRef({ id: 1 } as unknown as RefMatch);
  perform(store, engine, [{ tool: 'match_reference' }]);
  assert.equal(calls.n, 1);
});

test('the context carries numbers and words, never pixels', () => {
  const store = open();
  store.edit((d) => { d.adj.exposure = 0.3; }, { commit: true });
  const c = describeContext(store.getState());
  assert.equal(c.photo, null);
  assert.equal(c.edit.sliders.exposure, 0.3);
  assert.deepEqual(c.findings, [{ title: 'Too dark', detail: 'The middle is dark.' }]);
  assert.deepEqual(c.reference, { chosen: false });
  assert.ok(JSON.stringify(c).length < 1500);
});

// ---- session ----
const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const stateOf = () => open().getState();

test('a good reply is returned with its actions, and the request carries recent turns and context', async () => {
  let sent: { url: string; body: { messages: { role: string; text: string }[]; context: unknown } } | undefined;
  const fetchFn = (async (url: string, init: RequestInit) => { sent = { url, body: JSON.parse(init.body as string) }; return res(200, { reply: 'Made it warmer.', actions: [{ tool: 'edit_photo', adj: { temperature: 20 } }] }); }) as unknown as typeof fetch;
  const history = Array.from({ length: 14 }, (_, i) => ({ role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', text: 't' + i }));
  const r = await ask({ endpoint: 'https://w.test/', history, text: ' warmer ', state: stateOf(), fetchFn });
  assert.equal(r.source, 'assistant'); assert.equal(r.text, 'Made it warmer.'); assert.equal(r.actions.length, 1);
  assert.equal(sent!.url, 'https://w.test/chat');
  assert.equal(sent!.body.messages.length, 11);
  assert.equal(sent!.body.messages.at(-1)!.text, 'warmer');
  assert.ok((sent!.body.context as { edit: unknown }).edit);
});

test('an empty reply still says something useful', async () => {
  const f = (async () => res(200, { reply: '', actions: [] })) as unknown as typeof fetch;
  assert.match((await ask({ endpoint: 'https://w.test', history: [], text: 'hmm', state: stateOf(), fetchFn: f })).text, /not sure/);
  const g = (async () => res(200, { reply: '', actions: [{ tool: 'undo' }] })) as unknown as typeof fetch;
  assert.equal((await ask({ endpoint: 'https://w.test', history: [], text: 'undo', state: stateOf(), fetchFn: g })).text, 'Done.');
});

test('hitting the daily limit is explained and does not fall back', async () => {
  const f = (async () => res(429, { error: 'daily limit' })) as unknown as typeof fetch;
  const r = await ask({ endpoint: 'https://w.test', history: [], text: 'warmer', state: stateOf(), fetchFn: f });
  assert.equal(r.source, 'error'); assert.match(r.text, /today/); assert.equal(r.offline, undefined);
  const busy = (async () => res(429, { error: 'busy' })) as unknown as typeof fetch;
  assert.match((await ask({ endpoint: 'https://w.test', history: [], text: 'warmer', state: stateOf(), fetchFn: busy })).text, /busy/);
});

test('when the server is missing or down, simple phrases still work offline', async () => {
  const state = stateOf();
  const none = await ask({ endpoint: undefined, history: [], text: 'make it warmer', state });
  assert.equal(none.source, 'offline');
  assert.ok(none.offline!.adj.temperature > 0);
  const down = (async () => { throw new Error('network'); }) as unknown as typeof fetch;
  assert.equal((await ask({ endpoint: 'https://w.test', history: [], text: 'moodier', state, fetchFn: down })).source, 'offline');
  const five = (async () => res(503, { error: 'chat is not set up' })) as unknown as typeof fetch;
  assert.equal((await ask({ endpoint: 'https://w.test', history: [], text: 'cooler', state, fetchFn: five })).source, 'offline');
  const lost = await ask({ endpoint: undefined, history: [], text: 'make the sky purple with stars', state });
  assert.equal(lost.source, 'error'); assert.match(lost.text, /warmer/);
});

test('long input is cut to the limit before it is sent', async () => {
  let body = '';
  const f = (async (_u: string, init: RequestInit) => { body = init.body as string; return res(200, { reply: 'ok', actions: [] }); }) as unknown as typeof fetch;
  await ask({ endpoint: 'https://w.test', history: [], text: 'x'.repeat(2000), state: stateOf(), fetchFn: f });
  assert.equal(JSON.parse(body).messages.at(-1).text.length, 400);
});

test('change lines are short enough for a chat bubble', () => {
  const r = applyActions(makeSettings(), [{ tool: 'edit_photo', adj: { exposure: -0.25, contrast: 15, fade: 0.22 } }]);
  assert.deepEqual(r.changes, ['Exposure -0.25 stops', 'Contrast +15', 'Fade 22%']);
});
