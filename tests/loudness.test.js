// The loudness meter, held to the document it claims to implement.
//
// ITU-R BS.1770-4 prints its K-weighting coefficients at 48 kHz, and EBU Tech
// 3341 prints a set of signals and the readings a compliant meter has to give
// for them, with the tolerance written down. Both are checked here: the
// filters against the printed coefficients, and the meter against the
// signals.
//
// This is the only measurement in this app that can be checked against
// somebody else's answer rather than against its own renders, and that makes
// it worth doing properly. A loudness meter that is a decibel out is worse
// than no loudness meter, because it looks exactly like one that is right.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  kWeighting, kWeight, integrated, shortTerm, loudnessRange,
  truePeakOf, samplePeakOf, loudnessReading, loudnessGap,
  ABSOLUTE_GATE, BLOCK_MS,
} from '../src/analysis/loudness.js';
import { distance } from '../src/gap.js';

const RATE = 48000;

/** A sine at a level in dBFS, as a channel. */
function sine(db, seconds, { rate = RATE, hz = 1000 } = {}) {
  const amplitude = 10 ** (db / 20);
  const out = new Float64Array(Math.round(rate * seconds));
  for (let i = 0; i < out.length; i += 1) out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / rate);
  return out;
}

/** Several stretches of sine at different levels, end to end. */
function sequence(parts, { rate = RATE } = {}) {
  const pieces = parts.map(([db, seconds]) =>
    (db === null ? new Float64Array(Math.round(rate * seconds)) : sine(db, seconds, { rate })));
  const total = pieces.reduce((sum, piece) => sum + piece.length, 0);
  const out = new Float64Array(total);
  let at = 0;
  for (const piece of pieces) {
    out.set(piece, at);
    at += piece.length;
  }
  return out;
}

/** What the meter says about a stereo pair of identical channels. */
const readStereo = (channel, rate = RATE) =>
  integrated([kWeight(channel, rate), kWeight(channel, rate)], rate).lufs;

/* --- the filters ---------------------------------------------------------- */

test('the K-weighting reproduces the coefficients BS.1770 prints at 48 kHz', () => {
  // Table 1 and Table 2 of ITU-R BS.1770-4. The document gives five places;
  // these agree to ten, which says the shelf and high-pass below were
  // specified as the analogue filters they are rather than transcribed.
  const [shelf, highpass] = kWeighting(48000);

  assert.equal(shelf.b0.toFixed(10), '1.5351248596');
  assert.equal(shelf.b1.toFixed(10), '-2.6916961894');
  assert.equal(shelf.b2.toFixed(10), '1.1983928109');
  assert.equal(shelf.a1.toFixed(10), '-1.6906592932');
  assert.equal(shelf.a2.toFixed(10), '0.7324807742');

  assert.equal(highpass.b0.toFixed(6), '1.000000');
  assert.equal(highpass.b1.toFixed(6), '-2.000000');
  assert.equal(highpass.b2.toFixed(6), '1.000000');
  assert.equal(highpass.a1.toFixed(10), '-1.9900474548');
  assert.equal(highpass.a2.toFixed(10), '0.9900722504');
});

test('the K-weighting puts about +0.69 dB on a kilohertz, which is where the offset comes from', () => {
  // The whole reason the loudness equation carries a -0.691: a 1 kHz sine at
  // -23 dBFS has a mean square that reads -23.0 before the weighting, and the
  // only way to arrive back at -23.0 LUFS after subtracting 0.691 is for the
  // filters to have added it.
  const tone = sine(0, 2);
  const weighted = kWeight(tone, RATE);

  // Over the second half, so the filters have settled.
  const from = Math.round(RATE * 1);
  const rms = (xs) => {
    let sum = 0;
    for (let i = from; i < xs.length; i += 1) sum += xs[i] * xs[i];
    return Math.sqrt(sum / (xs.length - from));
  };

  const gain = 20 * Math.log10(rms(weighted) / rms(tone));
  assert.ok(Math.abs(gain - 0.691) < 0.01, `the weighting puts ${gain.toFixed(3)} dB on 1 kHz`);
});

