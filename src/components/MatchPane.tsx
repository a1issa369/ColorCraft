import { useEffect, useMemo, useRef } from 'react';
import { DIALS, DIAL_LABEL } from '../core/matchscore.ts';
import type { DialId } from '../core/matchscore.ts';
import { dominantColors } from '../core/palette.ts';
import type { Swatch } from '../core/palette.ts';
import type { Adjustments, Img } from '../core/types.ts';
import { track } from '../analytics/track.ts';
import { paint } from '../engine/media.ts';
import { useEditor, useEditorState } from '../state/hooks.tsx';
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

/** The agent's steps in two or three words, for people who just want to know what changed. */
const STEP_LABEL: Record<string, string> = {
  brightness: 'Brightness', tone: 'Contrast and tones', warmth: 'Warmth', colour: 'Colour strength',
  toning: 'Shadow and highlight colour', region: 'Sky and ground', refine: 'Fine adjustments',
};

function Breakdown() {
  const { store } = useEditor();
  const adj = useEditorState((s) => s.settings.adj);
  const c = useEditorState((s) => s.agent.closeness);
  if (!c) return null;
  return (
    <div>
      {DIALS.map((id) => {
        const k = DIAL_CONTROLS[id];
        const v = k.get(adj);
        return (
          <div key={id} className="pt-2">
            <Bar value={c.dials[id]} label={`${DIAL_LABEL[id]} closeness`} />
            <Slider name={DIAL_LABEL[id]} tip={k.tip} min={k.min} max={k.max} step={k.step} value={v}
              display={`${pct(c.dials[id])} close`}
              onInput={(x) => store.edit((d) => { k.set(d.adj, x); })}
              onCommit={() => { store.commit(); track('dial_changed', { dial: id }); }}
              onReset={() => store.edit((d) => { k.set(d.adj, k.reset); }, { commit: true })} />
          </div>
        );
      })}
    </div>
  );
}

function Agent() {
  const { store, engine } = useEditor();
  const agent = useEditorState((s) => s.agent);
  const live = useEditorState((s) => !!s.settings.ref);
  const running = agent.status === 'running';
  const overall = agent.closeness?.overall ?? null;
  if (!agent.ref) return null;
  const done = agent.steps.filter((s) => s.kept && STEP_LABEL[s.kind]);
  return (
    <div className="mt-4">
      <Button primary wide disabled={running} onClick={() => { void engine.runAgent(); }}>
        {running ? 'Matching…' : agent.steps.length ? 'Match again' : 'Match my photo to this'}
      </Button>
      {overall !== null && (
        <div className="mt-3">
          <div className="flex items-baseline justify-between text-[0.9rem]">
            <span>{running ? 'Working on it' : agent.before !== null ? `Matched, from ${pct(agent.before)}` : 'Match so far'}</span>
            <output className="font-semibold tabular-nums" aria-live="polite">{pct(overall)}</output>
          </div>
          <Bar value={overall} label="How close your photo is to the reference" />
        </div>
      )}
      {live && <Hint className="text-warn">Quick live match is on, so this can look different. Matching switches it off.</Hint>}
      {done.length > 0 && !running && (
        <details className="mt-3 border-t border-line pt-1">
          <summary className="flex min-h-10 cursor-pointer items-center text-[0.9rem] text-muted">What changed</summary>
          <ul className="m-0 mb-1 grid list-none gap-1.5 p-0 text-[0.85rem]">
            {done.map((st) => (
              <li key={st.id} className="flex items-baseline justify-between gap-2">
                <span><b className="font-semibold">{STEP_LABEL[st.kind]}</b> <span className="text-muted">{st.changes.join(', ')}</span></span>
                <button type="button" className="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-[0.8rem] text-muted underline hover:text-ink"
                  onClick={() => { store.jumpToStep(agent.steps.indexOf(st)); track('agent_step_jump', { step: st.kind }); }}>Go back here</button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {agent.steps.length > 0 && !running && (
        <details className="border-t border-line pt-1">
          <summary className="flex min-h-10 cursor-pointer items-center text-[0.9rem] text-muted">Fine tune</summary>
          <Breakdown />
        </details>
      )}
      {agent.steps.length > 0 && !running && <Hint>For tweaks in your own words, like "a bit warmer", ask the assistant in the corner.</Hint>}
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
      <Hint className="mt-0">Pick a photo whose colours you like and I'll match yours to it. Only the look is copied, not the picture.</Hint>
      <label htmlFor="ref-file" className="mt-3 inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-[10px] border border-line bg-raised px-4 py-[11px] text-ink hover:border-muted">
        {ref ? 'Choose a different reference photo' : 'Choose a reference photo'}
      </label>
      <input id="ref-file" type="file" accept="image/*" hidden
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; choose(f); }} />
      {ref && <div className="mt-3"><Thumb img={ref.thumb} /></div>}
      <Agent />
      {ref && (
        <details className="mt-5 border-t border-line pt-2.5" open={!!live}>
          <summary className="flex min-h-10 cursor-pointer items-center font-serif text-[1.05rem] font-semibold">Quick live match</summary>
          <Hint>A fast, adjustable effect instead of step-by-step edits.</Hint>
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
