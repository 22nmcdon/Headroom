// What something did to a sine: the harmonic series, and how to compare two.
//
// This was the saturator's, and it was right to be while the saturator was
// the only thing here that distorted anything on purpose. The clipper makes
// it wrong: `tests/seams.test.js` refuses a plugin that imports another
// plugin, and the alternative was a second probe and a second series, which
// is worse than either - two readings would then claim the same axis having
// computed it two ways and `comparable()` would wave them through.
//
// So the probe, the series and the comparator live here, where anything that
// adds harmonics can share them. What stays with each plugin is the thing
// being probed: a shaper's curve, a clipper's ceiling.
//
// That sharing buys a question the app could not ask before. A clipper's
// series and a saturator's are the same kind of reading on the same axis, so
// `distance` can put them side by side - "is this clipper adding more than
// that saturator was" is now a thing with an answer.

import { fft } from './fft.js';

/**
 * The probe: how long, which bin, and how loud.
 *
 * Bin-aligned on purpose. A tone that does not sit exactly on a bin leaks
 * across its neighbours, and the leak is larger than most of what is being
 * measured - so the frequency is chosen by picking a bin rather than the
 * other way round. Bin 150 of 16384 at 48 kHz is 439.45 Hz, which is a
 * musician's A for every purpose except a tuner's.
 *
 * At -12 dBFS, which leaves room for a curve that lifts before it bends.
 */
export const PROBE_LENGTH = 16384;
export const PROBE_BIN = 150;
export const PROBE_LEVEL = -12;

/** How long the thing being probed runs before anything is measured. */
export const PROBE_PRIME = 4096;

/** How many harmonics are read, and shown. */
export const HARMONICS = [2, 3, 4, 5, 6, 7, 8, 9, 10];

/** What a harmonic reading is indexed by: which harmonics, in order. */
export const HARMONIC_AXIS = { kind: 'harmonics', ids: HARMONICS };

/**
 * One bin-aligned sine through something, as power per bin.
 *
 * `step` is called with each input sample and hands back the output - which
 * is all this needs to know about whatever it is probing. A saturator's core,
 * a clipper, a wire; they are the same shape to a spectrum.
 *
 * The prime is for anything with state. A filter's ringing inside a
 * rectangular window is not periodic in it, so until it has settled it leaks
 * across every bin at once - which is the whole of the aliasing reading. For
 * a memoryless curve the prime costs a quarter of the measurement and buys
 * nothing, and it is kept anyway: a probe that is only correct for the
 * stateless case is a trap for whatever is written next.
 */
export function spectrumThrough(step, bin = PROBE_BIN) {
  const turn = (2 * Math.PI * bin) / PROBE_LENGTH;
  const amplitude = Math.pow(10, PROBE_LEVEL / 20) * Math.SQRT2;

  for (let i = 0; i < PROBE_PRIME; i += 1) step(amplitude * Math.sin(turn * i));

  const re = new Float64Array(PROBE_LENGTH);
  const im = new Float64Array(PROBE_LENGTH);
  for (let i = 0; i < PROBE_LENGTH; i += 1) {
    re[i] = step(amplitude * Math.sin(turn * (i + PROBE_PRIME)));
  }

  fft(re, im);

  const power = new Float64Array(PROBE_LENGTH / 2);
  for (let i = 0; i < power.length; i += 1) power[i] = re[i] * re[i] + im[i] * im[i];
  return power;
}

/**
 * Everything that is neither the tone nor a harmonic of it, against the tone.
 *
 * On an honest curve this is the noise floor. If it climbs, it is aliasing -
 * harmonics that went past half the sample rate and folded back down to
 * frequencies with no musical relationship to anything - and that is the one
 * failure mode of shaping a signal without running the curve faster than the
 * signal first.
 */
export function foldbackIn(power, bin, against = power[bin]) {
  let total = 0;
  for (let i = 1; i < power.length; i += 1) total += power[i];

  let series = 0;
  for (let m = 1; bin * m < power.length; m += 1) series += power[bin * m];

  // Against the same reference the harmonics are read against, or full-wave
  // rectification - which takes the fundamental away - reports its own noise
  // floor as 204 dB of aliasing.
  return 10 * Math.log10(Math.max(total - series, 1e-20) / Math.max(against, 1e-20));
}

/**
 * A power spectrum, read as a harmonic series.
 *
 * Everything is in decibels below the loudest component rather than below the
 * fundamental. For every family that bends a curve these are the same number,
 * because the fundamental always survives a bend. Full-wave rectification is
 * the family that breaks it: it folds the negative half up, the output
 * repeats at twice the rate it went in, and the tone that went in is simply
 * gone. Read against it, a second harmonic 268 dB "above" the fundamental is
 * not a measurement, it is a division by nothing.
 */
