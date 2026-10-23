// Reading an impulse response.
//
// Three of the plugins in this app are linear: an EQ, a reverb and a delay
// all do the same thing to every sound put through them, which means each of
// them is completely described by what it does to one click. So each of them
// can be measured the same way, and two of them are marked that way - the
// reverb and the delay both come down to how the response decays, band by
// band, moment by moment.
//
// None of this knows what made the response it is handed. That is the point:
// a room and a repeat are the same kind of object here, and the day a third
// one turns up it will be too.

import { makeBiquad, setBiquad, runBiquad } from '../plugins/compressor/dsp.js';
import { readingOf, stampOf } from './read.js';

/** The bands a decay is read in - the three an engineer talks about. */
export const RESPONSE_BANDS = [
  { id: 'low', label: 'Low', low: 60, high: 400 },
  { id: 'mid', label: 'Mid', low: 400, high: 3000 },
  { id: 'high', label: 'High', low: 3000, high: 12000 },
];

/** The floor a decay is read down to. Below this there is nothing to hear. */
export const DECAY_FLOOR = -60;

/** The longest tail any of this covers, in seconds. */
export const LONGEST_TAIL = 8;

const sq = (x) => x * x;

/**
 * The energy decay curve, in decibels: how much of the response is still to
 * come at each moment.
 *
 * Schroeder's backwards integral, which is the standard way to measure a
 * decay and far steadier than looking at the envelope - a tail is noise, and
 * noise wanders several decibels from sample to sample while the integral of
 * it does not wander at all.
 */
export function decayCurve(samples, rate, times, against = null) {
  const running = new Float64Array(samples.length + 1);
  for (let i = samples.length - 1; i >= 0; i -= 1) {
    running[i] = running[i + 1] + sq(samples[i]);
  }

  // Against the whole room, when a caller has one: that is what makes this a
  // reading of a band's share as well as of its decay.
  const total = against ?? running[0];
  if (total <= 0) return times.map(() => DECAY_FLOOR);

  return times.map((t) => {
    const at = Math.round(t * rate);
    if (at >= samples.length) return DECAY_FLOOR;
    const left = running[at] / total;
    return Math.max(DECAY_FLOOR, 10 * Math.log10(Math.max(left, 1e-12)));
  });
}

/**
 * The decay time, measured rather than assumed.
 *
 * Read off the part of the curve between -5 and -25 dB and extrapolated to
 * -60, which is what a room measurement does: the first few decibels are the
 * direct sound and the last few are under the noise, and neither belongs to
 * the decay.
 */
export function rt60(samples, rate) {
  const step = 0.005;
  const times = [];
  for (let t = 0; t < samples.length / rate; t += step) times.push(t);
  const curve = decayCurve(samples, rate, times);

  const cross = (db) => {
    for (let i = 0; i < curve.length; i += 1) if (curve[i] <= db) return times[i];
    return null;
  };

  const from = cross(-5);
  const to = cross(-25);
  if (from === null || to === null || to <= from) return 0;
  return ((to - from) * 60) / 20;
}

/** One band of a response, for reading its decay on its own. */
export function bandOf(samples, rate, band) {
  const out = new Float32Array(samples.length);
  out.set(samples);

  if (band.low > 20) {
    for (let pass = 0; pass < 2; pass += 1) {
      const hp = setBiquad(makeBiquad(), 'highpass', band.low, rate);
      for (let i = 0; i < out.length; i += 1) out[i] = runBiquad(hp, out[i]);
    }
  }
  if (band.high < 20000) {
    for (let pass = 0; pass < 2; pass += 1) {
      const lp = setBiquad(makeBiquad(), 'lowpass', band.high, rate);
      for (let i = 0; i < out.length; i += 1) out[i] = runBiquad(lp, out[i]);
    }
  }

  return out;
}

/**
 * The times a decay is compared at.
 *
 * Spaced logarithmically, because a decay is heard as a ratio: the difference
 * between a third of a second and half a second is a different room, and the
 * difference between five seconds and five and a bit is nothing at all. On an
 * even grid out to seven seconds every short room sat on the floor after four
 * points and they all read the same.
 */
export const decayTimes = (count = 60, from = 0.004, to = LONGEST_TAIL) =>
  [0, ...Array.from({ length: count - 1 }, (_, i) =>
    from * (to / from) ** (i / (count - 2)))];

/**
 * What a room does, in the terms it is judged in: how it decays, band by band.
 *
 * Takes the response to read rather than the room, because what anybody hears
 * is the dry sound and the room together - see `wetDryImpulse`. Handed the
 * wet side on its own, the mix knob was invisible: the reverb decays the same
 * way whether it is at five per cent or a hundred, so a match could be scored
 * perfect with the reverb turned all the way down and nothing audible at all.
 *
 * One reading then covers every control at once. Decay is the slope of it,
 * pre-delay is the flat part at the start, damping is the three bands pulling
 * apart, the early-late balance is the shape of the first few decibels, the
 * send filters are where each band begins, and the mix is the step down from
 * the direct sound to the room - so two reverbs whose profiles sit on each
 * other are the same reverb, however their knobs were arrived at.
 */
