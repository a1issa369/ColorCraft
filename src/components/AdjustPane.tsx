import { useState } from 'react';
import { DEFAULTS } from '../core/adjust.ts';
import { BANDS, makeHsl } from '../core/hsl.ts';
import { useEditor, useEditorState } from '../state/hooks.tsx';
import { CONTROLS, formatValue } from '../ui/teach.ts';
import { Button, Hint, Slider } from './ui.tsx';

const BAND_DOT = ['#d9453d', '#e08a3a', '#d9c53d', '#58b45f', '#3fb5b0', '#4a7fd6', '#9a6fc4', '#cf5fa0'];
const MIX = [
  { key: 'hue', name: 'Hue', tip: 'Slides this colour toward its neighbours.' },
  { key: 'sat', name: 'Saturation', tip: 'How strong this colour is.' },
  { key: 'lum', name: 'Brightness', tip: 'How light or dark this colour is.' },
] as const;

export function AdjustPane() {
  const { store } = useEditor();
  const adj = useEditorState((s) => s.settings.adj);
  const [band, setBand] = useState(0);
  const commit = () => store.commit();

  return (
    <>
      <div>
        {CONTROLS.map((c) => (
          <Slider key={c.key} name={c.name} tip={c.tip} min={c.min} max={c.max} step={c.step}
            value={adj[c.key]} display={formatValue(c, adj[c.key])}
            onInput={(v) => store.edit((d) => { d.adj[c.key] = v; })} onCommit={commit}
            onReset={() => store.edit((d) => { d.adj[c.key] = DEFAULTS[c.key]; }, { commit: true })} />
        ))}
      </div>
      <details className="mt-1.5 border-t border-line pt-2.5">
        <summary className="flex min-h-10 cursor-pointer items-center font-serif text-[1.05rem] font-semibold">Colour mix</summary>
        <Hint>Change one family of colours without touching the rest. Pick a colour, then move its sliders.</Hint>
        <div className="mt-2.5 mb-1 grid grid-cols-4 gap-1.5" role="group" aria-label="Colour family">
          {BANDS.map((b, i) => (
            <button key={b.id} type="button" aria-pressed={i === band} onClick={() => setBand(i)}
              className="flex min-h-11 cursor-pointer flex-col items-center justify-center gap-[3px] rounded-lg border border-line bg-surface p-1 text-[0.82rem] text-muted aria-pressed:border-ink aria-pressed:bg-raised aria-pressed:text-ink">
              <i className="block size-3.5 rounded-full border border-black/40" style={{ background: BAND_DOT[i] }} />
              {b.name}
            </button>
          ))}
        </div>
        <div>
          {MIX.map((m) => {
            const v = adj.hsl ? adj.hsl[m.key][band] : 0;
            return (
              <Slider key={m.key} name={m.name} tip={m.tip} min={-100} max={100} step={1} value={v}
                display={`${v > 0 ? '+' : ''}${v}`}
                onInput={(n) => store.edit((d) => { const h = d.adj.hsl ?? (d.adj.hsl = makeHsl()); h[m.key][band] = n; })}
                onCommit={commit}
                onReset={() => store.edit((d) => { if (d.adj.hsl) d.adj.hsl[m.key][band] = 0; }, { commit: true })} />
            );
          })}
        </div>
        <Button wide className="mt-1" onClick={() => store.edit((d) => { d.adj.hsl = null; }, { commit: true })}>Reset colour mix</Button>
      </details>
    </>
  );
}
