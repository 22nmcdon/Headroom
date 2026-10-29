import {
  ECHO_DEFAULTS, DIVISIONS, SYNC_DIVISIONS,
  echoProfile, timeOf, nearestDivision,
  HEAD_PATTERNS, repeatsReading, headsOf, wanderReading,
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
const ECHO_CLOSE = { easy: 2.6, medium: 1.9, hard: 1.2, expert: 1.2 };

/**
 * How far the shape of the loop may be out, in decibels, where it is asked
 * for at all.
 *
 * Six, and the gap it has to sit in is narrower than this comment used to
 * say. It claimed the worst incidental was 2.31 dB, the feedback a seventh of
 * the way out - but that was the worst of the handful of settings the table
 * beside the reading happened to list. Swept over every head pattern and
 * every other control, the worst is a bucket brigade or a tape machine read
 * against a digital one on four heads: 4.57 dB, and 4.31 through the box this
 * reading used to be framed with, so the claim was already wrong before the
 * framing changed. The closest wrong pattern is 14.96 dB.
 *
 * So six sits between 4.57 and 14.96 rather than between 2.31 and 21. Still
 * comfortably inside, and worth knowing it is three decibels from one side
 * and nine from the other rather than the other way round: if anything ever
 * widens what a machine does to the arrivals, this is the number that moves.
 */
const SHAPE_CLOSE = 6;

/**
 * And how far the transport may be out, in cents.
 *
 * Four, and it is the floors on the targets below that set it rather than the
 * other way round. The reading moves about 3.5 cents for every ten on a knob,
 * so a tolerance in this region resolves the depth to roughly a tenth of a
 * tone - and what it must not do is let somebody leave the transport alone and
 * be told they matched a delay that wanders. Measured over twenty-four expert
 * targets:
 *
 *     the exact answer        0.00 cents        passes 24 of 24
 *     five cents out         0.32 to 2.41      passes 24 of 24
 *     ten cents out          0.32 to 4.83      passes 20 of 24
 *     swapped, wow for flutter  0.95 to 16.45
 *     left steady            5.08 to 14.41     passes  0 of 24
 *
 * So five cents always passes, ten is the boundary, and steady never passes -
 * the last row's floor is what the four is under. Where swapping the two
 * reads as little as 0.95 the target had near-equal depths of each, and
 * swapping those really is almost the same sound, so that row is a range
 * rather than a threshold.
 */
const WANDER_CLOSE = 4;

/**
 * What an expert target's transport is doing, in cents.
 *
 * Three characters rather than two independent depths, because two
 * independent draws would mostly produce targets with a little of each, and
 * "a little of each" is the one answer nobody can name. One of them doing
 * something definite is a question with an answer: which one, and how much.
 *
 * The floors are where the wander stops being audible as wander. Under about
 * ten cents a delay sounds steady with something slightly wrong with it, and
 * a target there would be asking people to hear the difference between nearly
 * nothing and nothing.
 */
/**
 * And how smeared an expert target's repeats are, where it asks at all.
 *
 * Only when the tail is a long one, which is the whole of the design here. The
 * output is taken in front of the all-passes, so the first repeat is clean
 * whatever the diffusion is and every pass after it is smeared once more than
 * the last - which means a delay with two audible repeats has almost nothing
 * for a smear to act on. Measured on the loop reading at 375 ms, between pairs
 * of diffusion:
 *
 *                      a long tail (fb 0.6)    a short one (fb 0.18)
 *     clean vs 0.15            7.4 dB                  3.0 dB
 *     clean vs 0.30            9.7                     4.3
 *     clean vs 0.60           13.2                     6.2
 *     clean vs 1.00           17.5                     8.4
 *     adjacent 0.15 steps   3.0 to 3.9              1.4 to 1.8
 *
 * Against the 6 dB that decides a pass, a long tail resolves diffusion to
 * about a fifth of its travel and a short one does not resolve it at all -
 * clean against six tenths is 6.09 dB, which is the tolerance itself. So
 * asking on a short tail would be asking for something nobody can hear, and
 * the reading would be right to shrug.
 *
 * It is not a tell worth worrying about. What somebody learns from this is
 * that smearing a slapback does nothing, which is true of delays rather than
 * of this app.
 *
 * A third of the long-tailed targets are clean, so that "is it smeared at
 * all" stays a question - and clean is enforceable, since six tenths against
 * none reads 12.64 dB and the least this tier ever draws, three tenths,
 * reads 8.03. A seventh of the travel would read 6.31, which is the
 * tolerance plus a rounding - but SMEAR_RANGE never draws one that small, so
 * the number the drill rests on is the 8.03 rather than that.
 *
 * What the whole of it comes to, over twenty expert targets - twelve with a
 * long tail, nine of those smeared, none of the short-tailed ones:
 *
 *     the exact answer passes          20 of 20
 *     answering clean when it is not    0 of 9
 *     a seventh of diffusion out        9 of 9
 *     a third out                       5 of 9
 *
 * So clean is refused, a near match by ear passes, and about a fifth of the
 * travel is the boundary - which is roughly what anybody can hear of it.
 */
const SMEAR_CLEAN = 1 / 3;
const SMEAR_RANGE = [0.3, 0.9];

const WANDER_KINDS = ['wow', 'flutter', 'both'];
const WANDER_DRAW = {
  wow: { wow: [16, 45], flutter: [0, 0] },
  flutter: { wow: [0, 0], flutter: [16, 24] },
  both: { wow: [16, 32], flutter: [14, 20] },
};

/**
 * How far out the time may be when the time is the whole question, in octaves.
 *
 * The note values this mode draws from are at least a third apart, which is
 * 0.41 of an octave, so even the loosest of these lands you on one note value
 * and not its neighbour.
 */
const LOCKED = { easy: 0.16, medium: 0.1, hard: 0.06, expert: 0.04 };

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
  // Every division, and nothing counted as nearly: the tier above hard is the
  // one where the neighbouring note value is simply wrong.
  expert: { ids: DIVISIONS.map((d) => d.id), near: 0 },
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
    // Its own, because the generic ones name controls this exercise does not
    // ask you to touch: here the only question is ever the time, and the tier
    // is how close you have to be.
    tierBlurbs: {
      easy: 'Within a sixth of an octave',
      medium: 'Within a tenth',
      hard: 'Within a sixteenth',
      expert: 'Within a twenty-fifth',
    },
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
      expert: 'And no credit for nearly',
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
  pattern: {
    id: 'pattern',
    label: 'How many heads?',
    drill: true,
    ask: 'How many places is this delay being read from?',
    lede: 'Nothing to dial here. A tape loop can be read by more than one head, '
        + 'and what comes back is a little figure rather than one echo: say how '
        + 'many heads are on.',
    opening: 'Play it, count the repeats before the pattern starts over, then say how many.',
    tierBlurbs: {
      easy: 'One head or four',
      medium: 'And three',
      hard: 'Faster, louder and smeared',
      expert: 'Smeared further still',
    },
    // Drums with the tempo they are in, like the division drill: a pattern is
    // a rhythm and a rhythm needs a pulse to be one against.
    source: 'drums',
    sourceOptions: { tempo: false },
    other: 'Dry',
    targetOf: () => ({ ...ECHO_DEFAULTS, mix: 0 }),

    startOf: (puzzle, tier) => {
      const spec = PATTERN_DRILL[tier] ?? PATTERN_DRILL.medium;
      return {
        ...ECHO_DEFAULTS,
        ...DRILL_ECHO,
        time: puzzle.answer.time,
        heads: puzzle.answer.heads,
        feedback: spec.feedback,
        diffusion: spec.diffusion,
      };
    },
    cleanOf: () => ({ ...ECHO_DEFAULTS, mix: 0 }),
    restores: true,
  },
};

