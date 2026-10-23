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

  return {
    off,
    where: Math.abs(depth) > shape ? 'amount' : 'timing',
    detail: { depth, shape, deepest: mine.values.deepest - theirs.values.deepest },
  };
}
