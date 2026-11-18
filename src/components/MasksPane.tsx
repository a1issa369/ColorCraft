import { useState } from 'react';
import { BRUSH_STARTERS, MASK_KEYS, MASK_STARTERS, MAX_MASKS, OVAL_STARTERS, RANGE_STARTERS } from '../core/mask.ts';
import type { MaskInput, MaskKey, MaskKind } from '../core/mask.ts';
import { useEditor, useEditorState } from '../state/hooks.tsx';
import { CONTROLS, formatValue } from '../ui/teach.ts';
import { Button, Hint, Slider } from './ui.tsx';

const BLANK: { id: string; name: string; blurb: string; mask: MaskInput } = {
  id: 'blank', name: 'Empty gradient', blurb: 'Place it yourself, then pick what it changes.', mask: { x1: 0.5, y1: 0, x2: 0.5, y2: 0.5 },
};
const BLANK_RANGE: typeof BLANK = {
  id: 'blank-range', name: 'Empty brightness mask', blurb: 'Pick which tones it covers, then choose what it changes.', mask: { kind: 'range', lo: 0.5, hi: 1, soft: 0.15 },
};
const BLANK_OVAL: typeof BLANK = {
  id: 'blank-oval', name: 'Empty oval', blurb: 'Place and size it yourself, then pick what it changes.', mask: { kind: 'radial' },
};
const BLANK_BRUSH: typeof BLANK = {
  id: 'blank-brush', name: 'Empty brush', blurb: 'Paint the area yourself, then pick what it changes.', mask: { kind: 'brush' },
};
const KINDS: { id: MaskKind; label: string; about: string; starters: typeof BLANK[] }[] = [
  { id: 'linear', label: 'Gradient', about: 'A gradient is strongest where it starts and fades to nothing where it ends, which is how you darken a sky without touching the ground.', starters: [...MASK_STARTERS, BLANK] },
  { id: 'range', label: 'Brightness', about: 'A brightness mask picks pixels by how light or dark they are, wherever they sit, which is how you tame highlights or open shadows.', starters: [...RANGE_STARTERS, BLANK_RANGE] },
  { id: 'radial', label: 'Oval', about: 'An oval is strongest in the middle and fades out toward its rim, which is how you light a subject or darken the edges.', starters: [...OVAL_STARTERS, BLANK_OVAL] },
  { id: 'brush', label: 'Brush', about: 'A brush masks exactly what you paint, for the spots no shape fits, like a face in shade.', starters: [...BRUSH_STARTERS, BLANK_BRUSH] },
];
const LABEL: Record<MaskKind, string> = { linear: 'Gradient', range: 'Brightness', radial: 'Oval', brush: 'Brush' };
const RANGE_DEFAULTS = { lo: 0.5, hi: 1, soft: 0.15 };
const MASK_CONTROLS = CONTROLS.filter((c) => (MASK_KEYS as readonly string[]).includes(c.key));

