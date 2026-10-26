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

import { analyse, meanFrames } from './dsp.js';
import { readingOf, stampOf } from '../../lib/read.js';

/** How long a frame is. The number the scoring was already calibrated on. */
export const FRAME_MS = 5;

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
 */
export function materialStamp(samples) {
  if (!samples?.length) return 'none';

  const stride = Math.max(1, Math.floor(samples.length / 64));
  let sum = 0;
  for (let i = 0; i < samples.length; i += stride) sum += samples[i] * (i + 1);
  return `${samples.length}:${sum.toFixed(3)}`;
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
 */
export function reductionPass(samples, rate, settings, key = null, into = null) {
  const pass = analyse(samples, rate, settings, key, into);

  return {
    trace: pass.gr,
    reading: readingOf({
      tool: 'compression',
      kind: 'reduction',
      of: {
        state: stampOf(settings),
        source: null,
        axis: { kind: 'frames', ms: FRAME_MS, rate, over: materialStamp(samples) },
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
export const reductionReading = (samples, rate, settings, key = null) =>
  reductionPass(samples, rate, settings, key).reading;

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
 * When the average offset is enough bigger than what is left of it to call a
 * miss "amount", and when it is enough smaller to call it "timing".
 *
 * There used to be one boundary at 1: whichever of the two was larger won.
 * That did not separate them, because a timing error moves the average too -
 * a slower release holds more reduction across the whole loop, so getting the
 * release wrong shows up partly as "you reduced more than I did". Everything
 * from a release 40 ms out to an attack 45 ms out was reported as an amount
 * problem, which sends somebody to the threshold knob to fix a release.
 *
 * Measured as the ratio of |depth| to shape, over drum hits, a held chord,
 * syllables and modulated noise, at the sizes of error the drill sets:
 *
 *     timing errors, attack or release      0.01 to 2.92
 *     amount errors, threshold or ratio     3.13 to 28.73
 *
 * So there are two boundaries rather than one, and a band between them where
 * this says nothing. That band is not timidity - it is the honest shape of
 * the question. A fast release really does deliver less total reduction, so
 * at the overlap a miss genuinely is both, and the ratio that would name one
 * of them has a seven per cent margin. The version of this calibrated against
 * the old engine had a clean gap from 1.90 to 3.63, and that gap was an
 * artefact: the sixteen milliseconds the peak detector added to every release
 * were suppressing how much a release error moved the average. Fixing the
 * ballistics took the gap away, which is the right trade and worth saying out
 * loud rather than papering over with a tighter constant.
 *
 * Two other statistics were tried and are worse. The share of the squared
 * difference carried by the calmer half of the frames separates 0.009-0.276
 * against 0.287-0.489, a four per cent margin. Splitting the frames by
 * whether the answer's own reduction is moving - which is the physically
 * motivated one, since an amount error offsets the steady passages too -
 * overlaps outright, 0.219-0.602 against 0.445-0.573.
 *
 * Nothing in the measured set is named wrongly at 2 and 4. About a quarter of
 * it is named as neither, which is a better answer than a confident one that
 * is wrong a quarter of the time.
 */
export const TIMING_UNDER = 2;
export const AMOUNT_OVER = 4;

/**
 * And below this the question has no answer worth giving at all.
 *
 * At a fifteenth of a decibel the depth and what is left of it are both
 * rounding: measured, knee changes that moved the trace by 0.01 to 0.07 dB
 * reported ratios of 0.67 with no more meaning than a coin has. `null` is
 * what every other gap in the app returns when it has nothing to point at,
 * and every caller already handles it.
 */
export const NOTHING_TO_SAY = 0.15;

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

  const lean = Math.abs(depth) / Math.max(1e-12, shape);
  let where = null;
  if (off >= NOTHING_TO_SAY) {
    if (lean > AMOUNT_OVER) where = 'amount';
    else if (lean < TIMING_UNDER) where = 'timing';
  }

  return {
    off,
    where,
    detail: { depth, shape, lean, deepest: mine.values.deepest - theirs.values.deepest },
  };
}
