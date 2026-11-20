import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Analytics, cleanProps } from '../src/analytics/track.ts';

class Mem { m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, v); } removeItem(k: string) { this.m.delete(k); } }
const install = () => {
  const l = new Mem(), s = new Mem();
  Object.defineProperty(globalThis, 'localStorage', { value: l, configurable: true });
  Object.defineProperty(globalThis, 'sessionStorage', { value: s, configurable: true });
  return { l, s };
};

test('cleanProps keeps short strings, finite numbers and booleans only', () => {
  assert.deepEqual(cleanProps({ a: 'ok', b: 1.23456, c: true, d: NaN, e: { x: 1 }, f: 'x'.repeat(41), g: '<script>' }), { a: 'ok', b: 1.23, c: true });
  assert.equal(cleanProps({ Bad: 1 }), undefined);
  assert.equal(cleanProps(undefined), undefined);
});

test('cleanProps allows at most eight properties', () => {
  const p: Record<string, number> = {};
  for (let i = 0; i < 12; i++) p['k' + i] = i;
  assert.equal(Object.keys(cleanProps(p)!).length, 8);
});

test('events are stored locally with stable visitor and session ids', () => {
  install();
  const a = new Analytics(undefined, () => true, () => 1000);
  a.track('photo_opened', { source: 'sample' });
  a.track('export_jpeg');
  const ev = a.local();
  assert.equal(ev.length, 2);
  assert.equal(ev[0].v, ev[1].v);
  assert.equal(ev[0].s, ev[1].s);
  assert.deepEqual(ev[0].p, { source: 'sample' });
  assert.equal(ev[0].t, 1000);
});

test('local history keeps only the newest 500 events', () => {
  install();
  const a = new Analytics(undefined);
  for (let i = 0; i < 520; i++) a.track('tab_viewed', { i });
  const ev = a.local();
  assert.equal(ev.length, 500);
  assert.equal(ev[499].p!.i, 519);
});

test('opting out stops recording and forgets what was stored', () => {
  const { l } = install();
  const sent: string[] = [];
  const a = new Analytics('https://x.test', (_u, b) => { sent.push(b); return true; });
  a.track('photo_opened');
  assert.equal(a.local().length, 1);
  a.setEnabled(false);
  assert.equal(a.enabled, false);
  assert.equal(a.local().length, 0);
  assert.equal(l.getItem('cc-visitor'), null);
  a.track('photo_opened');
  a.flush();
  assert.equal(a.local().length, 0);
  assert.equal(sent.length, 0);
  a.setEnabled(true);
  a.track('photo_opened');
  assert.equal(a.local().length, 1);
});

test('nothing is sent without an endpoint', () => {
  install();
  let calls = 0;
  const a = new Analytics(undefined, () => { calls++; return true; });
  a.track('photo_opened'); a.flush();
  assert.equal(calls, 0);
});

test('flush posts a batch to /e and a full batch goes out at once', () => {
  install();
  const sent: { url: string; n: number }[] = [];
  const a = new Analytics('https://x.test/', (url, body) => { sent.push({ url, n: JSON.parse(body).events.length }); return true; });
  for (let i = 0; i < 20; i++) a.track('dial_changed', { dial: 'warmth' });
  assert.deepEqual(sent, [{ url: 'https://x.test/e', n: 20 }]);
  a.track('export_jpeg');
  a.flush();
  assert.equal(sent.length, 2);
  assert.equal(sent[1].n, 1);
});

test('a failed send is retried rather than lost', () => {
  install();
  let ok = false; const sizes: number[] = [];
  const a = new Analytics('https://x.test', (_u, b) => { sizes.push(JSON.parse(b).events.length); return ok; });
  a.track('export_jpeg');
  a.flush();
  ok = true;
  a.flush();
  assert.deepEqual(sizes, [1, 1]);
});

test('broken storage never throws', () => {
  const bad = { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); }, removeItem() { throw new Error('no'); } };
  Object.defineProperty(globalThis, 'localStorage', { value: bad, configurable: true });
  Object.defineProperty(globalThis, 'sessionStorage', { value: bad, configurable: true });
  const a = new Analytics(undefined);
  assert.doesNotThrow(() => { a.track('photo_opened'); a.setEnabled(false); a.setEnabled(true); });
  assert.deepEqual(a.local(), []);
});
