// The analysis pillar: reading a track back rather than asking about one.
//
// Four readings, and the loudness one has a document to be held to, so it has
// a file of its own. These three have no standard behind them, so what is
// checked is what the codebase checks everywhere else: that a signal built to
// have a known property reads as having it, and that two readings of two
// different things come apart in the direction they should.

import test from 'node:test';
import assert from 'node:assert/strict';

import { crestOf, crestReading, crestGap, CREST_WINDOW_MS } from '../src/analysis/dynamics.js';
import {
  balanceOf, balanceReading, balanceGap, THIRDS, THIRD_NAMES, TILT, nameOfThird,
} from '../src/analysis/balance.js';
import { widthReading, widthGap } from '../src/analysis/width.js';
import { distance } from '../src/gap.js';

const RATE = 48000;

const sine = (db, seconds, hz = 1000, rate = RATE) => {
  const a = 10 ** (db / 20);
  const out = new Float32Array(Math.round(rate * seconds));
  for (let i = 0; i < out.length; i += 1) out[i] = a * Math.sin((2 * Math.PI * hz * i) / rate);
  return out;
};

/** White noise, seeded so every run reads the same. */
function noise(db, seconds, rate = RATE, seed = 1) {
  const a = 10 ** (db / 20);
  const out = new Float32Array(Math.round(rate * seconds));
  let s = seed >>> 0;
  for (let i = 0; i < out.length; i += 1) {
    s = (s * 1664525 + 1013904223) >>> 0;
    out[i] = a * ((s / 4294967296) * 2 - 1);
  }
  return out;
}

/** A train of short bursts in a lot of silence: a very peaky signal. */
function clicks(seconds, { rate = RATE, every = 0.25, length = 0.004 } = {}) {
  const out = new Float32Array(Math.round(rate * seconds));
  for (let at = 0; at + every * rate < out.length; at += every * rate) {
    for (let i = 0; i < length * rate; i += 1) {
      out[Math.round(at) + i] = 0.9 * Math.exp(-i / (rate * 0.0008));
    }
  }
  return out;
}

/* --- crest factor --------------------------------------------------------- */

test('a sine has the crest factor a sine has, and noise has noise’s', () => {
  // A sine's peak is sqrt(2) times its RMS, which is 3.01 dB, whatever level
  // it is at. It is the one signal whose answer can be worked out on paper.
  const tone = crestOf([sine(-6, 2)], RATE);
  assert.ok(Math.abs(tone.crest - 3.01) < 0.05, `a sine read ${tone.crest.toFixed(2)} dB`);
  assert.ok(Math.abs(tone.peak + 6) < 0.05);

  // And uniform noise has one too: its peak is its limit and its RMS is that
  // over the square root of three, which is 4.77 dB. (Gaussian noise, which
  // is what a real recording's hiss is, sits nearer twelve - the point here
  // is that the measurement agrees with arithmetic on a signal whose answer
  // is known, not that 4.77 is a typical number.)
  const hiss = crestOf([noise(-12, 2)], RATE);
  assert.ok(Math.abs(hiss.crest - 4.77) < 0.2, `uniform noise read ${hiss.crest.toFixed(2)} dB`);
});

test('the crest factor is what shows limiting, which is what it is here for', () => {
  // The same clicks, once untouched and once with everything over a quarter
  // of full scale flattened. Nothing about the level changed; the dynamics
  // did, and that is the whole measurement.
  const open = clicks(4);
  const squashed = Float32Array.from(open, (x) => Math.max(-0.25, Math.min(0.25, x)));

  // Measured: 28.1 dB open, 22.7 dB flattened. The drop is smaller than the
  // 11 dB taken off the peak because flattening the peaks takes some of the
  // body with them - which is exactly why this is read as a ratio and not as
  // a peak level.
  const before = crestOf([open], RATE).crest;
  const after = crestOf([squashed], RATE).crest;
  assert.ok(before - after > 4,
    `limiting took the crest factor from ${before.toFixed(1)} to ${after.toFixed(1)} dB`);
});

test('crest factor over time finds the tightest moment, not just the average', () => {
  // Half a track open and half of it flattened. The overall figure is a
  // compromise between them and says neither; the series says both.
  const open = clicks(4);
  const squashed = Float32Array.from(clicks(4), (x) => Math.max(-0.25, Math.min(0.25, x)));
  const both = new Float32Array(open.length + squashed.length);
  both.set(open, 0);
  both.set(squashed, open.length);

  const reading = crestReading([both], RATE);
  assert.ok(reading.values.widest - reading.values.tightest > 4,
    'the two halves should not read the same');
  assert.ok(reading.values.tightest < reading.values.crest,
    'and the tightest window is tighter than the whole');

  // Note what is NOT asserted: that the whole sits between the two. On a
  // sparse signal it does not - the overall RMS has all the silence between
  // the hits in it and the windows do not, so the whole reads wider than any
  // window of it. Which is the reason the series is kept at all.
  assert.equal(reading.of.axis.window, CREST_WINDOW_MS);
});

