#!/usr/bin/env python3
"""Mutation check: break the colour maths on purpose and confirm the tests notice.

Each mutation edits one line of src/core or src/state, runs the suite, and expects a failure. A mutation that survives means
a behaviour nothing tests. Run: python3 scripts/mutation_check.py
"""
import pathlib, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
MUTATIONS = [
    ("adjust.ts", "const ex = Math.pow(2, a.exposure);", "const ex = Math.pow(3, a.exposure);", "exposure is not one stop per step"),
    ("adjust.ts", "const p = Math.pow(2, (contrast / 100) * 1.1);", "const p = Math.pow(2, -(contrast / 100) * 1.1);", "contrast direction flipped"),
    ("adjust.ts", "x < 0.5 ? 0.5 * Math.pow(2 * x, p)", "x < 0.4 ? 0.5 * Math.pow(2 * x, p)", "contrast pivot moved off mid grey"),
    ("adjust.ts", "let rg = 1 + 0.5 * tt;", "let rg = 1 - 0.5 * tt;", "warm temperature makes red weaker"),
    ("adjust.ts", "let gg = 1 - 0.35 * tn;", "let gg = 1 + 0.35 * tn;", "tint direction flipped"),
    ("adjust.ts", "(a.shadows / 100) * 1.6 * ws", "(a.shadows / 100) * 1.6 * wh", "shadows slider moves the highlights"),
    ("adjust.ts", "(a.highlights / 100) * 1.0 * wh", "(a.highlights / 100) * 1.0 * ws", "highlights slider moves the shadows"),
    ("adjust.ts", "out[k] = (base[k] || 0) + (look[k] || 0) * s;", "out[k] = (base[k] || 0) + (look[k] || 0);", "look strength ignored"),
    ("analyze.ts", "if (bin <= 3) clipLo++;", "if (bin <= 30) clipLo++;", "shadow clipping threshold too loose"),
    ("analyze.ts", "if (r >= 253 || g >= 253 || b >= 253) clipHi++;", "if (r >= 253 && g >= 253 && b >= 253) clipHi++;", "clipping needs all channels"),
    ("analyze.ts", "const meanA = reliable ? castA / castW : 0;", "const meanA = reliable ? -castA / castW : 0;", "cast sign flipped"),
    ("analyze.ts", "const CAST_SIGMA = 60;", "const CAST_SIGMA = 1e9;", "cast ignores strongly coloured pixels no more"),
    ("suggest.ts", "const round = (v: number, step: number): number => Number((Math.round(v / step) * step).toFixed(2));", "const round = (v: number, step: number): number => v;", "fix values not rounded"),
    ("suggest.ts", "temperature: ((da * tintB - tintA * db) / det) * 100,", "temperature: ((da * tintB + tintA * db) / det) * 100,", "white balance solver ignores tint cross-talk"),
    ("suggest.ts", "if (f.fix) Object.assign(out, f.fix);", "if (false) Object.assign(out, f.fix);", "mergeFixes does nothing"),
    ("transfer.ts", "refStats.mean[0] - lab[0]", "refStats.mean[1] - lab[0]", "reference lightness taken from the wrong channel"),
    ("transfer.ts", "const MIN_RATIO = 0.6;", "const MIN_RATIO = 0.0001;", "spread ratio not clamped"),
    ("palette.ts", ".sort((x, y) => y.size - x.size)", ".sort((x, y) => x.size - y.size)", "palette not sorted by share"),
    ("image.ts", "const s = maxEdge / long;", "const s = (maxEdge / long) * 0.9;", "downscale misses its target size"),
    ("color.ts", "export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);", "export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v);", "clamp ignores the upper bound"),
    ("curves.ts", "if (s > 9) {", "if (s > 900) {", "spline can overshoot and double back"),
    ("curves.ts", "for (const s of active) { fns.push(makeSpline(s.rgb || IDENTITY)); fns.push(makeSpline(s[keys[c]] || IDENTITY)); }", "for (const s of active) { fns.push(makeSpline(s[keys[c]] || IDENTITY)); fns.push(makeSpline(s.rgb || IDENTITY)); }", "channel curve runs before the RGB curve"),
    ("curves.ts", "return points.map(([x, y]): CurvePoint => [x, x + (y - x) * s]);", "return points.map(([x, y]): CurvePoint => [x, y * s]);", "look curve strength blends toward black, not a straight line"),
    ("hsl.ts", "h = (h + dHue[k] + 360) % 360;", "h = (h - dHue[k] + 360) % 360;", "hue slider direction flipped"),
    ("hsl.ts", "s = clamp(s * dSat[k], 0, 1);", "s = clamp(s * (2 - dSat[k]), 0, 1);", "colour mix saturation direction flipped"),
    ("hsl.ts", "t = t * t * (3 - 2 * t);", "t = t >= 0.5 ? 1 : 0;", "colour families switch abruptly at their edges"),
    ("hsl.ts", "v = clamp(v * (1 + dLum[k] * (s * 2 < 1 ? s * 2 : 1)), 0, 1);", "v = clamp(v * (1 - dLum[k] * (s * 2 < 1 ? s * 2 : 1)), 0, 1);", "colour mix brightness direction flipped"),
    ("transfer.ts", "if (tN > 0) L = L0 + tN * (toneL[idx] - L0);", "if (tN > 0) L = L0 - tN * (toneL[idx] - L0);", "tone match moves away from the reference"),
    ("transfer.ts", "+ rA[idx] - a, -MAX_SHIFT, MAX_SHIFT);", "+ sA[idx] - a, -MAX_SHIFT, MAX_SHIFT);", "colour match ignores the reference colour"),
    ("transfer.ts", "const ys = isotonic(measured.map((m) => m[1]));", "const ys = measured.map((m) => m[1]);", "fitted curves can run backwards"),
    ("adjust.ts", "curvesAreIdentity(adj.lookCurves) && hslIsNeutral(adj.hsl)", "curvesAreIdentity(adj.lookCurves)", "a colour mix does not count as an edit"),
    ("history.ts", "this.stack.length = this.index + 1;", "", "editing after undo keeps stale redo steps"),
    ("history.ts", "if (top && top.signature === signature) return false;", "", "repeated identical states add undo steps"),
    ("history.ts", "if (this.stack.length > this.limit) this.stack.shift();", "", "history grows without a limit"),
    ("history.ts", "this.index--;\n    return this.stack[this.index].snap;", "this.index -= 2;\n    return this.stack[this.index].snap;", "undo skips a step"),
    ("hsl.ts", "const k = Math.min(HUE_STEPS - 1, (h * (HUE_STEPS / 360)) | 0);", "const k = 0;", "colour mix ignores the pixel's hue"),
    ("transfer.ts", "const idx = (L0 * (STEPS / 100) + 0.5) | 0;", "const idx = 500;", "match ignores each pixel's lightness"),
    ("mask.ts", "const a = 1 - smoothstep01(t);", "const a = smoothstep01(t);", "gradient fades the wrong way"),
    ("mask.ts", "const ry = (y + 0.5 - py) * dy;", "const ry = 0;", "gradient ignores the vertical direction"),
    ("mask.ts", "const px = m.x1 * w, py = m.y1 * h;", "const px = m.x1 * w, py = m.y1 * w;", "gradient mixes up width and height"),
    ("mask.ts", "const a = 1 - smoothstep01(t);\n      out[y * w + x] = inv ? 1 - a : a;", "const a = 1 - smoothstep01(t);\n      out[y * w + x] = a;", "invert does nothing"),
    ("mask.ts", "if (len2 < 1) { out.fill(inv); return out; }", "", "coinciding handles crash or give NaN"),
    ("mask.ts", "d[i] += (e[i] - d[i]) * a;", "d[i] += (e[i] - d[i]);", "mask strength ignored for red"),
    ("mask.ts", "const key = `${m.id}|${m.x1}|${m.y1}|${m.x2}|${m.y2}|${m.invert}|${w}x${h}`;", "const key = `${m.id}|${m.x1}|${m.y1}|${m.invert}|${w}x${h}`;", "alpha cache ignores the end handle"),
    ("mask.ts", "out[p] = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;", "out[p] = (0.2126 * d[i + 2] + 0.7152 * d[i + 1] + 0.0722 * d[i]) / 255;", "brightness weights red and blue the wrong way round"),
    ("mask.ts", "const rise = s > 0 ? smoothstep01((l - (lo - s)) / s) : (l >= lo ? 1 : 0);", "const rise = 1;", "brightness mask ignores its lower end"),
    ("mask.ts", "const fall = s > 0 ? 1 - smoothstep01((l - hi) / s) : (l <= hi ? 1 : 0);", "const fall = 1;", "brightness mask ignores its upper end"),
    ("mask.ts", "out[p] = inv ? 1 - a : a;\n  }\n  return out;\n}\n\n/** Remembers", "out[p] = a;\n  }\n  return out;\n}\n\n/** Remembers", "flip does nothing on a brightness mask"),
    ("mask.ts", "if (m.kind === 'range') throw new Error('AlphaCache holds masks that depend on position only');", "", "position cache accepts brightness masks"),
    ("mask.ts", "const a = 1 - smoothstep01((Math.sqrt(dx * dx + dy * dy) - (1 - f)) / f);", "const a = smoothstep01((Math.sqrt(dx * dx + dy * dy) - (1 - f)) / f);", "oval is strongest at the rim"),
    ("mask.ts", "const rx = Math.max(1, m.rx * w), ry = Math.max(1, m.ry * h);", "const rx = Math.max(1, m.rx * w), ry = Math.max(1, m.ry * w);", "oval height measured against the width"),
    ("mask.ts", "if (st.erase) for (let i = 0; i < out.length; i++) out[i] *= 1 - cover[i];", "if (st.erase) for (let i = 0; i < out.length; i++) out[i] += cover[i] - out[i] * cover[i];", "eraser paints instead of erasing"),
    ("mask.ts", "else for (let i = 0; i < out.length; i++) out[i] += cover[i] - out[i] * cover[i];", "else for (let i = 0; i < out.length; i++) out[i] += cover[i];", "overlapping paint overshoots 1"),
    ("mask.ts", "const gap = Math.max(1, R * 0.2);", "const gap = 1e9;", "a dragged stroke only paints its points"),
    ("mask.ts", "const R = Math.max(1, st.size * w);", "const R = Math.max(1, st.size * h);", "brush size depends on photo height"),
    ("mask.ts", "mix(t.erase ? 1 : 0);", "", "brush cache ignores erase strokes"),
    ("state/store.ts", "const draft = cloneSettings(this.state.settings);", "const draft = this.state.settings;", "edit changes the old state in place"),
    ("state/store.ts", "if (opts.commit) this.commit();", "if (opts.commit) { /* never commits */ }", "edit never records an undo step"),
    ("state/store.ts", "if (this.state.settings.masks.length >= MAX_MASKS) return;", "", "mask count not capped"),
    ("state/store.ts", "split: tab === 'masks' && this.state.split > 0 ? 0 : this.state.split", "split: this.state.split", "masks tab keeps the original on screen"),
    ("state/grade.ts", "if (!masksAreNeutral(s.masks)) out = applyMasks(out, s.masks, cache, bufs?.c);", "", "masks not applied"),
    ("state/grade.ts", "return look ? combine(s.adj, look.adj, s.lookStrength) : s.adj;", "return s.adj;", "look ignored"),
    ("chat/actions.ts", "adj[k] = roundTo(clamp(v, lo, hi), k === 'exposure' ? 0.05 : k === 'fade' ? 0.01 : 1);", "adj[k] = roundTo(v, k === 'exposure' ? 0.05 : k === 'fade' ? 0.01 : 1);", "assistant slider values not clamped to their ranges"),
    ("chat/actions.ts", "else if (typeof i.look === 'string' && LOOK_IDS.includes(i.look)) {", "else if (typeof i.look === 'string') {", "assistant can name a look that does not exist"),
    ("chat/actions.ts", "if (out.length >= MAX_ACTIONS) break;", "", "no limit on actions per reply"),
    ("chat/apply.ts", "if (next.masks.length >= MAX_MASKS) {", "if (false) {", "assistant can exceed the mask limit"),
    ("chat/apply.ts", "if (actions.some((a) => a.tool === 'undo')) return", "if (false) return", "undo from chat ignored"),
    ("chat/perform.ts", "if (changed) commitSettings(store, r.settings);", "", "chat edits never reach the editor"),
    ("chat/perform.ts", "if (store.getState().agent.ref) void engine.runAgent();", "void engine.runAgent();", "match runs without a reference"),
    ("chat/session.ts", "if (res.status === 429) {", "if (false) {", "daily limit falls back as if the server were down"),
    ("chat/session.ts", "const text = o.text.trim().slice(0, MAX_INPUT);", "const text = o.text.trim();", "chat input not cut to the limit"),
    ("../analytics-worker/src/handler.ts", "> (env.CHAT_PER_USER ?? 40)) return", "> 100000) return", "no per visitor daily chat limit"),
    ("../analytics-worker/src/handler.ts", "if (!env.model) return json({ error: 'chat is not set up' }, 503);", "", "chat answers even when no model is configured"),
    ("core/matchscore.ts", "100 * Math.max(0, 1 - distance / SCALE[id])", "100 * Math.max(0, 1 - distance * SCALE[id])", "dial score scale applied backwards"),
    ("core/matchscore.ts", "const SCALE: Record<DialId, number> = { brightness: 20,", "const SCALE: Record<DialId, number> = { brightness: 2000,", "brightness gap no longer lowers the score"),
    ("state/agent.ts", "const kept = changes.length > 0 && after >= before - tolerance;", "const kept = changes.length > 0;", "agent keeps steps that make the match worse"),
    ("state/agent.ts", "if (best < 0 || bestV < 20 || bestV < median * 2.5) return null;", "if (best < 0) return null;", "horizon found in flat photos"),
    ("state/agent.ts", "if (end < start * 0.9) improved = true; else draft.masks.pop();", "improved = true;", "region masks kept even when they do not help"),
    ("state/steer.ts", "const k = BIG.test(clause) ? 2 : SMALL.test(clause) ? 0.5 : 1;", "const k = 1;", "steering ignores much and slightly"),
]

def suite():
    files = sorted(str(p.relative_to(ROOT)) for p in (ROOT / "tests").glob("*.test.ts"))
    return subprocess.run(["node", "--test", *files], cwd=ROOT, capture_output=True, text=True).returncode

def main():
    if suite() != 0:
        print("The suite must pass before mutating."); return 2
    survived = []
    for fname, old, new, why in MUTATIONS:
        path = ROOT / fname[3:] if fname.startswith("../") else ROOT / "src" / (fname if "/" in fname else "core/" + fname)
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
