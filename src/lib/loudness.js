// How loud a piece of audio is, in the units a broadcaster and a streaming
// service actually use.
//
// ITU-R BS.1770-4, which is also EBU R128: K-weight the signal, take its mean
// square over 400 ms blocks, throw away the blocks that are silence or very
// nearly, and average what is left. Every number in this file comes from that
// document rather than from taste, and `tests/loudness.test.js` holds it to
// the EBU Tech 3341 compliance signals - the first of which is a 1 kHz sine
// at -23 dBFS that has to read -23.0 LUFS.
//
// That first test is not the formality it looks. A 1 kHz sine at -23 dBFS has
// a mean square that reads -23.0 dB before the weighting and -23.69 after the
// -0.691 offset, so the only way to arrive back at -23.0 is for the
// K-weighting to put +0.691 dB on a kilohertz - which is what the filters
// below do, and the reason the offset is that particular number.
//
// The prose on what any of it is FOR is in src/learn/notes/level.js.
//
// This lived in src/analysis until a second caller turned up. The level tool
// reads its output exactly this way - the whole point of that tool is that it
// measures level the way the world does rather than its own way - and a
// plugin may import lib and its own folder and nothing else, which is a rule
// `tests/seams.test.js` enforces and which caught this the moment the import
// was written. Shared arithmetic belongs here; the analysis page's own
// reading of a file is still its own.

import { readingOf, stampOf } from './read.js';

/** The absolute gate, in LUFS: below this a block is silence. */
export const ABSOLUTE_GATE = -70;

/** And the relative gate, in decibels under the ungated loudness. */
export const RELATIVE_GATE = -10;

/**
 * The offset in the loudness equation.
 *
 * Not a fudge: it is what makes the scale agree with the old LKFS reference,
 * and it is exactly the K-weighting's gain at 1 kHz with the sign turned
 * round. See the note at the top of this file.
 */
const OFFSET = -0.691;

// How long a block is, and how far apart two of them start. Named for the
// block rather than just `STEP_MS`, because the dynamics reading next door
// has a window and a step of its own and one flattened scope holds both.
export const BLOCK_MS = 400;
export const BLOCK_STEP_MS = 100;

/** The window the short-term reading uses, which is longer and ungated. */
export const SHORT_MS = 3000;

/**
 * The two stages of the K-weighting, as the analogue filters they are.
 *
 * BS.1770 prints its coefficients at 48 kHz and says nothing about any other
 * rate, which is a problem here: the sample rate is whatever the browser's
 * audio context decided, and on a lot of machines that is 44.1 kHz. So the
 * filters are specified the way they were designed - a shelf and a high-pass
 * with a corner, a Q and a gain - and bilinear-transformed at whatever rate
 * the audio turned up at.
 *
 * These five numbers are the ones that reproduce the document's 48 kHz
 * coefficients to eleven decimal places, which `tests/loudness.test.js`
 * checks against the printed values rather than taking on trust.
 */
const SHELF = { f0: 1681.974450955533, gain: 3.999843853973347, q: 0.7071752369554196 };
const HIGHPASS = { f0: 38.13547087602444, q: 0.5003270373238773 };

/**
 * The two filters, bilinear-transformed at a given rate.
 *
 * Not the textbook shelf formula, and the difference matters. BS.1770's shelf
 * is specified with a shelf-midpoint gain of `Vh ** 0.4996667741545416`
 * rather than the usual `sqrt(Vh)`, and its high-pass numerator is a plain
 * `1, -2, 1` rather than one normalised to unity in the passband - which
 * leaves that filter with about 0.005 of gain in it. Both of those look like
 * mistakes and neither is: the -0.691 offset in the loudness equation was
 * calibrated against these exact filters, so a "corrected" version of either
 * reads a meter that no longer agrees with anybody else's.
 *
 * The test beside this holds them to the coefficients the document prints.
 */
