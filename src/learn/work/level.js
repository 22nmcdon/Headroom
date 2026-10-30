// What you do with a trim, and how it is marked.
//
// This is the opening of every mixing curriculum surveyed and the last thing
// this app got, which is backwards and worth saying plainly. Izhaki puts
// Faders before EQ; Senior's Part III opens with "Building the Raw Balance";
// Berklee's Art of Mixing begins with "Level and Loudness". The reason it is
// first is not that it is easy - it is that every other comparison in mixing
// is contaminated by it. Louder sounds better, so an A/B between two EQ
// settings at different levels is an A/B about level, and anyone who cannot
// hear a decibel cannot take the level out of the question.
//
// Two exercises, and a deliberate omission. Naming a level difference is the
// drill; putting one back is the work. Gain staging - trims set so each
// nonlinear stage sees the level it was designed for - is the third thing the
// curriculum asks for and it is not here, because it needs a chain rather
// than a plugin: a saturator whose drive is level-dependent followed by a
// compressor whose threshold is, with a trim in front of each. That is the
// sketchpad's shape, not a face's, and it belongs with the mix-craft modules.

import { LEVEL_DEFAULTS, TRIM_RANGE, levelReading } from '../../plugins/level/gain.js';
import { HIT, NEAR, MISS, onScale, toStep, pick } from './scoring.js';
import { mulberry32 } from '../../lib/random.js';

/**
 * How far a matched level may be out, in LU.
 *
 * The trim moves in tenths and a gain is exact - integrated loudness moves by
 * exactly the trim, measured to four decimal places - so the floor here is
 * 0.05 LU of rounding and nothing else. That means these numbers are entirely
 * a judgement about what is worth hearing rather than about what the
 * arithmetic can resolve, which is unusual in this app and worth flagging.
 *
 * They are set from the published difference limen for level, which is about
 * 1 dB on music and falls to 0.25-0.4 dB for loud mid-frequency tones. So the
 * easy tier is comfortably above a trained listener's threshold, the medium
 * one is about at it, and the hard one is below it - which is the point of a
 * hard tier, and is reachable because the A/B is instant and gapless.
 */
const MATCHED = { easy: 1.5, medium: 0.8, hard: 0.4 };

/**
 * The amounts the drill offers, as a ladder.
 *
 * Doubling, so every step is the same ratio and no two chips are closer
 * together than the one below them - which matters because a chip one place
 * out is scored as near rather than wrong, and that only means something if
 * the places are evenly spaced in the thing being judged.
 *
 * Nothing under half a decibel at any tier. The literature puts the limen at
 * about 1 dB on music, so a quarter-decibel chip would be asking for
 * something nobody can reliably do and marking them wrong for it.
 */
const LOUDER_BY = {
  easy: [2, 4, 8],
  medium: [1, 2, 4, 8],
  hard: [0.5, 1, 2, 4, 8],
};

/** And how far out still counts as close, in chips. */
const NEAR_CHIPS = 1;

/**
 * A trim, written the way the face writes one.
 *
 * One writer, because the sign and the number have to come off the same
 * value. Spelled out twice it was not: one of the two took the sign from the
 * trim that undoes a fault and the number from the fault itself, which
 * printed "+-1.0 dB".
 */
const writeTrim = (db) => `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`;

/**
 * A stand-in for the loop, for the times the real thing is not to hand.
 *
 * Scoring is a pure function a test can call without an audio context, as it
 * is for every other mode here. Built with a slow swell in it so the
 * integrated reading has blocks of different levels to gate and average
 * rather than one steady tone, which is the case where gating does nothing
 * and a bug in it would not show.
 */
