// The match agent: plan, act, check. It reads a reference photo's look, then edits the user's photo toward it one
// dimension at a time, measuring how close it got after every step and keeping only the steps that helped.
// Everything it does is written as ordinary settings (sliders, split toning, masks), so nothing is hidden and every
// step stays editable. No model, no network: a closed-loop search that runs in the browser. Pure, so it is tested in Node.
import { MAX_MASKS, makeMask } from '../core/mask.ts';
import { downscale, makeImage } from '../core/image.ts';
import { closenessOf, describeGaps, describeLook, distances, tintName, toneDistance, traitsOf, DIAL_LABEL, DIALS } from '../core/matchscore.ts';
import type { Closeness, DialId, Traits } from '../core/matchscore.ts';
import { lookProfile } from '../core/transfer.ts';
import type { LookProfile } from '../core/transfer.ts';
import type { Img } from '../core/types.ts';
import { AlphaCache } from '../core/mask.ts';
import { CONTROLS, formatValue } from '../ui/teach.ts';
import { gradeImage, makeBuffers } from './grade.ts';
import { cloneSettings } from './store.ts';
import type { Settings } from './types.ts';

/** What the agent needs to know about the reference: its look, and a small copy for finding its horizon. */
export interface AgentRef { profile: LookProfile; thumb: Img }

export type StepKind = 'read' | 'brightness' | 'tone' | 'warmth' | 'colour' | 'toning' | 'region' | 'refine' | 'steer' | 'verify';

export interface AgentStep {
  id: string;
  kind: StepKind;
  title: string;
  why: string;                 // what it noticed and why it did this, in plain English
  changes: string[];           // exactly which controls moved
  before: number;              // overall closeness (0..100) before and after this step
  after: number;
  kept: boolean;               // false when the step was tried and thrown away because it did not help
  settings: Settings;          // the edit as it stands after this step, so any step can be jumped back to
}

export interface AgentResult { before: number; after: number; settings: Settings; steps: AgentStep[] }

const EVAL_EDGE = 160;

// ---------------------------------------------------------------------------------------------------------------
// Search helpers
// ---------------------------------------------------------------------------------------------------------------

/**
 * Smallest value of f over [lo, hi]: sample, then zoom in around the best sample, a few rounds. `x0` (what the value is
 * now) is always one of the candidates and wins unless something beats it clearly, so a search never makes things worse.
 */
export function minimise(f: (x: number) => number, lo: number, hi: number, x0: number, n = 9, rounds = 3, eps = 1e-3): number {
  let best = x0, bestV = f(x0);
  let a = lo, b = hi;
  for (let r = 0; r < rounds; r++) {
    const step = (b - a) / (n - 1);
    let rBest = a, rV = Infinity;
    for (let i = 0; i < n; i++) {
      const x = a + i * step;
      const v = f(x);
      if (v < rV) { rV = v; rBest = x; }
    }
    if (rV < bestV - eps) { bestV = rV; best = rBest; }
    a = Math.max(lo, rBest - step); b = Math.min(hi, rBest + step);
  }
  return best;
}

interface Param { get: (s: Settings) => number; set: (s: Settings, v: number) => void; lo: number; hi: number }
const slider = (key: 'exposure' | 'contrast' | 'highlights' | 'shadows' | 'temperature' | 'tint' | 'saturation' | 'fade', lo: number, hi: number): Param => ({
  get: (s) => s.adj[key], set: (s, v) => { s.adj[key] = key === 'exposure' ? Math.round(v * 20) / 20 : key === 'fade' ? Math.round(v * 100) / 100 : Math.round(v); }, lo, hi,
});

