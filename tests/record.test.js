// Recording, in the parts that are arithmetic.
//
// The microphone itself is measured in a browser with a fake device; what is
// here is the deciding - how many bars a take is, and what happens when it
// comes back a shade short of them.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  barsFor, barSeconds, fitTo, joinBlocks, loudestIn, MOST_BARS, SILENCE, canRecord,
  freeSeconds, ticksFor, MOST_SECONDS, saidLength, oversIn,
  WANTED, overriddenIn, saidInput, CAPTURE_CHANNELS,
} from '../src/sketch/record.js';
import { PPQ } from '../src/sketch/midi.js';

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

/* --- takes that are not loops -------------------------------------------- */

// A take used to have no choice about being a looping cell: it was rounded to
// a whole number of bars, capped at eight of them, and CUT to that before it
// reached the store. At 96 bpm the cap is twenty seconds, so a minute of
// singing was stored as twenty seconds and the other forty were gone - and
// the message still said it had been kept. The cut came before `putTake`, so
// there was nothing left to recover.
//
// A take kept free keeps its length. What it needs instead is a length in
// ticks, so the grid can say how long it is and a follow action knows when it
// ends, without that number ever being used to cut the audio.

test('a free take keeps every sample of what was played', () => {
  const got = new Float32Array(3000).fill(0.5);
  const [kept] = fitTo([got], 1000, freeSeconds(3));
  assert.equal(kept.length, 3000, 'three seconds in, three seconds out');
});

test('a free take is capped, and the cap is minutes rather than bars', () => {
  // The cap is storage, not music: a mono 24-bit WAV at 48 kHz is 141 KB a
  // second, so ten minutes is 82 MB in IndexedDB. Measured, not guessed.
  assert.equal(freeSeconds(5), 5);
  assert.equal(freeSeconds(300), 300, 'five minutes is fine');
  assert.equal(freeSeconds(MOST_SECONDS + 60), MOST_SECONDS);
  assert.ok(MOST_SECONDS >= 600, 'at least ten minutes, or it is still a loop cell');
  // And the old cap is twenty seconds at this tempo, which is the thing being
  // escaped.
  assert.ok(MOST_SECONDS > MOST_BARS * barSeconds(96) * 10);
});

test('a free take is never nothing', () => {
  assert.ok(freeSeconds(0) > 0);
  assert.ok(freeSeconds(-4) > 0);
});

test('a free take has a length in ticks, for the grid and for follows', () => {
  // PPQ ticks a quarter note, four of them to a 4/4 bar.
  assert.equal(ticksFor(barSeconds(96), 96), PPQ * 4, 'one bar of seconds is one bar of ticks');
  assert.equal(ticksFor(barSeconds(96) * 3, 96), PPQ * 12);
  // Not rounded to a bar: that is the whole point. Half a bar is half a bar.
  assert.equal(ticksFor(barSeconds(96) / 2, 96), PPQ * 2);
});

test('a free take of an odd length keeps the odd length', () => {
  // Three and a bit bars, which `barsFor` would have called three and cut to.
  const odd = barSeconds(96) * 3.4;
  assert.equal(barsFor(odd, 96), 3, 'the loop path rounds it');
  assert.ok(ticksFor(odd, 96) > PPQ * 13, 'the free path does not');
  assert.ok(ticksFor(odd, 96) < PPQ * 14);
});

test('a length in ticks is never nothing, whatever the tempo', () => {
  assert.ok(ticksFor(0, 96) >= 1);
  assert.ok(ticksFor(5, 0) >= 1, 'a tempo of nothing still gives a usable length');
  assert.ok(ticksFor(-5, 96) >= 1);
});

test('a free take says its length the way a person would', () => {
  // "Eight bars" is the right way to say a loop and the wrong way to say a
  // sung idea. Somebody who just sang for ninety seconds wants to hear
  // ninety seconds back, not "36 bars".
  assert.equal(saidLength(1), '1 second');
  assert.equal(saidLength(37), '37 seconds');
  assert.equal(saidLength(59.4), '59 seconds');
  assert.equal(saidLength(60), '1 minute');
  assert.equal(saidLength(95), '1 minute 35');
  assert.equal(saidLength(120), '2 minutes');
  assert.equal(saidLength(MOST_SECONDS), '10 minutes');
  assert.equal(saidLength(0), '0 seconds');
  assert.equal(saidLength(-5), '0 seconds', 'never a negative length out loud');
});

/* --- what a take did to the ceiling -------------------------------------- */

// The thing you cannot currently see, and the reason a take comes back
// ruined. `autoGainControl` is asked for and switched off on purpose, so the
// level is entirely whatever the hardware hands over - and nothing showed it,
// during or after.
//
// Measured, on the writer this app actually has: `wav.js` writes 24-bit and
// `quantise` clamps to plus or minus one, while Web Audio's Float32 exceeds
// it freely. An input peaking at 1.13 - which is what Chromium's own fake
// microphone hands back - loses 31% of its samples to that clamp, flattened,
// with nothing said.

