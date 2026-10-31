// What note a recording sounds at, and the cases where the answer is that
// there isn't one.
//
// The material here is synthesised rather than recorded, which is the point:
// a plucked string whose fundamental is 16 dB under its second harmonic, and
// a tone with no fundamental at all, are the two cases that separate a pitch
// detector from a peak finder, and neither is easy to arrange on purpose with
// a microphone.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  rootOf, rootSaid, differenceCurve, loudestWindow,
  hzOfPitch, pitchOfHz, ROOT_RANGE, ROOT_THRESHOLD, ROOT_WINDOW,
} from '../src/lib/root.js';
import { fft } from '../src/lib/fft.js';

const rate = 48000;

/** How far one frequency is from another, in cents. */
const cents = (hz, want) => 1200 * Math.log2(hz / want);

const over = (seconds, fn) => {
  const out = new Float32Array(Math.round(rate * seconds));
  for (let i = 0; i < out.length; i += 1) out[i] = fn(i / rate, i);
  return out;
};

const sine = (hz, seconds = 1, amp = 0.5) =>
  over(seconds, (t) => amp * Math.sin(2 * Math.PI * hz * t));

/** Twenty harmonics at 1/n, which is a saw and is what most instruments are nearer to. */
const saw = (hz, seconds = 1, amp = 0.4) => over(seconds, (t) => {
  let v = 0;
  for (let n = 1; n <= 20 && n * hz < rate / 2; n += 1) v += Math.sin(2 * Math.PI * n * hz * t) / n;
  return amp * v;
});

/**
 * A plucked string: harmonics that decay at their own rates, and a
 * fundamental that is the quietest thing in it.
 *
 * 0.15 against the second harmonic's 1.0 is 16 dB down, which is not an
 * exaggeration - it is roughly a bridge-pickup electric guitar, and a hummed
 * note through a laptop microphone with a high-pass on it is worse.
 */
const plucked = (hz, seconds = 1) => over(seconds, (t) => {
  let v = 0;
  for (const [n, a, decay] of [[1, 0.15, 3], [2, 1, 2.2], [3, 0.8, 2.6], [4, 0.4, 3.4], [5, 0.25, 4]]) {
    v += a * Math.exp(-decay * t) * Math.sin(2 * Math.PI * n * hz * t);
  }
  return 0.4 * v;
});

/** The second, third and fourth harmonics with nothing at the bottom. */
const missing = (hz, seconds = 1) => over(seconds, (t) =>
  0.3 * (Math.sin(2 * Math.PI * 2 * hz * t)
    + 0.7 * Math.sin(2 * Math.PI * 3 * hz * t)
    + 0.5 * Math.sin(2 * Math.PI * 4 * hz * t)));

const mixed = (a, b) => {
  const x = saw(a);
  const y = saw(b);
  return Float32Array.from(x, (v, i) => (v + y[i]) * 0.5);
};

const quieter = (x, db) => Float32Array.from(x, (v) => v * 10 ** (db / 20));

/* --- the two halves of a MIDI note ----------------------------------------- */

test('a note number and a frequency are the same thing twice', () => {
  assert.equal(hzOfPitch(69), 440);
  assert.ok(Math.abs(hzOfPitch(60) - 261.6256) < 1e-3, 'middle C is 261.63 Hz');
  assert.ok(Math.abs(pitchOfHz(440) - 69) < 1e-9);

  for (const pitch of [30, 48, 60, 72, 90]) {
    assert.ok(Math.abs(pitchOfHz(hzOfPitch(pitch)) - pitch) < 1e-9, `${pitch} did not survive the round trip`);
  }
});

/* --- the answers ------------------------------------------------------------ */

test('it reads the note off a recording, within a cent', () => {
  // Measured, all of them against the frequency they were built at. The last
  // column is the biggest-bin method on the same material, which is the
  // reason this file is not a wrapper round `fft.js` - see the next test.
  //
  //     what                       out by
  //     sine 220                     0.0 cents
  //     sine 440                     0.1
  //     sine 1318                    0.4
  //     sine 46.25 (the bottom)     -0.3
  //     saw 110                      0.0
  //     saw 329.63                   0.0
  //     plucked 196                  0.0
  //     missing fundamental 150      0.0
  const rows = [
    ['a sine at 220', sine(220), 220],
    ['a sine at 440', sine(440), 440],
    ['a sine at 1318.51', sine(1318.51), 1318.51],
    ['a saw at 110', saw(110), 110],
    ['a saw at 329.63', saw(329.63), 329.63],
    ['a plucked 196 whose fundamental is 16 dB down', plucked(196), 196],
    ['150 Hz with no 150 Hz in it', missing(150), 150],
  ];

  for (const [what, samples, want] of rows) {
    const got = rootOf(samples, rate);
    assert.ok(got.found, `${what}: nothing found`);
    assert.ok(Math.abs(cents(got.hz, want)) < 1,
      `${what}: read ${got.hz.toFixed(2)} Hz, ${cents(got.hz, want).toFixed(1)} cents out`);
    assert.equal(got.pitch, Math.round(pitchOfHz(want)), `${what}: wrong note`);
    assert.ok(got.sure > 0.9, `${what}: only ${got.sure.toFixed(3)} sure of an answer it got right`);
  }
});

