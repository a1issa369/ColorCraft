import { makeAdjustments, combine, applyAdjustments, DEFAULTS } from './core/adjust.js';
import { identityCurves, cloneCurves, composePoints, curvesAreIdentity } from './core/curves.js';
import { BANDS, makeHsl, cloneHsl, hslIsNeutral } from './core/hsl.js';
import { analyze } from './core/analyze.js';
import { diagnose, autoGrade } from './core/suggest.js';
import { downscale, makeImage } from './core/image.js';
import { LOOKS, LOOK_GROUPS, lookById } from './core/looks.js';
import { lookProfile, matchLook, fitCurves } from './core/transfer.js';
import { History } from './core/history.js';
import { MASK_KEYS, MAX_MASKS, MASK_STARTERS, makeMask, cloneMasks, masksAreNeutral, AlphaCache, applyMasks } from './core/mask.js';
import { dominantColors } from './core/palette.js';
import { SAMPLES, renderSample } from './core/samples.js';
import { drawHistogram, drawScope } from './ui/draw.js';
import { createCurveEditor } from './ui/curveEditor.js';
import { CONTROLS } from './ui/teach.js';

const WORK_EDGE = 1280;
const DRAFT_EDGE = 512;     // size used while a slider or curve is moving
const SETTLE_MS = 180;      // quiet time before the full size render
const EXPORT_EDGE = 4000;
const HISTORY_LIMIT = 100;
const $ = (id) => document.getElementById(id);

const state = {
  source: null,        // drawable (ImageBitmap or canvas) at full size
  work: null,          // downscaled image used for the live preview
  workSmall: null,     // smaller copy used while dragging, so sliders stay smooth
  adj: makeAdjustments(),
  look: null,
  lookStrength: 1,
  ref: null,           // { profile, tone, color, thumb, swatches }
  masks: [],           // gradient masks, each with its own small set of adjustments
  maskSel: null,
  maskArea: true,      // show the red overlay while editing a mask
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
  // Release the previous photo's decoded pixels now instead of waiting for the browser to get around to it.
  if (state.source && state.source !== drawable && typeof state.source.close === 'function') state.source.close();
  state.source = drawable;
  state.work = toImage(drawable, WORK_EDGE);
  state.workSmall = downscale(state.work, DRAFT_EDGE);
  bufFull = makeBuffers(state.work);
  bufDraft = state.workSmall === state.work ? bufFull : makeBuffers(state.workSmall);
  gradSmall.width = state.workSmall.width; gradSmall.height = state.workSmall.height;
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
  state.masks = []; state.maskSel = null; renderCache.clear(); overlayCache.clear();
  buildLooks(); buildOwnSwatches(); syncSliders(); syncMix(); renderFindings(); syncLookUi(); syncRefUi(); curveEditor.draw(); syncMaskUi();
  resetHistory();
  setTab('read');
  touch();
  window.scrollTo({ top: 0 });
}

// ---------- rendering ----------
const view = $('view');
const origCanvas = document.createElement('canvas');
const gradCanvas = document.createElement('canvas');
const gradSmall = document.createElement('canvas');
let bufFull = null, bufDraft = null;     // reused pixel buffers, so a drag does not allocate megabytes per frame
let dirty = false, raf = 0, lastInput = -1e9, settleTimer = 0, shownDraft = false;

const makeBuffers = (img) => ({ a: makeImage(img.width, img.height), b: makeImage(img.width, img.height), c: makeImage(img.width, img.height) });
const renderCache = new AlphaCache(8);   // mask strength maps for the preview sizes, so a drag does not rebuild them every frame

function effectiveAdj() {
  const look = lookById(state.look);
  return look ? combine(state.adj, look.adj, state.lookStrength) : state.adj;
}

function gradeImage(img, bufs, cache = renderCache) {
  let out = applyAdjustments(img, effectiveAdj(), bufs ? bufs.a : undefined);
  if (state.ref && (state.ref.tone > 0 || state.ref.color > 0)) {
    out = matchLook(out, lookProfile(out), state.ref.profile, { tone: state.ref.tone, color: state.ref.color }, bufs ? bufs.b : undefined);
  }
  // Local edits go last, on top of the global grade. `out` is one of our own buffers, so it is safe to blend into it.
  if (!masksAreNeutral(state.masks)) out = applyMasks(out, state.masks, cache, bufs ? bufs.c : undefined);
  return out;
}

