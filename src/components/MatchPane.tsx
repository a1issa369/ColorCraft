import { useEffect, useMemo, useRef, useState } from 'react';
import { DIALS, DIAL_LABEL } from '../core/matchscore.ts';
import type { DialId } from '../core/matchscore.ts';
import { dominantColors } from '../core/palette.ts';
import type { Swatch } from '../core/palette.ts';
import type { Adjustments, Img } from '../core/types.ts';
import { track } from '../analytics/track.ts';
import { paint } from '../engine/media.ts';
import { useEditor, useEditorState } from '../state/hooks.tsx';
import { STEER_EXAMPLES } from '../state/steer.ts';
import type { AgentStep } from '../state/agent.ts';
import { Button, Hint, Slider, cx } from './ui.tsx';

function Swatches({ list }: { list: Swatch[] }) {
  return (
    <div className="my-3 flex flex-wrap gap-1.5">
      {list.map((c) => <div key={c.hex} title={c.hex} className="size-12 rounded-lg border border-line" style={{ background: c.hex }} />)}
    </div>
  );
}

function Thumb({ img }: { img: Img }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => { if (ref.current) paint(ref.current, img); }, [img]);
  return <canvas ref={ref} aria-label="Reference photo" className="h-auto w-24 flex-none rounded-lg border border-line" />;
}

const pct = (v: number) => `${Math.round(v)}%`;

