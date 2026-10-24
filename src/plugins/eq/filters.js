// The maths behind the curve.
//
// What an equaliser is, for somebody using one rather than changing one, is
// in src/learn/notes/eq.js - including the long version of the slope note below.
//
// Every band is a biquad, from the Audio EQ Cookbook - the same filters Web
// Audio builds, with the same coefficients, so the curve drawn on screen is
// the curve the audio actually has rather than a picture of roughly what it is
// doing. A drawing that drifts from the sound is worse than no drawing: this
// one is checked against `BiquadFilterNode.getFrequencyResponse` to a
// hundredth of a decibel.


import { readingOf, stampOf } from '../../lib/read.js';
import { svfOf, svfBiquad } from './svf.js';

/**
 * What each kind of band has, and what its handle means vertically.
 *
 * Every type contributes something known at its own corner frequency, which is
 * what lets the handle sit on the curve rather than beside it:
 *
 *   peak     its gain, exactly
 *   shelf    half its gain - a shelf is halfway up at its corner
 *   HP / LP  its resonance, exactly, because Web Audio states that in decibels
 *
 * So dragging a handle up and down is the same gesture on all five: it sets
 * whichever number that band contributes there.
 */
export const BAND_TYPES = {
  highpass: { label: 'High-pass', short: 'HP', gain: false, resonance: true, contributes: 1 },
  lowshelf: { label: 'Low shelf', short: 'LS', gain: true, contributes: 0.5 },
  peaking: { label: 'Peak', short: 'PK', gain: true, q: true, contributes: 1 },
  highshelf: { label: 'High shelf', short: 'HS', gain: true, contributes: 0.5 },
  lowpass: { label: 'Low-pass', short: 'LP', gain: false, resonance: true, contributes: 1 },
};

/**
 * How steep a cut is, in decibels per octave.
 *
 * Six is missing and it is not an oversight. A 6 dB/oct filter is first
 * order, and every filter Web Audio will build is second: BiquadFilterNode
 * has no one-pole type and takes no coefficients of its own. It could be had
 * from an IIRFilterNode, whose coefficients are fixed at construction - so
 * moving the corner would mean building a new node under a dragging finger,
 * sixty times a second, each one starting from no state at all. That is a
 * click per frame. The three slopes here are the ones a desk actually gives
 * you, and they are exact.
 */
export const SLOPES = [12, 24, 48];

/**
 * A Butterworth cascade, as the resonance each of its sections needs - in
 * Web Audio's decibels, which is what its low-pass and high-pass read.
 *
 * The useful fact about these numbers is that they multiply to 1/root 2 at
 * every even order, so the cascade is 3 dB down at its corner whether it is
 * twelve an octave or forty-eight. Which means the handle maths does not care
 * about slope at all: a cut still contributes exactly its resonance at its
 * own corner, and still sits on the curve.
 */
export function butterworth(order) {
  const sections = [];
  for (let k = 0; k < order / 2; k += 1) {
    const q = 1 / (2 * Math.cos(((2 * k + 1) * Math.PI) / (2 * order)));
    sections.push(20 * Math.log10(q));
  }
  return sections;
}

/** Flat, in the decibels a cut's resonance is stated in. */
export const FLAT_CORNER = 20 * Math.log10(Math.SQRT1_2);

/** The most biquads any one band is built from - a 48 dB/oct cut. */
export const MOST_SECTIONS = 4;

/**
 * What a shelf's Q rests at, and why it is not 0.7.
 *
 * The cookbook shelf takes a slope S rather than a Q, and Web Audio's shelves
 * take neither - they are fixed at S = 1, which is the steepest a shelf can be
 * and still rise or fall all the way without overshooting. The band carried a
 * Q of 0.7 anyway, for the day it became a bell, and nothing read it.
 *
 * Now something does, and S = 1 is exactly a Q of one over root two. Measured:
 * at 0.70710678 the state-variable shelf is bit-identical to the cookbook
 * shelf at every frequency; at 0.7 it is 0.038 dB out at the corner. A
 * rounding nobody could hear, and the sort that makes two models disagree for
 * no reason anybody can find later.
 */
