// The grid everything in this app is cut to.
//
// Here rather than in the engine because the delay needs it to write a time
// in beats, and a plugin that has to import the engine to name a beat is a
// plugin that cannot be lifted out of this app. See tests/seams.test.js.
//
// The note values moved down here from the delay for the same reason one step
// later: the modulation suite names its rate as a division too - a tremolo at
// 1.6 Hz on a 96 bpm loop is a quarter note, and that is the only way anybody
// wants to be told it - and a plugin may not import another plugin. One list,
// so the delay's division drill and the modulation suite's are asking about
// the same five things rather than about two tables that agree today.

/**
 * The shape of every loop this app plays: two bars of four, at 96.
 *
 * Named because things outside the engine need them. A reverb asked to clear
 * by the next beat has to know how long a beat is, and working that out
 * backwards from the loop's length would be working out an answer from an
 * answer.
 */
export const LOOP_BPM = 96;
export const LOOP_BARS = 2;
export const LOOP_BEAT = 60 / LOOP_BPM;

/**
 * The note values a delay is set to, as fractions of a beat.
 *
 * Spread out on purpose. Every adjacent pair here is at least a third apart,
 * so telling one from the next is a question about the music rather than a
 * question about a stopwatch - a dotted eighth and a quarter triplet are only
 * twelve per cent apart, which is a difference you can measure and not one
 * anybody names by ear.
 */
export const DIVISIONS = [
  { id: 'quarter', label: '1/4', beats: 1 },
  { id: 'dotted8', label: 'dotted 1/8', beats: 0.75 },
  { id: 'eighth', label: '1/8', beats: 0.5 },
  { id: 'triplet8', label: '1/8 triplet', beats: 1 / 3 },
  { id: 'sixteenth', label: '1/16', beats: 0.25 },
];

/** The ones a sync menu offers, which can afford to be finer than the ear. */
export const SYNC_DIVISIONS = [
  { id: 'free', label: 'Free', beats: null },
  { id: 'quarter', label: '1/4', beats: 1 },
  { id: 'dotted8', label: 'dotted 1/8', beats: 0.75 },
  { id: 'quartertrip', label: '1/4 triplet', beats: 2 / 3 },
  { id: 'eighth', label: '1/8', beats: 0.5 },
  { id: 'dotted16', label: 'dotted 1/16', beats: 0.375 },
  { id: 'triplet8', label: '1/8 triplet', beats: 1 / 3 },
  { id: 'sixteenth', label: '1/16', beats: 0.25 },
];

/**
 * How often a fader is moved when it is riding, in steps per bar.
 *
 * Here because both ends need it and they are in folders that may not import
 * each other: `sketch/stage.js` books the steps and `mix/ride.js` is the
 * exercise and the arithmetic. A grid of sixteen a bar is a tempo fact, which
 * is what this file is for.
 *
 * Sixteen is a step every 156 ms at 96, and a fader is moved with
 * `setTargetAtTime` at a time constant of 10 ms - so each step is long over
 * before the next arrives and what comes out is a staircase. A staircase of
 * about a tenth of a decibel at a time, on a level that is already moving,
 * against a real ramp that would have meant a new method on the file every
 * instrument in the app goes through.
 */
export const RIDE_STEPS = 16;

/** A note value, in milliseconds of this track. */
export const timeOf = (beats) => beats * LOOP_BEAT * 1000;

/**
 * A note value, as a modulation rate: one cycle per note.
 *
 * The convention every synced modulation uses, and the only way anybody wants
 * to be told a rate - a tremolo on eighths pulses twice a beat, and nobody
 * has ever asked for one at 3.2 hertz. Here rather than in the modulation
 * plugin because its exercises need the same arithmetic and a work file that
 * imported a face to get it would be importing a canvas to name a beat.
 */
export const rateFor = (beats) => 1000 / timeOf(beats);

/** The note value nearest a time, and how far off it is. */
export function nearestDivision(ms, among = SYNC_DIVISIONS) {
  let best = null;
  for (const division of among) {
    if (division.beats === null) continue;
    const off = Math.abs(Math.log2(ms / timeOf(division.beats)));
    if (!best || off < best.off) best = { division, off };
  }
  return best;
}
