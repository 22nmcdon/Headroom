import test from 'node:test';
import assert from 'node:assert/strict';

import { makeHistory } from '../src/lib/history.js';

test('undo walks back, redo walks forward again', () => {
  const history = makeHistory();
  history.reset({ gain: 0 });
  history.record({ gain: 3 });
  history.record({ gain: 6 });

  assert.deepEqual(history.undo(), { gain: 3 });
  assert.deepEqual(history.undo(), { gain: 0 });
  assert.equal(history.undo(), null, 'nothing before the start');
  assert.deepEqual(history.redo(), { gain: 3 });
  assert.deepEqual(history.redo(), { gain: 6 });
  assert.equal(history.redo(), null);
});

test('a change after an undo throws away what could have been redone', () => {
  const history = makeHistory();
  history.reset({ gain: 0 });
  history.record({ gain: 3 });
  history.undo();
  history.record({ gain: -2 });
  assert.equal(history.canRedo, false);
  assert.deepEqual(history.undo(), { gain: 0 });
});

test('the same state twice is not a step', () => {
  const history = makeHistory();
  history.reset({ gain: 0 });
  assert.equal(history.record({ gain: 0 }), false);
  assert.equal(history.canUndo, false);
});

test('it keeps fifty steps and lets the oldest go', () => {
  const history = makeHistory(50);
  history.reset({ n: 0 });
  for (let n = 1; n <= 60; n += 1) history.record({ n });
  let steps = 0;
  while (history.undo()) steps += 1;
  assert.equal(steps, 50);
});

test('nothing holding a snapshot can move the history', () => {
  const history = makeHistory();
  const bands = [{ frequency: 400, gain: 3 }];
  history.reset(bands);
  bands[0].gain = 9;
  history.record([{ frequency: 400, gain: 6 }]);
  const back = history.undo();
  assert.equal(back[0].gain, 3, 'the reset copied what it was given');
  back[0].gain = 12;
  assert.equal(history.redo()[0].gain, 6);
  assert.equal(history.undo()[0].gain, 3, 'and handed out a copy');
});