export const SHELF_Q = Math.SQRT1_2;

/** The channel strip, in the order an engineer reads it: low to high. */
export const STRIP = [
  // The cuts start flat - in Web Audio's decibels, the maximally flat filter
  // every desk calls Butterworth, which reads -3.0 on the face of it.
  { id: 'hp', type: 'highpass', frequency: 40, gain: 0, q: FLAT_CORNER, slope: 12 },
  { id: 'ls', type: 'lowshelf', frequency: 120, gain: 0, q: SHELF_Q, slope: 12 },
  { id: 'p1', type: 'peaking', frequency: 400, gain: 0, q: 1.4, slope: 12 },
  { id: 'p2', type: 'peaking', frequency: 2000, gain: 0, q: 1.4, slope: 12 },
  { id: 'hs', type: 'highshelf', frequency: 8000, gain: 0, q: SHELF_Q, slope: 12 },
  { id: 'lp', type: 'lowpass', frequency: 18000, gain: 0, q: FLAT_CORNER, slope: 12 },
];

export const newStrip = () => STRIP.map((band) => ({ ...band, on: false }));

/** What a band's q means when it becomes this kind of band. */
export const RESTING_Q = {
  highpass: FLAT_CORNER, lowpass: FLAT_CORNER, peaking: 1.4, lowshelf: SHELF_Q, highshelf: SHELF_Q,
};

/**
 * The biquads a band is actually made of.
 *
 * One, for everything but a cut. A cut is a Butterworth cascade, and the
 * resonance the player dialled goes on its last and sharpest section - which
 * is where resonance lives in a cascade, and leaves the rest maximally flat.
 */
export function sectionsOf(band) {
  if (!BAND_TYPES[band.type].resonance) return [band];

  const corners = butterworth((band.slope ?? 12) / 6);
  const resonance = (band.q ?? FLAT_CORNER) - FLAT_CORNER;

  return corners.map((q, i) => ({
    type: band.type,
    frequency: band.frequency,
    gain: 0,
    q: q + (i === corners.length - 1 ? resonance : 0),
  }));
}

/**
 * The six coefficients of one band, normalised so a0 is 1.
 *
 * Through the state-variable filter, which is the same filter written another
 * way - measured bit-identical to the cookbook forms this used to compute, for
 * every band type at every frequency, once the shelves' Q was the root-half
 * that S = 1 has always meant. One description now draws, scores and, when the
 * worklet lands, sounds.
 */
export function coefficients(band, rate) {
  return svfBiquad(svfOf(band, rate));
}

/** What one biquad does at one frequency, in decibels. */
export function sectionGainAt(coeffs, frequency, rate) {
  const { b0, b1, b2, a1, a2 } = coeffs;
  const w = (2 * Math.PI * frequency) / rate;

  // H(e^jw), written out: cos and sin of one and two steps round the circle.
  const cos1 = Math.cos(w); const sin1 = Math.sin(w);
  const cos2 = Math.cos(2 * w); const sin2 = Math.sin(2 * w);

  const numRe = b0 + b1 * cos1 + b2 * cos2;
  const numIm = -(b1 * sin1 + b2 * sin2);
  const denRe = 1 + a1 * cos1 + a2 * cos2;
  const denIm = -(a1 * sin1 + a2 * sin2);

  const magnitude = Math.sqrt((numRe * numRe + numIm * numIm) / (denRe * denRe + denIm * denIm));
  return 20 * Math.log10(magnitude);
}

/** What one band does at one frequency - every section of it, added up. */
export function bandGainAt(band, frequency, rate) {
  let db = 0;
  for (const section of sectionsOf(band)) {
    db += sectionGainAt(coefficients(section, rate), frequency, rate);
  }
  return db;
}

/** The whole strip's curve: what the bands come to, band by band, in dB. */
/** What one band adds at its own corner - the height its handle sits at. */
export function contributionOf(band, rate = 48000) {
  if (band.on === false) return 0;
  return bandGainAt(band, band.frequency, rate);
}

