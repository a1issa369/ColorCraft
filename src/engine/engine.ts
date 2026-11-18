// The render engine. It owns the canvases and pixel buffers and redraws the photo whenever the store changes.
// It lives outside React on purpose: a slider drag fires dozens of changes a second, and the photo must keep up.
import { applyAdjustments, makeAdjustments } from '../core/adjust.ts';
import type { Adjustments } from '../core/adjust.ts';
import { analyze } from '../core/analyze.ts';
import { cloneCurves, composePoints } from '../core/curves.ts';
import { downscale } from '../core/image.ts';
import { AlphaCache, lumaMap, rangeAlpha } from '../core/mask.ts';
import { dominantColors } from '../core/palette.ts';
import { autoGrade, diagnose } from '../core/suggest.ts';
import type { Finding } from '../core/suggest.ts';
import { fitCurves, lookProfile, matchLook } from '../core/transfer.ts';
import type { Curves, Img } from '../core/types.ts';
import { effectiveAdj, gradeImage, makeBuffers } from '../state/grade.ts';
import type { Buffers } from '../state/grade.ts';
import type { EditorStore } from '../state/store.ts';
import type { EditorState, RefMatch } from '../state/types.ts';
import { closeDrawable, decodeFile, paint, toImage } from './media.ts';
import type { Drawable } from './media.ts';

const WORK_EDGE = 1280;
const DRAFT_EDGE = 512;     // size used while a slider or curve is moving
const SETTLE_MS = 180;      // quiet time before the full size render
const EXPORT_EDGE = 4000;
const TINT_W = 360;

const canvas = () => document.createElement('canvas');

export class Engine {
  private source: Drawable | null = null;   // the photo at full size
  private work: Img | null = null;          // downscaled copy used for the live preview
  private workSmall: Img | null = null;     // smaller copy used while dragging, so sliders stay smooth
  private bufFull: Buffers | null = null;
  private bufDraft: Buffers | null = null;
  private readonly orig = canvas();         // the ungraded photo, for the left side of the compare
  private readonly grad = canvas();         // the graded photo at preview size
  private readonly gradSmall = canvas();    // the graded draft
  private readonly renderCache = new AlphaCache(8);    // mask strength maps, so a drag does not rebuild them every frame
  private readonly overlayCache = new AlphaCache(4);
  private view: HTMLCanvasElement | null = null;
  private tint: HTMLCanvasElement | null = null;
  private tintImg: ImageData | null = null;
  private dirty = false;
  private raf = 0;
  private lastInput = -1e9;
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  private shownDraft = false;
  private prev: EditorState;
  private readonly unsubscribe: () => void;

  private readonly store: EditorStore;

  constructor(store: EditorStore) {
    this.store = store;
    this.prev = store.getState();
    this.unsubscribe = store.subscribe(() => this.onStore());
  }

  dispose(): void {
    this.unsubscribe();
    cancelAnimationFrame(this.raf);
    clearTimeout(this.settleTimer);
    closeDrawable(this.source);
  }

  /** Width over height of the open photo, used to size the stage. */
  get aspect(): number { return this.work ? this.work.width / this.work.height : 1.5; }

  /** The photo shrunk to `maxEdge`, for look thumbnails and swatches. */
  thumbSource(maxEdge: number): Img | null { return this.work ? downscale(this.work, maxEdge) : null; }

  // ---- connecting to the page ----
  attach(view: HTMLCanvasElement, tint: HTMLCanvasElement): void {
    this.view = view; this.tint = tint;
    this.sizeCanvases();
    this.touch();
  }
  detach(): void { this.view = null; this.tint = null; }

  private sizeCanvases(): void {
    if (!this.work || !this.view) return;
    this.view.width = this.work.width; this.view.height = this.work.height;
  }

  /** Forget the open photo (the one on screen is replaced or the person went back to the start). */
  unload(): void { this.work = null; this.workSmall = null; this.bufFull = this.bufDraft = null; }

