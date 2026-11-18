// The tone curve editor. Pointer events cover mouse, touch and pen; arrow keys cover the keyboard.
// It draws and edits one channel at a time and reports changes through callbacks, so React only has to host the canvas.
import { makeSpline, identityCurves, CHANNELS } from '../core/curves.ts';
import type { Analysis } from '../core/analyze.ts';
import type { Channel, Curves } from '../core/types.ts';

const COLORS: Record<Channel, string> = { rgb: '#ebe6da', r: '#e0766b', g: '#78c68b', b: '#78a6e8' };
const PAD = 14;
const MAX_POINTS = 12;
const MIN_GAP = 0.03;
const HIT = 24;           // CSS pixels around a point that count as grabbing it
const DOUBLE_TAP_MS = 320;

type Pt = [number, number];

export interface CurveEditorOptions {
  /** The curves to draw. Must not change anything. */
  read: () => Curves;
  /** The curves to edit in place; creates them first if the photo has none yet. */
  write: () => Curves;
  onChange: () => void;
  onCommit: () => void;
}

export class CurveEditor {
  private channel: Channel = 'rgb';
  private selected = 0;
  private drag: { id: number } | null = null;
  private lastTap = { t: 0, i: -1 };
  private hist: Analysis['hist'] | null = null;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly abort = new AbortController();

  private readonly canvas: HTMLCanvasElement;
  private readonly o: CurveEditorOptions;

