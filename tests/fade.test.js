// The shape of a fade, which is arithmetic and had none of its own tests.
//
// It was checked through the browser: a scene rendered offline, a tone
// measured, a dB-per-second figure read off it. That is the right check for
// "does the stage actually fade a loop", and the wrong one for the curve
// itself - it costs half a minute, it reads one length at a time, and it
// cannot say anything precise about the edges of the range where a curve
// either reaches its ends or does not.
//
// This is that gap closed, the same way `meter.test.js` closed the VU's.
//
// ## What a fade's shape is for, which is two things
//
// Under about 50 ms it exists to stop a cut being a click, and is judged on
// splatter - where a raised cosine wins, because its slope is zero where it
// meets full gain and there is no corner to splatter from.
//
// At a second it is a musical gesture, there is no discontinuity to splatter
// at that timescale, and it is judged on falling EVENLY. There the raised
// cosine is the worst of them, for exactly the property that makes it good at
// 5 ms: a two-second fade-out on one moves 3 dB in its first 0.73 s and then
// 32 dB in its last 0.2 s.
//
// So the curve follows the length, and what is held here is that it does.

import test from 'node:test';
import assert from 'node:assert/strict';

import { fadeShapeAt, fadeGainAt, fallOf } from '../src/sketch/stage.js';
import { FADE_LEAST, FADE_MOST, fadeFor } from '../src/sketch/project.js';

/** Gain as decibels, for reading a fade's trajectory rather than its shape. */
const db = (gain) => (gain > 0 ? 20 * Math.log10(gain) : -Infinity);

/* --- which shape a length gets ------------------------------------------- */

test('a declick fade gets the cosine and a gesture gets the even curve', () => {
  // Fifty milliseconds and under is a declick, whatever it is called.
  assert.equal(fadeShapeAt(0.001), 0, 'the shortest fade there is');
  assert.equal(fadeShapeAt(0.005), 0, 'and the default every clip carries');
  assert.equal(fadeShapeAt(0.05), 0, 'up to the crossover itself');

  // Two hundred and over is a gesture.
  assert.ok(fadeShapeAt(0.2) > fadeShapeAt(0.05));
  assert.equal(fadeShapeAt(0.2), fadeShapeAt(2), 'and it does not keep changing past it');
  assert.equal(fadeShapeAt(FADE_MOST), fadeShapeAt(0.2));
});

test('the shape moves across the crossover rather than snapping', () => {
  // A fade dragged from 50 ms to 200 would otherwise change character in one
  // step somewhere in the middle, which is a control that feels broken.
  const steps = [0.05, 0.08, 0.11, 0.14, 0.17, 0.2].map(fadeShapeAt);
  for (let i = 1; i < steps.length; i += 1) {
    assert.ok(steps[i] >= steps[i - 1], 'it only ever moves one way');
  }
  assert.ok(steps[steps.length - 1] > steps[0] + 2, 'and it gets the whole way across');
});

test('a length that is not a length still gets a shape', () => {
  // Called on every pass of every clip, so it cannot be the thing that throws.
  assert.equal(fadeShapeAt(0), 0);
  assert.equal(fadeShapeAt(-1), 0);
  assert.equal(fadeShapeAt(NaN), 0);
  assert.equal(fadeShapeAt(undefined), 0);
  assert.equal(fadeShapeAt('nonsense'), 0);
});

/* --- and what each shape actually does ----------------------------------- */

test('every fade starts at one end and arrives at the other', () => {
  // Including the long one, which is the part that needed designing: linear
  // in dB never reaches zero, so it has to be taken to silence by a tail. A
  // fade that stopped at its floor would end on a step, and a step is the
  // click the whole mechanism exists to avoid.
  for (const seconds of [FADE_LEAST, 0.005, 0.05, 0.3, 1, FADE_MOST]) {
    assert.ok(Math.abs(fadeGainAt(0, seconds) - 1) < 1e-6,
      `a ${seconds}s fade-out begins at full`);
    assert.ok(fadeGainAt(1, seconds) < 1e-6,
      `a ${seconds}s fade-out arrives at silence, not at its floor`);
    assert.ok(fadeGainAt(0, seconds, true) < 1e-6, `a ${seconds}s fade-in begins at nothing`);
    assert.ok(Math.abs(fadeGainAt(1, seconds, true) - 1) < 1e-6,
      `a ${seconds}s fade-in arrives at full`);
  }
});