test('the biggest bin reports an octave out on the two cases this exists for', () => {
  // The argument at the top of root.js, held rather than asserted. A plucked
  // string and a missing fundamental both have their loudest partial an
  // octave or a twelfth above the note, and a detector that reads the
  // spectrum's peak says so. Measured: 1177 cents and 1227 cents out, which
  // is an octave and an octave and a bit.
  const biggestBin = (samples, n = 4096) => {
    const { from } = loudestWindow(samples, rate);
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i += 1) {
      const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
      re[i] = (samples[from + i] ?? 0) * window;
    }
    fft(re, im);
    let best = 0;
    let at = 1;
    for (let i = 1; i < n / 2; i += 1) {
      const power = re[i] * re[i] + im[i] * im[i];
      if (power > best) { best = power; at = i; }
    }
    return (at * rate) / n;
  };

  for (const [what, samples, want] of [
    ['a plucked string', plucked(196), 196],
    ['a missing fundamental', missing(150), 150],
  ]) {
    const bin = Math.abs(cents(biggestBin(samples), want));
    const mine = Math.abs(cents(rootOf(samples, rate).hz, want));
    assert.ok(bin > 600, `${what}: the bin method was only ${bin.toFixed(0)} cents out,`
      + ' so the argument for not using it wants re-making');
    assert.ok(mine < 1, `${what}: this method was ${mine.toFixed(1)} cents out`);
  }
});

test('every note the picker offers can be read back', () => {
  // The range is the sampler's own picker, and an answer outside it is an
  // answer nobody can act on. Measured at the ends: 46.25 Hz reads 0.24
  // cents out and 1479.98 reads 2.29, which is the lag grid at the top and
  // is a long way inside a semitone either way.
  for (let pitch = ROOT_RANGE[0]; pitch <= ROOT_RANGE[1]; pitch += 6) {
    const hz = hzOfPitch(pitch);
    const got = rootOf(saw(hz, 2), rate);
    assert.ok(got.found, `pitch ${pitch} (${hz.toFixed(1)} Hz) was not found at all`);
    assert.equal(got.pitch, pitch, `pitch ${pitch} read back as ${got.pitch}`);
    assert.ok(Math.abs(cents(got.hz, hz)) < 5,
      `pitch ${pitch} read ${cents(got.hz, hz).toFixed(2)} cents out`);
  }
});

test('it finds the note wherever in the recording it is', () => {
  // Not the start, which on anything recorded through a microphone is the
  // room before the player got to it.
  const note = saw(293.66);
  const late = new Float32Array(note.length + Math.round(rate * 0.6));
  late.set(note, Math.round(rate * 0.6));

  const got = rootOf(late, rate);
  assert.ok(got.found, 'six tenths of a second of silence in front hid the note');
  assert.ok(Math.abs(cents(got.hz, 293.66)) < 1, `read ${got.hz.toFixed(2)} Hz`);

  const { from } = loudestWindow(late, rate);
  assert.ok(from >= Math.round(rate * 0.5), `the loudest window was at ${(from / rate).toFixed(2)} s`);
});

/* --- the answers it should refuse to give ---------------------------------- */

test('it says it does not know rather than guessing', () => {
  const nothing = new Float32Array(rate);
  const dither = Float32Array.from(nothing, () => (Math.random() - Math.random()) / 32768);
  const hiss = Float32Array.from(nothing, () => (Math.random() * 2 - 1) * 0.3);

  for (const [what, samples] of [
    ['digital silence', nothing],
    ['a track carrying nothing but 16-bit dither', dither],
    ['hiss at -10 dB', hiss],
    ['two saws a major second apart', mixed(220, 246.94)],
    ['a recording two hundredths of a second long', saw(220, 0.01)],
  ]) {
    const got = rootOf(samples, rate);
    assert.equal(got.found, false, `${what} was answered: ${got.hz?.toFixed(1)} Hz`);
    assert.equal(got.pitch, null);
    assert.ok(got.why && got.why.length > 10, `${what} was refused without saying why`);
  }
});