test('silence is left out of the series rather than printed as a ratio', () => {
  // The crest factor of nothing is one very small number over another, which
  // comes out as whatever the arithmetic happened to do.
  const quiet = new Float32Array(RATE * 2);
  const some = new Float32Array(RATE * 4);
  some.set(sine(-12, 2), 0);
  some.set(quiet, RATE * 2);

  const reading = crestReading([some], RATE);
  assert.ok(reading.values.over.length > 0);
  assert.ok(reading.values.over.every((point) => point.at < 2.1),
    'the silent half should contribute no windows');
});

test('two tracks can be compared on dynamics, through the shared distance', () => {
  const open = crestReading([clicks(3)], RATE);
  const squashed = crestReading(
    [Float32Array.from(clicks(3), (x) => Math.max(-0.25, Math.min(0.25, x)))], RATE);

  const gap = distance(open, squashed);
  assert.ok(gap.off > 4, `they should be far apart, not ${gap.off.toFixed(2)} dB`);
  assert.equal(gap.where, 'overall');
  assert.ok(crestGap(open, squashed).detail.wider > 0, 'mine is the more dynamic');
  assert.ok(crestGap(squashed, open).detail.wider < 0);
});

/* --- spectral balance ----------------------------------------------------- */

test('each third is named the way an engineer names it, not by its centre', () => {
  // The band at 1000 * 2 ** (-4/3) is 396.85 Hz and everybody calls it 400.
  assert.equal(THIRD_NAMES.length, THIRDS.length);
  assert.equal(nameOfThird(THIRDS[12]), '400 Hz');
  assert.equal(nameOfThird(1000), '1 kHz');
  assert.equal(nameOfThird(THIRDS[26]), '10 kHz');
  assert.equal(nameOfThird(16000), '16 kHz');
  assert.equal(nameOfThird(THIRDS[0]), '25 Hz');

  // And the names are in the order the centres are.
  for (let i = 1; i < THIRDS.length; i += 1) assert.ok(THIRDS[i] > THIRDS[i - 1]);
});

test('the grid is thirds of an octave, on the round numbers', () => {
  assert.equal(THIRDS.length, 29);
  assert.ok(THIRDS.includes(1000));
  assert.ok(THIRDS.includes(2000));
  assert.ok(THIRDS.includes(4000));
  assert.ok(THIRDS.includes(500));
  assert.ok(THIRDS[0] >= 24 && THIRDS[0] <= 26, `it starts at ${THIRDS[0]} Hz`);
  assert.equal(THIRDS[THIRDS.length - 1], 16000);

  // Each one is a third of an octave above the last.
  for (let i = 1; i < THIRDS.length; i += 1) {
    const ratio = THIRDS[i] / THIRDS[i - 1];
    assert.ok(Math.abs(ratio - 2 ** (1 / 3)) < 0.02, `${THIRDS[i - 1]} to ${THIRDS[i]}`);
  }
});

test('the spectrum finds a tone where the tone is', () => {
  const bands = balanceOf([sine(-6, 2, 1000)], RATE);
  const loudest = Object.entries(bands).reduce((a, b) => (b[1] > a[1] ? b : a));
  assert.equal(Number(loudest[0]), 1000);
  assert.ok(loudest[1] > 20, `the tone only stood ${loudest[1].toFixed(1)} dB over the average`);
});

test('the tilt is three decibels an octave, so a sloping mix reads level', () => {
  // Pink noise falls three decibels an octave, which is the slope the tilt
  // takes out - so pink reads flat and white reads as rising.
  assert.equal(TILT, 3);

  const white = balanceOf([noise(-12, 4)], RATE);
  const rise = white[8000] - white[250];
  assert.ok(rise > 10, `white noise should read as rising, not ${rise.toFixed(1)} dB`);
});

test('a reading is normalised to itself, so level is not balance', () => {
  // The same tonality at two levels is the same tonality. Level is the
  // loudness reading's business.
  const quiet = balanceOf([noise(-30, 3)], RATE);
  const loud = balanceOf([noise(-6, 3)], RATE);

  for (const hz of THIRDS) {
    assert.ok(Math.abs(quiet[hz] - loud[hz]) < 0.5,
      `${hz} Hz reads ${quiet[hz].toFixed(2)} quiet and ${loud[hz].toFixed(2)} loud`);
  }
});

test('the summary says where the weight is', () => {
  const dark = balanceReading([sine(-6, 2, 100)], RATE);
  assert.ok(dark.values.low > dark.values.high, 'a 100 Hz tone is a dark track');

  const bright = balanceReading([sine(-6, 2, 8000)], RATE);
  assert.ok(bright.values.high > bright.values.low);
});

