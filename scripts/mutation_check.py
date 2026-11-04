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
