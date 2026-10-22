// Tapping a rhythm in.
//
// All of these are about a hit landing on the line a person meant, which is
// the only thing a quantiser has to get right and the thing that makes one
// feel broken when it does not.

import test from 'node:test';
import assert from 'node:assert/strict';

import { snap, tapInto, drift, timing } from '../src/sketch/tap.js';
import { clipOf } from '../src/sketch/project.js';
import { PPQ } from '../src/sketch/midi.js';

const BAR = PPQ * 4;
const EIGHTH = PPQ / 2;

test('a tap lands on the nearest line, not the one before it', () => {
  // A hit a hair early is a hit on the beat, played by somebody with good
  // time. Rounding down would put it a whole step early.
  assert.equal(snap(PPQ - 10, EIGHTH, BAR), PPQ);
  assert.equal(snap(PPQ + 10, EIGHTH, BAR), PPQ);
  assert.equal(snap(PPQ + EIGHTH / 2 + 1, EIGHTH, BAR), PPQ + EIGHTH);
  assert.equal(snap(0, EIGHTH, BAR), 0);
});

test('a tap in the last half-step of the loop belongs on the one', () => {
  assert.equal(snap(BAR - 10, EIGHTH, BAR), 0);
  assert.equal(snap(BAR, EIGHTH, BAR), 0);
  assert.equal(snap(BAR + PPQ, EIGHTH, BAR), PPQ, 'a second pass is the same bar');
});

test('a tick from any pass of the loop lands in the same place', () => {
  for (const pass of [0, 1, 2, 7]) {
    assert.equal(snap(BAR * pass + PPQ * 2 + 5, EIGHTH, BAR), PPQ * 2, `pass ${pass}`);
  }
});

test('a tap goes in the clip', () => {
  const clip = clipOf({ length: BAR });
  const notes = tapInto(clip, 36, PPQ * 2 + 7, EIGHTH);

  assert.equal(notes.length, 1);
  assert.deepEqual(notes[0], { pitch: 36, start: PPQ * 2, length: EIGHTH, velocity: 100 });
});

test('a second tap on a line that already has one changes nothing', () => {
  const clip = clipOf({ length: BAR, notes: [{ pitch: 36, start: PPQ }] });
  assert.equal(tapInto(clip, 36, PPQ + 9, EIGHTH).length, 1);
  // But a different drum on the same line is a different hit.
  assert.equal(tapInto(clip, 38, PPQ + 9, EIGHTH).length, 2);
});

test('a note is never longer than what is left of the clip', () => {
  const clip = clipOf({ length: PPQ * 3 });
  const [note] = tapInto(clip, 36, PPQ * 3 - 1, PPQ * 2);
  assert.ok(note.start + note.length <= PPQ * 3);
});

test('a clip with no length takes no taps', () => {
  assert.deepEqual(tapInto(clipOf({ length: 0 }), 36, 0, EIGHTH), []);
  assert.equal(snap(100, 0, BAR), 0);
  assert.equal(snap(100, EIGHTH, 0), 0);
});

test('drift says how far out a tap was, and which way', () => {
  assert.equal(drift(PPQ - 10, EIGHTH, BAR), -10, 'early is negative');
  assert.equal(drift(PPQ + 10, EIGHTH, BAR), 10, 'late is positive');
  assert.equal(drift(PPQ, EIGHTH, BAR), 0);
});

test('a tap just before the one reads as early, not as a bar late', () => {
  // The case the loop point makes: the tick is at the end of the bar and
  // the line it landed on is at the start of it.
  assert.equal(drift(BAR - 12, EIGHTH, BAR), -12);
  assert.equal(drift(BAR * 3 - 12, EIGHTH, BAR), -12);
});

test('a run of drifts averages to whether somebody is early', () => {
  assert.equal(timing([]), 0);
  assert.equal(timing([-10, -14, -12]), -12);
  assert.equal(timing([-10, 10]), 0);
});
