import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, RefObject } from 'react';
import { track } from '../analytics/track.ts';
import { MAX_BRUSH_POINTS } from '../core/mask.ts';
import type { Mask } from '../core/mask.ts';
import { useEditor, useEditorState } from '../state/hooks.tsx';
import { Button } from './ui.tsx';

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** One draggable dot on the photo. Pointer drag and arrow keys both move it. `at` is where it sits, `onMove` gets the wanted position (fractions). */
function Dot({ id, label, at, filled, onMove, stage }: {
  id: string; label: string; at: [number, number]; filled: boolean; onMove: (x: number, y: number) => void; stage: RefObject<HTMLDivElement | null>;
}) {
  const { store } = useEditor();
  const dragging = useRef(false);
  const [x, y] = at;
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const r = stage.current?.getBoundingClientRect();
    if (!dragging.current || !r) return;
    onMove((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.05 : 0.01;
    const dx = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
    const dy = e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0;
    if (!dx && !dy) return;
    e.preventDefault();
    onMove(x + dx, y + dy);
  };
  const end = () => { if (dragging.current) { dragging.current = false; store.commit(); } };
  const pct = (v: number) => Math.round(v * 100);
  return (
    <div role="slider" tabIndex={0} id={id} aria-label={label}
      aria-valuetext={`${pct(x)}% across, ${pct(y)}% down`} aria-valuenow={pct(x)}
      // Keep the dots just inside the photo so one sitting on an edge can still be grabbed (the stage clips what sticks out).
      style={{ left: `clamp(20px, ${x * 100}%, calc(100% - 20px))`, top: `clamp(20px, ${y * 100}%, calc(100% - 20px))` }}
      className="pointer-events-auto absolute -mt-[22px] -ml-[22px] grid size-11 cursor-grab touch-none place-items-center rounded-full active:cursor-grabbing"
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); dragging.current = true; e.preventDefault(); }}
      onPointerMove={move} onPointerUp={end} onPointerCancel={end}
      onKeyDown={onKey} onKeyUp={(e) => { if (e.key.startsWith('Arrow')) store.commit(); }}>
      <span className={filled
        ? 'size-[22px] rounded-full border-2 border-bg bg-sage shadow-[0_0_0_2px_var(--color-sage-ink)]'
        : 'size-[22px] rounded-full border-2 border-ink bg-bg/35 shadow-[0_0_0_1px_rgba(0,0,0,.6)]'} />
    </div>
  );
}

/** The dots for a gradient (start and end) or an oval (centre, right edge, bottom edge). */
function MaskHandles({ mask, stage }: { mask: Mask; stage: RefObject<HTMLDivElement | null> }) {
  const { store } = useEditor();
  const edit = (fn: (m: Mask) => void) => store.edit((d) => { const m = d.masks.find((q) => q.id === mask.id); if (m) fn(m); });
  if (mask.kind === 'radial') {
    // Everything here is worked out in screen pixels so a tilted oval's dots sit on its real axes.
    const size = () => { const r = stage.current?.getBoundingClientRect(); return { W: r?.width || 1, H: r?.height || 1 }; };
    const { W, H } = size();
    const ca = Math.cos(mask.angle), sa = Math.sin(mask.angle);
    const cx = mask.x1 * W, cy = mask.y1 * H;
    const rxPx = mask.rx * W, ryPx = mask.ry * H;
    const frac = (px: number, py: number): [number, number] => [px / W, py / H];
    const toLocal = (x: number, y: number) => { const { W: w, H: h } = size(); const dx = x * w - mask.x1 * w, dy = y * h - mask.y1 * h; return { u: dx * ca + dy * sa, v: -dx * sa + dy * ca, w, h }; };
    return (
      <>
        <Dot id="mh-rotate" label="Rotate the oval. Drag around the centre, or use the arrow keys." stage={stage} filled={false}
          at={frac(cx + sa * (ryPx + 34), cy - ca * (ryPx + 34))}
          onMove={(x, y) => edit((m) => {
            const { w, h } = toLocal(x, y);
            let a = Math.atan2(y * h - m.y1 * h, x * w - m.x1 * w) + Math.PI / 2;
            a = ((a + Math.PI / 2) % Math.PI + Math.PI) % Math.PI - Math.PI / 2;   // an oval looks the same turned half a circle
            m.angle = a;
          })} />
        <Dot id="mh-rx" label="Oval width. Drag, or use the arrow keys." stage={stage} filled={false}
          at={frac(cx + ca * rxPx, cy + sa * rxPx)}
          onMove={(x, y) => edit((m) => { const { u, w } = toLocal(x, y); m.rx = Math.min(1, Math.max(0.02, u / w)); })} />
        <Dot id="mh-ry" label="Oval height. Drag, or use the arrow keys." stage={stage} filled={false}
          at={frac(cx - sa * ryPx, cy + ca * ryPx)}
          onMove={(x, y) => edit((m) => { const { v, h } = toLocal(x, y); m.ry = Math.min(1, Math.max(0.02, v / h)); })} />
        <Dot id="mh-centre" label="Oval centre. Drag, or use the arrow keys." stage={stage} filled
          at={[mask.x1, mask.y1]} onMove={(x, y) => edit((m) => { m.x1 = clamp01(x); m.y1 = clamp01(y); })} />
      </>
    );
  }
  return (
    <>
      <Dot id="mh-end" label="Where the mask fades out completely. Drag, or use the arrow keys." stage={stage} filled={false}
        at={[mask.x2, mask.y2]} onMove={(x, y) => edit((m) => { m.x2 = clamp01(x); m.y2 = clamp01(y); })} />
      <Dot id="mh-start" label="Where the mask is strongest. Drag, or use the arrow keys." stage={stage} filled
        at={[mask.x1, mask.y1]} onMove={(x, y) => edit((m) => { m.x1 = clamp01(x); m.y1 = clamp01(y); })} />
    </>
  );
}