/** Ask for a redraw. While things are still changing the preview is drawn smaller; a moment after the last change it is redrawn in full. */
function touch() {
  dirty = true;
  lastInput = performance.now();
  clearTimeout(settleTimer);
  if (state.workSmall !== state.work) settleTimer = setTimeout(() => { dirty = true; schedule(); }, SETTLE_MS);
  schedule();
}

function schedule() { if (!raf) raf = requestAnimationFrame(frame); }

function frame() {
  raf = 0;
  if (!state.work) return;
  if (dirty) {
    dirty = false;
    const draft = state.workSmall !== state.work && performance.now() - lastInput < SETTLE_MS - 20;
    const g = gradeImage(draft ? state.workSmall : state.work, draft ? bufDraft : bufFull);
    const canvas = draft ? gradSmall : gradCanvas;
    canvas.getContext('2d').putImageData(new ImageData(g.data, g.width, g.height), 0, 0);
    shownDraft = draft;
    const stats = analyze(downscale(g, draft ? 160 : 256));
    drawHistogram($('hist'), stats);
    drawScope($('scope'), stats);
    curveEditor.setHistogram(stats.hist);
  }
  compose();
}

function compose() {
  const ctx = view.getContext('2d');
  const w = view.width, h = view.height;
  ctx.drawImage(shownDraft ? gradSmall : gradCanvas, 0, 0, w, h);
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
  drawMaskUi();
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
  // The left side of the photo shows the original, which would hide the mask's effect; show the full result.
  if (name === 'masks' && state.split > 0) state.split = 0;
  schedule();
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
    input.addEventListener('input', () => { state.adj[c.key] = Number(input.value); out.textContent = fmt(state.adj[c.key]); touch(); });
    input.addEventListener('dblclick', () => { state.adj[c.key] = DEFAULTS[c.key]; syncSliders(); touch(); commit(); });
    input.addEventListener('change', commit);
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
      b.addEventListener('click', () => { Object.assign(state.adj, f.fix); syncSliders(); renderFindings(); touch(); commit(); });
      li.appendChild(b);
    }
    ul.appendChild(li);
  }
}
$('fix-all').addEventListener('click', () => {
  state.adj = autoGrade(state.work, makeAdjustments({ curves: state.adj.curves, hsl: state.adj.hsl }));
  syncSliders(); renderFindings(); touch(); commit();
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
    b.addEventListener('click', () => { state.look = l.id; syncLookUi(); touch(); commit(); });
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
$('look-strength').addEventListener('change', commit);
$('look-strength').addEventListener('input', (e) => {
  state.lookStrength = Number(e.target.value) / 100;
  $('look-out').textContent = `${e.target.value}%`; touch();
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
    const t = $('ref-thumb'), th = state.ref.thumb;
    t.width = th.width; t.height = th.height;
    t.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(th.data), th.width, th.height), 0, 0);
    swatches($('ref-swatches'), state.ref.swatches);
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
    if (typeof bmp.close === 'function') bmp.close();
    const th = downscale(img, 120);
    state.ref = {
      id: ++refCounter, profile: lookProfile(img), color: 0.8, tone: 0.5,
      thumb: { width: th.width, height: th.height, data: new Uint8ClampedArray(th.data) },
      swatches: dominantColors(img, 5),
    };
    syncRefUi(); touch(); commit();
  } catch (err) { $('copy-msg').textContent = err.message; }
});
$('ref-color').addEventListener('change', commit);
$('ref-tone').addEventListener('change', commit);
$('ref-color').addEventListener('input', (e) => {
  if (!state.ref) return;
  state.ref.color = Number(e.target.value) / 100; $('ref-color-out').textContent = `${e.target.value}%`; touch();
});
$('ref-tone').addEventListener('input', (e) => {
  if (!state.ref) return;
  state.ref.tone = Number(e.target.value) / 100; $('ref-tone-out').textContent = `${e.target.value}%`; touch();
});
$('ref-clear').addEventListener('click', () => { state.ref = null; syncRefUi(); touch(); commit(); });
$('ref-bake').addEventListener('click', () => {
  if (!state.ref) return;
  const before = applyAdjustments(state.work, effectiveAdj());
  const after = matchLook(before, lookProfile(before), state.ref.profile, { tone: state.ref.tone, color: state.ref.color });
  const fitted = fitCurves(before, after);
  const cur = cloneCurves(state.adj.curves);
  for (const k of ['r', 'g', 'b']) cur[k] = composePoints(cur[k], fitted[k]);
  state.adj.curves = cur;
  state.ref = null;
  syncRefUi(); curveEditor.draw(); touch();
  commit();
  setTab('curves');
  $('copy-msg').textContent = 'The match is now in your Red, Green and Blue curves. Drag them to fine tune.';
});

