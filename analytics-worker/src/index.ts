// Cloudflare Worker entry point. Wires the handler to a D1 database bound as DB. See ../README.md to deploy.
import { handle } from './handler.ts';
import type { Db, Env, Model } from './handler.ts';
import type { AnalyticsEvent, EventName } from '../../src/analytics/track.ts';

interface D1Like {
  prepare(sql: string): { bind(...v: unknown[]): { run(): Promise<unknown>; all<T>(): Promise<{ results: T[] }>; first<T>(): Promise<T | null> } };
  batch(stmts: unknown[]): Promise<unknown>;
}

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

/** Calls Claude with one round of tools. The key is a Worker secret and never reaches the page. */
const claude = (key: string, model: string): Model => async (req) => {
  const r = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 700, system: req.system, tools: req.tools, messages: req.messages }),
  });
  if (!r.ok) throw new Error(`model ${r.status}`);
  const j = (await r.json()) as { content: { type: string; text?: string; name?: string; input?: unknown }[] };
  return {
    text: j.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join(' '),
    calls: j.content.filter((b) => b.type === 'tool_use').map((b) => ({ name: b.name ?? '', input: b.input })),
  };
};

const d1 = (db: D1Like): Db => ({
  async bump(key, day) {
    const row = await db.prepare('INSERT INTO chat_usage (key, day, n) VALUES (?, ?, 1) ON CONFLICT(key, day) DO UPDATE SET n = n + 1 RETURNING n').bind(key, day).first<{ n: number }>();
    return row?.n ?? 1;
  },
  async insert(rows) {
    const stmt = db.prepare('INSERT INTO events (ts, name, visitor, session, props) VALUES (?, ?, ?, ?, ?)');
    await db.batch(rows.map((r) => stmt.bind(r.ts, r.name, r.visitor, r.session, r.props)));
  },
  async since(ts, limit) {
    const { results } = await db.prepare('SELECT ts, name, visitor, session, props FROM events WHERE ts >= ? ORDER BY ts DESC LIMIT ?').bind(ts, limit).all<{ ts: number; name: string; visitor: string; session: string; props: string }>();
    return results.map((r): AnalyticsEvent => ({ n: r.name as EventName, t: r.ts, v: r.visitor, s: r.session, p: JSON.parse(r.props || '{}') }));
  },
});

export default {
  fetch(req: Request, env: { DB: D1Like; ALLOWED_ORIGINS?: string; ANTHROPIC_API_KEY?: string; CHAT_MODEL?: string; CHAT_PER_USER?: string; CHAT_PER_DAY?: string }): Promise<Response> {
    const e: Env = {
      DB: d1(env.DB), ALLOWED_ORIGINS: env.ALLOWED_ORIGINS,
      model: env.ANTHROPIC_API_KEY ? claude(env.ANTHROPIC_API_KEY, env.CHAT_MODEL || 'claude-haiku-4-5-20251001') : undefined,
      CHAT_PER_USER: env.CHAT_PER_USER ? Number(env.CHAT_PER_USER) : undefined, CHAT_PER_DAY: env.CHAT_PER_DAY ? Number(env.CHAT_PER_DAY) : undefined,
    };
    return handle(req, e);
  },
};