export function decayProfile(mono, rate, times = decayTimes()) {
  // Every band against the whole room rather than against itself. Normalised
  // band by band, a room with the low end filtered off its send read as
  // identical to one without - its low band still decayed from nought to
  // minus sixty, there was just less of it. Against the total, a band that
  // has been taken out starts low and stays low, so what the send filters do
  // is in the same reading as everything else.
  const bands = RESPONSE_BANDS.map((band) => bandOf(mono, rate, band));
  const total = bands.reduce((sum, samples) => {
    let energy = 0;
    for (let i = 0; i < samples.length; i += 1) energy += sq(samples[i]);
    return sum + energy;
  }, 0);

  const profile = {};
  RESPONSE_BANDS.forEach((band, i) => {
    profile[band.id] = decayCurve(bands[i], rate, times, total);
  });
  return profile;
}

/**
 * Both ears together, for measuring - a room's decay is not a stereo question.
 *
 * Summed rather than averaged, because this is a measurement and the two
 * channels of a room are very nearly uncorrelated: adding them keeps the
 * energy, and averaging them throws away about five and a half decibels of
 * it. That matters in one place and matters a lot there - `wetDryImpulse`
 * weighs the room against a direct sound of a known size, so a room measured
 * five decibels quiet reads as five decibels drier than it is.
 */
export function monoOf(impulse) {
  const [left, right] = impulse.channels;
  const out = new Float32Array(impulse.length);
  for (let i = 0; i < impulse.length; i += 1) out[i] = left[i] + (right ? right[i] : 0);
  return out;
}

/**
 * What a decay profile is indexed by, carried on the reading so it can be
 * checked.
 *
 * `profileDistance` walks `a.length` and has never looked at `b.length`. Two
 * profiles on different time axes - a different count, a different span - were
 * silently assumed to line up, and comparing them produced a plausible number
 * out of points that are not the same points. Nothing carried an axis, so
 * nothing could have caught it.
 */
export const decayAxis = (times = decayTimes()) =>
  ({ kind: 'time', n: times.length, from: times[1] ?? 0, to: times[times.length - 1] });

/**
 * A decay, in an envelope.
 *
 * The reverb and the delay share this, and they share it on purpose: a room
 * and a repeat are the same kind of object here, described by what they do to
 * one click. So they declare the same kind and their readings are genuinely
 * comparable - which is not a curiosity, it is why "is this delay as long as
 * that room" is a question this app can answer at all.
 */
export function decayReading(tool, profile, { times = decayTimes(), state, source = null } = {}) {
  return readingOf({
    tool,
    kind: 'decay',
    of: { state: stampOf(state), source, axis: decayAxis(times) },
    values: profile,
  });
}

/** How far apart two rooms are, in decibels of decay. */
export function profileDistance(mine, theirs) {
  let sum = 0;
  let count = 0;

  for (const band of RESPONSE_BANDS) {
    const a = mine[band.id];
    const b = theirs[band.id];
    // The shorter of the two, so a mismatch is a short comparison rather than
    // a walk off the end of one side reading undefined as NaN. Whether a
    // mismatch should have been compared at all is `comparable`'s question,
    // and it is asked before this is called.
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i += 1) {
      sum += sq(a[i] - b[i]);
      count += 1;
    }
  }

  return Math.sqrt(sum / Math.max(1, count));
}

/**
 * How far apart two decays are, and where.
 *
 * The number is the same root-mean-square over every band and every moment
 * that has always been used - it is calibrated, and it stays. What is added is
 * which band is furthest out, because "1.4 dB out" with no address is a score
 * rather than a reading.
 */
export function decayGap(mine, theirs) {
  const a = mine.values;
  const b = theirs.values;

  let worstBand = null;
  let worstOff = 0;

  for (const band of RESPONSE_BANDS) {
    let sum = 0;
    let count = 0;
    const n = Math.min(a[band.id].length, b[band.id].length);
    for (let i = 0; i < n; i += 1) {
      sum += sq(a[band.id][i] - b[band.id][i]);
      count += 1;
    }
    const off = Math.sqrt(sum / Math.max(1, count));
    if (off > worstOff) { worstOff = off; worstBand = band; }
  }

  // Which way, in the band that is worst: is yours still going, or already
  // gone. Averaged over the band rather than taken at a point, because one
  // moment of a decay is noise and the shape of it is the reading.
  let bias = 0;
  if (worstBand) {
    const n = Math.min(a[worstBand.id].length, b[worstBand.id].length);
    for (let i = 0; i < n; i += 1) bias += a[worstBand.id][i] - b[worstBand.id][i];
    bias /= Math.max(1, n);
  }

  return {
    off: profileDistance(a, b),
    where: worstBand ? `the ${worstBand.label.toLowerCase()} band` : null,
    detail: { band: worstBand?.id ?? null, bandOff: worstOff, longer: bias },
  };
}

/**
 * The whole thing you actually hear: the dry signal and the room together.
 *
 * Clarity is a property of that, not of the reverb on its own - a wash of a
 * room with the mix at ten per cent is a perfectly clear sound, and the
 * reading has to say so.
 */
export function wetDryImpulse(impulse, mix) {
  const mono = monoOf(impulse);
  const out = new Float32Array(mono.length);
  const wet = Math.min(1, Math.max(0, mix));

  for (let i = 0; i < out.length; i += 1) out[i] = mono[i] * wet;
  // The dry path is the sound arriving with nothing done to it at all, which
  // in these terms is exactly one sample at the front.
  out[0] += 1 - wet;
  return out;
}