// ---------- reset, export, copy ----------
$('reset').addEventListener('click', () => {
  state.adj = makeAdjustments(); state.look = null; state.lookStrength = 1; state.ref = null; state.masks = []; state.maskSel = null;
  syncSliders(); syncMix(); syncLookUi(); syncRefUi(); renderFindings(); curveEditor.draw(); syncMaskUi(); touch(); commit();
});

$('export').addEventListener('click', async () => {
  const btn = $('export');
  btn.disabled = true; btn.textContent = 'Saving...';
  await new Promise((r) => setTimeout(r, 30));
  try {
    const full = toImage(state.source, EXPORT_EDGE);
    const g = gradeImage(full, makeBuffers(full), new AlphaCache(1));
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
  state.masks.forEach((m, i) => {
    const parts = MASK_KEYS.filter((k) => m.adj[k]).map((k) => { const c = CONTROLS.find((x) => x.key === k); return `${c.name} ${c.fmt ? c.fmt(m.adj[k]) : (m.adj[k] > 0 ? '+' : '') + Math.round(m.adj[k])}`; });
    if (!parts.length) return;
    const pct = (v) => `${Math.round(v * 100)}%`;
    lines.push(`Gradient ${i + 1} (${m.invert ? 'flipped, ' : ''}strongest at ${pct(m.x1)} across and ${pct(m.y1)} down, gone by ${pct(m.x2)} across and ${pct(m.y2)} down): ${parts.join(', ')}`);
  });
  if (state.ref) lines.push(`Matched to a reference: colour ${Math.round(state.ref.color * 100)}%, tone ${Math.round(state.ref.tone * 100)}%`);
  const text = lines.length ? lines.join('\n') : 'No changes yet.';
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch { /* fall through */ }
  $('copy-msg').textContent = ok ? 'Copied. Paste these into Lightroom or Snapseed to repeat the grade.' : text;
});

// ---------- masks ----------
const overlayCache = new AlphaCache(4);
const tint = $('mask-tint'), maskUi = $('mask-ui'), hStart = $('mh-start'), hEnd = $('mh-end');
const TINT_W = 360;
let tintImg = null;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const selMask = () => state.masks.find((m) => m.id === state.maskSel) || null;
const maskName = (m) => `Gradient ${state.masks.indexOf(m) + 1}`;

/** Red tint over the area the selected mask covers, a dashed guide between its two handles, and the handles themselves. */
function drawMaskUi() {
  const m = state.tab === 'masks' ? selMask() : null;
  maskUi.hidden = !m;
  const showTint = !!m && state.maskArea && !state.hold;
  tint.hidden = !showTint;
  if (!m) return;
  // Keep the dots just inside the photo so one sitting on an edge can still be grabbed (the stage clips what sticks out).
  const at = (el, x, y) => { el.style.left = `clamp(20px, ${x * 100}%, calc(100% - 20px))`; el.style.top = `clamp(20px, ${y * 100}%, calc(100% - 20px))`; };
  at(hStart, m.x1, m.y1); at(hEnd, m.x2, m.y2);
  hStart.setAttribute('aria-valuetext', `${Math.round(m.x1 * 100)}% across, ${Math.round(m.y1 * 100)}% down`);
  hEnd.setAttribute('aria-valuetext', `${Math.round(m.x2 * 100)}% across, ${Math.round(m.y2 * 100)}% down`);
  if (!showTint) return;
  const w = TINT_W, h = Math.max(1, Math.round(TINT_W * view.height / view.width));
  if (tint.width !== w || tint.height !== h) { tint.width = w; tint.height = h; tintImg = null; }
  const ctx = tint.getContext('2d');
  if (!tintImg) { tintImg = ctx.createImageData(w, h); for (let i = 0; i < tintImg.data.length; i += 4) { tintImg.data[i] = 220; tintImg.data[i + 1] = 70; tintImg.data[i + 2] = 70; } }
  const a = overlayCache.get(m, w, h), d = tintImg.data;
  for (let p = 0, i = 3; p < a.length; p++, i += 4) d[i] = a[p] * 150;
  ctx.putImageData(tintImg, 0, 0);
  ctx.save();
  ctx.strokeStyle = 'rgba(235,230,218,.9)'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 5]);
  ctx.beginPath(); ctx.moveTo(m.x1 * w, m.y1 * h); ctx.lineTo(m.x2 * w, m.y2 * h); ctx.stroke();
  ctx.restore();
}