/**
 * What a transport is doing, in words, without saying how much of it.
 *
 * Wow is a pitch you can follow up and down and flutter is a roughness on the
 * note that you cannot, so naming which one is a real hint and still leaves
 * the whole of the matching to do.
 */
function wanderWords(settings) {
  const wow = settings.wow > 0;
  const flutter = settings.flutter > 0;
  if (wow && flutter) {
    return 'The transport is doing both: a slow drift in pitch with a faster '
      + 'roughness sitting on top of it.';
  }
  if (wow) return 'The transport drifts slowly - a pitch you can follow going up and down.';
  if (flutter) {
    return 'The transport is rough rather than drifting: a flutter too fast to '
      + 'follow, which thickens the note instead of bending it.';
  }
  return 'The transport holds time: the repeats come back at the pitch they went in at.';
}

/**
 * How smeared the repeats are, in words, without saying how much.
 *
 * Named by what it does to a repeat rather than by the number on the knob,
 * because that is what there is to listen for: a clean repeat has an edge on
 * it and a smeared one does not.
 */
function smearWords(settings) {
  const smear = settings.diffusion ?? 0;
  if (smear <= 0) return 'The repeats keep their edge - whatever hit the line comes back as itself.';
  return 'The repeats are smeared rather than clean, and each pass is smeared '
    + 'further than the one before it: listen to the last repeat you can hear, '
    + 'not the first.';
}

