#!/usr/bin/env python3
"""Mutation check: break the colour maths on purpose and confirm the tests notice.

Each mutation edits one line of src/core, runs the suite, and expects a failure. A mutation that survives means
a behaviour nothing tests. Run: python3 scripts/mutation_check.py
"""
import pathlib, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
MUTATIONS = [
    ("adjust.js", "const ex = Math.pow(2, a.exposure);", "const ex = Math.pow(3, a.exposure);", "exposure is not one stop per step"),
    ("adjust.js", "const p = Math.pow(2, (contrast / 100) * 1.1);", "const p = Math.pow(2, -(contrast / 100) * 1.1);", "contrast direction flipped"),
    ("adjust.js", "x < 0.5 ? 0.5 * Math.pow(2 * x, p)", "x < 0.4 ? 0.5 * Math.pow(2 * x, p)", "contrast pivot moved off mid grey"),
    ("adjust.js", "let rg = 1 + 0.5 * tt;", "let rg = 1 - 0.5 * tt;", "warm temperature makes red weaker"),
    ("adjust.js", "let gg = 1 - 0.35 * tn;", "let gg = 1 + 0.35 * tn;", "tint direction flipped"),
    ("adjust.js", "(a.shadows / 100) * 1.6 * ws", "(a.shadows / 100) * 1.6 * wh", "shadows slider moves the highlights"),
    ("adjust.js", "(a.highlights / 100) * 1.0 * wh", "(a.highlights / 100) * 1.0 * ws", "highlights slider moves the shadows"),
    ("adjust.js", "out[k] = base[k] + (look[k] || 0) * s;", "out[k] = base[k] + (look[k] || 0);", "look strength ignored"),
    ("analyze.js", "if (bin <= 3) clipLo++;", "if (bin <= 30) clipLo++;", "shadow clipping threshold too loose"),
    ("analyze.js", "if (r >= 253 || g >= 253 || b >= 253) clipHi++;", "if (r >= 253 && g >= 253 && b >= 253) clipHi++;", "clipping needs all channels"),
    ("analyze.js", "const meanA = reliable ? castA / castW : 0;", "const meanA = reliable ? -castA / castW : 0;", "cast sign flipped"),
    ("analyze.js", "const CAST_SIGMA = 60;", "const CAST_SIGMA = 1e9;", "cast ignores strongly coloured pixels no more"),
    ("suggest.js", "const round = (v, step) => Number((Math.round(v / step) * step).toFixed(2));", "const round = (v, step) => v;", "fix values not rounded"),
    ("suggest.js", "temperature: ((da * tintB - tintA * db) / det) * 100,", "temperature: ((da * tintB + tintA * db) / det) * 100,", "white balance solver ignores tint cross-talk"),
    ("suggest.js", "if (f.fix) Object.assign(out, f.fix);", "if (false) Object.assign(out, f.fix);", "mergeFixes does nothing"),
    ("transfer.js", "refStats.mean[0] - lab[0]", "refStats.mean[1] - lab[0]", "reference lightness taken from the wrong channel"),
    ("transfer.js", "const MIN_RATIO = 0.6;", "const MIN_RATIO = 0.0001;", "spread ratio not clamped"),
    ("palette.js", ".sort((x, y) => y.size - x.size)", ".sort((x, y) => x.size - y.size)", "palette not sorted by share"),
    ("image.js", "const s = maxEdge / long;", "const s = (maxEdge / long) * 0.9;", "downscale misses its target size"),
    ("color.js", "export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);", "export const clamp = (v, lo, hi) => (v < lo ? lo : v);", "clamp ignores the upper bound"),
    ("curves.js", "if (s > 9) {", "if (s > 900) {", "spline can overshoot and double back"),
    ("curves.js", "for (const s of active) { fns.push(makeSpline(s.rgb || IDENTITY)); fns.push(makeSpline(s[keys[c]] || IDENTITY)); }", "for (const s of active) { fns.push(makeSpline(s[keys[c]] || IDENTITY)); fns.push(makeSpline(s.rgb || IDENTITY)); }", "channel curve runs before the RGB curve"),
    ("curves.js", "return points.map(([x, y]) => [x, x + (y - x) * s]);", "return points.map(([x, y]) => [x, y * s]);", "look curve strength blends toward black, not a straight line"),
    ("hsl.js", "h = (h + dHue[k] + 360) % 360;", "h = (h - dHue[k] + 360) % 360;", "hue slider direction flipped"),
    ("hsl.js", "s = clamp(s * dSat[k], 0, 1);", "s = clamp(s * (2 - dSat[k]), 0, 1);", "colour mix saturation direction flipped"),
    ("hsl.js", "t = t * t * (3 - 2 * t);", "t = t >= 0.5 ? 1 : 0;", "colour families switch abruptly at their edges"),
    ("hsl.js", "v = clamp(v * (1 + dLum[k] * (s * 2 < 1 ? s * 2 : 1)), 0, 1);", "v = clamp(v * (1 - dLum[k] * (s * 2 < 1 ? s * 2 : 1)), 0, 1);", "colour mix brightness direction flipped"),
    ("transfer.js", "if (tN > 0) L = L0 + tN * (toneL[idx] - L0);", "if (tN > 0) L = L0 - tN * (toneL[idx] - L0);", "tone match moves away from the reference"),
    ("transfer.js", "+ rA[idx] - a, -MAX_SHIFT, MAX_SHIFT);", "+ sA[idx] - a, -MAX_SHIFT, MAX_SHIFT);", "colour match ignores the reference colour"),
    ("transfer.js", "const ys = isotonic(measured.map((m) => m[1]));", "const ys = measured.map((m) => m[1]);", "fitted curves can run backwards"),
    ("adjust.js", "curvesAreIdentity(adj.lookCurves) && hslIsNeutral(adj.hsl)", "curvesAreIdentity(adj.lookCurves)", "a colour mix does not count as an edit"),
    ("history.js", "this.stack.length = this.index + 1;", "", "editing after undo keeps stale redo steps"),
    ("history.js", "if (top && top.signature === signature) return false;", "", "repeated identical states add undo steps"),
    ("history.js", "if (this.stack.length > this.limit) this.stack.shift();", "", "history grows without a limit"),
    ("history.js", "this.index--;\n    return this.stack[this.index].snap;", "this.index -= 2;\n    return this.stack[this.index].snap;", "undo skips a step"),
    ("hsl.js", "const k = Math.min(HUE_STEPS - 1, (h * (HUE_STEPS / 360)) | 0);", "const k = 0;", "colour mix ignores the pixel's hue"),
    ("transfer.js", "const idx = (L0 * (STEPS / 100) + 0.5) | 0;", "const idx = 500;", "match ignores each pixel's lightness"),
]

def suite():
    files = sorted(str(p.relative_to(ROOT)) for p in (ROOT / "tests").glob("*.test.js"))
    return subprocess.run(["node", "--test", *files], cwd=ROOT, capture_output=True, text=True).returncode

def main():
    if suite() != 0:
        print("The suite must pass before mutating."); return 2
    survived = []
    for fname, old, new, why in MUTATIONS:
        path = ROOT / "src" / "core" / fname
        src = path.read_text()
        if src.count(old) != 1:
            print(f"SKIP   {fname}: pattern for '{why}' found {src.count(old)} times"); survived.append(why); continue
        path.write_text(src.replace(old, new))
        try:
            code = suite()
        finally:
            path.write_text(src)
        status = "caught " if code != 0 else "SURVIVED"
        print(f"{status} {fname}: {why}")
        if code == 0: survived.append(why)
    print(f"\n{len(MUTATIONS) - len(survived)}/{len(MUTATIONS)} mutations caught")
    return 1 if survived else 0

if __name__ == "__main__":
    sys.exit(main())