function bindMaskHandle(el, kx, ky) {
  el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); el.dragging = true; e.preventDefault(); });
  el.addEventListener('pointermove', (e) => {
    const m = selMask();
    if (!el.dragging || !m) return;
    const r = stage.getBoundingClientRect();
    m[kx] = clamp01((e.clientX - r.left) / r.width);
    m[ky] = clamp01((e.clientY - r.top) / r.height);
    touch();
  });
  const end = () => { if (el.dragging) { el.dragging = false; commit(); } };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('keydown', (e) => {
    const m = selMask();
    const step = e.shiftKey ? 0.05 : 0.01;
    const dx = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
    const dy = e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0;
    if (!m || (!dx && !dy)) return;
    e.preventDefault();
    m[kx] = clamp01(m[kx] + dx); m[ky] = clamp01(m[ky] + dy);
    touch();
  });
  el.addEventListener('keyup', (e) => { if (e.key.startsWith('Arrow')) commit(); });
}
bindMaskHandle(hStart, 'x1', 'y1');
bindMaskHandle(hEnd, 'x2', 'y2');

const maskSliderEls = {};
(function buildMaskSliders() {
  const host = $('mask-sliders');
  for (const c of CONTROLS.filter((x) => MASK_KEYS.includes(x.key))) {
    const label = document.createElement('label');
    label.className = 'slider';
    const fmt = c.fmt || ((v) => (v > 0 ? '+' : '') + Math.round(v));
    label.innerHTML = `<span class="row"><b>${c.name}</b><output></output></span><input type="range" min="${c.min}" max="${c.max}" step="${c.step}"><small>${c.tip}</small>`;
    const input = label.querySelector('input'), out = label.querySelector('output');
    input.addEventListener('input', () => { const m = selMask(); if (!m) return; m.adj[c.key] = Number(input.value); out.textContent = fmt(m.adj[c.key]); touch(); });
    input.addEventListener('dblclick', () => { const m = selMask(); if (!m) return; m.adj[c.key] = 0; syncMaskUi(); touch(); commit(); });
    input.addEventListener('change', commit);
    maskSliderEls[c.key] = { input, out, fmt };
    host.appendChild(label);
  }
})();

const MASK_BLANK = { id: 'blank', name: 'Empty gradient', blurb: 'Place it yourself, then pick what it changes.', mask: { x1: 0.5, y1: 0, x2: 0.5, y2: 0.5 } };
(function buildStarters() {
  const host = $('mask-starters');
  for (const st of [...MASK_STARTERS, MASK_BLANK]) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'starter'; b.dataset.starter = st.id;
    b.innerHTML = `<b>${st.name}</b><small>${st.blurb}</small>`;
    b.addEventListener('click', () => addMask(st.mask));
    host.appendChild(b);
  }
})();

