// Hearing two mixes at the same loudness, which is the only way to compare
// them.
//
// Louder sounds better. Not as a figure of speech - put the same mix up by a
// decibel and a half and people will tell you it has more punch, a better low
// end and a wider image, and they will tell you that about a difference they
// could not name if you asked them what had changed. So an A/B between two
// mixes at two levels is not a comparison of the mixes. It is a comparison of
// the levels, with the mixes along for the ride.
//
// Which is a real problem for this exercise rather than a general piety,
// because the answer and the mix being worked on are almost never at the same
// loudness. Measured, the answer against the flat mix a round opens on, at
// one seed per tier:
//
//     easy     -26.37 against -24.90      1.47 LU
//     medium   -25.78 against -28.08      2.30 LU
//     hard     -25.09 against -24.90      0.19 LU
//     tone     -25.31 against -24.90      0.41 LU
//
// Up to two and a third decibels, which is well over the threshold where the
// louder one starts to win on everything. `tests/browser/match.mjs` takes the
// same comparison on its own seeds and reads 1.40, 1.98 and 2.12, so it is
// the seed that decides how big the gap is and not the tier.
//
// So the monitor trims the reference to the level of the mix being worked on
// - the reference, because the mix being worked on is the thing whose level
// is being decided and moving it would be moving the work.
//
// The trim is on the monitor and nowhere near the marking. `readMix` renders
// the project, and the project does not know this file exists.

import { STEM_IDS } from './piece.js';
import { dbOf } from './brief.js';

/**
 * How far the monitor may trim, in decibels.
 *
 * A clamp rather than a control. Three faders over a range of -12 to +9 can
 * move a mix's loudness by about nine decibels in either direction, so twelve
 * is past anything a round can ask for and the only thing it can catch is an
 * arithmetic fault - a trim of forty decibels is not a close match, it is a
 * bug, and the sound of it would be the first anybody heard about it.
 */
export const MATCH_LIMIT = 12;

/** The loudness of several parts playing at once, from their own loudnesses. */
export const sumOf = (levels) => 10 * Math.log10(
  levels.reduce((total, lufs) => total + 10 ** (lufs / 10), 0),
);

/**
 * What a mix's loudness is, without rendering it.
 *
 * An anchor - one mix that was rendered and read for real - plus the fader
 * moves since, applied to the parts' own loudnesses and added back up as
 * energy. Exact at the anchor by construction, and an approximation
 * everywhere else, because adding up four parts' energies is only the
 * loudness of their sum if the four are uncorrelated and they are four parts
 * of one piece of music.
 *
 * It is an approximation on purpose. The honest way to know a mix's loudness
 * is to render it, and a render is 886 ms of main thread with the music
 * playing through it - so a monitor that re-rendered on every fader move
 * would stutter the thing it is there to let you hear. Measured, in decibels
 * off a real render, over easy, medium and hard - the table
 * `tests/browser/match.mjs` prints every run:
 *
 *     move                      anchored on the answer   anchored on flat
 *     one fader by 1 dB                      0.00, 0.00       0.01, 0.01
 *     two faders 3 dB apart            0.05, 0.09, 0.12       0.13, 0.13
 *     all three by 4 dB                     -0.25, -0.25     -0.16, -0.16
 *
 * A single fader is exact to a hundredth; it is only moving everything at
 * once that drifts, and then by a quarter of a decibel against the one to two
 * it is there to take out. Pushed past what a round asks for - all three
 * faders eight decibels down, anchored on flat - the same measurement reads
 * 0.72, which is where the 0.8 the check allows comes from.
 *
 * Every submit renders for real and re-anchors, so the estimate is at its
 * best where it matters: once somebody is close enough to be submitting, the
 * anchor is close enough to be nearly exact.
 */
export function mixLoudness(anchor, mix) {
  if (!anchor) return null;

  const ids = STEM_IDS.filter((id) => Number.isFinite(anchor.parts?.[id]));
  if (!ids.length) return anchor.master;

  const was = ids.map((id) => anchor.parts[id]);
  const now = ids.map((id) => anchor.parts[id]
    + (dbOf(mix[id]?.gain ?? 1) - dbOf(anchor.held[id]?.gain ?? 1)));

  return anchor.master + sumOf(now) - sumOf(was);
}

/**
 * What a part's colour is, as one number, for telling one anchor from another.
 *
 * Only the bands, because the levels are tracked and the colour is not. See
 * `staleFor`.
 */
const colourOf = (set) => ['low', 'mid', 'high']
  .map((band) => set?.settings?.eq?.[band] ?? 0).join(',');

/**
 * Whether an anchor still describes this mix, and if not, why not.
 *
 * Three of the four things a strip does are safe to move, and that is a
 * measurement rather than a convenience:
 *
 *   - a fader is tracked, by the arithmetic above;
 *   - a pan is equal power, so it moves energy between the two sides without
 *     changing how much there is. Measured, two parts panned to 0.7 moved the
 *     master's loudness by 0.03 dB;
 *   - a send is post-fader into a room eight decibels down, and measured, two
 *     sends up to 0.6 and 0.4 moved it by 0.19 dB at the most.
 *
 * A tone control is not safe, because it changes how loud its own part is and
 * the parts are what the arithmetic adds up. Measured on a tone round, the
 * master's loudness against the same round flat:
 *
 *     stem   band   move    master    that part
 *     bass   low      -8    -0.70      -4.41
 *     bass   low       8     1.08       3.26
 *     keys   mid      -8    -0.10      -0.64
 *     keys   mid       8     0.02       0.29
 *     pad    mid      -8    -0.44      -1.81
 *     pad    mid       8     0.55       1.75
 *
 * Up to a decibel on the master, which is the whole of what the match is
 * there to remove - so a colour move does not quietly carry on with an anchor
 * that predates it. It says so, and asks to be measured again.
 */
export function staleFor(anchor, mix) {
  if (!anchor) return 'nothing has been measured yet';
  for (const id of STEM_IDS) {
    if (colourOf(mix[id]) !== anchor.held[id]?.colour) {
      return 'the colour has moved since this was measured';
    }
  }
  return null;
}

/**
 * One mix, measured for real: what an estimate is anchored on.
 *
 * `held` is the two things about the mix this file reads - the fader, and the
 * colour as one string - rather than a copy of the mix. A copy would have to
 * be a deep one or it would share the insert settings with the desk, and a
 * desk goes on moving: an anchor that quietly followed the thing it is
 * anchoring against would describe whatever is current, which is to say
 * nothing. Two numbers a stem cannot be aliased by accident.
 */
export const anchorOf = (mix, readings) => ({
  held: Object.fromEntries(STEM_IDS.map((id) => [id, {
    gain: mix[id]?.gain ?? 1,
    colour: colourOf(mix[id]),
  }])),
  master: readings.loudness.values.integrated,
  parts: { ...readings.levels.values.parts },
});

/**
 * What to put on the reference so it plays at the level of the mix being
 * worked on.
 *
 * Nought when there is nothing to go on, which is the right answer rather
 * than a fallback: an unmeasured match is a match that has not happened, and
 * silently applying a guess would be worse than applying nothing.
 */
export function matchTrim(anchor, mix, reference) {
  if (!anchor || !Number.isFinite(reference)) return 0;
  const mine = mixLoudness(anchor, mix);
  if (!Number.isFinite(mine)) return 0;
  return Math.max(-MATCH_LIMIT, Math.min(MATCH_LIMIT, mine - reference));
}

/** A trim, as a gain. */
export const gainOfTrim = (db) => 10 ** (db / 20);