test('two notes that do share a period get the period they share', () => {
  // 220 and 330 Hz repeat together every 110, so 110 is the right answer and
  // not a failure to separate them. It is also the thing a biggest-bin method
  // could never say: there is no energy at 110 Hz in that signal at all.
  const got = rootOf(mixed(220, 330), rate);
  assert.ok(got.found, 'a fifth has a period and it was not found');
  assert.ok(Math.abs(cents(got.hz, 110)) < 5,
    `a fifth above 220 read ${got.hz.toFixed(1)} Hz rather than their common 110`);
});

test('a quiet take is still a take', () => {
  // The floor is about -69 dBFS of window RMS, which is low on purpose: what
  // refuses noise is the threshold, not the level, so there is nothing to buy
  // by refusing quiet signals. Measured, a note at -70 dB reads 0.0 cents out
  // and one at -80 is refused.
  for (const db of [-20, -40, -55, -70]) {
    const got = rootOf(quieter(saw(220), db), rate);
    assert.ok(got.found, `a note at ${db} dB was called silence`);
    assert.ok(Math.abs(cents(got.hz, 220)) < 1, `at ${db} dB it read ${got.hz.toFixed(2)} Hz`);
  }
  assert.equal(rootOf(quieter(saw(220), -90), rate).found, false, '-90 dB is silence');
});

/* --- the parts, for when the answer is wrong -------------------------------- */

test('the difference curve dips at the period and at its multiples', () => {
  // The curve is exported so that a wrong answer can be told apart from a
  // wrong reading of a right curve. A 200 Hz saw repeats every 240 samples at
  // 48 kHz, and also every 480 and 720 - which is the whole reason the
  // detector takes the first dip under the threshold and not the deepest one.
  const { curve, shortest, longest } = differenceCurve(saw(200), rate, { span: rate * ROOT_WINDOW });

  const period = rate / 200;
  for (const times of [1, 2, 3]) {
    const at = Math.round(period * times);
    assert.ok(at <= longest || times > 1, `lag ${at} is past the end of the curve`);
    if (at > longest) continue;
    assert.ok(curve[at] < ROOT_THRESHOLD,
      `the curve reads ${curve[at].toFixed(3)} at ${times} period(s), which is not a dip`);
  }

  // And nowhere near a dip at a lag that is not a multiple of the period.
  assert.ok(curve[Math.round(period * 1.5)] > ROOT_THRESHOLD,
    'the curve dips at a lag and a half, which would make every answer an octave question');

  assert.equal(curve[0], 1, 'the curve must start at one, or no lag beats no lag at all');
  assert.ok(shortest >= 2 && shortest < longest);
});

test('the sentence says how far out and how sure, and nothing it cannot back up', () => {
  const sure = rootOf(sine(220), rate);
  assert.equal(rootSaid(sure), 'certain');

  // Under eight cents is in tune as far as anybody can hear, and a detector
  // that announces three cents flat on a sine is reporting its own
  // arithmetic rather than anything about the recording.
  const flat = { found: true, pitch: 57, hz: 219, cents: -5, sure: 1 };
  assert.equal(rootSaid(flat), 'certain');
  assert.equal(rootSaid({ ...flat, cents: -31 }), '31 cents flat, certain');
  assert.equal(rootSaid({ ...flat, cents: 31 }), '31 cents sharp, certain');
  assert.equal(rootSaid({ ...flat, sure: 0.92 }), 'fairly sure');
  assert.equal(rootSaid({ ...flat, sure: 0.6 }), 'not very sure');

  // A refusal says the reason rather than a note nobody should use.
  const no = rootOf(new Float32Array(rate), rate);
  assert.equal(rootSaid(no), no.why);
});

test('it is quick enough to run on a click', () => {
  // It runs when somebody presses a button, so the budget is a frame or two
  // rather than a millisecond. Measured at 10 ms, and flat in the length of
  // the recording: the sweep for the loudest window is linear and cheap, and
  // everything after it works on one fixed window.
  const long = saw(110, 10);
  rootOf(long, rate);

  const began = performance.now();
  rootOf(long, rate);
  const took = performance.now() - began;
  assert.ok(took < 150, `ten seconds of audio took ${took.toFixed(0)} ms to read`);
});
