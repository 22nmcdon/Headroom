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
// Re-checked when the image reading grew a seventh band at the top, because
// placement is read in the imager's bands and a new one could have put noise
// under the tightest tolerance here. It did not: the unchanged mix still
// reads 0.00 on all five, and a pan move of 0.10, 0.20 and 0.35 still reads
// 0.45, 0.89 and 1.52 on placement against the 0.42, 0.87 and 1.57 above.
//
// The tiers are set so that a single stem being out by about two decibels
// still passes the easy one, about one decibel passes the middle one, and
// the hard one wants half of that.

import { HIT, NEAR, MISS } from '../learn/work/scoring.js';
import { distance } from '../gap.js';
import { MARKED } from './render.js';
import { partsOut } from './levels.js';
import { sharesOut, REGISTERS } from './share.js';

/** What each reading is called where somebody has to read it. */
export const READING_NAMES = {
  loudness: { label: 'How loud', unit: 'LU' },
  balance: { label: 'The tonal balance', unit: 'dB' },
  placement: { label: 'Where things sit', unit: 'dB' },
  width: { label: 'How wide', unit: 'dB' },
  crest: { label: 'How dynamic', unit: 'dB' },
  levels: { label: 'The parts against each other', unit: 'dB' },
  share: { label: 'Who owns which register', unit: 'dB' },
  room: { label: 'How far back things are', unit: 'dB' },
};

/** Inside this, on every reading, and the mix is the mix. */
export const MIX_TOLERANCE = {
  easy: { loudness: 1.2, balance: 1.8, placement: 1.0, width: 5.5, crest: 1.4, levels: 0.8 },
  medium: { loudness: 0.7, balance: 1.0, placement: 0.6, width: 2.8, crest: 0.8, levels: 0.5 },
  hard: { loudness: 0.35, balance: 0.55, placement: 0.3, width: 1.4, crest: 0.45, levels: 0.4 },
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
  tone: { loudness: 1.2, balance: 0.5, placement: 1.0, width: 5.5, crest: 1.4, levels: 2.5 },
  // Making room is marked on `share` and has no `levels` entry at all, which
  // is a thing a tier can now say: a reading a tier has no tolerance for is
  // not reported. The tone tier's 2.5 was a tolerance written loose enough
  // never to fire, and a reading that never fires is a row in the result
  // nobody can learn anything from.
  //
  // 0.4 is measured. The `share` reading moves 0.48 dB for every decibel of
  // the bass's low shelf and 0.19 for every decibel of the pad's bell, so the
  // allowance is about four fifths of a decibel on the first carve and two on
  // the second - and the flat mix a round opens on reads 1.66 to 2.48 from
  // the answer, which is four to six times out.
  //
  // The other five sit where the easy tier has them, and `balance` in
  // particular is deliberately looser than `share`: a decibel of carve error
  // moves the master's balance by about 0.6, so a tighter one would fail the
  // same miss twice and point at a frequency rather than at a part.
  carve: { loudness: 1.2, balance: 1.8, placement: 1.0, width: 5.5, crest: 1.4, share: 0.4 },
  // Front to back is marked on the room, on the parts, and on the air.
  //
  // `room` is the one doing the work, and 2.0 is measured. A send is a plain
  // gain, so a step of it is worth more at the quiet end: from 0.20 to 0.25
  // the return comes up 1.94 dB, where from 0.45 to 0.50 it comes up 0.92. So
  // the tolerance has to forgive the larger of those, and it still refuses a
  // part at the wrong distance - 0.20 against 0.45 is 6.94 dB - by a factor of
  // three and a half.
  //
  // `share` does two jobs here and `levels` is left out, because measured
  // they are the same number. A fader moves a part broadband, which shifts
  // all three of its registers by the same amount, so the two read 0.38 and
  // 0.38 for a step and 2.25 and 2.25 for a part at the wrong distance -
  // one mistake, reported twice. `share` is the one kept because it also
  // sees the air, which `levels` cannot.
  //
  // 0.6 is what that costs, and it is measured from both ends. Forgiven: a
  // step of fader at 0.38, and three decibels of air at 0.09. Failed: the air
  // left flat at 0.72, and a part at the wrong distance at 2.25. The margin
  // is deliberately wider on the first pair than the second - a learner who
  // slips a step should never be failed for it, where one who ignores a
  // control only has to be caught.
  //
  // The air is the weakest of the three cues and nothing about this material
  // makes it otherwise: only two parts have a top end to lose and one of them
  // is the reference. See DEPTHS in brief.js for what that cost.
  depth: {
    loudness: 1.2, balance: 1.8, placement: 1.0, width: 5.5, crest: 1.4,
    share: 0.6, room: 2.0,
  },
};

