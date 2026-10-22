// Recording, in the parts that are arithmetic.
//
// The microphone itself is measured in a browser with a fake device; what is
// here is the deciding - how many bars a take is, and what happens when it
// comes back a shade short of them.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  barsFor, barSeconds, fitTo, joinBlocks, loudestIn, MOST_BARS, SILENCE, canRecord,
} from '../src/sketch/record.js';

test('a bar is as long as the tempo says', () => {
  assert.equal(barSeconds(120), 2);
  assert.equal(barSeconds(96), 2.5);
  assert.equal(barSeconds(120, 3), 1.5, 'three four');
  assert.equal(barSeconds(120, 6, 8), 1.5, 'six eight');
});

test('a take is a whole number of bars, rounded to the nearest', () => {
  assert.equal(barsFor(2.4, 96), 1, 'just under a bar is a bar');
  assert.equal(barsFor(2.6, 96), 1);
  assert.equal(barsFor(4.0, 96), 2, 'two bars is 5 s; 4 rounds to 2');
  assert.equal(barsFor(5.0, 96), 2);
  assert.equal(barsFor(10.0, 96), 4);
});

test('a take is never nothing and never endless', () => {
  assert.equal(barsFor(0.1, 96), 1);
  assert.equal(barsFor(0, 96), 1);
  assert.equal(barsFor(-4, 96), 1);
  assert.equal(barsFor(600, 96), MOST_BARS);
  assert.equal(barsFor(10, 0), 1, 'a tempo of nothing is still one bar');
});

test('a take short of its bars is padded, not cut to what arrived', () => {
  // Cutting it would make the loop a hair fast, and a hair fast is a loop
  // that walks away from the others over four passes.
  const got = new Float32Array(1000).fill(0.5);
  const [fitted] = fitTo([got], 1000, 1.5);

  assert.equal(fitted.length, 1500);
  assert.equal(fitted[999], 0.5);
  assert.equal(fitted[1000], 0, 'the padding is not silence');
});

test('a take past its bars is cut', () => {
  const got = new Float32Array(2000).fill(0.5);
  const [fitted] = fitTo([got], 1000, 1);
  assert.equal(fitted.length, 1000);
});

test('fitting keeps every channel the same length', () => {
  const fitted = fitTo([new Float32Array(900), new Float32Array(1100)], 1000, 1);
  assert.deepEqual(fitted.map((c) => c.length), [1000, 1000]);
});

test('blocks join in the order they arrived', () => {
  const block = (values) => [Float32Array.from(values)];
  const [joined] = joinBlocks([block([1, 2]), block([3, 4]), block([5])]);
  assert.deepEqual([...joined], [1, 2, 3, 4, 5]);
  assert.deepEqual(joinBlocks([]), []);
});

test('a mono block fills both channels of a stereo run', () => {
  // Which is what a mono microphone into a stereo capture is, and reading
  // past the end of the block would be silence in one ear.
  const joined = joinBlocks([
    [Float32Array.from([1, 2]), Float32Array.from([3, 4])],
    [Float32Array.from([5, 6])],
  ]);
  assert.deepEqual([...joined[0]], [1, 2, 5, 6]);
  assert.deepEqual([...joined[1]], [3, 4, 5, 6]);
});

test('silence is a number, so nothing arriving can be said out loud', () => {
  assert.equal(loudestIn([new Float32Array(100)]), 0);
  // Float32, so 0.4 is not 0.4 and a test that says it is tests the wrong thing.
  assert.ok(Math.abs(loudestIn([Float32Array.from([0, -0.4, 0.2])]) - 0.4) < 1e-7);
  assert.ok(SILENCE > 0 && SILENCE < 0.01);
});

test('whether anything can be recorded is answered, not assumed', () => {
  // In node there is no navigator, which is exactly the case the sketchpad
  // has to handle without throwing.
  assert.equal(canRecord(), false);
});
