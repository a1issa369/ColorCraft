import { useEffect, useMemo, useRef } from 'react';
import { applyAdjustments, combine, makeAdjustments } from '../core/adjust.ts';
import { LOOKS, LOOK_GROUPS, lookById } from '../core/looks.ts';
import type { Img } from '../core/types.ts';
import { paint } from '../engine/media.ts';
import { useEditor, useEditorState } from '../state/hooks.tsx';
import { Hint, Slider } from './ui.tsx';

function LookTile({ id, name, thumb, pressed, onPick }: { id: string | null; name: string; thumb: Img; pressed: boolean; onPick: () => void }) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const look = lookById(id);
    if (canvas.current) paint(canvas.current, look ? applyAdjustments(thumb, combine(makeAdjustments(), look.adj, 1)) : thumb);
  }, [id, thumb]);
  return (
    <button type="button" aria-pressed={pressed} onClick={onPick}
      className="flex min-h-11 cursor-pointer touch-manipulation flex-col items-stretch overflow-hidden rounded-[10px] border border-line bg-raised p-0 text-center text-ink hover:border-muted aria-pressed:border-sage aria-pressed:shadow-[0_0_0_1px_var(--color-sage)]">
      <canvas ref={canvas} className="block h-auto w-full rounded-t-lg" />
      <span className="px-1.5 py-2 text-[0.85rem]">{name}</span>
    </button>
  );
}

const GRID = 'mb-3 grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-2';

export function LooksPane() {
  const { store, engine } = useEditor();
  const photoId = useEditorState((s) => s.photoId);
  const hasPhoto = useEditorState((s) => s.hasPhoto);
  const look = useEditorState((s) => s.settings.look);
  const strength = useEditorState((s) => s.settings.lookStrength);
  // One small copy of the photo per photo; every tile is drawn from it.
  const thumb = useMemo(() => (hasPhoto ? engine.thumbSource(120) : null), [engine, photoId, hasPhoto]);
  const pick = (id: string | null) => store.edit((d) => { d.look = id; }, { commit: true });
  const pct = Math.round(strength * 100);

  return (
    <>
      {thumb && (
        <div>
          <div className={GRID}><LookTile id={null} name="None" thumb={thumb} pressed={look === null} onPick={() => pick(null)} /></div>
          {LOOK_GROUPS.map((group) => (
            <div key={group}>
              <h3 className="mt-3.5 mb-2 text-base font-semibold text-muted first:mt-0">{group}</h3>
              <div className={GRID}>
                {LOOKS.filter((l) => l.group === group).map((l) => (
                  <LookTile key={l.id} id={l.id} name={l.name} thumb={thumb} pressed={look === l.id} onPick={() => pick(l.id)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="mt-2">
        <Slider name="Look strength" min={0} max={100} step={1} value={pct} display={`${pct}%`}
          onInput={(v) => store.edit((d) => { d.lookStrength = v / 100; })} onCommit={() => store.commit()} />
      </div>
      <Hint>{lookById(look)?.blurb ?? 'Pick a look to start from. It stacks on top of your sliders and curves.'}</Hint>
    </>
  );
}
