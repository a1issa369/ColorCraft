import { createContext, useContext, useSyncExternalStore } from 'react';
import type { Engine } from '../engine/engine.ts';
import type { EditorStore } from './store.ts';
import type { EditorState } from './types.ts';

export interface Editor { store: EditorStore; engine: Engine }

export const EditorContext = createContext<Editor | null>(null);

export function useEditor(): Editor {
  const e = useContext(EditorContext);
  if (!e) throw new Error('useEditor must be used inside <EditorContext.Provider>');
  return e;
}

/** Read a slice of the editor state. The selector must return a stable value (a primitive or a piece of the state itself). */
export function useEditorState<T>(selector: (s: EditorState) => T): T {
  const { store } = useEditor();
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}
