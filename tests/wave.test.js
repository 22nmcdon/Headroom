// Summarising a recording into something that can be drawn.
//
// A waveform is a picture of a million samples in six hundred pixels, so the
// only question that matters is what each pixel is allowed to leave out. The
// answer here is nothing that would change the shape: every column reports
// the lowest and highest sample in its slice, so a single-sample click is as
// tall on screen as a sustained note at the same level. A column that
// averaged instead would make the click vanish, and the click is often the
// thing somebody is looking for.
//
// Held in node because it is arithmetic over arrays and wants to be fast and
// exact rather than looked at. What it looks like is a browser's business.

import test from 'node:test';
import assert from 'node:assert/strict';

import { waveOf, rescaleWave, spreadWave, WAVE_COLUMNS } from '../src/lib/wave.js';

/** A ramp, so every column has a different and predictable pair. */
const ramp = (n) => Float32Array.from({ length: n }, (_, i) => (i / (n - 1)) * 2 - 1);

test('a summary is one low and one high per column', () => {
  const peaks = waveOf([ramp(1000)], 10);
  assert.equal(peaks.length, 20);
  // The ramp climbs, so every column's high is above the one before it.
  for (let c = 1; c < 10; c += 1) {
    assert.ok(peaks[c * 2 + 1] > peaks[(c - 1) * 2 + 1], `column ${c} climbs`);
  }
});

test('the extremes survive, which is the whole point', () => {
  // One sample of a click in a thousand of silence. An averaging summary
  // loses it; this must not.
  const quiet = new Float32Array(1000);
  quiet[500] = 0.9;
  const peaks = waveOf([quiet], 20);

  let tallest = 0;
  for (let c = 0; c < 20; c += 1) tallest = Math.max(tallest, peaks[c * 2 + 1]);
  assert.ok(Math.abs(tallest - 0.9) < 1e-6, 'a one-sample click is still 0.9 tall');
});

test('both ends of the signal are reported, not just the loud one', () => {
  const peaks = waveOf([Float32Array.from([-0.8, 0.3, -0.1, 0.2])], 1);
  assert.ok(Math.abs(peaks[0] + 0.8) < 1e-6, 'the low');
  assert.ok(Math.abs(peaks[1] - 0.3) < 1e-6, 'the high');
});

test('every channel is in the envelope', () => {
  // A take that is loud in one ear only is a loud take, and a picture drawn
  // from the first channel alone would say it was quiet.
  const left = new Float32Array(100);
  const right = new Float32Array(100).fill(0.7);
  const peaks = waveOf([left, right], 4);
  for (let c = 0; c < 4; c += 1) {
    assert.ok(Math.abs(peaks[c * 2 + 1] - 0.7) < 1e-6, `column ${c} sees the other ear`);
  }
});

test('silence summarises to a flat line rather than to nothing', () => {
  const peaks = waveOf([new Float32Array(500)], 8);
  assert.equal(peaks.length, 16);
  assert.ok([...peaks].every((v) => v === 0));
});

test('more columns than samples leaves no column empty', () => {
  // A half-second take on a wide canvas, which is the case that fills a
  // waveform with gaps if each column is given a fixed slice width.
  const peaks = waveOf([Float32Array.from([-1, 1, -1, 1])], 16);
  assert.equal(peaks.length, 32);
  for (let c = 0; c < 16; c += 1) {
    const lo = peaks[c * 2];
    const hi = peaks[c * 2 + 1];
    assert.ok(Number.isFinite(lo) && Number.isFinite(hi), `column ${c} has numbers in it`);
    assert.ok(hi >= lo, `column ${c} is the right way up`);
  }
});

test('nothing to summarise is an empty summary, not a throw', () => {
  assert.equal(waveOf([], 10).length, 0);
  assert.equal(waveOf([new Float32Array(0)], 10).length, 0);
  assert.equal(waveOf([ramp(100)], 0).length, 0);
  assert.equal(waveOf([ramp(100)], -5).length, 0);
  assert.equal(waveOf(null, 10).length, 0);
});

/* --- and rescaling, so a resize is not a re-measure ---------------------- */