/** Each dial is scored 0 to 100 against the reference, and is tied to the real control that moves it. */
interface DialControl {
  min: number; max: number; step: number;
  get: (a: Adjustments) => number;
  set: (a: Adjustments, v: number) => void;
  show: (v: number) => string;
  reset: number;
  tip: string;
}
const signed = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)}`;
const DIAL_CONTROLS: Record<DialId, DialControl> = {
  brightness: { min: -2, max: 2, step: 0.05, get: (a) => a.exposure, set: (a, v) => { a.exposure = v; }, show: (v) => `Exposure ${v > 0 ? '+' : ''}${v.toFixed(2)}`, reset: 0, tip: 'Moves Exposure. Closer to 100% means the middle of your photo is as bright as the reference.' },
  contrast: { min: -100, max: 100, step: 1, get: (a) => a.contrast, set: (a, v) => { a.contrast = v; }, show: (v) => `Contrast ${signed(v)}`, reset: 0, tip: 'Moves Contrast. Matches how far apart your darks and lights sit.' },
  warmth: { min: -100, max: 100, step: 1, get: (a) => a.temperature, set: (a, v) => { a.temperature = v; }, show: (v) => `Temperature ${signed(v)}`, reset: 0, tip: 'Moves Temperature. Matches the overall colour of the light.' },
  colour: { min: -100, max: 100, step: 1, get: (a) => a.saturation, set: (a, v) => { a.saturation = v; }, show: (v) => `Saturation ${signed(v)}`, reset: 0, tip: 'Moves Saturation. Matches how strong the colours are.' },
  shadowTint: { min: 0, max: 100, step: 1, get: (a) => Math.round(a.splitShadow.amount * 100), set: (a, v) => { a.splitShadow = { ...a.splitShadow, amount: v / 100 }; }, show: (v) => `Shadow tint ${v}%`, reset: 0, tip: 'Moves how much colour the dark parts are tinted. The agent chose the colour.' },
  highlightTint: { min: 0, max: 100, step: 1, get: (a) => Math.round(a.splitHighlight.amount * 100), set: (a, v) => { a.splitHighlight = { ...a.splitHighlight, amount: v / 100 }; }, show: (v) => `Highlight tint ${v}%`, reset: 0, tip: 'Moves how much colour the bright parts are tinted. The agent chose the colour.' },
};

function Bar({ value, label }: { value: number; label: string }) {
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)} className="h-1.5 overflow-hidden rounded-full bg-raised">
      <div className={cx('h-full rounded-full transition-[width] duration-300', value >= 80 ? 'bg-sage' : 'bg-warn')} style={{ width: `${Math.max(2, value)}%` }} />
    </div>
  );
}

function Breakdown() {
  const { store } = useEditor();
  const adj = useEditorState((s) => s.settings.adj);
  const c = useEditorState((s) => s.agent.closeness);
  if (!c) return null;
  return (
    <section aria-labelledby="dials-h" className="mt-5">
      <h3 id="dials-h" className="font-serif text-[1.05rem] font-semibold">Fine tune the match</h3>
      <Hint className="mt-0.5">Each dial shows how close your photo is to the reference on one thing, and its slider moves the real control behind it.</Hint>
      {DIALS.map((id) => {
        const k = DIAL_CONTROLS[id];
        const v = k.get(adj);
        return (
          <div key={id} className="pt-2">
            <Bar value={c.dials[id]} label={`${DIAL_LABEL[id]} closeness`} />
            <Slider name={DIAL_LABEL[id]} tip={k.tip} min={k.min} max={k.max} step={k.step} value={v}
              display={`${pct(c.dials[id])} close · ${k.show(v)}`}
              onInput={(x) => store.edit((d) => { k.set(d.adj, x); })}
              onCommit={() => { store.commit(); track('dial_changed', { dial: id }); }}
              onReset={() => store.edit((d) => { k.set(d.adj, k.reset); }, { commit: true })} />
          </div>
        );
      })}
    </section>
  );
}

function StepRow({ step, index, last }: { step: AgentStep; index: number; last: boolean }) {
  const { store } = useEditor();
  return (
    <li className={cx('rounded-[10px] border border-line bg-surface px-3 py-2.5', !step.kept && 'opacity-70')}>
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="m-0 text-[0.95rem] font-semibold">
          <span aria-hidden="true" className={cx('mr-1.5', step.kept ? 'text-sage' : 'text-muted')}>{step.kept ? '✓' : '–'}</span>
          {step.title}
          {!step.kept && <span className="ml-1.5 text-[0.78rem] font-normal text-muted">(skipped)</span>}
        </h4>
        <span className="text-[0.82rem] tabular-nums text-muted" title="Closeness to the reference before and after this step">
          {Math.round(step.before)}% to {Math.round(step.after)}%
        </span>
      </div>
      <p className="mt-1 mb-0 text-[0.85rem] text-muted">{step.why}</p>
      {step.changes.length > 0 && (
        <ul className="mt-1.5 mb-0 flex list-none flex-wrap gap-1 p-0">
          {step.changes.map((c) => <li key={c} className="rounded-md border border-line bg-raised px-1.5 py-0.5 text-[0.78rem] text-ink">{c}</li>)}
        </ul>
      )}
      {!last && step.kind !== 'steer' && (
        <button type="button" className="mt-1.5 min-h-8 cursor-pointer rounded-md border border-line bg-transparent px-2 text-[0.8rem] text-muted hover:text-ink"
          onClick={() => { store.jumpToStep(index); track('agent_step_jump', { step: step.kind }); }}>
          Go back to here
        </button>
      )}
    </li>
  );
}

function Steer() {
  const { engine } = useEditor();
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  const go = (t: string) => {
    if (!t.trim()) return;
    const r = engine.steer(t);
    if (r.moved) { setText(''); setMsg(r.leftover ? `Done, except I did not understand: ${r.leftover}.` : `Done: ${r.understood.join(', ')}.`); }
    else setMsg(r.leftover || r.understood.length ? `That would not change anything: ${r.understood.join(', ') || t}.` : `I did not understand "${t.trim().slice(0, 40)}". Try one of the phrases below.`);
  };
  return (
    <section aria-labelledby="steer-h" className="mt-5">
      <h3 id="steer-h" className="font-serif text-[1.05rem] font-semibold">Steer it in plain English</h3>
      <Hint className="mt-0.5">Say how you want to differ from the reference. It understands a set list of phrases, like the ones below, and moves the matching controls. It is not an AI model and nothing you type leaves your browser.</Hint>
      <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); go(text); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} aria-label="Steer the match" placeholder="warmer, but keep the shadows deep" maxLength={120}
          className="min-h-11 min-w-0 flex-1 rounded-[10px] border border-line bg-surface px-3 text-ink placeholder:text-muted" />
        <Button type="submit" disabled={!text.trim()}>Steer</Button>
      </form>
      <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Example phrases">
        {STEER_EXAMPLES.map((e) => (
          <button key={e} type="button" onClick={() => go(e)}
            className="min-h-8 cursor-pointer rounded-full border border-line bg-surface px-2.5 text-[0.82rem] text-muted hover:border-muted hover:text-ink">{e}</button>
        ))}
      </div>
      <Hint role="status">{msg}</Hint>
    </section>
  );
}

function Agent() {
  const { engine } = useEditor();
  const agent = useEditorState((s) => s.agent);
  const live = useEditorState((s) => !!s.settings.ref);
  const running = agent.status === 'running';
  const overall = agent.closeness?.overall ?? null;
  const listEnd = useRef<HTMLLIElement | null>(null);
  useEffect(() => { listEnd.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [agent.steps.length]);
  if (!agent.ref) return null;
  return (
    <div className="mt-4">
      <div className="rounded-[10px] border border-line bg-surface px-3.5 py-3">
        <div className="flex items-baseline justify-between">
          <span className="font-semibold">Closeness to the reference</span>
          <output className="font-serif text-[1.5rem] font-semibold tabular-nums" aria-live="polite">{overall === null ? '...' : pct(overall)}</output>
        </div>
        <Bar value={overall ?? 0} label="Overall closeness to the reference" />
        {agent.before !== null && overall !== null && (
          <p className="mt-1.5 mb-0 text-[0.82rem] text-muted">Started at {pct(agent.before)}. {overall >= agent.before ? `Up ${Math.round(overall - agent.before)} points.` : 'Lower than where the agent started, because of changes made since.'}</p>
        )}
      </div>
      <Button primary wide className="mt-3" disabled={running} onClick={() => { void engine.runAgent(); }}>
        {running ? 'Matching your photo...' : agent.steps.length ? 'Run the match again' : 'Match my photo to this reference'}
      </Button>
      <Hint>The agent edits your photo toward the reference one thing at a time, checks how close it got after each step, and keeps only what helped. It uses the same sliders, tints and masks you can edit yourself, and every step is an undo step.</Hint>
      {live && <Hint className="text-warn">A quick live match is switched on, so the sliders below will not show the full effect. Running the agent switches it off.</Hint>}
      {agent.steps.length > 0 && (
        <ol aria-label="What the agent did" className="mt-3 grid list-none gap-2 p-0" aria-busy={running}>
          {agent.steps.map((s, i) => <StepRow key={s.id} step={s} index={i} last={running && i === agent.steps.length - 1} />)}
          {running && <li ref={listEnd} className="px-1 text-[0.85rem] text-muted" role="status">Working on the next step...</li>}
        </ol>
      )}
      {agent.steps.length > 0 && !running && (
        <>
          <Breakdown />
          <Steer />
        </>
      )}
    </div>
  );
}

export function MatchPane() {
  const { store, engine } = useEditor();
  const live = useEditorState((s) => s.settings.ref);
  const agentRef = useEditorState((s) => s.agent.ref);
  const photoId = useEditorState((s) => s.photoId);
  const hasPhoto = useEditorState((s) => s.hasPhoto);
  const own = useMemo(() => {
    const img = hasPhoto ? engine.thumbSource(160) : null;
    return img ? dominantColors(img, 5) : [];
  }, [engine, photoId, hasPhoto]);

  const choose = (file: File | undefined) => {
    if (!file) return;
    engine.makeReference(file).then((r) => { store.setAgentRef(r); track('reference_chosen'); }).catch((err: unknown) => store.setNotice(err instanceof Error ? err.message : String(err)));
  };
  const bake = () => {
    const curves = engine.bakeReference();
    if (!curves) return;
    store.edit((d) => { d.adj.curves = curves; d.ref = null; }, { commit: true });
    store.setTab('curves');
    store.setNotice('The match is now in your Red, Green and Blue curves. Drag them to fine tune.');
  };
  const colorPct = live ? Math.round(live.color * 100) : 0;
  const tonePct = live ? Math.round(live.tone * 100) : 0;
  const ref = agentRef;

  return (
    <>
      <Hint className="mt-0">Pick a photo whose look you like. The match agent edits yours to match it, shows every step, and leaves you the controls to take it further. It copies the grade, not the content.</Hint>
      <label htmlFor="ref-file" className="mt-3 inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-[10px] border border-line bg-raised px-4 py-[11px] text-ink hover:border-muted">
        {ref ? 'Choose a different reference photo' : 'Choose a reference photo'}
      </label>
      <input id="ref-file" type="file" accept="image/*" hidden
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; choose(f); }} />
      {ref && (
        <div className="mt-3 flex items-center gap-3">
          <Thumb img={ref.thumb} />
          <div className="flex flex-wrap gap-1.5">
            {ref.swatches.map((c) => <div key={c.hex} title={c.hex} className="size-12 rounded-lg border border-line" style={{ background: c.hex }} />)}
          </div>
        </div>
      )}
      <Agent />
      {ref && (
        <details className="mt-5 border-t border-line pt-2.5" open={!!live}>
          <summary className="flex min-h-10 cursor-pointer items-center font-serif text-[1.05rem] font-semibold">Quick live match</summary>
          <Hint>One click, no steps: copies the reference's tones and colours as a live effect you can dial up and down. Good for a fast look. For something you can edit control by control, use the agent above.</Hint>
          {!live && <Button wide className="mt-2" onClick={() => { store.setRef(ref); track('live_match_used'); }}>Use it as a live match</Button>}
          {live && (
            <div>
              <Slider name="Colour match" tip="How much of the reference's colour toning to borrow." min={0} max={100} step={1} value={colorPct} display={`${colorPct}%`}
                onInput={(v) => store.edit((d) => { if (d.ref) d.ref.color = v / 100; })} onCommit={() => store.commit()} />
              <Slider name="Tone match" tip="How much of its brightness and contrast to borrow." min={0} max={100} step={1} value={tonePct} display={`${tonePct}%`}
                onInput={(v) => store.edit((d) => { if (d.ref) d.ref.tone = v / 100; })} onCommit={() => store.commit()} />
              <Button wide className="mb-1" onClick={bake}>Turn into editable curves</Button>
              <Hint>Bakes the match into the Red, Green and Blue lines so you can fine tune it. It is an approximation, so it can differ a little from the live match.</Hint>
              <Button wide className="mt-2.5" onClick={() => store.setRef(null)}>Switch off live match</Button>
            </div>
          )}
        </details>
      )}
      <h3 className="mt-[18px] font-serif text-[1.05rem] font-semibold">Colours in your photo</h3>
      <Swatches list={own} />
    </>
  );
}
