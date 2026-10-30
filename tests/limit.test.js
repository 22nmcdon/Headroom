// The only thing a ceiling has to do is be one.
//
// The node this replaced was measured at 2.92 dB over its own ceiling on
// transient material, so the assertion here is not "close enough" - it is that
// no sample, on any signal, comes out above the ceiling.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  makeLimiter, cutTo, LIMIT_AHEAD, LIMIT_RELEASE, CEILING_DB,
} from '../src/lib/limiter.js';
import {
  spectrumThrough, seriesOf, PROBE_BIN, PROBE_LENGTH,
} from '../src/lib/harmonics.js';
import { mulberry32 } from '../src/lib/random.js';
import { truePeakOf, peakPhases } from '../src/lib/loudness.js';
import { limiterSource } from '../src/lib/limiter-node.js';

/** How far a buffer's reconstruction goes over the ceiling, in dB. */
const truePeakAbove = (samples) => truePeakOf(samples) - CEILING_DB;

const RATE = 48000;
const ROOF = 10 ** (CEILING_DB / 20);

/** Through the limiter in blocks, as an audio callback would hand it over. */
function through(samples, over = {}, span = 128) {
  const limiter = makeLimiter(RATE, over);
  const out = new Float32Array(samples.length);
  for (let at = 0; at < samples.length; at += span) {
    const block = samples.slice(at, Math.min(at + span, samples.length));
    limiter.block([block]);
    out.set(block, at);
  }
  return out;
}

const peakOf = (samples) => {
  let peak = 0;
  for (const v of samples) peak = Math.max(peak, Math.abs(v));
  return peak;
};

/* --- the signals it has to hold ------------------------------------------- */

const SIGNALS = {
  'a steady tone, 20 dB over': () => {
    const n = RATE;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i += 1) out[i] = Math.sin((2 * Math.PI * 220 * i) / RATE) * 10;
    return out;
  },

  'clicks, one sample each': () => {
    const n = RATE;
    const out = new Float32Array(n);
    for (let k = 0; k < 40; k += 1) out[Math.round(k * 0.025 * RATE)] = k % 2 ? 24 : -24;
    return out;
  },

  'a step onto full level': () => {
    const n = RATE;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i += 1) out[i] = i < RATE * 0.3 ? 0 : 8;
    return out;
  },

  'hits over a sustained bed': () => {
    const n = Math.round(RATE * 2);
    const out = new Float32Array(n);
    const rng = mulberry32(4242);
    for (let i = 0; i < n; i += 1) out[i] = Math.sin((2 * Math.PI * 70 * i) / RATE) * 0.8;
    for (let k = 0; k < 12; k += 1) {
      const at = Math.round(k * 0.16 * RATE);
      for (let i = 0; i < Math.round(RATE * 0.02) && at + i < n; i += 1) {
        out[at + i] += Math.exp(-(i / RATE) * 180) * (rng() * 2 - 1) * 14;
      }
    }
    return out;
  },

  'noise, loud': () => {
    const n = RATE;
    const out = new Float32Array(n);
    const rng = mulberry32(99);
    for (let i = 0; i < n; i += 1) out[i] = (rng() * 2 - 1) * 6;
    return out;
  },

  'already quiet': () => {
    const n = RATE;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i += 1) out[i] = Math.sin((2 * Math.PI * 440 * i) / RATE) * 0.2;
    return out;
  },
};

test('no sample comes out above the ceiling, on anything', () => {
  for (const [name, make] of Object.entries(SIGNALS)) {
    const out = through(make());
    const peak = peakOf(out);
    assert.ok(peak <= ROOF + 1e-6,
      `${name} came out at ${(20 * Math.log10(peak)).toFixed(2)} dB, over the `
      + `${CEILING_DB} dB ceiling`);
  }
});

test('the block size it is handed does not change what comes out', () => {
  // An audio callback picks the block size, not this file. If the answer
  // depended on it, the sketch would sound different in a worklet from in a
  // render, which is the class of bug the EQ's worklet was built to end.
  const signal = SIGNALS['hits over a sustained bed']();
  const once = through(signal, {}, signal.length);
  for (const span of [1, 7, 128, 512, 4096]) {
    const got = through(signal, {}, span);
    let worst = 0;
    for (let i = 0; i < got.length; i += 1) worst = Math.max(worst, Math.abs(got[i] - once[i]));
    assert.ok(worst < 1e-6, `a block of ${span} differs by ${worst.toExponential(2)}`);
  }
});