export function MasksPane() {
  const { store } = useEditor();
  const [kind, setKind] = useState<MaskKind>('linear');
  const brush = useEditorState((s) => s.brush);
  const masks = useEditorState((s) => s.settings.masks);
  const sel = useEditorState((s) => s.settings.maskSel);
  const area = useEditorState((s) => s.maskArea);
  const full = masks.length >= MAX_MASKS;
  const current = masks.find((m) => m.id === sel) ?? null;
  const nameOf = (id: string) => {
    const i = masks.findIndex((m) => m.id === id);
    return `${LABEL[masks[i]?.kind ?? 'linear']} ${i + 1}`;
  };
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const kindInfo = KINDS.find((k) => k.id === kind)!;
  const editSelected = (fn: (m: NonNullable<typeof current>) => void, commit = false) =>
    store.edit((d) => { const m = d.masks.find((x) => x.id === d.maskSel); if (m) fn(m); }, { commit });

  return (
    <>
      <Hint className="mt-0">A mask limits an edit to part of the photo. Pick a kind, then start from an example or an empty one.</Hint>
      <div className="mt-3 grid grid-cols-4 gap-1.5" role="group" aria-label="Kind of mask">
        {KINDS.map((k) => (
          <button key={k.id} type="button" aria-pressed={kind === k.id} onClick={() => setKind(k.id)}
            className="min-h-10 cursor-pointer rounded-full border border-line bg-surface px-2 py-1.5 text-[0.88rem] text-muted aria-pressed:border-sage aria-pressed:bg-raised aria-pressed:text-ink">
            {k.label}
          </button>
        ))}
      </div>
      <Hint>{kindInfo.about}</Hint>
      <div className="my-3 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2" role="group" aria-label="Start from">
        {kindInfo.starters.map((st) => (
          <button key={st.id} type="button" disabled={full} onClick={() => store.addMask(st.mask)}
            className="min-h-11 cursor-pointer rounded-[10px] border border-line bg-surface px-3 py-2.5 text-left text-ink hover:enabled:border-muted disabled:cursor-not-allowed disabled:opacity-45">
            <b className="block font-semibold">{st.name}</b>
            <small className="mt-0.5 block text-[0.78rem] leading-snug text-muted">{st.blurb}</small>
          </button>
        ))}
      </div>
      <div className="my-2 flex flex-wrap gap-1.5" role="group" aria-label="Your masks">
        {masks.map((m) => (
          <button key={m.id} type="button" aria-pressed={m.id === sel} onClick={() => store.selectMask(m.id)}
            className="min-h-10 cursor-pointer rounded-full border border-line bg-surface px-3.5 py-1.5 text-[0.9rem] text-muted aria-pressed:border-sage aria-pressed:bg-raised aria-pressed:text-ink">
            {nameOf(m.id)}
          </button>
        ))}
      </div>
      {current && (
        <div>
          <div className="mt-2.5 mb-1 grid grid-cols-3 gap-2">
            <Button className="min-h-10 text-[0.9rem]" onClick={() => editSelected((m) => { m.invert = !m.invert; }, true)}>Flip</Button>
            <Button className="min-h-10 text-[0.9rem]" aria-pressed={area} onClick={() => store.toggleMaskArea()}>Show area</Button>
            <Button className="min-h-10 text-[0.9rem]" onClick={() => store.removeSelectedMask()}>Remove</Button>
          </div>
          {current.kind === 'range' && (

            <>
              <Hint>{nameOf(current.id)}: the edit lands on pixels between From and To, fading out over Softness on either side. 0% is black and 100% is white. Show area paints the picked pixels red. Flip swaps to everything else.</Hint>
              {([
                ['lo', 'From', 'The darkest tone the mask picks. Everything darker than this, less the fade, is left alone.', 0, 100],
                ['hi', 'To', 'The brightest tone the mask picks. Everything brighter than this, less the fade, is left alone.', 0, 100],
                ['soft', 'Softness', 'How gradually the mask fades out at each end. Low is a hard cut, high blends smoothly.', 0, 50],
              ] as const).map(([k, name, tip, min, max]) => (
                <Slider key={k} name={name} tip={tip} min={min} max={max} step={1}
                  value={Math.round(current[k] * 100)} display={pct(current[k])}
                  onInput={(v) => editSelected((m) => {
                    m[k] = v / 100;
                    if (k === 'lo' && m.hi < m.lo) m.hi = m.lo;
                    if (k === 'hi' && m.lo > m.hi) m.lo = m.hi;
                  })}
                  onCommit={() => store.commit()}
                  onReset={() => editSelected((m) => { m[k] = RANGE_DEFAULTS[k]; }, true)} />
              ))}
            </>
          )}
          {current.kind === 'linear' && (
            <Hint>{nameOf(current.id)}: drag the filled dot to move where it is strongest, and the open dot to move where it fades out completely. Flip swaps which side gets the edit.</Hint>
          )}
          {current.kind === 'radial' && (
            <>
              <Hint>{nameOf(current.id)}: drag the filled dot to move the oval, the open dots on its edges to resize it, and the dot beyond its top edge to turn it. Flip swaps to everything outside.</Hint>
              <Slider name="Angle" tip="Tilts the oval. You can also drag the dot above it."
                min={-90} max={90} step={1} value={Math.round((current.angle * 180) / Math.PI)} display={`${Math.round((current.angle * 180) / Math.PI)}°`}
                onInput={(v) => editSelected((m) => { m.angle = (v * Math.PI) / 180; })} onCommit={() => store.commit()}
                onReset={() => editSelected((m) => { m.angle = 0; }, true)} />
              <Slider name="Edge softness" tip="How gradually the oval fades out. Low is a crisp edge, high blends all the way in from the middle."
                min={1} max={100} step={1} value={Math.round(current.feather * 100)} display={pct(current.feather)}
                onInput={(v) => editSelected((m) => { m.feather = v / 100; })} onCommit={() => store.commit()}
                onReset={() => editSelected((m) => { m.feather = 0.4; }, true)} />
            </>
          )}
          {current.kind === 'brush' && (
            <>
              <Hint>{nameOf(current.id)}: drag on the photo to paint where the edit lands. Each stroke is one undo step. Switch to Erase to take paint away. Flip swaps to everything you did not paint.</Hint>
              <div className="my-2 grid grid-cols-2 gap-2">
                <Button className="min-h-10 text-[0.9rem]" aria-pressed={!brush.erase} onClick={() => store.setBrush({ erase: false })}>Paint</Button>
                <Button className="min-h-10 text-[0.9rem]" aria-pressed={brush.erase} onClick={() => store.setBrush({ erase: true })}>Erase</Button>
              </div>
              <Slider name="Brush size" tip="Applies to the next stroke you paint."
                min={1} max={25} step={1} value={Math.round(brush.size * 100)} display={`${Math.round(brush.size * 200)}% of width`}
                onInput={(v) => store.setBrush({ size: v / 100 })} onCommit={() => undefined} onReset={() => store.setBrush({ size: 0.05 })} />
              <Slider name="Brush softness" tip="Low is a hard edge, high fades the stroke out smoothly."
                min={0} max={100} step={1} value={Math.round(brush.soft * 100)} display={pct(brush.soft)}
                onInput={(v) => store.setBrush({ soft: v / 100 })} onCommit={() => undefined} onReset={() => store.setBrush({ soft: 0.5 })} />
              <Button className="min-h-10 text-[0.9rem]" disabled={!current.strokes.length}
                onClick={() => editSelected((m) => { m.strokes = []; }, true)}>Clear painting</Button>
            </>
          )}
          <div>
            {MASK_CONTROLS.map((c) => {
              const key = c.key as MaskKey;
              return (
                <Slider key={key} name={c.name} tip={c.tip} min={c.min} max={c.max} step={c.step}
                  value={current.adj[key]} display={formatValue(c, current.adj[key])}
                  onInput={(v) => editSelected((m) => { m.adj[key] = v; })} onCommit={() => store.commit()}
                  onReset={() => editSelected((m) => { m.adj[key] = 0; }, true)} />
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