/** Covers the photo while a brush mask is selected. Dragging paints a stroke; the stroke is one undo step. */
function BrushLayer({ mask, stage }: { mask: Mask; stage: RefObject<HTMLDivElement | null> }) {
  const { store } = useEditor();
  const brush = useEditorState((s) => s.brush);
  const painting = useRef(false);
  const [hover, setHover] = useState<[number, number] | null>(null);
  const at = (e: PointerEvent<HTMLDivElement>): [number, number] | null => {
    const r = stage.current?.getBoundingClientRect();
    return r ? [clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height)] : null;
  };
  const edit = (fn: (m: Mask) => void) => store.edit((d) => { const m = d.masks.find((q) => q.id === mask.id); if (m) fn(m); });
  const used = (m: Mask) => m.strokes.reduce((n, t) => n + t.pts.length / 2, 0);
  const down = (e: PointerEvent<HTMLDivElement>) => {
    const p = at(e);
    if (!p || used(mask) >= MAX_BRUSH_POINTS) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    painting.current = true;
    edit((m) => { m.strokes.push({ pts: [p[0], p[1]], size: brush.size, soft: brush.soft, erase: brush.erase }); });
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const p = at(e);
    setHover(p);
    if (!painting.current || !p) return;
    edit((m) => {
      const t = m.strokes[m.strokes.length - 1];
      if (!t || used(m) >= MAX_BRUSH_POINTS) return;
      const r = stage.current?.getBoundingClientRect();
      const aspect = r ? r.height / r.width : 1;
      const lx = t.pts[t.pts.length - 2], ly = t.pts[t.pts.length - 1];
      // Add a point only after the brush has moved a little, so a slow drag does not pile up points.
      if (Math.hypot(p[0] - lx, (p[1] - ly) * aspect) > t.size * 0.15) t.pts.push(p[0], p[1]);
    });
  };
  const up = () => { if (painting.current) { painting.current = false; store.commit(); } };
  const full = used(mask) >= MAX_BRUSH_POINTS;
  return (
    <div id="brush-ui" role="application" aria-label="Paint on the photo. Drag to paint the mask."
      className={`absolute inset-0 z-[3] touch-none ${full ? 'cursor-not-allowed' : 'cursor-crosshair'}`}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={() => setHover(null)}>
      {hover && (
        <span aria-hidden="true"
          className={`pointer-events-none absolute -translate-1/2 rounded-full border ${brush.erase ? 'border-warn' : 'border-ink'} shadow-[0_0_0_1px_rgba(0,0,0,.6)]`}
          style={{ left: `${hover[0] * 100}%`, top: `${hover[1] * 100}%`, width: `${brush.size * 200}%`, aspectRatio: '1' }} />
      )}
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
      {mask && (mask.kind === 'linear' || mask.kind === 'radial') && (
        <div id="mask-ui" className="pointer-events-none absolute inset-0 z-[3]">
          <MaskHandles mask={mask} stage={stage} />
        </div>
      )}
      {mask && mask.kind === 'brush' && <BrushLayer mask={mask} stage={stage} />}
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
      track('export_jpeg');
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
