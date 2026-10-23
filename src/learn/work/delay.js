import {
  ECHO_DEFAULTS, DIVISIONS, SYNC_DIVISIONS, MOST_FEEDBACK,
  echoProfile, timeOf, nearestDivision,
} from '../../plugins/delay/line.js';
import { decayReading } from '../../lib/response.js';
import { distance } from '../../gap.js';
import { writeMs } from '../../lib/panel.js';
import { LOOP_BEAT } from '../../lib/tempo.js';
import { HIT, NEAR, MISS, onScale, logPick, toStep, pick } from './scoring.js';

/**
 * The delay, and the one question everybody asks about one.
 *
 * **Match the delay** puts a delay on the loop and asks you to build the same
 * one, marked on how it dies away - which covers the time, the feedback, the
 * filters in the loop and the balance, all in one reading.
 *
 * **Find the time** is the question: a delay is locked to the track and you
 * have to dial yours until it locks too. There is no tempo readout and no
 * grid on the display for that one, which is not a handicap but the actual
 * job - matching a delay to a record nobody has told you the tempo of. What
 * you are listening for is the repeats falling in with the track instead of
 * walking through it, and it is the most useful thing in this mode.
 */

/** What each exercise is played on, and what the other side of the A/B is. */

/**
 * How far two delays may be apart and still match, in decibels of decay.
 *
 * Measured against the targets this mode generates: being one note value out
 * reads between 4.5 and 7 dB, a time ten per cent off reads between 1.5 and
 * 4, and fifteen points of extra feedback reads about 4. So easy forgives ten
 * per cent, medium mostly does not, and nothing at all forgives being on the
 * wrong note.
 */
const ECHO_CLOSE = { easy: 2.6, medium: 1.9, hard: 1.2 };

/**
 * How far out the time may be when the time is the whole question, in octaves.
 *
 * The note values this mode draws from are at least a third apart, which is
 * 0.41 of an octave, so even the loosest of these lands you on one note value
 * and not its neighbour.
 */
const LOCKED = { easy: 0.16, medium: 0.1, hard: 0.06 };

/**
 * The two exercises, in the shape a session can set up.
 *
 * In match there is a delay on the other side of the A/B. In find there is
 * nothing there: what you compare against is the loop with no repeats on it,
 * which is what tells you whether yours is falling in with it.
 */
/* --- the drill ------------------------------------------------------------ */

/**
 * Which note the echo is on, at this track's tempo.
 *
 * Measured, which here means computed from the loop's own 96 bpm: a quarter
 * is 625.0 ms, a dotted eighth 468.8, an eighth 312.5, an eighth triplet
 * 208.3 and a sixteenth 156.3. The neighbours are a ratio apart rather than a
 * number - 1.33 between the quarter and the dotted eighth, 1.50 between the
 * dotted eighth and the eighth, 1.50 and 1.33 going down - which is why the
 * easy tier takes every other one and ends up with 4:2:1.
 *
 * `DIVISIONS` is the delay's own list, not a second copy of it: the five the
 * sync menu offers that the ear can actually tell apart.
 */
const DIVISION_DRILL = {
  easy: { ids: ['quarter', 'eighth', 'sixteenth'], near: 0 },
  medium: { ids: ['quarter', 'dotted8', 'eighth', 'sixteenth'], near: 1 },
  hard: { ids: DIVISIONS.map((d) => d.id), near: 1 },
};

const divisionAt = (id) => DIVISIONS.findIndex((d) => d.id === id);

/** Enough repeats to hear the spacing, and not so many it turns into a wash. */
const DRILL_ECHO = { feedback: 0.45, mix: 0.4, tone: 6000, lowCut: 120, pingPong: false };