function shelfAt(rate) {
  const k = Math.tan((Math.PI * SHELF.f0) / rate);
  const vh = 10 ** (SHELF.gain / 20);
  const vb = vh ** 0.4996667741545416;

  const a0 = 1 + k / SHELF.q + k * k;
  return {
    b0: (vh + (vb * k) / SHELF.q + k * k) / a0,
    b1: (2 * (k * k - vh)) / a0,
    b2: (vh - (vb * k) / SHELF.q + k * k) / a0,
    a1: (2 * (k * k - 1)) / a0,
    a2: (1 - k / SHELF.q + k * k) / a0,
  };
}

function highpassAt(rate) {
  const k = Math.tan((Math.PI * HIGHPASS.f0) / rate);
  const a0 = 1 + k / HIGHPASS.q + k * k;

  return {
    // Exactly as printed, and deliberately not normalised: see above.
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (k * k - 1)) / a0,
    a2: (1 - k / HIGHPASS.q + k * k) / a0,
  };
}

/** Both stages, for whatever rate the audio arrived at. */
export const kWeighting = (rate) => [shelfAt(rate), highpassAt(rate)];

/** One channel through both stages, as a new array. */
export function kWeight(samples, rate) {
  const out = new Float64Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) out[i] = samples[i];

  for (const { b0, b1, b2, a1, a2 } of kWeighting(rate)) {
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < out.length; i += 1) {
      const x = out[i];
      const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = x;
      y2 = y1;
      y1 = y;
      out[i] = y;
    }
  }

  return out;
}

/**
 * A running total of the squares, so that a block is two lookups.
 *
 * What was here walked every sample of every block. The blocks overlap by
 * three quarters and the short-term window is three seconds, so each sample
 * was visited thirty times for the short reading alone - on a four-minute
 * track that is six hundred million multiplications and several seconds of a
 * page that has stopped answering. A running total visits each sample once
 * and every block after that is a subtraction.
 *
 * Doubles, and the precision is not in question: the values are at most one,
 * so a four-minute total is about ten million and a double carries fifteen
 * significant figures.
 */
function squaresOf(channel) {
  const out = new Float64Array(channel.length + 1);
  for (let i = 0; i < channel.length; i += 1) out[i + 1] = out[i] + channel[i] * channel[i];
  return out;
}

/**
 * The mean square of each channel over every block, and the loudness of the
 * block they make together.
 *
 * `z` is kept alongside the loudness because the gating has to average the
 * mean squares and not the decibels - averaging decibels is averaging
 * logarithms, which is a different and smaller number.
 *
 * The weights are BS.1770's: unity for left, right and centre, and 1.41 for
 * the surrounds. Nothing here is ever more than two channels, so they are all
 * unity, but the sum is written as a sum so that the day something is not
 * stereo this is a change of data rather than a change of arithmetic.
 */
function blocksOf(channels, rate, ms, prepared = null) {
  const length = Math.round((rate * ms) / 1000);
  const step = Math.round((rate * BLOCK_STEP_MS) / 1000);
  const samples = Math.min(...channels.map((c) => c.length));
  // Handed in where a caller wants more than one window length off the same
  // audio: the running totals are a Float64Array per channel as long as the
  // track, and building them twice is eighty megabytes nobody needed.
  const running = prepared ?? channels.map(squaresOf);
  const blocks = [];

  for (let at = 0; at + length <= samples; at += step) {
    let sum = 0;
    for (const total of running) {
      sum += (total[at + length] - total[at]) / length; // every weight here is 1
    }
    blocks.push({ at: at / rate, z: sum, lufs: OFFSET + 10 * Math.log10(Math.max(sum, 1e-20)) });
  }

  return blocks;
}

/** The loudness of a set of blocks, averaged where it has to be: in power. */
const loudnessOf = (blocks) => {
  if (!blocks.length) return -Infinity;
  const mean = blocks.reduce((sum, block) => sum + block.z, 0) / blocks.length;
  return OFFSET + 10 * Math.log10(Math.max(mean, 1e-20));
};

