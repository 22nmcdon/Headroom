// How loud each part is, which is the one thing the five master readings
// cannot say.
//
// A mix is marked on the master, and that is right: two different sets of
// moves that come out sounding the same are the same answer. But it leaves
// the feedback vague in a way that matters. "There is too much around 120 Hz"
// is true and is not an instruction; "the bass is 2.5 dB too hot" is. The
// difference between them is knowing which part the energy belongs to, and
// the master has already added them together.
//
// So this reads the stems. Not the fader positions - a stem's output level is
// its fader AND whatever its inserts did to it, and the tone tier puts an EQ
// on two of them, so deriving the level from the knob would be wrong exactly
// where the exercise is most interesting. Measured, from the same render:
// `sketch/stems.js` taps every track post-fader in one pass, which costs what
// one whole-mix render costs rather than one render a stem - 1233 ms against
// 1277 for the master on the same piece.

import { integrated, kWeight } from '../lib/loudness.js';
import { readingOf, stampOf, gapOf } from '../lib/read.js';
import { STEM_IDS } from './piece.js';

/**
 * The loudness of each part, in LUFS, by stem id.
 *
 * `stems` is what `renderStems` hands back: `{ id, kind, channels, rate }` per
 * tap, including the room and the mix. Only the tracks are read - the room is
 * a send return and the mix is the sum, and both are already covered by the
 * readings next door.
 */
export function levelsOf(stems, rate) {
  const parts = {};
  for (const stem of stems) {
    if (stem.kind !== 'track') continue;
    if (!STEM_IDS.includes(stem.id)) continue;
    const weighted = stem.channels.map((channel) => kWeight(channel, stem.rate ?? rate));
    parts[stem.id] = integrated(weighted, stem.rate ?? rate).lufs;
  }
  return parts;
}

/**
 * What the balance between the parts is, with the overall level taken out.
 *
 * Every level read against the average of them, so what is left is the shape
 * of the balance and not how loud the whole thing is. That separation is the
 * point rather than a tidy-up: how loud the master is already has a reading
 * of its own, and a mix that is perfectly balanced two decibels down should
 * fail on loudness and pass here. Reading the parts absolutely would have
 * failed it twice for one mistake and pointed at four parts for a fault that
 * was in none of them.
 *
 * The average is the plain mean of the decibel values rather than the
 * loudness of the sum. It is the mean the offset has to be removed in,
 * because the thing being removed is a gain on every fader at once, and that
 * moves every part's decibels by the same amount.
 */
export function shapeOf(parts) {
  const ids = Object.keys(parts).filter((id) => Number.isFinite(parts[id]));
  if (!ids.length) return {};

  const mean = ids.reduce((sum, id) => sum + parts[id], 0) / ids.length;
  return Object.fromEntries(ids.map((id) => [id, parts[id] - mean]));
}

/** What a mix's parts are indexed by: the stems, in order. */
export const LEVELS_AXIS = { kind: 'stems', ids: STEM_IDS };

/** The parts' levels, in an envelope. */
export function levelsReading(stems, rate, { source = null } = {}) {
  const parts = levelsOf(stems, rate);
  return readingOf({
    tool: null,
    kind: 'levels',
    of: { state: stampOf({ parts: Object.keys(parts).sort(), rate }), source, axis: LEVELS_AXIS },
    values: { parts, shape: shapeOf(parts) },
  });
}

/**
 * How far apart two balances are: the worst part, in decibels.
 *
 * The worst rather than the average, for the reason every other reading here
 * gives - a mix with three parts right and one a mile out is a mix with
 * something badly wrong in it, and averaging would call it nearly right.
 *
 * `where` is the part, which is what makes this worth having: it is the only
 * reading in the mix that can name a fader.
 */
export function levelsGap(mine, theirs) {
  const a = (mine.values ?? mine).shape;
  const b = (theirs.values ?? theirs).shape;

  let off = 0;
  let where = null;
  let hotter = 0;
  const each = {};

  for (const id of Object.keys(a)) {
    if (b[id] === undefined) continue;
    const by = a[id] - b[id];
    each[id] = by;
    if (Math.abs(by) > Math.abs(off)) { off = by; where = id; hotter = by; }
  }

  return gapOf({
    off,
    where,
    // Every part, not just the worst, because the advice can then name two if
    // two are out - which is what the easy tier asks for.
    detail: { hotter, each },
  });
}

/**
 * The parts that are out by more than this much, worst first.
 *
 * For the advice line, which wants to name them rather than report a number.
 */
export function partsOut(gap, allowed) {
  const each = gap.detail?.each ?? {};
  return Object.entries(each)
    .filter(([, by]) => Math.abs(by) > allowed)
    .sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]))
    .map(([id, by]) => ({ id, by }));
}
