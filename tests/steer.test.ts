import test from 'node:test';
import assert from 'node:assert/strict';
import { steer, STEER_EXAMPLES } from '../src/state/steer.ts';
import { makeSettings } from '../src/state/store.ts';

const run = (text: string, set = makeSettings()) => steer(set, text);

test('warmer and cooler move temperature in opposite directions, and the original settings are untouched', () => {
  const s = makeSettings();
  assert.ok(run('warmer', s).settings.adj.temperature > 0);
  assert.ok(run('make it cooler', s).settings.adj.temperature < 0);
  assert.equal(s.adj.temperature, 0);
});

test('"less" and "more" are not confused: "less contrast" lowers it and is not also read as "contrast"', () => {
  assert.ok(run('less contrast').settings.adj.contrast < 0);
  assert.ok(run('more contrast').settings.adj.contrast > 0);
  const r = run('less contrast');
  assert.deepEqual(r.understood, ['less contrast']);
});

test('"less warm" cools and "less colour" mutes, rather than doing the opposite', () => {
  assert.ok(run('less warm').settings.adj.temperature < 0);
  assert.ok(run('less colour').settings.adj.saturation < 0);
  assert.ok(run('more colour').settings.adj.saturation > 0);
});

test('size words scale the step, and clauses are handled one at a time', () => {
  const base = run('warmer').settings.adj.temperature;
  assert.equal(run('much warmer').settings.adj.temperature, base * 2);
  assert.equal(run('slightly warmer').settings.adj.temperature, base / 2);
  const r = run('warmer, but slightly darker and more contrast');
  assert.ok(r.settings.adj.temperature > 0 && r.settings.adj.exposure < 0 && r.settings.adj.contrast > 0);
  assert.ok(Math.abs(r.settings.adj.exposure) < Math.abs(run('darker').settings.adj.exposure));
});

test('moodier moves several controls together', () => {
  const r = run('moodier').settings.adj;
  assert.ok(r.exposure < 0 && r.contrast > 0 && r.saturation < 0 && r.shadows < 0);
});

test('shadow and highlight phrases use the split tint and the matching sliders', () => {
  const t = run('teal shadows and warm highlights').settings.adj;
  assert.equal(t.splitShadow.hue, 185); assert.ok(t.splitShadow.amount > 0);
  assert.equal(t.splitHighlight.hue, 35); assert.ok(t.splitHighlight.amount > 0);
  assert.ok(run('lift the shadows').settings.adj.shadows > 0);
  assert.ok(run('deeper shadows').settings.adj.shadows < 0);
  assert.ok(run('tame the highlights').settings.adj.highlights < 0);
});

test('asking twice stacks, but never past a control\'s limits', () => {
  let s = makeSettings();
  for (let i = 0; i < 40; i++) s = steer(s, 'much warmer, much more colour').settings;
  assert.equal(s.adj.temperature, 100);
  assert.equal(s.adj.saturation, 100);
  let f = makeSettings();
  for (let i = 0; i < 20; i++) f = steer(f, 'much faded').settings;
  assert.ok(f.adj.fade <= 1);
  let d = makeSettings();
  for (let i = 0; i < 40; i++) d = steer(d, 'much darker').settings;
  assert.equal(d.adj.exposure, -2);
});

test('a tint keeps its amount when asked again with the same colour, and restarts when the colour changes', () => {
  let s = steer(makeSettings(), 'teal shadows').settings;
  s = steer(s, 'teal shadows').settings;
  assert.ok(Math.abs(s.adj.splitShadow.amount - 0.3) < 1e-9);
  s = steer(s, 'blue shadows').settings;
  assert.equal(s.adj.splitShadow.hue, 225);
  assert.ok(Math.abs(s.adj.splitShadow.amount - 0.15) < 1e-9);
});

test('what it cannot understand is handed back instead of being guessed at', () => {
  const r = run('make it look like a Wes Anderson movie');
  assert.deepEqual(r.changes, []);
  assert.match(r.leftover, /wes anderson/);
  const mixed = run('warmer and sparkly unicorn');
  assert.ok(mixed.settings.adj.temperature > 0);
  assert.match(mixed.leftover, /sparkly unicorn/);
  assert.deepEqual(run('').changes, []);
});

test('every example in the panel does something', () => {
  for (const e of STEER_EXAMPLES) {
    const r = run(e);
    assert.ok(r.changes.length > 0, e);
    assert.equal(r.leftover, '', e);
  }
});

test('the changes it reports name the controls that moved', () => {
  const r = run('warmer, brighter');
  assert.ok(r.changes.some((c) => /^Temperature/.test(c)));
  assert.ok(r.changes.some((c) => /^Exposure/.test(c)));
});
