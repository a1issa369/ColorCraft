// The analytics Worker's logic, kept separate from Cloudflare's entry point so it can be tested in Node with an
// ordinary SQLite database standing in for D1. It stores the events the editor sends and hands back one summary.
import { summarize } from '../../src/analytics/summary.ts';
import { EVENT_NAMES, cleanProps } from '../../src/analytics/track.ts';
import { cleanActions } from '../../src/chat/actions.ts';
import type { Action } from '../../src/chat/actions.ts';
import { SYSTEM_PROMPT, TOOLS } from '../../src/chat/tools.ts';
import type { AnalyticsEvent, EventName } from '../../src/analytics/track.ts';

/** The small part of D1 this uses. Cloudflare's D1 and the Node test adapter both fit it. */
export interface Db {
  insert(rows: { ts: number; name: string; visitor: string; session: string; props: string }[]): Promise<void>;
  since(ts: number, limit: number): Promise<AnalyticsEvent[]>;
  /** Count one more chat message for this key on this day and return the new total. */
  bump(key: string, day: string): Promise<number>;
}

export interface ModelRequest { system: string; tools: unknown[]; messages: { role: 'user' | 'assistant'; content: string }[] }
export interface ModelReply { text: string; calls: { name: string; input: unknown }[] }
export type Model = (req: ModelRequest) => Promise<ModelReply>;

export const MAX_BODY = 20_000;       // bytes
export const MAX_EVENTS = 50;         // per request
export const WINDOW_DAYS = 30;
const ID = /^[a-z0-9]{4,32}$/;

export interface Env {
  DB: Db;
  ALLOWED_ORIGINS?: string;
  /** Asks the language model. Missing means chat is not set up. */
  model?: Model;
  /** Chat messages allowed per visitor address per day, and in total per day. */
  CHAT_PER_USER?: number;
  CHAT_PER_DAY?: number;
}

export const CHAT_MAX_BODY = 8_000;
export const CHAT_MAX_TURNS = 12;
export const CHAT_MAX_CHARS = 400;
export const CONTEXT_MAX_CHARS = 3_500;
export const REPLY_MAX_CHARS = 600;

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
  if (url.pathname === '/chat' && req.method === 'POST') return chat(req, env, now, json);
  return json({ error: 'not found' }, 404);
}

/** The last message must be from the person; earlier ones alternate. Short, plain text only. */
export function validateChat(body: unknown): { messages: ModelRequest['messages']; context: string } | null {
  const b = body as { messages?: unknown; context?: unknown };
  if (!Array.isArray(b?.messages) || !b.messages.length) return null;
  const msgs: ModelRequest['messages'] = [];
  for (const m of b.messages.slice(-CHAT_MAX_TURNS)) {
    const r = m as { role?: unknown; text?: unknown };
    if ((r?.role !== 'user' && r?.role !== 'assistant') || typeof r.text !== 'string') return null;
    const text = r.text.trim().slice(0, CHAT_MAX_CHARS);
    if (!text) continue;
    if (msgs.length && msgs[msgs.length - 1].role === r.role) msgs[msgs.length - 1].content += '\n' + text;
    else msgs.push({ role: r.role, content: text });
  }
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return null;
  let context = '{}';
  try { context = JSON.stringify(b.context ?? {}); } catch { return null; }
  if (context.length > CONTEXT_MAX_CHARS) return null;
  return { messages: msgs, context };
}

async function hashKey(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d).slice(0, 8), (x) => x.toString(16).padStart(2, '0')).join('');
}

async function chat(req: Request, env: Env, now: number, json: (d: unknown, status?: number) => Response): Promise<Response> {
  if (!env.model) return json({ error: 'chat is not set up' }, 503);
  const text = await req.text();
  if (text.length > CHAT_MAX_BODY) return json({ error: 'too large' }, 413);
  let body: unknown;
  try { body = JSON.parse(text); } catch { return json({ error: 'bad json' }, 400); }
  const parsed = validateChat(body);
  if (!parsed) return json({ error: 'bad request' }, 400);

  // Spending limits come before the model call: one per person per day, and one for everyone.
  const day = new Date(now).toISOString().slice(0, 10);
  const who = await hashKey(req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for') ?? 'unknown');
  if ((await env.DB.bump('u:' + who, day)) > (env.CHAT_PER_USER ?? 40)) return json({ error: 'daily limit' }, 429);
  if ((await env.DB.bump('all', day)) > (env.CHAT_PER_DAY ?? 1500)) return json({ error: 'busy' }, 429);

  const system = `${SYSTEM_PROMPT}\n\nCurrent photo and edit (numbers only, from the app):\n${parsed.context}`;
  try {
    const out = await env.model({ system, tools: TOOLS, messages: parsed.messages });
    const actions: Action[] = cleanActions(out.calls);
    return json({ reply: out.text.trim().slice(0, REPLY_MAX_CHARS), actions });
  } catch {
    return json({ error: 'model unavailable' }, 502);
  }
}
