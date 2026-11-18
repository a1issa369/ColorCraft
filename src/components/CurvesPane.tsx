import { useEffect, useRef, useState } from 'react';
import { identityCurves } from '../core/curves.ts';
import type { Channel } from '../core/types.ts';
import { useEditor, useEditorState } from '../state/hooks.tsx';
import { CurveEditor } from '../ui/curveEditor.ts';
import { Button, Hint, SEG_BUTTON, cx } from './ui.tsx';

const CHANNELS: { id: Channel; label: string; on: string }[] = [
  { id: 'rgb', label: 'RGB', on: 'aria-pressed:shadow-[inset_0_-3px_0_#ebe6da]' },
  { id: 'r', label: 'Red', on: 'aria-pressed:border-[#d96b62] aria-pressed:shadow-[inset_0_-3px_0_#d96b62]' },
  { id: 'g', label: 'Green', on: 'aria-pressed:border-[#6fbf82] aria-pressed:shadow-[inset_0_-3px_0_#6fbf82]' },
  { id: 'b', label: 'Blue', on: 'aria-pressed:border-[#6c9bdb] aria-pressed:shadow-[inset_0_-3px_0_#6c9bdb]' },
];

export function CurvesPane() {
  const { store } = useEditor();
  const curves = useEditorState((s) => s.settings.adj.curves);
  const stats = useEditorState((s) => s.stats);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const editor = useRef<CurveEditor | null>(null);
  const [channel, setChannel] = useState<Channel>('rgb');

  useEffect(() => {
    if (!canvas.current) return;
    const blank = identityCurves();
    const ed = new CurveEditor(canvas.current, {
      read: () => store.getState().settings.adj.curves ?? blank,
      write: () => {
        if (!store.getState().settings.adj.curves) store.edit((d) => { d.adj.curves = identityCurves(); });
        return store.getState().settings.adj.curves!;
      },
      onChange: () => store.edit(() => { /* the editor already changed the curves in place; this publishes them */ }),
      onCommit: () => store.commit(),
    });
    editor.current = ed;
    ed.draw();
    return () => { ed.dispose(); editor.current = null; };
  }, [store]);

  // Redraw when something else changes the curves (undo, reset, baking a reference match) or the histogram updates.
  useEffect(() => { editor.current?.draw(); }, [curves]);
  useEffect(() => { editor.current?.setHistogram(stats ? stats.hist : null); }, [stats]);

  return (
    <>
      <Hint>Drag the line to bend it. Tap the line to add a point, double tap a point to remove it. Up makes that tone brighter.</Hint>
      <div className="my-2.5 grid grid-cols-4 gap-1" role="group" aria-label="Curve channel">
        {CHANNELS.map((c) => (
          <button key={c.id} type="button" aria-pressed={channel === c.id} className={cx(SEG_BUTTON, c.on)}
            onClick={() => { setChannel(c.id); editor.current?.setChannel(c.id); }}>{c.label}</button>
        ))}
      </div>
      <div className="rounded-[10px] border border-line bg-surface p-2">
        <canvas id="curve" ref={canvas} width={520} height={520} tabIndex={0} role="application"
          aria-label="Tone curve editor. Arrow keys move the selected point, Tab or brackets pick another point, Delete removes it."
          className="mx-auto block aspect-square h-auto w-full max-w-[330px] cursor-crosshair touch-none min-[900px]:max-w-[460px]" />
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-2">
        <Button className="min-h-10 text-[0.9rem]" onClick={() => editor.current?.resetChannel()}>Reset this line</Button>
        <Button className="min-h-10 text-[0.9rem]" onClick={() => editor.current?.resetAll()}>Reset all lines</Button>
      </div>
    </>
  );
}
