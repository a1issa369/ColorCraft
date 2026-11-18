import { useEffect, useRef } from 'react';
import { useEditor, useEditorState } from '../state/hooks.tsx';
import { drawHistogram, drawScope } from '../ui/draw.ts';
import { Button, cx } from './ui.tsx';
import type { Finding } from '../core/suggest.ts';
import type { Adjustments } from '../core/types.ts';

const isApplied = (f: Finding, adj: Adjustments): boolean =>
  !!f.fix && Object.entries(f.fix).every(([k, v]) => Math.abs(adj[k as keyof typeof f.fix & keyof Adjustments] as number - (v as number)) < 1e-6);

export function ReadPane() {
  const { store } = useEditor();
  const findings = useEditorState((s) => s.findings);
  const adj = useEditorState((s) => s.settings.adj);
  const stats = useEditorState((s) => s.stats);
  const fixable = findings.filter((f) => f.fix);
  const allDone = fixable.every((f) => isApplied(f, adj));
  const hist = useRef<HTMLCanvasElement | null>(null);
  const scope = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!stats) return;
    if (hist.current) drawHistogram(hist.current, stats);
    if (scope.current) drawScope(scope.current, stats);
  }, [stats]);

  return (
    <>
      <div className="mb-3.5 grid grid-cols-[1.6fr_1fr] gap-2.5">
        <figure className="m-0 rounded-[10px] border border-line bg-surface p-2">
          <canvas ref={hist} width={300} height={120} className="block h-auto w-full" />
          <figcaption className="mt-1.5 text-[0.8rem] text-muted">Brightness. Left is shadow, right is highlight.</figcaption>
        </figure>
        <figure className="m-0 rounded-[10px] border border-line bg-surface p-2">
          <canvas ref={scope} width={160} height={160} className="block h-auto w-full" />
          <figcaption className="mt-1.5 text-[0.8rem] text-muted">Colour. Distance from the centre is how strong.</figcaption>
        </figure>
      </div>
      {fixable.length > 1 && (
        <>
          <Button primary wide disabled={allDone}
            onClick={() => store.edit((d) => { for (const f of fixable) Object.assign(d.adj, f.fix); }, { commit: true })}>
            {allDone ? 'All suggestions applied' : `Apply all ${fixable.length} suggestions below`}
          </Button>
          <p className="mt-1.5 mb-0 text-[0.8rem] text-muted">
            Same as pressing every Apply this fix button below. It only moves the sliders those fixes name. Your curves, colour mix, looks and masks stay as they are, and Undo takes it back in one step.
          </p>
        </>
      )}
      <ul aria-label="Suggestions" className="mt-3.5 grid list-none gap-2.5 p-0">
        {findings.map((f) => {
          const done = isApplied(f, adj);
          const fix = f.fix;
          return (
            <li key={f.id} className={cx('rounded-[10px] border border-l-[3px] border-line bg-surface px-3.5 py-3', f.id === 'ok' ? 'border-l-sage' : 'border-l-warn')}>
              <h3 className="mb-1 font-serif text-[1.05rem] font-semibold">{f.title}</h3>
              <p className={cx('text-[0.92rem] text-muted', fix ? 'mb-2.5' : 'mb-0')}>{f.detail}</p>
              {fix && (
                <Button className="min-h-10 !px-3.5 !py-2 text-[0.9rem]" disabled={done}
                  onClick={() => store.edit((d) => { Object.assign(d.adj, fix); }, { commit: true })}>
                  {done ? 'Applied' : 'Apply this fix'}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