test('the K-weighting is a high-pass with a shelf, not a tone control', () => {
  // What it is for: take out what a listener does not hear as loudness, and
  // tilt up what they hear more of. Measured at the same three places on
  // every machine this runs on.
  const at = (hz) => {
    const tone = sine(0, 2, { hz });
    const weighted = kWeight(tone, RATE);
    const from = Math.round(RATE * 1);
    const rms = (xs) => {
      let sum = 0;
      for (let i = from; i < xs.length; i += 1) sum += xs[i] * xs[i];
      return Math.sqrt(sum / (xs.length - from));
    };
    return 20 * Math.log10(rms(weighted) / rms(tone));
  };

  // Measured, at 48 kHz: -13.28 dB at 20 Hz, -8.30 at 30, -3.93 at 50, -1.13
  // at 100, +0.04 at 500, +0.70 at 1k, +3.07 at 2k and +4.04 from 5k up,
  // which is the published curve.
  assert.ok(Math.abs(at(20) + 13.28) < 0.1, `20 Hz reads ${at(20).toFixed(2)} dB`);
  assert.ok(Math.abs(at(100) + 1.13) < 0.1, `100 Hz reads ${at(100).toFixed(2)} dB`);
  assert.ok(Math.abs(at(1000) - 0.70) < 0.05);
  assert.ok(Math.abs(at(10000) - 4.04) < 0.1, `10 kHz reads ${at(10000).toFixed(2)} dB`);

  // And the shelf is flat above it rather than still climbing.
  assert.ok(Math.abs(at(16000) - at(10000)) < 0.05);
});

test('the filters are derived for whatever rate the audio arrived at', () => {
  // The browser picks the sample rate, and on a lot of machines it is 44.1.
  // A meter that only worked at 48 would be quietly wrong on those.
  for (const rate of [44100, 48000, 88200, 96000]) {
    const got = readStereo(sine(-23, 10, { rate }), rate);
    assert.ok(Math.abs(got + 23) < 0.1, `at ${rate} Hz a -23 dBFS sine reads ${got.toFixed(2)} LUFS`);
  }
});

/* --- EBU Tech 3341, the compliance signals -------------------------------- */

test('3341 case 1: a -23 dBFS sine reads -23.0 LUFS', () => {
  // The tolerance in the document is +/- 0.1 LU.
  const got = readStereo(sine(-23, 20));
  assert.ok(Math.abs(got + 23) <= 0.1, `read ${got.toFixed(3)} LUFS`);
});

test('3341 case 2: a -33 dBFS sine reads -33.0 LUFS', () => {
  const got = readStereo(sine(-33, 20));
  assert.ok(Math.abs(got + 33) <= 0.1, `read ${got.toFixed(3)} LUFS`);
});

test('3341 case 3: quiet either side of loud still reads the loud part', () => {
  // 10 s at -36, 60 s at -23, 10 s at -36. The relative gate is what makes
  // this -23: without it the quiet ends drag the answer down, which is the
  // whole reason the gate exists.
  const got = readStereo(sequence([[-36, 10], [-23, 60], [-36, 10]]));
  assert.ok(Math.abs(got + 23) <= 0.1, `read ${got.toFixed(3)} LUFS`);
});

test('3341 case 4: the same with wider steps reads the same', () => {
  // 10 s at -72, 10 s at -36, 60 s at -23, 10 s at -36, 10 s at -72. The -72
  // is under the absolute gate and the -36 is under the relative one, so both
  // are thrown away and the answer is the middle.
  const got = readStereo(sequence([[-72, 10], [-36, 10], [-23, 60], [-36, 10], [-72, 10]]));
  assert.ok(Math.abs(got + 23) <= 0.1, `read ${got.toFixed(3)} LUFS`);
});

test('3341 case 5: a run of levels around -23 averages to it', () => {
  // 20 s at -26, 20.1 s at -20, 20 s at -26. In power rather than in
  // decibels: averaging the logarithms would give -24 and the right answer is
  // -23.
  const got = readStereo(sequence([[-26, 20], [-20, 20.1], [-26, 20]]));
  assert.ok(Math.abs(got + 23) <= 0.1, `read ${got.toFixed(3)} LUFS`);
});

test('silence is not a loudness, and says so', () => {
  const quiet = new Float64Array(RATE * 5);
  assert.equal(readStereo(quiet), -Infinity);

  // And so is anything under the absolute gate on its own.
  const got = readStereo(sine(-80, 10));
  assert.equal(got, -Infinity, `a -80 dBFS sine read ${got}`);
  assert.ok(ABSOLUTE_GATE === -70);
});

test('a block is 400 ms and they overlap by three quarters', () => {
  // Which is what the document asks for, and what makes a four-second signal
  // thirty-seven blocks rather than ten.
  assert.equal(BLOCK_MS, 400);
  const { blocks } = integrated([kWeight(sine(-23, 4), RATE)], RATE);
  assert.equal(blocks.length, 37);
  assert.ok(Math.abs(blocks[1].at - 0.1) < 1e-9, 'a block starts every 100 ms');
});

/* --- the shape over time -------------------------------------------------- */

