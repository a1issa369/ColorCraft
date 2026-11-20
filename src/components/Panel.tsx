import { useEffect, useRef } from 'react';
import { track } from '../analytics/track.ts';
import type { KeyboardEvent } from 'react';
import { TABS } from '../state/types.ts';
import type { TabId } from '../state/types.ts';
import { useEditor, useEditorState } from '../state/hooks.tsx';
import { describeSettings } from '../ui/recipe.ts';
import { AdjustPane } from './AdjustPane.tsx';
import { CurvesPane } from './CurvesPane.tsx';
import { LooksPane } from './LooksPane.tsx';
import { MasksPane } from './MasksPane.tsx';
import { MatchPane } from './MatchPane.tsx';
import { ReadPane } from './ReadPane.tsx';
import { Button, Hint, Pane } from './ui.tsx';

function Tabs() {
  const { store } = useEditor();
  const tab = useEditorState((s) => s.tab);
  const list = useRef<HTMLDivElement | null>(null);
  useEffect(() => { track('tab_viewed', { tab }); }, [tab]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = TABS.findIndex((t) => t.id === tab);
    const j = e.key === 'ArrowRight' ? (i + 1) % TABS.length : e.key === 'ArrowLeft' ? (i + TABS.length - 1) % TABS.length : -1;
    if (j < 0) return;
    e.preventDefault();
    store.setTab(TABS[j].id);
    list.current?.querySelectorAll<HTMLButtonElement>('button')[j]?.focus();
  };

  return (
    <div ref={list} role="tablist" onKeyDown={onKey} className="mt-1.5 mb-3.5 flex gap-1 overflow-x-auto border-b border-line">
      {TABS.map((t) => (
        <button key={t.id} role="tab" type="button" aria-selected={tab === t.id} onClick={() => store.setTab(t.id)}
          className="min-h-11 flex-[1_0_auto] cursor-pointer border-b-2 border-transparent px-[9px] py-3 text-muted aria-selected:border-sage aria-selected:text-ink max-[420px]:px-1.5 max-[420px]:text-[0.92rem] max-[380px]:px-1 max-[380px]:text-[0.88rem] min-[900px]:max-[1100px]:px-1 min-[900px]:max-[1100px]:text-[0.88rem]">
          {t.label}
        </button>
      ))}
    </div>
  );
}

function CopySettings() {
  const { store } = useEditor();
  const notice = useEditorState((s) => s.notice);
  const copy = async () => {
    const text = describeSettings(store.getState().settings);
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch { /* fall through and show the text instead */ }
    track('copy_settings', { copied: ok });
    store.setNotice(ok ? 'Copied. Paste these into Lightroom or Snapseed to repeat the grade.' : text);
  };
  return (
    <div className="mt-[18px] border-t border-line pt-3.5">
      <Button wide id="copy" onClick={copy}>Copy my settings</Button>
      <Hint role="status" className="whitespace-pre-line">{notice}</Hint>
    </div>
  );
}

export function Panel() {
  const tab = useEditorState((s) => s.tab);
  const is = (id: TabId) => tab === id;
  // Phones pin the photo to the top; bring the curve into the space under it.
  useEffect(() => {
    if (tab !== 'curves' || !window.matchMedia('(max-width: 899px)').matches) return;
    const stage = document.querySelector<HTMLElement>('#stage-col');
    if (stage) document.documentElement.style.setProperty('--sticky-h', `${stage.offsetHeight}px`);
    document.getElementById('curve-channels')?.scrollIntoView({ block: 'start' });
  }, [tab]);

  return (
    <div className="px-3 pt-2 pb-4 min-[900px]:max-w-[460px] min-[900px]:min-w-[340px] min-[900px]:flex-[1_1_38%] min-[900px]:pt-3 min-[900px]:pr-4 min-[900px]:pb-6 min-[900px]:pl-2">
      <Tabs />
      <Pane id="read" active={is('read')}><ReadPane /></Pane>
      <Pane id="adjust" active={is('adjust')}><AdjustPane /></Pane>
      <Pane id="masks" active={is('masks')}><MasksPane /></Pane>
      <Pane id="curves" active={is('curves')}><CurvesPane /></Pane>
      <Pane id="look" active={is('look')}><LooksPane /></Pane>
      <Pane id="match" active={is('match')}><MatchPane /></Pane>
      <CopySettings />
    </div>
  );
}
