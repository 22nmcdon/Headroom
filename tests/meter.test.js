// The meters, in the part that is arithmetic.
//
// `lib/meter.js` had no tests at all before this - the VU's needle angle and
// its face are still uncovered, which is a gap worth naming rather than
// quietly widening. What is held here is the peak meter the recording panel
// reads, because it is new and because getting it wrong is how a take comes
// back ruined without anybody being told.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  peakAt, PEAK_FLOOR, PEAK_HOT, PEAK_FALL, fallenTo, clockOf,
} from '../src/lib/meter.js';

/* --- a peak meter, which is a different instrument from a VU ------------- */

// A VU reads an average and a peak meter reads the worst sample, and the
// recording panel needs the second: what ruins a take is one transient over
// the ceiling, which a VU is built not to show.

test('a peak meter runs from its floor to full scale', () => {
  assert.equal(peakAt(0), 1, 'full scale fills it');
  assert.equal(peakAt(PEAK_FLOOR), 0, 'the floor is empty');
  assert.ok(Math.abs(peakAt(PEAK_FLOOR / 2) - 0.5) < 1e-9, 'and it is linear in decibels');
});

test('a peak meter does not run off either end', () => {
  // Over is still full, because a meter that drew past its own box would be
  // a meter saying something the box cannot mean.
  assert.equal(peakAt(6), 1);
  assert.equal(peakAt(-500), 0);
  assert.equal(peakAt(-Infinity), 0, 'silence reads as nothing, not as NaN');
});

test('a peak meter says where the warnings sit', () => {
  // The two that matter: close to the ceiling, and at it.
  assert.ok(PEAK_HOT < 0 && PEAK_HOT > -12, 'hot is within a few decibels of the top');
  assert.ok(peakAt(PEAK_HOT) > 0.8, 'and it is near the end of the meter');
});

test('a clock while recording counts the way a clock does', () => {
  // Not "2 seconds". `saidLength` is the right way to report a finished take
  // and the wrong way to show one running - a number that changes every
  // second wants a shape that does not change with it.
  assert.equal(clockOf(0), '0:00');
  assert.equal(clockOf(2), '0:02');
  assert.equal(clockOf(59), '0:59');
  assert.equal(clockOf(60), '1:00');
  assert.equal(clockOf(61), '1:01');
  assert.equal(clockOf(600), '10:00');
  assert.equal(clockOf(3599), '59:59');
});

test('a clock does not go backwards or come back broken', () => {
  assert.equal(clockOf(-5), '0:00');
  assert.equal(clockOf(NaN), '0:00');
  assert.equal(clockOf(Infinity), '0:00');
});

test('a peak meter falls rather than snapping to nothing', () => {
  // Material with gaps in it - which is most of what anybody records - drives
  // the instantaneous peak to zero between transients. A bar that followed
  // that exactly would flicker at the floor and read as no signal at all.
  // Measured against the fall rate, in decibels a second.
  assert.ok(PEAK_FALL > 0, 'it falls');
  assert.equal(fallenTo(-6, -6, 1), -6, 'a level that holds, holds');
  assert.equal(fallenTo(-60, 0, 1), -PEAK_FALL, 'one second of silence is one second of fall');
  assert.equal(fallenTo(-3, -40, 0.5), -3, 'and a new peak takes it straight back up');
  // Never below the floor, so a long silence does not wander off the scale.
  assert.equal(fallenTo(-Infinity, PEAK_FLOOR, 10), PEAK_FLOOR);
});
