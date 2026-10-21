import { curveReading, writeHz } from '../eq/filters.js';
import { distance } from '../gap.js';
import { HIT, NEAR, MISS, onScale, logPick, toStep, toThirdOctave, pick } from './scoring.js';

/**
 * What you do with an EQ, as opposed to what an EQ is.
 *
 * The other half of what used to be one mode file. An exercise here knows
 * about answers, tolerances and what counts as close; it knows nothing about
 * canvases, and it never mounts anything. Setting a tool up is
 * `src/bench/session.js`'s job, and what it needs is the four small functions
 * at the top of each exercise - where the material comes from, what is on the
 * other side of the A/B, what fault is in the sample, and what the answer is.
 */

const writeDb = (db) => `${db > 0 ? '+' : ''}${db.toFixed(1).replace(/\.0$/, '')} dB`;

/** Where things go wrong, and what an engineer calls it when they do. */
const TROUBLE = [
  { low: 150, high: 400, name: 'mud' },
  { low: 400, high: 900, name: 'boxiness' },
  { low: 1200, high: 2500, name: 'honk' },
  { low: 3000, high: 6500, name: 'harshness' },
];

/**
 * How far the two curves may part company, at their worst point, and still
 * count as matched.
 *
 * The worst point rather than the average: averaged across the spectrum, a
 * single band is a small part of a wide range, so doing nothing at all scored
 * about two decibels and very nearly passed. What "matched" means to anyone
 * looking at two curves is that they sit on each other everywhere, which is
 * exactly what the largest gap between them measures.
 */
const CLOSE_ENOUGH = { easy: 2.5, medium: 1.8, hard: 1.2 };

/* --- the drill ------------------------------------------------------------ */

/**
 * The octaves a move is audible in, on the bed this app plays.
 *
 * Measured: the bed was rendered offline and read at the ten octave centres
 * from 31.5 Hz to 16 kHz, then rendered again through a +9 dB octave-wide
 * boost at each one. Relative to its loudest octave (125 Hz) the bed holds
 * -1.5 dB at 63, -1.1 at 250, -2.6 at 500, -11.1 at 1k, -17.1 at 2k, -21.1 at
 * 4k, -24.8 at 8k - and -20.1 at 31.5 Hz and -32.7 at 16 kHz. Those two ends
 * are not here. There is nothing to hear at 31.5 Hz on most speakers and
 * almost nothing in the bed at 16 kHz: the same +9 dB lifts its own octave by
 * 6.3 and 4.3 dB there against 6.1-7.3 dB everywhere else, and a drill whose
 * answer you cannot hear is a coin toss wearing a chip.
 *
 * The names are what an engineer reaches for when they say where a problem
 * is, which is the vocabulary this is teaching as much as the frequency.
 */
const OCTAVES = [
  { id: '63', hz: 63, symbol: '63', name: 'weight' },
  { id: '125', hz: 125, symbol: '125', name: 'bass' },
  { id: '250', hz: 250, symbol: '250', name: 'mud' },
  { id: '500', hz: 500, symbol: '500', name: 'boxy' },
  { id: '1k', hz: 1000, symbol: '1k', name: 'nasal' },
  { id: '2k', hz: 2000, symbol: '2k', name: 'honk' },
  { id: '4k', hz: 4000, symbol: '4k', name: 'presence' },
  { id: '8k', hz: 8000, symbol: '8k', name: 'air' },
];

const octaveAt = (id) => OCTAVES.findIndex((octave) => octave.id === id);

/**
 * How big the move is, which octaves are on offer, and how wide "close" is.
 *
 * Measured, on the same renders. An octave-wide move of 9 dB lifts its own
 * octave of the bed by 6.1-7.3 dB, 6 dB lifts it by 4.1-4.9, and 4 dB by
 * 2.7-3.2 - and a cut of the same size takes very nearly the same amount out.
 * Three decibels in one octave of a mix is a move anybody working on a record
 * makes and hears, which is what the hard tier asks you to name.
 *
 * `near` is the interesting one. The same renders say what a neighbour gets:
 * a move at one octave shows up in the octave next door at about a third of
 * its size (1.3-3.2 dB of a 9 dB move) and two octaves away at a tenth or
 * less (0.6 dB or under). So next door really is a near miss - you heard the
 * move, in roughly the right place - and two along is not.
 *
 * Which is also why the easy tier scores exact or nothing. Its four octaves
 * are two apart, so the chip beside the right one is the one that shares 0.6
 * dB with it: calling that "close" would be telling somebody they very nearly
 * heard it when what they heard was somewhere else.
 */
