import { makeAdjustments, combine, applyAdjustments, DEFAULTS } from './core/adjust.js';
import { identityCurves, cloneCurves, composePoints, curvesAreIdentity } from './core/curves.js';
import { BANDS, makeHsl, cloneHsl, hslIsNeutral } from './core/hsl.js';
import { analyze } from './core/analyze.js';
import { diagnose, autoGrade } from './core/suggest.js';
import { downscale } from './core/image.js';
import { LOOKS, LOOK_GROUPS, lookById } from './core/looks.js';
import { lookProfile, matchLook, fitCurves } from './core/transfer.js';
import { dominantColors } from './core/palette.js';
import { SAMPLES, renderSample } from './core/samples.js';
import { drawHistogram, drawScope } from './ui/draw.js';
import { createCurveEditor } from './ui/curveEditor.js';
import { CONTROLS } from './ui/teach.js';

const WORK_EDGE = 1280;
const EXPORT_EDGE = 4000;
const $ = (id) => document.getElementById(id);

const state = {
  source: null,        // drawable (ImageBitmap or canvas) at full size
  work: null,          // downscaled image used for the live preview
  adj: makeAdjustments(),
  look: null,
  lookStrength: 1,
  ref: null,           // { profile, tone, color }
  findings: [],
  split: 0.5,
  hold: false,
  tab: 'read',
};

// ---------- loading ----------
function toImage(drawable, maxEdge) {
  const w0 = drawable.width, h0 = drawable.height;
  const s = Math.min(1, maxEdge / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * s)), h = Math.max(1, Math.round(h0 * s));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(drawable, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h);
  return { width: w, height: h, data: d.data };
}

async function decodeFile(file) {
  if (!file || !file.type.startsWith('image/')) throw new Error('That file is not an image. Try a JPEG, PNG or WebP photo.');
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This browser could not open that photo. HEIC files often fail; export a JPEG instead.')); };
      img.src = url;
    });
  }
}

function showError(msg) {
  let el = $('err');
  if (!el) {
    el = document.createElement('p');
    el.id = 'err'; el.className = 'hint'; el.setAttribute('role', 'alert'); el.style.color = 'var(--warn)';
    $('drop').appendChild(el);
  }
  el.textContent = msg;
}

async function openFile(file) {
  try {
    const bmp = await decodeFile(file);
    start(bmp, bmp.width, bmp.height);
  } catch (e) { showError(e.message); }
}

function imageToCanvas(img) {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  c.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
  return c;
}

function start(drawable) {
  state.source = drawable;
  state.work = toImage(drawable, WORK_EDGE);
  state.adj = makeAdjustments();
  state.look = null; state.lookStrength = 1; state.ref = null;
  state.split = 0.5;
  state.findings = diagnose(analyze(downscale(state.work, 320)));
  const err = $('err'); if (err) err.remove();
  $('empty').hidden = true; $('editor').hidden = false; $('new-photo').hidden = false;
  origCanvas.width = gradCanvas.width = view.width = state.work.width;
  origCanvas.height = gradCanvas.height = view.height = state.work.height;
  origCanvas.getContext('2d').putImageData(new ImageData(state.work.data, state.work.width, state.work.height), 0, 0);
  const ratio = state.work.width / state.work.height;
  $('stage').style.width = `min(100%, calc(var(--maxh) * ${ratio.toFixed(4)}))`;
  buildLooks(); buildOwnSwatches(); syncSliders(); syncMix(); renderFindings(); syncLookUi(); syncRefUi(); curveEditor.draw();
  setTab('read');
  dirty = true; schedule();
  window.scrollTo({ top: 0 });
}

// ---------- rendering ----------
const view = $('view');
const origCanvas = document.createElement('canvas');
const gradCanvas = document.createElement('canvas');
let dirty = false, raf = 0;

function effectiveAdj() {
  const look = lookById(state.look);
  return look ? combine(state.adj, look.adj, state.lookStrength) : state.adj;
}

function gradeImage(img) {
  let out = applyAdjustments(img, effectiveAdj());
  if (state.ref && (state.ref.tone > 0 || state.ref.color > 0)) {
    out = matchLook(out, lookProfile(out), state.ref.profile, { tone: state.ref.tone, color: state.ref.color });
  }
  return out;
}

function schedule() { if (!raf) raf = requestAnimationFrame(frame); }