function addMask(spec) {
  if (state.masks.length >= MAX_MASKS) return;
  const m = makeMask(spec);
  state.masks.push(m);
  state.maskSel = m.id;
  state.split = 0;
  syncMaskUi(); touch(); commit();
}

function syncMaskUi() {
  const full = state.masks.length >= MAX_MASKS;
  for (const b of $('mask-starters').children) b.disabled = full;
  const list = $('mask-list');
  list.textContent = '';
  state.masks.forEach((m) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = maskName(m);
    b.setAttribute('aria-pressed', String(m.id === state.maskSel));
    b.addEventListener('click', () => { state.maskSel = m.id; syncMaskUi(); schedule(); });
    list.appendChild(b);
  });
  const m = selMask();
  $('mask-editor').hidden = !m;
  $('mask-area').setAttribute('aria-pressed', String(state.maskArea));
  if (m) {
    for (const k of MASK_KEYS) { const el = maskSliderEls[k]; el.input.value = m.adj[k]; el.out.textContent = el.fmt(m.adj[k]); }
    $('mask-help').textContent = `${maskName(m)}: drag the filled dot to move where it is strongest, and the open dot to move where it fades out completely. Flip swaps which side gets the edit.`;
  }
  schedule();
}
$('mask-flip').addEventListener('click', () => { const m = selMask(); if (!m) return; m.invert = !m.invert; touch(); commit(); });
$('mask-area').addEventListener('click', () => { state.maskArea = !state.maskArea; syncMaskUi(); });
$('mask-remove').addEventListener('click', () => {
  const m = selMask(); if (!m) return;
  state.masks = state.masks.filter((x) => x !== m);
  state.maskSel = state.masks.length ? state.masks[state.masks.length - 1].id : null;
  syncMaskUi(); touch(); commit();
});

// ---------- undo and redo ----------
// Each finished gesture (releasing a slider, dropping a curve point, clicking a look) becomes one step.
let refCounter = 0;
const history = new History(HISTORY_LIMIT);
const snapshot = () => ({
  adj: makeAdjustments(state.adj), look: state.look, lookStrength: state.lookStrength,
  ref: state.ref ? { ...state.ref } : null,
  masks: cloneMasks(state.masks), maskSel: state.maskSel,
});
const signature = (s) => JSON.stringify([s.adj, s.look, s.lookStrength, s.ref && [s.ref.id, s.ref.tone, s.ref.color], s.masks]);
function commit() {
  if (!state.work) return;
  const snap = snapshot();
  if (history.commit(snap, signature(snap))) syncHistoryUi();
}
function resetHistory() { history.reset(); commit(); }
function restore(snap) {
  if (!snap) return;
  state.adj = makeAdjustments(snap.adj);
  state.look = snap.look; state.lookStrength = snap.lookStrength;
  state.ref = snap.ref ? { ...snap.ref } : null;
  state.masks = cloneMasks(snap.masks);
  state.maskSel = state.masks.some((m) => m.id === snap.maskSel) ? snap.maskSel : (state.masks[0] ? state.masks[0].id : null);
  syncSliders(); syncMix(); syncLookUi(); syncRefUi(); renderFindings(); curveEditor.draw(); syncMaskUi();
  touch(); syncHistoryUi();
}
const undo = () => restore(history.undo());
const redo = () => restore(history.redo());
function syncHistoryUi() {
  $('undo').disabled = !history.canUndo;
  $('redo').disabled = !history.canRedo;
}
$('undo').addEventListener('click', undo);
$('redo').addEventListener('click', redo);
document.addEventListener('keydown', (e) => {
  if ($('editor').hidden || !(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo(); }
});

// ---------- curves ----------
const curveEditor = createCurveEditor($('curve'), {
  getCurves: () => (state.adj.curves || (state.adj.curves = identityCurves())),
  onChange: () => { touch(); },
  onCommit: () => commit(),
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
      touch();
    });
    input.addEventListener('dblclick', () => { if (state.adj.hsl) state.adj.hsl[key][band] = 0; syncMix(); touch(); commit(); });
    input.addEventListener('change', commit);
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
$('mix-reset').addEventListener('click', () => { state.adj.hsl = null; syncMix(); touch(); commit(); });

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