export const ECHO_EXERCISES = {
  match: {
    id: 'match',
    label: 'Match the delay',
    source: 'instrument',
    sourceOptions: { tempo: true },
    other: 'Target',
    targetOf: (puzzle) => puzzle.answer,
  },
  find: {
    id: 'find',
    label: 'Find the time',
    source: 'drums',
    sourceOptions: { tempo: false },
    other: 'Dry',
    targetOf: (puzzle) => ({ ...ECHO_DEFAULTS, ...puzzle.answer }),
  },
  drill: {
    id: 'drill',
    label: 'Which note is it on?',
    drill: true,
    ask: 'Which note value are these repeats on?',
    lede: 'Nothing to dial here. There is a delay on the loop and it is in time '
        + 'with it: say which note value it is on.',
    opening: 'Play it, count along with the repeats, then name the division.',
    tierBlurbs: {
      easy: 'Quarter, eighth, sixteenth',
      medium: 'And the dotted eighth',
      hard: 'And the triplet',
    },
    // Drums, with the tempo they are in: a division only means anything
    // against a pulse you can hear.
    source: 'drums',
    sourceOptions: { tempo: false },
    other: 'Dry',
    targetOf: () => ({ ...ECHO_DEFAULTS, mix: 0 }),

    startOf: (puzzle) => ({
      ...ECHO_DEFAULTS,
      ...DRILL_ECHO,
      time: timeOf(DIVISIONS[divisionAt(puzzle.answer.division)].beats),
    }),
    cleanOf: () => ({ ...ECHO_DEFAULTS, mix: 0 }),
    restores: true,
  },
};

/**
 * Name the division.
 *
 * Exact, for being right: a dotted eighth is not nearly a quarter, it is the
 * thing that makes a part sound like it is pulling against the bar instead of
 * sitting on it, and marking that "close" would be teaching the opposite of
 * the lesson. But a guess next door still earns the gold, because hearing a
 * repeat at roughly the right speed and picking the wrong subdivision of it
 * is a different mistake from not hearing it at all - 1.33 and 1.50 is what
 * separates these, so next door is genuinely next door.
 */
function scoreDivision(state, puzzle) {
  const { answer, tier } = puzzle;
  const spec = DIVISION_DRILL[tier] ?? DIVISION_DRILL.medium;
  const offered = DIVISIONS.filter((d) => spec.ids.includes(d.id));

  const mark = onScale(
    offered.findIndex((d) => d.id === state.division),
    offered.findIndex((d) => d.id === answer.division),
    { near: spec.near },
  );

  const guessed = DIVISIONS[divisionAt(state.division)];
  const wanted = DIVISIONS[divisionAt(answer.division)];
  const ratio = timeOf(guessed.beats) / timeOf(wanted.beats);

  return {
    correct: mark === HIT,
    cells: [
      { state: mark, text: guessed.label },
      {
        state: mark,
        text: ratio === 1 ? 'that is it'
          : `${(ratio > 1 ? ratio : 1 / ratio).toFixed(2)}× too ${ratio > 1 ? 'slow' : 'fast'}`,
        narrow: true,
      },
    ],
    why: [
      {
        label: 'What you picked',
        value: `${guessed.label} - ${writeMs(timeOf(guessed.beats))}`,
        how: 'Worked out from the loop\'s own tempo of 96 beats a minute, where '
           + 'one beat is 625 ms and every division is a fraction of it.',
      },
      {
        label: 'What it was',
        value: `${wanted.label} - ${writeMs(timeOf(wanted.beats))}`,
        how: 'Set on the delay\'s own time control, converted from the note value '
           + 'against that same tempo - so the repeats really are on the grid.',
      },
      {
        label: 'How far apart these are',
        value: 'a ratio, not a number of milliseconds',
        how: 'A quarter is 625.0 ms, a dotted eighth 468.8, an eighth 312.5, an '
           + 'eighth triplet 208.3 and a sixteenth 156.3 - so neighbours sit 1.33 '
           + 'or 1.50 apart whatever end of the list they are at. The easy tier '
           + 'takes every other one, which makes it 4:2:1.',
      },
    ],
  };
}

