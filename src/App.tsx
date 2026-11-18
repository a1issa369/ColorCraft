import { Editor } from './components/Editor.tsx';
import { EmptyState } from './components/EmptyState.tsx';
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

export function App({ editor }: { editor: EditorHandle }) {
  return (
    <EditorContext.Provider value={editor}>
      <Header />
      <Screen />
      <footer className="px-4 pt-[22px] pb-7 text-center text-[0.8rem] text-muted">Everything runs on your device. No uploads, no accounts.</footer>
    </EditorContext.Provider>
  );
}
