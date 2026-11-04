// Small canvas drawings: the brightness histogram and the colour scope.
import { CHROMA_GRID, CHROMA_RANGE } from '../core/analyze.js';

const C = { line: '#33322e', text: '#ebe6da', muted: '#a39e92', accent: '#7fb8a8', warn: '#d79a62' };

export function drawHistogram(canvas, stats) {
  const ctx = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo((w * i) / 4, 0); ctx.lineTo((w * i) / 4, h); ctx.stroke(); }
  const channels = [['r', 'rgba(215,110,100,0.8)'], ['g', 'rgba(110,190,130,0.8)'], ['b', 'rgba(110,150,215,0.8)']];
  // Smooth the bins a little and scale by a high percentile so one spike does not flatten everything else.
  const smooth = (arr) => Array.from(arr, (_, i) => {
    let s = 0, c = 0;
    for (let k = -2; k <= 2; k++) { const v = arr[i + k]; if (v !== undefined) { s += v; c++; } }
    return s / c;
  });
  const sorted = Array.from(stats.hist.luma).sort((a, b) => a - b);
  const peak = Math.max(sorted[Math.floor(sorted.length * 0.985)] * 1.4, 1e-4);
  const path = (arr) => {
    ctx.beginPath();
    arr.forEach((v, i) => { const x = (i / 255) * w, y = h - Math.min(1, v / peak) * (h - 4); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  };
  for (const [k, col] of channels) { path(smooth(stats.hist[k])); ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.stroke(); }
  const luma = smooth(stats.hist.luma);
  path(luma);
  ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
  ctx.fillStyle = 'rgba(235,230,218,0.22)'; ctx.fill();
  path(luma); ctx.strokeStyle = C.text; ctx.lineWidth = 1.6; ctx.stroke();
}

export function drawScope(canvas, stats) {
  const ctx = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  const cx = w / 2, cy = h / 2, R = w / 2 - 6;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = C.line; ctx.lineWidth = 1;
  for (const f of [1, 0.66, 0.33]) { ctx.beginPath(); ctx.arc(cx, cy, R * f, 0, Math.PI * 2); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
  const grid = stats.chromaGrid;
  let max = 0;
  for (const v of grid) if (v > max) max = v;
  const cell = (2 * R) / CHROMA_GRID;
  for (let gy = 0; gy < CHROMA_GRID; gy++) {
    for (let gx = 0; gx < CHROMA_GRID; gx++) {
      const v = grid[gy * CHROMA_GRID + gx];
      if (!v) continue;
      const a = ((gx + 0.5) / CHROMA_GRID) * 2 * CHROMA_RANGE - CHROMA_RANGE;
      const b = ((gy + 0.5) / CHROMA_GRID) * 2 * CHROMA_RANGE - CHROMA_RANGE;
      const x = cx + (a / CHROMA_RANGE) * R, y = cy - (b / CHROMA_RANGE) * R;
      ctx.globalAlpha = 0.25 + 0.75 * Math.sqrt(v / max);
      ctx.fillStyle = C.text;
      ctx.fillRect(x - cell / 2, y - cell / 2, cell, cell);
    }
  }
  ctx.globalAlpha = 1;
  if (stats.cast.reliable && stats.cast.magnitude >= 3) {
    const x = cx + (stats.cast.a / CHROMA_RANGE) * R, y = cy - (stats.cast.b / CHROMA_RANGE) * R;
    ctx.strokeStyle = C.warn; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke();
    ctx.fillStyle = C.warn; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
  }
}
