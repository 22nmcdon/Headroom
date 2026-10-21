// The shared marking helpers in src/work/scoring.js.
//
// Nothing in the app called `dialled` yet, and it had shipped with a reference
// to a variable that does not exist - `state === HIT` where the variable is
// `mark` - so the first thing ever to call it would have thrown rather than
// marked anything. The drills are what will call it, and these tests are what
// say it works before they do.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HIT, NEAR, MISS,
  onScale, distanceCell, dialled, toStep, toThirdOctave,
} from '../src/work/scoring.js';

/* ---------- picking off an ordered list ---------- */

test('on a scale, the answer is a hit, next door is near, two along is a miss', () => {
  assert.equal(onScale(4, 4).valueOf(), HIT);
  assert.equal(onScale(3, 4), NEAR);
  assert.equal(onScale(5, 4), NEAR);
  assert.equal(onScale(2, 4), MISS);
  assert.equal(onScale(9, 4), MISS);
});

test('how wide "near" is, is the caller\'s to say', () => {
  // A drill with six coarse steps wants a tighter near than one with ten
  // octave bands, which is why this is a parameter and not a constant.
  assert.equal(onScale(2, 4, { near: 2 }), NEAR);
  assert.equal(onScale(1, 4, { near: 2 }), MISS);
  assert.equal(onScale(3, 4, { near: 0 }), MISS);
});

test('a distance cell says how far off in the units of the thing guessed', () => {
  assert.deepEqual(distanceCell(0, 'band'), { state: HIT, text: 'spot on', narrow: true });
  assert.deepEqual(distanceCell(1, 'band'), { state: NEAR, text: '1 band', narrow: true });
  assert.deepEqual(distanceCell(-3, 'band'), { state: MISS, text: '3 bands', narrow: true });
});

/* ---------- controls you dial ---------- */

// The spec a dialled reading is marked against, in the shape the modes write
// them: tolerances in the unit, and the two words for which way it is out.
const DECIBELS = { unit: 'dB', hit: 1, near: 3, above: 'hot', below: 'shy', decimals: 1 };
const HERTZ = { unit: 'oct', hit: 0.2, near: 0.7, above: 'high', below: 'low' };
const RATIO = { unit: 'x', hit: 0.1, near: 0.4, above: 'hard', below: 'soft' };

test('a dialled value on the answer reads as spot on', () => {
  assert.deepEqual(dialled(6, 6, DECIBELS), { state: HIT, text: 'spot on' });
  assert.deepEqual(dialled(1000, 1000, HERTZ), { state: HIT, text: 'spot on' });
});

test('a dialled reading says which way it is out, not that it is wrong', () => {
  // The house style: name where the thing sits. "2.5 dB hot" is a decision
  // about the next move; "wrong" is not.
  assert.deepEqual(dialled(8.5, 6, DECIBELS), { state: NEAR, text: '2.5 dB hot' });
  assert.deepEqual(dialled(3.5, 6, DECIBELS), { state: NEAR, text: '2.5 dB shy' });
  assert.equal(dialled(14, 6, DECIBELS).state, MISS);
  assert.equal(dialled(14, 6, DECIBELS).text, '8.0 dB hot');
});

test('a dialled value inside the hit tolerance is a hit, and still says spot on', () => {
  // Inside the tolerance there is nothing useful to say about the remainder:
  // it is as close as the question asks for.
  const reading = dialled(6.4, 6, DECIBELS);
  assert.equal(reading.state, HIT);
  assert.equal(reading.text, 'spot on');
});

test('frequencies and ratios are read in ratios, because that is how they are heard', () => {
  // An octave out is an octave out whether it is 100 Hz or 10 kHz, so the
  // arithmetic on 'oct' and 'x' is a log, not a subtraction.
  assert.deepEqual(dialled(2000, 1000, HERTZ), { state: MISS, text: '1.0 oct high' });
  assert.deepEqual(dialled(500, 1000, HERTZ), { state: MISS, text: '1.0 oct low' });
  assert.deepEqual(dialled(1100, 1000, HERTZ), { state: HIT, text: 'spot on' }); // 0.14 oct

  // 4:1 guessed against 2:1 is twice the ratio, said as a factor.
  assert.deepEqual(dialled(4, 2, RATIO), { state: MISS, text: '2.0× hard' });
  assert.deepEqual(dialled(1, 2, RATIO), { state: MISS, text: '2.0× soft' });
});

test('a dialled reading never throws on the plain path, hit or miss', () => {
  // The regression this file exists for: `dialled` referred to `state` where
  // the variable is `mark`, so every call threw a ReferenceError.
  for (const guess of [0, 1, 6, 6.5, 20, -12]) {
    assert.doesNotThrow(() => dialled(guess, 6, DECIBELS));
  }
});

/* ---------- making an answer a person could have dialled ---------- */

test('a stepped value is one the control could actually be parked on', () => {
  assert.equal(toStep(6.27, 0.5), 6.5);
  assert.equal(toStep(6.2, 0.5), 6);
  assert.equal(toStep(0.37, 0.05), 0.35);
  // And it does not come back with a float's tail on it, which is what a
  // reading would then print.
  assert.equal(toStep(0.3, 0.1), 0.3);
});

test('frequencies land on the third-octave grid an engineer works on', () => {
  assert.equal(toThirdOctave(1000), 1000);
  assert.equal(Math.round(toThirdOctave(1020)), 1000);
  assert.equal(Math.round(toThirdOctave(1230)), 1260); // the next third up
  assert.equal(Math.round(toThirdOctave(2000)), 2000); // an octave is three
  assert.equal(Math.round(toThirdOctave(63)), 63);
});