function frame() {
  raf = 0;
  if (!state.work) return;
  if (dirty) {
    dirty = false;
    const g = gradeImage(state.work);
    gradCanvas.getContext('2d').putImageData(new ImageData(g.data, g.width, g.height), 0, 0);
    const stats = analyze(downscale(g, 256));
    drawHistogram($('hist'), stats);
    drawScope($('scope'), stats);
    curveEditor.setHistogram(stats.hist);
  }
  compose();
}

function compose() {
  const ctx = view.getContext('2d');
  const w = view.width, h = view.height;
  ctx.drawImage(gradCanvas, 0, 0);
  const s = state.hold ? 1 : state.split;
  if (s > 0) {
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, w * s, h); ctx.clip();
    ctx.drawImage(origCanvas, 0, 0);
    ctx.restore();
  }
  const hd = $('handle');
  hd.style.left = `${s * 100}%`;
  hd.hidden = state.hold;
  hd.setAttribute('aria-valuenow', String(Math.round(s * 100)));
}

// ---------- compare handle ----------
const handle = $('handle'), stage = $('stage');
function moveHandle(ev) {
  const r = stage.getBoundingClientRect();
  state.split = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
  schedule();
}
handle.addEventListener('pointerdown', (e) => { handle.setPointerCapture(e.pointerId); handle.dragging = true; e.preventDefault(); });
handle.addEventListener('pointermove', (e) => { if (handle.dragging) moveHandle(e); });
const endDrag = () => { handle.dragging = false; };
handle.addEventListener('pointerup', endDrag);
handle.addEventListener('pointercancel', endDrag);
handle.addEventListener('keydown', (e) => {
  const step = e.shiftKey ? 0.2 : 0.05;
  if (e.key === 'ArrowLeft') state.split = Math.max(0, state.split - step);
  else if (e.key === 'ArrowRight') state.split = Math.min(1, state.split + step);
  else if (e.key === 'Home') state.split = 0;
  else if (e.key === 'End') state.split = 1;
  else return;
  e.preventDefault(); schedule();
});

