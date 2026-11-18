import { useEffect, useMemo, useRef } from 'react';
import { dominantColors } from '../core/palette.ts';
import type { Swatch } from '../core/palette.ts';
import type { Img } from '../core/types.ts';
import { paint } from '../engine/media.ts';
import { useEditor, useEditorState } from '../state/hooks.tsx';
import { Button, Hint, Slider } from './ui.tsx';

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

export function MatchPane() {
  const { store, engine } = useEditor();
  const ref = useEditorState((s) => s.settings.ref);
  const photoId = useEditorState((s) => s.photoId);
  const hasPhoto = useEditorState((s) => s.hasPhoto);
  const own = useMemo(() => {
    const img = hasPhoto ? engine.thumbSource(160) : null;
    return img ? dominantColors(img, 5) : [];
  }, [engine, photoId, hasPhoto]);

  const choose = (file: File | undefined) => {
    if (!file) return;
    engine.makeReference(file).then((r) => store.setRef(r)).catch((err: unknown) => store.setNotice(err instanceof Error ? err.message : String(err)));
  };
  const bake = () => {
    const curves = engine.bakeReference();
    if (!curves) return;
    store.edit((d) => { d.adj.curves = curves; d.ref = null; }, { commit: true });
    store.setTab('curves');
    store.setNotice('The match is now in your Red, Green and Blue curves. Drag them to fine tune.');
  };
  const colorPct = ref ? Math.round(ref.color * 100) : 0;
  const tonePct = ref ? Math.round(ref.tone * 100) : 0;

  return (
    <>
      <Hint className="mt-0">Pick a photo whose grade you like. ColorCraft learns its brightness and its colours, separately for darks, mids and lights, and applies that to your photo. It copies the grade, not the content.</Hint>
      <label htmlFor="ref-file" className="mt-3 inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-[10px] border border-line bg-raised px-4 py-[11px] text-ink hover:border-muted">
        Choose a reference photo
      </label>
      <input id="ref-file" type="file" accept="image/*" hidden
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; choose(f); }} />
      {ref && (
        <div>
          <div className="mt-3 mb-1 flex items-center gap-3">
            <Thumb img={ref.thumb} />
            <div className="flex flex-wrap gap-1.5">
              {ref.swatches.map((c) => <div key={c.hex} title={c.hex} className="size-12 rounded-lg border border-line" style={{ background: c.hex }} />)}
            </div>
          </div>
          <Slider name="Colour match" tip="How much of the reference's colour toning to borrow." min={0} max={100} step={1} value={colorPct} display={`${colorPct}%`}
            onInput={(v) => store.edit((d) => { if (d.ref) d.ref.color = v / 100; })} onCommit={() => store.commit()} />
          <Slider name="Tone match" tip="How much of its brightness and contrast to borrow." min={0} max={100} step={1} value={tonePct} display={`${tonePct}%`}
            onInput={(v) => store.edit((d) => { if (d.ref) d.ref.tone = v / 100; })} onCommit={() => store.commit()} />
          <Button primary wide className="mb-1" onClick={bake}>Turn into editable curves</Button>
          <Hint>Bakes the match into the Red, Green and Blue lines so you can fine tune it. It is an approximation, so it can differ a little from the live match.</Hint>
          <Button wide className="mt-2.5" onClick={() => store.setRef(null)}>Remove reference</Button>
        </div>
      )}
      <h3 className="mt-[18px] font-serif text-[1.05rem] font-semibold">Colours in your photo</h3>
      <Swatches list={own} />
    </>
  );
}
