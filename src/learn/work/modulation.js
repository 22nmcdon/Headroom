// What you do with a modulation, and how it is marked.
//
// Three exercises, and the split is the one the roadmap predicted: telling
// the six apart is the easy win and setting the depth is the hard one, so the
// first drill asks which of them is running, the second asks how fast in note
// values - the same question the delay's division drill asks, off the same
// list - and the match exercise is where the depth has to be got right.
//
// All three are marked on the oscillator's own path rather than on what it
// did to a loop, which is `trace.js`'s decision and has one consequence here
// worth saying out loud: no round asks for the feedback, because the path
// cannot see it. Measured, moving it from -0.9 to +0.9 moves the reading by
// exactly 0.00. What it is for is in the notes and on the face, where it can
// be heard.

import {
  MOD_DEFAULTS, MOD_KINDS, MOD_IDS, MOD_SPREADS, MOD_FAMILIES, modKind,
} from '../../plugins/modulation/dsp.js';
import { modReading } from '../../plugins/modulation/trace.js';
import { distance } from '../../gap.js';
import {
  HIT, NEAR, MISS, onScale, pick, toStep,
} from './scoring.js';
import { DIVISIONS, rateFor } from '../../lib/tempo.js';

/**
 * How close a matched modulation has to be, in per cent of full travel.
 *
 * Measured on a chorus at an eighth note and a depth of 0.4, which is the
 * middle of what the rounds ask for:
 *
 *     mistake                          reads
 *     nothing at all (no depth)         27.8
 *     the next note value along         38.5
 *     the depth 0.02 out                 1.4
 *     the depth 0.05 out                 3.5
 *     the depth 0.1 out                  7.0
 *     the depth 0.2 out                 13.9
 *     the sides a quarter turn out      27.7
 *     the shape, sine against triangle  36.4
 *     the feedback either way            0.00
 *
 * Two things follow from that table.
 *
 * The rate is enormously marked and the reason is that both paths start from
 * the top of the sweep: a rate half a per cent out has walked a fiftieth of a
 * cycle away by the end of four seconds, which reads 6.4. That is not a
 * tolerance anybody could hit by turning a knob, and it is the reason the
 * rounds ask for note values and the face has a sync menu - a division is
 * exact, so the rate is a menu choice and the ear's job is to hear which.
 * Free rates are still there for playing with; they are not asked for.
 *
 * And the depth is linear: a hundredth of the travel reads about 0.7, all the
 * way up. So the tiers are a depth tolerance and nothing else - 5.0, 3.0 and
 * 1.5 forgive about a tenth, a twentieth and a fortieth of the travel - and
 * two and a half times the loosest of them is 12.5, which keeps leaving the
 * depth at nought outside even the near band of the easy tier. The least an
 * unmodulated path reads from a target is 21.9, on an auto-pan.
 */
const MOD_CLOSE = { easy: 5.0, medium: 3.0, hard: 1.5 };

/**
 * Which effects each tier offers, and how far apart they have to be.
 *
 * Easy is three: a chorus, a tremolo and a phaser, which are wired to three
 * different places and so cannot be confused for each other by anybody who
 * knows the table. The other two offer all six, where the work is telling
 * chorus from flanger and from vibrato - three rows of one family, differing
 * in how long the line is and whether the dry signal is still there.
 */
const OFFERED = {
  easy: ['chorus', 'tremolo', 'phaser'],
  medium: MOD_IDS,
  hard: MOD_IDS,
};

/** And which note values the rate drill offers, from the delay's own list. */
const RATES = {
  easy: ['quarter', 'eighth', 'sixteenth'],
  medium: DIVISIONS.map((d) => d.id),
  hard: DIVISIONS.map((d) => d.id),
};

const RATE_NEAR = { easy: 1, medium: 1, hard: 0 };

/** The note values a matched modulation is set to, per tier. */
const SYNCS = {
  easy: ['quarter', 'eighth'],
  medium: ['quarter', 'dotted8', 'eighth', 'sixteenth'],
  hard: DIVISIONS.map((d) => d.id),
};

const noteOf = (id) => DIVISIONS.find((d) => d.id === id) ?? DIVISIONS[0];

/**
 * The settings behind one round of a drill.
 *
 * Depth is where it is for a reason per family. Four tenths of the travel is
 * an ordinary chorus and an ordinary phaser; a tremolo at four tenths is
 * polite and at eight is the thing people recognise as tremolo, so the level
 * family gets more. What must not vary is anything that would give the answer
 * away by being unusual - every round is a sine, in time, at a plain depth.
 */