export const ECHO_WORK = {
  tool: 'delay',
  opening: 'Play the loop, set the repeats, then lock it in.',

  settings: [
    {
      id: 'exercise',
      label: 'Exercise',
      options: Object.values(ECHO_EXERCISES).map(({ id, label }) => ({ id, label })),
    },
  ],

  exercises: ECHO_EXERCISES,

  tiers: {
    easy: { label: 'Easy', blurb: 'Time and feedback', guesses: 4, tone: false, detail: false },
    medium: { label: 'Medium', blurb: 'And their tone', guesses: 4, tone: true, detail: false },
    hard: { label: 'Hard', blurb: 'And the routing', guesses: 4, tone: true, detail: true },
  },

  /** Answered on the plugin, except in the drill, which asks with chips. */
  slots(tier, settings) {
    if (settings?.exercise !== 'drill') return [];

    const spec = DIVISION_DRILL[tier] ?? DIVISION_DRILL.medium;
    return [{
      id: 'division',
      kind: 'choice',
      label: 'Which division',
      options: DIVISIONS
        .filter((d) => spec.ids.includes(d.id))
        .map((d) => ({ id: d.id, symbol: d.label, name: `${Math.round(timeOf(d.beats))} ms` })),
    }];
  },

  makePuzzle(rng, tier, settings) {
    if (settings.exercise === 'drill') {
      const spec = DIVISION_DRILL[tier] ?? DIVISION_DRILL.medium;
      const division = pick(rng, DIVISIONS.filter((d) => spec.ids.includes(d.id)));
      return { answer: { division: division.id } };
    }

    if (settings.exercise === 'find') {
      // Only the well-spaced note values: the question is which one, and a
      // pair twelve per cent apart is a question about a stopwatch.
      const division = pick(rng, DIVISIONS);
      return {
        answer: {
          ...ECHO_DEFAULTS,
          time: timeOf(division.beats),
          division: division.label,
          feedback: toStep(0.3 + rng() * 0.3, 0.01),
          mix: 0.35,
        },
      };
    }

    // A short tail or a long one, never the middle. The plugin opens on
    // thirty-five per cent of feedback, and a target drawn either side of
    // that is a target you have to do something to reach - without it, two
    // targets in twenty-four sat close enough to the opening settings that
    // submitting them untouched passed.
    const spec = this.tiers[tier];
    const musical = SYNC_DIVISIONS.filter((d) => d.beats !== null);
    const short = rng() < 0.5;
    const answer = {
      ...ECHO_DEFAULTS,
      time: timeOf(pick(rng, musical).beats),
      feedback: toStep(short ? 0.12 + rng() * 0.12 : 0.5 + rng() * 0.2, 0.01),
      mix: toStep(0.2 + rng() * 0.25, 0.01),
    };

    if (spec.tone) answer.tone = toStep(logPick(rng, 1500, 18000), 100);
    if (spec.detail) {
      answer.lowCut = toStep(logPick(rng, 20, 600), 5);
      answer.pingPong = rng() < 0.5;
    }

    return { answer };
  },

  /* ---------- marking ---------- */

  score(state, puzzle) {
    const { answer, tier } = puzzle;
    const guess = state;
    const exercise = puzzle?.settings?.exercise ?? 'match';
    if (exercise === 'drill') return scoreDivision(guess, puzzle);

    const settings = { ...ECHO_DEFAULTS, ...guess };
    // Delays are built from numbers rather than recorded, so marking needs no
    // audio and comes out the same on every machine.
    const rate = 48000;

    if (exercise === 'find') return this.scoreFind(settings, answer, tier);

    const wanted = { ...ECHO_DEFAULTS, ...answer };
    // The same kind of reading the reverb takes, on purpose: a room and a
    // repeat are the same sort of object here, so "is this delay as long as
    // that room" is a question that can be asked at all.
    const mine = decayReading('delay', echoProfile(rate, settings), { state: settings });
    const theirs = decayReading('delay', echoProfile(rate, wanted), { state: wanted });
    const gap = distance(mine, theirs);
    const error = gap.off;

    const close = ECHO_CLOSE[tier];
    const mark = error <= close ? HIT : error <= close * 2.5 ? NEAR : MISS;

    // Which way it is out, in the terms the delay is set in.
    const timing = Math.log2(settings.time / wanted.time);
    const back = settings.feedback - wanted.feedback;

    return {
      correct: error <= close,
      error,
      cells: [
        { state: mark, text: `${error.toFixed(1)} dB out` },
        {
          state: mark,
          text: error <= close ? 'that is the delay'
            : Math.abs(timing) > 0.06 ? `${this.howFar(timing)} too ${timing > 0 ? 'long' : 'short'}`
            : Math.abs(back) > 0.1 ? `${Math.round(Math.abs(back) * 100)}% too much ${back > 0 ? 'feedback' : 'little feedback'}`
            : 'the right time, the wrong delay',
        },
      ],
      why: [
        {
          label: 'Repeats, compared',
          value: `${error.toFixed(2)} dB apart, worst in ${gap.where}`,
          how: 'Both delays are built and their repeats read in three bands over '
             + 'time - where each echo lands, how loud it is, and what the tone '
             + 'control has taken off it by then. Built from numbers rather than '
             + 'recorded, so this comes out the same on every machine.',
        },
        {
          label: 'Time',
          value: `${this.howFar(timing)} too ${timing > 0 ? 'long' : 'short'}`,
          how: 'Compared as a ratio, not in milliseconds: a hundred milliseconds '
             + 'out is a different mistake at a sixteenth than it is at a quarter.',
        },
        {
          label: 'Feedback',
          value: `${Math.round(Math.abs(back) * 100)}% too ${back > 0 ? 'much' : 'little'}`,
          how: 'How much of each repeat goes back in - how many you get before '
             + 'they die away, rather than how loud the first one is.',
        },
      ],
    };
  },

  /**
   * Is it locked to the track?
   *
   * Only the time is read, because only the time was asked about. The
   * feedback and the tone are yours to set to whatever makes the repeats
   * easiest to hear, which is what anybody does when they are trying to find
   * a tempo.
   */
  scoreFind(settings, answer, tier) {
    // Heard as a ratio: a hundred milliseconds out is a different mistake at
    // a sixteenth than it is at a quarter.
    const off = Math.log2(settings.time / answer.time);
    const close = LOCKED[tier];
    const locked = Math.abs(off) <= close;

    return {
      correct: locked,
      error: Math.abs(off),
      cells: [
        {
          state: locked ? HIT : Math.abs(off) <= close * 2.5 ? NEAR : MISS,
          text: locked ? 'locked to the track' : `${this.howFar(off)} out`,
        },
        {
          state: locked ? HIT : Math.abs(off) <= close * 2.5 ? NEAR : MISS,
          text: locked ? `that is ${answer.division}` : `too ${off > 0 ? 'long' : 'short'}`,
        },
      ],
      why: [
        {
          label: 'Time',
          value: `${writeMs(settings.time)}, wanted ${writeMs(answer.time)}`,
          how: `The answer is ${answer.division} at this tempo, worked out from the `
             + 'loop rather than from the number on the control - which is why '
             + 'the delay reads as locked when it falls in with the drums and '
             + 'not when it lands on a round figure.',
        },
        {
          label: 'Out by',
          value: `${off.toFixed(3)} octaves - ${this.howFar(off)}`,
          how: 'Heard as a ratio, so compared as one. Only the time is read, '
             + 'because only the time was asked about: the feedback and the tone '
             + 'are yours to set to whatever makes the repeats easiest to hear, '
             + 'which is what anybody does when they are hunting for a tempo.',
        },
        {
          label: 'Locked at',
          value: `${(close * 100).toFixed(1)}% of an octave`,
          how: 'How far off the subdivision still counts as in time. It tightens '
             + 'with the tier.',
        },
      ],
    };
  },

  /** How far off, as a percentage of what was wanted. */
  howFar(octaves) {
    const factor = 2 ** Math.abs(octaves);
    return `${Math.round((factor - 1) * 100)}%`;
  },

  hints(puzzle) {
    const { answer, tier } = puzzle;

    if ((puzzle?.settings?.exercise ?? 'match') === 'drill') {
      const division = DIVISIONS[divisionAt(answer.division)];
      const beats = division.beats;
      return [
        'Count the pulse of the loop out loud, then count the repeats against '
          + 'it. The question is how many repeats fit in a beat.',
        beats >= 1 ? 'There is about one repeat to the beat, or fewer.'
          : beats >= 0.5 ? 'There are about two repeats to the beat.'
          : 'There are three or four repeats to the beat.',
        beats === 0.75 || beats === 1 / 3
          ? `It does not land on the beat: it is ${beats === 0.75 ? 'dotted, so it drifts across the bar' : 'a triplet, so three of them fill the beat'}.`
          : 'It lands squarely on the grid, so it is neither dotted nor a triplet.',
      ];
    }

    const settings = { ...ECHO_DEFAULTS, ...answer };

    if ((puzzle?.settings?.exercise ?? 'match') === 'find') {
      const beats = answer.time / (LOOP_BEAT * 1000);
      return [
        `It is a ${beats >= 0.9 ? 'long' : beats >= 0.45 ? 'medium' : 'short'} `
          + 'subdivision - count it against the drums rather than reading the '
          + 'number.',
        `It is ${answer.division.includes('triplet') ? 'a triplet'
          : answer.division.includes('dotted') ? 'dotted' : 'straight'}, `
          + `and around ${writeMs(answer.time)} at this tempo.`,
      ];
    }

    const near = nearestDivision(settings.time);
    return [
      `The time is about ${writeMs(settings.time)}`
        + `${near && near.off < 0.02 ? ` - which is ${near.division.label}` : ''}.`,
      `Around ${Math.round(settings.feedback * 100)}% going back in, so `
        + `${settings.feedback > 0.55 ? 'a long tail of repeats'
          : settings.feedback > 0.3 ? 'a few audible repeats' : 'barely more than a slap'}`
        + `${settings.pingPong ? ', and it alternates across the stereo field' : ''}.`,
    ];
  },

  reveal(puzzle) {
    const { answer } = puzzle;

    if ((puzzle?.settings?.exercise ?? 'match') === 'drill') {
      const division = DIVISIONS[divisionAt(answer.division)];
      return { symbol: division.label, name: `${writeMs(timeOf(division.beats))} at this tempo` };
    }

    const settings = { ...ECHO_DEFAULTS, ...answer };

    if ((puzzle?.settings?.exercise ?? 'match') === 'find') {
      return { symbol: answer.division, name: `${writeMs(settings.time)} at this tempo` };
    }

    const near = nearestDivision(settings.time);
    return {
      symbol: near && near.off < 0.02 ? near.division.label : writeMs(settings.time),
      name: `${writeMs(settings.time)}, ${Math.round(settings.feedback * 100)}% back`
          + `${settings.pingPong ? ', ping-pong' : ''}`,
    };
  },

  /** What a guess says it heard, in `weak`'s own words. */
  heard(guess, puzzle) {
    if ((puzzle?.settings?.exercise ?? 'match') !== 'drill') return null;
    const division = DIVISIONS[divisionAt(guess.division)];
    if (!division) return null;
    return { key: `division-${division.id}`, label: `the ${division.label} delay` };
  },

  weak(puzzle) {
    const { answer } = puzzle;
    if ((puzzle?.settings?.exercise ?? 'match') === 'drill') {
      const division = DIVISIONS[divisionAt(answer.division)];
      return { key: `division-${division.id}`, label: `the ${division.label} delay` };
    }
    if ((puzzle?.settings?.exercise ?? 'match') === 'find') {
      return { key: answer.division, label: `the ${answer.division} delay` };
    }

    const feedback = answer?.feedback ?? ECHO_DEFAULTS.feedback;
    const how = feedback >= MOST_FEEDBACK * 0.75 ? 'long feedback'
      : feedback >= 0.35 ? 'working feedback' : 'short delays';
    return { key: how, label: how };
  },
};
