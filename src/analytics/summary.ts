// Turns raw events into the numbers worth showing. One pure function, used by the stats page (for events on this
// device) and by the Worker (for everyone's events), so both always agree.
import type { AnalyticsEvent } from './track.ts';

export interface FunnelStep { step: string; sessions: number }
export interface Summary {
  events: number;
  visitors: number;
  sessions: number;
  returningVisitors: number;                       // seen on more than one day
  days: { day: string; sessions: number; agentRuns: number }[];
  funnel: FunnelStep[];
  agent: { runs: number; avgBefore: number; avgAfter: number; avgGain: number; improvedPct: number; avgSeconds: number; regionsPct: number; avgStepsKept: number };
  steer: { uses: number; top: { name: string; n: number }[] };
  dials: { name: string; n: number }[];
  tabs: { name: string; n: number }[];
  masks: { name: string; n: number }[];
  photos: { sample: number; upload: number };
  exports: number;
  chat: { opened: number; messages: number; offlinePct: number; editedPct: number; tools: { name: string; n: number }[] };
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const day = (t: number): string => new Date(t).toISOString().slice(0, 10);
const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const tally = (keys: string[]): { name: string; n: number }[] => {
  const m = new Map<string, number>();
  for (const k of keys) if (k) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
};
const str = (p: AnalyticsEvent['p'], k: string): string => { const v = p?.[k]; return typeof v === 'string' ? v : ''; };

export function summarize(events: AnalyticsEvent[]): Summary {
  const visitors = new Set<string>(), sessions = new Set<string>();
  const visitorDays = new Map<string, Set<string>>();
  const perDay = new Map<string, { s: Set<string>; runs: number }>();
  const by = (name: string) => events.filter((e) => e.n === name);
  for (const e of events) {
    visitors.add(e.v); sessions.add(e.s);
    const d = day(e.t);
    (visitorDays.get(e.v) ?? visitorDays.set(e.v, new Set()).get(e.v)!).add(d);
    const row = perDay.get(d) ?? { s: new Set<string>(), runs: 0 };
    row.s.add(e.s); if (e.n === 'agent_run') row.runs++;
    perDay.set(d, row);
  }
  const sessionsWith = (pred: (e: AnalyticsEvent) => boolean): number => new Set(events.filter(pred).map((e) => e.s)).size;
  const runs = by('agent_run').map((e) => e.p ?? {});
  const befores = runs.map((p) => num(p.before)), afters = runs.map((p) => num(p.after));
  const gains = runs.map((p, i) => afters[i] - befores[i]);
  const steers = by('steer_used');
  return {
    events: events.length,
    visitors: visitors.size,
    sessions: sessions.size,
    returningVisitors: [...visitorDays.values()].filter((d) => d.size > 1).length,
    days: [...perDay].sort((a, b) => a[0].localeCompare(b[0])).map(([d, r]) => ({ day: d, sessions: r.s.size, agentRuns: r.runs })),
    funnel: [
      { step: 'Opened a photo', sessions: sessionsWith((e) => e.n === 'photo_opened') },
      { step: 'Looked at the Match tab', sessions: sessionsWith((e) => e.n === 'tab_viewed' && str(e.p, 'tab') === 'match') },
      { step: 'Chose a reference photo', sessions: sessionsWith((e) => e.n === 'reference_chosen') },
      { step: 'Ran the match agent', sessions: sessionsWith((e) => e.n === 'agent_run') },
      { step: 'Fine tuned the result', sessions: sessionsWith((e) => e.n === 'dial_changed' || e.n === 'steer_used' || e.n === 'agent_step_jump' || e.n === 'chat_message') },
      { step: 'Saved the photo', sessions: sessionsWith((e) => e.n === 'export_jpeg') },
    ],
    agent: {
      runs: runs.length,
      avgBefore: avg(befores), avgAfter: avg(afters), avgGain: avg(gains),
      improvedPct: runs.length ? (100 * gains.filter((g) => g > 0).length) / runs.length : 0,
      avgSeconds: avg(runs.map((p) => num(p.ms) / 1000)),
      regionsPct: runs.length ? (100 * runs.filter((p) => p.regions === true).length) / runs.length : 0,
      avgStepsKept: avg(runs.map((p) => num(p.steps_kept))),
    },
    steer: { uses: steers.length, top: tally(steers.flatMap((e) => str(e.p, 'phrases').split(',').map((x) => x.trim()))).slice(0, 8) },
    dials: tally(by('dial_changed').map((e) => str(e.p, 'dial'))),
    tabs: tally(by('tab_viewed').map((e) => str(e.p, 'tab'))),
    masks: tally(by('mask_added').map((e) => str(e.p, 'kind'))),
    photos: {
      sample: by('photo_opened').filter((e) => str(e.p, 'source') === 'sample').length,
      upload: by('photo_opened').filter((e) => str(e.p, 'source') === 'upload').length,
    },
    exports: by('export_jpeg').length,
    chat: (() => {
      const m = by('chat_message').map((e) => e.p ?? {});
      return {
        opened: by('chat_opened').length,
        messages: m.length,
        offlinePct: m.length ? (100 * m.filter((p) => p.source === 'offline' || p.source === 'error').length) / m.length : 0,
        editedPct: m.length ? (100 * m.filter((p) => p.edited === true).length) / m.length : 0,
        tools: tally(m.flatMap((p) => (typeof p.tools === 'string' ? p.tools.split(',').map((x) => x.trim()) : []))),
      };
    })(),
  };
}
