// Turn measurements into plain-English findings, each with a concrete suggested fix.
import { applyAdjustments, makeAdjustments } from './adjust.js';
import { decode, clamp, rgb8ToLab } from './color.js';
import { makeImage, fillImage, downscale } from './image.js';
import { analyze } from './analyze.js';

const TARGET_MEDIAN = 0.46;   // sRGB-encoded brightness of middle grey
const CAST_THRESHOLD = 8;      // average colour this far from grey (in Lab units) counts as a cast
const FIX_STRENGTH = 0.7;     // suggestions deliberately stop short of full neutralisation, to leave some mood

/** How far one full step (+100) of each white-balance slider moves a neutral grey in Lab, measured with the real pipeline. */
function measureWhiteBalance() {
  const grey = fillImage(makeImage(1, 1), 128, 128, 128);
  const lab = [0, 0, 0];
  const read = (adj) => {
    const out = applyAdjustments(grey, makeAdjustments(adj));
    rgb8ToLab(out.data[0], out.data[1], out.data[2], lab);
    return { a: lab[1], b: lab[2] };
  };
  const base = read({});
  const warm = read({ temperature: 100 });
  const magenta = read({ tint: 100 });
  return {
    tempA: warm.a - base.a, tempB: warm.b - base.b,
    tintA: magenta.a - base.a, tintB: magenta.b - base.b,
  };
}

let wb = null;
export function whiteBalanceGains() {
  if (!wb) wb = measureWhiteBalance();
  return wb;
}

/** Slider values that move a neutral by (da, db). Temperature and tint also nudge each other's axis, so solve both together. */
function solveWhiteBalance(da, db) {
  const { tempA, tempB, tintA, tintB } = whiteBalanceGains();
  const det = tempA * tintB - tintA * tempB;
  if (Math.abs(det) < 1e-6) return { temperature: 0, tint: 0 };
  return {
    temperature: ((da * tintB - tintA * db) / det) * 100,
    tint: ((tempA * db - da * tempB) / det) * 100,
  };
}

const round = (v, step) => Number((Math.round(v / step) * step).toFixed(2));
const pct = (v) => `${Math.round(v * 100)}%`;

/**
 * @returns {Array<{id:string, severity:number, title:string, detail:string, fix:object|null}>}
 *          ordered most important first. A balanced photo yields a single `ok` finding.
 */
