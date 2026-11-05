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
  ABSOLUTE_GATE, BLOCK_MS, floorOf, saidFloor,
} from '../src/lib/loudness.js';
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

test('silence has no peak, sampled or true, and the two agree on it', () => {
  // The sample peak used to floor at -240 while the true peak said -Infinity,
  // which put the true peak of a silent file under its own sample peak.
  const quiet = new Float64Array(RATE);
  assert.equal(samplePeakOf(quiet), -Infinity);
  assert.equal(truePeakOf(quiet), -Infinity);
  assert.ok(!(truePeakOf(quiet) < samplePeakOf(quiet)));
});

test('no channels at all is a reading of nothing, not a hang', () => {
  // Math.min() of no lengths is Infinity, and the block loop ran to it.
  assert.equal(integrated([], RATE).lufs, -Infinity);
  const reading = loudnessReading([], RATE);
  assert.equal(reading.values.integrated, -Infinity);
  assert.deepEqual(reading.values.short, []);
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

/* --- the noise under a recording ----------------------------------------- */

// The measurement this app is for, pointed at the thing people actually ask
// about: how much of what came back is the room and the microphone rather
// than the playing. Nothing software does lowers a microphone's self-noise,
// so the useful answer is a number - whether moving closer or changing the
// microphone is worth the trouble, or whether the level was simply set low.
//
// Windows of RMS rather than single samples, and percentiles rather than the
// extremes:
//
//   * The quietest SAMPLE is a zero crossing, which every signal has. It
//     reports a floor nobody has.
//   * The quietest WINDOW is a digitally silent lead-in, if there is one -
//     and a take that was gated, or trimmed, would read as having no noise
//     at all when the gaps between the notes are full of it.
//   * The loudest window against the quietest is apples to apples. A sample
//     peak against an RMS floor is 3 dB of flattery on a sine and more on
//     anything peakier.

test('a recording reports the floor under it and the room above it', () => {
  // Built to a known answer: half-second bursts of a 0.5 sine over uniform
  // noise at 0.001, which is -9.03 dB RMS against -64.77 dB RMS. Worked out
  // before the function was written, not read off it afterwards.
  const rate = 48000;
  const frames = rate * 8;
  const run = new Float32Array(frames);
  let seed = 1;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed / 0x7fffffff) * 2 - 1; };
  for (let i = 0; i < frames; i += 1) {
    const loud = Math.floor(i / (rate * 0.5)) % 2 === 0;
    run[i] = 0.001 * rnd() + (loud ? Math.sin((2 * Math.PI * 220 * i) / rate) * 0.5 : 0);
  }

  const read = floorOf([run], rate);
  assert.ok(Math.abs(read.floor - -64.77) < 0.5, `floor read ${read.floor.toFixed(2)}`);
  assert.ok(Math.abs(read.signal - -9.03) < 0.5, `signal read ${read.signal.toFixed(2)}`);
  assert.ok(Math.abs(read.range - 55.75) < 1, `range read ${read.range.toFixed(2)}`);
});

test('a louder floor is a smaller range, by exactly the amount', () => {
  // Ten times the noise is twenty decibels of it, and the range has to shrink
  // by the same twenty - otherwise the number is not measuring what it says.
  const rate = 48000;
  const make = (noise) => {
    const run = new Float32Array(rate * 4);
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed / 0x7fffffff) * 2 - 1; };
    for (let i = 0; i < run.length; i += 1) {
      const loud = Math.floor(i / (rate * 0.5)) % 2 === 0;
      run[i] = noise * rnd() + (loud ? Math.sin((2 * Math.PI * 220 * i) / rate) * 0.5 : 0);
    }
    return floorOf([run], rate);
  };

  const quiet = make(0.0001);
  const noisy = make(0.001);
  assert.ok(Math.abs((noisy.floor - quiet.floor) - 20) < 1,
    `floor moved ${(noisy.floor - quiet.floor).toFixed(2)} dB for ten times the noise`);
  assert.ok(Math.abs((quiet.range - noisy.range) - 20) < 1,
    `range moved ${(quiet.range - noisy.range).toFixed(2)} dB`);
});

