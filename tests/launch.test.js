// Launching, as arithmetic.
//
// A bar line inside a scheduling window is the whole problem: book the window
// in one piece and up to a lookahead of the old clip is wrong, or the new
// clip comes in early. These are the four cases.

import test from 'node:test';
import assert from 'node:assert/strict';

import { booking, queue, resting, unqueue } from '../src/sketch/launch.js';

const BAR = 1920;

test('a track on nothing books nothing', () => {
  const { pieces, state } = booking(0, 100, resting());
  assert.deepEqual(pieces, []);
  assert.equal(state.scene, null);
});

test('a track on a scene books the whole window on it', () => {
  const { pieces } = booking(100, 240, resting(2, 0));
  assert.deepEqual(pieces, [{ from: 100, to: 240, scene: 2, anchor: 0 }]);
});

test('a launch beyond the window does not touch it', () => {
  const state = queue(resting(0, 0), 1, BAR);
  const booked = booking(0, 240, state);
  assert.deepEqual(booked.pieces, [{ from: 0, to: 240, scene: 0, anchor: 0 }]);
  // And is still waiting afterwards.
  assert.deepEqual(booked.state.next, { scene: 1, at: BAR });
});

test('a launch inside the window splits it at the bar line', () => {
  const state = queue(resting(0, 0), 1, BAR);
  const { pieces } = booking(BAR - 40, BAR + 60, state);

  assert.deepEqual(pieces, [
    { from: BAR - 40, to: BAR, scene: 0, anchor: 0 },
    { from: BAR, to: BAR + 60, scene: 1, anchor: BAR },
  ]);
});

test('and the state after it is on the new scene, anchored to the line', () => {
  const { state } = booking(BAR - 40, BAR + 60, queue(resting(0, 0), 1, BAR));
  assert.deepEqual(state, { scene: 1, anchor: BAR, next: null });
});

test('a launch exactly on the window start is the whole window', () => {
  const { pieces } = booking(BAR, BAR + 60, queue(resting(0, 0), 1, BAR));
  assert.deepEqual(pieces, [{ from: BAR, to: BAR + 60, scene: 1, anchor: BAR }]);
});

test('a launch the booking has already passed still lands, in its own phase', () => {
  // A late pass: the bar line went by before anything was booked for it. The
  // clip has to come in now rather than never, and it has to come in at the
  // phase the bar line gave it or it is a bar out for as long as it plays.
  const { pieces } = booking(BAR + 10, BAR + 200, queue(resting(0, 0), 1, BAR));
  assert.deepEqual(pieces, [{ from: BAR + 10, to: BAR + 200, scene: 1, anchor: BAR }]);
});

test('stopping is launching nothing, and books nothing after the line', () => {
  const { pieces, state } = booking(BAR - 40, BAR + 60, queue(resting(3, 0), null, BAR));
  assert.deepEqual(pieces, [{ from: BAR - 40, to: BAR, scene: 3, anchor: 0 }]);
  assert.equal(state.scene, null);
});

test('starting from nothing books only the half after the line', () => {
  const { pieces } = booking(BAR - 40, BAR + 60, queue(resting(), 0, BAR));
  assert.deepEqual(pieces, [{ from: BAR, to: BAR + 60, scene: 0, anchor: BAR }]);
});

test('a press taken back before it lands changes nothing', () => {
  const state = unqueue(queue(resting(0, 0), 1, BAR));
  const { pieces } = booking(BAR - 40, BAR + 60, state);
  assert.deepEqual(pieces, [{ from: BAR - 40, to: BAR + 60, scene: 0, anchor: 0 }]);
});

test('an empty window books nothing even on a scene', () => {
  assert.deepEqual(booking(240, 240, resting(1, 0)).pieces, []);
});