/**
 * What the levels tolerances are, and what the number they are in means.
 *
 * `levels` reads each part against the mean of the parts, so the overall
 * level is taken out and what is left is the shape of the balance. That makes
 * it blind to a gain on every fader at once, which is the point - measured,
 * moving all four by a step reads 0.000 exactly, and the loudness reading
 * next door is what catches that.
 *
 * It also makes the number NOT a fader position, and the first version of
 * this got that wrong. It claimed a reading of X meant 4X/3 of fader, on the
 * strength of a measurement taken with exactly one fader nudged - where that
 * does hold, because a quarter of a single move goes into the mean. With two
 * faders out it is false, and the advice built on it said "the keys are 2.3 dB
 * too hot" about a fader that had not been touched at all. Removing the mean
 * is lossy on purpose: any set of moves and that set plus a constant read the
 * same, so no reading of it can name an absolute fader error.
 *
 * So the tolerances are in shape-decibels and are anchored on what the
 * controls can actually express. Measured, against an answer, on a medium
 * round:
 *
 *     one fader out by one step (0.5 dB)      0.375
 *     one fader out by two steps              0.750
 *     one fader out by four steps (2 dB)      1.500
 *     two faders out by a step, same way      0.250
 *     two faders out by a step, opposite      0.500
 *     all four out by a step                  0.000
 *
 * Which puts 0.8 at "one fader two steps off is forgiven and three is not",
 * 0.5 at "one step off, or two faders a step apart, and no more", and 0.4 at
 * "one step and nothing else". A flat mix reads 1.50 to 2.87 from the answer
 * depending on tier and seed, so no round arrives solved.
 *
 * The tone tier is loose at 2.5 and will therefore never fire, which is
 * deliberate and is not the "a control they were not asked to touch" case
 * above - it is the opposite. A tone round gives the levels right and asks
 * for EQ, and an EQ boost of three to eight decibels on one band changes that
 * stem's whole loudness: measured, a flat tone round reads 1.60 and 1.76 from
 * its answer on levels alone. Marking that would be marking the tone move
 * twice, once where it belongs and once here.
 */

/**
 * What each part is called in a sentence, with the verb that goes with it.
 *
 * Two of the four names are plural and two are not, so one sentence shape
 * cannot hold them: the first version said "the keys is 2.3 dB too hot",
 * which reads as a typo. The verb travels with the name rather than being
 * worked out from it, because that is two words either way and guessing at
 * English plurals from a four-item table is the harder of the two.
 */
const NAMED = {
  kit: { name: 'kit', is: 'is' },
  bass: { name: 'bass', is: 'is' },
  keys: { name: 'keys', is: 'are' },
  pad: { name: 'pad', is: 'is' },
};

/** What each register is called inside a sentence. */
const REGISTER_SAID = Object.fromEntries(REGISTERS.map((band) => [band.id, band.label]));

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
  const readings = MARKED
    // A tier is marked on the readings it has a tolerance for and no others.
    // Which is not a shortcut: `share` tells which part owns which register,
    // and on a round of faders and pans it says what `levels` says in other
    // words - two readings of one mistake, failed twice.
    .filter((kind) => tolerance[kind] !== undefined)
    .map((kind) => markReading(kind, mine[kind], theirs[kind], tolerance));

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
    case 'share': {
      // The one reading that can name a part AND a register, so it names
      // both. "There is too much around 120 Hz" is true of the sum and is not
      // an instruction; "there is too much bass below 310 Hz" is a control to
      // reach for.
      const out = sharesOut(worst, worst.allowed).slice(0, 2);
      if (!out.length) return 'One part is taking up more room than it should.';
      const say = ({ id, band, by }) => {
        const part = NAMED[id] ?? { name: id };
        // "Of the keys" rather than a bare name, because two of the four are
        // plural and "too little keys" reads as a typo - the same problem the
        // `is`/`are` in NAMED was written for, and the same answer.
        return `too ${by > 0 ? 'much' : 'little'} of the ${part.name} ${REGISTER_SAID[band]}`;
      };

      return `There is ${out.map(say).join(', and ')}.`;
    }
    case 'room': {
      // Two different things to say and the gap knows which it is: how much
      // room there is, or what is in it. The second is the one no other
      // reading can say at all - a room with the right amount of reverb and
      // the wrong parts in it is a mix where something is at the wrong
      // distance, and `width` can only report that the image moved.
      if (worst.where === 'how much room there is') {
        return `There is ${worst.detail?.wetter > 0 ? 'more' : 'less'} room than there should be.`;
      }
      return `The room is the wrong colour — too ${worst.detail?.colour > 0 ? 'much' : 'little'} `
        + `${worst.where} in it, so something is at the wrong distance.`;
    }
    case 'levels': {
      // The one reading that can name a fader, so it does. Two at a time at
      // most: a line that lists four parts is a line nobody reads, and the
      // worst one is the one to go and move first.
      const out = partsOut(worst, worst.allowed).slice(0, 2);
      if (!out.length) return 'One part is at the wrong level against the others.';
      // "Against the rest" rather than a bare "too hot", because that is
      // exactly what the number is: each part against the mean of the parts.
      // Saying it as an absolute fader error would be the mistake described
      // over LEVELS tolerances - the mean cannot be un-removed.
      const say = ({ id, by }) => {
        const part = NAMED[id] ?? { name: id, is: 'is' };
        return `the ${part.name} ${part.is} ${Math.abs(by).toFixed(1)} dB `
          + `too ${by > 0 ? 'hot' : 'low'}`;
      };
      return `Against the rest of the parts, ${out.map(say).join(', and ')}.`;
    }
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
