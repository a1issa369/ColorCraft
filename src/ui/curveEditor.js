// The tone curve editor. Pointer events cover mouse, touch and pen; arrow keys cover the keyboard.
import { makeSpline, identityCurves, cloneCurves, CHANNELS } from '../core/curves.js';

const COLORS = { rgb: '#ebe6da', r: '#e0766b', g: '#78c68b', b: '#78a6e8' };
const PAD = 14;
const MAX_POINTS = 12;
const MIN_GAP = 0.03;
const HIT = 24;           // CSS pixels around a point that count as grabbing it
const DOUBLE_TAP_MS = 320;

export function createCurveEditor(canvas, { getCurves, onChange, onCommit = () => {} }) {
  let channel = 'rgb';
  let selected = 0;
  let drag = null;
  let lastTap = { t: 0, i: -1 };
  let hist = null;

  const ctx = canvas.getContext('2d');
  const W = () => canvas.width, H = () => canvas.height;
  const toPx = (x, y) => [PAD + x * (W() - 2 * PAD), H() - PAD - y * (H() - 2 * PAD)];
  const fromEvent = (e) => {
    const r = canvas.getBoundingClientRect();
    const cx = ((e.clientX - r.left) / r.width) * W(), cy = ((e.clientY - r.top) / r.height) * H();
    return { x: (cx - PAD) / (W() - 2 * PAD), y: 1 - (cy - PAD) / (H() - 2 * PAD), scale: W() / r.width };
  };
  const points = () => { const c = getCurves(); return c[channel]; };
  const emit = (commit = false) => { onChange(); draw(); if (commit) onCommit(); };

  function draw() {
    const w = W(), h = H();
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = 1;
    // histogram behind the lines, like Lightroom
    if (hist) {
      const arr = channel === 'rgb' ? hist.luma : hist[channel];
      const sorted = Array.from(arr).sort((a, b) => a - b);
      const peak = Math.max(sorted[Math.floor(sorted.length * 0.985)] * 1.3, 1e-4);
      ctx.beginPath();
      ctx.moveTo(PAD, h - PAD);
      for (let i = 0; i < 256; i++) {
        const [px] = toPx(i / 255, 0);
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
      const [x] = toPx(i / 4, 0), [, y] = toPx(0, i / 4);
      ctx.beginPath(); ctx.moveTo(x, PAD); ctx.lineTo(x, h - PAD); ctx.moveTo(PAD, y); ctx.lineTo(w - PAD, y); ctx.stroke();
    }
    ctx.setLineDash([6, 6]); ctx.strokeStyle = '#4a4943';
    const [x0, y0] = toPx(0, 0), [x1, y1] = toPx(1, 1);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); ctx.setLineDash([]);

    const curves = getCurves();
    const line = (pts, color, width, alpha) => {
      const f = makeSpline(pts);
      ctx.beginPath();
      for (let i = 0; i <= 200; i++) { const [px, py] = toPx(i / 200, f(i / 200)); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
      ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke(); ctx.globalAlpha = 1;
    };
    for (const k of CHANNELS) if (k !== channel) line(curves[k], COLORS[k], 2, k === 'rgb' ? 0.35 : 0.45);
    line(curves[channel], COLORS[channel], 3.5, 1);
    curves[channel].forEach(([x, y], i) => {
      const [px, py] = toPx(x, y);
      ctx.beginPath(); ctx.arc(px, py, i === selected ? 11 : 8, 0, Math.PI * 2);
      ctx.fillStyle = '#121211'; ctx.fill();
      ctx.lineWidth = i === selected ? 4 : 3; ctx.strokeStyle = COLORS[channel]; ctx.stroke();
    });
  }

  function nearest(pos) {
    const pts = points();
    let best = -1, bd = Infinity;
    pts.forEach(([x, y], i) => { const d = Math.hypot((x - pos.x) * (W() - 2 * PAD), (y - pos.y) * (H() - 2 * PAD)) / pos.scale; if (d < bd) { bd = d; best = i; } });
    return bd <= HIT ? best : -1;
  }

  function move(i, x, y) {
    const pts = points();
    const last = pts.length - 1;
    const lo = i === 0 ? 0 : pts[i - 1][0] + MIN_GAP;
    const hi = i === last ? 1 : pts[i + 1][0] - MIN_GAP;
    pts[i][0] = i === 0 ? 0 : i === last ? 1 : Math.min(hi, Math.max(lo, x));
    pts[i][1] = Math.min(1, Math.max(0, y));
  }

  function remove(i) {
    const pts = points();
    if (i <= 0 || i >= pts.length - 1) return;
    pts.splice(i, 1);
    selected = Math.min(selected, pts.length - 1);
  }

  canvas.addEventListener('pointerdown', (e) => {
    canvas.focus({ preventScroll: true });
    const pos = fromEvent(e);
    let i = nearest(pos);
    const now = performance.now();
    if (i >= 0 && lastTap.i === i && now - lastTap.t < DOUBLE_TAP_MS) {
      remove(i); lastTap = { t: 0, i: -1 }; e.preventDefault(); emit(true); return;
    }
    if (i < 0) {
      const pts = points();
      if (pts.length >= MAX_POINTS) return;
      if (pos.x <= MIN_GAP || pos.x >= 1 - MIN_GAP) return;
      if (pts.some((p) => Math.abs(p[0] - pos.x) < MIN_GAP)) return;
      pts.push([pos.x, Math.min(1, Math.max(0, pos.y))]);
      pts.sort((a, b) => a[0] - b[0]);
      i = pts.findIndex((p) => p[0] === pos.x);
    }
    selected = i;
    lastTap = { t: now, i };
    drag = { id: e.pointerId };
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
    emit();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const pos = fromEvent(e);
    move(selected, pos.x, pos.y);
    lastTap.t = 0; // a drag is not a tap
    emit();
  });
  const end = (e) => { if (drag && e.pointerId === drag.id) { drag = null; onCommit(); } };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  canvas.addEventListener('keydown', (e) => {
    const pts = points();
    const step = e.shiftKey ? 0.05 : 0.01;
    const p = pts[selected];
    if (e.key === 'ArrowUp') move(selected, p[0], p[1] + step);
    else if (e.key === 'ArrowDown') move(selected, p[0], p[1] - step);
    else if (e.key === 'ArrowLeft') move(selected, p[0] - step, p[1]);
    else if (e.key === 'ArrowRight') move(selected, p[0] + step, p[1]);
    else if (e.key === ']' || e.key === 'PageDown') selected = Math.min(pts.length - 1, selected + 1);
    else if (e.key === '[' || e.key === 'PageUp') selected = Math.max(0, selected - 1);
    else if (e.key === 'Delete' || e.key === 'Backspace') remove(selected);
    else return;
    e.preventDefault();
    emit(true);
  });
  canvas.addEventListener('blur', draw);
  canvas.addEventListener('focus', draw);

  return {
    draw,
    setChannel(c) { channel = c; selected = 0; draw(); },
    setHistogram(h) { hist = h; draw(); },
    resetChannel() { const c = getCurves(); c[channel] = identityCurves()[channel]; selected = 0; emit(true); },
    resetAll() { const c = getCurves(); const id = identityCurves(); for (const k of CHANNELS) c[k] = id[k]; selected = 0; emit(true); },
  };
}