/**
 * The frequencies a curve is read at: where the ear is, at the spacing the ear
 * hears.
 *
 * Below 30 and above 16k there is little to hear and a great deal of room to
 * be wrong in, which would flatter or punish a guess for nothing.
 *
 * This lived in the EQ exercise, which was the only thing that read a curve.
 * Now the plugin reads one too, and the two have to be on the same axis or
 * comparing them is arithmetic over a coincidence.
 */
export const JUDGED_HZ = logFrequencies(96, 30, 16000);

/** What a curve is indexed by, carried on the reading so it can be checked. */
export const CURVE_AXIS = { kind: 'hz', n: 96, from: 30, to: 16000 };

/**
 * A curve, in an envelope.
 *
 * The EQ used to cache nothing at all - `curveOf` ran three times per frame,
 * which is cheap enough that nobody noticed and is still three answers to one
 * question with nothing saying they agree. This is the one answer.
 */
export function curveReading(bands, rate = 48000, { source = null } = {}) {
  return readingOf({
    tool: 'eq',
    kind: 'curve',
    of: { state: stampOf(bands), source, axis: CURVE_AXIS },
    values: curveOf(bands, JUDGED_HZ, rate),
  });
}

/**
 * How far two curves are apart, at their worst point.
 *
 * The worst point rather than the average: averaged across the spectrum a
 * single band is a small part of a wide range, so doing nothing at all
 * measured about two decibels and very nearly passed. What "matched" means to
 * anybody looking at two curves is that they sit on each other everywhere,
 * which is exactly what the largest gap between them measures.
 *
 * This was inside the EQ exercise's `score`, taking two sets of bands and
 * building both curves itself. Taking readings instead means the same
 * comparison works between anything that produces a curve - a guess against an
 * answer, yours against a reference, this chain against that one.
 */
/**
 * How wide a mismatch is worth, against how deep it is.
 *
 * Measured, because the two are not the same thing and the scoring used to
 * treat them as one. A bell at 1 kHz on this app's bed, the curve's own
 * decibels against how far the bed's octave band actually moves:
 *
 *       width   3 dB    6 dB    9 dB   12 dB
 *    1.92 oct   1.88    3.49    4.78    5.74
 *    1.00 oct   1.67    3.16    4.39    5.34
 *    0.48 oct   1.01    2.04    3.09    4.09
 *    0.24 oct   0.56    1.29    2.20    3.27
 *    0.12 oct   0.37    0.91    1.69    2.69
 *
 * Twelve decibels of narrow bell move the bed less than six decibels of wide
 * one. So a worst point of 2 dB is a different answer depending on whether it
 * is two decibels across an octave or two decibels across a twelfth of one,
 * and marking both the same lets an inaudible notch fail a match that is
 * otherwise perfect.
 *
 * The ratio of band movement to curve decibels comes out at about 0.5 at an
 * octave, 0.34 at a half, 0.23 at a quarter and 0.17 at an eighth. Inverted
 * and referred to an octave, that is the square root of one over the width -
 * which fits every row above to within 0.1 - and it stops widening past an
 * octave, because beyond that an octave-band measure cannot see the
 * difference anyway.
 */
export const OCTAVE_EQUIVALENT = (octaves) =>
  Math.min(3, Math.max(1, Math.sqrt(1 / Math.max(octaves, 1e-3))));

/**
 * The worst point, and how wide the miss is around it.
 *
 * Still the worst point, deliberately: an average cannot say where you went
 * wrong, and where is half of what makes the answer useful. What is new is
 * `octaves`, the width of the mismatch measured the way a bandwidth is always
 * measured - outwards from the peak until it has fallen by half - and `off`,
 * which is now that worst point expressed as the octave-wide move it is worth.
 * `peak` is the raw decibels, for anything that wants to print them.
 */