test('a fade only ever goes one way', () => {
  for (const seconds of [0.005, 0.1, 1]) {
    let last = fadeGainAt(0, seconds);
    for (let i = 1; i <= 64; i += 1) {
      const now = fadeGainAt(i / 64, seconds);
      assert.ok(now <= last + 1e-9, `a ${seconds}s fade-out rises again at ${i / 64}`);
      last = now;
    }
  }
});

test('a short fade is the raised cosine, to the sample', () => {
  // Not "close to" - below the crossover it IS the curve that measured best,
  // and a blend creeping in at 5 ms would quietly cost the 33 dB that curve
  // was chosen for.
  for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
    const want = 0.5 + 0.5 * Math.cos(Math.PI * t);
    assert.ok(Math.abs(fadeGainAt(t, 0.005) - want) < 1e-9, `at ${t}`);
  }
});

test('a long fade falls at one rate the whole way down', () => {
  // The claim the curve was changed for. Read across the audible part only:
  // past -60 the tail takes over, and what happens below that is not a thing
  // anybody hears.
  const rates = [];
  for (let i = 0; i < 40; i += 1) {
    const from = db(fadeGainAt(i / 100, 1));
    const to = db(fadeGainAt((i + 1) / 100, 1));
    if (Number.isFinite(from) && Number.isFinite(to)) rates.push(from - to);
  }
  const slowest = Math.min(...rates);
  const fastest = Math.max(...rates);
  assert.ok(slowest > 0, 'it falls everywhere');
  assert.ok(fastest / slowest < 1.05,
    `a one-second fade falls between ${slowest.toFixed(3)} and ${fastest.toFixed(3)} dB`
    + ' a step - it should be one rate');
});

test('the raised cosine is the uneven one, which is why it is not used long', () => {
  // The other half of the same claim, held so that the comparison in
  // `stage.js` is a fact in the suite rather than a note in a comment.
  const rates = [];
  for (let i = 0; i < 40; i += 1) {
    const from = db(fadeGainAt(i / 100, 0.005));
    const to = db(fadeGainAt((i + 1) / 100, 0.005));
    if (Number.isFinite(from) && Number.isFinite(to)) rates.push(from - to);
  }
  assert.ok(Math.max(...rates) / Math.max(1e-9, Math.min(...rates)) > 20,
    'a cosine falls at wildly different rates across its length');
});

test('a long fade is well down its range before it is half over', () => {
  // The hang-then-vanish, stated as a number. A raised cosine is at -6 dB
  // halfway through; an even one is there in the first tenth.
  assert.ok(db(fadeGainAt(0.5, 1)) < -20,
    'halfway through a one-second fade it is well on its way');
  assert.ok(db(fadeGainAt(0.5, 0.005)) > -12,
    'where the cosine, halfway through, has barely begun');
});

/* --- and where the fall goes ------------------------------------------- */

test('a fade-out never starts before the fade-in has finished', () => {
  // Two fades shared out to fit meet exactly in arithmetic and can miss by
  // a rounding step in floats, and two overlapping value curves throw. A
  // seeded walk rather than Math.random, so a failure can be reproduced.
  let seed = 7;
  const next = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 20000; i += 1) {
    const began = next() * 300;
    const heard = 0.01 + next() * 4;
    const fade = fadeFor({ in: FADE_LEAST + next() * 2, out: FADE_LEAST + next() * 2 }, heard);
    const fall = fallOf(began, heard, fade);
    assert.ok(fall.at >= began + fade.in, `the fall starts inside the rise at ${began}, ${heard}`);
    assert.ok(fall.seconds > 0, 'and still has a length');
    assert.ok(Math.abs(fall.at + fall.seconds - (began + heard)) < 1e-9, 'and ends where the pass does');
  }
});

test('a fade-out with room to spare is exactly where it was asked for', () => {
  const fall = fallOf(10, 2, { in: 0.005, out: 0.5 });
  assert.equal(fall.at, 11.5);
  assert.equal(fall.seconds, 0.5);
});