function modDrillSettings(kind, rate) {
  const row = modKind(kind);
  return {
    ...MOD_DEFAULTS,
    kind,
    rate,
    sync: 'free',
    depth: row.family === 'level' ? 0.75 : 0.45,
    feedback: row.feeds ? 0.35 : 0,
    spread: row.knobs.includes('spread') ? 90 : MOD_DEFAULTS.spread,
    shape: 'sine',
  };
}

export const MOD_EXERCISES = {
  // No `faultOf` on any of the three, which is worth a line because every
  // other tool here has one: a fault is something wrong with the material
  // that the tool is for putting right, and a modulation is not that. The
  // loop arrives clean and what is being judged is what you did to it.
  match: {
    id: 'match',
    label: 'Match the modulation',
    source: 'instrument',
    other: 'Target',
    targetOf: (puzzle) => puzzle.answer,
    // The kind is given rather than guessed: the round is about the rate, the
    // depth and the sides. Which is also what makes it markable - two
    // different kinds are two different quantities, and a comparator handed
    // both would have to refuse.
    startOf: (puzzle) => ({
      ...MOD_DEFAULTS,
      kind: puzzle.answer.kind,
      rate: MOD_DEFAULTS.rate,
      depth: MOD_DEFAULTS.depth,
      spread: MOD_DEFAULTS.spread,
      shape: 'sine',
      feedback: puzzle.answer.feedback ?? 0,
    }),
  },

  drill: {
    id: 'drill',
    label: 'What is moving?',
    drill: true,
    ask: 'Which of these is running?',
    lede: 'Nothing to dial here. One of the six is on the loop at an ordinary '
        + 'setting, and the question is which - which is a question about '
        + 'where the oscillator is wired rather than about how it is set.',
    opening: 'Play it, flip to the untreated side, then say which one it is.',
    tierBlurbs: {
      easy: 'Three, wired to three different places',
      medium: 'All six, a step forgiven',
      hard: 'All six, exact',
    },
    source: 'instrument',
    other: 'Untreated',
    startOf: (puzzle) => modDrillSettings(puzzle.answer.kind, puzzle.rate),
    targetOf: () => ({ ...MOD_DEFAULTS, dry: true }),
    cleanOf: () => ({ ...MOD_DEFAULTS, dry: true }),
    restores: true,
  },

  rate: {
    id: 'rate',
    label: 'How fast is it?',
    drill: true,
    ask: 'What note value is this modulation on?',
    lede: 'The other half of reading a modulation, and the half you can count. '
        + 'Something is moving in time with the loop; say what note value it '
        + 'is moving on.',
    opening: 'Play it, count along with the loop, then name the note value.',
    tierBlurbs: {
      easy: 'Quarters, eighths and sixteenths',
      medium: 'Five values, a step forgiven',
      hard: 'Five values, exact',
    },
    source: 'drums',
    other: 'Untreated',
    startOf: (puzzle) => modDrillSettings(puzzle.kind, rateFor(noteOf(puzzle.answer.division).beats)),
    targetOf: () => ({ ...MOD_DEFAULTS, dry: true }),
    cleanOf: () => ({ ...MOD_DEFAULTS, dry: true }),
    restores: true,
  },
};

/** Naming which of the six it is, which is right or it is not. */
function scoreKind(state, puzzle) {
  const { answer } = puzzle;
  const mine = MOD_KINDS.find((k) => k.id === state.kind);
  const wanted = modKind(answer.kind);
  const right = state.kind === answer.kind;
  const sameFamily = mine && mine.family === wanted.family;

  return {
    correct: right,
    cells: [
      { state: right ? HIT : MISS, text: mine?.label ?? '—' },
      {
        state: right ? HIT : MISS,
        text: right ? 'that is the one'
          : sameFamily ? 'the right wire, the wrong length'
            : `it was ${wanted.label.toLowerCase()}`,
        narrow: true,
      },
    ],
    why: [
      {
        label: 'What was running',
        value: wanted.label,
        how: wanted.family === 'delay'
          ? `A read head moving between ${(wanted.centre - wanted.span).toFixed(1)} and `
            + `${(wanted.centre + wanted.span).toFixed(1)} ms, with the dry signal `
            + `${wanted.wet < 1 ? 'still there - so the two comb-filter each other' : 'gone - so there is nothing to comb with and what moves is the pitch'}.`
          : wanted.family === 'phase'
            ? 'Six all-passes with their corner swept, which is three notches moving '
              + 'through the signal. No comb: the notches are spread out rather than '
              + 'evenly spaced, which is what a phaser sounds like against a flanger.'
            : wanted.opposed
              ? 'A gain on each side, pulling opposite ways. Nothing about the tone '
                + 'changes at all - in mono it disappears entirely.'
              : 'A gain, moving. Nothing about the tone changes, only how much of it '
                + 'there is, which is what makes it the easiest of the six to name.',
      },
      {
        label: 'How to tell',
        value: 'ask where it is wired',
        how: 'A gain moving is tremolo or auto-pan - and auto-pan is the one that '
           + 'vanishes in mono. A pitch bending with no comb is vibrato. A comb '
           + 'sweeping is a chorus if it is too fine to have a pitch and a flanger '
           + 'if it is not. A filter sweeping with no metallic edge is the phaser, '
           + 'because its notches are spread out rather than evenly spaced.',
      },
    ],
  };
}

