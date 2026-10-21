import {
  HEAT_DEFAULTS, HEAT_FLOOR, MOST_TONE, MOST_HARDNESS,
  harmonicsReading,
} from '../heat/shape.js';
import { distance } from '../gap.js';
import { HIT, NEAR, MISS, onScale, toStep, pick } from './scoring.js';

/**
 * The harmonics a thing makes when you push it.
 *
 * The last of the production modes, and the only one about a sound that was
 * not there before. Everything else in this app moves energy around: an EQ
 * lifts a band that already existed, a compressor turns a moment down, a
 * reverb puts copies of it in a room. A saturator adds frequencies that were
 * never in the recording, and the whole subject is which ones.
 *
 * The ear skill is one distinction, and it is worth more than any amount of
 * knob knowledge: even harmonics against odd. Even ones are octaves and
 * their neighbours, and they sound like the note getting larger. Odd ones
 * are fifths and their neighbours, and they sound like the note breaking.
 * Warm and dirty are not vague words - they are those two piles of numbers,
 * and the third exercise is nothing but learning to tell them apart.
 *
 * Marking is arithmetic on the settings rather than a measurement of the
 * loop, which no other production mode here can say. Harmonics are only
 * harmonics of something, so the reading is taken off a sine - and what a
 * curve does to a sine is a complete description of what it does to
 * anything. Two sets of settings that make the same series are the same
 * answer, whatever route they took.
 */


/** How far off the amount of saturation may be, in decibels of distortion. */
const AMOUNT_CLOSE = { easy: 2.6, medium: 1.6, hard: 1.0 };

/** And how far off any one harmonic may be, when the whole colour is marked. */
const COLOUR_CLOSE = { easy: 6.0, medium: 4.0, hard: 2.6 };

/** How near the asked-for even level counts, and how far ahead of the odd. */
const EVEN_CLOSE = { easy: 4.0, medium: 2.5, hard: 1.6 };
const EVEN_LEAD = { easy: 3, medium: 5, hard: 7 };

const writeEven = (db) => `${db >= 0 ? '+' : ''}${db.toFixed(1)} dB`;


/* --- the drill ------------------------------------------------------------ */

/**
 * The one distinction worth more than any amount of knob knowledge.
 *
 * Even harmonics are octaves and their neighbours, and they sound like the
 * note getting larger. Odd ones are fifths and their neighbours, and they
 * sound like it breaking. Warm and dirty are not vague words: they are those
 * two piles of numbers, and this is the drill that is nothing but telling
 * them apart.
 */
const COLOURS = [
  { id: 'even', symbol: 'Even', name: 'warm, like octaves' },
  { id: 'odd', symbol: 'Odd', name: 'dirty, like fifths' },
];

/** And how hard it is being pushed, which is a separate question. */
const AMOUNTS = [
  { id: 'light', symbol: 'A touch', name: 'barely there' },
  { id: 'pushed', symbol: 'Pushed', name: 'plainly on' },
  { id: 'heavy', symbol: 'Heavy', name: 'no hiding it' },
];

const colourAt = (id) => COLOURS.findIndex((c) => c.id === id);
const amountAt = (id) => AMOUNTS.findIndex((a) => a.id === id);

/**
 * The settings behind each of the six, and why these six.
 *
 * Measured on the sine probe this tool marks everything with, at 48 kHz. The
 * two questions have to be independent or the drill answers itself - if the
 * even rounds were all quiet and the odd ones all loud, anybody would be
 * naming the colour off the volume. So the amount is matched across the
 * colours and the colour is unmistakable within each amount:
 *
 *   even  a touch  THD -21.3 dB   even harmonics lead the odd by 14.3 dB
 *   even  pushed   THD -17.0 dB   lead 14.3 dB
 *   even  heavy    THD -13.4 dB   lead  8.1 dB
 *   odd   a touch  THD -22.6 dB   no even harmonics at all (-273 dB)
 *   odd   pushed   THD -16.9 dB   no even harmonics at all
 *   odd   heavy    THD -13.8 dB   no even harmonics at all
 *
 * The amounts are about four decibels of distortion apart and match across
 * the two colours to within 1.3 dB. The odd side is a symmetric curve, which
 * makes no even harmonics whatsoever - not "few", none - and the even side
 * leads by at least eight decibels even where the drive is highest and the
 * odd ones are catching up fastest.
 *
 * `mix` is what reaches the quiet amounts while keeping the lead: pulling the
 * saturated signal back against the dry one lowers the whole series together,
 * where backing the drive off would change the colour as well.
 */