test('it leaves alone what is already under the ceiling', () => {
  // A safety limiter that colours a quiet sketch is a safety limiter nobody
  // should have in the path. Delayed by the lookahead, and otherwise the
  // samples it was given.
  const signal = SIGNALS['already quiet']();
  const out = through(signal);
  const ahead = Math.round(LIMIT_AHEAD * RATE);

  let worst = 0;
  for (let i = ahead; i < signal.length; i += 1) {
    worst = Math.max(worst, Math.abs(out[i] - signal[i - ahead]));
  }
  assert.ok(worst < 1e-6, `a quiet signal came back changed by ${worst.toExponential(2)}`);
});

test('the gain is in place before the peak it is for arrives', () => {
  // Which is the whole reason for the lookahead, and the thing the three
  // millisecond attack on the node this replaced could not do. A single
  // sample at twenty-four times full scale, with silence either side: the
  // limiter has to be down by the time it comes through, and it cannot be
  // down before it has any reason to be.
  const n = Math.round(RATE * 0.2);
  const signal = new Float32Array(n);
  const spike = Math.round(n / 2);
  signal[spike] = 24;

  const out = through(signal);
  assert.ok(Math.abs(out[spike + Math.round(LIMIT_AHEAD * RATE)]) <= ROOF + 1e-6,
    'the spike came through over the ceiling');

  // And nothing else moved: the signal either side of it was already silent,
  // so a limiter that pumped would show up as something other than zero.
  let elsewhere = 0;
  for (let i = 0; i < n; i += 1) {
    if (i === spike + Math.round(LIMIT_AHEAD * RATE)) continue;
    elsewhere = Math.max(elsewhere, Math.abs(out[i]));
  }
  assert.equal(elsewhere, 0, 'silence either side of the spike did not stay silent');
});

test('both channels move together, so the image does not', () => {
  // One gain across the channels. A limiter that worked each side separately
  // would swing the image every time it bit, which on a sketch bus is worse
  // than the overs it is there to catch.
  const n = Math.round(RATE * 0.5);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    left[i] = Math.sin((2 * Math.PI * 220 * i) / RATE) * 9;   // loud
    right[i] = Math.sin((2 * Math.PI * 220 * i) / RATE) * 0.5; // quiet
  }

  const limiter = makeLimiter(RATE);
  limiter.block([left, right]);

  // The ratio between the sides is what the image is, and it has to survive.
  const ahead = limiter.ahead;
  for (let i = ahead + 100; i < n; i += 97) {
    if (Math.abs(right[i]) < 1e-4) continue;
    const ratio = Math.abs(left[i] / right[i]);
    assert.ok(Math.abs(ratio - 18) < 0.2,
      `the sides came out ${ratio.toFixed(2)} apart rather than 18`);
  }
  assert.ok(peakOf(left) <= ROOF + 1e-6, 'and the loud side is still under the ceiling');
});

test('a ceiling of its own is honoured', () => {
  for (const ceiling of [0, -3, -12]) {
    const roof = 10 ** (ceiling / 20);
    const out = through(SIGNALS['hits over a sustained bed'](), { ceiling });
    assert.ok(peakOf(out) <= roof + 1e-6,
      `asked for ${ceiling} dB, got ${(20 * Math.log10(peakOf(out))).toFixed(2)}`);
  }
});

/* --- the ceiling an encoder sees ------------------------------------------ */

/**
 * Material that ends in silence, because a true peak read off a buffer that
 * stops mid-waveform is measuring the truncation rather than the signal.
 *
 * This cost four wrong hypotheses before the test signals were looked at
 * instead of the code: a 750 Hz tone whose last samples were still climbing
 * read 0.89 dB over a ceiling the limiter was in fact holding exactly, and
 * the ringing of the reconstruction past the cut was all of it. Real audio
 * ends in silence; test material has to be made to.
 */
function faded(samples, fade = 512) {
  const out = Float32Array.from(samples);
  for (let i = 0; i < fade && i < out.length / 2; i += 1) {
    const w = i / fade;
    out[i] *= w;
    out[out.length - 1 - i] *= w;
  }
  return out;
}

