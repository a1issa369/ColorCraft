import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnose, mergeFixes, whiteBalanceGains, autoGrade } from '../src/core/suggest.js';
import { analyze } from '../src/core/analyze.js';
import { applyAdjustments, makeAdjustments } from '../src/core/adjust.js';
import { renderCoast, renderSample, SAMPLES } from '../src/core/samples.js';
import { fromFn, solid, greyRamp } from './helpers.js';

const find = (findings, id) => findings.find((f) => f.id === id);
const ids = (findings) => findings.map((f) => f.id);
const coast = renderCoast(240, 160);
const adj = (o) => makeAdjustments(o);

test('a balanced photo gets a single "balanced" finding with no fix', () => {
  const f = diagnose(analyze(coast));
  assert.deepEqual(ids(f), ['ok']);
  assert.equal(f[0].fix, null);
});

test('underexposure is flagged and the fix brightens it towards middle grey', () => {
  const dark = applyAdjustments(coast, adj({ exposure: -1.8 }));
  const stats = analyze(dark);
  const finding = find(diagnose(stats), 'under');
  assert.ok(finding, 'expected an under finding');
  assert.ok(finding.fix.exposure > 0.3);
  const fixed = analyze(applyAdjustments(dark, mergeFixes(adj({}), [finding])));
  assert.ok(Math.abs(fixed.median - 0.46) < Math.abs(stats.median - 0.46));
});

test('overexposure is flagged and the fix darkens it', () => {
  const bright = applyAdjustments(coast, adj({ exposure: 1.2 }));
  const finding = find(diagnose(analyze(bright)), 'over');
  assert.ok(finding && finding.fix.exposure < -0.2);
});

test('crushed shadows are flagged, with a shadow lift as the fix', () => {
  const img = fromFn(100, 10, (x) => (x < 40 ? [0, 0, 0] : [120 + (x % 30), 120, 120]));
  const finding = find(diagnose(analyze(img)), 'crushed');
  assert.ok(finding && finding.fix.shadows >= 20 && finding.fix.shadows <= 70);
});

test('blown highlights are flagged, with highlight recovery as the fix', () => {
  const img = fromFn(100, 10, (x) => (x < 12 ? [255, 255, 255] : [100 + x, 110, 100]));
  const finding = find(diagnose(analyze(img)), 'blown');
  assert.ok(finding && finding.fix.highlights <= -25 && finding.fix.highlights >= -80);
});

test('a hazy low-contrast photo is flagged as flat, with positive contrast as the fix', () => {
  const hazy = applyAdjustments(coast, adj({ contrast: -60, fade: 0.8 }));
  const finding = find(diagnose(analyze(hazy)), 'flat');
  assert.ok(finding && finding.fix.contrast >= 8);
});

test('weak colour is flagged as muted and strong colour as loud, in opposite directions', () => {
  const muted = find(diagnose(analyze(applyAdjustments(coast, adj({ saturation: -80 })))), 'muted');
  const vivid = fromFn(60, 30, (x) => [[230, 50, 60], [40, 200, 90], [60, 80, 235]][x % 3]);
  const loud = find(diagnose(analyze(vivid)), 'loud');
  assert.ok(muted && muted.fix.saturation > 0);
  assert.ok(loud && loud.fix.saturation < 0);
});

const castCases = [
  ['warm', { temperature: 90 }, 'Leans warm', (fix) => fix.temperature < 0],
  ['cool', { temperature: -90 }, 'Leans cool', (fix) => fix.temperature > 0],
  ['magenta', { tint: 100 }, 'Leans magenta', (fix) => fix.tint < 0],
  ['green', { tint: -100 }, 'Leans green', (fix) => fix.tint > 0],
];
for (const [name, degrade, title, direction] of castCases) {
  test(`a ${name} cast is named correctly and the fix pushes the right way and shrinks it`, () => {
    const cast = applyAdjustments(coast, adj(degrade));
    const stats = analyze(cast);
    const finding = find(diagnose(stats), 'cast');
    assert.ok(finding, `no cast finding (magnitude ${stats.cast.magnitude})`);
    assert.equal(finding.title, title);
    assert.ok(direction(finding.fix), JSON.stringify(finding.fix));
    const after = analyze(applyAdjustments(cast, mergeFixes(adj({}), [finding])));
    assert.ok(after.cast.magnitude < stats.cast.magnitude * 0.6, `${stats.cast.magnitude} -> ${after.cast.magnitude}`);
  });
}

test('a black and white photo is not told its colours are muted', () => {
  const bw = fromFn(64, 16, (x) => { const v = 30 + x * 3; return [v, v, v]; });
  assert.ok(!find(diagnose(analyze(bw)), 'muted'));
  assert.ok(!find(diagnose(analyze(applyAdjustments(coast, adj({ saturation: -100 })))), 'muted'));
  const sepia = fromFn(128, 8, (x) => { const v = 40 + x; return [v * 1.1, v, v * 0.85]; });
  assert.ok(!find(diagnose(analyze(sepia)), 'muted'), 'a single tint over a grey ramp is a look, not muted colour');
});

test('no cast finding is made when there is nothing bright enough to judge from', () => {
  assert.ok(!find(diagnose(analyze(solid(32, 32, 10, 6, 14))), 'cast'));
});

test('findings are ordered most severe first and severity stays in 0..1', () => {
  const messy = applyAdjustments(coast, adj({ exposure: -1.7, temperature: -80, contrast: -50 }));
  const f = diagnose(analyze(messy));
  assert.ok(f.length >= 2);
  for (let i = 1; i < f.length; i++) assert.ok(f[i - 1].severity >= f[i].severity);
  for (const x of f) assert.ok(x.severity >= 0 && x.severity <= 1);
});

