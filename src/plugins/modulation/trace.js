// What a modulation did, as a path through time.
//
// Its own file, as the compressor's reading is, and for the same reason:
// `dsp.js` promises that every function in it closes over nothing, because
// `node.js` stringifies the lot and hands it to the audio thread. What is
// here runs in Node and in the page and never in a worklet.
//
// The reading is the modulator's own path rather than a measurement taken off
// the audio, and that is a decision with a cost, so it is worth saying why.
//
// The audio consequence of a modulation is different for each family and no
// single probe sees all of them. Measured: a tone through the vibrato at full
// depth comes out with its amplitude unchanged to 0.00 dB and no dip anywhere
// in the spectrum - it is a pure delay, so anything measuring level is blind
// to it. A noise probe sees a chorus and a phaser clearly and is blind to the
// same vibrato for the same reason. A tone probe sees the vibrato's pitch and
// is blind to a phaser whose notches are nowhere near it: with the corner at
// 670 Hz the notches sit at 180, 669 and 2480, so a 1 kHz tone reads 0.1 dB
// of a sweep that is taking fifty decibels out of the band next door.
//
// So: three probes, three readings, three axes nothing could compare - or the
// path itself, which is exact, costs a tenth of what a demodulator costs, and
// is the same quantity for all six. The delay made the same call for its
// wander, with the same sentence in front of it.
//
// What it cannot see is anything downstream of the oscillator: the mix and
// the feedback. Measured, moving the feedback from -0.9 to +0.9 moves this
// reading by exactly 0.00. That is why no round asks for the feedback, and
// why the notes have to earn their keep about what it is for.

import { readingOf, stampOf } from '../../lib/read.js';
import {
  MOD_DEFAULTS, MOD_FAMILIES, MOD_LIMITS, MOVE_FLOOR, modKind, modCore, modHeld,
} from './dsp.js';

/**
 * How long the path is watched for, and in how many frames.
 *
 * Four seconds at a hundred and twenty-eight frames, which is the shape the
 * delay's wander reading uses and for the same arithmetic: the frames are
 * 31.25 ms, so the fastest modulation this can see is sixteen hertz against a
 * ceiling of twelve, and the slowest is one cycle in the window - which is
 * what sets the bottom of the rate control at a quarter of a hertz.
 */
export const MOD_SECONDS = 4;
export const MOD_FRAMES = 128;

/**
 * And at what sample rate the path is run, which is not the audio's.
 *
 * Six kilohertz, because nothing in a path needs more. The oscillator is the
 * slowest thing in this app - a cycle of the fastest modulation on offer is
 * five hundred samples at this rate - and the only part of the core that
 * depends on the sample rate at all is a three-sample guard at the end of a
 * line that no sweep here reaches. Measured against the same paths run at 48
 * kHz, the worst frame of any of the six differs by 1.4e-3 of full travel at
 * twelve hertz and 8.6e-5 at half a hertz, which is a hundredth of what any
 * tolerance here is set at.
 *
 * What it buys is the measurement: four seconds of the dearest of the six
 * costs 54 ms of core at the audio rate and 8 at this one, and the whole
 * reading went from 101 ms to 10 - which is the difference between a face
 * that redraws while a knob is moving and one that does not. And it buys
 * something better than speed - a reading that does not depend on the sample
 * rate is a reading that is the same in a test and in a browser, at 44.1 and
 * at 48, so the axis does not have to carry a rate and two readings taken on
 * different machines can still be compared.
 */
export const MOD_RATE = 6000;

/** How many frames go by in a second, which is the sampling rate of a path. */
export const MOD_PER_SECOND = MOD_FRAMES / MOD_SECONDS;

/**
 * The path, in each family's own unit, as the fraction of full travel it is.
 *
 * One number for all six, so that a tolerance means the same thing whichever
 * is being matched: a tenth of the travel is a tenth of the travel whether
 * that travel is six milliseconds of delay, two octaves of corner or the
 * whole way down to silence.
 *
 * Each family converts differently and each conversion is the one the ear
 * uses. Delay is linear in milliseconds. A corner is logarithmic, because a
 * sweep that is linear in hertz spends nine tenths of its time in the top
 * octave and sounds like it. A gain is linear in amplitude rather than in
 * decibels - a tremolo at half depth really does halve the signal, where half
 * of the decibels to silence is a quarter of it.
 */
