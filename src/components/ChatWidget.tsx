// The photo assistant: a chat bubble in the bottom right corner of every tab. Say what you want in your own
// words; it edits the photo with the same sliders and masks you can use yourself, explains, and can be undone.
import { useEffect, useRef, useState } from 'react';
import { analyticsEndpoint, track } from '../analytics/track.ts';
import { perform, commitSettings } from '../chat/perform.ts';
import { MAX_INPUT, ask } from '../chat/session.ts';
import type { Turn } from '../chat/session.ts';
import { useEditor, useEditorState } from '../state/hooks.tsx';

interface Msg { id: number; role: 'user' | 'assistant'; text: string; changes?: string[]; undoable?: boolean }

const GREETING = 'Hi! Tell me what you want to change in your photo, or ask what would make it better.';
const OPEN_KEY = 'cc-chat-open';
const readOpen = (): boolean => { try { return localStorage.getItem(OPEN_KEY) === '1'; } catch { return false; } };
const saveOpen = (v: boolean) => { try { localStorage.setItem(OPEN_KEY, v ? '1' : '0'); } catch { /* a convenience only */ } };

export function ChatWidget() {
  const { store, engine } = useEditor();
  const photoId = useEditorState((s) => s.photoId);
  const hasRef = useEditorState((s) => !!s.agent.ref);
  const [open, setOpen] = useState(readOpen);
  const [msgs, setMsgs] = useState<Msg[]>([{ id: 0, role: 'assistant', text: GREETING }]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const nextId = useRef(1);
  const log = useRef<HTMLDivElement | null>(null);
  const input = useRef<HTMLInputElement | null>(null);

  // A new photo starts a new conversation.
  useEffect(() => { setMsgs([{ id: 0, role: 'assistant', text: GREETING }]); nextId.current = 1; }, [photoId]);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [msgs, busy, open]);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  // Escape folds the chat away from anywhere on the page, including right after pressing a button inside it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); saveOpen(false); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const toggle = (v: boolean) => { setOpen(v); saveOpen(v); if (v) track('chat_opened'); };
  const push = (m: Omit<Msg, 'id'>) => setMsgs((list) => [...list.map((x) => ({ ...x, undoable: false })), { ...m, id: nextId.current++ }]);

  const send = async (raw: string) => {
    const t = raw.trim().slice(0, MAX_INPUT);
    if (!t || busy) return;
    const history: Turn[] = msgs.filter((m) => m.id !== 0).map((m) => ({ role: m.role, text: m.text }));
    setText(''); setBusy(true); push({ role: 'user', text: t });
    const reply = await ask({ endpoint: analyticsEndpoint, history, text: t, state: store.getState() });
    let changes: string[] = [], changed = false, extra = '';
    if (reply.offline) {
      commitSettings(store, reply.offline); changed = true;
    } else if (reply.actions.length) {
      const r = perform(store, engine, reply.actions);
      changes = r.changes; changed = r.changed; extra = r.extra;
    }
    track('chat_message', { source: reply.source, edited: changed, tools: [...new Set(reply.actions.map((a) => a.tool))].join(',') });
    push({ role: 'assistant', text: extra ? `${reply.text} ${extra}` : reply.text, changes, undoable: changed && !reply.actions.some((a) => a.tool === 'undo' || a.tool === 'match_reference') });
    setBusy(false);
  };

  const addReference = (file: File | undefined) => {
    if (!file) return;
    engine.makeReference(file).then((r) => { store.setAgentRef(r); track('reference_chosen'); push({ role: 'assistant', text: 'Got your reference photo. Say "match it" and I will copy its look.' }); })
      .catch((e: unknown) => push({ role: 'assistant', text: e instanceof Error ? e.message : 'I could not read that photo.' }));
  };

  const chips = msgs.length === 1 ? ['What would improve this photo?', 'Make it moodier', 'Brighten the sky', hasRef ? 'Match my reference' : 'Make it warmer'] : [];

  if (!open) {
    return (
      <button id="chat-toggle" type="button" onClick={() => toggle(true)} aria-expanded="false" aria-controls="chat"
        className="fixed right-4 bottom-4 z-30 inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-full border border-sage bg-sage px-4 font-semibold text-sage-ink shadow-lg hover:brightness-110">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></svg>
        Ask for help
      </button>
    );
  }

  return (
    <section id="chat" role="region" aria-label="Photo assistant"
      className="fixed right-3 bottom-3 z-30 flex max-h-[min(34rem,calc(100dvh-1.5rem))] w-[min(23rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl max-[599px]:max-h-[55dvh]">
      <header className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
        <b className="flex-1 font-semibold">Photo assistant</b>
        <button type="button" id="chat-close" aria-label="Collapse the assistant" onClick={() => toggle(false)}
          className="inline-flex size-9 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-muted hover:text-ink">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 12h12" /></svg>
        </button>
      </header>
      <div ref={log} aria-live="polite" className="flex-1 space-y-2.5 overflow-y-auto px-3.5 py-3 text-[0.92rem]">
        {msgs.map((m) => (
          <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div className={m.role === 'user' ? 'max-w-[85%] rounded-2xl rounded-br-md bg-raised px-3 py-2' : 'max-w-[92%]'}>
              <p className="m-0 whitespace-pre-wrap">{m.text}</p>
              {m.changes && m.changes.length > 0 && <p className="mt-1 mb-0 text-[0.78rem] text-muted">{m.changes.join(' · ')}</p>}
              {m.undoable && (
                <button type="button" className="mt-1 cursor-pointer border-0 bg-transparent p-0 text-[0.8rem] text-muted underline hover:text-ink"
                  onClick={() => { store.undo(); setMsgs((list) => list.map((x) => (x.id === m.id ? { ...x, undoable: false } : x))); }}>Undo this</button>
              )}
            </div>
          </div>
        ))}
        {busy && <p className="m-0 text-muted" role="status">Thinking…</p>}
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3.5 pb-2">
          {chips.map((c) => (
            <button key={c} type="button" onClick={() => void send(c)} disabled={busy}
              className="min-h-8 cursor-pointer rounded-full border border-line bg-transparent px-3 text-[0.82rem] text-ink hover:border-muted disabled:opacity-40">{c}</button>
          ))}
        </div>
      )}
      <form className="flex items-center gap-2 border-t border-line px-3 py-2.5" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
        <label htmlFor="chat-ref" title={hasRef ? 'Change reference photo' : 'Add a reference photo'} aria-label={hasRef ? 'Change reference photo' : 'Add a reference photo'}
          className="inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-line text-muted hover:text-ink">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="m21 16-5-5-8 9" /></svg>
        </label>
        <input id="chat-ref" type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; addReference(f); }} />
        <input ref={input} id="chat-input" value={text} onChange={(e) => setText(e.target.value)} maxLength={MAX_INPUT} autoComplete="off"
          aria-label="Message the photo assistant" placeholder="Make the sky deeper…"
          className="min-h-10 min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 text-ink placeholder:text-muted" />
        <button type="submit" disabled={busy || !text.trim()}
          className="min-h-10 cursor-pointer rounded-lg border border-sage bg-sage px-3.5 font-semibold text-sage-ink disabled:cursor-default disabled:opacity-40">Send</button>
      </form>
    </section>
  );
}