export function diagnose(stats) {
  const findings = [];
  const { median, shadowClip, highlightClip, spread, chroma, cast, colorSpread } = stats;

  if (median < 0.36) {
    const ev = clamp(Math.log2(decode(TARGET_MEDIAN) / Math.max(decode(median), 1e-4)) * 0.75, 0, 1.5);
    findings.push({
      id: 'under',
      severity: clamp((0.4 - median) / 0.2, 0.2, 1),
      title: 'Underexposed',
      detail: `The middle of the photo sits at ${pct(median)} brightness, darker than a typical well-exposed shot. That is fine for a night or moody photo; otherwise raise the exposure.`,
      fix: { exposure: round(ev, 0.05) },
    });
  } else if (median > 0.66) {
    const ev = clamp(Math.log2(decode(TARGET_MEDIAN) / decode(median)) * 0.75, -1.5, 0);
    findings.push({
      id: 'over',
      severity: clamp((median - 0.62) / 0.2, 0.2, 1),
      title: 'Overexposed',
      detail: `The middle of the photo sits at ${pct(median)} brightness, brighter than a typical well-exposed shot. Lower the exposure to bring colour back.`,
      fix: { exposure: round(ev, 0.05) },
    });
  }

  if (shadowClip > 0.05) {
    findings.push({
      id: 'crushed',
      severity: clamp(shadowClip * 5, 0.2, 1),
      title: 'Shadows are crushed',
      detail: `${pct(shadowClip)} of the photo is pure black, so there is no detail left in the darkest areas. Lifting the shadows brings some back.`,
      fix: { shadows: Math.round(clamp(shadowClip * 400, 20, 70)) },
    });
  }

  if (highlightClip > 0.02) {
    findings.push({
      id: 'blown',
      severity: clamp(highlightClip * 15, 0.2, 1),
      title: 'Highlights are blown out',
      detail: `${pct(highlightClip)} of the photo is pure white in at least one colour, so the brightest areas have lost detail. Pulling the highlights down recovers what is left.`,
      fix: { highlights: -Math.round(clamp(highlightClip * 1500, 25, 80)) },
    });
  }

  if (spread < 0.55) {
    findings.push({
      id: 'flat',
      severity: clamp((0.55 - spread) / 0.25, 0.15, 1),
      title: 'Looks flat',
      detail: 'The darks are not very dark and the lights are not very bright, which makes the photo look hazy. A little contrast gives it depth.',
      fix: { contrast: Math.round(clamp((0.62 - spread) * 130, 8, 40)) },
    });
  }

  if (cast.reliable && cast.magnitude >= CAST_THRESHOLD) {
    const wbFix = solveWhiteBalance(-cast.a * FIX_STRENGTH, -cast.b * FIX_STRENGTH);
    const temperature = clamp(wbFix.temperature, -100, 100);
    const tint = clamp(wbFix.tint, -100, 100);
    // Name the cast by its direction on the a/b plane (a: green to magenta, b: blue to yellow).
    const angle = (Math.atan2(cast.b, cast.a) * 180) / Math.PI;
    let title;
    let detail;
    if (angle >= 20 && angle < 110) {
      title = 'Leans warm';
      detail = 'Everything has a yellow-orange tint. If you shot at golden hour or under warm lights, that may be the mood you want. If not, cool it down.';
    } else if (angle >= 110 && angle < 200) {
      title = 'Leans green';
      detail = 'Everything has a green tint, common under fluorescent light. A little magenta in the tint control balances it.';
    } else if (angle >= 200 || angle < -70) {
      title = 'Leans cool';
      detail = 'Everything has a blue tint, common in shade, snow or overcast light. If it does not feel right, warm it up.';
    } else {
      title = 'Leans magenta';
      detail = 'Everything has a pink tint. A little green in the tint control balances it.';
    }
    findings.push({
      id: 'cast',
      severity: clamp((cast.magnitude - 6) / 14, 0.1, 1),
      title,
      detail,
      fix: { temperature: Math.round(temperature), tint: Math.round(tint) },
    });
  }

  // Almost no colour, or a single tint over a black and white photo, is a choice, not a problem.
  if (chroma < 14 && chroma >= 2.5 && colorSpread >= 0.6 * chroma) {
    findings.push({
      id: 'muted',
      severity: clamp((14 - chroma) / 8, 0.15, 1),
      title: 'Colours look muted',
      detail: 'The colours are quite weak. A little saturation makes them read, but go gently.',
      fix: { saturation: Math.round(clamp((22 / Math.max(chroma, 4) - 1) * 100 * FIX_STRENGTH, 0, 60)) },
    });
  } else if (chroma > 40) {
    findings.push({
      id: 'loud',
      severity: clamp((chroma - 40) / 20, 0.15, 1),
      title: 'Colours are very strong',
      detail: 'The colours are intense and may look artificial, especially in skin. Easing the saturation can make it feel more natural.',
      fix: { saturation: -Math.round(clamp((1 - 30 / chroma) * 100 * FIX_STRENGTH, 0, 60)) },
    });
  }

  findings.sort((x, y) => y.severity - x.severity);
  if (findings.length === 0) {
    return [{
      id: 'ok',
      severity: 0,
      title: 'Looks balanced',
      detail: 'Brightness, contrast, colour and saturation are all in a normal range. Try a look to give it a style.',
      fix: null,
    }];
  }
  return findings;
}

/** Merge the fixes from a list of findings into one set of adjustments (fixes replace, they do not stack). */
export function mergeFixes(base, findings) {
  const out = makeAdjustments(base);
  for (const f of findings) {
    if (f.fix) Object.assign(out, f.fix);
  }
  return out;
}


const ADD_KEYS = ['exposure', 'contrast', 'highlights', 'shadows', 'temperature', 'tint', 'saturation'];
const LIMITS = { exposure: [-2, 2], contrast: [-100, 100], highlights: [-100, 100], shadows: [-100, 100], temperature: [-100, 100], tint: [-100, 100], saturation: [-100, 100] };

/**
 * One-click grading. Fixes interact (pulling highlights down also flattens the photo), so instead of trusting one
 * set of measurements it applies the fixes, measures again, and corrects what is still wrong, for up to three rounds.
 */
export function autoGrade(img, base = makeAdjustments(), maxEdge = 320) {
  const small = downscale(img, maxEdge);
  const score = (findings) => findings.reduce((t, f) => t + f.severity, 0);
  const measure = (adj) => diagnose(analyze(applyAdjustments(small, adj)));

  let adj = makeAdjustments(base);
  let findings = measure(adj);
  let best = adj;
  let bestScore = score(findings);
  for (let round = 0; round < 3; round++) {
    if (findings.every((f) => !f.fix || f.severity < 0.25)) break;
    const next = makeAdjustments(adj);
    // A colour cast inflates the colour measurement, so settle the cast first and judge saturation in a later round.
    const hasCast = findings.some((f) => f.id === 'cast' && f.severity >= 0.25);
    for (const f of findings) {
      if (!f.fix || f.severity < 0.25) continue;
      if (hasCast && (f.id === 'muted' || f.id === 'loud')) continue;
      for (const k of ADD_KEYS) {
        if (f.fix[k] !== undefined) next[k] = clamp(next[k] + f.fix[k], LIMITS[k][0], LIMITS[k][1]);
      }
    }
    adj = next;
    findings = measure(adj);
    const sc = score(findings);
    if (sc >= bestScore) break; // another round made things no better: stop and keep the best so far
    best = adj;
    bestScore = sc;
  }
  const out = makeAdjustments(best);
  for (const k of ADD_KEYS) out[k] = Number(out[k].toFixed(2));
  return out;
}
