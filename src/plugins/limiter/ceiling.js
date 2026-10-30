// The last thing in the chain, and the one that decides what "loud" cost.
//
// A limiter is not a compressor with a high ratio. A compressor has a knee and
// a ratio and lets things past; a limiter has a lookahead and a guarantee, and
// the guarantee is the whole product. The arithmetic is `lib/limiter.js`,
// which the sketchpad has used as a safety ceiling since it had a bus - what
// is here is the half that makes it a tool rather than a seatbelt: something
// to push into it, somewhere to put the ceiling, and a reading of what it did.
//
// What the drive knob teaches is the trade every master makes. Push harder and
// the loudness goes up and the peak-to-loudness ratio comes down, and past some
// point the second is costing more than the first is worth. That is a thing to
// see on a meter and hear on a loop, and it is the reason this tool exists at
// all rather than a preset on the compressor.

import {
  makeLimiter, CEILING_DB, LIMIT_RELEASE, LIMIT_AHEAD,
} from '../../lib/limiter.js';
import {
  spectrumThrough, seriesOf, PROBE_BIN, HARMONIC_AXIS,
} from '../../lib/harmonics.js';
import { integrated, kWeight, truePeakOf } from '../../lib/loudness.js';
import { readingOf, stampOf } from '../../lib/read.js';
import { FRAME_MS, materialStamp, meanFrames } from '../../lib/reduce.js';

/**
 * How hard the signal is pushed into the ceiling, in decibels.
 *
 * Zero to twenty-four, which is more than anybody should use and is the point:
 * the exercises here are about hearing where it stops being worth it, and a
 * control that cannot go too far cannot teach where too far is.
 *
 * Measured on the bed-with-hits in tests/ceiling.test.js, which reads -20.41
 * LUFS and -6.76 dBTP, so it has nearly fourteen decibels of peak-to-loudness
 * ratio to give away - at the default -1 dBTP ceiling:
 *
 *     drive   loudness   true peak    PLR    deepest GR   average GR
 *        0     -20.41      -6.761    13.65      0.00         0.00
 *        2     -18.41      -4.761    13.65      0.00         0.00
 *        4     -16.41      -2.761    13.65      0.00         0.00
 *        6     -14.42      -1.000    13.42     -0.24        -0.01
 *        9     -12.06      -1.000    11.06     -3.24        -0.44
 *       12      -9.79      -1.000     8.79     -6.24        -1.05
 *       15      -8.21      -1.000     7.21     -9.24        -2.53
 *       18      -8.12      -1.000     7.12    -12.24        -5.43
 *       24      -8.12      -1.000     7.12    -18.24       -11.42
 *
 * There are three parts to that and the lines between them are the lesson.
 *
 * Up to four decibels nothing is limited at all. The loudness follows the
 * drive exactly, decibel for decibel, and the peak-to-loudness ratio does not
 * move. That is not mastering, it is turning it up - and where it stops is
 * not a property of the limiter, it is wherever the material's own peak was.
 * On this probe that is 5.76 dB of drive, because the probe peaks 5.76 dB
 * under the ceiling.
 *
 * From six to fifteen the trade runs. Nine decibels of drive buy six of
 * loudness and cost six and a half of peak-to-loudness ratio, which is the
 * whole of what a limiter is for and the whole of what it costs.
 *
 * Past eighteen there is nothing left. The last six decibels of drive buy
 * 0.00 dB of loudness and cost six more of reduction: the output is a wall at
 * the ceiling and making the wall taller does nothing. Every diminishing
 * return has this shape, and it is far easier to believe from a meter than
 * from an argument.
 *
 * PLR falls exactly as the loudness rises once the ceiling is holding,
 * because the true peak is pinned: PLR is the peak over the loudness, so with
 * the peak fixed the two move together by construction.
 */
export const CEIL_DRIVE = [0, 24];

/**
 * Where the ceiling can sit, in decibels.
 *
 * Down to -3 because that is what a loud master is asked for - Spotify's own
 * guidance is to keep true peak under -2 dBTP for anything louder than -14
 * LUFS - and up to -0.1 rather than 0, because a master that reads exactly
 * zero is a master somebody will encode and wonder about.
 */
export const CEIL_RANGE = [-3, -0.1];

/** How long the gain takes to come back, in milliseconds. */
export const CEIL_RELEASE = [10, 500];