export function travelOf(kind, moving) {
  if (kind.family === 'phase') return Math.log2(moving / kind.centre) / kind.span;
  if (kind.family === 'level') return 10 ** (moving / 20) - 1;
  return (moving - kind.centre) / kind.span;
}

/** And back, for a display that wants to label an axis. */
export function unitOf(kind, travel) {
  if (kind.family === 'phase') return kind.centre * (2 ** (travel * kind.span));
  if (kind.family === 'level') return 20 * Math.log10(Math.max(10 ** (MOVE_FLOOR / 20), 1 + travel));
  return kind.centre + travel * kind.span;
}

/**
 * The oscillator's path, run from a known start.
 *
 * `reset` first, every time, so that two runs of the same settings produce the
 * same path to the bit and two runs of different settings are compared from
 * the same moment. Without it the comparison would be partly about which
 * phase each happened to be in when somebody pressed a key, which is the one
 * thing about a modulation that nobody can hear and nobody is being asked.
 *
 * Fed silence, because the path does not depend on the signal: the oscillator
 * runs on the clock. The core is still run sample by sample rather than the
 * oscillator being evaluated directly, because the clamps are part of the
 * answer - a sweep asked to go deeper than the line is long comes back
 * shorter, and a reading that did the arithmetic itself would not know.
 */
export function modTrack(settings) {
  const whole = { ...MOD_DEFAULTS, ...settings };
  const kind = modKind(whole.kind);
  const core = modCore(MOD_RATE).set(whole).reset();

  const span = Math.round(MOD_SECONDS * MOD_RATE);
  const per = span / MOD_FRAMES;
  const left = new Float32Array(MOD_FRAMES);
  const right = new Float32Array(MOD_FRAMES);

  // Averaged over the frame rather than sampled at the end of it, because a
  // twelve hertz modulation sampled at thirty-two would alias - and converted
  // to travel once the frame is averaged rather than sample by sample, which
  // is both a hundred and twenty-eight logarithms instead of a hundred and
  // ninety-two thousand and the more defensible of the two: the frame's
  // number is then the mean delay, corner or gain over the frame, which is
  // what the audio in it actually was.
  let frame = 0;
  let until = per;
  let sumL = 0;
  let sumR = 0;
  let count = 0;

  for (let i = 0; i < span; i += 1) {
    core.stereo(0, 0);
    sumL += core.moving[0];
    sumR += core.moving[1];
    count += 1;
    if (i + 1 >= until && frame < MOD_FRAMES) {
      left[frame] = travelOf(kind, sumL / count);
      right[frame] = travelOf(kind, sumR / count);
      frame += 1;
      until = per * (frame + 1);
      sumL = 0;
      sumR = 0;
      count = 0;
    }
  }

  return { left, right };
}

/**
 * How fast a path is going, in hertz.
 *
 * The strongest bin of its own transform, with its two neighbours used to
 * interpolate between bins. The bins are a quarter of a hertz apart and the
 * parabola puts the answer between them: measured against the rate it was
 * asked for,
 *
 *     asked     found        asked     found
 *     0.25      not read     2.20      2.1965
 *     0.40      not read     3.00      3.0000
 *     0.55      0.5577       4.80      4.8035
 *     0.80      0.8035       6.40      6.3970
 *     1.60      1.6031       9.00      9.0000
 *                           12.00     12.0000
 *
 * which is the bin spacing beaten by a factor of sixty, because a sine
 * sampled evenly through a Hann window is very nearly the shape the parabola
 * is fitted to.
 *
 * The two at the top are not read, and that is this reading's one real limit.
 * A peak at the first bin has nothing on its left but the hole where the mean
 * was taken out, so the parabola has two points and a cliff: measured, 0.25 Hz
 * came out as 0.370 and 0.40 as 0.375 - the fit collapsing toward the same
 * wrong answer rather than failing. So anything below two bins is reported as
 * nought and said to be unmeasurable rather than guessed at, the control is
 * free to go slower than that because slow sweeps are real, and no round asks
 * for one.
 */