/** And naming the note value, which is marked on the chip. */
function scoreRate(state, puzzle) {
  const { answer, tier } = puzzle;
  const offered = RATES[tier] ?? RATES.medium;
  const at = offered.indexOf(state.division);
  const wanted = offered.indexOf(answer.division);
  const mark = onScale(at, wanted, { near: RATE_NEAR[tier] ?? 1 });
  const division = noteOf(answer.division);
  const steps = at - wanted;

  return {
    correct: mark === HIT,
    cells: [
      { state: mark, text: noteOf(state.division).label },
      {
        state: mark,
        text: steps === 0 ? 'that is the one'
          : `${Math.abs(steps)} step${Math.abs(steps) === 1 ? '' : 's'} too ${steps > 0 ? 'fast' : 'slow'}`,
        narrow: true,
      },
    ],
    why: [
      {
        label: 'The note value',
        value: division.label,
        how: `One cycle per note, which at this tempo is `
           + `${rateFor(division.beats).toFixed(2)} Hz. That is the convention every `
           + 'synced modulation uses and the only way anybody wants to be told a rate: '
           + 'nobody has ever asked for a tremolo at 3.2 hertz.',
      },
      {
        label: 'How to count it',
        value: 'against the loop, not in hertz',
        how: 'The same thing the delay\'s division drill asks, off the same list of '
           + 'five - every adjacent pair in it is at least a third apart, so telling '
           + 'one from the next is a question about the music rather than about a '
           + 'stopwatch. Count the beat and hear how many times it moves inside one.',
      },
    ],
  };
}