const HEAT_DRILL_SETTINGS = {
  'even:light': { bias: 0.7, drive: 8, hardness: 2.5, mix: 0.35 },
  'even:pushed': { bias: 0.7, drive: 8, hardness: 2.5, mix: 0.7 },
  'even:heavy': { bias: 0.7, drive: 12, hardness: 2.5, mix: 1 },
  'odd:light': { bias: 0, drive: 12, hardness: 2.5, mix: 0.35 },
  'odd:pushed': { bias: 0, drive: 14, hardness: 2.5, mix: 0.7 },
  'odd:heavy': { bias: 0, drive: 16, hardness: 2.5, mix: 1 },
};

/**
 * Which amounts each tier offers, and how wide close is.
 *
 * Easy leaves the middle one out, so the two on offer are about nine
 * decibels of distortion apart rather than four. The colour is never a near
 * miss at any tier: even and odd are two kinds, not two points on a scale,
 * and there is no such thing as nearly warm.
 */
const HEAT_DRILL = {
  easy: { amounts: ['light', 'heavy'], near: 0 },
  medium: { amounts: AMOUNTS.map((a) => a.id), near: 1 },
  hard: { amounts: AMOUNTS.map((a) => a.id), near: 0 },
};

/**
 * The three exercises, in the shape a session can set up.
 *
 * In "even, not odd" there is nothing on the other side of the A/B but the
 * loop clean, because the question is how much warmth you have added rather
 * than how close you are to somebody else's.
 */
export const HEAT_EXERCISES = {
  amount: {
    id: 'amount',
    label: 'How much',
    source: 'mix',
    other: 'Target',
    faultOf: () => null,
    targetOf: (puzzle) => puzzle.answer,
  },
  match: {
    id: 'match',
    label: 'Match the colour',
    source: 'mix',
    other: 'Target',
    faultOf: () => null,
    targetOf: (puzzle) => puzzle.answer,
  },
  even: {
    id: 'even',
    label: 'Even, not odd',
    source: 'instrument',
    other: 'Clean',
    faultOf: () => null,
    targetOf: () => ({ ...HEAT_DEFAULTS }),
  },
  drill: {
    id: 'drill',
    label: 'Warm or dirty?',
    drill: true,
    ask: 'Is this warm or is it dirty, and how hard is it being pushed?',
    lede: 'Nothing to dial here. Something is being driven: say whether what it '
        + 'is making is octaves or fifths, and how much of it there is.',
    opening: 'Play it against the clean side. Larger, or breaking?',
    tierBlurbs: {
      easy: 'Two amounts, nine decibels apart',
      medium: 'Three amounts, a step forgiven',
      hard: 'Three amounts, exact',
    },
    // A sustained instrument rather than the mix: harmonics are harmonics of
    // something, and a note is something to hear them on.
    source: 'instrument',
    other: 'Clean',
    faultOf: () => null,
    targetOf: () => ({ ...HEAT_DEFAULTS }),

    startOf: (puzzle) => ({ ...HEAT_DEFAULTS, ...HEAT_DRILL_SETTINGS[keyOf(puzzle.answer)] }),
    cleanOf: () => ({ ...HEAT_DEFAULTS, mix: 0 }),
    restores: true,
  },
};

const keyOf = (answer) => `${answer.colour}:${answer.amount}`;

/**
 * Name the colour, name the amount.
 *
 * Three readings for two chips. The colour is exact or nothing - even and odd
 * are two kinds and there is no such thing as nearly warm - and the amount is
 * a scale, so being one step out on it is being one step out.
 */