test('the sample ceiling is not a true-peak ceiling, and by a long way', () => {
  // Why the mode exists. The samples are held exactly either way - that is
  // what the tests above are for - and the waveform between them is not.
  // Measured, as how far over a -1 dBFS ceiling each kind goes:
  //
  //     material        sample-peak mode   true-peak mode
  //     square 997 Hz         1.854           -0.000
  //     clicks                0.830           -0.000
  //     hits                  3.173            0.000
  //     noise                 3.451            0.003
  const noise = mulberry32(7);
  const n = RATE;
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i += 1) raw[i] = (noise() * 2 - 1) * 3;
  const material = faded(raw);

  const loose = truePeakAbove(through(material));
  const tight = truePeakAbove(through(material, { truePeak: true }));

  assert.ok(loose > 2, `the sample detector should be well over on noise, and read ${loose.toFixed(3)}`);
  assert.ok(tight < 0.05, `the true-peak detector should hold it, and read ${tight.toFixed(3)}`);
});

test('the true-peak ceiling holds on everything, including between the samples', () => {
  const noise = mulberry32(31);
  const n = RATE / 2;
  const kinds = {
    'square at 997': (i) => Math.sign(Math.sin((2 * Math.PI * 997 * i) / RATE)) * 2,
    'clicks': (i) => ((i % 2400 < 3) ? (i % 2 ? -1 : 1) * 3 : 0),
    'noise': () => (noise() * 2 - 1) * 3,
    'a sine right up at 9250': (i) => Math.sin((2 * Math.PI * 9250 * i) / RATE) * 3,
  };

  for (const [name, make] of Object.entries(kinds)) {
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i += 1) raw[i] = make(i);
    const out = through(faded(raw), { truePeak: true });

    // The samples, as ever.
    for (let i = 0; i < out.length; i += 1) {
      assert.ok(Math.abs(out[i]) <= ROOF + 1e-6,
        `${name} put a sample ${(20 * Math.log10(Math.abs(out[i]) / ROOF)).toFixed(3)} dB over`);
    }
    // And the waveform they describe.
    const over = truePeakAbove(out);
    assert.ok(over < 0.05, `${name} reconstructs ${over.toFixed(3)} dB over the ceiling`);
  }
});

test('the phases are not all the same length, which is how this failed first', () => {
  // The detector used phase zero's thirteen taps for all four, so the last tap
  // of the other three read `undefined`, every sum came out NaN, and
  // `NaN > loudest` is false - so the detector contributed exactly nothing and
  // said nothing about it. The symptom was a true-peak mode that measured
  // identically to the sample-peak one.
  const lengths = peakPhases().map((phase) => phase.length);
  assert.deepEqual(lengths, [13, 12, 12, 12],
    'a 49-tap prototype splits four ways unevenly, and the detector has to allow for it');
});

test('the audio thread gets the same limiter, true peak and all', () => {
  // The seam the delay's worklet already paid for once: a part or a constant
  // left off the list fails inside a blob on the audio thread, where a stack
  // trace is a line number. So the worklet's own source is run here and its
  // limiter is held against this one, sample for sample.
  const source = limiterSource();
  assert.ok(source.includes('makeLimiter'), 'the audio thread needs the limiter');
  assert.ok(source.includes('LIMIT_PHASES'),
    'and the interpolator, as numbers rather than as the function that builds them');
  assert.ok(!source.includes('peakPhases('),
    'calling that function there would close over a PHASES the worklet never built');

  const theirs = new Function(`${source.replace(/class HeadroomLimiter[\s\S]*$/, '')}; return makeLimiter;`)();

  // The knobs have to reach the audio thread as well. A `set` that exists in
  // the module and not in the worklet is a ceiling knob that does nothing,
  // and it would look like a wiring fault rather than a missing method.
  assert.equal(typeof theirs(RATE, {}).set, 'function',
    'the stringified limiter has to carry its setters');
  assert.ok(source.includes('this.limiter.set('),
    'and the processor has to call them when a message arrives');

  const noise = mulberry32(55);
  const n = 8192;
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i += 1) raw[i] = (noise() * 2 - 1) * 3;
  const material = faded(raw);

  for (const truePeak of [false, true]) {
    const mine = through(material, { truePeak });
    const other = (() => {
      const limiter = theirs(RATE, { truePeak });
      const out = Float32Array.from(material);
      for (let at = 0; at < out.length; at += 128) {
        limiter.block([out.subarray(at, Math.min(at + 128, out.length))]);
      }
      return out;
    })();

    for (let i = 0; i < n; i += 1) {
      assert.ok(Math.abs(mine[i] - other[i]) < 1e-12,
        `the two limiters parted company at sample ${i} with truePeak ${truePeak}`);
    }
  }
});

/* --- knobs that can be turned while it runs -------------------------------- */

