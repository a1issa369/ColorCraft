import { useEffect, useState, useSyncExternalStore } from 'react';
import { analytics, track } from './analytics/track.ts';
import { Editor } from './components/Editor.tsx';
import { EmptyState } from './components/EmptyState.tsx';
import { StatsPage } from './components/StatsPage.tsx';
import { Button, cx } from './components/ui.tsx';
import { EditorContext, useEditor, useEditorState } from './state/hooks.tsx';
import type { Editor as EditorHandle } from './state/hooks.tsx';

function Header() {
  const { store, engine } = useEditor();
  const hasPhoto = useEditorState((s) => s.hasPhoto);
  return (
    <header className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1 border-b border-line px-4 pt-3.5 pb-2.5 max-[599px]:flex-nowrap max-[599px]:items-center">
      <h1 className={cx('font-serif text-[1.35rem] font-semibold tracking-[0.01em]', hasPhoto && 'max-[599px]:flex-1')}>ColorCraft</h1>
      <p className={cx('m-0 flex-[1_1_200px] text-[0.9rem] text-muted', hasPhoto && 'max-[599px]:hidden')}>Learn colour grading by fixing real photos.</p>
      {hasPhoto && (
        <Button id="new-photo" className="ml-auto !min-h-9 !bg-transparent !px-3 !py-1.5"
          onClick={() => { engine.unload(); store.closePhoto(); }}>New photo</Button>
      )}
    </header>
  );
}

function Screen() {
  const hasPhoto = useEditorState((s) => s.hasPhoto);
  return <main id="app">{hasPhoto ? <Editor /> : <EmptyState />}</main>;
}

const onStatsRoute = () => window.location.hash === '#stats';
const watchHash = (cb: () => void) => { window.addEventListener('hashchange', cb); return () => window.removeEventListener('hashchange', cb); };

function Footer() {
  const [on, setOn] = useState(analytics.enabled);
  return (
    <footer className="px-4 pt-[22px] pb-7 text-center text-[0.8rem] text-muted">
      <p className="m-0">Your photos stay on your device. No uploads, no accounts.</p>
      <p className="mx-auto mt-1.5 max-w-[46ch]">
        {on ? 'We count anonymous actions, like which tab opened, never your photos. ' : 'Usage counting is off. '}
        <button type="button" id="analytics-toggle" className="cursor-pointer border-0 bg-transparent p-0 text-muted underline"
          onClick={() => { analytics.setEnabled(!on); setOn(!on); }}>{on ? 'Turn off' : 'Turn on'}</button>
        {' · '}<a href="#stats" className="text-muted underline">See the numbers</a>
      </p>
    </footer>
  );
}

export function App({ editor }: { editor: EditorHandle }) {
  const stats = useSyncExternalStore(watchHash, onStatsRoute);
  useEffect(() => { track('session_start'); }, []);
  return (
    <EditorContext.Provider value={editor}>
      <Header />
      {stats ? <StatsPage /> : <Screen />}
      <Footer />
    </EditorContext.Provider>
  );
}
