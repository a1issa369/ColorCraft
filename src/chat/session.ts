// One chat turn: send the conversation and a numbers-only summary of the photo to the assistant, or, when the
// server is not set up or cannot be reached, fall back to the offline phrase list ("warmer", "lift the shadows").
import { steer } from '../state/steer.ts';
import type { EditorState, Settings } from '../state/types.ts';
import type { Action } from './actions.ts';
import { describeContext } from './context.ts';

export interface Turn { role: 'user' | 'assistant'; text: string }
export interface Reply {
  text: string;
  actions: Action[];
  source: 'assistant' | 'offline' | 'error';
  offline?: Settings;     // settings to apply when the offline phrase list handled it
}

export const MAX_INPUT = 400;
const TIMEOUT_MS = 25_000;

const OFFLINE_HELP = 'Try short phrases like "warmer", "moodier" or "lift the shadows".';

function offline(state: EditorState, text: string, why: string): Reply {
  const r = steer(state.settings, text);
  if (r.understood.length) return { text: `${why} I made the change anyway: ${r.changes.join(', ')}.`, actions: [], source: 'offline', offline: r.settings };
  return { text: `${why} ${OFFLINE_HELP}`, actions: [], source: 'error' };
}

export async function ask(o: { endpoint?: string; history: Turn[]; text: string; state: EditorState; fetchFn?: typeof fetch }): Promise<Reply> {
  const text = o.text.trim().slice(0, MAX_INPUT);
  if (!o.endpoint) return offline(o.state, text, 'The chat assistant is not connected.');
  const messages = [...o.history.slice(-10), { role: 'user' as const, text }];
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await (o.fetchFn ?? fetch)(`${o.endpoint.replace(/\/$/, '')}/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: ctl.signal,
      body: JSON.stringify({ messages, context: describeContext(o.state) }),
    });
    if (res.status === 429) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      return { text: j.error === 'daily limit' ? "You've used today's chat messages. The sliders still work, and chat resets tomorrow." : 'The assistant is busy right now. Try again in a bit.', actions: [], source: 'error' };
    }
    if (!res.ok) return offline(o.state, text, "I couldn't reach the assistant.");
    const j = (await res.json()) as { reply?: unknown; actions?: unknown };
    const actions = Array.isArray(j.actions) ? (j.actions as Action[]) : [];
    const reply = typeof j.reply === 'string' ? j.reply.trim() : '';
    return { text: reply || (actions.length ? 'Done.' : "I'm not sure what to change. Try describing the look you want."), actions, source: 'assistant' };
  } catch {
    return offline(o.state, text, "I couldn't reach the assistant.");
  } finally {
    clearTimeout(timer);
  }
}