function levelProbe(rate, seconds = 4) {
  const length = Math.round(rate * seconds);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  const noise = mulberry32(0x1e7e1);

  let lp = 0;
  for (let i = 0; i < length; i += 1) {
    const at = i / rate;
    lp += ((noise() * 2 - 1) - lp) * 0.2;
    const swell = 0.6 + 0.4 * Math.sin(2 * Math.PI * 0.3 * at);
    const voice = Math.sin(2 * Math.PI * 110 * at) * 0.4
      + Math.sin(2 * Math.PI * 440 * at) * 0.3
      + Math.sin(2 * Math.PI * 2200 * at) * 0.2;
    left[i] = (voice + lp * 0.6) * swell * 0.22;
    right[i] = (voice + lp * 0.5) * swell * 0.22;
  }
  return { left, right, rate };
}

const levelMaterial = (puzzle) => puzzle?.material ?? levelProbe(48000);

/** The loop as it was handed over, which is what everything here is read against. */
function faultedMaterial(puzzle) {
  const material = levelMaterial(puzzle);
  const fault = puzzle?.fault ?? { trim: 0 };
  const g = 10 ** ((fault.trim ?? 0) / 20);
  return {
    left: Float32Array.from(material.left, (v) => v * g),
    right: Float32Array.from(material.right, (v) => v * g),
    rate: material.rate,
  };
}

export const LEVEL_EXERCISES = {
  match: {
    id: 'match',
    label: 'Match the level',
    source: 'mix',
    // The loop before somebody changed its level, which is both the thing to
    // get back to and the thing you are flipping against.
    other: 'Untreated',
    faultOf: (puzzle) => puzzle.fault ?? { trim: 0 },
    targetOf: (puzzle) => ({ ...LEVEL_DEFAULTS, trim: -(puzzle.fault?.trim ?? 0) }),
  },
  drill: {
    id: 'drill',
    label: 'How much louder?',
    drill: true,
    ask: 'How much louder is this than the untreated loop?',
    lede: 'Nothing to dial here. One loop at two levels: say how far apart '
        + 'they are.',
    opening: 'Flip between the two, then say how much louder the treated one is.',
    tierBlurbs: {
      easy: 'Two, four or eight decibels apart',
      medium: 'Down to one decibel',
      hard: 'Down to half a decibel',
    },
    source: 'mix',
    other: 'Untreated',
    faultOf: (puzzle) => puzzle.fault ?? { trim: 0 },
    targetOf: () => ({ ...LEVEL_DEFAULTS }),
  },
};

/** Naming a difference, which is marked on the chip and not on the audio. */
function scoreLouder(state, puzzle) {
  const { answer, tier } = puzzle;
  const offered = LOUDER_BY[tier] ?? LOUDER_BY.medium;

  const at = offered.indexOf(state.louder);
  const wanted = offered.indexOf(answer.louder);
  const mark = onScale(at, wanted, { near: NEAR_CHIPS });

  const steps = at - wanted;
  const away = Math.abs(steps);

  return {
    correct: mark === HIT,
    cells: [
      { state: mark, text: `${state.louder} dB` },
      {
        state: mark,
        text: away === 0 ? 'that is the gap'
          : `${away} step${away === 1 ? '' : 's'} too ${steps > 0 ? 'big' : 'small'}`,
        narrow: true,
      },
    ],
    why: [
      {
        label: 'How far apart',
        value: `${answer.louder} dB`,
        how: 'Applied to the loop as a plain gain, so the difference is exactly '
           + 'that: a trim moves integrated loudness by exactly the trim, which '
           + 'is measured rather than assumed.',
      },
      {
        label: 'What a decibel is worth',
        value: away === 0 ? 'you had it' : `${away} chip${away === 1 ? '' : 's'} out`,
        how: 'The published difference limen for level is about one decibel on '
           + 'music, falling to a quarter of that for loud tones in the middle '
           + 'of the range. The chips double at every step so that being one '
           + 'out is always the same ratio, and nothing under half a decibel '
           + 'is ever asked for.',
      },
    ],
  };
}