/**
 * Integrated loudness, gated twice.
 *
 * The absolute gate throws away anything under -70 LUFS, which is silence and
 * room tone. The relative gate is then set ten decibels under whatever is
 * left and throws away everything under that, which is what stops the quiet
 * half of a piece of music dragging the answer down - the number is meant to
 * describe how loud the thing sounds when it is sounding.
 *
 * Returns -Infinity for a signal with nothing in it, which is what digital
 * silence honestly is, rather than a large negative number that looks like a
 * measurement.
 */
export function integrated(channels, rate, prepared = null) {
  const blocks = blocksOf(channels, rate, BLOCK_MS, prepared);
  const heard = blocks.filter((block) => block.lufs > ABSOLUTE_GATE);
  if (!heard.length) return { lufs: -Infinity, blocks, kept: 0 };

  const relative = loudnessOf(heard) + RELATIVE_GATE;
  const kept = heard.filter((block) => block.lufs > relative);
  if (!kept.length) return { lufs: -Infinity, blocks, kept: 0 };

  return { lufs: loudnessOf(kept), blocks, kept: kept.length, relative };
}

/**
 * Short-term loudness over time: a three-second window, every 100 ms, ungated.
 *
 * Ungated because this one is a picture of the piece rather than a verdict on
 * it - the quiet passages are the interesting part of the shape, and a gate
 * would cut exactly those out.
 */
export const shortTerm = (channels, rate) =>
  blocksOf(channels, rate, SHORT_MS).map(({ at, lufs }) => ({ at, lufs }));

/** The same blocks, for a caller that wants both readings off them. */
const shortBlocks = (channels, rate, prepared = null) =>
  blocksOf(channels, rate, SHORT_MS, prepared);

/**
 * The loudness range, as EBU Tech 3342 defines it.
 *
 * The spread of the short-term loudness, measured between its 10th and 95th
 * percentiles and gated at -20 dB relative - so a fade-in does not count as
 * dynamic range and a single loud bar does not either. What it says is how
 * far apart the quiet parts and the loud parts of a piece sit, which is the
 * thing people mean when they say a master has been flattened.
 */
export function loudnessRange(channels, rate, over = null) {
  const blocks = (over ?? shortBlocks(channels, rate))
    .filter((block) => block.lufs > ABSOLUTE_GATE);
  if (!blocks.length) return 0;

  const relative = loudnessOf(blocks) - 20;
  const kept = blocks.filter((block) => block.lufs > relative).map((block) => block.lufs);
  if (kept.length < 2) return 0;

  kept.sort((a, b) => a - b);
  const at = (p) => kept[Math.min(kept.length - 1, Math.max(0, Math.round(p * (kept.length - 1))))];
  return at(0.95) - at(0.1);
}

/**
 * How much the signal goes over between the samples.
 *
 * A sample peak is not the peak. Reconstruct the waveform between two samples
 * and it can and does go higher than either of them, which is why a file that
 * reads -0.1 dBFS can clip a converter or an encoder outright. BS.1770 asks
 * for at least four times oversampling before the peak is read, which is what
 * this does.
 *
 * The interpolation is a windowed sinc: for each output phase between two
 * input samples, a short filter over the samples either side. Short on
 * purpose - a 48-tap filter per phase is what the standard's own example
 * uses, and the whole point is to catch the overshoot rather than to
 * reconstruct the signal perfectly.
 */
// Four times, which is the least BS.1770 will accept at these rates. Named
// for the peak because the saturator oversamples too, eight times, for a
// different reason - and one flattened scope holds both names.
export const PEAK_OVERSAMPLE = 4;

/**
 * The interpolator, as one prototype filter split into four phases.
 *
 * Forty-nine taps in total, which is twelve or thirteen per phase - near
 * enough what BS.1770's own worked example uses, and four times less work
 * than giving every phase forty-nine of its own, which is what this did
 * first. The length is odd and the centre is a multiple of four on purpose:
 * phase zero then has a single tap of exactly 1 and the rest exactly 0, so
 * the filter hands back the sample it was given rather than a number very
 * close to it.
 */
