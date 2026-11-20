// Cloudflare Worker entry point. Wires the handler to a D1 database bound as DB. See ../README.md to deploy.
import { handle } from './handler.ts';
import type { Db, Env } from './handler.ts';
import type { AnalyticsEvent, EventName } from '../../src/analytics/track.ts';

interface D1Like {
  prepare(sql: string): { bind(...v: unknown[]): { run(): Promise<unknown>; all<T>(): Promise<{ results: T[] }> } };
  batch(stmts: unknown[]): Promise<unknown>;
}

const d1 = (db: D1Like): Db => ({
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
  fetch(req: Request, env: { DB: D1Like; ALLOWED_ORIGINS?: string }): Promise<Response> {
    const e: Env = { DB: d1(env.DB), ALLOWED_ORIGINS: env.ALLOWED_ORIGINS };
    return handle(req, e);
  },
};