  // ---- loading ----
  async openFile(file: File): Promise<void> {
    try {
      this.load(await decodeFile(file));
    } catch (e) {
      this.store.setError(e instanceof Error ? e.message : String(e));
    }
  }

  load(drawable: Drawable): void {
    // Release the previous photo's decoded pixels now instead of waiting for the browser to get around to it.
    if (this.source && this.source !== drawable) closeDrawable(this.source);
    this.source = drawable;
    const work = toImage(drawable, WORK_EDGE);
    this.work = work;
    this.workSmall = downscale(work, DRAFT_EDGE);
    this.bufFull = makeBuffers(work);
    this.bufDraft = this.workSmall === work ? this.bufFull : makeBuffers(this.workSmall);
    this.gradSmall.width = this.workSmall.width; this.gradSmall.height = this.workSmall.height;
    this.grad.width = work.width; this.grad.height = work.height;
    paint(this.orig, work);
    this.renderCache.clear(); this.overlayCache.clear();
    this.sizeCanvases();
    this.store.openPhoto(diagnose(analyze(downscale(work, 320))));
    this.touch();
  }

  // ---- things the panels ask for ----
  /** Suggested adjustments for this photo, keeping the user's curves and colour mix. */
  autoGrade(adj: Adjustments): Adjustments {
    return this.work ? autoGrade(this.work, makeAdjustments({ curves: adj.curves, hsl: adj.hsl })) : adj;
  }

  /** Read a reference photo and learn its grade. */
  async makeReference(file: File): Promise<RefMatch> {
    const bmp = await decodeFile(file);
    const img = toImage(bmp, 320);
    closeDrawable(bmp);
    const th = downscale(img, 120);
    return {
      id: this.store.nextRefId(), profile: lookProfile(img), color: 0.8, tone: 0.5,
      thumb: { width: th.width, height: th.height, data: new Uint8ClampedArray(th.data) },
      swatches: dominantColors(img, 5),
    };
  }

  /** Turn the live reference match into editable Red, Green and Blue curves, added on top of the current ones. */
  bakeReference(): Curves | null {
    const { settings } = this.store.getState();
    if (!this.work || !settings.ref) return null;
    const before = applyAdjustments(this.work, effectiveAdj(settings));
    const after = matchLook(before, lookProfile(before), settings.ref.profile, { tone: settings.ref.tone, color: settings.ref.color });
    const fitted = fitCurves(before, after);
    const cur = cloneCurves(settings.adj.curves);
    for (const k of ['r', 'g', 'b'] as const) cur[k] = composePoints(cur[k], fitted[k]);
    return cur;
  }

  /** The graded photo at up to 4000px, as a JPEG. */
  async exportJpeg(): Promise<Blob> {
    if (!this.source) throw new Error('No photo is open.');
    const full = toImage(this.source, EXPORT_EDGE);
    const g = gradeImage(full, this.store.getState().settings, new AlphaCache(1), makeBuffers(full));
    const c = canvas();
    paint(c, g);
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', 0.92));
    if (!blob) throw new Error('This browser could not save the photo.');
    return blob;
  }

  // ---- drawing ----
  private onStore(): void {
    const s = this.store.getState();
    const p = this.prev;
    this.prev = s;
    if (!this.work) return;
    if (s.settings !== p.settings) this.touch();
    else if (s.split !== p.split || s.hold !== p.hold || s.tab !== p.tab || s.maskArea !== p.maskArea) this.schedule();
  }

  /** Ask for a redraw. While things are still changing the preview is drawn smaller; a moment after the last change it is redrawn in full. */
  private touch(): void {
    this.dirty = true;
    this.lastInput = performance.now();
    clearTimeout(this.settleTimer);
    if (this.workSmall !== this.work) this.settleTimer = setTimeout(() => { this.dirty = true; this.schedule(); }, SETTLE_MS);
    this.schedule();
  }

  private schedule(): void { if (!this.raf) this.raf = requestAnimationFrame(() => this.frame()); }