export function seriesOf(power, bin = PROBE_BIN) {
  const first = power[bin];

  let loudest = first;
  for (const m of HARMONICS) {
    const at = bin * m;
    if (at < power.length && power[at] > loudest) loudest = power[at];
  }
  const dbOf = (p) => 10 * Math.log10(Math.max(p, 1e-20) / Math.max(loudest, 1e-20));

  const harmonics = {};
  let evens = 0;
  let odds = 0;
  for (const m of HARMONICS) {
    const at = bin * m;
    harmonics[m] = at < power.length ? dbOf(power[at]) : -120;
    if (at >= power.length) continue;
    if (m % 2 === 0) evens += power[at]; else odds += power[at];
  }

  let total = 0;
  for (let i = 1; i < power.length; i += 1) total += power[i];

  return {
    harmonics,
    // Total harmonic distortion: everything that was added, against the tone
    // it was given.
    thd: 10 * Math.log10(Math.max(total - loudest, 1e-20) / Math.max(loudest, 1e-20)),
    // How much of the note that went in is still there. Below about -40 the
    // thing in front of it has replaced the note rather than coloured it.
    fundamental: dbOf(first),
    // The two halves of the series, each as a whole. Which of these is the
    // louder is the single thing an ear can hear about a distortion without
    // being trained: even is an octave and a twelfth above, which sounds like
    // the note getting richer, and odd is a fifth and a major third, which
    // sounds like something going wrong.
    even: dbOf(evens),
    odd: dbOf(odds),
    aliasing: foldbackIn(power, bin, loudest),
  };
}

/* ---------- comparing two of them ---------- */

/**
 * Below this a harmonic is not part of what anybody is hearing.
 *
 * Two numbers rather than one. The absolute floor is where a harmonic is too
 * quiet to matter at all; the masking figure is how far under the loudest
 * harmonic a quieter one stops being audible beside it. Whichever is higher
 * wins, so a loud series is compared on its loud harmonics and a quiet one
 * is not compared on its noise floor.
 *
 * Not `HEAT_FLOOR`, which is what these were called while only the saturator
 * had them.
 */
export const SERIES_FLOOR = -62;
export const MASKED = 38;

/**
 * How far apart two harmonic profiles are: the worst harmonic, in decibels.
 *
 * The worst rather than the average, for the reason every other mode here
 * found in turn. What anybody means by two distortions sounding the same is
 * that the whole series matches - a third harmonic eight decibels out is
 * audible as a different distortion however well the other eight agree, and
 * averaging it across nine numbers turns it into a rounding error.
 *
 * **Pairwise only.** The masking floor is derived from the two readings in
 * front of it, so this is not a metric and cannot be used to rank three
 * readings against each other: `seriesGap(a, b)` and `seriesGap(a, c)` are
 * measured against different floors and their `off` values are not on the
 * same scale. That is the right behaviour for the question it answers, and
 * the wrong thing to build a nearest-neighbour search on.
 */
export function seriesGap(mine, theirs) {
  const a = mine.values ?? mine;
  const b = theirs.values ?? theirs;

  let loudest = -Infinity;
  for (const m of HARMONICS) {
    if (a.harmonics[m] > loudest) loudest = a.harmonics[m];
    if (b.harmonics[m] > loudest) loudest = b.harmonics[m];
  }
  const floor = Math.max(SERIES_FLOOR, loudest - MASKED);

  let off = 0;
  let which = null;
  let louder = 0;

  for (const m of HARMONICS) {
    const mineM = Math.max(a.harmonics[m], floor);
    const theirsM = Math.max(b.harmonics[m], floor);
    const gap = Math.abs(mineM - theirsM);
    if (gap > off) { off = gap; which = m; louder = mineM - theirsM; }
  }

  // A label, not an index. This used to hand back the number 3 and leave every
  // caller to turn it into "3rd harmonic" itself, which is how a comparator
  // ends up with three conventions between four implementations.
  return {
    off,
    where: which === null ? null : `${ordinal(which)} harmonic`,
    detail: { harmonic: which, louder, thd: a.thd - b.thd },
  };
}

export const seriesDistance = (mine, theirs) => seriesGap(mine, theirs).off;

/** 2nd, 3rd, 4th - how anybody says which harmonic they mean. */
export function ordinal(n) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}