function scoreColour(state, puzzle) {
  const { answer, tier } = puzzle;
  const spec = HEAT_DRILL[tier] ?? HEAT_DRILL.medium;
  const offered = AMOUNTS.filter((a) => spec.amounts.includes(a.id));

  const right = state.colour === answer.colour;
  const amount = onScale(
    offered.findIndex((a) => a.id === state.amount),
    offered.findIndex((a) => a.id === answer.amount),
    { near: spec.near },
  );

  const guessedColour = COLOURS[colourAt(state.colour)];
  const guessedAmount = AMOUNTS[amountAt(state.amount)];
  const steps = amountAt(state.amount) - amountAt(answer.amount);
  const correct = right && amount === HIT;

  return {
    correct,
    cells: [
      { state: right ? HIT : MISS, text: guessedColour.symbol },
      { state: amount, text: guessedAmount.symbol },
      {
        state: correct ? HIT : right ? NEAR : MISS,
        text: !right ? (answer.colour === 'even' ? 'it was octaves' : 'it was fifths')
          : steps === 0 ? 'that is it'
          : `${Math.abs(steps)} step${Math.abs(steps) === 1 ? '' : 's'} too ${steps > 0 ? 'much' : 'little'}`,
        narrow: true,
      },
    ],
    why: [
      {
        label: 'Which harmonics',
        value: answer.colour === 'even' ? 'even - octaves above' : 'odd - fifths above',
        how: 'Measured on the sine this tool marks everything with. The odd side '
           + 'is a symmetric curve, which makes no even harmonics at all - not '
           + 'few, none, 273 dB down. The even side leads the odd by at least '
           + '8 dB and usually 14.',
      },
      {
        label: 'How hard',
        value: `${AMOUNTS[amountAt(answer.amount)].symbol.toLowerCase()}`,
        how: 'Total harmonic distortion, about four decibels a step: -21, -17 '
           + 'and -13 dB. The easy tier leaves the middle one out, so its two '
           + 'are nine decibels apart.',
      },
      {
        label: 'Why they are separate questions',
        value: 'the amounts match across the colours',
        how: 'Within 1.3 dB. If the warm rounds were all quiet and the dirty '
           + 'ones all loud, anybody would be naming the colour off the volume '
           + 'and learning nothing - so the mix is pulled back rather than the '
           + 'drive, which lowers the whole series without changing its shape.',
      },
    ],
  };
}