const DRILL = {
  easy: { gain: 9, octaves: ['63', '250', '1k', '4k'], near: 0 },
  medium: { gain: 6, octaves: OCTAVES.map((o) => o.id), near: 1 },
  hard: { gain: 4, octaves: OCTAVES.map((o) => o.id), near: 1 },
};

/** One octave wide, which is the Q every number above was measured at. */
const OCTAVE_Q = 1.41;

const MOVES = [
  { id: 'boost', symbol: 'Boost', name: 'louder there' },
  { id: 'cut', symbol: 'Cut', name: 'quieter there' },
];

/**
 * The two exercises, in the shape a session can set up.
 *
 * This is the descriptor that used to be spelled out inside `mount` - the
 * source, the A/B's name, the fault and the target - and having it as data is
 * what lets one tool be handed from one exercise to the next without being
 * destroyed in between.
 */
export const EQ_EXERCISES = {
  match: {
    id: 'match',
    label: 'Match the target',
    source: 'mix',
    other: 'Target',
    faultOf: () => null,
    targetOf: (puzzle) => puzzle.answer,
    answerOf: (puzzle) => puzzle.answer,
  },
  fix: {
    id: 'fix',
    label: 'Fix the sample',
    source: 'mix',
    // In the fix exercise there is no target to hear: the other side of the
    // A/B is the sample with your EQ out of the way, which is a bypass button.
    other: 'Bypass',
    faultOf: (puzzle) => puzzle.fault,
    targetOf: () => [],
    answerOf: (puzzle) => [{ ...puzzle.fault, gain: -puzzle.fault.gain }],
  },
  drill: {
    id: 'drill',
    label: 'Name the move',
    // What `drill` means to the shell: the question is answered with chips
    // rather than on the tool, so the tool is put away while it is asked. It
    // has to be - the analyser would be showing the answer as a bump.
    drill: true,
    ask: 'One octave has been moved. Which one, and which way?',
    lede: 'Nothing to dial here. One octave of this mix has been moved up or '
        + 'down; listen, and say which one and which way.',
    opening: 'Play it, listen for what stands out, then name the octave.',
    // What a tier means here is not what it means to the tool: not how many
    // bands you have to build, but which octaves are on offer and how big the
    // move is. See DRILL above for where the numbers came from.
    tierBlurbs: {
      easy: 'Four octaves, two apart, 9 dB',
      medium: 'All eight octaves, 6 dB',
      hard: 'All eight octaves, 4 dB',
    },
    source: 'mix',
    other: 'Clean',
    faultOf: (puzzle) => puzzle.fault,
    targetOf: () => [],
    // Nothing to draw: there is no curve in the answer, and the tool is not
    // on screen to draw it on.
    answerOf: () => null,
  },
};

/**
 * Name the octave, name the direction.
 *
 * Two readings for two chips, and a third that is the point of the exercise:
 * how far off, in octaves, said in octaves. "Two octaves low" is a correction
 * somebody can take to the next round; "wrong" is not.
 *
 * `onScale` over the octaves on offer, with the tier saying how wide close
 * is - see DRILL above for what was measured to set it.
 */
