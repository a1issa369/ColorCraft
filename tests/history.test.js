import test from 'node:test';
import assert from 'node:assert/strict';
import { History } from '../src/core/history.js';

test('a new history has nothing to undo or redo', () => {
  const h = new History();
  assert.ok(!h.canUndo && !h.canRedo);
  assert.equal(h.undo(), null);
  assert.equal(h.redo(), null);
});

test('undo walks back through snapshots and redo walks forward again', () => {
  const h = new History();
  h.commit('a', 'a'); h.commit('b', 'b'); h.commit('c', 'c');
  assert.equal(h.undo(), 'b');
  assert.equal(h.undo(), 'a');
  assert.equal(h.undo(), null, 'cannot go back past the first state');
  assert.equal(h.redo(), 'b');
  assert.equal(h.redo(), 'c');
  assert.equal(h.redo(), null);
});

test('committing the same state twice adds one step', () => {
  const h = new History();
  assert.ok(h.commit('a', 'x'));
  assert.ok(!h.commit('a2', 'x'));
  assert.equal(h.stack.length, 1);
});

test('editing after an undo drops the redo steps', () => {
  const h = new History();
  h.commit('a', 'a'); h.commit('b', 'b'); h.commit('c', 'c');
  h.undo(); h.undo();
  h.commit('d', 'd');
  assert.ok(!h.canRedo);
  assert.equal(h.undo(), 'a');
  assert.equal(h.redo(), 'd');
});

test('the history is capped, dropping the oldest steps', () => {
  const h = new History(3);
  for (const k of 'abcde') h.commit(k, k);
  assert.equal(h.stack.length, 3);
  assert.equal(h.undo(), 'd');
  assert.equal(h.undo(), 'c');
  assert.equal(h.undo(), null);
});

test('reset clears everything', () => {
  const h = new History();
  h.commit('a', 'a'); h.commit('b', 'b');
  h.reset();
  assert.ok(!h.canUndo && !h.canRedo);
  assert.ok(h.commit('z', 'z'));
});
