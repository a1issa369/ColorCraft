// A page of plain numbers about how ColorCraft is used, at #stats. It shows everyone's events when an analytics
// address is set, and otherwise only the events recorded on this device.
import { useEffect, useState } from 'react';
import { analytics, analyticsEndpoint } from '../analytics/track.ts';
import { summarize } from '../analytics/summary.ts';
import type { Summary } from '../analytics/summary.ts';

type Load = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ok'; summary: Summary; where: 'everyone' | 'device'; days: number | null };

const pct = (n: number) => `${Math.round(n)}%`;
const one = (n: number) => (Math.round(n * 10) / 10).toString();

function Card({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-[10px] border border-line bg-surface px-3.5 py-3">
      <div className="text-[1.5rem] font-semibold leading-none">{value}</div>
      <div className="mt-1.5 text-[0.85rem]">{label}</div>
      {note && <div className="mt-0.5 text-[0.78rem] text-muted">{note}</div>}
    </div>
  );
}

function Bars({ rows, empty }: { rows: { name: string; n: number }[]; empty: string }) {
  if (!rows.length) return <p className="m-0 text-[0.85rem] text-muted">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.n));
  return (
    <ul className="m-0 list-none space-y-1.5 p-0">
      {rows.map((r) => (
        <li key={r.name} className="grid grid-cols-[8rem_1fr_2.5rem] items-center gap-2 text-[0.85rem]">
          <span className="truncate">{r.name}</span>
          <span className="h-2 rounded bg-line"><span className="block h-2 rounded bg-ink" style={{ width: `${(100 * r.n) / max}%` }} /></span>
          <span className="text-right tabular-nums text-muted">{r.n}</span>
        </li>
      ))}
    </ul>
  );
}

export function StatsPage() {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  useEffect(() => {
    let live = true;
    (async () => {
      if (!analyticsEndpoint) { if (live) setLoad({ state: 'ok', summary: summarize(analytics.local()), where: 'device', days: null }); return; }
      try {
        const r = await fetch(`${analyticsEndpoint.replace(/\/$/, '')}/summary`);
        if (!r.ok) throw new Error(`The analytics server answered ${r.status}.`);
        const j = (await r.json()) as { days: number; summary: Summary };
        if (live) setLoad({ state: 'ok', summary: j.summary, where: 'everyone', days: j.days });
      } catch (e) {
        if (live) setLoad({ state: 'error', message: e instanceof Error ? e.message : 'Could not reach the analytics server.' });
      }
    })();
    return () => { live = false; };
  }, []);

  return (
    <main id="stats" className="mx-auto max-w-[860px] px-4 py-6">
      <div className="flex items-baseline gap-3">
        <h2 className="m-0 font-serif text-[1.3rem] font-semibold">How ColorCraft is used</h2>
        <a href="#" className="ml-auto text-[0.9rem] text-muted underline">Back to the editor</a>
      </div>
      {load.state === 'loading' && <p className="text-muted">Loading.</p>}
      {load.state === 'error' && <p role="alert" className="text-[0.9rem]">{load.message} Check that the analytics address is right and that this site is listed in ALLOWED_ORIGINS.</p>}
      {load.state === 'ok' && <Body load={load} />}
    </main>
  );
}

function Body({ load }: { load: Extract<Load, { state: 'ok' }> }) {
  const s = load.summary;
  const top = Math.max(1, s.funnel[0]?.sessions ?? 0);
  return (
    <>
      <p className="text-[0.85rem] text-muted">
        {load.where === 'everyone' ? `Everyone's anonymous events from the last ${load.days} days.` : 'Only events recorded in this browser. Set VITE_ANALYTICS_URL to see everyone.'}
      </p>
      <div className="my-4 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2.5">
        <Card label="Visitors" value={String(s.visitors)} note={`${s.returningVisitors} came back on another day`} />
        <Card label="Sessions" value={String(s.sessions)} />
        <Card label="Match agent runs" value={String(s.agent.runs)} note={s.agent.runs ? `${pct(s.agent.improvedPct)} ended closer to the reference` : undefined} />
        <Card label="Average closeness" value={s.agent.runs ? `${one(s.agent.avgBefore)} to ${one(s.agent.avgAfter)}` : 'none yet'} note={s.agent.runs ? `+${one(s.agent.avgGain)} points, ${one(s.agent.avgSeconds)} s per run` : undefined} />
        <Card label="Photos saved" value={String(s.exports)} />
      </div>
      <h3 className="mb-2 mt-5 text-[1rem] font-semibold">Where people get to</h3>
      <ul className="m-0 list-none space-y-1.5 p-0">
        {s.funnel.map((f) => (
          <li key={f.step} className="grid grid-cols-[12rem_1fr_6.5rem] items-center gap-2 text-[0.85rem]">
            <span>{f.step}</span>
            <span className="h-2 rounded bg-line"><span className="block h-2 rounded bg-ink" style={{ width: `${(100 * f.sessions) / top}%` }} /></span>
            <span className="text-right tabular-nums text-muted">{f.sessions} ({pct((100 * f.sessions) / top)})</span>
          </li>
        ))}
      </ul>
      <div className="mt-5 grid gap-6 sm:grid-cols-2">
        <section><h3 className="mb-2 text-[1rem] font-semibold">Steering phrases</h3><Bars rows={s.steer.top} empty="No steering yet." /></section>
        <section><h3 className="mb-2 text-[1rem] font-semibold">Breakdown dials touched</h3><Bars rows={s.dials} empty="No dial changes yet." /></section>
        <section><h3 className="mb-2 text-[1rem] font-semibold">Tabs viewed</h3><Bars rows={s.tabs} empty="No tab views yet." /></section>
        <section><h3 className="mb-2 text-[1rem] font-semibold">Masks added</h3><Bars rows={s.masks} empty="No masks yet." /></section>
      </div>
      <p className="mt-5 text-[0.8rem] text-muted">
        Photos opened: {s.photos.sample} sample, {s.photos.upload} uploaded. Agent runs that used region matching: {pct(s.agent.regionsPct)}. Average steps kept per run: {one(s.agent.avgStepsKept)}.
      </p>
    </>
  );
}
