import { MASK_KEYS, MASK_STARTERS, MAX_MASKS, RANGE_STARTERS } from '../core/mask.ts';
import type { MaskInput, MaskKey } from '../core/mask.ts';
import { useEditor, useEditorState } from '../state/hooks.tsx';
import { CONTROLS, formatValue } from '../ui/teach.ts';
import { Button, Hint, Slider } from './ui.tsx';

const BLANK: { id: string; name: string; blurb: string; mask: MaskInput } = {
  id: 'blank', name: 'Empty gradient', blurb: 'Place it yourself, then pick what it changes.', mask: { x1: 0.5, y1: 0, x2: 0.5, y2: 0.5 },
};
const BLANK_RANGE: typeof BLANK = {
  id: 'blank-range', name: 'Empty brightness mask', blurb: 'Pick which tones it covers, then choose what it changes.', mask: { kind: 'range', lo: 0.5, hi: 1, soft: 0.15 },
};
const RANGE_DEFAULTS = { lo: 0.5, hi: 1, soft: 0.15 };
const MASK_CONTROLS = CONTROLS.filter((c) => (MASK_KEYS as readonly string[]).includes(c.key));

export function MasksPane() {
  const { store } = useEditor();
  const masks = useEditorState((s) => s.settings.masks);
  const sel = useEditorState((s) => s.settings.maskSel);
  const area = useEditorState((s) => s.maskArea);
  const full = masks.length >= MAX_MASKS;
  const current = masks.find((m) => m.id === sel) ?? null;
  const nameOf = (id: string) => {
    const i = masks.findIndex((m) => m.id === id);
    return `${masks[i]?.kind === 'range' ? 'Brightness' : 'Gradient'} ${i + 1}`;
  };
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const editSelected = (fn: (m: NonNullable<typeof current>) => void, commit = false) =>
    store.edit((d) => { const m = d.masks.find((x) => x.id === d.maskSel); if (m) fn(m); }, { commit });

  return (
    <>
      <Hint className="mt-0">A mask limits an edit to part of the photo. A gradient is strongest where it starts and fades to nothing where it ends, which is how you darken a sky without touching the ground. A brightness mask picks pixels by how light or dark they are, wherever they sit, which is how you tame highlights or open shadows.</Hint>
      <div className="my-3 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2" role="group" aria-label="Start from">
        {[...MASK_STARTERS, BLANK, ...RANGE_STARTERS, BLANK_RANGE].map((st) => (
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
          {current.kind === 'range' ? (
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
          ) : (
            <Hint>{nameOf(current.id)}: drag the filled dot to move where it is strongest, and the open dot to move where it fades out completely. Flip swaps which side gets the edit.</Hint>
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
