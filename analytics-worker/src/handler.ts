// The analytics Worker's logic, kept separate from Cloudflare's entry point so it can be tested in Node with an
// ordinary SQLite database standing in for D1. It stores the events the editor sends and hands back one summary.
import { summarize } from '../../src/analytics/summary.ts';
import { EVENT_NAMES, cleanProps } from '../../src/analytics/track.ts';
import type { AnalyticsEvent, EventName } from '../../src/analytics/track.ts';

/** The small part of D1 this uses. Cloudflare's D1 and the Node test adapter both fit it. */
export interface Db {
  insert(rows: { ts: number; name: string; visitor: string; session: string; props: string }[]): Promise<void>;
  since(ts: number, limit: number): Promise<AnalyticsEvent[]>;
}

export const MAX_BODY = 20_000;       // bytes
export const MAX_EVENTS = 50;         // per request
export const WINDOW_DAYS = 30;
const ID = /^[a-z0-9]{4,32}$/;

export interface Env { DB: Db; ALLOWED_ORIGINS?: string }

/** Which pages may call this. Others get no CORS headers, so a browser will not hand them the answer. */
export function corsHeaders(origin: string | null, allowed: string): Record<string, string> {
  const list = allowed.split(',').map((s) => s.trim()).filter(Boolean);
  if (origin && list.includes(origin)) return { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type', vary: 'origin' };
  return { vary: 'origin' };
}

/** Keep only well-formed events, with the same property rules the editor applies, so a hand-made request cannot store anything else. */
export function validate(body: unknown, now: number): AnalyticsEvent[] {
  const list = (body as { events?: unknown })?.events;
  if (!Array.isArray(list)) return [];
  const out: AnalyticsEvent[] = [];
  for (const raw of list.slice(0, MAX_EVENTS)) {
    const e = raw as Partial<AnalyticsEvent>;
    if (!e || typeof e !== 'object') continue;
    if (!EVENT_NAMES.includes(e.n as EventName)) continue;
    if (typeof e.v !== 'string' || !ID.test(e.v) || typeof e.s !== 'string' || !ID.test(e.s)) continue;
    const t = typeof e.t === 'number' && Number.isFinite(e.t) ? e.t : now;
    if (Math.abs(now - t) > 24 * 3600 * 1000) continue;     // clocks off by more than a day are ignored
    const ev: AnalyticsEvent = { n: e.n as EventName, t: Math.round(t), v: e.v, s: e.s };
    const p = cleanProps(e.p as Record<string, unknown> | undefined);
    if (p) ev.p = p;
    out.push(ev);
  }
  return out;
}

export async function handle(req: Request, env: Env, now = Date.now()): Promise<Response> {
  const url = new URL(req.url);
  const cors = corsHeaders(req.headers.get('origin'), env.ALLOWED_ORIGINS ?? '');
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...cors } });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  if (url.pathname === '/e' && req.method === 'POST') {
    const text = await req.text();
    if (text.length > MAX_BODY) return json({ error: 'too large' }, 413);
    let body: unknown;
    try { body = JSON.parse(text); } catch { return json({ error: 'bad json' }, 400); }
    const events = validate(body, now);
    if (events.length) await env.DB.insert(events.map((e) => ({ ts: e.t, name: e.n, visitor: e.v, session: e.s, props: JSON.stringify(e.p ?? {}) })));
    return json({ stored: events.length });
  }
  if (url.pathname === '/summary' && req.method === 'GET') {
    const events = await env.DB.since(now - WINDOW_DAYS * 24 * 3600 * 1000, 20_000);
    return json({ days: WINDOW_DAYS, summary: summarize(events) });
  }
  return json({ error: 'not found' }, 404);
}
