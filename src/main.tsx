import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { Engine } from './engine/engine.ts';
import { EditorStore } from './state/store.ts';
import './index.css';

// The store and engine live for the whole page, outside React, so a re-render can never rebuild them.
const store = new EditorStore();
const engine = new Engine(store);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App editor={{ store, engine }} />
  </StrictMode>,
);

// Handy for browser checks and the console.
(window as unknown as { __cc: unknown }).__cc = { store, engine };