export const HEAT_WORK = {
  tool: 'saturation',
  opening: 'Play the loop, drive it, then lock it in.',

  settings: [
    {
      id: 'exercise',
      label: 'Exercise',
      options: Object.values(HEAT_EXERCISES).map(({ id, label }) => ({ id, label })),
    },
  ],

  exercises: HEAT_EXERCISES,

  tiers: {
    easy: { label: 'Easy', blurb: 'Drive and bias', guesses: 3, knobs: 2 },
    medium: { label: 'Medium', blurb: 'And the hardness', guesses: 4, knobs: 3 },
    hard: { label: 'Hard', blurb: 'The whole curve', guesses: 4, knobs: 5 },
  },

  /** Answered on the plugin, except in the drill, which asks with chips. */
  slots(tier, settings) {
    if (settings?.exercise !== 'drill') return [];

    const spec = HEAT_DRILL[tier] ?? HEAT_DRILL.medium;
    return [
      { id: 'colour', kind: 'choice', label: 'Which harmonics', options: COLOURS },
      {
        id: 'amount',
        kind: 'choice',
        label: 'How hard',
        options: AMOUNTS.filter((a) => spec.amounts.includes(a.id)),
      },
    ];
  },

  makePuzzle(rng, tier, settings) {
    const spec = this.tiers[tier];

    if (settings.exercise === 'drill') {
      const drill = HEAT_DRILL[tier] ?? HEAT_DRILL.medium;
      return {
        answer: {
          colour: pick(rng, COLOURS).id,
          amount: pick(rng, AMOUNTS.filter((a) => drill.amounts.includes(a.id))).id,
        },
      };
    }

    if (settings.exercise === 'even') {
      // How loud the even harmonics have to be. Kept away from both ends:
      // too quiet and doing almost nothing passes, too loud and there is no
      // setting that gets there without the odd ones coming along.
      return { want: toStep(-26 + rng() * 12, 0.5), answer: null };
    }

    if (settings.exercise === 'amount') {
      // Only the drive moves. Enough of it to be plainly audible, never so
      // much that the series has flattened out into a square wave, where
      // another three decibels of drive changes almost nothing.
      return {
        answer: {
          ...HEAT_DEFAULTS,
          drive: toStep(8 + rng() * 14, 0.5),
          bias: 0.45,
          hardness: 2.5,
        },
      };
    }

    // Match the colour: as many of the controls as the tier asks for.
    //
    // Every range here has a floor under it, and the floor is the point. A
    // target nobody can hear is not a puzzle: at the hardest tier the first
    // set of ranges could put a quiet drive, a low tone and a half mix
    // together and produce a setting 37 dB down, which is indistinguishable
    // from leaving the plugin alone - and was, in one round in twenty, a
    // round won by submitting nothing.
    const hardness = spec.knobs >= 3 ? toStep(1 + rng() * (MOST_HARDNESS - 1), 0.05) : HEAT_DEFAULTS.hardness;

    // How much drive it takes before that curve is doing anything, which
    // depends on the curve. A soft one is colouring almost immediately; a
    // hard one is a straight line until it isn't, and at the same drive
    // setting it can be twenty decibels quieter. Measured, and then made the
    // floor - so the drive that follows is always a drive you can hear, and
    // always near enough to the knee that the hardness is audible too.
    const floor = 6 + 1.7 * hardness;

    const answer = {
      ...HEAT_DEFAULTS,
      hardness,
      drive: toStep(floor + rng() * 14, 0.5),
      bias: toStep(rng() < 0.25 ? 0 : 0.2 + rng() * 0.8, 0.05),
    };
    if (spec.knobs >= 5) {
      // The tone control is only worth setting where it has something to do,
      // and the mix only where there is enough drive to be worth pulling back.
      answer.tone = rng() < 0.4
        ? MOST_TONE
        : toStep(1400 * (4000 / 1400) ** rng(), 10);
      answer.mix = answer.drive >= floor + 6 && rng() < 0.6
        ? toStep(0.45 + rng() * 0.45, 0.01)
        : 1;
    }

    return { answer };
  },

  /* ---------- marking ---------- */

  score(state, puzzle) {
    const { answer, tier } = puzzle;
    const guess = state;
    const exercise = puzzle?.settings?.exercise ?? 'amount';
    if (exercise === 'drill') return scoreColour(state, puzzle);

    const rate = puzzle?.rate ?? 48000;
    // Readings, not raw series: the same envelope the plugin hands back, so
    // the number printed here and the number the panel shows are the same
    // measurement rather than two that happen to agree.
    const mine = harmonicsReading(rate, { ...HEAT_DEFAULTS, ...guess, listen: 'out' });

    if (exercise === 'even') return this.scoreEven(mine.values, puzzle, tier);

    const theirs = harmonicsReading(rate, { ...HEAT_DEFAULTS, ...answer, listen: 'out' });
    if (exercise === 'match') return this.scoreColour(mine, theirs, tier);
    return this.scoreAmount(mine.values, theirs.values, tier);
  },

  /** Is it pushed as hard? */
  scoreAmount(mine, theirs, tier) {
    const off = Math.abs(mine.thd - theirs.thd);
    const close = AMOUNT_CLOSE[tier];
    const mark = off <= close ? HIT : off <= close * 2.5 ? NEAR : MISS;

    return {
      correct: off <= close,
      error: off,
      cells: [
        { state: mark, text: `${mine.thd.toFixed(1)} dB of harmonics` },
        {
          state: mark,
          text: off <= close ? 'that is the amount'
            : `${off.toFixed(1)} dB ${mine.thd > theirs.thd ? 'too dirty' : 'too clean'}`,
          narrow: true,
        },
      ],
      why: [
        {
          label: 'Harmonics, yours',
          value: `${mine.thd.toFixed(2)} dB`,
          how: 'Everything the saturator added, against the note it was given. '
             + 'Measured by running a bin-aligned sine through the curve and '
             + 'reading the harmonics that come back - the curve, not the loop, '
             + 'so the reading does not move with the material.',
        },
        {
          label: 'Harmonics, wanted',
          value: `${theirs.thd.toFixed(2)} dB`,
          how: 'The same measurement on the target curve. Compared as a total '
             + 'rather than harmonic by harmonic, because this exercise asks how '
             + 'hard it is pushed, not what colour it is.',
        },
        {
          label: 'Matched at',
          value: `${close.toFixed(1)} dB or less`,
          how: 'Note that the top of the drive range is a poor place to hunt: '
             + 'everything becomes a square wave up there, so a decibel of '
             + 'control costs several decibels of drive.',
        },
      ],
    };
  },

  /** Is it the same colour, harmonic by harmonic? */
  scoreColour(mineRead, theirsRead, tier) {
    const mine = mineRead.values;
    const theirs = theirsRead.values;
    const gap = distance(mineRead, theirsRead);
    const close = COLOUR_CLOSE[tier];
    const mark = gap.off <= close ? HIT : gap.off <= close * 2 ? NEAR : MISS;

    return {
      correct: gap.off <= close,
      error: gap.off,
      cells: [
        { state: mark, text: `${gap.off.toFixed(1)} dB out` },
        {
          state: mark,
          // Which harmonic is worst, because that is what is being read: an
          // average over nine of them says nothing when one is in completely
          // the wrong place and the other eight are right.
          text: gap.off <= close ? 'that is the colour'
            : `${Math.abs(gap.detail.louder).toFixed(1)} dB too `
              + `${gap.detail.louder > 0 ? 'much' : 'little'} ${gap.where}`,
        },
      ],
      why: [
        {
          label: 'Worst harmonic',
          value: gap.where === null ? 'none of them stands out'
               : `the ${gap.where}, ${gap.off.toFixed(2)} dB out`,
          how: 'The harmonics are read one by one up to the tenth, and this is '
             + 'the one furthest from the target. The worst rather than the '
             + 'average, because an average over nine says nothing when one is in '
             + 'completely the wrong place and the other eight are right. '
             + 'Harmonics that would be buried under their neighbours in either '
             + 'curve are left out of the comparison.',
        },
        {
          label: 'Even against odd',
          value: `${mine.even.toFixed(1)} even, ${mine.odd.toFixed(1)} odd`,
          how: 'Even harmonics are octaves and fifths of what went in, and read '
             + 'as warmth. Odd ones are the ones that read as grit. Bias is what '
             + 'moves the balance between them; drive mostly moves both.',
        },
        {
          label: 'Total',
          value: `${mine.thd.toFixed(1)} dB, target ${theirs.thd.toFixed(1)}`,
          how: 'How hard it is pushed overall. Getting this right and the colour '
             + 'wrong is the usual shape of a near miss here.',
        },
      ],
    };
  },

  /**
   * Is the warmth there, and is it clean?
   *
   * Two readings, because either one alone has a wrong answer that passes.
   * Driving it hard gets the even harmonics to any level you like and brings
   * a pile of odd ones with them; doing almost nothing keeps it clean and
   * has no warmth in it at all. Both at once is the exercise, and the only
   * way through is the quiet end of the drive with the bias doing the work.
   */
  scoreEven(mine, puzzle, tier) {
    const want = puzzle?.want ?? -20;
    const off = Math.abs(mine.even - want);
    const lead = mine.even - mine.odd;

    const close = EVEN_CLOSE[tier];
    const wanted = EVEN_LEAD[tier];
    const there = off <= close;
    const clean = lead >= wanted;

    return {
      correct: there && clean,
      error: off,
      cells: [
        {
          state: there && clean ? HIT : there || off <= close * 2 ? NEAR : MISS,
          text: mine.even <= HEAT_FLOOR ? 'no even harmonics at all'
            : there ? 'the warmth is there'
            : `${off.toFixed(1)} dB too ${mine.even > want ? 'much' : 'little'} warmth`,
        },
        {
          state: clean ? (there ? HIT : NEAR) : MISS,
          text: clean
            ? (there ? `and ${lead.toFixed(0)} dB clear of the grit` : 'and it is clean')
            : lead <= 0 ? 'but the odd harmonics are louder'
            : `only ${lead.toFixed(1)} dB clear of the grit`,
        },
      ],
      why: [
        {
          label: 'Even harmonics',
          value: `${mine.even.toFixed(2)} dB, wanted ${want.toFixed(1)}`,
          how: 'The second, fourth, sixth and so on added together. These are '
             + 'octaves and fifths of what went in, which is why they read as '
             + 'warmth rather than as distortion.',
        },
        {
          label: 'Clear of the grit',
          value: `${lead.toFixed(2)} dB, wanted ${wanted} or more`,
          how: 'The even harmonics above the odd ones. Two readings rather than '
             + 'one, because either alone has a wrong answer that passes it: '
             + 'driving it hard gets the even harmonics to any level you like and '
             + 'brings a pile of odd ones with them, and doing almost nothing '
             + 'stays clean with no warmth in it at all.',
        },
        {
          label: 'Odd harmonics',
          value: `${mine.odd.toFixed(2)} dB`,
          how: 'The third, fifth, seventh and so on. The only way through this '
             + 'exercise is the quiet end of the drive with the bias doing the '
             + 'work - asymmetry is what makes even harmonics; hard clipping is '
             + 'what makes odd ones.',
        },
      ],
    };
  },

  hints(puzzle) {
    const { answer, tier } = puzzle;
    const exercise = puzzle?.settings?.exercise ?? 'amount';

    if (exercise === 'drill') {
      const even = answer.colour === 'even';
      const amount = AMOUNTS[amountAt(answer.amount)];
      return [
        'Flip to the clean side and back, and listen to what has been added '
          + 'rather than to the note itself.',
        even
          ? 'What was added sits in octaves with the note, so the note sounds '
            + 'bigger rather than rougher.'
          : 'What was added sits a fifth and a third above, which is a chord '
            + 'the note did not ask for - it sounds like something giving way.',
        `There is ${amount.name === 'barely there' ? 'not much of it' : `quite a lot of it - ${amount.name}`}.`,
      ];
    }

    if (exercise === 'even') {
      return [
        'You will not get there by driving it harder: past a point the odd '
          + 'harmonics come up faster than the even ones, and both readings have '
          + 'to be right at once.',
        'Quiet drive, plenty of bias. Asymmetry is what makes even harmonics; '
          + 'clipping evenly top and bottom is what makes odd ones.',
      ];
    }

    const settings = { ...HEAT_DEFAULTS, ...answer };
    if (exercise === 'amount') {
      return [
        settings.drive < 6 ? 'It is only just dirty - a decibel or two of drive.'
          : settings.drive < 14 ? 'It is pushed, but not hard: somewhere in the middle.'
          : 'It is driven hard.',
        'Work up from clean rather than down from the top. Everything becomes a '
          + 'square wave up there, so the top of the range is nearly flat and a '
          + 'decibel of reading costs several decibels of drive.',
      ];
    }

    return [
      `The bias is ${settings.bias < 0.15 ? 'near zero, so it is mostly odd harmonics'
        : settings.bias < 0.5 ? 'part way up - some warmth under the grit'
        : 'well up, so the even harmonics lead'}.`,
      `Around ${settings.drive.toFixed(0)} dB of drive, `
        + `${settings.hardness < 1 ? 'soft rather than hard' : 'on the harder side'}`
        + `${settings.mix < 1 ? `, and pulled back to about ${Math.round(settings.mix * 100)}% mix` : ''}.`,
    ];
  },

  reveal(puzzle) {
    const { answer } = puzzle;
    const exercise = puzzle?.settings?.exercise ?? 'amount';

    if (exercise === 'drill') {
      const colour = COLOURS[colourAt(answer.colour)];
      const amount = AMOUNTS[amountAt(answer.amount)];
      return {
        symbol: `${colour.symbol.toLowerCase()} harmonics`,
        name: `${colour.name}, and ${amount.symbol.toLowerCase()} with it`,
      };
    }

    if (exercise === 'even') {
      return {
        symbol: writeEven(puzzle?.want ?? -20),
        name: 'of even harmonics, with the odd ones kept under',
      };
    }

    const settings = { ...HEAT_DEFAULTS, ...answer };

    if (exercise === 'amount') {
      return { symbol: `${settings.drive.toFixed(1)} dB`, name: 'of drive' };
    }

    const parts = [`${settings.drive.toFixed(0)} dB`, `${Math.round(settings.bias * 100)}% bias`];
    if (settings.hardness !== HEAT_DEFAULTS.hardness) parts.push(`hardness ${settings.hardness.toFixed(1)}`);
    if (settings.mix < 1) parts.push(`${Math.round(settings.mix * 100)}% mix`);

    return { symbol: parts.join(' · '), name: '' };
  },

  /** What a guess says it heard, in `weak`'s own words. */
  heard(guess, puzzle) {
    if ((puzzle?.settings?.exercise ?? 'amount') !== 'drill') return null;
    if (colourAt(guess.colour) < 0) return null;
    return { key: `colour-${guess.colour}`, label: `${guess.colour} harmonics` };
  },

  weak(puzzle) {
    const { answer } = puzzle;
    const exercise = puzzle?.settings?.exercise ?? 'amount';
    if (exercise === 'drill') {
      return { key: `colour-${answer.colour}`, label: `${answer.colour} harmonics` };
    }
    if (exercise === 'even') return { key: 'even', label: 'even harmonics' };
    if (exercise === 'match') return { key: 'colour', label: 'harmonic colour' };
    return { key: 'amount', label: 'how much drive' };
  },
};
