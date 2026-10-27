// Marking a mix.
//
// On the master, not on the faders - which is the same rule the six tools
// are marked by and matters more here than anywhere else. There are many
// ways to arrive at one balance, and a mix exercise that compared your fader
// positions with the answer's would be marking you on a route rather than on
// a destination.
//
// Five readings of each master, compared with the ones the rest of the app
// already uses, and a tolerance per tier. The tolerances are measured, not
// guessed. Rendering the same four bars with one stem's level moved by a
// known amount, against a mixed answer, reads:
//
//   out by      loudness  crest  balance  width  placement
//   1 dB            0.46   0.48     0.75   0.81       0.35
//   2 dB            0.94   1.02     1.48   1.95       0.73
//   3 dB            1.48   1.61     2.21   1.63       0.07
//
// and with one stem's pan moved instead:
//
//   0.10            0.00   0.00     0.12   2.29       0.42
//   0.20            0.00   0.01     0.20   5.06       0.87
//   0.35            0.00   0.01     0.25   6.47       1.57
//   mirrored        0.00   0.02     0.00   0.61       3.24
//
// Two readings of the same unchanged mix are identical to the last decimal
// on all five, so the floor is a real zero and a tolerance means what it
// says. (It was not, until the kit's noise was seeded: see `makeKit`.)
//
// The tiers are set so that a single stem being out by about two decibels
// still passes the easy one, about one decibel passes the middle one, and
// the hard one wants half of that.

import { HIT, NEAR, MISS } from '../learn/work/scoring.js';
import { distance } from '../gap.js';
import { MARKED } from './render.js';

/** What each reading is called where somebody has to read it. */
export const READING_NAMES = {
  loudness: { label: 'How loud', unit: 'LU' },
  balance: { label: 'The tonal balance', unit: 'dB' },
  placement: { label: 'Where things sit', unit: 'dB' },
  width: { label: 'How wide', unit: 'dB' },
  crest: { label: 'How dynamic', unit: 'dB' },
};

/** Inside this, on every reading, and the mix is the mix. */
export const MIX_TOLERANCE = {
  easy: { loudness: 1.2, balance: 1.8, placement: 1.0, width: 5.5, crest: 1.4 },
  medium: { loudness: 0.7, balance: 1.0, placement: 0.6, width: 2.8, crest: 0.8 },
  hard: { loudness: 0.35, balance: 0.55, placement: 0.3, width: 1.4, crest: 0.45 },
  // Tone is marked on `balance` and on nothing else, because nothing else is
  // being asked for: the levels, the placement and the room are given right.
  // So balance is tight and the other four sit where the easy tier has them,
  // which is loose enough not to fail somebody for a control they were not
  // asked to touch and tight enough to catch one they broke.
  //
  // 0.5 is a measurement, not a taste. The faintest pair a tone round can
  // ask for is late-room's keys at the mid, which reads 0.36 at two decibels
  // and 0.57 at three; the floor on a tone move is three, so the tolerance
  // has to sit between those two or a round at the floor arrives solved. See
  // TONE_BANDS in brief.js for the whole table.
  tone: { loudness: 1.2, balance: 0.5, placement: 1.0, width: 5.5, crest: 1.4 },
};

/** Close is twice the tolerance, as everywhere else in this app. */
export const NEAR_AT = 2;

export const toleranceFor = (tier) => MIX_TOLERANCE[tier] ?? MIX_TOLERANCE.easy;

/** One reading, marked. */
export function markReading(kind, mine, theirs, tolerance) {
  const gap = distance(mine, theirs);
  const allowed = tolerance[kind];

  return {
    kind,
    ...READING_NAMES[kind],
    off: gap.off,
    where: gap.where,
    detail: gap.detail,
    allowed,
    mark: gap.off <= allowed ? HIT : (gap.off <= allowed * NEAR_AT ? NEAR : MISS),
  };
}

/**
 * A whole mix, marked.
 *
 * Solved means every reading is inside its tolerance. Not an average: a mix
 * that is perfect on four readings and a mile out on the fifth is a mix with
 * something badly wrong in it, and averaging would call it nearly right.
 */
export function markMix(mine, theirs, tier) {
  const tolerance = toleranceFor(tier);
  const readings = MARKED.map((kind) => markReading(kind, mine[kind], theirs[kind], tolerance));

  return {
    readings,
    solved: readings.every((reading) => reading.mark === HIT),
    worst: readings.reduce((a, b) => (b.off / b.allowed > a.off / a.allowed ? b : a)),
  };
}

/**
 * What to say about a mark, without saying what the answer is.
 *
 * Each reading knows which way it is out and, for three of the five, where -
 * so the line can be an instruction rather than a score. "The 400 is further
 * left than it should be" is a thing to go and do; "placement: 2.4 dB" is
 * not.
 */
export function mixAdvice(marked) {
  const { worst } = marked;
  if (marked.solved) return 'That is the mix.';

  const where = worst.where ? ` around ${worst.where}` : '';

  switch (worst.kind) {
    case 'loudness':
      return `The whole thing is ${worst.detail?.louder > 0 ? 'louder' : 'quieter'} than the mix you are after.`;
    case 'balance':
      return `There is too ${worst.detail?.hotter > 0 ? 'much' : 'little'}${where} — `
        + 'something in that register is at the wrong level.';
    case 'placement':
      return `Something${where} is further ${worst.detail?.side ?? 'over'} than it should be.`;
    case 'width':
      return `The image is ${worst.detail?.wider > 0 ? 'wider' : 'narrower'} than it should be${where}.`;
    case 'crest':
      return 'The peaks sit differently against the body of it — usually a level, not a pan.';
    default:
      return 'Keep going.';
  }
}

/**
 * How close the whole thing is, as one number between 0 and 1.
 *
 * For a progress bar and nothing else. Every reading as a fraction of its own
 * tolerance, the worst one taken, and inverted - so 1 is the answer and 0 is
 * four times out. Never used to decide anything: `solved` does that.
 */
export function howClose(marked) {
  const worst = Math.max(...marked.readings.map((reading) => reading.off / reading.allowed));
  return Math.max(0, Math.min(1, 1 - (worst - 1) / 3));
}

export { HIT, NEAR, MISS };
