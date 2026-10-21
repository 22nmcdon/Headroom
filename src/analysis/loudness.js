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
// The prose on what any of it is FOR is not here yet; this is the arithmetic.

import { readingOf, stampOf } from '../read.js';

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
function blocksOf(channels, rate, ms) {
  const length = Math.round((rate * ms) / 1000);
  const step = Math.round((rate * BLOCK_STEP_MS) / 1000);
  const samples = Math.min(...channels.map((c) => c.length));
  const blocks = [];

  for (let at = 0; at + length <= samples; at += step) {
    let sum = 0;
    for (const channel of channels) {
      let power = 0;
      for (let i = at; i < at + length; i += 1) power += channel[i] * channel[i];
      sum += power / length; // every weight here is 1
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
export function integrated(channels, rate) {
  const blocks = blocksOf(channels, rate, BLOCK_MS);
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

/**
 * The loudness range, as EBU Tech 3342 defines it.
 *
 * The spread of the short-term loudness, measured between its 10th and 95th
 * percentiles and gated at -20 dB relative - so a fade-in does not count as
 * dynamic range and a single loud bar does not either. What it says is how
 * far apart the quiet parts and the loud parts of a piece sit, which is the
 * thing people mean when they say a master has been flattened.
 */
export function loudnessRange(channels, rate) {
  const blocks = blocksOf(channels, rate, SHORT_MS)
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
 * An odd number of taps, so there is a middle one.
 *
 * With an even count the sinc's centre and the window's centre sit half a
 * sample apart, and the filter at phase zero does not hand back the sample it
 * was given. Odd, the middle tap is exactly 1 and every other is exactly 0 at
 * phase zero, which is the property that makes the first test below - that
 * the two peaks agree on a signal that lands on the grid - mean anything.
 */
const PEAK_TAPS = 49;
const CENTRE = (PEAK_TAPS - 1) / 2;

const sinc = (x) => (Math.abs(x) < 1e-9 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));

/** One polyphase bank: PEAK_TAPS coefficients per phase. */
function interpolator() {
  const phases = [];
  for (let p = 0; p < PEAK_OVERSAMPLE; p += 1) {
    const taps = new Float64Array(PEAK_TAPS);
    for (let i = 0; i < PEAK_TAPS; i += 1) {
      // Blackman, which keeps the stopband down far enough that the filter's
      // own ripple is not mistaken for an inter-sample peak.
      const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (PEAK_TAPS - 1))
        + 0.08 * Math.cos((4 * Math.PI * i) / (PEAK_TAPS - 1));
      taps[i] = sinc(i - CENTRE - p / PEAK_OVERSAMPLE) * w;
    }
    phases.push(taps);
  }
  return phases;
}

const PHASES = interpolator();

/**
 * How far under the sample peak a sample has to be before it is skipped.
 *
 * Interpolating every sample of a four-minute track is two billion
 * multiplications and several seconds of a frozen page. It is also wasted:
 * the overshoot between two samples is bounded, and a sample nine decibels
 * under the loudest one in the file cannot have a peak beside it that beats
 * the loudest one. The theoretical worst case for a band-limited signal is
 * about 3 dB, at half the sample rate; nine is three times the margin.
 */
const WORTH_LOOKING = -9;

/** The true peak of one channel, in dBTP. */
export function truePeakOf(samples) {
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) peak = Math.max(peak, Math.abs(samples[i]));
  if (peak === 0) return -Infinity;

  const worth = peak * 10 ** (WORTH_LOOKING / 20);
  let best = peak;

  for (let i = 0; i < samples.length; i += 1) {
    if (Math.abs(samples[i]) < worth) continue;

    // The peak between this sample and the next, which means the phases
    // starting at it - and at the one before, whose later phases reach here.
    for (const start of [i - 1, i]) {
      if (start < 0) continue;
      for (const taps of PHASES) {
        let sum = 0;
        const from = Math.max(0, CENTRE - start);
        const to = Math.min(PEAK_TAPS, samples.length + CENTRE - start);
        for (let t = from; t < to; t += 1) sum += samples[start + t - CENTRE] * taps[t];
        const value = Math.abs(sum);
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
 */
export function loudnessReading(channels, rate, { source = null } = {}) {
  const weighted = channels.map((channel) => kWeight(channel, rate));
  const { lufs, kept } = integrated(weighted, rate);

  return readingOf({
    tool: 'analysis',
    kind: 'loudness',
    of: {
      state: stampOf({ channels: channels.length, rate }),
      source,
      axis: { kind: 'time', ms: BLOCK_STEP_MS, block: BLOCK_MS, short: SHORT_MS, rate },
    },
    values: {
      integrated: lufs,
      blocks: kept,
      range: loudnessRange(weighted, rate),
      short: shortTerm(weighted, rate),
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