/** The three, in the order that makes a neighbour a neighbour. */
const PATTERN_IDS = ['single', 'heads3', 'heads4'];

/**
 * Which heads, at which tier, and on what material.
 *
 * Every tier offers all three, and the difficulty is in the material rather
 * than the list: the time comes down so the repeats crowd, the feedback goes
 * up so they overlap, and the hard tier smears them with a little diffusion.
 *
 * Three patterns is all there are, so a tier offering fewer would be a drill
 * with two answers - and this app's drills are held to at least three, so
 * that no chip is worth always picking. An earlier version of this had easy
 * offering one head against four, and tests/drill.test.js refused it.
 *
 * Harder to count is not the same as closer together, which is the thing to
 * be careful of here. Measured on the loop reading, every pair at every tier:
 *
 *     easy    (625 ms, fb 0.3)                 single vs heads3   15.57 dB
 *                                              single vs heads4   19.07
 *                                              heads3 vs heads4   23.72
 *     medium  (469 ms, fb 0.45)                single vs heads3   17.10
 *                                              single vs heads4   20.93
 *                                              heads3 vs heads4   25.99
 *     hard    (313 ms, fb 0.55, diffuse 0.35)  single vs heads3   23.05
 *                                              single vs heads4   27.53
 *                                              heads3 vs heads4   22.22
 *     expert  (313 ms, fb 0.65, diffuse 0.5)   single vs heads3   25.77
 *                                              single vs heads4   29.59
 *                                              heads3 vs heads4   20.47
 *
 * The hard tier is further apart than the easy one. What it is is harder to
 * count, which is a difficulty the reading cannot see and the ear can. The
 * figures are here so that nobody tightens a tier until two of its answers
 * are the same sound.
 */
const PATTERN_DRILL = {
  easy: { ids: PATTERN_IDS, division: 'quarter', feedback: 0.3, diffusion: 0 },
  medium: { ids: PATTERN_IDS, division: 'dotted8', feedback: 0.45, diffusion: 0 },
  hard: { ids: PATTERN_IDS, division: 'eighth', feedback: 0.55, diffusion: 0.35 },
  expert: { ids: PATTERN_IDS, division: 'eighth', feedback: 0.65, diffusion: 0.5 },
};

/** How many heads each one is, for the face of a chip. */
const HEAD_COUNT = { single: '1', heads3: '3', heads4: '4' };

/**
 * Name the pattern.
 *
 * Ordered by how many heads, so mistaking three for four is next door and
 * calling four heads one head is not. Hearing that there is a pattern at all
 * and then miscounting it is a different mistake from hearing one repeat
 * where there are four, and the marking says so.
 */
