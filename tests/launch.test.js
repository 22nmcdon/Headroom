// Launching, as arithmetic.
//
// A bar line inside a scheduling window is the whole problem: book the window
// in one piece and up to a lookahead of the old clip is wrong, or the new
// clip comes in early. These are the four cases.

import test from 'node:test';
import assert from 'node:assert/strict';

import { booking, following, queue, resting, unqueue } from '../src/sketch/launch.js';

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

/* --- following ------------------------------------------------------------- */

const after = (passes, then) => ({ length: BAR, follow: { after: passes, then } });

test('a clip with no follow action keeps looping, which is the default', () => {
  assert.equal(following(resting(0, 0), { length: BAR }, 4), null);
  assert.equal(following(resting(0, 0), { length: BAR, follow: null }, 4), null);
});

test('a follow hands over at the end of the pass it counts to', () => {
  // Three times round a one-bar clip anchored at nothing ends on bar four.
  assert.deepEqual(following(resting(0, 0), after(3, 'next'), 4), { at: BAR * 3, scene: 1 });
  // And from wherever it was actually launched, not from the top of time.
  assert.deepEqual(following(resting(0, BAR * 5), after(2, 'next'), 4), { at: BAR * 7, scene: 1 });
});

test('the three things it can do', () => {
  assert.equal(following(resting(1, 0), after(2, 'next'), 4).scene, 2);
  assert.equal(following(resting(2, 0), after(2, 'first'), 4).scene, 0);
  assert.equal(following(resting(2, 0), after(2, 'stop'), 4).scene, null);
});

test('next at the end of the row is silence, because there is nothing to the right', () => {
  assert.deepEqual(following(resting(3, 0), after(1, 'next'), 4), { at: BAR, scene: null });
  // With more scenes there is somewhere to go.
  assert.equal(following(resting(3, 0), after(1, 'next'), 6).scene, 4);
});

test('a press beats a follow', () => {
  // Somebody pressing a clip is in the room; the clip is not. Whatever they
  // queued stands, and the follow does not queue a second thing on top.
  const pressed = queue(resting(0, 0), 3, BAR * 2);
  assert.equal(following(pressed, after(1, 'next'), 4), null);
});

test('a track playing nothing follows nothing', () => {
  assert.equal(following(resting(), after(1, 'next'), 4), null);
  assert.equal(following(resting(0, 0), { length: 0, follow: { after: 1, then: 'next' } }, 4), null);
});

test('a follow splits the window the same way a press does', () => {
  // Which is the whole point of handing it to `booking` rather than acting
  // on it: the old clip plays up to the handover and not a tick past it.
  const state = resting(0, 0);
  const due = following(state, after(2, 'next'), 4);
  const { pieces } = booking(BAR * 2 - 40, BAR * 2 + 60, queue(state, due.scene, due.at));

  assert.deepEqual(pieces, [
    { from: BAR * 2 - 40, to: BAR * 2, scene: 0, anchor: 0 },
    { from: BAR * 2, to: BAR * 2 + 60, scene: 1, anchor: BAR * 2 },
  ]);
});