/** One coordinate-descent sweep per pass: each control in turn, searched alone while the others stay put. */
function descend(params: Param[], probe: Settings, objective: (s: Settings) => number, passes: number, narrow: number): void {
  for (let p = 0; p < passes; p++) {
    for (const prm of params) {
      const x0 = prm.get(probe), span = (prm.hi - prm.lo) * narrow;
      const lo = narrow < 1 ? Math.max(prm.lo, x0 - span) : prm.lo, hi = narrow < 1 ? Math.min(prm.hi, x0 + span) : prm.hi;
      prm.set(probe, minimise((x) => { prm.set(probe, x); return objective(probe); }, lo, hi, x0, 9, 3));
      // set() rounds to the control's own step, so the probe always holds a value a person could also dial in.
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Horizon: where a photo changes most from top to bottom, if it clearly does
// ---------------------------------------------------------------------------------------------------------------

export function cropRows(img: Img, y0: number, y1: number): Img {
  const a = Math.max(0, Math.floor(y0)), b = Math.min(img.height, Math.ceil(y1));
  const h = Math.max(1, b - a);
  const out = makeImage(img.width, h);
  out.data.set(img.data.subarray(a * img.width * 4, (a + h) * img.width * 4));
  return out;
}

/** Row of the strongest top-to-bottom change in colour, as a fraction of the height. Null when nothing stands out. */
export function findHorizon(img: Img): { y: number; strength: number } | null {
  const w = img.width, h = img.height;
  if (h < 24 || w < 8) return null;
  const rows = new Float64Array(h * 3);
  for (let y = 0; y < h; y++) {
    let r = 0, g = 0, b = 0;
    for (let x = 0, i = y * w * 4; x < w; x++, i += 4) { r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; }
    rows[y * 3] = r / w; rows[y * 3 + 1] = g / w; rows[y * 3 + 2] = b / w;
  }
  const win = Math.max(2, Math.round(h * 0.04));
  const diffs: number[] = new Array(h).fill(0);
  const mean = (y0: number, y1: number, c: number) => { let s = 0; for (let y = y0; y < y1; y++) s += rows[y * 3 + c]; return s / (y1 - y0); };
  for (let y = win; y <= h - win; y++) {
    let d = 0;
    for (let c = 0; c < 3; c++) d += (mean(y, y + win, c) - mean(y - win, y, c)) ** 2;
    diffs[y] = Math.sqrt(d);
  }
  let best = -1, bestV = 0;
  for (let y = Math.ceil(h * 0.2); y <= Math.floor(h * 0.8); y++) if (diffs[y] > bestV) { bestV = diffs[y]; best = y; }
  const sorted = diffs.filter((v) => v > 0).sort((a, b) => a - b);
  const median = sorted.length ? sorted[sorted.length >> 1] : 0;
  if (best < 0 || bestV < 20 || bestV < median * 2.5) return null;
  return { y: best / h, strength: bestV };
}

// ---------------------------------------------------------------------------------------------------------------
// Describing what changed
// ---------------------------------------------------------------------------------------------------------------

const HUE_NAMES: [number, string][] = [[0, 'red'], [30, 'orange'], [60, 'yellow'], [120, 'green'], [180, 'teal'], [225, 'blue'], [275, 'purple'], [320, 'pink'], [360, 'red']];
export function hueName(deg: number): string {
  const h = ((deg % 360) + 360) % 360;
  let best = HUE_NAMES[0];
  for (const n of HUE_NAMES) if (Math.abs(n[0] - h) < Math.abs(best[0] - h)) best = n;
  return best[1];
}

export function describeChanges(a: Settings, b: Settings): string[] {
  const out: string[] = [];
  for (const c of CONTROLS) {
    if (Math.abs(a.adj[c.key] - b.adj[c.key]) > 1e-9) out.push(`${c.name} ${formatValue(c, a.adj[c.key])} to ${formatValue(c, b.adj[c.key])}`);
  }
  const tint = (label: string, x: Settings['adj']['splitShadow'], y: Settings['adj']['splitShadow']) => {
    if (Math.abs(x.amount - y.amount) > 1e-9 || (y.amount > 0 && Math.abs(x.hue - y.hue) > 1e-9)) {
      out.push(y.amount > 0 ? `${label} ${hueName(y.hue)} at ${Math.round(y.amount * 100)}%` : `${label} off`);
    }
  };
  tint('Shadow tint', a.adj.splitShadow, b.adj.splitShadow);
  tint('Highlight tint', a.adj.splitHighlight, b.adj.splitHighlight);
  const had = new Set(a.masks.map((m) => m.id));
  for (const m of b.masks) {
    if (had.has(m.id)) continue;
    const parts = Object.entries(m.adj).filter(([, v]) => v).map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${Math.round((v as number) * 100) / 100}`);
    const where = m.kind === 'linear' ? (m.y1 < m.y2 ? 'a top-of-photo' : 'a bottom-of-photo') : 'a';
    out.push(`Added ${where} mask: ${parts.join(', ') || 'no change'}`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// The agent
// ---------------------------------------------------------------------------------------------------------------

const TONE_PARAMS = [slider('contrast', -100, 100), slider('shadows', -100, 100), slider('highlights', -100, 100), slider('fade', 0, 0.6)];
const WARMTH_PARAMS = [slider('temperature', -80, 80), slider('tint', -60, 60)];
const COLOUR_PARAMS = [slider('saturation', -80, 100)];
const BRIGHTNESS_PARAMS = [slider('exposure', -2, 2)];

/**
 * Run the agent. A generator, so the caller can show each step as it lands and stop at any time.
 * @param src the user's photo (any size; it is shrunk for searching)
 * @param start the current edit; the live reference match is switched off because the agent's own steps replace it
 */
export function* matchAgent(src: Img, start: Settings, ref: AgentRef, cache: AlphaCache = new AlphaCache(MAX_MASKS + 2)): Generator<AgentStep, AgentResult> {
  const small = downscale(src, EVAL_EDGE);
  const bufs = makeBuffers(small);
  const refT = traitsOf(ref.profile);
  const traitsFor = (s: Settings): Traits => traitsOf(lookProfile(gradeImage(small, s, cache, bufs)));
  const dist = (s: Settings) => distances(traitsFor(s), refT);
  const overall = (s: Settings): number => closenessOf(dist(s)).overall;

  const startedWithRef = !!start.ref;
  let cur = cloneSettings(start);
  cur.ref = null;
  const first = overall(cur);
  const steps: AgentStep[] = [];

  const snap = (): Settings => cloneSettings(cur);
  const record = (s: AgentStep): AgentStep => { steps.push(s); return s; };

  /** Try something on a copy; keep it only if the overall match did not get worse. */
  const attempt = (id: string, kind: StepKind, title: string, why: string, change: (draft: Settings) => void, tolerance = 0.5): AgentStep => {
    const before = overall(cur);
    const trial = cloneSettings(cur);
    change(trial);
    const changes = describeChanges(cur, trial);
    const after = changes.length ? overall(trial) : before;
    const kept = changes.length > 0 && after >= before - tolerance;
    if (kept) cur = trial;
    return record({
      id, kind, title,
      why: !changes.length ? `${why} Already close enough here, so nothing changed.` : kept ? why : `${why} I tried it, but it made the overall match worse, so I threw it away.`,
      changes: kept ? changes : [], before, after: kept ? after : before, kept, settings: snap(),
    });
  };

  // 1. Read both photos.
  const userT = traitsFor(cur);
  const gaps = describeGaps(userT, refT);
  yield record({
    id: 'read', kind: 'read', title: 'Read both photos',
    why: `The reference is ${describeLook(refT)}. ${gaps.length ? gaps.slice(0, 3).join(' ') : 'Your photo is already very close to it.'}${startedWithRef ? ' I switched off the live match so the sliders carry the whole grade and you can edit each part.' : ''}`,
    changes: startedWithRef ? ['Live match off'] : [], before: first, after: first, kept: true, settings: snap(),
  });

  const run = (params: Param[], objective: (s: Settings) => number, passes = 2, narrow = 1) => (draft: Settings) => descend(params, draft, objective, passes, narrow);

  // 2. Brightness.
  yield attempt('brightness', 'brightness', 'Match brightness',
    'First I set Exposure so the middle of your photo is as bright as the middle of the reference.',
    run(BRIGHTNESS_PARAMS, (s) => dist(s).brightness, 1));

  // 3. Tone shape: contrast, shadows, highlights and fade.
  yield attempt('tone', 'tone', 'Match contrast and tone shape',
    'Next I shaped the tones: Contrast, Shadows, Highlights and Fade, so the dark, middle and bright parts sit where the reference\'s do.',
    run(TONE_PARAMS, (s) => toneDistance(traitsFor(s), refT)));

  // 4. White balance.
  yield attempt('warmth', 'warmth', 'Match warmth',
    'Then white balance: Temperature and Tint, so the overall colour of the light matches.',
    run(WARMTH_PARAMS, (s) => dist(s).warmth));

  // 5. Colour strength.
  yield attempt('colour', 'colour', 'Match colour strength',
    'Then Saturation, so your colours are as strong or as quiet as the reference\'s.',
    run(COLOUR_PARAMS, (s) => dist(s).colour, 1));

  // 6. Toning: split tint for shadows and highlights.
  yield attempt('toning', 'toning', 'Match shadow and highlight tints',
    'Last for the whole photo: I looked at the colour of the dark parts and the bright parts separately, then tinted each one toward the reference\'s.',
    (draft) => {
      for (const which of ['splitShadow', 'splitHighlight'] as const) {
        const id: DialId = which === 'splitShadow' ? 'shadowTint' : 'highlightTint';
        const f = () => dist(draft)[id];
        const base = draft.adj[which];
        let bestHue = base.hue, bestAmt = base.amount, bestV = f();
        for (let h = 0; h < 360; h += 30) {
          for (const amt of [0.15, 0.35, 0.6]) {
            draft.adj[which] = { hue: h, amount: amt };
            const v = f();
            if (v < bestV - 1e-3) { bestV = v; bestHue = h; bestAmt = amt; }
          }
        }
        draft.adj[which] = { hue: bestHue, amount: bestAmt };
        if (bestAmt > 0 && bestAmt !== base.amount) {
          bestHue = Math.round(((minimise((h) => { draft.adj[which] = { hue: ((h % 360) + 360) % 360, amount: bestAmt }; return f(); }, bestHue - 30, bestHue + 30, bestHue, 7, 2) % 360) + 360) % 360);
          draft.adj[which] = { hue: bestHue, amount: bestAmt };
          bestAmt = Math.round(minimise((a) => { draft.adj[which] = { hue: bestHue, amount: a }; return f(); }, 0, 1, bestAmt, 7, 2) * 100) / 100;
          draft.adj[which] = { hue: bestHue, amount: bestAmt };
        } else if (bestAmt === base.amount) draft.adj[which] = { ...base };
      }
    });

  // 7. Sky and ground, when both photos have a clear horizon.
  const regionStep = regions(small, ref, cur, cache, bufs);
  if (regionStep) {
    const before = overall(cur);
    const trial = regionStep.apply(cloneSettings(cur));
    const changes = describeChanges(cur, trial.settings);
    const after = trial.settings.masks.length > cur.masks.length ? overall(trial.settings) : before;
    const kept = trial.improved && changes.length > 0 && after >= before - 1;
    if (kept) cur = trial.settings;
    yield record({
      id: 'region', kind: 'region', title: 'Match sky and ground separately',
      why: kept ? regionStep.why : `${regionStep.why} The regions already matched well enough, so I left the masks out.`,
      changes: kept ? changes : [], before, after: kept ? after : before, kept, settings: snap(),
    });
  }

  // 8. Refine: another pass, searching only near where each control already is.
  let lastScore = overall(cur);
  for (let pass = 0; pass < 2 && lastScore < 97; pass++) {
    const step = attempt(`refine${pass + 1}`, 'refine', pass ? 'Refine again' : 'Refine',
      'Moving one control changes what the others should be, so I went round them all once more, searching only near where each one is now.',
      (draft) => {
        descend(BRIGHTNESS_PARAMS, draft, (s) => dist(s).brightness, 1, 0.2);
        descend(TONE_PARAMS, draft, (s) => toneDistance(traitsFor(s), refT), 1, 0.2);
        descend(WARMTH_PARAMS, draft, (s) => dist(s).warmth, 1, 0.2);
        descend(COLOUR_PARAMS, draft, (s) => dist(s).colour, 1, 0.2);
      }, 0);
    yield step;
    if (step.after - lastScore < 0.3) break;
    lastScore = step.after;
  }

  // 9. Check the result.
  const final = closenessOf(dist(cur));
  let after = final.overall;
  let result = cur;
  let verdict: string;
  if (after < first) { result = cloneSettings(start); result.ref = start.ref; after = first; verdict = 'None of my steps beat what you already had, so I put everything back.'; }
  else {
    const weakest = [...DIALS].sort((a, b) => final.dials[a] - final.dials[b])[0];
    verdict = `Closeness to the reference went from ${Math.round(first)}% to ${Math.round(after)}%. ${DIAL_LABEL[weakest]} is the furthest off (${Math.round(final.dials[weakest])}%), which is the one to fine tune first.`;
  }
  yield record({ id: 'verify', kind: 'verify', title: 'Check the result', why: verdict, changes: [], before: first, after, kept: true, settings: cloneSettings(result) });
  return { before: first, after, settings: result, steps };
}

// ---------------------------------------------------------------------------------------------------------------
// Sky and ground
// ---------------------------------------------------------------------------------------------------------------

const SKY_FROM = 0.45;     // the sky mask is full strength down to this fraction of the way to the horizon
const FADE = 0.04;          // and fades out this far past it

function regions(small: Img, ref: AgentRef, cur: Settings, cache: AlphaCache, bufs: ReturnType<typeof makeBuffers>) {
  if (cur.masks.length + 2 > MAX_MASKS) return null;
  const hu = findHorizon(small), hr = findHorizon(ref.thumb);
  if (!hu || !hr) return null;
  const rowsOf = (img: Img, y: number) => ({
    sky: cropRows(img, 0, img.height * y * 0.8),
    ground: cropRows(img, img.height * (y + (1 - y) * 0.2), img.height),
  });
  const r = rowsOf(ref.thumb, hr.y);
  if (r.sky.height < 6 || r.ground.height < 6) return null;
  const refRegion = { sky: traitsOf(lookProfile(r.sky)), ground: traitsOf(lookProfile(r.ground)) };
  const regionDist = (t: Traits, to: Traits) => Math.abs(t.q.p50 - to.q.p50) / 20 + Math.hypot(t.a - to.a, t.b - to.b) / 14 + Math.abs(t.colourful - to.colourful) / 14;

  return {
    why: `Both photos have a clear horizon, so I matched the sky and the ground separately with two masks, because a sky and the ground rarely want the same grade.`,
    apply(draft: Settings): { settings: Settings; improved: boolean } {
      let improved = false;
      for (const part of ['sky', 'ground'] as const) {
        const y = hu.y;
        const mask = makeMask(part === 'sky'
          ? { kind: 'linear', x1: 0.5, y1: y * SKY_FROM, x2: 0.5, y2: Math.min(0.98, y + FADE) }
          : { kind: 'linear', x1: 0.5, y1: y + (1 - y) * 0.55, x2: 0.5, y2: Math.max(0.02, y - FADE) });
        draft.masks.push(mask);
        const regionTraits = (): Traits => {
          const g = gradeImage(small, draft, cache, bufs);
          return traitsOf(lookProfile(rowsOf(g, y)[part]));
        };
        const f = () => regionDist(regionTraits(), refRegion[part]);
        const start = f();
        const keys = [['exposure', -1.5, 1.5, 0.05], ['temperature', -40, 40, 1], ['saturation', -60, 60, 1]] as const;
        for (let pass = 0; pass < 2; pass++) {
          for (const [key, lo, hi, step] of keys) {
            const x0 = mask.adj[key];
            mask.adj[key] = Math.round(minimise((v) => { mask.adj[key] = v; return f(); }, lo, hi, x0, 9, 3) / step) * step;
          }
        }
        const end = f();
        if (end < start * 0.9) improved = true; else draft.masks.pop();
      }
      return { settings: draft, improved };
    },
  };
}
