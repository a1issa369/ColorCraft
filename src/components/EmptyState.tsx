import { useEffect, useState } from 'react';
import type { DragEvent } from 'react';
import type { Featured } from '../core/featured.ts';
import { track } from '../analytics/track.ts';
import { useEditor, useEditorState } from '../state/hooks.tsx';
import { FeatureCards } from './FeatureCards.tsx';

export function EmptyState() {
  const { engine } = useEditor();
  const error = useEditorState((s) => s.error);
  const [over, setOver] = useState(false);

  // A photo dropped outside the drop box should not make the browser navigate away to it.
  useEffect(() => {
    const stop = (e: Event) => e.preventDefault();
    window.addEventListener('dragover', stop);
    window.addEventListener('drop', stop);
    return () => { window.removeEventListener('dragover', stop); window.removeEventListener('drop', stop); };
  }, []);

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); setOver(false);
    const f = e.dataTransfer.files[0];
    if (f) { track('photo_opened', { source: 'upload' }); void engine.openFile(f); }
  };
  const openSample = async (f: Featured) => {
    const blob = await (await fetch(`${import.meta.env.BASE_URL}${f.file}`)).blob();
    // Set the type ourselves: the decoder insists on an image type, and not every static host labels .jpg files.
    track('photo_opened', { source: 'sample' });
    void engine.openFile(new File([blob], f.file.split('/').pop() ?? 'photo.jpg', { type: 'image/jpeg' }));
  };

  return (
    <section id="empty" aria-labelledby="empty-h" className="mx-auto max-w-[640px] px-4 py-7">
      <div id="drop" onDragEnter={(e) => { e.preventDefault(); setOver(true); }} onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)} onDrop={onDrop}
        className={`rounded-[14px] border-[1.5px] border-dashed px-5 py-9 text-center transition-colors ${over ? 'border-sage bg-raised' : 'border-line bg-surface'}`}>
        <h2 id="empty-h" className="mb-2 font-serif text-[1.6rem] font-semibold">Start with a photo</h2>
        <p className="mx-auto mb-5 max-w-[34ch] text-muted">Drop one here, or pick one from your device. It never leaves your browser.</p>
        <label htmlFor="file" className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-[10px] border border-sage bg-sage px-4 py-[11px] font-semibold text-sage-ink hover:brightness-110">Choose a photo</label>
        <input id="file" type="file" accept="image/*" className="sr-only"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { track('photo_opened', { source: 'upload' }); void engine.openFile(f); } }} />
        {error && <p id="err" role="alert" className="mt-3 text-[0.8rem] text-warn">{error}</p>}
      </div>
      <FeatureCards onPick={(f) => void openSample(f)} />
    </section>
  );
}
