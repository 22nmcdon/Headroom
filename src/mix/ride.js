// A fader that moves while the music is playing.
//
// Everything else in this exercise is a mix: four settings that are true for
// the whole four bars. A ride is the other half of mixing - the part that
// comes up under the second half and goes away again - and nothing here
// could ask for it, because a project's gain is one number.
//
// ## Why it is a swell and not a lift in one bar
//
// Measured, and the measurement is about the material rather than about the
// arithmetic. A three decibel lift of one part in bar three moves the
// master's own bar-by-bar shape by 0.53 dB on one piece and 0.42 on the
// other - while the shape of the flat mix already wanders by -0.73 to +0.42
// between its own bars, because it is music. A one-bar lift on four bars of
// one riff is a bar index, not a ride: these pieces have no sections for a
// lift to be the chorus of.
//
// A swell has somewhere to go. Six decibels of it over the four bars reads
// 0.41 and 0.39 on the master, which is the same order of size - and that is
// the point of the next section.
//
// ## Why it is read on the parts and not on the master
//
// Because on the master it is too small to mark honestly. Six decibels of
// swell against seven is 0.07 dB of difference on the master's bar shape, so
// a tolerance that forgave a decibel of depth would be a tolerance of about
// a fifteenth of one - a tenth of anything else in `score.js`, and a number
// that any future change to the material would move by more than its own
// width.
//
// On the part itself, six decibels of swell is six decibels of swell. The
// stems render is already taken for `levels` and `share`, each part's own
// bars are right there in it, and the reading is then about the part that
// rides rather than about what is left of it in the sum. It is the argument
// `levels.js` makes against reading only the master, one more time.

import { kWeight } from '../lib/loudness.js';
import { readingOf, stampOf, gapOf } from '../lib/read.js';
import { LOOP_BPM, LOOP_BEAT, RIDE_STEPS } from '../lib/tempo.js';
import { STEM_IDS, HOW_LONG } from './piece.js';

/** How many bars a ride is a shape over, which is the loop. */
export const RIDE_BARS = HOW_LONG;

/** And how long one of them is, in seconds. */
export const BAR_SECONDS = LOOP_BEAT * 4;

/**
 * Where a ride is, as a fraction of the way through the loop.
 *
 * A straight line from one end to the other, which is the whole shape. Not a
 * curve, not a hold-and-release: the thing being practised is how far, and a
 * shape with two numbers in it would be asking two questions and marking the
 * answer to one.
 *
 * Half the depth either side of nought, so a swell does not also turn the
 * part up: a six decibel swell is three down at the top of the loop and
 * three up at the end of it, and its average over the loop is nothing. That
 * keeps the ride out of `levels`, which reads each part over the whole four
 * bars and would otherwise report a part that rides as a part set wrong.
 */
export const rideAt = (depth, through) => depth * (through - 0.5);

/** A ride, as a gain to multiply a fader by. */
export const rideGain = (depth, through) => 10 ** (rideAt(depth, through) / 20);

/** How often the stage moves the fader. Both ends take it from `lib/tempo.js`. */
export { RIDE_STEPS };

/* --- what came out --------------------------------------------------------- */

/** One part's level in each bar, in decibels, with its own mean taken out. */
export function barsOf(channels, rate, bars = RIDE_BARS) {
  const weighted = channels.map((channel) => kWeight(channel, rate));
  const span = BAR_SECONDS * rate;

  const levels = [];
  for (let bar = 0; bar < bars; bar += 1) {
    const from = Math.round(bar * span);
    const to = Math.min(weighted[0].length, Math.round((bar + 1) * span));
    let sum = 0;
    for (const channel of weighted) {
      for (let i = from; i < to; i += 1) sum += channel[i] * channel[i];
    }
    const n = Math.max(1, (to - from) * weighted.length);
    levels.push(10 * Math.log10(Math.max(sum / n, 1e-20)));
  }

  // Its own mean, so what is left is the shape over time and not the level.
  // How loud the part is has a reading already - `levels` - and a part that
  // is right and riding should fail on neither.
  const mean = levels.reduce((sum, one) => sum + one, 0) / Math.max(1, levels.length);
  return levels.map((one) => one - mean);
}

/** Every part's shape over the loop. */
export function ridesOf(stems, rate, bars = RIDE_BARS) {
  const shapes = {};
  for (const stem of stems) {
    if (stem.kind !== 'track') continue;
    if (!STEM_IDS.includes(stem.id)) continue;
    shapes[stem.id] = barsOf(stem.channels, stem.rate ?? rate, bars);
  }
  return shapes;
}

/** What a ride reading is indexed by: the stems, bar by bar. */
export const RIDE_AXIS = { kind: 'stem-bars', ids: STEM_IDS, bars: RIDE_BARS, bpm: LOOP_BPM };

/** The shapes, in an envelope. */
export function rideReading(stems, rate, { source = null } = {}) {
  const shapes = ridesOf(stems, rate);
  return readingOf({
    tool: null,
    kind: 'ride',
    of: {
      state: stampOf({ parts: Object.keys(shapes).sort(), rate }),
      source,
      axis: RIDE_AXIS,
    },
    values: { shapes },
  });
}

/**
 * How far apart two sets of shapes are: the worst part in the worst bar.
 *
 * The worst rather than an average over sixteen numbers, for the reason
 * every other reading here gives - and more so here, because a ride that is
 * right for three bars and wrong in the fourth is exactly the mistake this
 * is for.
 */
export function rideGap(mine, theirs) {
  const a = (mine.values ?? mine).shapes;
  const b = (theirs.values ?? theirs).shapes;

  let off = 0;
  let where = null;
  let part = null;
  const each = {};

  for (const id of Object.keys(a)) {
    if (!b[id]) continue;
    a[id].forEach((level, bar) => {
      if (b[id][bar] === undefined) return;
      const by = level - b[id][bar];
      each[`${id}:${bar + 1}`] = by;
      if (Math.abs(by) > Math.abs(off)) {
        off = by;
        where = `bar ${bar + 1}`;
        part = id;
      }
    });
  }

  return gapOf({ off, where, detail: { part, louder: off, each } });
}