test('short-term loudness follows the signal, and is not gated', () => {
  // Ungated on purpose: this one is a picture of the piece rather than a
  // verdict on it, and the quiet passages are the interesting part of the
  // shape.
  //
  // Two channels, because BS.1770 sums them: the same signal on one channel
  // is a 3 dB quieter programme, and correctly reads as one.
  const channel = kWeight(sequence([[-23, 10], [-33, 10], [-23, 10]]), RATE);
  const series = shortTerm([channel, channel], RATE);

  const at = (seconds) => series.find((point) => point.at >= seconds).lufs;
  assert.ok(Math.abs(at(5) + 23) < 0.2, `at 5 s it reads ${at(5).toFixed(2)}`);
  assert.ok(Math.abs(at(15) + 33) < 0.2, `at 15 s it reads ${at(15).toFixed(2)}`);
  assert.ok(Math.abs(at(25) + 23) < 0.2);
  assert.ok(series.every((point) => Number.isFinite(point.lufs)), 'nothing was gated out');
});

test('the loudness range is the spread between the quiet and the loud', () => {
  // Ten decibels apart, in roughly equal measure, reads as about ten.
  const wide = kWeight(sequence([[-33, 20], [-23, 20]]), RATE);
  const got = loudnessRange([wide, wide], RATE);
  assert.ok(Math.abs(got - 10) < 1.5, `ten decibels of range read as ${got.toFixed(2)}`);

  // And a steady tone has none.
  const steady = kWeight(sine(-23, 30), RATE);
  assert.ok(loudnessRange([steady, steady], RATE) < 0.5);
});

/* --- the peak ------------------------------------------------------------- */

test('a true peak catches what happens between the samples', () => {
  // The case this exists for: a sine that straddles the sample grid reads
  // under full scale at every sample and goes over it in between. Half the
  // sample rate a quarter-cycle out of phase is the worst of it.
  const hz = RATE / 4;
  const amplitude = 10 ** (-0.5 / 20);
  const straddle = new Float64Array(RATE);
  for (let i = 0; i < straddle.length; i += 1) {
    straddle[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / RATE + Math.PI / 4);
  }

  const sampled = samplePeakOf(straddle);
  const actual = truePeakOf(straddle);
  assert.ok(actual > sampled + 1,
    `sample peak ${sampled.toFixed(2)} dBFS, true peak ${actual.toFixed(2)} dBTP`);
  assert.ok(Math.abs(actual + 0.5) < 0.3, `the true peak should be about -0.5 dBTP, not ${actual.toFixed(2)}`);
});

test('on a signal that lands on the grid the two peaks agree', () => {
  const tone = sine(-6, 1, { hz: 1000 });
  assert.ok(Math.abs(truePeakOf(tone) - samplePeakOf(tone)) < 0.1);
  assert.ok(Math.abs(samplePeakOf(tone) + 6) < 0.01);
});

/* --- the envelope --------------------------------------------------------- */

test('a loudness reading carries what it is a reading of', () => {
  const channel = sine(-23, 10);
  const reading = loudnessReading([channel, channel], RATE, { source: 'mix' });

  assert.equal(reading.tool, 'analysis');
  assert.equal(reading.kind, 'loudness');
  assert.equal(reading.ready, true);
  assert.equal(reading.of.source, 'mix');
  assert.equal(reading.of.axis.rate, RATE);
  assert.ok(Math.abs(reading.values.integrated + 23) < 0.1);
  assert.ok(Math.abs(reading.values.truePeak + 23) < 0.2);
  assert.ok(reading.values.short.length > 0);
});

test('two pieces of audio can be compared on loudness, through the shared distance', () => {
  const quiet = sine(-23, 10);
  const loud = sine(-17, 10);

  const a = loudnessReading([quiet, quiet], RATE);
  const b = loudnessReading([loud, loud], RATE);

  const gap = distance(a, b);
  assert.ok(Math.abs(gap.off - 6) < 0.1, `six decibels apart read as ${gap.off.toFixed(2)}`);
  assert.equal(gap.where, 'integrated');
  assert.ok(gap.detail.louder < 0, 'and mine is the quieter of the two');

  // The direct comparator says the same thing, with the sign on it.
  assert.ok(loudnessGap(a, b).off < 0);
  assert.ok(loudnessGap(b, a).off > 0);
});

test('a loudness reading refuses to be compared with one at a different rate', () => {
  // The axis carries the rate and the block length, and two series measured
  // over different windows are not two measurements of the same thing.
  const a = loudnessReading([sine(-23, 5)], RATE);
  const b = loudnessReading([sine(-23, 5, { rate: 44100 })], 44100);
  assert.throws(() => distance(a, b), /different axes/);
});