test('overs are the samples the writer will flatten', () => {
  assert.equal(oversIn([Float32Array.from([0, 0.5, -0.9])]), 0);
  assert.equal(oversIn([Float32Array.from([1.2, 0.5, -1.4])]), 2);
  // Exactly full scale counts. A real signal essentially never lands on 1.0
  // by accident, so a sample sitting precisely there is one something
  // upstream has already clipped.
  assert.equal(oversIn([Float32Array.from([1, -1, 0.99])]), 2);
});

test('every channel is counted, not just the first', () => {
  const quiet = new Float32Array(4);
  const hot = Float32Array.from([1.5, 0, 0, 1.5]);
  assert.equal(oversIn([quiet, hot]), 2);
});

test('nothing to count is nothing, not a throw', () => {
  assert.equal(oversIn([]), 0);
  assert.equal(oversIn(null), 0);
  assert.equal(oversIn([new Float32Array(0)]), 0);
});

test('a ceiling below full scale can be asked about', () => {
  // For "how close did it get", which is a different question from "did it
  // break", and the one somebody setting a level is actually asking.
  const near = Float32Array.from([0.9, 0.5, 0.95]);
  assert.equal(oversIn([near], 0.89), 2, 'the two loud ones, not the quiet one as well');
  assert.equal(oversIn([near], 0.94), 1);
});

/* --- what was asked for, and what the browser actually did ---------------- */

// The app asks for no gain control, no noise suppression and no echo
// cancellation, which is right for a sketchpad: it wants what was played, not
// what a phone thinks a voice on a call sounds like. What it never did was
// check whether the request was honoured - and a browser is free to ignore
// any of them.
//
// That matters more than it sounds. Gain control riding up during the quiet
// parts is what lifts a microphone's own noise floor into audibility, which
// is the hiss people hear on a phone recording of something with dynamics in
// it. Asking for it off and then not looking is how you end up recording into
// the very thing you turned off.

test('what is asked for is stated once, where both sides can read it', () => {
  assert.equal(WANTED.autoGainControl, false);
  assert.equal(WANTED.noiseSuppression, false);
  assert.equal(WANTED.echoCancellation, false);
});

test('a browser that did as it was asked has nothing overridden', () => {
  assert.deepEqual(overriddenIn({
    autoGainControl: false, noiseSuppression: false, echoCancellation: false,
  }), []);
});

test('and one that did not is named, by the thing it overrode', () => {
  assert.deepEqual(overriddenIn({
    autoGainControl: true, noiseSuppression: false, echoCancellation: false,
  }), ['autoGainControl']);

  assert.deepEqual(overriddenIn({
    autoGainControl: true, noiseSuppression: true, echoCancellation: false,
  }), ['autoGainControl', 'noiseSuppression']);
});

test('a setting the browser says nothing about is not a setting it ignored', () => {
  // The distinction the whole thing rests on. `getSettings` reports what a
  // browser chooses to report, and Safari has historically reported less than
  // Chromium. Treating silence as refusal would put a warning on every take
  // made in a browser that simply does not say - which teaches people to
  // ignore the warning.
  assert.deepEqual(overriddenIn({}), []);
  assert.deepEqual(overriddenIn({ autoGainControl: false }), []);
  assert.deepEqual(overriddenIn(null), []);
  assert.deepEqual(overriddenIn({ sampleRate: 48000 }), []);
});

test('a stereo input folded to mono says so, because it is not what is kept', () => {
  // The capture node is fixed at one channel, so a device offering two is
  // being folded - and a row reading "2 channels" would have somebody expect
  // a stereo take and get a mono one. Measured on Chromium's fake device,
  // which offers 44.1 kHz and two channels.
  assert.match(saidInput({ sampleRate: 44100, channelCount: 2 }), /kept as mono/);
  assert.doesNotMatch(saidInput({ sampleRate: 48000, channelCount: 1 }), /kept as mono/);
  assert.equal(CAPTURE_CHANNELS, 1, 'and if that ever changes, this says so');
});

test('what the browser handed over is said in words, not in field names', () => {
  assert.match(saidInput({ sampleRate: 48000, channelCount: 1 }), /48 kHz/);
  assert.match(saidInput({ sampleRate: 48000, channelCount: 1 }), /1 channel\b/);
  assert.match(saidInput({ sampleRate: 44100, channelCount: 2 }), /44\.1 kHz/);
  assert.match(saidInput({ sampleRate: 44100, channelCount: 2 }), /2 channels/);
  // Nothing reported is said as nothing rather than as "undefined Hz".
  assert.match(saidInput({}), /does not say/i);
  assert.match(saidInput(null), /does not say/i);
});