const holdBtn = $('hold');
const setHold = (v) => { state.hold = v; holdBtn.setAttribute('aria-pressed', String(v)); schedule(); };
holdBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); setHold(true); });
for (const t of ['pointerup', 'pointerleave', 'pointercancel']) holdBtn.addEventListener(t, () => setHold(false));
holdBtn.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setHold(true); } });
holdBtn.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') setHold(false); });
holdBtn.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- tabs ----------
function setTab(name) {
  state.tab = name;
  for (const b of document.querySelectorAll('#tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === name));
  for (const p of document.querySelectorAll('.pane')) p.hidden = p.id !== `pane-${name}`;
  if (name === 'curves' && window.matchMedia('(max-width: 899px)').matches) {
    // On phones the photo is pinned to the top; bring the curve into the space under it.
    document.documentElement.style.setProperty('--sticky-h', `${document.querySelector('.stage-col').offsetHeight}px`);
    $('curve-channels').scrollIntoView({ block: 'start' });
  }
}
$('tabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) setTab(b.dataset.tab); });
$('tabs').addEventListener('keydown', (e) => {
  const tabs = [...document.querySelectorAll('#tabs button')];
  const i = tabs.findIndex((b) => b.getAttribute('aria-selected') === 'true');
  const j = e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i + tabs.length - 1) % tabs.length : -1;
  if (j >= 0) { tabs[j].focus(); setTab(tabs[j].dataset.tab); e.preventDefault(); }
});

// ---------- sliders ----------
const sliderEls = {};
(function buildSliders() {
  const host = $('sliders');
  for (const c of CONTROLS) {
    const label = document.createElement('label');
    label.className = 'slider';
    const fmt = c.fmt || ((v) => (v > 0 ? '+' : '') + Math.round(v));
    label.innerHTML = `<span class="row"><b>${c.name}</b><output></output></span><input type="range" min="${c.min}" max="${c.max}" step="${c.step}"><small>${c.tip}</small>`;
    const input = label.querySelector('input'), out = label.querySelector('output');
    input.addEventListener('input', () => { state.adj[c.key] = Number(input.value); out.textContent = fmt(state.adj[c.key]); dirty = true; schedule(); });
    input.addEventListener('dblclick', () => { state.adj[c.key] = DEFAULTS[c.key]; syncSliders(); dirty = true; schedule(); });
    sliderEls[c.key] = { input, out, fmt };
    host.appendChild(label);
  }
})();
function syncSliders() {
  for (const c of CONTROLS) {
    const el = sliderEls[c.key];
    el.input.value = state.adj[c.key];
    el.out.textContent = el.fmt(state.adj[c.key]);
  }
}

// ---------- read tab ----------
const fixApplied = (f) => Object.keys(f.fix).every((k) => Math.abs(state.adj[k] - f.fix[k]) < 1e-6);
function renderFindings() {
  const ul = $('findings');
  ul.textContent = '';
  for (const f of state.findings) {
    const li = document.createElement('li');
    li.className = `finding${f.id === 'ok' ? ' ok' : ''}`;
    const h = document.createElement('h3'); h.textContent = f.title;
    const p = document.createElement('p'); p.textContent = f.detail;
    li.append(h, p);
    if (f.fix) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn';
      const done = fixApplied(f);
      b.textContent = done ? 'Applied' : 'Apply this fix';
      b.disabled = done;
      b.addEventListener('click', () => { Object.assign(state.adj, f.fix); syncSliders(); renderFindings(); dirty = true; schedule(); });
      li.appendChild(b);
    }
    ul.appendChild(li);
  }
}
$('fix-all').addEventListener('click', () => {
  state.adj = autoGrade(state.work, makeAdjustments({ curves: state.adj.curves, hsl: state.adj.hsl }));
  syncSliders(); renderFindings(); dirty = true; schedule();
});

// ---------- looks ----------
function buildLooks() {
  const host = $('looks');
  host.textContent = '';
  const thumb = downscale(state.work, 120);
  const mkTile = (l) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn look'; b.dataset.look = l.id || '';
    const c = document.createElement('canvas');
    const g = l.id ? applyAdjustments(thumb, combine(makeAdjustments(), l.adj, 1)) : thumb;
    c.width = g.width; c.height = g.height;
    c.getContext('2d').putImageData(new ImageData(g.data, g.width, g.height), 0, 0);
    const s = document.createElement('span'); s.textContent = l.name;
    b.append(c, s);
    b.addEventListener('click', () => { state.look = l.id; syncLookUi(); dirty = true; schedule(); });
    return b;
  };
  const first = document.createElement('div'); first.className = 'looks';
  first.appendChild(mkTile({ id: null, name: 'None' }));
  host.appendChild(first);
  for (const group of LOOK_GROUPS) {
    const h = document.createElement('h3'); h.className = 'look-group'; h.textContent = group;
    const grid = document.createElement('div'); grid.className = 'looks';
    for (const l of LOOKS.filter((x) => x.group === group)) grid.appendChild(mkTile(l));
    host.append(h, grid);
  }
}
function syncLookUi() {
  for (const b of document.querySelectorAll('.look')) b.setAttribute('aria-pressed', String((b.dataset.look || null) === state.look));
  const l = lookById(state.look);
  $('look-blurb').textContent = l ? l.blurb : 'Pick a look to start from. It stacks on top of your sliders and curves.';
  $('look-strength').value = Math.round(state.lookStrength * 100);
  $('look-out').textContent = `${Math.round(state.lookStrength * 100)}%`;
}
$('look-strength').addEventListener('input', (e) => {
  state.lookStrength = Number(e.target.value) / 100;
  $('look-out').textContent = `${e.target.value}%`; dirty = true; schedule();
});

