// What a compressor's settings do to a piece of audio, in an envelope.
//
// Its own file, and the only kind of reading that has one. `comp/dsp.js`
// promises that every function in it closes over nothing outside its own body,
// because `comp/node.js` stringifies five of them and hands them to the audio
// thread - a function that quietly referenced an import would fail there and
// nowhere else. That promise is worth more than the symmetry of putting this
// beside the maths, so this sits next door instead.
//
// The audit that produced the reading contract found one thing here that the
// other five tools do not have: the compressor's display reading and its
// scoring reading are different types. The display wants gain reduction per
// sample - a quarter of a million numbers, drawn as a trace. The scorer wants
// it framed at five milliseconds, because a single sample of disagreement on a
// transient is not a wrong answer. Both were being called "the reading".
//
// So the reading is the framed one, and the per-sample trace stays what it
// always was: a detail the player keeps for the display. Without that split,
// composing a chain report out of these would inherit a 240,000-element array
// and a shape nothing else in the app has.

import { analyse, analyseStereo, meanFrames } from './dsp.js';
import { readingOf, stampOf } from '../../lib/read.js';

/** How long a frame is. The number the scoring was already calibrated on. */
export const FRAME_MS = 5;

/**
 * The channels of whatever was handed over, as an array.
 *
 * One buffer or a list of them, because a reading is taken over mono material
 * everywhere except the one path where somebody loads their own stereo file.
 * A list of one is the mono case and is stamped and measured as such, so
 * nothing had to change at the callers that were already right.
 *
 * Not `channelsOf`, which the analysis page owns, and not `channelsIn`, which
 * the mix render owns - the bundler flattens every module into one scope and
 * refuses a duplicate, which is how both of those were found rather than by
 * remembering them.
 */
const overChannels = (material) => (Array.isArray(material) ? material : [material]);

/**
 * Which audio this is a reading over, cheaply.
 *
 * Two reduction readings can only be compared if they were taken over the same
 * material - the whole measurement is what these settings did to this loop.
 * Nothing carried that before, so a comparison across two different loops
 * returned a number rather than an error, which is the worst way to be wrong.
 *
 * Length and a strided checksum rather than a real hash: this runs on every
 * measurement and it only has to tell two loops apart, not resist anybody.
 *
 * Each channel is weighted by its own position, so a pair is told apart from
 * either side of itself and from the same pair the other way round - which
 * matters, because a stereo reading and a reading of its left channel are
 * genuinely different measurements: one is driven by the louder of the two
 * and the other by the left alone. A pair of identical channels is stamped as
 * the pair it is rather than as the mono signal it contains; what a stamp
 * describes is the material the measurement was taken over, and guessing at
 * equivalence is how the false comparisons this exists to refuse get back in.
 */
export function materialStamp(material) {
  const channels = overChannels(material);
  const first = channels[0];
  if (!first?.length) return 'none';

  const stride = Math.max(1, Math.floor(first.length / 64));
  let sum = 0;
  for (let c = 0; c < channels.length; c += 1) {
    const samples = channels[c];
    if (!samples?.length) continue;
    for (let i = 0; i < samples.length; i += stride) sum += samples[i] * (i + 1) * (c + 1);
  }
  return `${first.length}:${sum.toFixed(3)}`;
}

/**
 * One pass of the compressor over the material, framed - and the per-sample
 * trace beside it, for whoever is drawing one.
 *
 * `into` is an optional Float32Array to write that trace into, so the display
 * can keep the array it is already drawing from rather than allocating a
 * quarter of a million floats on every move of a knob.
 *
 * The trace is handed back separately rather than put on the reading, because
 * it is not part of what the reading means: it is the same measurement at a
 * resolution nothing compares at.
 *
 * `material` is one buffer or a list of channels. Two of them are read as a
 * stereo pair - one trace, because the compressor's gain is one gain - which
 * is the trace the audio path applies rather than the one the left channel
 * would have got on its own. See `analyseStereo` for what that was costing.
 */
export function reductionPass(material, rate, settings, key = null, into = null) {
  const channels = overChannels(material);
  const pass = channels.length > 1
    ? analyseStereo(channels[0], channels[1], rate, { ...settings, makeup: 0, listen: false },
      key, into)
    : analyse(channels[0], rate, settings, key, into);

  return {
    trace: pass.gr,
    reading: readingOf({
      tool: 'compression',
      kind: 'reduction',
      of: {
        state: stampOf(settings),
        source: null,
        axis: { kind: 'frames', ms: FRAME_MS, rate, over: materialStamp(material) },
      },
      values: {
        gr: meanFrames(pass.gr, rate, FRAME_MS),
        deepest: pass.deepest,
        average: pass.average,
        makeup: pass.makeup,
      },
    }),
  };
}

/** The reading alone, for whoever is not drawing anything. */
export const reductionReading = (material, rate, settings, key = null) =>
  reductionPass(material, rate, settings, key).reading;