const PROTOTYPE = 49;
const PROTO_CENTRE = 24;
const PEAK_DELAY = PROTO_CENTRE / PEAK_OVERSAMPLE;

const sinc = (x) => (Math.abs(x) < 1e-9 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));

function prototype() {
  const proto = new Float64Array(PROTOTYPE);
  for (let n = 0; n < PROTOTYPE; n += 1) {
    // Blackman, which keeps the stopband down far enough that the filter's
    // own ripple is not mistaken for an inter-sample peak.
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * n) / (PROTOTYPE - 1))
      + 0.08 * Math.cos((4 * Math.PI * n) / (PROTOTYPE - 1));
    // Cut off at the original Nyquist, which is a quarter of the way up the
    // oversampled band - hence the four in the sinc.
    proto[n] = sinc((n - PROTO_CENTRE) / PEAK_OVERSAMPLE) * w;
  }
  return proto;
}

const PROTO = prototype();

function interpolator() {
  // One branch per phase: the taps whose index is that phase, modulo four.
  // Phase p reconstructs the sub-sample at 4n + p, which is what makes the
  // same table usable for interpolating a signal up as well as for looking
  // between its samples - see the clipper in `limiter.js`.
  const phases = [];
  for (let p = 0; p < PEAK_OVERSAMPLE; p += 1) {
    const taps = [];
    for (let n = p; n < PROTOTYPE; n += PEAK_OVERSAMPLE) taps.push(PROTO[n]);
    phases.push(Float64Array.from(taps));
  }
  return phases;
}

const PHASES = interpolator();

/**
 * The same phases, for anything that has to find a peak between samples
 * rather than measure one after the fact.
 *
 * The limiter wants them: a ceiling meant for a converter can be held on the
 * samples, and a ceiling meant for an encoder cannot, because the encoder
 * reconstructs the waveform between them. Shared rather than rebuilt so the
 * thing that limits and the thing that reports agree about where the peak is -
 * a limiter calibrated against a different interpolator than the meter is a
 * limiter that misses by however much the two filters differ.
 */
export const peakPhases = () => PHASES;

/**
 * The same filter again, unsplit.
 *
 * Interpolating a signal up needs it by phase; filtering one back down needs
 * it whole, because the decimation runs at the oversampled rate and then
 * throws three samples in four away. The clipper does both, and doing them
 * with one prototype is the same argument as sharing the phases: two filters
 * in a round trip that were designed separately is a round trip that is not
 * transparent, and nothing would say so.
 */
export const peakProto = () => PROTO;

/** How far behind the input the interpolator's output sits, in samples. */
export const PEAK_LAG = PEAK_DELAY;

/**
 * How far under the sample peak a sample has to be before it is skipped.
 *
 * The overshoot between two samples is bounded - about 3 dB at worst for a
 * band-limited signal, at half the sample rate - so a sample nine decibels
 * under the loudest in the file cannot have a peak beside it that beats the
 * loudest. Nine is three times that margin.
 */
const WORTH_LOOKING = -9;

/**
 * The true peak of one channel, in dBTP.
 *
 * Only the samples a peak could be near are interpolated, and there are two
 * tests for that. The first is the margin above. The second is that the
 * reconstructed signal's maxima sit beside the sample maxima: a sample lower
 * than both its neighbours has the waveform passing through it on the way
 * somewhere, and that somewhere is one of the samples this does look at.
 *
 * Neither is a shortcut past the measurement, and both are needed: a loud
 * dense master has most of its samples inside the margin, and a quiet
 * passage has most of them outside it.
 */
