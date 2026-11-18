import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { FEATURED, gradeEdit } from '../core/featured.ts';
import type { Featured } from '../core/featured.ts';
import { paint } from '../engine/media.ts';

const SIZE = 440;   // card canvases are square; 2x covers a retina card
const url = (file: string) => `${import.meta.env.BASE_URL}${file}`;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${src}`));
    img.src = src;
  });
}

/** Square crop of the photo, centred on `focus` (0..1 on each axis), drawn at SIZE x SIZE. */
function coverCanvas(img: HTMLImageElement, focus: Featured['focus'], into: HTMLCanvasElement): void {
  into.width = into.height = SIZE;
  const s = Math.max(SIZE / img.naturalWidth, SIZE / img.naturalHeight);
  const w = img.naturalWidth * s, h = img.naturalHeight * s;
  into.getContext('2d')!.drawImage(img, -(w - SIZE) * focus.x, -(h - SIZE) * focus.y, w, h);
}

type Status = 'loading' | 'ready' | 'failed';

function FeatureCard({ f, index, onPick, onStatus }: { f: Featured; index: number; onPick: (f: Featured) => void; onStatus: (id: string, s: Status) => void }) {
  const before = useRef<HTMLCanvasElement | null>(null);
  const after = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<Status>('loading');

  useEffect(() => {
    let live = true;
    loadImage(url(f.file)).then((img) => {
      if (!live || !before.current || !after.current) return;
      coverCanvas(img, f.focus, before.current);
      const px = before.current.getContext('2d')!.getImageData(0, 0, SIZE, SIZE);
      // The "after" is made by the same engine the editor uses, from the edit listed with the photo, so it is never a faked picture.
      paint(after.current, gradeEdit({ width: SIZE, height: SIZE, data: px.data }, f.edit));
      setStatus('ready'); onStatus(f.id, 'ready');
    }).catch(() => { if (live) { setStatus('failed'); onStatus(f.id, 'failed'); } });
    return () => { live = false; };
  }, [f, onStatus]);

  if (status === 'failed') return null;   // a photo that fails to load is simply left out
  return (
    <button type="button" aria-label={`Open the ${f.name.toLowerCase()} photo in the editor`} onClick={() => onPick(f)}
      style={{ '--d': `${index * 0.9}s` } as CSSProperties}
      className="feature flex cursor-pointer flex-col overflow-hidden rounded-[10px] border border-line bg-surface p-0 pb-2.5 text-left text-ink hover:border-muted">
      <span className="relative block aspect-square w-full overflow-hidden bg-black">
        <canvas ref={before} aria-hidden="true" className="absolute inset-0 block size-full" />
        <span className="after-wrap absolute inset-0 [clip-path:inset(0_0_0_100%)] animate-[reveal_7s_cubic-bezier(.6,0,.35,1)_infinite] [animation-delay:var(--d)] motion-reduce:animate-none motion-reduce:[clip-path:inset(0_0_0_50%)]">
          <canvas ref={after} aria-hidden="true" className="absolute inset-0 block size-full" />
        </span>
        <span className="wipe absolute top-0 bottom-0 left-[calc(100%-2px)] w-0.5 animate-[wipe_7s_cubic-bezier(.6,0,.35,1)_infinite] bg-ink opacity-0 shadow-[0_0_0_1px_rgba(0,0,0,.45)] [animation-delay:var(--d)] motion-reduce:left-1/2 motion-reduce:animate-none motion-reduce:opacity-100" />
        <span className="absolute bottom-2 left-2 rounded-full bg-bg/70 px-2 py-0.5 text-[0.72rem]">Before</span>
        <span className="absolute right-2 bottom-2 rounded-full bg-bg/70 px-2 py-0.5 text-[0.72rem]">After</span>
      </span>
      <b className="block px-3 pt-2.5 pb-0.5 text-[0.95rem] font-semibold">{f.name}</b>
      <small className="block px-3 text-[0.8rem] leading-snug text-muted">{f.note}</small>
    </button>
  );
}

/** The home page photos. Each card loops a before and after wipe; clicking one opens it in the editor. */
export function FeatureCards({ onPick }: { onPick: (f: Featured) => void }) {
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const onStatus = useRef((id: string, s: Status) => {
    if (s === 'failed') setFailed((prev) => new Set(prev).add(id));
  }).current;
  if (failed.size === FEATURED.length) return null;
  return (
    <div className="mt-7">
      <h3 className="mb-3 font-serif text-[1.05rem] font-semibold">No photo handy? Try one of these</h3>
      <p className="-mt-1.5 mb-3 text-[0.88rem] text-muted">Each one loops a before and after. Open one to make your own edit.</p>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
        {FEATURED.map((f, i) => <FeatureCard key={f.id} f={f} index={i} onPick={onPick} onStatus={onStatus} />)}
      </div>
    </div>
  );
}
