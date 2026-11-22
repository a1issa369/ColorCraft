import { useEffect } from 'react';
import { useEditor } from '../state/hooks.tsx';
import { ChatWidget } from './ChatWidget.tsx';
import { Panel } from './Panel.tsx';
import { Stage, StageActions } from './Stage.tsx';

export function Editor() {
  const { store } = useEditor();

  // Ctrl or Cmd + Z to undo, with Shift (or Y) to redo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); store.undo(); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); store.redo(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [store]);

  return (
    <section id="editor" className="flex flex-col min-[900px]:mx-auto min-[900px]:max-w-[1280px] min-[900px]:flex-row min-[900px]:items-start min-[900px]:gap-2">
      <div id="stage-col" className="sticky top-0 z-[5] border-b border-line bg-bg px-3 pt-3 pb-1.5 min-[900px]:z-auto min-[900px]:flex-[1_1_62%] min-[900px]:border-b-0 min-[900px]:p-4 min-[900px]:pr-2">
        <Stage />
        <StageActions />
      </div>
      <Panel />
      <ChatWidget />
    </section>
  );
}