export function truePeakOf(samples) {
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const size = samples[i] < 0 ? -samples[i] : samples[i];
    if (size > peak) peak = size;
  }
  if (peak === 0) return -Infinity;

  const worth = peak * 10 ** (WORTH_LOOKING / 20);
  let best = peak;

  const sizeAt = (i) => {
    if (i < 0 || i >= samples.length) return 0;
    return samples[i] < 0 ? -samples[i] : samples[i];
  };

  for (let i = 0; i < samples.length; i += 1) {
    const here = sizeAt(i);
    if (here < worth) continue;
    // `>=` on both sides rather than `>`, so a pair of equal samples
    // straddling the peak is not skipped by both of them.
    if (here < sizeAt(i - 1) || here < sizeAt(i + 1)) continue;

    // The output phases around this sample. `PEAK_DELAY` is the filter's own
    // delay in input samples, taken off so that phase zero lands on `i`.
    for (const at of [i + PEAK_DELAY - 1, i + PEAK_DELAY]) {
      for (const taps of PHASES) {
        let sum = 0;
        for (let k = 0; k < taps.length; k += 1) {
          const from = at - k;
          if (from >= 0 && from < samples.length) sum += samples[from] * taps[k];
        }
        const value = sum < 0 ? -sum : sum;
        if (value > best) best = value;
      }
    }
  }

  return 20 * Math.log10(best);
}

/** And the plain sample peak beside it, which is the one people quote. */
export function samplePeakOf(samples) {
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) peak = Math.max(peak, Math.abs(samples[i]));
  return 20 * Math.log10(Math.max(peak, 1e-12));
}

/**
 * Everything the loudness of a piece of audio has to say, in one envelope.
 *
 * `of.axis` carries the rate and the block length, because a short-term
 * series measured over three seconds cannot be compared with one measured
 * over four and nothing else would say so.
 *
 * `state` is what the reading is of, for a caller that has settings. On the
 * analysis page there are none - a file is a file - so the default is the
 * shape of the audio itself. The level tool does have settings, and a reading
 * taken before its trim moved has to read as stale rather than current, which
 * is a comparison against this stamp and nothing else.
 *
 * `tool` is who is asking, and it is in the envelope rather than assumed
 * because two tools now ask. It has no effect on comparing two readings -
 * `comparable` goes on the kind and the axis - so a level reading and an
 * analysis reading of the same audio are the same reading, which is correct:
 * they are.
 */
export function loudnessReading(channels, rate, { source = null, state = null, tool = 'analysis' } = {}) {
  const weighted = channels.map((channel) => kWeight(channel, rate));
  // The running totals, once. Every block of every length comes off these.
  const running = weighted.map(squaresOf);
  const { lufs, kept } = integrated(weighted, rate, running);
  // One pass of three-second blocks, read twice: the shape over time and the
  // range are the same measurement asked two questions.
  const over = shortBlocks(weighted, rate, running);

  return readingOf({
    tool,
    kind: 'loudness',
    of: {
      state: stampOf(state ?? { channels: channels.length, rate }),
      source,
      axis: { kind: 'time', ms: BLOCK_STEP_MS, block: BLOCK_MS, short: SHORT_MS, rate },
    },
    values: {
      integrated: lufs,
      blocks: kept,
      range: loudnessRange(weighted, rate, over),
      short: over.map(({ at, lufs: value }) => ({ at, lufs: value })),
      truePeak: Math.max(...channels.map(truePeakOf)),
      samplePeak: Math.max(...channels.map(samplePeakOf)),
    },
  });
}

/**
 * How far apart two pieces of audio are, in loudness.
 *
 * The integrated loudness, because that is the number anybody is comparing
 * when they ask whether their mix is as loud as a reference. The range and
 * the peak come along in the detail: a master that matches on loudness and is
 * four decibels tighter in range is a different master, and saying so is the
 * useful half of the comparison.
 */
export function loudnessGap(mine, theirs) {
  const a = mine.values ?? mine;
  const b = theirs.values ?? theirs;

  const off = a.integrated - b.integrated;
  return {
    off,
    where: 'integrated',
    detail: {
      louder: off,
      range: a.range - b.range,
      truePeak: a.truePeak - b.truePeak,
    },
  };
}