function scoreDrill(state, puzzle) {
  const { answer, tier } = puzzle;
  const spec = DRILL[tier] ?? DRILL.medium;
  const offered = OCTAVES.filter((octave) => spec.octaves.includes(octave.id));

  const guessedAt = offered.findIndex((octave) => octave.id === state.band);
  const answerAt = offered.findIndex((octave) => octave.id === answer.band);
  const band = onScale(guessedAt, answerAt, { near: spec.near });
  const right = state.move === answer.move;

  // In octaves of the real spectrum, not in chips: at the easy tier the chips
  // are two octaves apart, and "1 chip out" would be a number about the
  // picker rather than about what was played.
  const steps = octaveAt(state.band) - octaveAt(answer.band);
  const away = Math.abs(steps);

  const guessed = OCTAVES[octaveAt(state.band)];
  const correct = band === HIT && right;

  return {
    correct,
    cells: [
      { state: band, text: `${guessed.symbol} · ${guessed.name}` },
      { state: right ? HIT : MISS, text: state.move === 'boost' ? 'Boost' : 'Cut' },
      {
        state: correct ? HIT : band === HIT ? NEAR : band,
        text: away === 0
          ? (right ? 'that is it' : 'right octave, wrong way')
          : `${away} ${away === 1 ? 'octave' : 'octaves'} ${steps > 0 ? 'high' : 'low'}`,
        narrow: true,
      },
    ],
    why: [
      {
        label: 'How far off',
        value: away === 0 ? 'the right octave' : `${away} ${away === 1 ? 'octave' : 'octaves'}`,
        how: 'Counted on the eight octave centres from 63 Hz to 8 kHz, not on the '
           + 'chips - at the easy tier the chips are two octaves apart.',
      },
      {
        label: 'Close is',
        value: spec.near === 0 ? 'the right octave, and nothing else' : 'one octave either way',
        how: 'The bed was rendered through a move at each octave and read back. A '
           + 'move shows up in the octave next door at about a third of its size '
           + 'and two octaves away at a tenth or less - so next door is somebody '
           + 'who heard it in roughly the right place, and two along is not. The '
           + 'easy tier offers octaves two apart, so it has no next door.',
      },
      {
        label: 'The move',
        value: `${Math.abs(puzzle.fault.gain)} dB, one octave wide`,
        how: 'Measured on this bed: 9 dB lifts its own octave by 6.1-7.3 dB, 6 dB '
           + 'by 4.1-4.9, and 4 dB by 2.7-3.2.',
      },
    ],
  };
}