// ---------- match ----------
function swatches(host, list) {
  host.textContent = '';
  for (const c of list) {
    const d = document.createElement('div');
    d.className = 'swatch'; d.style.background = c.hex; d.title = c.hex;
    host.appendChild(d);
  }
}
function buildOwnSwatches() { swatches($('own-swatches'), dominantColors(downscale(state.work, 160), 5)); }
function syncRefUi() {
  $('ref-info').hidden = !state.ref;
  if (state.ref) {
    $('ref-color').value = Math.round(state.ref.color * 100); $('ref-color-out').textContent = `${Math.round(state.ref.color * 100)}%`;
    $('ref-tone').value = Math.round(state.ref.tone * 100); $('ref-tone-out').textContent = `${Math.round(state.ref.tone * 100)}%`;
  }
}
$('ref-file').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const bmp = await decodeFile(f);
    const img = toImage(bmp, 320);
    state.ref = { profile: lookProfile(img), color: 0.8, tone: 0.5 };
    const t = $('ref-thumb'); const th = downscale(img, 120);
    t.width = th.width; t.height = th.height;
    t.getContext('2d').putImageData(new ImageData(th.data, th.width, th.height), 0, 0);
    swatches($('ref-swatches'), dominantColors(img, 5));
    syncRefUi(); dirty = true; schedule();
  } catch (err) { $('copy-msg').textContent = err.message; }
});
$('ref-color').addEventListener('input', (e) => {
  if (!state.ref) return;
  state.ref.color = Number(e.target.value) / 100; $('ref-color-out').textContent = `${e.target.value}%`; dirty = true; schedule();
});
$('ref-tone').addEventListener('input', (e) => {
  if (!state.ref) return;
  state.ref.tone = Number(e.target.value) / 100; $('ref-tone-out').textContent = `${e.target.value}%`; dirty = true; schedule();
});
$('ref-clear').addEventListener('click', () => { state.ref = null; syncRefUi(); dirty = true; schedule(); });
$('ref-bake').addEventListener('click', () => {
  if (!state.ref) return;
  const before = applyAdjustments(state.work, effectiveAdj());
  const after = matchLook(before, lookProfile(before), state.ref.profile, { tone: state.ref.tone, color: state.ref.color });
  const fitted = fitCurves(before, after);
  const cur = cloneCurves(state.adj.curves);
  for (const k of ['r', 'g', 'b']) cur[k] = composePoints(cur[k], fitted[k]);
  state.adj.curves = cur;
  state.ref = null;
  syncRefUi(); curveEditor.draw(); dirty = true; schedule();
  setTab('curves');
  $('copy-msg').textContent = 'The match is now in your Red, Green and Blue curves. Drag them to fine tune.';
});

// ---------- reset, export, copy ----------
$('reset').addEventListener('click', () => {
  state.adj = makeAdjustments(); state.look = null; state.lookStrength = 1; state.ref = null;
  syncSliders(); syncMix(); syncLookUi(); syncRefUi(); renderFindings(); curveEditor.draw(); dirty = true; schedule();
});

$('export').addEventListener('click', async () => {
  const btn = $('export');
  btn.disabled = true; btn.textContent = 'Saving...';
  await new Promise((r) => setTimeout(r, 30));
  try {
    const full = toImage(state.source, EXPORT_EDGE);
    const g = gradeImage(full);
    const c = document.createElement('canvas');
    c.width = g.width; c.height = g.height;
    c.getContext('2d').putImageData(new ImageData(g.data, g.width, g.height), 0, 0);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.92));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'graded.jpg';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } finally { btn.disabled = false; btn.textContent = 'Save JPEG'; }
});

$('copy').addEventListener('click', async () => {
  const a = effectiveAdj();
  const lines = CONTROLS.filter((c) => Math.abs(a[c.key]) > 1e-9).map((c) => `${c.name}: ${c.fmt ? c.fmt(a[c.key]) : (a[c.key] > 0 ? '+' : '') + Math.round(a[c.key])}`);
  if (a.splitShadow.amount) lines.push(`Shadow tint: hue ${a.splitShadow.hue}, ${Math.round(a.splitShadow.amount * 100)}%`);
  if (a.splitHighlight.amount) lines.push(`Highlight tint: hue ${a.splitHighlight.hue}, ${Math.round(a.splitHighlight.amount * 100)}%`);
  if (!curvesAreIdentity(a.curves) || !curvesAreIdentity(a.lookCurves)) lines.push('Tone curve: custom (see the Curves tab)');
  if (!hslIsNeutral(a.hsl)) {
    BANDS.forEach((b, i) => {
      const parts = [['hue', 'hue'], ['sat', 'saturation'], ['lum', 'brightness']].filter(([k]) => a.hsl[k][i]).map(([k, n]) => `${n} ${a.hsl[k][i] > 0 ? '+' : ''}${Math.round(a.hsl[k][i])}`);
      if (parts.length) lines.push(`${b.name}: ${parts.join(', ')}`);
    });
  }
  if (state.ref) lines.push(`Matched to a reference: colour ${Math.round(state.ref.color * 100)}%, tone ${Math.round(state.ref.tone * 100)}%`);
  const text = lines.length ? lines.join('\n') : 'No changes yet.';
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch { /* fall through */ }
  $('copy-msg').textContent = ok ? 'Copied. Paste these into Lightroom or Snapseed to repeat the grade.' : text;
});