// A take is summarised once at `WAVE_COLUMNS` and the drawing is cut down
// from that. Measured: ten minutes of audio takes about 45 ms to summarise,
// which is one dropped frame when it happens once and a stutter when it
// happens on every frame of a resize drag.

test('a summary cuts down to fewer columns', () => {
  const fine = waveOf([ramp(10000)], 100);
  const coarse = rescaleWave(fine, 10);
  assert.equal(coarse.length, 20);
});

test('cutting down keeps the extremes, so the picture does not shrink', () => {
  const quiet = new Float32Array(10000);
  quiet[5000] = 0.9;
  quiet[5001] = -0.8;

  const fine = waveOf([quiet], 1000);
  const coarse = rescaleWave(fine, 20);

  let hi = 0;
  let lo = 0;
  for (let c = 0; c < 20; c += 1) {
    hi = Math.max(hi, coarse[c * 2 + 1]);
    lo = Math.min(lo, coarse[c * 2]);
  }
  assert.ok(Math.abs(hi - 0.9) < 1e-6, 'the click survives being cut down');
  assert.ok(Math.abs(lo + 0.8) < 1e-6, 'and so does its other side');
});

test('rescaling to what it already is changes nothing', () => {
  const fine = waveOf([ramp(5000)], 64);
  assert.deepEqual([...rescaleWave(fine, 64)], [...fine]);
});

test('rescaling upward is refused rather than invented', () => {
  // There is no more detail in a summary than was put into it, and a
  // waveform that interpolated would be drawing samples nobody recorded.
  const fine = waveOf([ramp(5000)], 16);
  assert.equal(rescaleWave(fine, 64).length, 32, 'capped at what it has');
});

test('the column count a take is summarised at is wide enough for a screen', () => {
  assert.ok(WAVE_COLUMNS >= 1280, 'or a desktop canvas would be drawn from too little');
});

/* --- and a take still being made ----------------------------------------- */

// A summary that is still growing is a different problem from a stored one.
// `rescaleWave` refuses to hand back more columns than it holds, on purpose:
// a stored take has all the detail it is ever going to have, and stretching
// it would be drawing samples nobody recorded.
//
// A take in progress is the other case. Two seconds in, there are fewer
// blocks than the canvas has pixels - 375 blocks a second at 48 kHz, so about
// 1.3 seconds before there is one per column - and drawing those few wide is
// not invention, it is the correct picture of a short take. Which is also
// what makes the live waveform turn into the stored one without jumping: both
// show the whole take across the whole width.

test('a growing summary fills the width it is given', () => {
  const few = waveOf([ramp(400)], 4);
  const wide = spreadWave(few, 16);
  assert.equal(wide.length, 32, 'four pairs across sixteen columns');
});

test('spreading repeats rather than inventing between', () => {
  // Each column takes the pair it lands in. An interpolated value would be a
  // level the microphone never saw, drawn as if it had.
  const two = Float32Array.from([-1, 1, -0.25, 0.25]);
  const wide = spreadWave(two, 4);
  assert.deepEqual([...wide], [-1, 1, -1, 1, -0.25, 0.25, -0.25, 0.25]);
});

test('spreading down is still by the extremes', () => {
  // Going the other way it has to behave like `rescaleWave`, because a take
  // longer than the canvas is the normal case a second into recording.
  const quiet = new Float32Array(2000);
  quiet[1000] = 0.9;
  const fine = waveOf([quiet], 500);
  const down = spreadWave(fine, 10);
  let hi = 0;
  for (let c = 0; c < 10; c += 1) hi = Math.max(hi, down[c * 2 + 1]);
  assert.ok(Math.abs(hi - 0.9) < 1e-6, 'the loudest moment survives');
});

test('spreading nothing is nothing', () => {
  assert.equal(spreadWave(new Float32Array(0), 10).length, 0);
  assert.equal(spreadWave(waveOf([ramp(100)], 4), 0).length, 0);
  assert.equal(spreadWave(waveOf([ramp(100)], 4), -3).length, 0);
});

test('the two live side by side and do not do each other\'s job', () => {
  const few = waveOf([ramp(400)], 4);
  assert.equal(rescaleWave(few, 16).length, 8, 'a stored summary stays as wide as it is');
  assert.equal(spreadWave(few, 16).length, 32, 'a growing one fills the canvas');
});
