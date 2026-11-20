import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handle, validate, corsHeaders, MAX_EVENTS } from '../analytics-worker/src/handler.ts';
import type { Db } from '../analytics-worker/src/handler.ts';
import type { AnalyticsEvent, EventName } from '../src/analytics/track.ts';

const NOW = Date.UTC(2026, 10, 19, 12);
const sqlite = (): Db => {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../analytics-worker/schema.sql', import.meta.url), 'utf8'));
  return {
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