  constructor(canvas: HTMLCanvasElement, o: CurveEditorOptions) {
    this.canvas = canvas;
    this.o = o;
    this.ctx = canvas.getContext('2d')!;
    const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void) =>
      canvas.addEventListener(type, fn, { signal: this.abort.signal });
    on('pointerdown', (e) => this.onDown(e));
    on('pointermove', (e) => this.onMove(e));
    on('pointerup', (e) => this.onEnd(e));
    on('pointercancel', (e) => this.onEnd(e));
    on('keydown', (e) => this.onKey(e));
    on('blur', () => this.draw());
    on('focus', () => this.draw());
  }

  dispose(): void { this.abort.abort(); }

  private get W() { return this.canvas.width; }
  private get H() { return this.canvas.height; }
  private toPx(x: number, y: number): [number, number] {
    return [PAD + x * (this.W - 2 * PAD), this.H - PAD - y * (this.H - 2 * PAD)];
  }
  private fromEvent(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    const cx = ((e.clientX - r.left) / r.width) * this.W, cy = ((e.clientY - r.top) / r.height) * this.H;
    return { x: (cx - PAD) / (this.W - 2 * PAD), y: 1 - (cy - PAD) / (this.H - 2 * PAD), scale: this.W / r.width };
  }
  private points(): Pt[] { return this.o.write()[this.channel] as Pt[]; }
  private emit(commit = false): void { this.o.onChange(); this.draw(); if (commit) this.o.onCommit(); }

  draw(): void {
    const { ctx } = this;
    const w = this.W, h = this.H;
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = 1;
    const channel = this.channel;
    // histogram behind the lines, like Lightroom
    if (this.hist) {
      const arr = channel === 'rgb' ? this.hist.luma : this.hist[channel];
      const sorted = Array.from(arr).sort((a, b) => a - b);
      const peak = Math.max(sorted[Math.floor(sorted.length * 0.985)] * 1.3, 1e-4);
      ctx.beginPath();
      ctx.moveTo(PAD, h - PAD);
      for (let i = 0; i < 256; i++) {
        const [px] = this.toPx(i / 255, 0);
        const py = h - PAD - Math.min(1, arr[i] / peak) * (h - 2 * PAD) * 0.85;
        ctx.lineTo(px, py);
      }
      ctx.lineTo(w - PAD, h - PAD);
      ctx.closePath();
      ctx.fillStyle = channel === 'rgb' ? 'rgba(235,230,218,0.16)' : COLORS[channel] + '38';
      ctx.fill();
    }
    ctx.strokeStyle = '#33322e';
    for (let i = 0; i <= 4; i++) {
      const [x] = this.toPx(i / 4, 0), [, y] = this.toPx(0, i / 4);
      ctx.beginPath(); ctx.moveTo(x, PAD); ctx.lineTo(x, h - PAD); ctx.moveTo(PAD, y); ctx.lineTo(w - PAD, y); ctx.stroke();
    }
    ctx.setLineDash([6, 6]); ctx.strokeStyle = '#4a4943';
    const [x0, y0] = this.toPx(0, 0), [x1, y1] = this.toPx(1, 1);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); ctx.setLineDash([]);

    const curves = this.o.read();
    const line = (pts: Curves[Channel], color: string, width: number, alpha: number) => {
      const f = makeSpline(pts);
      ctx.beginPath();
      for (let i = 0; i <= 200; i++) { const [px, py] = this.toPx(i / 200, f(i / 200)); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
      ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke(); ctx.globalAlpha = 1;
    };
    for (const k of CHANNELS) if (k !== channel) line(curves[k], COLORS[k], 2, k === 'rgb' ? 0.35 : 0.45);
    line(curves[channel], COLORS[channel], 3.5, 1);
    curves[channel].forEach(([x, y], i) => {
      const [px, py] = this.toPx(x, y);
      ctx.beginPath(); ctx.arc(px, py, i === this.selected ? 11 : 8, 0, Math.PI * 2);
      ctx.fillStyle = '#121211'; ctx.fill();
      ctx.lineWidth = i === this.selected ? 4 : 3; ctx.strokeStyle = COLORS[channel]; ctx.stroke();
    });
  }

  private nearest(pos: { x: number; y: number; scale: number }): number {
    const pts = this.points();
    let best = -1, bd = Infinity;
    pts.forEach(([x, y], i) => {
      const d = Math.hypot((x - pos.x) * (this.W - 2 * PAD), (y - pos.y) * (this.H - 2 * PAD)) / pos.scale;
      if (d < bd) { bd = d; best = i; }
    });
    return bd <= HIT ? best : -1;
  }

  private move(i: number, x: number, y: number): void {
    const pts = this.points();
    const last = pts.length - 1;
    const lo = i === 0 ? 0 : pts[i - 1][0] + MIN_GAP;
    const hi = i === last ? 1 : pts[i + 1][0] - MIN_GAP;
    pts[i][0] = i === 0 ? 0 : i === last ? 1 : Math.min(hi, Math.max(lo, x));
    pts[i][1] = Math.min(1, Math.max(0, y));
  }

  private remove(i: number): void {
    const pts = this.points();
    if (i <= 0 || i >= pts.length - 1) return;
    pts.splice(i, 1);
    this.selected = Math.min(this.selected, pts.length - 1);
  }

  private onDown(e: PointerEvent): void {
    this.canvas.focus({ preventScroll: true });
    const pos = this.fromEvent(e);
    let i = this.nearest(pos);
    const now = performance.now();
    if (i >= 0 && this.lastTap.i === i && now - this.lastTap.t < DOUBLE_TAP_MS) {
      this.remove(i); this.lastTap = { t: 0, i: -1 }; e.preventDefault(); this.emit(true); return;
    }
    if (i < 0) {
      const pts = this.points();
      if (pts.length >= MAX_POINTS) return;
      if (pos.x <= MIN_GAP || pos.x >= 1 - MIN_GAP) return;
      if (pts.some((p) => Math.abs(p[0] - pos.x) < MIN_GAP)) return;
      pts.push([pos.x, Math.min(1, Math.max(0, pos.y))]);
      pts.sort((a, b) => a[0] - b[0]);
      i = pts.findIndex((p) => p[0] === pos.x);
    }
    this.selected = i;
    this.lastTap = { t: now, i };
    this.drag = { id: e.pointerId };
    this.canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
    this.emit();
  }

  private onMove(e: PointerEvent): void {
    if (!this.drag || e.pointerId !== this.drag.id) return;
    const pos = this.fromEvent(e);
    this.move(this.selected, pos.x, pos.y);
    this.lastTap.t = 0; // a drag is not a tap
    this.emit();
  }

  private onEnd(e: PointerEvent): void {
    if (this.drag && e.pointerId === this.drag.id) { this.drag = null; this.o.onCommit(); }
  }

  private onKey(e: KeyboardEvent): void {
    const pts = this.points();
    const step = e.shiftKey ? 0.05 : 0.01;
    this.selected = Math.min(this.selected, pts.length - 1);   // undo can leave the old selection past the end
    const p = pts[this.selected];
    if (e.key === 'ArrowUp') this.move(this.selected, p[0], p[1] + step);
    else if (e.key === 'ArrowDown') this.move(this.selected, p[0], p[1] - step);
    else if (e.key === 'ArrowLeft') this.move(this.selected, p[0] - step, p[1]);
    else if (e.key === 'ArrowRight') this.move(this.selected, p[0] + step, p[1]);
    else if (e.key === ']' || e.key === 'PageDown') this.selected = Math.min(pts.length - 1, this.selected + 1);
    else if (e.key === '[' || e.key === 'PageUp') this.selected = Math.max(0, this.selected - 1);
    else if (e.key === 'Delete' || e.key === 'Backspace') this.remove(this.selected);
    else return;
    e.preventDefault();
    this.emit(true);
  }

  setChannel(c: Channel): void { this.channel = c; this.selected = 0; this.draw(); }
  setHistogram(h: Analysis['hist'] | null): void { this.hist = h; this.draw(); }
  resetChannel(): void { this.o.write()[this.channel] = identityCurves()[this.channel]; this.selected = 0; this.emit(true); }
  resetAll(): void {
    const c = this.o.write(), id = identityCurves();
    for (const k of CHANNELS) c[k] = id[k];
    this.selected = 0; this.emit(true);
  }
}
