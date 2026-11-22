// Our own, small analytics: anonymous counts about how the editor is used. No photos, no typed text, no IP address is ever
// recorded by this code. Events are kept on this device (so the stats page works with no server at all) and, when
// VITE_ANALYTICS_URL points at the Worker in /analytics-worker, sent there in batches. A person can turn it off in the
// footer; off means nothing is recorded or sent, not even locally.

export type EventName =
  | 'session_start' | 'photo_opened' | 'tab_viewed' | 'reference_chosen' | 'agent_run' | 'agent_step_jump'
  | 'steer_used' | 'dial_changed' | 'mask_added' | 'export_jpeg' | 'copy_settings' | 'live_match_used'
  | 'chat_opened' | 'chat_message';

export type Props = Record<string, string | number | boolean>;
export interface AnalyticsEvent { n: EventName; t: number; v: string; s: string; p?: Props }

export const EVENT_NAMES: readonly EventName[] = [
  'session_start', 'photo_opened', 'tab_viewed', 'reference_chosen', 'agent_run', 'agent_step_jump',
  'steer_used', 'dial_changed', 'mask_added', 'export_jpeg', 'copy_settings', 'live_match_used',
  'chat_opened', 'chat_message',
];

const KEY_OFF = 'cc-analytics-off';
const KEY_EVENTS = 'cc-events';
const KEY_VISITOR = 'cc-visitor';
const KEY_SESSION = 'cc-session';
const LOCAL_LIMIT = 500;
const BATCH = 20;
const MAX_PROP_LEN = 40;
const MAX_PROPS = 8;

interface Store { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

/** Storage can be missing or throw (private windows, blocked cookies); analytics must never break the editor. */
const safe = (which: 'local' | 'session'): Store | null => {
  try { const s = which === 'local' ? globalThis.localStorage : globalThis.sessionStorage; return s ?? null; } catch { return null; }
};

const randomId = (): string => {
  const c = globalThis.crypto;
  if (c?.getRandomValues) { const a = new Uint8Array(8); c.getRandomValues(a); return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(''); }
  return Math.random().toString(16).slice(2, 18).padEnd(16, '0');
};

/** Only short strings, finite numbers and booleans, at most a few of them. Anything else is dropped, never trimmed into something odd. */
export function cleanProps(p?: Record<string, unknown>): Props | undefined {
  if (!p) return undefined;
  const out: Props = {};
  let n = 0;
  for (const [k, v] of Object.entries(p)) {
    if (n >= MAX_PROPS) break;
    if (!/^[a-z][a-z0-9_]{0,23}$/.test(k)) continue;
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.round(v * 100) / 100;
    else if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string' && v.length <= MAX_PROP_LEN && /^[\w .,:+\-()/]*$/.test(v)) out[k] = v;
    else continue;
    n++;
  }
  return Object.keys(out).length ? out : undefined;
}

export class Analytics {
  private queue: AnalyticsEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly endpoint: string | undefined;
  private readonly send: (url: string, body: string) => boolean;
  private readonly now: () => number;
  constructor(endpoint: string | undefined, send: (url: string, body: string) => boolean = defaultSend, now: () => number = () => Date.now()) {
    this.endpoint = endpoint; this.send = send; this.now = now;
  }

  get enabled(): boolean { const s = safe('local'); try { return s?.getItem(KEY_OFF) !== '1'; } catch { return true; } }

  /** Turn it off (and forget what was stored here) or back on. */
  setEnabled(on: boolean): void {
    const s = safe('local');
    try {
      if (on) s?.removeItem(KEY_OFF);
      else { s?.setItem(KEY_OFF, '1'); s?.removeItem(KEY_EVENTS); s?.removeItem(KEY_VISITOR); }
    } catch { /* nothing to do */ }
    if (!on) this.queue = [];
  }

  private id(kind: 'local' | 'session'): string {
    const s = safe(kind), key = kind === 'local' ? KEY_VISITOR : KEY_SESSION;
    try { const have = s?.getItem(key); if (have) return have; const fresh = randomId(); s?.setItem(key, fresh); return fresh; } catch { return 'unknown'; }
  }

  track(n: EventName, props?: Record<string, unknown>): void {
    if (!this.enabled) return;
    const ev: AnalyticsEvent = { n, t: this.now(), v: this.id('local'), s: this.id('session') };
    const p = cleanProps(props);
    if (p) ev.p = p;
    const s = safe('local');
    try {
      const all = [...this.local(), ev].slice(-LOCAL_LIMIT);
      s?.setItem(KEY_EVENTS, JSON.stringify(all));
    } catch { /* storage full or blocked */ }
    if (this.endpoint) {
      this.queue.push(ev);
      if (this.queue.length >= BATCH) this.flush();
      else if (!this.timer) this.timer = setTimeout(() => this.flush(), 4000);
    }
  }

  /** Events recorded on this device, oldest first. */
  local(): AnalyticsEvent[] {
    try { const raw = safe('local')?.getItem(KEY_EVENTS); const v = raw ? JSON.parse(raw) : []; return Array.isArray(v) ? v : []; } catch { return []; }
  }

  flush(): void {
    clearTimeout(this.timer); this.timer = undefined;
    if (!this.endpoint || !this.queue.length || !this.enabled) { this.queue = []; return; }
    const batch = this.queue.splice(0, 50);
    if (!this.send(`${this.endpoint.replace(/\/$/, '')}/e`, JSON.stringify({ events: batch }))) this.queue.unshift(...batch.slice(0, 20));
    if (this.queue.length) this.timer = setTimeout(() => this.flush(), 1000);
  }
}

function defaultSend(url: string, body: string): boolean {
  try {
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) return navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }));
    void fetch(url, { method: 'POST', body, keepalive: true, headers: { 'content-type': 'text/plain' } }).catch(() => undefined);
    return true;
  } catch { return false; }
}

// ---- a shared instance for the app ----
const endpoint = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_ANALYTICS_URL;
export const analytics = new Analytics(endpoint);
export const track = (n: EventName, props?: Record<string, unknown>): void => analytics.track(n, props);
export const analyticsEndpoint = endpoint;

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => analytics.flush());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') analytics.flush(); });
}