/** Through the limiter in blocks, with a change made part way. */
function changedHalfway(samples, over, next, span = 128) {
  const limiter = makeLimiter(RATE, over);
  const out = new Float32Array(samples.length);
  const half = Math.round(samples.length / 2 / span) * span;
  for (let at = 0; at < samples.length; at += span) {
    if (at === half) limiter.set(next);
    const block = samples.slice(at, Math.min(at + span, samples.length));
    limiter.block([block]);
    out.set(block, at);
  }
  return { out, half };
}

test('a ceiling moved while it runs is held from there on', () => {
  const signal = SIGNALS['hits over a sustained bed']();
  const { out, half } = changedHalfway(signal, {}, { ceiling: -9 });

  // From the change plus the lookahead, which is the audio that was already
  // held when the knob moved and was promised the old ceiling.
  const limiter = makeLimiter(RATE, {});
  const after = out.subarray(half + limiter.ahead);
  const roof = 10 ** (-9 / 20);
  assert.ok(peakOf(after) <= roof + 1e-6,
    `asked for -9 dB, got ${(20 * Math.log10(peakOf(after))).toFixed(2)}`);

  // And the first half is still the ceiling it was built with, so the change
  // is a change rather than a retune of everything.
  assert.ok(peakOf(out.subarray(0, half)) > roof * 1.5,
    'the first half should still be at the ceiling it started with');
});

test('setting a knob is the same as having built it that way', () => {
  // The two differ in exactly one thing at the moment of the change: the
  // gain, which the one that was built this way has had at the new ceiling
  // all along. Everything else - the delay line, the sliding minimum, the box
  // - turns over inside a lookahead. So they converge at the release rate
  // rather than agreeing at once, and the comparison starts five time
  // constants past the change.
  //
  // Measured on this signal: 1.8e-1 right at the change, 6.6e-2 one release
  // later, 2.4e-2 at two, and exactly zero at five - the gain has caught up
  // and the two are the same machine sample for sample. The tolerance below
  // is slack rather than needed, so that a change to the release constant
  // moves the margin rather than breaking the test.
  const signal = SIGNALS['hits over a sustained bed']();
  const { out, half } = changedHalfway(signal, {}, { ceiling: -9 });
  const born = through(signal, { ceiling: -9 });

  const from = half + Math.round(5 * LIMIT_RELEASE * RATE);
  let worst = 0;
  for (let i = from; i < signal.length; i += 1) {
    worst = Math.max(worst, Math.abs(out[i] - born[i]));
  }
  assert.ok(worst < 1e-6, `drifted by ${worst.toExponential(2)}`);
});

test('the true-peak detector can be switched on mid-flight', () => {
  const signal = faded(SIGNALS['hits over a sustained bed']());
  const { out, half } = changedHalfway(signal, {}, { truePeak: true });

  const after = faded(Float32Array.from(out.subarray(half + 4 * makeLimiter(RATE, {}).ahead)));
  assert.ok(truePeakAbove(after) < 0.01,
    `${truePeakAbove(after).toFixed(3)} dB over once the mode is on`);

  const before = faded(Float32Array.from(out.subarray(0, half)));
  assert.ok(truePeakAbove(before) > 0.5,
    `the sample detector should have let the usual ${truePeakAbove(before).toFixed(2)} dB past`);
});

/* --- the other way of holding a ceiling ----------------------------------- */

/** A clipper as a one-sample-in, one-sample-out function, for the probe. */
function clipStepper(over) {
  const limiter = makeLimiter(RATE, over);
  const one = new Float32Array(1);
  return (x) => { one[0] = x; limiter.block([one]); return one[0]; };
}

test('a signal inside the ceiling comes back out of the clipper untouched', () => {
  // The oversampled round trip is two windowed sincs in series, and if the
  // two do not agree it is not a clipper, it is a filter. Measured: a delay
  // of exactly twelve samples and 2.5e-5 of error at 440 Hz, which is about
  // 78 dB down and is what the filter pair costs.
  for (const hz of [440, 1000, 5000]) {
    const n = 8192;
    const signal = new Float32Array(n);
    for (let i = 0; i < n; i += 1) signal[i] = Math.sin((2 * Math.PI * hz * i) / RATE) * 0.2;

    const out = through(signal, { mode: 'clip', ceiling: 0 });
    let worst = 0;
    for (let i = 2000; i < 6000; i += 1) worst = Math.max(worst, Math.abs(out[i] - signal[i - 12]));
    assert.ok(worst < 2e-4, `${hz} Hz came back ${worst.toExponential(2)} out`);
  }
});