/**
 * How far apart two compressors are, in what they did.
 *
 * The reduction moment by moment is the compressor's whole output - depth and
 * timing together - so the distance between two of them is the distance
 * between two settings in the only terms that matter.
 *
 * Split into the two halves anybody can act on. The average of the difference
 * is amount: threshold and ratio, how much reduction overall. What is left
 * once that is taken out is timing: attack and release, the same total
 * reduction arriving and leaving at a different moment. It is the half most
 * people find hard to hear, and saying which of the two is the larger is the
 * single most useful thing this measurement can report.
 *
 * Lifted out of the compression exercise's `score`, which took two settings
 * objects and ran both passes itself.
 */
/**
 * Where "amount" starts, once the lean is measured against this material.
 *
 * The lean - how much bigger the average offset is than what is left of it -
 * does not mean the same thing on every loop, and that is why two boundaries
 * with a silent band between them were needed before. The fix is to measure
 * it against something, and there is an exact thing to measure it against.
 *
 * A ratio error scales the whole reduction by a constant: if the answer
 * reduces by g[n] and yours reduces by k*g[n], the difference is (k-1)*g[n],
 * so its average is (k-1)*mean(g) and what is left of it is (k-1)*sd(g), and
 * the k cancels. A ratio error therefore leans exactly mean(g)/sd(g) of the
 * answer's own trace, whatever the ratio and whatever the material. Measured,
 * against ratios of 1.5, 3, 10 and 16:
 *
 *     material        mean/sd     every ratio error leans
 *     modulated noise    5.35     5.35
 *     drum hits          3.97     3.97
 *     a held chord       3.20     3.20
 *     syllables          3.45     3.45
 *
 * Exact to every digit shown, because it is an identity rather than a fit. So
 * mean/sd is the unit this question should be asked in, and dividing by it
 * puts a ratio error at 1 on every loop there is. Measured in those units:
 *
 *     attack errors      0.01 to 0.10
 *     release errors     0.18 to 1.06
 *     ratio errors       exactly 1
 *     threshold errors   1.26 to 6.14
 *
 * which is one boundary rather than two, and no silent band.
 *
 * It is 0.97 and not 1 because a ratio error lands on 1 exactly. Putting the
 * boundary there would leave floating point to decide which side of itself
 * each ratio error fell on, which is not a thing to leave to floating point.
 * Just under it is clear of that and still above every attack error and all
 * but one release error.
 *
 * That one: the fastest release on the most sustained material - 40 ms
 * against the answer's 200 on a held chord - leans 1.06 and is called amount.
 * It is the only miss in ninety-nine measured cases, and it is the case where
 * the label is least wrong: a chord with few gaps in it gives a fast release
 * little to come back between, so most of what changes really is how much
 * reduction there is. The next release down, 60 ms, reads 0.93 and is called
 * timing.
 */
export const AMOUNT_FROM = 0.97;

/**
 * And below this the question has no answer worth giving at all.
 *
 * At a fifteenth of a decibel the depth and what is left of it are both
 * rounding: measured, knee changes that moved the trace by 0.01 to 0.07 dB
 * reported leans of 0.67 with no more meaning than a coin has. `null` is what
 * every other gap in the app returns when it has nothing to point at, and
 * every caller already handles it.
 */
export const NOTHING_TO_SAY = 0.15;

/**
 * The unit the lean is read in: the answer's own mean reduction over its own
 * deviation.
 *
 * Null when there is no unit to be had - an answer that barely compresses, or
 * one that holds a dead flat reduction, has no spread to measure anything
 * against, and inventing one would be worse than saying nothing.
 */
export function leanUnit(gr) {
  if (!gr?.length) return null;

  let sum = 0;
  for (let i = 0; i < gr.length; i += 1) sum += Math.abs(gr[i]);
  const mean = sum / gr.length;
  if (!(mean > 0.05)) return null;

  let spread = 0;
  for (let i = 0; i < gr.length; i += 1) {
    const off = Math.abs(gr[i]) - mean;
    spread += off * off;
  }
  const sd = Math.sqrt(spread / gr.length);
  return sd > 1e-6 ? mean / sd : null;
}

export function reductionGap(mine, theirs) {
  const a = mine.values.gr;
  const b = theirs.values.gr;
  const n = Math.min(a.length, b.length);

  let sum = 0;
  let bias = 0;
  for (let i = 0; i < n; i += 1) {
    const off = a[i] - b[i];
    sum += off * off;
    bias += off;
  }

  const off = Math.sqrt(sum / Math.max(1, n));
  const depth = bias / Math.max(1, n);
  const shape = Math.sqrt(Math.max(0, off * off - depth * depth));

  // In the answer's own units, not in decibels: see AMOUNT_FROM.
  const unit = leanUnit(b);
  const lean = unit === null ? null : Math.abs(depth) / Math.max(1e-12, shape) / unit;

  let where = null;
  if (off >= NOTHING_TO_SAY && lean !== null) {
    where = lean >= AMOUNT_FROM ? 'amount' : 'timing';
  }

  return {
    off,
    where,
    detail: { depth, shape, lean, deepest: mine.values.deepest - theirs.values.deepest },
  };
}
