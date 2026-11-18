import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, RefObject } from 'react';
import type { Mask } from '../core/mask.ts';
import { useEditor, useEditorState } from '../state/hooks.tsx';
import { Button } from './ui.tsx';

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** One draggable dot of a mask gradient. Pointer drag and arrow keys both move it. */
function MaskHandle({ kind, mask, stage }: { kind: 'start' | 'end'; mask: Mask; stage: RefObject<HTMLDivElement | null> }) {
  const { store } = useEditor();
  const dragging = useRef(false);
  const kx = kind === 'start' ? 'x1' : 'x2', ky = kind === 'start' ? 'y1' : 'y2';
  const x = mask[kx], y = mask[ky];
  const set = (nx: number, ny: number) => store.edit((d) => {
    const m = d.masks.find((q) => q.id === mask.id);
    if (m) { m[kx] = clamp01(nx); m[ky] = clamp01(ny); }
  });
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const r = stage.current?.getBoundingClientRect();
    if (!dragging.current || !r) return;
    set((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.05 : 0.01;
    const dx = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
    const dy = e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0;
    if (!dx && !dy) return;
    e.preventDefault();
    set(x + dx, y + dy);
  };
  const end = () => { if (dragging.current) { dragging.current = false; store.commit(); } };
  const pct = (v: number) => Math.round(v * 100);
  return (
    <div role="slider" tabIndex={0} id={kind === 'start' ? 'mh-start' : 'mh-end'}
      aria-label={kind === 'start' ? 'Where the mask is strongest. Drag, or use the arrow keys.' : 'Where the mask fades out completely. Drag, or use the arrow keys.'}
      aria-valuetext={`${pct(x)}% across, ${pct(y)}% down`} aria-valuenow={pct(x)}
      // Keep the dots just inside the photo so one sitting on an edge can still be grabbed (the stage clips what sticks out).
      style={{ left: `clamp(20px, ${x * 100}%, calc(100% - 20px))`, top: `clamp(20px, ${y * 100}%, calc(100% - 20px))` }}
      className="pointer-events-auto absolute -mt-[22px] -ml-[22px] grid size-11 cursor-grab touch-none place-items-center rounded-full active:cursor-grabbing"
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); dragging.current = true; e.preventDefault(); }}
      onPointerMove={onMove} onPointerUp={end} onPointerCancel={end}
      onKeyDown={onKey} onKeyUp={(e) => { if (e.key.startsWith('Arrow')) store.commit(); }}>
      <span className={kind === 'start'
        ? 'size-[22px] rounded-full border-2 border-bg bg-sage shadow-[0_0_0_2px_var(--color-sage-ink)]'
        : 'size-[22px] rounded-full border-2 border-ink bg-bg/35 shadow-[0_0_0_1px_rgba(0,0,0,.6)]'} />
    </div>
  );
}

