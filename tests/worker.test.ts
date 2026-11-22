import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handle, validate, validateChat, corsHeaders, MAX_EVENTS } from '../analytics-worker/src/handler.ts';
import type { Db, Model, ModelRequest } from '../analytics-worker/src/handler.ts';
import type { AnalyticsEvent, EventName } from '../src/analytics/track.ts';

const NOW = Date.UTC(2026, 10, 19, 12);
const sqlite = (): Db => {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../analytics-worker/schema.sql', import.meta.url), 'utf8'));
  return {
    async bump(key, day) { return (db.prepare('INSERT INTO chat_usage (key, day, n) VALUES (?, ?, 1) ON CONFLICT(key, day) DO UPDATE SET n = n + 1 RETURNING n').get(key, day) as { n: number }).n; },
    async insert(rows) { const st = db.prepare('INSERT INTO events (ts, name, visitor, session, props) VALUES (?, ?, ?, ?, ?)'); for (const r of rows) st.run(r.ts, r.name, r.visitor, r.session, r.props); },
    async since(ts, limit) {
      return (db.prepare('SELECT ts, name, visitor, session, props FROM events WHERE ts >= ? ORDER BY ts DESC LIMIT ?').all(ts, limit) as { ts: number; name: string; visitor: string; session: string; props: string }[])
        .map((r): AnalyticsEvent => ({ n: r.name as EventName, t: r.ts, v: r.visitor, s: r.session, p: JSON.parse(r.props) }));
    },
  };
};
const ev = (n: string, o: Record<string, unknown> = {}) => ({ n, t: NOW, v: 'aaaa1111', s: 'bbbb2222', ...o });
const post = (body: unknown, raw?: string) => new Request('https://w.test/e', { method: 'POST', body: raw ?? JSON.stringify(body), headers: { origin: 'https://a1issa369.github.io' } });

test('validate keeps good events and drops bad ones', () => {
  const out = validate({ events: [ev('photo_opened', { p: { source: 'sample', evil: { a: 1 } } }), ev('nope'), ev('export_jpeg', { v: 'BAD ID!' }), ev('export_jpeg', { t: NOW - 3 * 86400000 }), null, 5] }, NOW);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].p, { source: 'sample' });
});

test('validate caps the batch size and ignores non-arrays', () => {
  const many = Array.from({ length: MAX_EVENTS + 25 }, () => ev('export_jpeg'));
  assert.equal(validate({ events: many }, NOW).length, MAX_EVENTS);
  assert.deepEqual(validate({ events: 'x' }, NOW), []);
  assert.deepEqual(validate(null, NOW), []);
});

test('events are stored and summarised', async () => {
  const env = { DB: sqlite(), ALLOWED_ORIGINS: 'https://a1issa369.github.io' };
  const r = await handle(post({ events: [ev('photo_opened', { p: { source: 'upload' } }), ev('agent_run', { p: { before: 40, after: 80, ms: 2000, regions: true, steps_kept: 5 } })] }), env, NOW);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { stored: 2 });
  const s = await handle(new Request('https://w.test/summary', { headers: { origin: 'https://a1issa369.github.io' } }), env, NOW);
  const body = await s.json() as { summary: { events: number; agent: { avgGain: number }; photos: { upload: number } } };
  assert.equal(body.summary.events, 2);
  assert.equal(body.summary.agent.avgGain, 40);
  assert.equal(body.summary.photos.upload, 1);
  assert.equal(s.headers.get('access-control-allow-origin'), 'https://a1issa369.github.io');
});

test('bad json, oversize bodies and unknown paths are refused', async () => {
  const env = { DB: sqlite() };
  assert.equal((await handle(post(null, '{nope'), env, NOW)).status, 400);
  assert.equal((await handle(post(null, 'x'.repeat(20_001)), env, NOW)).status, 413);
  assert.equal((await handle(new Request('https://w.test/other'), env, NOW)).status, 404);
});

test('CORS is only granted to listed origins', () => {
  assert.equal(corsHeaders('https://evil.test', 'https://a.test')['access-control-allow-origin'], undefined);
  assert.equal(corsHeaders(null, 'https://a.test')['access-control-allow-origin'], undefined);
  assert.equal(corsHeaders('https://a.test', ' https://a.test , http://localhost:5173')['access-control-allow-origin'], 'https://a.test');
});

test('preflight answers 204', async () => {
  const r = await handle(new Request('https://w.test/e', { method: 'OPTIONS', headers: { origin: 'https://a.test' } }), { DB: sqlite(), ALLOWED_ORIGINS: 'https://a.test' }, NOW);
  assert.equal(r.status, 204);
});

