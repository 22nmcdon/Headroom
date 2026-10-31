// Moving a recording's pitch without moving its length.
//
// The claim that matters here is not a spectral distance, it is "what pitch
// did it actually come out at" - and the two are not the same question. The
// first version of this shifter did nothing at all for downward intervals
// and scored better on the spectral measure than any other row in its table,
// because an unshifted 220 Hz note is a perfect second harmonic of the 110
// it had been asked for. So every test below that moves a pitch reads the
// answer back with `lib/root.js` rather than trusting a distance.

import test from 'node:test';
import assert from 'node:assert/strict';

import { holdLength, stretchTo, canHoldLength, PSOLA_RANGE, GRAIN_PERIODS } from '../src/lib/psola.js';
import { rootOf, hzOfPitch } from '../src/lib/root.js';
import { pitchCore, PITCH_WINDOW } from '../src/lib/pitch.js';
import { fft } from '../src/lib/fft.js';

const rate = 48000;

const cents = (hz, want) => 1200 * Math.log2(hz / want);

/** Six harmonics at 1/n, with an attack and a release so it is a note. */
function note(hz, seconds = 1) {
  const out = new Float32Array(Math.round(rate * seconds));
  for (let i = 0; i < out.length; i += 1) {
    const t = i / rate;
    let v = 0;
    for (let n = 1; n <= 6 && n * hz < rate / 2; n += 1) v += Math.sin(2 * Math.PI * n * hz * t) / n;
    const env = Math.min(1, t / 0.01) * Math.min(1, (seconds - t) / 0.05);
    out[i] = 0.35 * v * Math.max(0, env);
  }
  return out;
}

const periodOf = (hz) => rate / hz;

/** Everything that is not a harmonic of `hz`, against everything that is. */
function junkAgainst(samples, hz, ceiling = 6000) {
  const N = 16384;
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const from = Math.max(0, Math.round(samples.length / 2) - N / 2);
  for (let i = 0; i < N; i += 1) {
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
    re[i] = (samples[from + i] ?? 0) * window;
  }
  fft(re, im);

  // To a ceiling and not to a count of harmonics. Crediting a fixed number
  // of them makes every downward shift look broken: an octave down has twice
  // as many harmonics under 6 kHz as the note it came from, and the ones
  // past the count get scored as junk.
  const wantedBins = new Set();
  for (let n = 1; n * hz <= ceiling; n += 1) {
    const bin = Math.round((n * hz * N) / rate);
    for (let k = bin - 2; k <= bin + 2; k += 1) wantedBins.add(k);
  }

  let total = 0;
  let wanted = 0;
  const top = Math.min(N / 2, Math.round((ceiling * N) / rate));
  for (let i = 1; i < top; i += 1) {
    const power = re[i] * re[i] + im[i] * im[i];
    total += power;
    if (wantedBins.has(i)) wanted += power;
  }
  return 10 * Math.log10(Math.max(total - wanted, 1e-30) / Math.max(wanted, 1e-30));
}

/* --- the thing it is for ---------------------------------------------------- */

test('the pitch moves and the length does not', () => {
  const played = note(220);
  const period = periodOf(220);

  // Measured, as what the detector reads back against what was asked for:
  //
  //     semitones   wanted     out by
  //          -24     55.0 Hz    2.0 cents
  //          -12    110.0       1.0
  //           -7    146.8       0.4
  //            0    220.0       0.0
  //            7    329.6       0.0
  //           12    440.0       0.1
  //           24    880.0       0.1
  for (const semitones of [-24, -12, -7, -5, -2, 0, 2, 5, 7, 12, 24]) {
    const ratio = 2 ** (semitones / 12);
    const out = holdLength(played, ratio, period);

    assert.equal(out.length, played.length, `${semitones} semitones changed the length`);

    const back = rootOf(out, rate);
    assert.ok(back.found, `${semitones} semitones came out with no pitch in it`);
    assert.ok(Math.abs(cents(back.hz, 220 * ratio)) < 10,
      `${semitones} semitones came out at ${back.hz.toFixed(1)} Hz,`
      + ` which is ${cents(back.hz, 220 * ratio).toFixed(0)} cents from the ${(220 * ratio).toFixed(1)} asked for`);
  }
});