test('two spectra are compared at their worst third, not averaged', () => {
  // Averaged across thirty-one bands, one band four decibels out is a tenth
  // of a decibel and reads as a match.
  const flat = balanceReading([noise(-12, 3)], RATE);
  const bumped = balanceReading([noise(-12, 3)], RATE);
  bumped.values.bands[1000] += 6;

  const gap = distance(flat, bumped);
  assert.ok(Math.abs(gap.off - 6) < 0.1, `the bump read as ${gap.off.toFixed(2)} dB`);
  assert.equal(gap.where, '1 kHz', 'and names the band the way an engineer does');
  assert.ok(balanceGap(bumped, flat).detail.hotter > 0, 'and mine is the hot one');
});

/* --- width ---------------------------------------------------------------- */

test('a mono file says it is mono rather than reporting a very narrow image', () => {
  // The two print differently on purpose: a true mono file and a stereo file
  // that collapsed by accident look identical in the numbers.
  const reading = widthReading([noise(-12, 2)], RATE);
  assert.equal(reading.values.mono, true);
  assert.equal(reading.kind, 'width');
  assert.equal(reading.tool, 'analysis');
});

test('a wide track reads wider than a narrow one, band by band', () => {
  const middle = noise(-12, 2, RATE, 1);
  const sides = noise(-12, 2, RATE, 99);

  const narrow = widthReading([middle, middle], RATE);
  const wide = widthReading([
    Float32Array.from(middle, (m, i) => m + sides[i]),
    Float32Array.from(middle, (m, i) => m - sides[i]),
  ], RATE);

  assert.ok(wide.values.whole.width > narrow.values.whole.width + 10,
    `narrow ${narrow.values.whole.width.toFixed(1)}, wide ${wide.values.whole.width.toFixed(1)}`);
  assert.equal(wide.values.mono, false);
  assert.ok(narrow.values.whole.correlation > 0.99, 'two identical channels are correlated');
  assert.ok(wide.values.whole.correlation < 0.5);
});

test('a low end spread too wide shows what a fold to mono would cost it', () => {
  // The fault the imager's rescue exercise is built on, read off a track
  // nobody asked a question about.
  const rate = RATE;
  const middle = noise(-12, 2, rate, 7);
  const low = new Float32Array(middle.length);
  // A slow wander, which is all low end: opposite in the two channels.
  for (let i = 0; i < low.length; i += 1) low[i] = 0.5 * Math.sin((2 * Math.PI * 60 * i) / rate);

  const spread = widthReading([
    Float32Array.from(middle, (m, i) => m + low[i]),
    Float32Array.from(middle, (m, i) => m - low[i]),
  ], rate);
  const safe = widthReading([
    Float32Array.from(middle, (m, i) => m + low[i]),
    Float32Array.from(middle, (m, i) => m + low[i]),
  ], rate);

  assert.ok(spread.values.lowCost < -3,
    `a hard-spread low end should cost something, not ${spread.values.lowCost.toFixed(2)} dB`);
  assert.ok(safe.values.lowCost > spread.values.lowCost + 2,
    'and a centred one should cost less');
});

test('two images are compared by the imager’s own arithmetic', () => {
  const middle = noise(-12, 2, RATE, 3);
  const sides = noise(-12, 2, RATE, 4);

  const narrow = widthReading([middle, middle], RATE);
  const wide = widthReading([
    Float32Array.from(middle, (m, i) => m + sides[i]),
    Float32Array.from(middle, (m, i) => m - sides[i]),
  ], RATE);

  const gap = distance(narrow, wide);
  assert.ok(gap.off > 5, `they should be far apart, not ${gap.off.toFixed(2)}`);
  assert.ok(gap.where, 'and it should say which band');
  assert.deepEqual(widthGap(narrow, wide).detail.wider < 0, true, 'mine is the narrow one');
});

/* --- all four together ---------------------------------------------------- */

test('every analysis reading carries the same envelope, and refuses the wrong partner', () => {
  const channel = noise(-12, 2);
  const readings = [
    crestReading([channel], RATE, { source: 'yours' }),
    balanceReading([channel], RATE, { source: 'yours' }),
    widthReading([channel], RATE, { source: 'yours' }),
  ];

  for (const reading of readings) {
    assert.equal(reading.tool, 'analysis');
    assert.equal(reading.ready, true);
    assert.equal(reading.of.source, 'yours');
    assert.ok(reading.of.axis, `${reading.kind} has no axis`);
    assert.ok(reading.of.state, `${reading.kind} does not say what it is of`);
  }

  // And no two kinds can be compared with each other, which is the whole
  // reason the envelope carries a kind at all.
  for (const a of readings) {
    for (const b of readings) {
      if (a.kind === b.kind) continue;
      assert.throws(() => distance(a, b), /cannot be compared/);
    }
  }
});