export function curveGap(mine, theirs) {
  const a = mine.values;
  const b = theirs.values;

  let worst = 0;
  let worstAt = 0;
  let worstIndex = 0;

  for (let i = 0; i < a.length; i += 1) {
    const off = a[i] - b[i];
    if (Math.abs(off) > Math.abs(worst)) {
      worst = off;
      worstAt = JUDGED_HZ[i];
      worstIndex = i;
    }
  }

  // How wide the miss is, as the width of the rectangle holding the same area
  // - the whole of the mismatch over its own peak, not the shoulders of one
  // lobe.
  //
  // Reading it outwards from the worst point until it halved was the first
  // try and it was wrong in a way a test caught: a band put a third of an
  // octave off its mark does not make one narrow miss, it makes two - up on
  // one side and down on the other - and measuring only the lobe the worst
  // point sits in called an audible misplacement narrow and forgave it. The
  // area counts both.
  const step = Math.log2(JUDGED_HZ[1] / JUDGED_HZ[0]);
  let area = 0;
  for (let i = 0; i < a.length; i += 1) area += Math.abs(a[i] - b[i]) * step;
  const octaves = Math.abs(worst) > 1e-9 ? area / Math.abs(worst) : step;

  const peak = Math.abs(worst);
  return {
    off: peak / OCTAVE_EQUIVALENT(octaves),
    peak,
    octaves,
    where: worstAt ? writeHz(worstAt) : null,
    detail: { hz: worstAt, louder: worst, octaves },
  };
}

export function curveOf(bands, frequencies, rate = 48000) {
  const curve = new Float64Array(frequencies.length);

  for (const band of bands) {
    if (band.on === false) continue;
    // A band sitting at unity is not in the signal path in any audible sense.
    if (BAND_TYPES[band.type].gain && band.gain === 0) continue;

    // Coefficients once per section rather than once per point: a 48 dB/oct
    // cut is four biquads, and this is called on every move of every knob.
    for (const section of sectionsOf(band)) {
      const coeffs = coefficients(section, rate);
      for (let i = 0; i < frequencies.length; i += 1) {
        curve[i] += sectionGainAt(coeffs, frequencies[i], rate);
      }
    }
  }

  return curve;
}

/** A frequency, written the way a plugin writes it: short on the face of the
    display, spelled out where there is room. */
export const shortHz = (hz) =>
  (hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)}k` : String(Math.round(hz)));

/**
 * A frequency with enough of it left to type back in.
 *
 * `shortHz` is for the face of the display, where room is the point and 3.15k
 * reading as 3.1k costs nothing. In a field somebody has just typed 3k15
 * into, it costs the thing they typed.
 */
export const exactHz = (hz) =>
  (hz >= 1000 ? `${Number((hz / 1000).toFixed(2))}k` : String(Math.round(hz)));

export const writeHz = (hz) =>
  (hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)} kHz` : `${Math.round(hz)} Hz`);

/**
 * How much louder a curve makes things, overall - the number auto gain takes
 * back off.
 *
 * Averaged in power rather than in decibels, because loudness is power: a
 * narrow 12 dB spike is a large number on the display and almost nothing to
 * the meter, and averaging the decibels would treat it as though it were both.
 * Spaced logarithmically, which weights every octave equally - near enough to
 * how music's energy is spread, and much nearer than counting hertz.
 *
 * It matters more here than it looks. A boosted curve is a louder curve, and
 * louder is the oldest false positive in the business: without this, an A/B
 * against the target rewards whoever boosted more, and the exercise quietly
 * trains the wrong instinct.
 */
export const LIFT_BANDS = 64;
export const liftFrequencies = () => logFrequencies(LIFT_BANDS, 30, 16000);

export function averageLift(bands, rate = 48000, weights = null) {
  const frequencies = liftFrequencies();
  const curve = curveOf(bands, frequencies, rate);

  let lifted = 0;
  let flat = 0;

  for (let i = 0; i < curve.length; i += 1) {
    // What the material has here, if anyone has measured it. Without that,
    // every octave counts the same - which is a fair guess and no better than
    // a guess, because a shelf on a bass-heavy loop is a much bigger move than
    // the same shelf on a hi-hat.
    const weight = weights ? weights[i] : 1;
    lifted += weight * 10 ** (curve[i] / 10);
    flat += weight;
  }

  return 10 * Math.log10(lifted / flat);
}

/** Frequencies spaced the way the ear hears them, and the way an EQ draws them. */
export function logFrequencies(count, low = 20, high = 20000) {
  return Array.from({ length: count }, (_, i) =>
    low * (high / low) ** (i / (count - 1)));
}