export const EQ_WORK = {
  tool: 'eq',
  opening: 'Play the loop, shape the EQ, then lock it in.',

  settings: [
    {
      id: 'exercise',
      label: 'Exercise',
      options: Object.values(EQ_EXERCISES).map(({ id, label }) => ({ id, label })),
    },
  ],

  exercises: EQ_EXERCISES,

  tiers: {
    easy: { label: 'Easy', blurb: 'One band, and a big move', guesses: 4, bands: 1, size: [7, 11] },
    medium: { label: 'Medium', blurb: 'Two bands', guesses: 4, bands: 2, size: [4, 8] },
    hard: { label: 'Hard', blurb: 'Three bands, and subtle', guesses: 4, bands: 3, size: [2.5, 5] },
  },

  /**
   * An exercise is answered on the tool, so it asks for nothing here. The
   * drill is the exception: it is a listening question, and it is answered
   * by naming what you heard.
   */
  slots(tier, settings) {
    if (settings?.exercise !== 'drill') return [];

    const spec = DRILL[tier] ?? DRILL.medium;
    return [
      {
        id: 'band',
        kind: 'choice',
        label: 'Which octave',
        options: OCTAVES.filter((octave) => spec.octaves.includes(octave.id)),
      },
      {
        id: 'move',
        kind: 'choice',
        label: 'Which way',
        options: MOVES,
      },
    ];
  },

  makePuzzle(rng, tier, settings) {
    const spec = this.tiers[tier];
    const size = () => toStep(spec.size[0] + rng() * (spec.size[1] - spec.size[0]), 0.5);

    if (settings.exercise === 'drill') {
      const drill = DRILL[tier] ?? DRILL.medium;
      const octave = pick(rng, OCTAVES.filter((o) => drill.octaves.includes(o.id)));
      const move = pick(rng, MOVES);
      const gain = move.id === 'cut' ? -drill.gain : drill.gain;

      return {
        // The move is baked into the sample rather than set on the EQ: what
        // you are being asked to hear is a mix with something wrong with it,
        // not a plugin with something on it.
        fault: { type: 'peaking', frequency: octave.hz, gain, q: OCTAVE_Q, on: true },
        answer: { band: octave.id, move: move.id },
      };
    }

    if (settings.exercise === 'fix') {
      // The sample has a resonance in it. The answer is its inverse, which is
      // what taking a problem out of a track actually is.
      const zone = pick(rng, TROUBLE);
      const frequency = toThirdOctave(logPick(rng, zone.low, zone.high));
      const q = toStep(logPick(rng, 1.5, 5), 0.1);
      const gain = size();

      return {
        fault: { type: 'peaking', frequency, gain, q, on: true, name: zone.name },
        answer: [{ type: 'peaking', frequency, gain: -gain, q, on: true }],
      };
    }

    // A move of one to three bands, spread out so they are separately audible
    // rather than piling up in one place.
    const zones = [[60, 300], [300, 1800], [1800, 12000]];
    const answer = [];
    for (let i = 0; i < spec.bands; i += 1) {
      const [low, high] = zones[i % zones.length];
      answer.push({
        type: 'peaking',
        frequency: toThirdOctave(logPick(rng, low, high)),
        gain: (rng() < 0.5 ? -1 : 1) * size(),
        q: toStep(logPick(rng, 0.8, 3), 0.1),
        on: true,
      });
    }

    return { answer };
  },

  /**
   * How close the curve you built is to the one being asked for.
   *
   * The curve, not the settings. Two different sets of bands can make the same
   * shape - a wide cut here is a pair of narrow ones there - and an EQ that
   * marked you down for arriving by a different route would be teaching the
   * plugin rather than the ear. What is compared is what comes out.
   */
  score(state, puzzle) {
    if (puzzle.settings?.exercise === 'drill') return scoreDrill(state, puzzle);

    const { answer, tier } = puzzle;
    const rate = 48000;
    // Readings rather than bare curves. The EQ cached nothing at all before
    // this - `curveOf` ran three times a frame on the display and twice more
    // here, which is five answers to one question with nothing saying they
    // agree. Now the plugin and the scorer ask the same way.
    const gap = distance(curveReading(state, rate), curveReading(answer, rate));
    const worst = gap.detail.louder;
    const worstAt = gap.detail.hz;

    const error = gap.off;
    const close = CLOSE_ENOUGH[tier];
    const mark = error <= close ? HIT : error <= close * 2.5 ? NEAR : MISS;

    return {
      correct: error <= close,
      error,
      cells: [
        { state: mark, text: `${error.toFixed(1)} dB out` },
        {
          state: mark,
          text: error <= close
            ? 'sits on it'
            : `${writeHz(worstAt)} ${worst > 0 ? 'too hot' : 'too shy'}`,
        },
      ],
      why: [
        {
          label: 'Worst point',
          value: `${error.toFixed(2)} dB, at ${writeHz(worstAt)}`,
          how: 'Both sets of bands are turned into a curve and read at 96 '
             + 'frequencies from 30 Hz to 16 kHz, spaced the way the ear hears '
             + 'them. This is the largest gap between the two, and where it is.',
        },
        {
          label: 'Which way',
          value: worst > 0 ? 'yours is louder there' : 'yours is quieter there',
          how: 'The sign of that same gap. It is the direction to move the band '
             + 'nearest that frequency, not necessarily the one you last touched.',
        },
        {
          label: 'Matched at',
          value: `${close.toFixed(1)} dB or less`,
          how: 'The worst point rather than the average, because averaged across '
             + 'the whole spectrum one band is a small part of a wide range - '
             + 'doing nothing at all measured about two decibels and very nearly '
             + 'passed. Two curves that sit on each other everywhere is what '
             + 'anybody looking at them would call matched.',
        },
      ],
    };
  },

  /**
   * The way out, in two rungs, worked out from the answer.
   *
   * The first says what kind of move it is, which is the thing people get
   * wrong first: hunting for a cut with a boost. The second narrows it to a
   * region - not a frequency, because being handed the frequency is the
   * reveal, and that has its own button.
   */
  hints(puzzle) {
    if (puzzle.settings?.exercise === 'drill') {
      // Three rungs, each one a third of the way to the answer: which way,
      // then which third of the spectrum, then the word an engineer would
      // use for it - which is as close as a hint gets before it is the
      // reveal, and that has its own button.
      const octave = OCTAVES[octaveAt(puzzle.answer.band)];
      const boost = puzzle.answer.move === 'boost';
      const third = octave.hz < 250 ? 'down at the bottom, under 250 Hz'
        : octave.hz < 2000 ? 'somewhere in the middle, between 250 Hz and 1 kHz'
        : 'up in the top, at 2 kHz or above';

      return [
        `It is a ${boost ? 'boost' : 'cut'}: something is ${boost ? 'louder' : 'quieter'} `
          + 'in one octave than it should be.',
        `The octave it is in sits ${third}.`,
        `An engineer hearing that region would call it ${octave.name}.`,
      ];
    }

    const { answer } = puzzle;
    const bands = puzzle?.fault
      ? [{ ...puzzle.fault, gain: -puzzle.fault.gain }]
      : answer;

    const cuts = bands.filter((band) => band.gain < 0).length;
    const kind = cuts === bands.length ? 'every one of them is a cut'
      : cuts === 0 ? 'every one of them is a boost'
      : `${cuts} of them ${cuts === 1 ? 'is a cut' : 'are cuts'}`;

    const where = bands
      .map((band) => {
        const f = band.frequency;
        return f < 120 ? 'down in the bass' : f < 400 ? 'in the low mids'
          : f < 1200 ? 'in the middle' : f < 4000 ? 'in the upper mids'
          : 'up in the top';
      })
      .filter((zone, i, all) => all.indexOf(zone) === i);

    const biggest = bands.reduce((a, b) => (Math.abs(b.gain) > Math.abs(a.gain) ? b : a));

    return [
      `${bands.length === 1 ? 'It is one band' : `It is ${bands.length} bands`}, and ${kind}.`,
      `The move is ${where.join(', and ')}.`,
      `The biggest of them is about ${Math.abs(biggest.gain).toFixed(0)} dB, `
        + `and ${biggest.q < 1.2 ? 'wide' : biggest.q < 3 ? 'fairly narrow' : 'very narrow'}.`,
    ];
  },
  reveal(puzzle) {
    if (puzzle.settings?.exercise === 'drill') {
      const octave = OCTAVES[octaveAt(puzzle.answer.band)];
      return {
        symbol: `${octave.symbol} Hz`.replace('k Hz', ' kHz'),
        name: `${puzzle.answer.move === 'boost' ? 'boosted' : 'cut'} by `
          + `${Math.abs(puzzle.fault.gain)} dB, the ${octave.name} octave`,
      };
    }

    const { answer } = puzzle;
    const bands = puzzle?.fault
      ? [{ ...puzzle.fault, gain: -puzzle.fault.gain }]
      : answer;

    return {
      symbol: bands.map((band) => writeHz(band.frequency)).join(' · '),
      name: bands.map((band) => `${writeDb(band.gain)} at Q ${band.q.toFixed(1)}`).join(', '),
    };
  },

  /**
   * What a guess says it heard, in the same words `weak` uses for what was
   * played - so the two can be compared and the stats can say "you keep
   * hearing 2k as 4k".
   */
  heard(guess, puzzle) {
    if (puzzle.settings?.exercise !== 'drill') return null;
    const octave = OCTAVES[octaveAt(guess.band)];
    if (!octave) return null;
    return { key: `octave-${octave.id}`, label: `${octave.symbol} (${octave.name})` };
  },

  weak(puzzle) {
    if (puzzle.settings?.exercise === 'drill') {
      const octave = OCTAVES[octaveAt(puzzle.answer.band)];
      return { key: `octave-${octave.id}`, label: `${octave.symbol} (${octave.name})` };
    }

    const { answer } = puzzle;
    const band = puzzle?.fault ?? answer[0];
    const zone = TROUBLE.find((t) => band.frequency >= t.low && band.frequency < t.high);
    return { key: zone ? zone.name : writeHz(band.frequency), label: zone ? zone.name : writeHz(band.frequency) };
  },
};