/**
 * How far the output can be turned down after the ceiling, in decibels.
 *
 * Down only, and that is a guarantee rather than a style choice: a gain after
 * a brickwall is a gain the brickwall does not know about, and a positive one
 * would put the output back over the ceiling the whole file exists to hold.
 * Turning down cannot.
 *
 * What it is for is the comparison. A limiter's output is louder than its
 * input, and louder sounds better - so an A/B between limited and not is an
 * A/B about level unless the level is taken out first. This is the knob that
 * takes it out, and `matchOut` is the measurement that says how far.
 */
export const CEIL_OUTPUT = [-24, 0];

/**
 * How the ceiling is held.
 *
 * Not a preference between two implementations of the same thing - they cost
 * different currencies. A limiter looks ahead and moves a gain, and what it
 * spends is dynamics: the loud moments come down and the peak-to-loudness
 * ratio with them. A clipper cuts the waveform, and what it spends is
 * harmonics: the corner it puts on a wave is a discontinuity in the slope,
 * and a discontinuity in the slope is an odd series going up for ever.
 *
 * Both exists because a clipper on its own is not a ceiling. Measured in
 * `lib/limiter.js`: hard clipping at -1 dB lets transient material out three
 * and a half decibels over, because band-limiting a clipped waveform puts
 * back the overshoot the clipping took out. A mastering chain is a clipper
 * into a limiter for exactly that reason, and the pair holds the ceiling to
 * -0.000 dB on everything the tests can think of.
 */
export const CEIL_SHAPES = [
  { id: 'limit', label: 'Limiter' },
  { id: 'clip', label: 'Clipper' },
  { id: 'both', label: 'Clip → limit' },
];

/**
 * How far below the ceiling a clipper starts bending, in decibels.
 *
 * Zero is a straight cut, which is what hard clipping means and makes the
 * most of the high harmonics - the ones that sound like breakage rather than
 * like thickness. Measured on a sine two decibels into the ceiling, the
 * seventh harmonic falls from -31.6 dB to -42.1 across this range while the
 * third barely moves, which is the whole of what a knee is for.
 *
 * Twelve at the top, because past that the bend starts so far below the
 * ceiling that it is a saturator rather than a clipper - and there is a
 * saturator next door with seven curves and a harmonic display of its own.
 */
export const CEIL_KNEE = [0, 12];

/**
 * Which peak the ceiling is a ceiling for.
 *
 * The default is the true one, which is the opposite of the sketchpad's own
 * limiter and for the opposite reason: this is a master, and a master has an
 * encoder downstream. See the table in `lib/limiter.js` for what the sample
 * detector lets past - three and a half decibels on noise.
 */
export const CEIL_PEAKS = [
  { id: 'true', label: 'True peak' },
  { id: 'sample', label: 'Sample' },
];

/** Where the tool opens: a ceiling, and nothing being pushed into it. */
export const CEIL_DEFAULTS = {
  drive: 0,
  ceiling: CEILING_DB,
  release: LIMIT_RELEASE * 1000,
  output: 0,
  peak: 'true',
  mode: 'limit',
  knee: 0,
};

/**
 * A value kept inside a range.
 *
 * Exported so the player clamps the same way the reading does - a face whose
 * audio and whose meter disagreed about what a setting meant would be a very
 * confusing thing to debug. Not `held`, which `learn/work/panning.js` already
 * owns in the one scope the bundler flattens everything into.
 */
export const heldTo = (value, [low, high]) => Math.max(low, Math.min(high, value));

/** One limiter, built from what the knobs say. */
export function ceilingFor(rate, settings) {
  return makeLimiter(rate, {
    ceiling: heldTo(settings.ceiling ?? CEILING_DB, CEIL_RANGE),
    release: heldTo(settings.release ?? CEIL_RELEASE[0], CEIL_RELEASE) / 1000,
    truePeak: (settings.peak ?? 'true') === 'true',
    lookahead: LIMIT_AHEAD,
    mode: CEIL_SHAPES.some((shape) => shape.id === settings.mode)
      ? settings.mode
      : CEIL_DEFAULTS.mode,
    knee: heldTo(settings.knee ?? 0, CEIL_KNEE),
  });
}

/**
 * A pair through the drive and the ceiling, with the reduction recorded.
 *
 * The drive is a plain gain in front, not a threshold: a limiter's threshold
 * IS its ceiling, so the only way to ask for more of it is to send more in.
 * That is what every mastering limiter's input or drive control does, and
 * saying so is clearer than giving the ceiling a second name.
 */