test('an octave down really is an octave down, which the spectrum alone will not tell you', () => {
  // The regression for the bug this file's comment is about. A shifter that
  // does nothing scores -40 dB against a target an octave below, because the
  // signal it left alone is that target's second harmonic. Only asking what
  // pitch came out catches it.
  const played = note(220);
  const down = holdLength(played, 0.5, periodOf(220));

  assert.ok(junkAgainst(down, 110) < -25, 'the octave down is full of junk');
  // and the part the junk figure cannot see:
  assert.ok(Math.abs(cents(rootOf(down, rate).hz, 110)) < 10,
    `an octave down came out at ${rootOf(down, rate).hz.toFixed(1)} Hz rather than 110`);
  assert.ok(Math.abs(cents(rootOf(played, rate).hz, 220)) < 1, 'the material was not at 220 to begin with');
});

test('it beats the live shifter where the live shifter is heard on its own', () => {
  // The argument for a second shifter existing at all. The one in pitch.js
  // combs harder the further the ratio is from one, which is fine for a
  // detune in the side of a stereo pair and not for a sampler.
  const played = note(220);
  const period = periodOf(220);

  const comb = (ratio) => {
    const core = pitchCore(rate, PITCH_WINDOW);
    core.set({ ratio });
    const out = new Float32Array(played.length);
    for (let i = 0; i < played.length; i += 1) {
      core.stereo(played[i], played[i]);
      out[i] = core.left;
    }
    return out;
  };

  // Measured: an octave up reads +1.8 dB through the live shifter - more
  // junk than signal - against -30.9 through this one.
  for (const ratio of [0.5, 1.498, 2]) {
    const want = 220 * ratio;
    const cheap = junkAgainst(comb(ratio), want);
    const mine = junkAgainst(holdLength(played, ratio, period), want);
    assert.ok(mine < cheap - 8,
      `at a ratio of ${ratio} the live shifter read ${cheap.toFixed(1)} and this read ${mine.toFixed(1)},`
      + ' which is not enough of a gap to justify a second shifter');
  }

  // And at a detune, where the live one is good, this one has no business
  // claiming to be better - which is the other half of why both exist.
  const detune = 2 ** (9 / 1200);
  assert.ok(junkAgainst(comb(detune), 220 * detune) < -25,
    'the live shifter is supposed to be fine at nine cents');
});

test('stretching moves the length and leaves the pitch alone', () => {
  const played = note(220);
  const period = periodOf(220);

  for (const by of [0.25, 0.5, 1, 2, 4]) {
    const out = stretchTo(played, by, period);
    assert.equal(out.length, Math.round(played.length * by), `a stretch of ${by} came out the wrong length`);

    const back = rootOf(out, rate);
    assert.ok(back.found, `a stretch of ${by} lost the note`);
    assert.ok(Math.abs(cents(back.hz, 220)) < 10,
      `a stretch of ${by} moved the pitch to ${back.hz.toFixed(1)} Hz`);
  }
});

test('a ratio of one gives the recording back', () => {
  // Not by a special case in the code - grains laid down at the period they
  // were cut at reassemble the recording, and this is the claim that they
  // do. Measured at -40.7 dB of junk against the recording's own -40.8.
  const played = note(220);
  const through = holdLength(played, 1, periodOf(220));

  const was = junkAgainst(played, 220);
  const now = junkAgainst(through, 220);
  assert.ok(now < was + 1, `the round trip read ${now.toFixed(1)} against the material's ${was.toFixed(1)}`);
});

/* --- the cases where it should not try ------------------------------------- */