export function Stage() {
  const { store, engine } = useEditor();
  const split = useEditorState((s) => s.split);
  const hold = useEditorState((s) => s.hold);
  const tab = useEditorState((s) => s.tab);
  const masks = useEditorState((s) => s.settings.masks);
  const sel = useEditorState((s) => s.settings.maskSel);
  useEditorState((s) => s.photoId);          // a new photo changes the stage's shape
  const view = useRef<HTMLCanvasElement | null>(null);
  const tint = useRef<HTMLCanvasElement | null>(null);
  const stage = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);

  useEffect(() => {
    if (!view.current || !tint.current) return;
    engine.attach(view.current, tint.current);
    return () => engine.detach();
  }, [engine]);

  const moveHandle = (clientX: number) => {
    const r = stage.current?.getBoundingClientRect();
    if (r) store.setSplit((clientX - r.left) / r.width);
  };
  const shown = hold ? 1 : split;
  const mask = tab === 'masks' ? masks.find((m) => m.id === sel) ?? null : null;

  return (
    <div ref={stage} id="stage"
      style={{ width: `min(100%, calc(var(--maxh) * ${engine.aspect.toFixed(4)}))` }}
      className="relative mx-auto touch-pan-y overflow-hidden rounded-[10px] bg-[#0b0b0a] select-none [--maxh:36vh] min-[900px]:[--maxh:74vh]">
      <canvas id="view" ref={view} aria-label="Photo preview. Drag the handle to compare before and after." className="block h-auto w-full" />
      <canvas id="mask-tint" ref={tint} hidden aria-hidden="true" className="pointer-events-none absolute inset-0 size-full" />
      {mask && mask.kind === 'linear' && (
        <div id="mask-ui" className="pointer-events-none absolute inset-0 z-[3]">
          <MaskHandle kind="end" mask={mask} stage={stage} />
          <MaskHandle kind="start" mask={mask} stage={stage} />
        </div>
      )}
      <div id="handle" role="slider" tabIndex={0} hidden={hold} aria-label="Compare before and after"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(shown * 100)}
        style={{ left: `${shown * 100}%` }}
        className="absolute top-0 bottom-0 -ml-[22px] flex w-11 cursor-ew-resize touch-none justify-center"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); dragging.current = true; e.preventDefault(); }}
        onPointerMove={(e) => { if (dragging.current) moveHandle(e.clientX); }}
        onPointerUp={() => { dragging.current = false; }} onPointerCancel={() => { dragging.current = false; }}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.2 : 0.05;
          if (e.key === 'ArrowLeft') store.setSplit(split - step);
          else if (e.key === 'ArrowRight') store.setSplit(split + step);
          else if (e.key === 'Home') store.setSplit(0);
          else if (e.key === 'End') store.setSplit(1);
          else return;
          e.preventDefault();
        }}>
        <span className="relative w-0.5 bg-ink shadow-[0_0_0_1px_rgba(0,0,0,.5)]">
          <span className="absolute top-1/2 left-1/2 -mt-[13px] -ml-[13px] size-[26px] rounded-full border-2 border-bg bg-ink" />
        </span>
      </div>
      <span className="pointer-events-none absolute bottom-2 left-2 rounded-full bg-bg/80 px-2 py-0.5 text-xs">Before</span>
      <span className="pointer-events-none absolute right-2 bottom-2 rounded-full bg-bg/80 px-2 py-0.5 text-xs">After</span>
    </div>
  );
}

export function StageActions() {
  const { store, engine } = useEditor();
  const canUndo = useEditorState((s) => s.canUndo);
  const canRedo = useEditorState((s) => s.canRedo);
  const hold = useEditorState((s) => s.hold);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    await new Promise((r) => setTimeout(r, 30));     // let the button repaint before the heavy work starts
    try {
      const blob = await engine.exportJpeg();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'graded.jpg';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (e) {
      store.setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const act = 'whitespace-nowrap px-1 py-1.5 text-[0.82rem] min-[600px]:px-1.5 min-[600px]:text-[0.9rem] min-[900px]:py-2.5 max-[899px]:min-h-10';
  return (
    <div className="grid grid-cols-[auto_auto_1fr_auto_auto] gap-[5px] pt-2 min-[600px]:gap-2 min-[900px]:pt-2.5">
      <Button id="undo" className={act} disabled={!canUndo} aria-label="Undo (Ctrl or Cmd Z)" title="Undo (Ctrl or Cmd + Z)" onClick={() => store.undo()}>Undo</Button>
      <Button id="redo" className={act} disabled={!canRedo} aria-label="Redo (Shift Ctrl or Cmd Z)" title="Redo (Shift + Ctrl or Cmd + Z)" onClick={() => store.redo()}>Redo</Button>
      <Button id="hold" className={act} aria-pressed={hold} aria-label="Hold to see original"
        onPointerDown={(e) => { e.preventDefault(); store.setHold(true); }}
        onPointerUp={() => store.setHold(false)} onPointerLeave={() => store.setHold(false)} onPointerCancel={() => store.setHold(false)}
        onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); store.setHold(true); } }}
        onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') store.setHold(false); }}
        onContextMenu={(e) => e.preventDefault()}>
        <span className="hidden min-[600px]:inline">Hold to see original</span><span className="min-[600px]:hidden">Original</span>
      </Button>
      <Button id="reset" className={act} onClick={() => store.reset()}>Reset</Button>
      <Button id="export" primary className={act} disabled={saving} onClick={save}>{saving ? 'Saving...' : 'Save JPEG'}</Button>
    </div>
  );
}
