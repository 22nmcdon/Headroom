// How much of a track is transient and how much is body.
//
// Crest factor: the peak over the RMS, in decibels. It is the oldest and
// bluntest measure of dynamics there is and it is still the one that shows
// limiting, because limiting is exactly the operation that takes the peaks
// off and brings the body up. A drum loop untouched sits in the low twenties;
// the same loop through a limiter set to flatten it reads in single figures.
//
// Over time as well as overall, because the number for a whole track is an
// average of its loud parts and its quiet ones and says less than the shape
// does. A master that holds 12 dB through the verses and drops to 5 in the
// choruses has been limited in the choruses, and only the series shows it.

import { readingOf, stampOf } from '../lib/read.js';

// How long a window is, and how far apart two of them start. Named for the
// crest reading rather than just `CREST_STEP_MS`: the loudness reading next door
// has a block and a step of its own, and the bundle flattens both into one
// scope - which it refuses to do while two modules claim the same name.
export const CREST_WINDOW_MS = 400;
export const CREST_STEP_MS = 100;

/** Below this a window is silence, and has no crest factor worth printing. */
const QUIET_FLOOR = -70;

const db = (x) => 20 * Math.log10(Math.max(x, 1e-12));

/**
 * The peak and the RMS of a stretch of samples, taken across every channel.
 *
 * Across rather than per channel: what is being measured is the programme,
 * and a peak on one side is a peak. The RMS is the mean over all of them for
 * the same reason - two channels carrying the same thing are not twice as
 * dynamic as one.
 */
function windowOf(channels, from, to) {
  let peak = 0;
  let power = 0;
  let count = 0;

  for (const channel of channels) {
    for (let i = from; i < to; i += 1) {
      const value = channel[i];
      const size = value < 0 ? -value : value;
      if (size > peak) peak = size;
      power += value * value;
      count += 1;
    }
  }

  return { peak, rms: Math.sqrt(power / Math.max(1, count)) };
}

/**
 * The track cut into step-length pieces, each with its peak and its power.
 *
 * Every window is four of these in a row, so the pieces are measured once and
 * the windows are four lookups. What was here walked every sample of every
 * window, and the windows overlap by three quarters - on a four-minute track
 * that is four times the work for the same answer.
 *
 * Pieces rather than a running total, because a peak is not a sum: the
 * largest value in a window cannot be got by subtracting one running total
 * from another, and the largest of four pieces is exactly the largest of the
 * window they make.
 */
function piecesOf(channels, step, samples) {
  const pieces = [];

  for (let at = 0; at < samples; at += step) {
    const to = Math.min(samples, at + step);
    let peak = 0;
    let power = 0;

    for (const channel of channels) {
      for (let i = at; i < to; i += 1) {
        const value = channel[i];
        const size = value < 0 ? -value : value;
        if (size > peak) peak = size;
        power += value * value;
      }
    }

    pieces.push({ peak, power, count: (to - at) * channels.length });
  }

  return pieces;
}

/**
 * Crest factor over the whole thing, and window by window.
 *
 * Windows under the floor are dropped rather than printed: the crest factor
 * of silence is a ratio of two numbers that are both nearly zero, and it
 * comes out as whatever the dither happened to do.
 */
export function crestOf(channels, rate) {
  const length = Math.round((rate * CREST_WINDOW_MS) / 1000);
  const step = Math.round((rate * CREST_STEP_MS) / 1000);
  const samples = Math.min(...channels.map((channel) => channel.length));

  const whole = windowOf(channels, 0, samples);
  const pieces = piecesOf(channels, step, samples);
  const per = Math.max(1, Math.round(length / step));
  const over = [];

  for (let first = 0; first + per <= pieces.length; first += 1) {
    let peak = 0;
    let power = 0;
    let count = 0;
    for (let i = first; i < first + per; i += 1) {
      if (pieces[i].peak > peak) peak = pieces[i].peak;
      power += pieces[i].power;
      count += pieces[i].count;
    }

    const rms = Math.sqrt(power / Math.max(1, count));
    if (db(rms) < QUIET_FLOOR) continue;
    over.push({ at: (first * step) / rate, crest: db(peak) - db(rms) });
  }

  return {
    crest: db(whole.peak) - db(whole.rms),
    peak: db(whole.peak),
    rms: db(whole.rms),
    over,
  };
}

/**
 * The crest factor of a piece of audio, in its envelope.
 *
 * `tightest` is the one worth looking at after the overall figure: the lowest
 * the crest factor gets anywhere in the track, which is where the limiter was
 * working hardest.
 */
export function crestReading(channels, rate, { source = null } = {}) {
  const { crest, peak, rms, over } = crestOf(channels, rate);
  const values = over.map((point) => point.crest);

  return readingOf({
    tool: 'analysis',
    kind: 'crest',
    of: {
      state: stampOf({ channels: channels.length, rate }),
      source,
      axis: { kind: 'time', ms: CREST_STEP_MS, window: CREST_WINDOW_MS, rate },
    },
    values: {
      crest,
      peak,
      rms,
      tightest: values.length ? Math.min(...values) : crest,
      widest: values.length ? Math.max(...values) : crest,
      over,
    },
  });
}

/**
 * How far apart two pieces of audio are, in dynamics.
 *
 * The overall crest factor, with the tightest moment in the detail. Two
 * masters that agree overall and differ by six decibels at their tightest are
 * not the same master, and that difference is the one anybody arguing about
 * loudness is actually arguing about.
 */
export function crestGap(mine, theirs) {
  const a = mine.values ?? mine;
  const b = theirs.values ?? theirs;

  const off = a.crest - b.crest;
  return {
    off,
    where: 'overall',
    detail: {
      wider: off,
      tightest: a.tightest - b.tightest,
      peak: a.peak - b.peak,
    },
  };
}