export function runCeiling(left, right, settings, rate) {
  const drive = 10 ** (heldTo(settings.drive ?? 0, CEIL_DRIVE) / 20);
  const outL = Float32Array.from(left, (v) => v * drive);
  const outR = Float32Array.from(right, (v) => v * drive);

  const limiter = ceilingFor(rate, settings);
  const gr = new Float32Array(outL.length);

  // In blocks, as the audio thread will, so that what is measured is what is
  // heard rather than a version of it that saw the whole signal at once.
  const span = 128;
  for (let at = 0; at < outL.length; at += span) {
    const to = Math.min(at + span, outL.length);
    limiter.block([outL.subarray(at, to), outR.subarray(at, to)]);
    // One reduction a block, held across it. The limiter's gain moves inside a
    // block and the trace is read at five milliseconds, which is twice a
    // block at 48 kHz, so nothing is lost that the trace could have shown.
    for (let i = at; i < to; i += 1) gr[i] = limiter.reduction;
  }

  // And the output trim, after everything, which is the only place it can go
  // and still be honest: it is there to match a level for a comparison, and a
  // trim in front of the ceiling would change what the ceiling did.
  const out = 10 ** (heldTo(settings.output ?? 0, CEIL_OUTPUT) / 20);
  if (out !== 1) {
    for (let i = 0; i < outL.length; i += 1) { outL[i] *= out; outR[i] *= out; }
  }

  return { left: outL, right: outR, gr };
}

/**
 * What the chain does to a steady tone: the harmonic series.
 *
 * The reading that separates the two modes, and it separates them completely.
 * A limiter is transparent to a steady tone however hard it is pushed - the
 * gain settles and what comes out is the same wave, quieter - so the series
 * is empty. A clipper cannot be: it is cutting the shape of the wave, and the
 * shape is the series.
 *
 * The whole chain is probed, drive and output trim included, because that is
 * what the knobs are set to and what the ear is hearing. At no drive the tool
 * is not distorting anything and the reading says so.
 *
 * `kind: 'harmonics'` on the saturator's axis, deliberately: "what did this
 * add to a sine" is one question however the thing answering it is built, and
 * `distance` can now put a clipper's series beside a saturator's.
 */
export function ceilingHarmonics(material, rate, settings, { source = null } = {}) {
  const drive = 10 ** (heldTo(settings.drive ?? 0, CEIL_DRIVE) / 20);
  const out = 10 ** (heldTo(settings.output ?? 0, CEIL_OUTPUT) / 20);
  const limiter = ceilingFor(rate, settings);

  // One sample at a time, which is what a probe is. A block of one is not a
  // special case for anything above - the lookahead and the rings carry
  // between calls either way.
  const one = new Float32Array(1);
  const step = (x) => {
    one[0] = x * drive;
    limiter.block([one]);
    return one[0] * out;
  };

  return readingOf({
    tool: 'limiter',
    kind: 'harmonics',
    of: { state: stampOf(settings), source, axis: HARMONIC_AXIS },
    values: seriesOf(spectrumThrough(step, PROBE_BIN), PROBE_BIN),
  });
}

/**
 * What the pass cost, in the three figures a master is judged on.
 *
 * Taken off the audio on both sides rather than worked out from the settings,
 * for the reason every reading in this app is: the drive is a gain and the
 * trim is a gain, so the arithmetic would be easy and would also be a second
 * implementation able to drift from the first one silently.
 *
 * `match` is the output trim that makes the two sides the same loudness - the
 * level-matched bypass every mastering engineer works with, and the only
 * honest way to hear what a limiter is doing rather than how loud it got.
 */
export function ceilingCost(material, pass, rate) {
  const read = (left, right) => {
    const lufs = integrated(
      [kWeight(left, rate), kWeight(right, rate)], rate,
    ).lufs;
    const peak = Math.max(truePeakOf(left), truePeakOf(right));
    return { lufs, peak, plr: peak - lufs };
  };

  const before = read(material.left, material.right);
  const after = read(pass.left, pass.right);
  return { before, after, match: before.lufs - after.lufs };
}

/**
 * The output trim that makes a setting's output as loud as its input.
 *
 * Measured rather than derived, and clamped to what the knob can reach: a
 * drive of twenty-four decibels into a limiter comes out some sixteen louder
 * than it went in, which is inside the range, but a setting that asked for
 * more would silently fail to match rather than match wrongly.
 */