// ---------- curves ----------
const curveEditor = createCurveEditor($('curve'), {
  getCurves: () => (state.adj.curves || (state.adj.curves = identityCurves())),
  onChange: () => { dirty = true; schedule(); },
});
for (const b of document.querySelectorAll('#curve-channels button')) {
  b.addEventListener('click', () => {
    for (const o of document.querySelectorAll('#curve-channels button')) o.setAttribute('aria-pressed', String(o === b));
    curveEditor.setChannel(b.dataset.ch);
  });
}
$('curve-reset-ch').addEventListener('click', () => curveEditor.resetChannel());
$('curve-reset-all').addEventListener('click', () => curveEditor.resetAll());

// ---------- colour mix ----------
let band = 0;
const BAND_DOT = ['#d9453d', '#e08a3a', '#d9c53d', '#58b45f', '#3fb5b0', '#4a7fd6', '#9a6fc4', '#cf5fa0'];
(function buildMix() {
  const host = $('bands');
  BANDS.forEach((b, i) => {
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'band'; btn.setAttribute('aria-pressed', String(i === 0));
    btn.innerHTML = `<i style="background:${BAND_DOT[i]}"></i>${b.name}`;
    btn.addEventListener('click', () => { band = i; syncMix(); });
    host.appendChild(btn);
  });
  const sl = $('mix-sliders');
  for (const [key, name, tip] of [['hue', 'Hue', 'Slides this colour toward its neighbours.'], ['sat', 'Saturation', 'How strong this colour is.'], ['lum', 'Brightness', 'How light or dark this colour is.']]) {
    const label = document.createElement('label');
    label.className = 'slider';
    label.innerHTML = `<span class="row"><b>${name}</b><output></output></span><input type="range" min="-100" max="100" step="1" data-key="${key}"><small>${tip}</small>`;
    const input = label.querySelector('input');
    input.addEventListener('input', () => {
      if (!state.adj.hsl) state.adj.hsl = makeHsl();
      state.adj.hsl[key][band] = Number(input.value);
      label.querySelector('output').textContent = (input.value > 0 ? '+' : '') + input.value;
      dirty = true; schedule();
    });
    input.addEventListener('dblclick', () => { if (state.adj.hsl) state.adj.hsl[key][band] = 0; syncMix(); dirty = true; schedule(); });
    sl.appendChild(label);
  }
})();
function syncMix() {
  document.querySelectorAll('.band').forEach((b, i) => b.setAttribute('aria-pressed', String(i === band)));
  for (const input of document.querySelectorAll('#mix-sliders input')) {
    const v = state.adj.hsl ? state.adj.hsl[input.dataset.key][band] : 0;
    input.value = v;
    input.closest('label').querySelector('output').textContent = (v > 0 ? '+' : '') + v;
  }
}
$('mix-reset').addEventListener('click', () => { state.adj.hsl = null; syncMix(); dirty = true; schedule(); });

// ---------- entry points ----------
$('file').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) openFile(f); });
const drop = $('drop');
for (const t of ['dragenter', 'dragover']) drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); });
for (const t of ['dragleave', 'drop']) drop.addEventListener(t, () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) openFile(f); });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => { e.preventDefault(); });
$('new-photo').addEventListener('click', () => { $('editor').hidden = true; $('empty').hidden = false; $('new-photo').hidden = true; state.work = null; });

(function buildSamples() {
  const host = $('samples');
  for (const s of SAMPLES) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'sample';
    const c = document.createElement('canvas');
    const thumb = renderSample(s.id, 240, 160);
    c.width = 240; c.height = 160;
    c.getContext('2d').putImageData(new ImageData(thumb.data, 240, 160), 0, 0);
    const n = document.createElement('span'); n.textContent = s.name;
    const m = document.createElement('small'); m.textContent = s.note;
    b.append(c, n, m);
    b.addEventListener('click', () => start(imageToCanvas(renderSample(s.id, 1280, 853))));
    host.appendChild(b);
  }
})();

window.__gs = { state, start }; // handy for the browser checks