test('digital silence is not a floor anybody measured', () => {
  // A real microphone always has self-noise, so a window of exact zeros means
  // something gated it or it was never recorded. Counting those would report
  // a take as having no noise in it while the gaps hiss.
  const rate = 48000;
  const run = new Float32Array(rate * 4);
  for (let i = 0; i < rate; i += 1) run[i] = 0; // a silent lead-in
  let seed = 3;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed / 0x7fffffff) * 2 - 1; };
  for (let i = rate; i < run.length; i += 1) {
    const loud = Math.floor(i / (rate * 0.5)) % 2 === 0;
    run[i] = 0.002 * rnd() + (loud ? Math.sin((2 * Math.PI * 220 * i) / rate) * 0.5 : 0);
  }

  const read = floorOf([run], rate);
  assert.ok(read.floor > -70, `the silent second was counted as the floor: ${read.floor}`);
  assert.ok(read.silent > 0, 'and it is reported rather than quietly dropped');
});

test('a take of nothing but silence says so rather than dividing by it', () => {
  const read = floorOf([new Float32Array(48000)], 48000);
  assert.equal(Number.isFinite(read.range), true, 'no NaN out of an empty take');
  assert.equal(read.measured, 0, 'nothing was measurable, and it says so');
});

test('too short to measure is said, not guessed at', () => {
  // A window is 50 ms, so a take under about half a second has too few of
  // them for a percentile to mean anything.
  const read = floorOf([new Float32Array(1000)], 48000);
  assert.ok(read.measured < 4);
  assert.equal(read.enough, false);
});

test('nothing at all is nothing, not a throw', () => {
  assert.equal(floorOf([], 48000).measured, 0);
  assert.equal(floorOf(null, 48000).measured, 0);
});

test('the reading is turned into the decision it bears on', () => {
  // Two different problems look identical as a range and have opposite
  // answers. Recorded quietly, the fix is the level or the distance and
  // costs nothing. Recorded loudly and still noisy, the microphone or the
  // room is the limit and no setting touches it.
  //
  // The boundaries are the physics of the hardware most of this runs on: a
  // phone's MEMS microphones sit around 30 dBA of self-noise, so a voice at
  // 20 cm - about 75 dB SPL - leaves roughly 45 dB of range, and the same
  // phone across a room from a piano at 60 dB SPL leaves about 30.
  const quietly = saidFloor({ floor: -72, signal: -42, range: 30, enough: true }, -24);
  assert.match(quietly, /level|closer|louder/i);

  const loudly = saidFloor({ floor: -34, signal: -6, range: 28, enough: true }, -1.2);
  assert.match(loudly, /microphone|room/i);
  assert.doesNotMatch(loudly, /turn it up|louder/i,
    'telling somebody already at full scale to go louder is advice that cannot be taken');

  const clean = saidFloor({ floor: -78, signal: -10, range: 68, enough: true }, -3 );
  assert.doesNotMatch(clean, /microphone|closer/i, 'nothing to fix is nothing to suggest');
});

test('too little to read says so rather than advising from noise', () => {
  const said = saidFloor({ floor: -60, signal: -20, range: 40, enough: false, measured: 2 }, -6);
  assert.match(said, /too short|not enough/i);
});

test('the sentence always names the two numbers it is about', () => {
  const said = saidFloor({ floor: -64.8, signal: -9, range: 55.8, enough: true }, -3.1);
  assert.match(said, /-64\.8|64\.8/);
  assert.match(said, /55\.8|56/);
});

test('a take that is mostly digital silence says so instead of reporting a range', () => {
  // Found by driving the real recorder: Chromium's fake microphone is exactly
  // zero for 97% of its samples, so 91 windows of 100 were excluded as not
  // being a floor anybody measured and the range came from the 9 that were
  // left - all the same beep, so it read "0.0 dB of range". True of those
  // nine windows and not a fact about the take.
  //
  // No real microphone does this; a real one always has self-noise. But a
  // gated take, a trimmed one, or a dropout does, and a reading drawn from
  // the remainder should admit what it is drawn from.
  const rate = 48000;
  const run = new Float32Array(rate * 5);
  // One beep a second, silence in between, as the fake device behaves.
  for (let s = 0; s < 5; s += 1) {
    const from = s * rate;
    for (let i = 0; i < Math.round(rate * 0.03); i += 1) {
      run[from + i] = Math.sin((2 * Math.PI * 1000 * i) / rate) * 0.9;
    }
  }

  const read = floorOf([run], rate);
  assert.ok(read.silent > read.measured, 'most of it is not a measurement');
  assert.equal(read.mostlySilent, true);
  assert.match(saidFloor(read, -0.9), /silen/i,
    'and the sentence leads with that rather than with a range from the remainder');
});