function scorePattern(state, puzzle) {
  const { answer, tier } = puzzle;
  const spec = PATTERN_DRILL[tier] ?? PATTERN_DRILL.medium;
  const offered = PATTERN_IDS.filter((id) => spec.ids.includes(id));

  const mark = onScale(
    offered.indexOf(state.heads),
    offered.indexOf(answer.heads),
    { near: 1 },
  );

  const guessed = headsOf(state.heads);
  const wanted = headsOf(answer.heads);
  const time = answer.time;

  /** Where a pattern's heads land, for saying it out loud. */
  const landing = (pattern) => pattern.taps
    .map((tap) => writeMs(tap * time))
    .join(', ');

  return {
    correct: mark === HIT,
    cells: [
      { state: mark, text: guessed.label },
      {
        state: mark,
        text: mark === HIT ? 'that is it'
          : `${wanted.taps.length} rather than ${guessed.taps.length}`,
        narrow: true,
      },
    ],
    why: [
      {
        label: 'What you picked',
        value: `${guessed.label} - ${landing(guessed)}`,
        how: 'Every head is a fraction of the time the delay is set to, so the '
           + 'last one lands on that time and the others arrive before it.',
      },
      {
        label: 'What it was',
        value: `${wanted.label} - ${landing(wanted)}`,
        how: 'The feedback comes off the longest head, so the whole pattern goes '
           + 'round again rather than each head breeding repeats of its own.',
      },
      {
        label: 'What to listen for',
        value: wanted.taps.length === 1
          ? 'one repeat a beat, dying away'
          : `${wanted.taps.length} repeats, then the lot again quieter`,
        how: 'One head is a single echo repeating. More heads is a little figure '
           + 'that repeats - so count the echoes before the pattern starts over, '
           + 'not the echoes in total.',
      },
    ],
  };
}

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
    expert: {
      label: 'Expert',
      blurb: 'And the machine',
      guesses: 4,
      tone: true,
      detail: true,
      wander: true,
      smear: true,
    },
  },

  /** Answered on the plugin, except in the drill, which asks with chips. */
  slots(tier, settings) {
    if (settings?.exercise === 'pattern') {
      const spec = PATTERN_DRILL[tier] ?? PATTERN_DRILL.medium;
      return [{
        id: 'heads',
        kind: 'choice',
        label: 'How many heads',
        options: PATTERN_IDS
          .filter((id) => spec.ids.includes(id))
          .map((id) => ({ id, symbol: HEAD_COUNT[id], name: headsOf(id).label })),
      }];
    }

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
    if (settings.exercise === 'pattern') {
      const spec = PATTERN_DRILL[tier] ?? PATTERN_DRILL.medium;
      const heads = pick(rng, PATTERN_IDS.filter((id) => spec.ids.includes(id)));
      const division = DIVISIONS.find((d) => d.id === spec.division) ?? DIVISIONS[0];
      return { answer: { heads, time: timeOf(division.beats), division: division.id } };
    }

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
    if (spec.smear && !short) {
      answer.diffusion = rng() < SMEAR_CLEAN
        ? 0
        : toStep(SMEAR_RANGE[0] + rng() * (SMEAR_RANGE[1] - SMEAR_RANGE[0]), 0.05);
    }
    if (spec.wander) {
      const kind = pick(rng, WANDER_KINDS);
      const draw = WANDER_DRAW[kind];
      for (const which of ['wow', 'flutter']) {
        const [low, high] = draw[which];
        answer[which] = high > low ? toStep(low + rng() * (high - low), 1) : low;
      }
    }
    if (spec.detail) {
      answer.lowCut = toStep(logPick(rng, 20, 600), 5);
      answer.pingPong = rng() < 0.5;
      answer.heads = pick(rng, HEAD_PATTERNS).id;
    }

    return { answer };
  },

  /* ---------- marking ---------- */

  score(state, puzzle) {
    const { answer, tier } = puzzle;
    const guess = state;
    const exercise = puzzle?.settings?.exercise ?? 'match';
    if (exercise === 'drill') return scoreDivision(guess, puzzle);
    if (exercise === 'pattern') return scorePattern(guess, puzzle);

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

    // The shape of the loop, which the decay reading cannot see: where the
    // repeats land inside one pass of it. At every tier, and the history of
    // this one line is worth keeping.
    //
    // It used to read `puzzle.spec?.detail`, and nothing has ever set
    // `puzzle.spec` - makePuzzle returns `{ answer }` and the game spreads
    // that into the puzzle beside the mode, the tier and the seed. So the
    // term was switched off from the day it was written. Pointed at the tier
    // instead, it then ran at the hard tier only, because that is the tier
    // whose answer carries a head pattern.
    //
    // Both of those were measured with seeds that turned out to be the same
    // seed. `makePuzzle` hashes its seed, and the numbers 1 to 60 that were
    // handed to it hashed to one puzzle sixty times over - so "0 of 80 wrong
    // patterns got through" described one target, repeated. With seeds that
    // differ, the decay curve on its own lets a wrong head pattern through:
    //
    //     tier      through on the decay curve alone   the loop reading says
    //     easy                    20 of 20            13.5 to 23.2 dB apart
    //     medium                  17 of 20            12.9 to 24.2
    //     hard                     9 of 20            13.0 to 29.6
    //     expert                  10 of 20            13.1 to 29.6
    //
    // So it was an open hole at every tier and not a latent one, and the
    // reading that closes it puts a wrong pattern twice the tolerance away
    // everywhere. With the term on at every tier, no wrong pattern gets
    // through at any of them.
    //
    // And it vetoes nothing it should not, which is the half that has to be
    // shown before a term that never ran is trusted. A three per cent error
    // on the time reads 0.00 to 0.20 dB through this reading at every tier,
    // never near the 6 it allows - the near misses that do fail are failing
    // on the decay curve's own tolerance, exactly as they did before.
    //
    // It catches diffusion too, which is in no tier's answer and so is a thing
    // you can only ever add when the target has none. Mostly: over thirty
    // targets a tier, six tenths of diffusion added to an exact answer still
    // passed 6 of 30 at the easy tier and 1 of 30 at hard and expert. That is
    // the design rather than a gap in it - the output is taken in front of the
    // all-passes, so the first pass is clean whatever the diffusion is, and a
    // delay with barely any tail has barely anything for a smear to act on.
    // Measured at 375 ms, no diffusion against six tenths of it:
    //
    //     feedback 0.12   4.84 dB      0.35    9.58
    //              0.20   6.58         0.50   11.91
    //              0.24   7.43         0.80   15.35
    //
    // The easy tier's short answers draw feedback between 0.12 and 0.24, which
    // is exactly where it crosses the 6 this allows.
    //
    // What it costs: two more responses a mark, which takes a mark from about
    // 110 ms to 226 at the easy tier. It is paid on a button press, once a
    // guess. Not skipped when both sides have the same heads and diffusion,
    // tempting as that is: the reading is not exactly blind to the rest, so
    // the panel would be printing "the repeats land where they should" from
    // an assumption - and a check that does not run is the fault this comment
    // is about.
    const shape = distance(repeatsReading(rate, settings), repeatsReading(rate, wanted)).off;

    // And how badly the transport holds time, which neither of the other two
    // can see: the decay curve reads fifty cents of wow at 0.88 dB against a
    // tolerance of 1.2, and the loop shape is taken with the transport held
    // still on purpose. Only where the tier asks for it, because the reading
    // costs 72 ms and three tiers out of four have nothing to ask.
    const wandering = this.tiers[tier]?.wander ?? false;
    // The whole gap and not just its size, because `where` names the band the
    // two disagree about most and that is what the note has to say - "wow" and
    // "flutter" being two different things to go and listen for. Taken once:
    // asking twice would be another two renders for a string.
    const wanderOff = wandering
      ? distance(wanderReading(rate, settings), wanderReading(rate, wanted))
      : null;
    const wander = wanderOff ? wanderOff.off : 0;

    const close = ECHO_CLOSE[tier];
    // A right-sounding decay with the wrong heads is not the delay. It can be
    // near, because the time and the feedback may well be right, and it
    // cannot be a hit.
    const held = error <= close && shape <= SHAPE_CLOSE && wander <= WANDER_CLOSE;
    const mark = held ? HIT : (error <= close * 2.5 ? NEAR : MISS);

    // Which way it is out, in the terms the delay is set in.
    const timing = Math.log2(settings.time / wanted.time);
    const back = settings.feedback - wanted.feedback;

    return {
      correct: held,
      error,
      cells: [
        { state: mark, text: `${error.toFixed(1)} dB out` },
        {
          state: mark,
          text: held ? 'that is the delay'
            : shape > SHAPE_CLOSE ? 'the repeats are in the wrong places'
            : wander > WANDER_CLOSE
              ? `the transport is steadier or looser than that - listen to the ${wanderOff.where}`
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
          label: 'The shape of the loop',
          value: shape <= SHAPE_CLOSE
            ? 'the repeats land where they should'
            : `${shape.toFixed(1)} dB apart`,
          how: 'Where the repeats land inside one pass of the loop, measured in '
             + 'fractions of it rather than in milliseconds - so this says '
             + 'whether the heads are right and says nothing about the time, '
             + 'which the reading above is for.',
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
    const said = [
      `The time is about ${writeMs(settings.time)}`
        + `${near && near.off < 0.02 ? ` - which is ${near.division.label}` : ''}.`,
      `Around ${Math.round(settings.feedback * 100)}% going back in, so `
        + `${settings.feedback > 0.55 ? 'a long tail of repeats'
          : settings.feedback > 0.3 ? 'a few audible repeats' : 'barely more than a slap'}`
        + `${settings.pingPong ? ', and it alternates across the stereo field' : ''}.`,
    ];

    // The repeats and then the transport, where the tier asks about them.
    // What each one is rather than how much of it: the amount is the thing
    // being matched, and a hint that gave it away would leave nothing to do.
    // Hints are taken one at a time by whoever wants one, so a longer ladder
    // costs the people who do not ask nothing.
    if (this.tiers[tier]?.smear) said.push(smearWords(settings));
    if (this.tiers[tier]?.wander) said.push(wanderWords(settings));
    return said;
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
    const smear = settings.diffusion > 0
      ? `, ${Math.round(settings.diffusion * 100)}% smeared`
      : '';
    const wander = settings.wow > 0 || settings.flutter > 0
      ? `, ${[settings.wow > 0 ? `${Math.round(settings.wow)} cents of wow` : null,
        settings.flutter > 0 ? `${Math.round(settings.flutter)} of flutter` : null]
        .filter(Boolean).join(' and ')}`
      : '';
    return {
      symbol: near && near.off < 0.02 ? near.division.label : writeMs(settings.time),
      name: `${writeMs(settings.time)}, ${Math.round(settings.feedback * 100)}% back`
          + `${settings.pingPong ? ', ping-pong' : ''}${smear}${wander}`,
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

    // Three buckets over what a target is actually drawn from, which is 0.12
    // to 0.24 or 0.5 to 0.7 - not over what the knob can reach. The knob goes
    // to 1.2 so that a delay can be made to howl, and a bucket keyed to a
    // fraction of that top would have been a bucket nothing ever landed in.
    const feedback = answer?.feedback ?? ECHO_DEFAULTS.feedback;
    const how = feedback >= 0.6 ? 'long feedback'
      : feedback >= 0.35 ? 'working feedback' : 'short delays';
    return { key: how, label: how };
  },
};
