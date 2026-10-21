// What the modes have in common when they score a guess.
//
// Most of these questions are "pick one off an ordered scale" - a frequency
// band, a pan position, a ratio - where the next-door answer is a near miss
// and two along is not. That reading is written once, here.

export const HIT = 'hit'; // sage - that is it
export const NEAR = 'near'; // gold - close, or partly right
export const MISS = 'miss'; // rust - nothing in common

/**
 * Hit on the answer, near next door to it, miss beyond that.
 *
 * The reading a question answered by picking off an ordered list wants: the
 * band below the one that is boosted is a near miss, three bands away is not.
 * Its callers went with the modes that asked you to name a chord; the drills
 * that ask you to name a band want exactly this and nothing else.
 */
export function onScale(guessIndex, answerIndex, { near = 1 } = {}) {
  const steps = Math.abs(guessIndex - answerIndex);
  if (steps === 0) return HIT;
  return steps <= near ? NEAR : MISS;
}

/** How far off, said in the units of the thing being guessed. */
export function distanceCell(steps, unit) {
  const away = Math.abs(steps);
  return {
    state: away === 0 ? HIT : away === 1 ? NEAR : MISS,
    text: away === 0 ? 'spot on' : `${away} ${unit}${away === 1 ? '' : 's'}`,
    narrow: true,
  };
}

/** Pick one of a list, deterministically. */
export const pick = (rng, list) => list[Math.floor(rng() * list.length)];

/* --- controls you dial, rather than options you pick --------------------- */

/**
 * How far a dialled value is from the one being matched, said the way an
 * engineer would say it: not "wrong" but "3 dB hot", "half an octave low".
 *
 * Direction is the point. A production tool that only says "close" leaves you
 * turning the knob both ways to find out which; saying which way turns the
 * next attempt into a decision instead of a guess.
 *
 * `unit` decides the arithmetic as well as the wording. Frequencies, ratios
 * and times are heard in ratios, so they are read in octaves ('oct') or as a
 * factor ('x'); decibels and percentages are differences, and read as such.
 */
export function dialled(guess, answer, spec) {
  const ratioed = spec.unit === 'oct' || spec.unit === 'x';
  const off = ratioed ? Math.log2(guess / answer) : guess - answer;
  const away = Math.abs(off);

  const mark = away <= spec.hit ? HIT : away <= spec.near ? NEAR : MISS;
  const amount = spec.unit === 'oct' ? `${away.toFixed(1)} oct`
    : spec.unit === 'x' ? `${(2 ** away).toFixed(1)}×`
    : `${away.toFixed(spec.decimals ?? 0)} ${spec.unit}`;

  return {
    state: mark,
    text: mark === HIT ? 'spot on' : `${amount} ${off < 0 ? spec.below : spec.above}`,
  };
}

/** A value on a log scale, from a seeded number in 0..1. */
export const logPick = (rng, low, high) => low * (high / low) ** rng();

/** Rounded to a step, so an answer is a number a person could have dialled. */
export const toStep = (value, step) => Number((Math.round(value / step) * step).toFixed(6));

/** Frequencies land on the third-octave grid an engineer actually works on. */
export function toThirdOctave(hz) {
  const steps = Math.round(Math.log2(hz / 1000) * 3);
  return 1000 * 2 ** (steps / 3);
}