export function matchOut(material, rate, settings) {
  const pass = runCeiling(material.left, material.right, { ...settings, output: 0 }, rate);
  const { match } = ceilingCost(material, pass, rate);
  if (!Number.isFinite(match)) return 0;
  return heldTo(match, CEIL_OUTPUT);
}

/**
 * The drive that makes the ceiling work this hard, in decibels of reduction.
 *
 * One pass, and it is exact. The deepest reduction a lookahead limiter
 * reaches is set by the single loudest moment in the material and by nothing
 * else: the gain applied is `min(smoothed, lowest)` where `lowest` is the
 * sliding minimum of what each sample asked for, so the applied gain reaches
 * the smallest ask exactly, and the smallest ask is `roof / peak`. Driving by
 * a constant scales that peak by the same constant. So
 *
 *     deepest reduction = drive + (peak - ceiling)
 *
 * once the peak is over the ceiling at all - and the bracket is signed, so
 * material with five decibels of headroom needs five decibels of drive before
 * the ceiling is touched. Measure the reduction at one drive and the bracket
 * falls out; the drive for a wanted reduction is then that read backwards.
 *
 * This started as a twelve-round bisection, which cost 1900 ms a call on four
 * seconds of stereo and was exactly 1:1 at every step of a nine-decibel
 * sweep. That is not a coincidence to be smoothed over by a search, it is the
 * structure, and `tests/ceiling.test.js` holds the whole of it against the
 * reduction the limiter actually reaches.
 *
 * The bracket is then measured rather than read off `truePeakOf`, and the
 * difference is small and real. The meter's true-peak search is an optimised
 * one: it reconstructs only around local maxima within a few decibels of the
 * sample peak, at two output positions each. The limiter's is exhaustive -
 * every phase of every sample. On noise the meter comes out 0.058 dB under
 * the limiter, which asked for one decibel of reduction and got 1.058. So the
 * drive is set from the limiter's own reckoning of where the peak is, which
 * is the one that decides what it does.
 *
 * The probe drive is the top of the range, because that is the one value
 * guaranteed to reduce something on anything this tool will be handed. If
 * even that reduces nothing the material is quieter than the range can reach,
 * and the honest answer is the loudest drive there is.
 */
export function driveFor(material, rate, settings, wantGR) {
  if (!(wantGR > 0)) return 0;

  const probe = CEIL_DRIVE[1];
  const pass = runCeiling(
    material.left, material.right, { ...settings, drive: probe, output: 0 }, rate,
  );

  let deepest = 0;
  for (let i = 0; i < pass.gr.length; i += 1) if (pass.gr[i] < deepest) deepest = pass.gr[i];
  if (deepest === 0) return probe;

  // What the material is over the ceiling at no drive at all, signed.
  const over = -deepest - probe;
  return heldTo(wantGR - over, CEIL_DRIVE);
}

/**
 * What the ceiling did, in the terms a compressor's reduction is read in.
 *
 * The same kind and the same frame axis, deliberately: "how much is this
 * reducing" is one question however the thing answering it is built, and two
 * readings that answer it should be comparable. What differs is that a
 * limiter's reduction is all depth and no shape - there is no knee to be
 * gentle about and no ratio to be partial about - so the timing half of the
 * comparator has less to say here than it does next door.
 */
export function ceilingReading(material, rate, settings) {
  const pass = runCeiling(material.left, material.right, settings, rate);

  let deepest = 0;
  let total = 0;
  for (let i = 0; i < pass.gr.length; i += 1) {
    if (pass.gr[i] < deepest) deepest = pass.gr[i];
    total += pass.gr[i];
  }

  return {
    trace: pass.gr,
    audio: pass,
    reading: readingOf({
      tool: 'limiter',
      kind: 'reduction',
      of: {
        state: stampOf(settings),
        source: null,
        axis: {
          kind: 'frames',
          ms: FRAME_MS,
          rate,
          // The channels, not the envelope around them: `materialStamp` takes
          // a buffer or a list of them, and handing it `{ left, right }`
          // stamped as 'none' - so every reading matched every other one and
          // two readings over different loops compared happily.
          over: materialStamp([material.left, material.right]),
        },
      },
      values: {
        gr: meanFrames(pass.gr, rate, FRAME_MS),
        deepest,
        average: pass.gr.length ? total / pass.gr.length : 0,
        makeup: 0,
      },
    }),
  };
}