export function rateOf(frames, perSecond = MOD_PER_SECOND) {
  const n = frames.length;
  let mean = 0;
  for (let i = 0; i < n; i += 1) mean += frames[i];
  mean /= n;

  // Tapered, because the interpolation below is only as good as the shape
  // either side of the peak. A rectangular window leaks across every bin at
  // once unless the rate happens to land on one, and the parabola fitted to
  // that leakage saturated its own clamp at every rate tried - measured, the
  // answer came out at a bin edge every time, which is the fit refusing to
  // work rather than working. A Hann window's main lobe is four bins wide and
  // very nearly a parabola in decibels, which is what makes three magnitudes
  // enough. `taper` and not the obvious name for it: a DSP file that mentions
  // the browser's `window` is one that cannot be lifted out, and there is a
  // test in tests/seams.test.js that says so.
  const power = new Float64Array(n / 2);
  const taper = new Float64Array(n);
  for (let i = 0; i < n; i += 1) taper[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);

  for (let k = 1; k < n / 2; k += 1) {
    let real = 0;
    let imag = 0;
    for (let i = 0; i < n; i += 1) {
      const turn = (2 * Math.PI * k * i) / n;
      const value = (frames[i] - mean) * taper[i];
      real += value * Math.cos(turn);
      imag -= value * Math.sin(turn);
    }
    power[k] = real * real + imag * imag;
  }

  let best = 1;
  for (let k = 2; k < n / 2; k += 1) if (power[k] > power[best]) best = k;
  // Two bins, so there is a neighbour either side that is not the hole left
  // by the mean. See above for what happens without this.
  if (power[best] <= 0 || best < 2) return 0;

  // Between the bins, on a parabola through the three magnitudes. Logs,
  // because the shape either side of a peak is nearer a parabola in decibels
  // than in power and the correction is what is being asked for.
  const at = (k) => Math.log(Math.max(1e-30, power[k]));
  const low = at(best - 1);
  const mid = at(best);
  const high = at(Math.min(n / 2 - 1, best + 1));
  // The denominator is the curvature at the peak and it is negative, which is
  // what made the first version of this wrong: clamping it to a small positive
  // number sent every shift to its own limit, so every rate came out at half a
  // bin from where the transform had put it. Guarded on magnitude instead.
  const curve = low - 2 * mid + high;
  const shift = Math.abs(curve) < 1e-20 ? 0 : (0.5 * (low - high)) / curve;
  const bin = best + (Number.isFinite(shift) ? Math.max(-0.5, Math.min(0.5, shift)) : 0);

  return (bin * perSecond) / n;
}

/**
 * And how far it travels, as a fraction of what the control could ask for.
 *
 * Peak to peak and halved, which is the depth for the four kinds whose travel
 * is symmetric. The other two are not symmetric and are not meant to be: a
 * tremolo goes down from unity and never above it, and an auto-pan's sides
 * are a cosine of the position rather than the position. So this is a
 * measurement of the travel rather than a readback of the knob, and the two
 * differ where the geometry says they should - measured against the knob at a
 * half, as a fraction of each kind's own full travel, a chorus reads 0.50 and
 * an auto-pan 0.54. Which is why the face quotes the path's ends in the
 * family's own unit and not a percentage of anything.
 *
 * It also reads light at the top of the rate control, and the reason is the
 * frames rather than the oscillator: a frame is 31.25 ms, so at 12 Hz each one
 * averages three eighths of a cycle. Measured on a chorus at full depth, the
 * travel reads 8.00 to 20.00 ms at a quarter of a hertz, 8.11 to 19.89 at
 * three, 8.45 to 19.55 at six and 9.65 to 18.35 at twelve - which is 0.73 of
 * the real depth, against the 0.79 that averaging a sine over three eighths
 * of a cycle predicts. Left uncorrected rather than scaled back up, because a
 * per-rate constant fitted to one rate is a calibration pretending to be a
 * measurement - and both sides of any comparison are measured the same way.
 */
export function depthOf(frames) {
  let low = Infinity;
  let high = -Infinity;
  for (let i = 0; i < frames.length; i += 1) {
    if (frames[i] < low) low = frames[i];
    if (frames[i] > high) high = frames[i];
  }
  return { depth: (high - low) / 2, low, high };
}

/**
 * The axis two of these must share.
 *
 * The family is in it and the kind is not, which is the line between what can
 * be compared and what cannot. A chorus and a flanger are the same
 * measurement of the same quantity - a read head moving, as a fraction of its
 * own travel - so "is this flanger sweeping like that chorus" has an answer.
 * A chorus and a tremolo do not: one is a time and the other is a gain, and a
 * comparator handed both would produce a number rather than refuse, which is
 * the worst way to be wrong.
 */
