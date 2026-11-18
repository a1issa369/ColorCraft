import { useEffect, useRef } from 'react';
import type { ComponentProps, ReactNode } from 'react';

export const cx = (...parts: (string | false | null | undefined)[]): string => parts.filter(Boolean).join(' ');

const BUTTON = 'inline-flex min-h-11 touch-manipulation items-center justify-center rounded-[10px] border border-line bg-raised px-4 py-[11px] text-center text-ink hover:border-muted disabled:cursor-default disabled:opacity-40 disabled:hover:border-line aria-pressed:bg-ink aria-pressed:text-bg';
const PRIMARY = '!border-sage !bg-sage font-semibold !text-sage-ink hover:brightness-110';

type ButtonProps = ComponentProps<'button'> & { primary?: boolean; wide?: boolean };

export function Button({ primary, wide, className, type = 'button', ...rest }: ButtonProps) {
  return <button type={type} className={cx(BUTTON, primary && PRIMARY, wide && 'w-full', className)} {...rest} />;
}

export function Hint({ children, className, ...rest }: ComponentProps<'p'>) {
  return <p className={cx('mt-1.5 text-[0.8rem] text-muted', className)} {...rest}>{children}</p>;
}

interface SliderProps {
  name: string;
  tip?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  display: string;
  onInput: (value: number) => void;
  /** Called when a gesture ends: the pointer lets go of the thumb, or a key press settles. */
  onCommit: () => void;
  /** Double click or double tap puts the slider back to its neutral value. */
  onReset?: () => void;
}

export function Slider({ name, tip, min, max, step, value, display, onInput, onCommit, onReset }: SliderProps) {
  const ref = useRef<HTMLInputElement | null>(null);
  const commit = useRef(onCommit);
  commit.current = onCommit;
  // React's onChange is the browser's input event. The browser's own change event is what marks the end of a gesture.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const done = () => commit.current();
    el.addEventListener('change', done);
    return () => el.removeEventListener('change', done);
  }, []);
  return (
    <label className="block pt-2 pb-3.5">
      <span className="flex items-baseline justify-between gap-2.5">
        <b className="font-semibold">{name}</b>
        <output className="text-[0.9rem] tabular-nums text-muted">{display}</output>
      </span>
      <input ref={ref} type="range" className="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onInput(Number(e.target.value))} onDoubleClick={onReset} />
      {tip && <small className="mt-0.5 block text-[0.8rem] text-muted">{tip}</small>}
    </label>
  );
}

export function Pane({ id, active, children }: { id: string; active: boolean; children: ReactNode }) {
  return <div id={`pane-${id}`} role="tabpanel" hidden={!active}>{children}</div>;
}

/** A segmented row of toggle buttons. */
export const SEG_BUTTON = 'min-h-10 cursor-pointer rounded-lg border border-line bg-surface text-muted aria-pressed:border-muted aria-pressed:bg-raised aria-pressed:text-ink';