export const LEVEL_WORK = {
  settings: [
    {
      id: 'exercise',
      label: 'Exercise',
      options: Object.values(LEVEL_EXERCISES).map(({ id, label }) => ({ id, label })),
    },
  ],

  exercises: LEVEL_EXERCISES,

  tiers: {
    easy: { label: 'Easy', blurb: 'Two decibels and up', guesses: 3 },
    medium: { label: 'Medium', blurb: 'Down to one decibel', guesses: 4 },
    hard: { label: 'Hard', blurb: 'Down to half a decibel', guesses: 4 },
  },

  /** Answered on the plugin, except in the drill, which asks with chips. */
  slots(tier, settings) {
    if (settings?.exercise !== 'drill') return [];

    const offered = LOUDER_BY[tier] ?? LOUDER_BY.medium;
    return [{
      id: 'louder',
      kind: 'choice',
      label: 'How much louder',
      options: offered.map((db) => ({ id: db, label: `${db} dB`, symbol: `${db} dB` })),
    }];
  },

  makePuzzle(rng, tier, settings) {
    if (settings.exercise === 'drill') {
      const offered = LOUDER_BY[tier] ?? LOUDER_BY.medium;
      const louder = pick(rng, offered);
      return { fault: { trim: louder }, answer: { louder } };
    }

    // Either way off the loop, so that leaving the trim alone is never the
    // answer, and a whole number of tenths so a perfect answer exists on a
    // knob that moves in tenths. Away from zero by at least a decibel at
    // every tier, because a fault inside the tolerance arrives solved.
    const up = rng() < 0.5;
    const size = toStep(1 + rng() * 5, 0.1);
    return { fault: { trim: up ? size : -size }, answer: { trim: up ? -size : size } };
  },

  score(guess, puzzle) {
    const { answer, tier } = puzzle;
    const exercise = puzzle.settings?.exercise ?? 'match';

    if (exercise === 'drill') return scoreLouder(guess, puzzle);

    const settings = { ...LEVEL_DEFAULTS, ...guess };
    const material = faultedMaterial(puzzle);
    const clean = levelMaterial(puzzle);

    // Two readings of the same length over the same loop, one of it as it
    // arrived and one of it untouched. A formula would have done - the fault
    // and the trim are both plain gains, so the error is arithmetic - but the
    // imager learned that lesson the other way round: reading one side off
    // the audio and working the other out on paper leaves a residual that
    // moves with the material. Both sides measured, so neither can drift.
    const mine = levelReading(material.left, material.right, material.rate, settings);
    const theirs = levelReading(clean.left, clean.right, clean.rate, { trim: 0 });

    return this.scoreMatch(mine, theirs, answer, tier);
  },

  /** Is it back where it was? */
  scoreMatch(mine, theirs, answer, tier) {
    const got = mine.values.integrated;
    const wanted = theirs.values.integrated;
    const off = Math.abs(got - wanted);

    const close = MATCHED[tier];
    const mark = off <= close ? HIT : off <= close * 2.5 ? NEAR : MISS;

    return {
      correct: off <= close,
      error: off,
      cells: [
        { state: mark, text: `${off.toFixed(2)} LU` },
        {
          state: mark,
          text: off <= close ? 'that is the same level'
            : `${off.toFixed(1)} LU too ${got > wanted ? 'loud' : 'quiet'}`,
          narrow: true,
        },
      ],
      why: [
        {
          label: 'Yours',
          value: `${got.toFixed(2)} LUFS`,
          how: 'Integrated loudness to ITU-R BS.1770, which is the same reading '
             + 'the analysis page takes and the same one every delivery spec in '
             + 'the world is written in - K-weighted, in 400 ms blocks, with the '
             + 'quiet ones gated out.',
        },
        {
          label: 'The loop',
          value: `${wanted.toFixed(2)} LUFS`,
          how: 'The same measurement over the same four seconds of the same '
             + 'loop, before the level was changed.',
        },
        {
          label: 'What was done to it',
          // The sign comes off the number being printed, not off the one it
          // was derived from. Taken off `answer.trim` - which is the trim that
          // UNDOES the fault, so the opposite sign - this printed "+-1.0 dB"
          // for half the rounds.
          value: writeTrim(-answer.trim),
          how: 'So the trim that undoes it is the opposite of that. A gain is '
             + 'exact: integrated loudness moves by exactly the trim, measured '
             + 'to four decimal places, until a trim deep enough to push blocks '
             + 'under the -70 LUFS gate - which is far below anything here.',
        },
        {
          label: 'Allowed',
          value: `${close.toFixed(1)} LU`,
          how: 'Set from the published difference limen for level, about one '
             + 'decibel on music, rather than from what the measurement can '
             + 'resolve - which is 0.05 LU and would make an unfair tier.',
        },
      ],
    };
  },

  /**
   * What to say when somebody is stuck, in the order it gets more specific.
   *
   * The first one is the technique rather than the answer, because for this
   * tool the technique is most of it: short flips, and the ear fooled by
   * level is the one that held a level in its head.
   *
   * Every rung is a sentence rather than a figure. The last one gives the
   * answer away, which is what a last rung is for, but "It is 4 dB." was
   * eleven characters and `tests/game.test.js` refuses a rung under twenty -
   * rightly, because a hint that is only a number teaches nothing on the way
   * past.
   */
  hints(puzzle) {
    const exercise = puzzle?.settings?.exercise ?? 'match';
    const { answer } = puzzle;

    if (exercise === 'drill') {
      const db = answer.louder;
      return [
        'Flip fast and often. A level is a comparison, and holding one of them '
          + 'in your head for a second or two turns it into a comparison with a '
          + 'memory.',
        db >= 4
          ? 'It is a big one - the sort of difference you would not argue about.'
          : db >= 1
            ? 'It is middling: clearly there, but you would have to point at it.'
            : 'It is small - around the edge of what anybody can reliably hear.',
        `It is ${db} dB - ${db >= 4 ? 'the far end of what this tier offers'
          : db >= 1 ? 'the middle of what this tier offers'
          : 'the smallest step this tier offers'}.`,
      ];
    }

    const size = Math.abs(answer.trim ?? 0);
    return [
      'Flip between yours and the untreated loop in short bursts rather than '
        + 'listening to either of them for long.',
      `It arrived ${(answer.trim ?? 0) > 0 ? 'quieter' : 'louder'} than it should `
        + 'be, so the trim goes the other way.',
      `It is about ${size.toFixed(1)} dB out, so that is the trim to dial in `
        + `the ${(answer.trim ?? 0) > 0 ? 'positive' : 'negative'} direction.`,
    ];
  },

  /** What the answer was, for the board to print when the round ends. */
  reveal(puzzle) {
    const exercise = puzzle?.settings?.exercise ?? 'match';
    const { answer } = puzzle;

    if (exercise === 'drill') {
      return {
        symbol: `${answer.louder} dB`,
        name: 'louder than the untreated loop',
      };
    }

    return {
      symbol: writeTrim(answer.trim ?? 0),
      name: 'of trim to put it back where it was',
    };
  },

  /**
   * What a guess says it heard, in `weak`'s own words.
   *
   * Only the drill has one, because only the drill has an answer that is a
   * name rather than a number: the stats page counts how often "2 dB apart"
   * was called something else, which needs the guess under the same key the
   * answer is filed under.
   */
  heard(guess, puzzle) {
    if ((puzzle?.settings?.exercise ?? 'match') !== 'drill') return null;
    if (guess?.louder === undefined) return null;
    return { key: `louder-${guess.louder}`, label: `${guess.louder} dB apart` };
  },

  /** What a miss here says you need more of. */
  weak(puzzle) {
    const exercise = puzzle?.settings?.exercise ?? 'match';
    const { answer } = puzzle;
    if (exercise === 'drill') {
      return { key: `louder-${answer.louder}`, label: `${answer.louder} dB apart` };
    }
    return { key: 'level-match', label: 'matching a level' };
  },

  /** What the trim is, said the way the readout says it. */
  trimOf: writeTrim,

  /** The range, so a caller can tell whether a fault is reachable. */
  reach: TRIM_RANGE,
};