export const modAxis = (family) => ({
  kind: 'modulation',
  family,
  unit: MOD_FAMILIES[family].unit,
  frames: MOD_FRAMES,
  seconds: MOD_SECONDS,
});

/** What a modulation is doing, and what that works out to. */
export function modReading(settings, { source = null } = {}) {
  const whole = { ...MOD_DEFAULTS, ...settings };
  const kind = modKind(whole.kind);
  const { left, right } = modTrack(whole);
  const fit = depthOf(left);

  return readingOf({
    tool: 'modulation',
    kind: 'modulation',
    of: { state: stampOf(whole), source, axis: modAxis(kind.family) },
    values: {
      left,
      right,
      // What the path works out to, for the figures and for the feedback.
      hz: rateOf(left),
      depth: fit.depth,
      // The ends of the travel, in the family's own unit, which is what
      // anybody setting one of these actually wants to be told.
      from: unitOf(kind, fit.low),
      to: unitOf(kind, fit.high),
      unit: MOD_FAMILIES[kind.family].unit,
      // And how differently the two sides move, which is the stereo spread
      // without a second fit: nought when both channels do the same thing.
      sides: apartOf(left, right),
    },
  });
}

/** How far apart the two channels' paths are, as a fraction of the travel. */
export function apartOf(left, right) {
  let sum = 0;
  for (let i = 0; i < left.length; i += 1) sum += (right[i] - left[i]) ** 2;
  return Math.sqrt(sum / Math.max(1, left.length));
}

/**
 * How far apart two modulations are, in per cent of full travel.
 *
 * The root mean square of the difference between the two paths, over both
 * channels, times a hundred. Per cent rather than decibels, as the delay's
 * transport reading is in cents rather than decibels, and for the same
 * reason: a tolerance should be in the unit the thing is set in, and what
 * these are set in is how far the oscillator goes.
 *
 * Both paths start at the top of the sweep - see `modTrack` - so this sees a
 * rate error as the two walking away from each other and a depth error as one
 * of them travelling further. Which means a single number covers both, and
 * `where` is what says which it was: the fits are compared side by side and
 * whichever is further out in its own terms is named.
 *
 * Measured on a chorus at 0.6 Hz and a depth of 0.4:
 *
 *     mistake                        reads
 *     nothing at all (no depth)      28.3
 *     the rate an eighth out          9.1
 *     the rate a quarter out         18.9
 *     the rate doubled               40.2
 *     the depth a tenth out           7.1
 *     the depth doubled              28.3
 *     the spread 90 degrees out      20.0
 *     the feedback either way         0.00
 *     the mix, which is not a knob    0.00
 *
 * The rate and the depth are both strongly marked and the feedback is not
 * marked at all, which is the honest summary of what a path can tell you.
 */
export function modGap(mine, theirs) {
  const a = mine.values ?? mine;
  const b = theirs.values ?? theirs;

  let sum = 0;
  let n = 0;
  for (const side of ['left', 'right']) {
    const one = a[side];
    const two = b[side];
    for (let i = 0; i < one.length; i += 1) {
      sum += (one[i] - two[i]) ** 2;
      n += 1;
    }
  }
  const off = 100 * Math.sqrt(sum / Math.max(1, n));

  // Which of the three it mostly is, each in its own terms: the rate in
  // octaves of itself, the depth and the sides as fractions of full travel.
  const rateOff = a.hz > 0 && b.hz > 0 ? Math.abs(Math.log2(a.hz / b.hz)) : 0;
  const depthOff = Math.abs(a.depth - b.depth);
  const sideOff = Math.abs(a.sides - b.sides);
  const worst = Math.max(rateOff / 0.17, depthOff / 0.1, sideOff / 0.1);

  return {
    off,
    where: off < 1 ? null
      : worst === rateOff / 0.17 ? 'the rate'
        : worst === depthOff / 0.1 ? 'the depth' : 'the two sides',
    detail: {
      hz: a.hz - b.hz,
      depth: a.depth - b.depth,
      sides: a.sides - b.sides,
      // Which way to turn each of them, which is what a hint needs.
      faster: a.hz < b.hz,
      deeper: a.depth < b.depth,
    },
  };
}
