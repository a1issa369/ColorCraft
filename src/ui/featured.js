// The photos on the home page. Each card loops a before and after wipe so a visitor sees what a grade does at a glance.
// The "after" is made by the same engine the editor uses, from the edit listed here, so it is never a faked picture.
import { applyAdjustments, combine, makeAdjustments } from '../core/adjust.js';
import { lookById } from '../core/looks.js';

export const FEATURED = [
  { id: 'night-street', file: 'assets/samples/night-street.jpg', name: 'Night street', note: 'Shadows lifted, Clean and bright look',
    focus: { x: 0.5, y: 0.3 }, edit: { look: 'bright', strength: 0.9, adj: { exposure: 0.4, shadows: 30 } } },
  { id: 'sunset', file: 'assets/samples/sunset.jpg', name: 'Sunset', note: 'Teal and orange look',
    focus: { x: 0.45, y: 0.5 }, edit: { look: 'teal-orange', strength: 0.9, adj: {} } },
  { id: 'neon-sign', file: 'assets/samples/neon-sign.jpg', name: 'Neon signs', note: 'Moody look, shadows lifted',
    focus: { x: 0.34, y: 0.5 }, edit: { look: 'moody', strength: 0.9, adj: { exposure: 0.4, shadows: 30 } } },
];

const SIZE = 440; // card canvases are square; 2x covers a retina card

/** The edit a card shows as its "after": a look on top of a few adjustments. */
export function gradeEdit(img, edit) {
  const look = lookById(edit.look);
  return applyAdjustments(img, combine(makeAdjustments(edit.adj), look ? look.adj : {}, edit.strength));
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${src}`));
    img.src = src;
  });
}

/** Square crop of the photo, centred on `focus` (0..1 on each axis), drawn at SIZE x SIZE. */
function coverCanvas(img, focus) {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const s = Math.max(SIZE / img.naturalWidth, SIZE / img.naturalHeight);
  const w = img.naturalWidth * s, h = img.naturalHeight * s;
  c.getContext('2d').drawImage(img, -(w - SIZE) * focus.x, -(h - SIZE) * focus.y, w, h);
  return c;
}

function card(f, img, index, onPick) {
  const before = coverCanvas(img, f.focus);
  const bctx = before.getContext('2d');
  const px = bctx.getImageData(0, 0, SIZE, SIZE);
  const graded = gradeEdit({ width: SIZE, height: SIZE, data: px.data }, f.edit);
  const after = document.createElement('canvas');
  after.width = after.height = SIZE;
  after.getContext('2d').putImageData(new ImageData(graded.data, SIZE, SIZE), 0, 0);
  before.className = 'before'; after.className = 'after';
  for (const c of [before, after]) c.setAttribute('aria-hidden', 'true');

  const wrap = document.createElement('span'); wrap.className = 'after-wrap'; wrap.appendChild(after);
  const wipe = document.createElement('span'); wipe.className = 'wipe';
  const tb = document.createElement('span'); tb.className = 'tag tag-before'; tb.textContent = 'Before';
  const ta = document.createElement('span'); ta.className = 'tag tag-after'; ta.textContent = 'After';
  const reel = document.createElement('span'); reel.className = 'reel';
  reel.append(before, wrap, wipe, tb, ta);

  const name = document.createElement('b'); name.textContent = f.name;
  const note = document.createElement('small'); note.textContent = f.note;
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'feature';
  btn.style.setProperty('--d', `${index * 0.9}s`);
  btn.setAttribute('aria-label', `Open the ${f.name.toLowerCase()} photo in the editor`);
  btn.append(reel, name, note);
  btn.addEventListener('click', () => onPick(f));
  return btn;
}

/** Fill `host` with the cards. Resolves to how many loaded; a photo that fails to load is simply left out. */
export async function buildFeatured(host, onPick) {
  const cards = await Promise.all(FEATURED.map(async (f, i) => {
    try { return card(f, await loadImage(f.file), i, onPick); } catch { return null; }
  }));
  const ok = cards.filter(Boolean);
  host.replaceChildren(...ok);
  return ok.length;
}
