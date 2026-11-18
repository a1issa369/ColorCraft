// The "Copy my settings" text: the current grade as plain lines a person can repeat in Lightroom or Snapseed.
import { BANDS, hslIsNeutral } from '../core/hsl.ts';
import { curvesAreIdentity } from '../core/curves.ts';
import { MASK_KEYS } from '../core/mask.ts';
import { effectiveAdj } from '../state/grade.ts';
import type { Settings } from '../state/types.ts';
import { CONTROLS, formatValue } from './teach.ts';

export function describeSettings(s: Settings): string {
  const a = effectiveAdj(s);
  const lines = CONTROLS.filter((c) => Math.abs(a[c.key]) > 1e-9).map((c) => `${c.name}: ${formatValue(c, a[c.key])}`);
  if (a.splitShadow.amount) lines.push(`Shadow tint: hue ${a.splitShadow.hue}, ${Math.round(a.splitShadow.amount * 100)}%`);
  if (a.splitHighlight.amount) lines.push(`Highlight tint: hue ${a.splitHighlight.hue}, ${Math.round(a.splitHighlight.amount * 100)}%`);
  if (!curvesAreIdentity(a.curves) || !curvesAreIdentity(a.lookCurves)) lines.push('Tone curve: custom (see the Curves tab)');
  const hsl = a.hsl;
  if (hsl && !hslIsNeutral(hsl)) {
    BANDS.forEach((b, i) => {
      const parts = ([['hue', 'hue'], ['sat', 'saturation'], ['lum', 'brightness']] as const)
        .filter(([k]) => hsl[k][i])
        .map(([k, n]) => `${n} ${hsl[k][i] > 0 ? '+' : ''}${Math.round(hsl[k][i])}`);
      if (parts.length) lines.push(`${b.name}: ${parts.join(', ')}`);
    });
  }
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  s.masks.forEach((m, i) => {
    const parts = MASK_KEYS.filter((k) => m.adj[k]).map((k) => {
      const c = CONTROLS.find((x) => x.key === k)!;
      return `${c.name} ${formatValue(c, m.adj[k])}`;
    });
    if (!parts.length) return;
    if (m.kind === 'range') {
      lines.push(`Brightness ${i + 1} (${m.invert ? 'everything except ' : ''}tones from ${pct(m.lo)} to ${pct(m.hi)} brightness, fading over ${pct(m.soft)}): ${parts.join(', ')}`);
      return;
    }
    lines.push(`Gradient ${i + 1} (${m.invert ? 'flipped, ' : ''}strongest at ${pct(m.x1)} across and ${pct(m.y1)} down, gone by ${pct(m.x2)} across and ${pct(m.y2)} down): ${parts.join(', ')}`);
  });
  if (s.ref) lines.push(`Matched to a reference: colour ${pct(s.ref.color)}, tone ${pct(s.ref.tone)}`);
  return lines.length ? lines.join('\n') : 'No changes yet.';
}