test('mergeFixes replaces values rather than stacking them, and ignores findings with no fix', () => {
  const f = { id: 'x', fix: { exposure: 0.5 } };
  const once = mergeFixes(adj({ exposure: 0.5 }), [f]);
  assert.equal(once.exposure, 0.5);
  assert.equal(mergeFixes(adj({ contrast: 7 }), [{ id: 'ok', fix: null }]).contrast, 7);
  assert.equal(mergeFixes(adj({}), [{ fix: { temperature: 12 } }, { fix: { tint: -3 } }]).tint, -3);
});

test('white balance sliders move a neutral grey by a measurable, positive amount', () => {
  const { tempB, tintA } = whiteBalanceGains();
  assert.ok(tempB > 5 && tintA > 3);
  assert.ok(whiteBalanceGains().tempA !== undefined && whiteBalanceGains().tintB !== undefined);
});

test('every practice sample has something to fix, and one-click grading leaves nothing serious', () => {
  for (const sm of SAMPLES) {
    const img = renderSample(sm.id, 240, 160);
    const findings = diagnose(analyze(img));
    assert.ok(!findings.some((f) => f.id === 'ok'), `${sm.id} should have problems`);
    const after = diagnose(analyze(applyAdjustments(img, autoGrade(img))));
    assert.ok(after.every((f) => f.severity < 0.4), `${sm.id} still has ${ids(after)}`);
  }
});

test('one-click grading leaves a balanced photo untouched', () => {
  const a = autoGrade(coast);
  for (const k of ['exposure', 'contrast', 'highlights', 'shadows', 'temperature', 'tint', 'saturation']) assert.equal(a[k], 0, k);
});

test('one-click grading keeps the base adjustments and stays inside the slider ranges', () => {
  const messy = applyAdjustments(coast, adj({ exposure: -2.5, temperature: -100, contrast: -90 }));
  const a = autoGrade(messy, adj({ fade: 0.4 }));
  assert.equal(a.fade, 0.4);
  assert.ok(a.exposure <= 2 && a.exposure >= -2);
  for (const k of ['contrast', 'temperature', 'tint', 'saturation']) assert.ok(Math.abs(a[k]) <= 100, k);
});

test('white balance solver: the suggested sliders really move a grey back towards neutral', () => {
  for (const degrade of [{ temperature: 80, tint: 20 }, { temperature: -70, tint: -30 }, { tint: 70 }]) {
    const grey = applyAdjustments(greyRamp(64, 4, 20, 235), adj(degrade));
    const stats = analyze(grey);
    const finding = find(diagnose(stats), 'cast');
    assert.ok(finding, JSON.stringify(degrade));
    const after = analyze(applyAdjustments(grey, mergeFixes(adj({}), [finding])));
    assert.ok(after.cast.magnitude < stats.cast.magnitude * 0.55, `${stats.cast.magnitude} -> ${after.cast.magnitude}`);
    // the fix is deliberately partial; one-click grading measures again and finishes the job
    const graded = analyze(applyAdjustments(grey, autoGrade(grey)));
    assert.ok(graded.cast.magnitude < 8, `${graded.cast.magnitude}`);
  }
});

test('all text shown to people avoids em dashes and is plain sentences', () => {
  const samples = [coast, ...SAMPLES.map((s) => renderSample(s.id, 120, 80))];
  const extra = [
    applyAdjustments(coast, adj({ exposure: -1.8 })), applyAdjustments(coast, adj({ exposure: 1.4 })),
    applyAdjustments(coast, adj({ saturation: -90 })), applyAdjustments(coast, adj({ saturation: 100, contrast: 10 })),
    applyAdjustments(coast, adj({ temperature: 90 })), applyAdjustments(coast, adj({ tint: 100 })),
  ];
  for (const img of [...samples, ...extra]) {
    for (const f of diagnose(analyze(img))) {
      assert.ok(!/[—–]/.test(f.title + f.detail), `dash in "${f.title}"`);
      assert.ok(f.detail.endsWith('.'), f.detail);
      assert.ok(f.title.length > 3);
    }
  }
});

test('one-click grading never makes things worse, even on a photo that cannot be improved (a flat grey card)', () => {
  const card = solid(16, 16, 120, 120, 120);
  const before = diagnose(analyze(card)).reduce((t, f) => t + f.severity, 0);
  const after = diagnose(analyze(applyAdjustments(card, autoGrade(card)))).reduce((t, f) => t + f.severity, 0);
  assert.ok(after <= before + 1e-9, `${before} -> ${after}`);
});

test('fix values are rounded to slider-friendly steps', () => {
  const dark = applyAdjustments(coast, adj({ exposure: -1.7 }));
  const f = find(diagnose(analyze(dark)), 'under');
  assert.ok(f);
  assert.ok(Math.abs(f.fix.exposure * 20 - Math.round(f.fix.exposure * 20)) < 1e-9, `${f.fix.exposure}`);
});

test('mergeFixes copies each finding fix over the base adjustments and leaves the rest alone', () => {
  const base = adj({ contrast: 5, tint: 7 });
  const out = mergeFixes(base, [{ id: 'a', fix: { exposure: 0.5 } }, { id: 'b', fix: null }, { id: 'c', fix: { contrast: 20 } }]);
  assert.equal(out.exposure, 0.5);
  assert.equal(out.contrast, 20);
  assert.equal(out.tint, 7);
});
