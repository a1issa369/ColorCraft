import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from '../src/analytics/summary.ts';
import type { AnalyticsEvent, EventName } from '../src/analytics/track.ts';

const D = 86400000, T0 = Date.UTC(2026, 10, 1);
const e = (n: EventName, v: string, s: string, p?: AnalyticsEvent['p'], t = T0): AnalyticsEvent => ({ n, t, v, s, p });

test('empty input gives zeros, not NaN', () => {
  const s = summarize([]);
  assert.equal(s.events, 0);
  assert.equal(s.agent.avgGain, 0);
  assert.equal(s.agent.improvedPct, 0);
  assert.ok(s.funnel.every((f) => f.sessions === 0));
});

test('funnel counts sessions that reached each step', () => {
  const s = summarize([
    e('photo_opened', 'v1', 's1', { source: 'sample' }), e('tab_viewed', 'v1', 's1', { tab: 'match' }), e('reference_chosen', 'v1', 's1'), e('agent_run', 'v1', 's1', { before: 50, after: 80 }), e('export_jpeg', 'v1', 's1'),
    e('photo_opened', 'v2', 's2', { source: 'upload' }), e('tab_viewed', 'v2', 's2', { tab: 'adjust' }),
  ]);
  assert.deepEqual(s.funnel.map((f) => f.sessions), [2, 1, 1, 1, 0, 1]);
  assert.deepEqual(s.photos, { sample: 1, upload: 1 });
  assert.deepEqual(s.tabs, [{ name: 'adjust', n: 1 }, { name: 'match', n: 1 }]);
});

test('agent figures average across runs', () => {
  const s = summarize([
    e('agent_run', 'v1', 's1', { before: 40, after: 70, ms: 3000, regions: true, steps_kept: 6 }),
    e('agent_run', 'v2', 's2', { before: 60, after: 60, ms: 1000, regions: false, steps_kept: 2 }),
  ]);
  assert.equal(s.agent.runs, 2);
  assert.equal(s.agent.avgBefore, 50);
  assert.equal(s.agent.avgAfter, 65);
  assert.equal(s.agent.avgGain, 15);
  assert.equal(s.agent.improvedPct, 50);
  assert.equal(s.agent.avgSeconds, 2);
  assert.equal(s.agent.regionsPct, 50);
  assert.equal(s.agent.avgStepsKept, 4);
});

test('returning visitors and per-day counts', () => {
  const s = summarize([e('session_start', 'v1', 's1'), e('session_start', 'v1', 's2', undefined, T0 + D), e('session_start', 'v2', 's3'), e('agent_run', 'v2', 's3', { before: 1, after: 2 })]);
  assert.equal(s.visitors, 2);
  assert.equal(s.sessions, 3);
  assert.equal(s.returningVisitors, 1);
  assert.deepEqual(s.days, [{ day: '2026-11-01', sessions: 2, agentRuns: 1 }, { day: '2026-11-02', sessions: 1, agentRuns: 0 }]);
});

test('steer phrases and dials are tallied most used first', () => {
  const s = summarize([
    e('steer_used', 'v1', 's1', { phrases: 'warmer, moodier' }), e('steer_used', 'v1', 's1', { phrases: 'warmer' }),
    e('dial_changed', 'v1', 's1', { dial: 'warmth' }), e('dial_changed', 'v1', 's1', { dial: 'warmth' }), e('dial_changed', 'v1', 's1', { dial: 'colour' }),
  ]);
  assert.deepEqual(s.steer.top[0], { name: 'warmer', n: 2 });
  assert.deepEqual(s.dials, [{ name: 'warmth', n: 2 }, { name: 'colour', n: 1 }]);
});