  private frame(): void {
    this.raf = 0;
    const { work, workSmall } = this;
    if (!work || !workSmall || !this.view) return;
    if (this.dirty) {
      this.dirty = false;
      const draft = workSmall !== work && performance.now() - this.lastInput < SETTLE_MS - 20;
      const g = gradeImage(draft ? workSmall : work, this.store.getState().settings, this.renderCache, draft ? this.bufDraft! : this.bufFull!);
      paint(draft ? this.gradSmall : this.grad, g);
      this.shownDraft = draft;
      this.store.setStats(analyze(downscale(g, draft ? 160 : 256)));
    }
    this.compose();
  }

  private compose(): void {
    const view = this.view;
    if (!view) return;
    const s = this.store.getState();
    const ctx = view.getContext('2d')!;
    const w = view.width, h = view.height;
    ctx.drawImage(this.shownDraft ? this.gradSmall : this.grad, 0, 0, w, h);
    const split = s.hold ? 1 : s.split;
    if (split > 0) {
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, w * split, h); ctx.clip();
      ctx.drawImage(this.orig, 0, 0);
      ctx.restore();
    }
    this.drawTint(s);
  }

  /** Red tint over the area the selected mask covers, and a dashed guide between its two handles. */
  private drawTint(s: EditorState): void {
    const tint = this.tint, view = this.view;
    if (!tint || !view) return;
    const m = s.tab === 'masks' ? s.settings.masks.find((x) => x.id === s.settings.maskSel) : undefined;
    const show = !!m && s.maskArea && !s.hold;
    tint.hidden = !show;
    if (!m || !show) return;
    const w = TINT_W, h = Math.max(1, Math.round((TINT_W * view.height) / view.width));
    if (tint.width !== w || tint.height !== h) { tint.width = w; tint.height = h; this.tintImg = null; }
    const ctx = tint.getContext('2d')!;
    if (!this.tintImg) {
      this.tintImg = ctx.createImageData(w, h);
      for (let i = 0; i < this.tintImg.data.length; i += 4) { this.tintImg.data[i] = 220; this.tintImg.data[i + 1] = 70; this.tintImg.data[i + 2] = 70; }
    }
    const d = this.tintImg.data;
    if (m.kind === 'range') {
      const l = this.lumaForTint();
      if (!l) { tint.hidden = true; return; }
      const a = rangeAlpha(m, l.luma);
      for (let y = 0, i = 3; y < h; y++) {
        const row = Math.min(l.h - 1, Math.floor((y * l.h) / h)) * l.w;
        for (let x = 0; x < w; x++, i += 4) d[i] = a[row + Math.min(l.w - 1, Math.floor((x * l.w) / w))] * 150;
      }
      ctx.putImageData(this.tintImg, 0, 0);
      return;
    }
    const a = this.overlayCache.get(m, w, h);
    for (let p = 0, i = 3; p < a.length; p++, i += 4) d[i] = a[p] * 150;
    ctx.putImageData(this.tintImg, 0, 0);
    ctx.save();
    ctx.strokeStyle = 'rgba(235,230,218,.9)'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.moveTo(m.x1 * w, m.y1 * h); ctx.lineTo(m.x2 * w, m.y2 * h); ctx.stroke();
    ctx.restore();
  }

  private lumaKey = '';
  private lumaCache: { luma: Float32Array; w: number; h: number } | null = null;
  /** Brightness of the small preview as graded without any masks, which is what a brightness mask picks from. Recomputed only when a non-mask edit changes. */
  private lumaForTint(): { luma: Float32Array; w: number; h: number } | null {
    const small = this.workSmall, bufs = this.bufDraft;
    if (!small || !bufs) return null;
    const st = this.store.getState();
    const g = st.settings;
    const key = `${st.photoId}|${JSON.stringify([g.adj, g.look, g.lookStrength, g.ref && [g.ref.id, g.ref.tone, g.ref.color]])}`;
    if (key !== this.lumaKey || !this.lumaCache) {
      const img = gradeImage(small, { ...g, masks: [] }, this.overlayCache, bufs);
      this.lumaCache = { luma: lumaMap(img), w: img.width, h: img.height };
      this.lumaKey = key;
    }
    return this.lumaCache;
  }
}

