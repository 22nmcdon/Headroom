// The simplest processor in the app, and the one the rest of it rests on.
//
// A trim is one multiply. There is no filter, no detector, no state and no
// worklet - a GainNode does exactly `y = x * g` and so does the arithmetic
// here, so for once the heard, the drawn and the marked thing are the same
// code without anybody having to arrange it.
//
// What makes this a tool rather than a knob is the other half: the meters. A
// level is the one thing in a mix that nobody can judge by ear without a
// reference, because loudness is a comparison and the ear has no absolute
// scale for it. So the tool is a loop, a trim, and a proper BS.1770 reading
// of what came out - and the exercises are about hearing a difference you can
// then go and confirm.

import { loudnessReading, loudnessGap, ABSOLUTE_GATE } from '../../lib/loudness.js';

/**
 * How far the trim goes, in decibels.
 *
 * Wide enough to undo anything this app can do to a level and narrow enough
 * that the reading stays honest, which is a real constraint rather than a
 * tidy one. Integrated loudness moves by exactly the trim - measured to four
 * decimal places at every step from -12 to +12 - but only while every 400 ms
 * block stays above the absolute gate at -70 LUFS. Below that the gate starts
 * throwing blocks away and the relationship comes apart. Measured on the bed
 * in `tests/level.test.js`, which reads -21.633 LUFS:
 *
 *     trim     integrated   out by   blocks kept
 *      -24       -45.633    0.0000       36
 *      -30       -51.633    0.0000       36
 *      -40       -61.174    0.4582       32
 *      -44       -64.441    1.1919       26
 *      -50       -69.063    2.5697       12
 *      -55      -Infinity      -           0
 *
 * So the floor is not a round number, it is wherever the material happens to
 * sit: a trim is exact until it is not, and where that happens depends on
 * what you fed it. The same table taken over a quieter bed read 0.6997 out at
 * -40 rather than 0.4582, which is the same effect arriving sooner and the
 * reason this is stated against a named piece of material rather than as a
 * figure. Twenty-four decibels is comfortably inside it for anything at a
 * normal mix level, and the far end is symmetric because a trim that can only
 * cut is half a control.
 */
export const TRIM_RANGE = [-24, 24];

/**
 * How finely the trim moves, in decibels.
 *
 * A tenth, because the exercises here are about half a decibel and a knob
 * whose smallest move is bigger than the tolerance is a knob that cannot
 * answer the question. That makes 480 steps across the range, which is more
 * than a drag has pixels - the knob's own shift-to-refine handles the last of
 * it, as it does everywhere else.
 */
export const TRIM_STEP = 0.1;

/** Nothing at all, which is where the tool opens. */
export const LEVEL_DEFAULTS = {
  trim: 0,
  listen: 'mine',
};

/** The trim as a plain multiplier, which is the whole of the processing. */
export const gainOf = (db) => 10 ** (Math.max(TRIM_RANGE[0], Math.min(TRIM_RANGE[1], db)) / 20);

/**
 * A pair through the trim.
 *
 * Here so that a test and an offline render can get at the same arithmetic the
 * graph runs, not because a multiply needs a function around it.
 */
export function runTrim(left, right, settings) {
  const g = gainOf(settings.trim ?? 0);
  return {
    left: Float32Array.from(left, (v) => v * g),
    right: Float32Array.from(right, (v) => v * g),
  };
}

/**
 * What came out, read the way a broadcaster would read it.
 *
 * This is `lib/loudness.js` and nothing else - the same K-weighting, the
 * same 400 ms blocks, the same two gates, the same four-times-oversampled
 * true peak. A level tool that measured level its own way would be teaching
 * its own arithmetic rather than the one every delivery spec in the world is
 * written in.
 *
 * The settings are stamped into `of.state` rather than left out, because a
 * reading is compared against what the tool is set to now and a trim that has
 * moved since has to read as stale. The loudness reading on the analysis page
 * has no settings to stamp, which is why it takes the state as an option
 * rather than assuming one.
 */
export function levelReading(left, right, rate, settings, { source = null } = {}) {
  const out = runTrim(left, right, settings);
  return loudnessReading([out.left, out.right], rate, {
    source,
    tool: 'level',
    state: { ...settings, rate },
  });
}

/**
 * How far apart two levels are.
 *
 * The loudness comparator, unchanged, because the question "is this as loud as
 * that" has one right answer and it is already written next door. `off` is in
 * LU and `detail.louder` says which way, which is the whole of what a
 * level-matching exercise needs to tell somebody.
 */
export const levelGap = loudnessGap;

/**
 * Where the gate sits, re-exported so the face can say why a reading stopped.
 *
 * A trim at the bottom of its range over quiet material produces a number that
 * is not the trim, and a meter that shows it without explanation looks broken.
 */
export const LEVEL_GATE = ABSOLUTE_GATE;
