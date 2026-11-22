// A small, readable summary of the photo and the edit, sent with each chat message instead of the photo itself.
import { SLIDER_KEYS } from './actions.ts';
import type { EditorState } from '../state/types.ts';

const r = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const pct = (v: number) => Math.round(v * 100);

export interface ChatContext {
  photo: null | { brightnessPct: number; darkClippedPct: number; brightClippedPct: number; contrastRange: number; colourStrength: number; warmthCast: string };
  findings: { title: string; detail: string }[];
  edit: { sliders: Record<string, number>; shadowTint: { hue: number; amount: number }; highlightTint: { hue: number; amount: number }; look: string | null; lookStrength: number; masks: { kind: string; adjust: Record<string, number> }[] };
  reference: { chosen: boolean; closenessPct?: number; weakest?: string };
}

export function describeContext(s: EditorState): ChatContext {
  const st = s.stats;
  const adj = s.settings.adj;
  const sliders: Record<string, number> = {};
  for (const k of SLIDER_KEYS) sliders[k] = r(adj[k]);
  const dials = s.agent.closeness?.dials;
  const weakest = dials ? (Object.entries(dials).sort((a, b) => a[1] - b[1])[0]?.[0]) : undefined;
  const cast = st?.cast;
  return {
    photo: st ? {
      brightnessPct: pct(st.median), darkClippedPct: r(st.shadowClip * 100, 1), brightClippedPct: r(st.highlightClip * 100, 1),
      contrastRange: r(st.spread), colourStrength: r(st.chroma, 1),
      warmthCast: cast && cast.reliable ? (cast.b > 8 ? 'warm' : cast.b < -8 ? 'cool' : 'neutral') + (cast.a > 8 ? ', magenta' : cast.a < -8 ? ', green' : '') : 'unclear',
    } : null,
    findings: s.findings.slice(0, 6).map((f) => ({ title: f.title, detail: f.detail.slice(0, 160) })),
    edit: {
      sliders,
      shadowTint: { hue: adj.splitShadow.hue, amount: r(adj.splitShadow.amount) },
      highlightTint: { hue: adj.splitHighlight.hue, amount: r(adj.splitHighlight.amount) },
      look: s.settings.look, lookStrength: r(s.settings.lookStrength),
      masks: s.settings.masks.map((m) => ({ kind: m.kind, adjust: Object.fromEntries(Object.entries(m.adj).filter(([, v]) => v).map(([k, v]) => [k, r(v as number)])) })),
    },
    reference: s.agent.ref ? { chosen: true, closenessPct: s.agent.closeness ? Math.round(s.agent.closeness.overall) : undefined, weakest } : { chosen: false },
  };
}