// ---- chat ----
const chatReq = (body: unknown, ip = '1.2.3.4') => new Request('https://w.test/chat', { method: 'POST', body: JSON.stringify(body), headers: { origin: 'https://a1issa369.github.io', 'cf-connecting-ip': ip } });
const ask = (text = 'make it warmer') => ({ messages: [{ role: 'user', text }], context: { edit: { sliders: { temperature: 0 } } } });
const fakeModel = (calls: { name: string; input: unknown }[] = [], text = 'Warmed it up.'): { model: Model; seen: ModelRequest[] } => {
  const seen: ModelRequest[] = [];
  return { seen, model: async (r) => { seen.push(r); return { text, calls }; } };
};

test('chat is refused when no model is configured', async () => {
  assert.equal((await handle(chatReq(ask()), { DB: sqlite() }, NOW)).status, 503);
});

test('chat returns the model reply with only checked actions', async () => {
  const { model, seen } = fakeModel([
    { name: 'edit_photo', input: { temperature: 900, exposure: 0.33, evil: 'x' } },
    { name: 'delete_everything', input: {} },
    { name: 'add_mask', input: { area: 'nowhere', exposure: 1 } },
    { name: 'add_mask', input: { area: 'sky', exposure: -0.6 } },
  ]);
  const r = await handle(chatReq(ask()), { DB: sqlite(), model }, NOW);
  assert.equal(r.status, 200);
  const j = await r.json() as { reply: string; actions: { tool: string; adj: Record<string, number> }[] };
  assert.equal(j.reply, 'Warmed it up.');
  assert.deepEqual(j.actions.map((a) => a.tool), ['edit_photo', 'add_mask']);
  assert.equal(j.actions[0].adj.temperature, 100);
  assert.equal(j.actions[0].adj.exposure, 0.35);
  assert.match(seen[0].system, /photo assistant/);
  assert.match(seen[0].system, /temperature/);       // the context rides along in the system text
  assert.ok(seen[0].tools.length >= 5);
});

test('chat enforces the per visitor and total daily limits before calling the model', async () => {
  const { model, seen } = fakeModel();
  const env = { DB: sqlite(), model, CHAT_PER_USER: 2, CHAT_PER_DAY: 3 };
  assert.equal((await handle(chatReq(ask(), 'a'), env, NOW)).status, 200);
  assert.equal((await handle(chatReq(ask(), 'a'), env, NOW)).status, 200);
  assert.equal((await handle(chatReq(ask(), 'a'), env, NOW)).status, 429);      // visitor a is out
  assert.equal((await handle(chatReq(ask(), 'b'), env, NOW)).status, 200);      // b still has a share
  assert.equal((await handle(chatReq(ask(), 'c'), env, NOW)).status, 429);      // but the day is full
  assert.equal(seen.length, 3);
  assert.equal((await handle(chatReq(ask(), 'c'), env, NOW + 86_400_000)).status, 200);   // a new day starts clean
});

test('chat rejects bad bodies and a failing model gives 502', async () => {
  const env = { DB: sqlite(), model: fakeModel().model };
  assert.equal((await handle(chatReq({ messages: [] }), env, NOW)).status, 400);
  assert.equal((await handle(chatReq({ messages: [{ role: 'assistant', text: 'hi' }] }), env, NOW)).status, 400);
  assert.equal((await handle(chatReq({ messages: [{ role: 'user', text: 'hi' }], context: { x: 'y'.repeat(4000) } }), env, NOW)).status, 400);
  assert.equal((await handle(new Request('https://w.test/chat', { method: 'POST', body: 'z'.repeat(9000) }), env, NOW)).status, 413);
  const broken = { DB: sqlite(), model: async () => { throw new Error('down'); } };
  assert.equal((await handle(chatReq(ask()), broken, NOW)).status, 502);
});

test('validateChat trims long messages, merges repeats and keeps the latest turns', () => {
  const long = 'a'.repeat(1000);
  const out = validateChat({ messages: [{ role: 'user', text: long }, { role: 'user', text: 'again' }, { role: 'assistant', text: 'ok' }, { role: 'user', text: 'next' }], context: {} })!;
  assert.deepEqual(out.messages.map((m) => m.role), ['user', 'assistant', 'user']);
  assert.ok(out.messages[0].content.startsWith('a'.repeat(400)) && out.messages[0].content.length < 420);
  const many = { messages: Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: 't' + i })).concat([{ role: 'user', text: 'last' }]), context: {} };
  assert.ok(validateChat(many)!.messages.length <= 12);
  assert.equal(validateChat({ messages: [{ role: 'system', text: 'x' }] }), null);
});
