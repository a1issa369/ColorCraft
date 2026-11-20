// Steer the match in plain English: "warmer", "moodier but keep the colour", "less contrast, lift the shadows".
// This is a fixed vocabulary of phrases, each of which moves named controls by a set amount. It is not a language model,
// and the panel says so. Every phrase it understands is listed in STEER_EXAMPLES so a person can see what to type.
import { RANGES } from '../core/adjust.ts';
import type { SliderKey } from '../core/types.ts';
import { describeChanges } from './agent.ts';
import { cloneSettings } from './store.ts';
import type { Settings } from './types.ts';

type Effect = (s: Settings, k: number) => void;

const nudge = (key: SliderKey, amount: number): Effect => (s, k) => {
  const [lo, hi] = RANGES[key];
  const step = key === 'exposure' || key === 'fade' ? 0.01 : 1;
  const v = s.adj[key] + amount * k;
  s.adj[key] = Math.round(Math.min(hi, Math.max(lo, v)) / step) * step;
};
const both = (...fx: Effect[]): Effect => (s, k) => { for (const f of fx) f(s, k); };
const tint = (which: 'splitShadow' | 'splitHighlight', hue: number, amount: number): Effect => (s, k) => {
  const cur = s.adj[which];
  s.adj[which] = { hue, amount: Math.round(Math.min(1, Math.max(0, (cur.hue === hue || cur.amount === 0 ? cur.amount : 0) + amount * k)) * 100) / 100 };
};

interface Phrase { id: string; pattern: RegExp; effect: Effect }

/** Most specific phrases first: a matched phrase is cut out of the text, so "less contrast" is never also read as "contrast". */
const PHRASES: Phrase[] = [
  { id: 'teal shadows', pattern: /\b(teal|cyan|aqua) shadows?\b/, effect: tint('splitShadow', 185, 0.15) },
  { id: 'blue shadows', pattern: /\bblue shadows?\b/, effect: tint('splitShadow', 225, 0.15) },
  { id: 'warm highlights', pattern: /\b(warm|orange|golden|amber) highlights?\b/, effect: tint('splitHighlight', 35, 0.15) },
  { id: 'pink highlights', pattern: /\b(pink|magenta) highlights?\b/, effect: tint('splitHighlight', 325, 0.15) },
  { id: 'lift the shadows', pattern: /\b(lift|open( up)?|brighten|lighten|raise) (the )?shadows?\b|\b(brighter|lighter) shadows?\b/, effect: nudge('shadows', 12) },
  { id: 'deeper shadows', pattern: /\b(deeper|darker|crush(ed)?|heavier) (the )?(shadows?|blacks?)\b|\b(deepen|darken) (the )?shadows?\b/, effect: nudge('shadows', -12) },
  { id: 'tame the highlights', pattern: /\b(tame|calm|protect|recover|reduce|lower|less|darker|soften) (the )?highlights?\b/, effect: nudge('highlights', -12) },
  { id: 'brighter highlights', pattern: /\b(brighter|more|boost|stronger) highlights?\b/, effect: nudge('highlights', 12) },
  { id: 'less contrast', pattern: /\b(less|lower|reduce|gentler|softer|flatter) contrast\b|\bsoft(er)?\b|\bflat(ter)?\b|\bgentle\b/, effect: nudge('contrast', -10) },
  { id: 'more contrast', pattern: /\b(more|higher|extra|add|boost|stronger) contrast\b|\bpunch(y|ier)\b|\bcrisp(er)?\b/, effect: nudge('contrast', 10) },
  { id: 'less colour', pattern: /\b(less|lower|reduce|weaker) (colou?r|saturation)\b|\bmuted\b|\bdesaturate(d)?\b|\bsubtle\b|\bcalmer colou?rs?\b/, effect: nudge('saturation', -10) },
  { id: 'more colour', pattern: /\b(more|higher|extra|boost|stronger) (colou?r|saturation)\b|\bvivid\b|\bvibrant\b|\brich(er)?\b|\bpop\b|\bsaturated\b/, effect: nudge('saturation', 10) },
  { id: 'moodier', pattern: /\bmood(y|ier)\b|\bdramatic\b|\bbrooding\b/, effect: both(nudge('exposure', -0.25), nudge('contrast', 10), nudge('saturation', -8), nudge('shadows', -8)) },
  { id: 'faded', pattern: /\bfad(e|ed)\b|\bmatte\b|\blifted blacks?\b|\bfilm(ic|y)?\b/, effect: nudge('fade', 0.12) },
  { id: 'cooler', pattern: /\b(cool(er)?|cold(er)?|blue(r)?|less warm(th)?|icy)\b/, effect: nudge('temperature', -8) },
  { id: 'warmer', pattern: /\b(warm(er|th)?|golden|sunny|cozy)\b/, effect: nudge('temperature', 8) },
  { id: 'greener', pattern: /\b(green(er)?|less magenta)\b/, effect: nudge('tint', -8) },
  { id: 'pinker', pattern: /\b(pink(er)?|magenta|less green)\b/, effect: nudge('tint', 8) },
  { id: 'darker', pattern: /\b(dark(er)?|dim(mer)?|darken|less light|underexposed)\b/, effect: nudge('exposure', -0.25) },
  { id: 'brighter', pattern: /\b(bright(er)?|light(er)?|brighten|lighten|more light|airy)\b/, effect: nudge('exposure', 0.25) },
];

export const STEER_EXAMPLES = ['warmer', 'cooler', 'moodier', 'brighter', 'darker', 'more contrast', 'less contrast', 'more colour', 'less colour', 'lift the shadows', 'tame the highlights', 'teal shadows', 'warm highlights', 'faded'];

const BIG = /\b(much|a lot|way|very|really|super|far|heavily|lots)\b/;
const SMALL = /\b(slightly|a bit|a little|little|bit|touch|tad|hint|tiny|subtly)\b/;
const NOISE = /\b(please|make it|make the|make|a|an|the|it|this|more|less|and|but|keep|just|pls|photo|image|look|feel|bit|little)\b|[^a-z ]/g;

export interface SteerResult {
  settings: Settings;
  understood: string[];        // the phrases it recognised, in order
  changes: string[];           // which controls moved
  leftover: string;            // what it could not make sense of
}

/** Apply a plain-English request to a copy of the settings. Clauses split on commas, "and", "then" and full stops. */
export function steer(settings: Settings, text: string): SteerResult {
  const out = cloneSettings(settings);
  const understood: string[] = [];
  const leftover: string[] = [];
  const clauses = text.toLowerCase().split(/[,;.]|\band\b|\bthen\b|\bbut\b/).map((c) => c.trim()).filter(Boolean);
  for (const clause of clauses) {
    const k = BIG.test(clause) ? 2 : SMALL.test(clause) ? 0.5 : 1;
    let rest = ` ${clause} `;
    let hit = false;
    for (const ph of PHRASES) {
      const m = rest.match(ph.pattern);
      if (!m) continue;
      ph.effect(out, k);
      understood.push(k === 2 ? `${ph.id} (a lot)` : k === 0.5 ? `${ph.id} (a little)` : ph.id);
      rest = rest.replace(ph.pattern, ' ');
      hit = true;
    }
    const left = rest.replace(BIG, ' ').replace(SMALL, ' ').replace(NOISE, ' ').replace(/\s+/g, ' ').trim();
    if (!hit && left) leftover.push(clause);
    else if (hit && left && left.split(' ').length > 1) leftover.push(left);
  }
  return { settings: out, understood, changes: describeChanges(settings, out), leftover: leftover.join(', ') };
}