test('nonsense comes back as the recording rather than as a throw', () => {
  const played = note(220);
  const same = (out) => out.length === played.length && out.every((v, i) => v === played[i]);

  for (const [what, out] of [
    ['no period', holdLength(played, 2, 0)],
    ['a period of one sample', holdLength(played, 2, 1)],
    ['a ratio of nought', holdLength(played, 0, periodOf(220))],
    ['a ratio that is not a number', holdLength(played, NaN, periodOf(220))],
    ['a negative ratio', holdLength(played, -2, periodOf(220))],
  ]) {
    assert.ok(same(out), `${what} did something to the recording instead of nothing`);
  }

  assert.equal(holdLength(new Float32Array(0), 2, 100).length, 0, 'nothing in should be nothing out');
  assert.equal(stretchTo(new Float32Array(0), 2, 100).length, 0, 'nothing in should be nothing out');
});

test('the range says where it stops, and the sampler asks before it tries', () => {
  assert.deepEqual(PSOLA_RANGE, [0.25, 4]);
  assert.equal(GRAIN_PERIODS, 2);

  for (const ratio of [0.25, 0.5, 1, 2, 4]) assert.ok(canHoldLength(ratio), `${ratio} should be in range`);
  for (const ratio of [0.2, 4.1, 0, -1, NaN, Infinity, undefined]) {
    assert.ok(!canHoldLength(ratio), `${ratio} should be out of range`);
  }

  // The ends of the range are where it still works, not where it stops
  // working: 0.25 reads 55.1 Hz against 55.0, and 4 reads 880.1 against 880.
  const played = note(220);
  for (const ratio of PSOLA_RANGE) {
    const back = rootOf(holdLength(played, ratio, periodOf(220)), rate);
    assert.ok(Math.abs(cents(back.hz, 220 * ratio)) < 10,
      `at the ${ratio === PSOLA_RANGE[0] ? 'bottom' : 'top'} of the range it read ${back.hz.toFixed(1)} Hz`);
  }
});

test('it is quick enough to build a buffer per pitch', () => {
  // It runs once per pitch, cached, not once per note - so the budget is
  // "not audible when a part reaches a note it has not played yet". Measured
  // at 1.4 ms for a second of audio.
  const played = note(220, 2);
  holdLength(played, 1.5, periodOf(220));

  const began = performance.now();
  holdLength(played, 1.5, periodOf(220));
  const took = performance.now() - began;
  assert.ok(took < 60, `two seconds of audio took ${took.toFixed(1)} ms to shift`);
});

test('a stereo pair keeps its image, because both sides get the same period', () => {
  // Two channels shifted against two separately-read periods would drift
  // apart and take the image with them. The instrument shifts both with the
  // root's period, and this is the claim that doing so keeps them together.
  const left = note(220);
  const right = Float32Array.from(left, (v, i) => v * 0.8 + left[Math.max(0, i - 7)] * 0.2);

  const ratio = 1.498;
  const period = periodOf(220);
  const outL = holdLength(left, ratio, period);
  const outR = holdLength(right, ratio, period);

  // The two sides were a fixed relationship before and must still be one:
  // the difference between them should be about what it was, not a new
  // signal of its own.
  const before = junkAgainst(Float32Array.from(left, (v, i) => v - right[i]), 220);
  const after = junkAgainst(Float32Array.from(outL, (v, i) => v - outR[i]), 220 * ratio);
  assert.ok(Number.isFinite(before) && Number.isFinite(after));
  assert.ok(after < -10, `the difference between the two sides came out at ${after.toFixed(1)} dB of junk`);
});

test('what it cannot do, measured rather than asserted', () => {
  // A chord has no one period to cut grains on, and this is what that looks
  // like: hand it a fifth and the result is not the fifth a fifth up.
  const low = note(220);
  const high = note(330);
  const chord = Float32Array.from(low, (v, i) => (v + high[i]) * 0.5);
  const out = holdLength(chord, 1.498, periodOf(220));

  // Both notes should have moved together and one of them will not have.
  const top = junkAgainst(out, 330 * 1.498);
  assert.ok(top > -25,
    `a chord came through at ${top.toFixed(1)} dB of junk, which is clean enough that`
    + ' the claim about polyphony in psola.js wants re-making');
});