test('the delay is exactly twelve samples, which is what phase zero buys', () => {
  // Read three sub-samples later - the newest one, which is the obvious
  // choice - and the two filters' delays add up to 11.25 samples. A quarter
  // of a sample of fractional delay read as 2.9e-3 of error on a sine the
  // round trip should have returned untouched, and as a quarter-cycle of
  // phase error at the top of the spectrum.
  const n = 8192;
  const signal = new Float32Array(n);
  for (let i = 0; i < n; i += 1) signal[i] = Math.sin((2 * Math.PI * 1000 * i) / RATE) * 0.2;
  const out = through(signal, { mode: 'clip', ceiling: 0 });

  let best = null;
  for (let delay = 0; delay < 40; delay += 1) {
    let worst = 0;
    for (let i = 2000; i < 6000; i += 1) {
      worst = Math.max(worst, Math.abs(out[i] - signal[i - delay]));
    }
    if (best === null || worst < best.worst) best = { delay, worst };
  }
  assert.equal(best.delay, 12);
});

test('a clipper adds odd harmonics and no even ones', () => {
  // What a symmetric curve does, and the one thing about a clipper anybody
  // can hear without being trained: odd is a fifth and a major third above,
  // which is why it sounds like something going wrong rather than like the
  // note getting richer.
  const series = seriesOf(
    spectrumThrough(clipStepper({ mode: 'clip', ceiling: -14 }), PROBE_BIN), PROBE_BIN,
  );

  assert.ok(series.harmonics[3] > -20, `the third should be loud, read ${series.harmonics[3]}`);
  assert.ok(series.harmonics[2] < -100, `the second should be nothing, read ${series.harmonics[2]}`);
  assert.ok(series.harmonics[4] < -100, 'and so should the fourth');
  assert.ok(series.odd > series.even + 100, 'the odd half should be all of it');
});

test('a soft knee trades the top of the series for the bottom of it', () => {
  // Measured on a -12 dBFS sine into a -14 dBFS ceiling: the seventh harmonic
  // goes from -31.6 dB hard to -42.1 at a six-decibel knee, while the third
  // barely moves. Which is the whole of what a knee is for - the harmonics
  // that sound like breakage are the high ones.
  const read = (knee) => seriesOf(
    spectrumThrough(clipStepper({ mode: 'clip', ceiling: -14, knee }), PROBE_BIN), PROBE_BIN,
  );

  const hard = read(0);
  const soft = read(6);
  assert.ok(soft.harmonics[7] < hard.harmonics[7] - 5,
    `the seventh should fall away: ${hard.harmonics[7].toFixed(1)} to ${soft.harmonics[7].toFixed(1)}`);
  assert.ok(Math.abs(soft.harmonics[3] - hard.harmonics[3]) < 2,
    'and the third should barely move');
});

test('oversampling buys most at the top of the spectrum, where it is needed', () => {
  // The claim the mode is built on, checked rather than asserted. A clip at
  // the signal's own rate folds its harmonics back onto frequencies with no
  // musical relationship to anything, and how badly depends entirely on where
  // the music is: twelve decibels at the bottom of the spectrum, twenty-five
  // at ten kilohertz.
  const roof = 10 ** (-14 / 20);
  const naive = (x) => cutTo(x, roof, 0);

  for (const [hz, least] of [[440, 8], [3999, 14], [9999, 20]]) {
    const bin = Math.round((hz * PROBE_LENGTH) / RATE);
    const one = seriesOf(spectrumThrough(naive, bin), bin).aliasing;
    const four = seriesOf(
      spectrumThrough(clipStepper({ mode: 'clip', ceiling: -14 }), bin), bin,
    ).aliasing;
    assert.ok(one - four > least,
      `at ${hz} Hz oversampling bought ${(one - four).toFixed(1)} dB, wanted ${least}`);
  }
});