export const MOD_WORK = {
  tool: 'modulation',
  opening: 'Play the loop, set the modulation, then lock it in.',

  settings: [
    {
      id: 'exercise',
      label: 'Exercise',
      options: Object.values(MOD_EXERCISES).map(({ id, label }) => ({ id, label })),
    },
  ],

  exercises: MOD_EXERCISES,

  tiers: {
    easy: { label: 'Easy', blurb: 'Three effects, a tenth of the travel', guesses: 3 },
    medium: { label: 'Medium', blurb: 'All six, a twentieth', guesses: 4 },
    hard: { label: 'Hard', blurb: 'All six, a fortieth', guesses: 4 },
  },

  /** Answered on the tool, except in the drills, which ask with chips. */
  slots(tier, settings) {
    const exercise = settings?.exercise ?? 'match';

    if (exercise === 'drill') {
      const offered = OFFERED[tier] ?? OFFERED.medium;
      return [{
        id: 'kind',
        kind: 'choice',
        label: 'Which one',
        options: offered.map((id) => {
          const row = modKind(id);
          return { id, label: row.label, symbol: row.label };
        }),
      }];
    }

    if (exercise === 'rate') {
      const offered = RATES[tier] ?? RATES.medium;
      return [{
        id: 'division',
        kind: 'choice',
        label: 'Note value',
        options: offered.map((id) => {
          const division = noteOf(id);
          return { id, label: division.label, symbol: division.label };
        }),
      }];
    }

    return [];
  },

  makePuzzle(rng, tier, settings) {
    const exercise = settings.exercise ?? 'match';

    if (exercise === 'drill') {
      const offered = OFFERED[tier] ?? OFFERED.medium;
      const kind = pick(rng, offered);
      // In time, at a plain note value, so that nothing about the rate tells
      // you which effect it is.
      const division = pick(rng, ['quarter', 'eighth']);
      return {
        answer: { kind },
        rate: rateFor(noteOf(division).beats),
      };
    }

    if (exercise === 'rate') {
      const offered = RATES[tier] ?? RATES.medium;
      // Easy asks on a tremolo, which is the one whose rate is impossible to
      // miss: the level is the rate. The other tiers ask on anything, where
      // a slow chorus makes the same question much harder.
      const kind = tier === 'easy' ? 'tremolo' : pick(rng, MOD_IDS);
      return { answer: { division: pick(rng, offered) }, kind };
    }

    const offered = OFFERED[tier] ?? OFFERED.medium;
    const kind = pick(rng, offered);
    const row = modKind(kind);
    const sync = pick(rng, SYNCS[tier] ?? SYNCS.medium);
    // On the knob's own hundredths, so the answer is reachable, and never at
    // either end: a depth of nought is no modulation and a depth of one is
    // the top of the control, and both are answers somebody can find without
    // listening.
    const depth = toStep(0.2 + rng() * 0.6, 0.05);
    const spread = row.knobs.includes('spread') && tier !== 'easy'
      ? pick(rng, MOD_SPREADS.map((s) => s.id))
      : MOD_DEFAULTS.spread;

    return {
      answer: {
        ...MOD_DEFAULTS,
        kind,
        sync,
        rate: rateFor(noteOf(sync).beats),
        depth,
        spread,
        shape: 'sine',
        // Set where the drills set it and never asked for: the path cannot
        // see the feedback, so a round that varied it would be a round whose
        // answer nobody could be marked on.
        feedback: row.feeds ? 0.35 : 0,
      },
    };
  },

  score(guess, puzzle) {
    const exercise = puzzle.settings?.exercise ?? 'match';
    if (exercise === 'drill') return scoreKind(guess, puzzle);
    if (exercise === 'rate') return scoreRate(guess, puzzle);

    const { answer, tier } = puzzle;
    const close = MOD_CLOSE[tier];

    // A different effect is not a near miss at anything: it is a different
    // quantity, measured in a different unit, on an axis the comparator would
    // refuse. Said rather than thrown.
    if (guess.kind !== answer.kind) {
      const mine = modKind(guess.kind);
      return {
        correct: false,
        error: Infinity,
        cells: [
          { state: MISS, text: mine.label },
          { state: MISS, text: `it is ${modKind(answer.kind).label.toLowerCase()}`, narrow: true },
        ],
        why: [{
          label: 'A different effect',
          value: `${mine.label}, not ${modKind(answer.kind).label}`,
          how: 'The round sets the effect and asks for the setting. Which is not a '
             + 'tolerance being strict: a chorus moves a read head and a tremolo moves '
             + 'a gain, so there is no number that says how far apart they are.',
        }],
      };
    }

    const gap = distance(
      modReading({ ...MOD_DEFAULTS, ...guess }),
      modReading(answer),
    );
    const error = gap.off;
    const mark = error <= close ? HIT : error <= close * 2.5 ? NEAR : MISS;

    return {
      correct: error <= close,
      error,
      cells: [
        { state: mark, text: `${error.toFixed(1)}% out` },
        {
          state: mark,
          text: error <= close ? 'that is the move'
            : gap.where === 'the rate' ? (gap.detail.faster ? 'too slow' : 'too fast')
              : gap.where === 'the depth' ? (gap.detail.deeper ? 'not deep enough' : 'too deep')
                : 'the sides are wrong',
          narrow: true,
        },
      ],
      why: [
        {
          label: 'The path, compared',
          value: `${error.toFixed(2)}% of full travel`,
          how: 'Both oscillators are run for four seconds from the top of their own '
             + 'sweep and the two paths are compared frame by frame, as a fraction of '
             + 'how far each could have gone. Which means the rate and the depth are '
             + 'marked together: a rate that is out walks away from the target, and a '
             + 'depth that is out never goes as far.',
        },
        {
          label: 'The target',
          value: `${noteOf(answer.sync).label} at ${Math.round(answer.depth * 100)}%`
            + `${modKind(answer.kind).knobs.includes('spread') ? `, ${MOD_SPREADS.find((s) => s.id === answer.spread)?.label.toLowerCase()}` : ''}`,
          how: `Which is ${answer.rate.toFixed(2)} Hz on this loop. The rate is a note `
             + 'value because a modulation in time with the music is a different '
             + 'instrument from one that is not - and because a path four seconds long '
             + 'can tell half a per cent of rate from none, which is not a tolerance '
             + 'anybody could hit by turning a knob.',
        },
        {
          label: 'Allowed',
          value: `${close.toFixed(1)}%`,
          how: 'Measured against the mistakes somebody actually makes: a hundredth of '
             + 'the travel reads 0.7, a twentieth reads 3.5, a tenth reads 7.0, and '
             + 'leaving the depth at nought reads at least 21.9. So the tiers are a '
             + 'depth tolerance - a tenth, a twentieth and a fortieth - and every one '
             + 'of them refuses the empty answer outright.',
        },
      ],
    };
  },

  hints(puzzle) {
    const exercise = puzzle?.settings?.exercise ?? 'match';
    const { answer } = puzzle;

    if (exercise === 'drill') {
      const wanted = modKind(answer.kind);
      return [
        'Ask where it is wired rather than what it is called. Is the loudness '
          + 'moving, is the pitch moving, or is the tone moving? Those are three '
          + 'different wires and the six sort into them.',
        wanted.family === 'level'
          ? 'The tone is not changing at all - only how much of it there is.'
          : wanted.family === 'phase'
            ? 'The tone is moving, and it is smooth rather than metallic: notches '
              + 'spread out rather than a comb.'
            : wanted.wet < 1
              ? 'Two voices rather than one, comb-filtering each other as they move.'
              : 'The pitch itself is bending, with nothing to comb against.',
        `It is ${wanted.label.toLowerCase()}: the oscillator pointed at `
          + `${MOD_FAMILIES[wanted.family].label}.`,
      ];
    }

    if (exercise === 'rate') {
      const division = noteOf(answer.division);
      return [
        'Count the beat of the loop first, then count how many times the '
          + 'modulation moves inside one. Do not try to hear the rate on its own - '
          + 'nobody can name a speed without something to measure it against.',
        division.beats >= 1
          ? 'It moves once a beat or slower, so it is on the long end of the list.'
          : division.beats <= 0.25
            ? 'It moves four times a beat, which is the fast end of the list.'
            : 'It moves two or three times a beat, which is the middle of the list.',
        `It is on ${division.label}, which is ${rateFor(division.beats).toFixed(2)} Hz.`,
      ];
    }

    const row = modKind(answer.kind);
    return [
      'Set the rate before the depth, and set it from the sync menu rather than '
        + 'by hand: these rounds are always in time, so the rate is a note value '
        + 'and the depth is the only thing left to listen for.',
      `It is on ${noteOf(answer.sync).label}, which is `
        + `${rateFor(noteOf(answer.sync).beats).toFixed(2)} Hz`
        + `${row.knobs.includes('spread') ? `, with the sides ${MOD_SPREADS.find((s) => s.id === answer.spread)?.label.toLowerCase()}` : ''}.`,
      `And the depth is ${Math.round(answer.depth * 100)} per cent, which is `
        + `${answer.depth < 0.35 ? 'gentler than it sounds' : answer.depth > 0.6 ? 'deeper than most people would set it' : 'about the middle of the knob'}.`,
    ];
  },

  reveal(puzzle) {
    const exercise = puzzle?.settings?.exercise ?? 'match';
    const { answer } = puzzle;

    if (exercise === 'drill') {
      return { symbol: modKind(answer.kind).label, name: 'was running' };
    }
    if (exercise === 'rate') {
      return { symbol: noteOf(answer.division).label, name: 'is the note value' };
    }
    return {
      symbol: `${Math.round(answer.depth * 100)}%`,
      name: `on ${noteOf(answer.sync).label}`,
    };
  },

  heard(guess, puzzle) {
    const exercise = puzzle?.settings?.exercise ?? 'match';
    if (exercise === 'drill') {
      if (guess?.kind === undefined) return null;
      return { key: `mod-${guess.kind}`, label: modKind(guess.kind).label };
    }
    if (exercise === 'rate') {
      if (guess?.division === undefined) return null;
      return { key: `mod-${guess.division}`, label: noteOf(guess.division).label };
    }
    return null;
  },

  weak(puzzle) {
    const exercise = puzzle?.settings?.exercise ?? 'match';
    const { answer } = puzzle;
    if (exercise === 'drill') {
      return { key: `mod-${answer.kind}`, label: `hearing ${modKind(answer.kind).label.toLowerCase()}` };
    }
    if (exercise === 'rate') {
      return { key: `mod-${answer.division}`, label: `counting ${noteOf(answer.division).label}` };
    }
    return { key: 'mod-match', label: 'setting a modulation' };
  },

  defaults: MOD_DEFAULTS,
};