test('a clipper is not a ceiling, and the pair of them is', () => {
  // The measurement that decided the design, and the reason a mastering chain
  // is a clipper into a limiter rather than one or the other. Band-limiting a
  // clipped waveform restores the overshoot the clipping took out: the
  // corners are a discontinuity, and filtering the content above Nyquist back
  // out of them puts the peak back.
  for (const [name, make] of Object.entries(SIGNALS)) {
    const signal = faded(make());

    const clipped = faded(Float32Array.from(through(signal, { mode: 'clip', truePeak: true })));
    const both = faded(Float32Array.from(through(signal, { mode: 'both', truePeak: true })));

    // Only the signals that are actually over the ceiling say anything about
    // this; one that was already under it comes out under it either way.
    if (peakOf(signal) <= ROOF) continue;

    assert.ok(truePeakAbove(both) < 0.01,
      `${name}: both came out ${truePeakAbove(both).toFixed(3)} dB over`);
    assert.ok(truePeakAbove(clipped) > truePeakAbove(both),
      `${name}: clipping alone should be the looser of the two`);
  }

  // And on transient material it is loose by a lot. Measured: 3.46 dB over on
  // hits, 3.59 on noise, 3.14 on single-sample clicks.
  const hits = faded(SIGNALS['hits over a sustained bed']());
  const clipped = faded(Float32Array.from(through(hits, { mode: 'clip', truePeak: true })));
  assert.ok(truePeakAbove(clipped) > 3,
    `clipping hits should overshoot by about 3.5 dB, read ${truePeakAbove(clipped).toFixed(2)}`);
});

test('the modes do what their names say and nothing else', () => {
  const hits = SIGNALS['hits over a sustained bed']();

  // Limiting only: the gain moved, so there is reduction to read.
  const limiter = makeLimiter(RATE, { mode: 'limit' });
  through(hits, { mode: 'limit' });
  assert.ok(limiter.reduction <= 0);

  // Clipping only: no gain at all, so the reduction never moves off zero
  // however hard it is pushed. A clipper has nothing to report.
  const clipper = makeLimiter(RATE, { mode: 'clip' });
  const out = Float32Array.from(hits);
  for (let at = 0; at < out.length; at += 128) {
    clipper.block([out.subarray(at, Math.min(at + 128, out.length))]);
  }
  assert.equal(clipper.reduction, 0, 'a clipper has no gain to reduce');
});

test('the mode and the knee can be changed while it runs', () => {
  const signal = SIGNALS['hits over a sustained bed']();
  const { out, half } = changedHalfway(
    signal, { mode: 'clip', truePeak: true }, { mode: 'limit' },
  );

  // Before the change the gain never moved, so the first half is the clipper's
  // overshoot; after it, the limiter is holding. The detector has to be the
  // true-peak one in both halves or this measures the wrong thing: a
  // sample-peak limiter lets the waveform between the samples out three
  // decibels over, which is a different finding with its own test above and
  // is what this read before the mode was passed through.
  const after = faded(Float32Array.from(out.subarray(half + 4 * makeLimiter(RATE, {}).ahead)));
  assert.ok(truePeakAbove(after) < 0.01,
    `once limiting, nothing over: read ${truePeakAbove(after).toFixed(3)}`);

  // And the knee, which is measured from the ceiling, so moving the ceiling
  // has to move it too.
  const limiter = makeLimiter(RATE, { ceiling: -14, knee: 6, mode: 'clip' });
  limiter.set({ ceiling: -20 });
  const one = new Float32Array(1);
  one[0] = 1;
  for (let i = 0; i < 64; i += 1) { one[0] = 1; limiter.block([one]); }
  assert.ok(Math.abs(one[0]) <= 10 ** (-20 / 20) + 1e-6,
    'the knee should have followed the ceiling down');
});

test('the audio thread gets the clipper too', () => {
  const source = limiterSource();
  assert.ok(source.includes('cutTo'), 'the processor needs the curve as well as the limiter');
  assert.ok(source.includes('CLIP_DOWN'),
    'and the decimation filter, as numbers rather than as the function that builds them');

  const theirs = new Function(`${source.replace(/class HeadroomLimiter[\s\S]*$/, '')}; return makeLimiter;`)();

  const n = 4096;
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i += 1) raw[i] = Math.sin((2 * Math.PI * 700 * i) / RATE) * 2;
  const material = faded(raw);

  for (const mode of ['clip', 'both']) {
    const mine = through(material, { mode, ceiling: -1, knee: 3 });
    const other = (() => {
      const limiter = theirs(RATE, { mode, ceiling: -1, knee: 3 });
      const out = Float32Array.from(material);
      for (let at = 0; at < out.length; at += 128) {
        limiter.block([out.subarray(at, Math.min(at + 128, out.length))]);
      }
      return out;
    })();

    for (let i = 0; i < n; i += 1) {
      assert.ok(Math.abs(mine[i] - other[i]) < 1e-12,
        `the two parted company at sample ${i} in ${mode} mode`);
    }
  }
});
