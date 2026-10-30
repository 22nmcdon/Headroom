// What you do with a de-esser, and how it is marked.
//
// Two exercises. **Match the target** hands you one and asks you to build it,
// which is the ordinary task. **What is it ducking?** is the one that teaches
// the idea the tool stands for: a detector and the thing it acts on do not
// have to be the same signal, and the difference between ducking a band and
// ducking a record is the whole of what makes this a de-esser rather than a
// compressor with a filtered sidechain.
//
// Both marked on the reduction that came out, on the kind and the axis the
// compressor, the gate and the limiter are marked on.

import { COMP_DEFAULTS } from '../../plugins/compressor/dsp.js';
import { reductionReading } from '../../plugins/compressor/reading.js';
import { DEESS_FACE } from '../../plugins/compressor/aimed.js';
import { distance } from '../../gap.js';
import { HIT, NEAR, MISS, pick, toStep } from './scoring.js';
import { mulberry32 } from '../../lib/random.js';

/**
 * How close a matched de-esser has to be, in decibels of reduction.
 *
 * The scale here is a quarter of the gate's, and that is the tool rather than
 * the marking. A de-esser is down for the eighty-five milliseconds of each
 * sibilant and open the rest of the time, so what it does to a loop as a
 * whole is small even when what it does to an S is not: over sixty rounds
 * the deepest target this mode makes reads 5.84 dB from a de-esser switched
 * off and the shallowest reads 2.15, where the gate's shallowest reads 6.38.
 *
 * Measured against a target listening from 5.5 kHz up, taking 12 dB off at a
 * threshold of -31 - on the probe below, which is calibrated against the
 * rendered loop to within a tenth of a decibel:
 *
 *     mistake                      reads
 *     nothing at all               3.67
 *     threshold 2 dB out           0.69
 *     threshold 4 dB out           1.37
 *     threshold 8 dB out           2.68
 *     release 150 not 60           1.88
 *     crossover an octave up       1.57
 *     range halved                 1.05
 *     attack ten times slower      0.76
 *     crossover 7000 not 5500      0.42
 *     crossover 4000 not 5500      0.33
 *     range 16 not 12              0.00
 *     broadband instead of split   0.00
 *
 * Four of those are findings rather than numbers.
 *
 * The range saturates. Above about 12 dB the detector never asks for more
 * than it is already getting, so 16 dB of range and 12 reads 0.00 - exactly,
 * because the two are the same processor. The targets below stop at 12 for
 * that reason, and the drill's deepest push is 8 for the same one.
 *
 * The crossover is marked weakly, and only in one direction. An octave up
 * reads 1.57 because at 11 kHz the detector has stopped hearing the S at all
 * and the de-esser has stopped working; a step inside the band where the
 * sibilance actually lives reads 0.33 to 0.42, and an octave down reads 0.56.
 * Which is honest: on this axis what is being compared is how much gain was
 * asked for, and two crossovers either side of an S ask for about the same
 * amount. Where the crossover went is the drill's question, not this one -
 * and only the hard tier's tolerance is tight enough to make a step in it
 * count.
 *
 * The split reads 0.00, exactly, because it cannot be otherwise. This reading
 * is the gain the detector asked for, and the split decides where that gain
 * is applied rather than how big it is. That is the drill's question too.
 *
 * The tiers are 0.9, 0.6 and 0.35, and what fixes them is the near band.
 * Two and a half times the tolerance is what every other mode here calls a
 * near miss, and the least a target can read from a de-esser switched off is
 * 2.64 on easy and 2.15 on the other two - so 0.9 is as loose as easy can be
 * before being told "close" is what somebody gets for leaving the tool alone.
 * What that buys: easy forgives two decibels of threshold and a step of
 * crossover, medium forgives the crossover but not the threshold, and hard
 * forgives neither.
 *
 * And the attack now reads 0.76 where it read 0.38 before. The sibilance used
 * to decay from its peak the moment it got there; it holds its level for most
 * of its length now, which is what a fricative does, and ten times the attack
 * misses measurably more of it. See `syllable` in `core/audio.js`.
 */
const ESS_CLOSE = { easy: 0.9, medium: 0.6, hard: 0.35 };

/**
 * What the drill asks about: where the reduction went.
 *
 * Three, and the third is the control the face exists to put a switch on. A
 * de-esser ducking the whole signal is audible as the voice lurching under
 * every syllable; one ducking the band is audible as the sibilance going
 * away and nothing else; and one doing nothing is the bypass.
 */
const ESS_AIMS = [
  { id: 'none', label: 'Nothing at all', symbol: 'nothing' },
  { id: 'band', label: 'The sibilance', symbol: 'the band' },
  { id: 'whole', label: 'The whole voice', symbol: 'the whole voice' },
];

/**
 * How much the drill takes off, per tier, in decibels at its deepest.
 *
 * Not 12, 8 and 5, which is where these started. Measured on the voice, 8 dB
 * of range and 12 do the same thing - the detector never asks for more than
 * about eight - so two of those tiers were the same round. What the ear has
 * to compare is how far the vowel moves with the S, and that is the number
 * these are set by: measured, against untreated, under a kilohertz comes down
 *
 *     push    broadband    split
 *      3 dB     -0.67      -0.02
 *      5 dB     -1.06      -0.03
 *      8 dB     -1.51      -0.04
 *
 * so easy is where a broadband de-esser is unmistakably dragging the voice
 * down with the sibilance, and hard is where it is only just doing it.
 */
const ESS_PUSH = { easy: 8, medium: 5, hard: 3 };

/**
 * A stand-in for the voice loop, for the times the real thing is not to hand.
 *
 * The same recipe the engine's `syllable` uses, written out as arithmetic: a
 * sawtooth through three formant resonances with a band of noise at seven
 * kilohertz in front of some of them. Scoring is a pure function a test can
 * call without an audio context, and a de-esser scored on material with no
 * sibilance in it would be scored on nothing at all.
 *
 * Calibrated against the rendered loop rather than eyeballed, because the
 * first version of this was not and it mattered. Its formants were two-pole
 * resonators at a Q of about 1.5 where the engine's biquads are set to 6, 8
 * and 9, so it leaked four times as much of the sawtooth into the band a
 * de-esser listens to - and a de-esser scored on it read twice what the same
 * de-esser read on the loop. Tolerances taken from the probe would have
 * accepted a bypass in the app. So the resonators are set by Q now, the
 * levels are set by band, and the two were measured side by side:
 *
 *     energy in the band       loop    probe
 *     under 1 kHz              53.6     55.0
 *     1 to 3 kHz               44.6     41.1
 *     3 to 6 kHz               41.8     41.8
 *     6 to 12 kHz              44.7     43.9
 *     12 to 20 kHz             35.7     38.6
 *     peak                    -16.1    -16.2
 *
 * and what a de-esser does to each of them agrees to within a tenth of a
 * decibel across eighteen settings - 4.95 against 4.89, 3.55 against 3.45,
 * 1.61 against 1.65, and so on down the table.
 *
 * One syllable in four has no ess, which is what makes the material a test
 * rather than a demonstration: a de-esser has to be heard leaving something
 * alone as well as taking something down.
 */
const SIBILANCE = 0.16;
const VOWEL = 0.07;
const ESS_SECONDS = 0.085;

function essProbe(rate, seconds = 5) {
  const n = Math.round(rate * seconds);
  const out = new Float32Array(n);
  const rng = mulberry32(0x5555);

  /**
   * A two-pole resonator at a given Q, which is how the engine's biquads are
   * set. Scaled by 1 - r so the peak comes out near unity instead of near
   * 1/(1 - r), which is where an unscaled one lands and is why the first
   * version of this probe came out as NaN.
   */
  const resonator = (hz, q) => {
    const r = Math.exp((-Math.PI * hz) / (q * rate));
    const w = (2 * Math.PI * hz) / rate;
    const a = 2 * r * Math.cos(w);
    const b = r * r;
    let y1 = 0;
    let y2 = 0;
    return (x) => {
      const y = (1 - r) * x + a * y1 - b * y2;
      y2 = y1;
      y1 = y;
      return y;
    };
  };

  const FORMANTS = [
    { hz: 700, q: 6, gain: 1.0 },
    { hz: 1220, q: 8, gain: 0.5 },
    { hz: 2600, q: 9, gain: 0.22 },
  ];

  const sung = [55, 57, 55, 50];
  // Eight syllables a bar at 96, which is what the bed sings.
  const beat = (60 / 96) / 2;

  for (let k = 0; k * beat < seconds; k += 1) {
    const at = Math.round(k * beat * rate);
    const say = k % sung.length;
    const hz = 440 * 2 ** ((sung[say] - 69) / 12);
    const hissing = say !== 2;

    if (hissing) {
      const ess = resonator(7000, 0.9);
      const length = Math.round(rate * ESS_SECONDS);
      const held = Math.round(rate * ESS_SECONDS * 0.7);
      const rise = Math.round(rate * 0.012);
      for (let i = 0; i < length && at + i < n; i += 1) {
        // Up, held, and away: a fricative holds its level, and a detector
        // reads a held sibilant very differently from a clicked one.
        const env = i < rise ? i / rise
          : i < held ? 1
            : Math.exp(-((i - held) / (length - held)) * 9);
        out[at + i] += ess(rng() * 2 - 1) * SIBILANCE * env;
      }
    }

    // The vowel starts while the ess is still going, which is what a consonant
    // into a vowel does - they overlap rather than queue.
    const from = at + (hissing ? Math.round(rate * ESS_SECONDS * 0.7) : 0);
    const length = Math.round(rate * 0.26);
    const voice = FORMANTS.map((formant) => resonator(formant.hz, formant.q));
    for (let i = 0; i < length && from + i < n; i += 1) {
      const phase = ((from + i) * hz) / rate;
      const saw = 2 * (phase - Math.floor(phase)) - 1;
      const env = Math.min(1, i / (rate * 0.03))
        * (i < length * 0.6 ? 1 : Math.exp(-((i - length * 0.6) / (length * 0.4)) * 9));
      let sum = 0;
      FORMANTS.forEach((formant, f) => { sum += voice[f](saw * env) * formant.gain; });
      out[from + i] += sum * VOWEL;
    }
  }

  return { samples: out, rate };
}

let essProbeKept = null;
const essKeptProbe = () => {
  if (!essProbeKept) essProbeKept = essProbe(48000);
  return essProbeKept;
};

/** What a guess is read against: the pinned loop, or the probe. */
function essMaterial(puzzle) {
  const pinned = puzzle?.material;
  if (Array.isArray(pinned)) return { samples: pinned[0], rate: 48000 };
  if (pinned?.samples) return pinned;
  return essKeptProbe();
}

/**
 * The settings behind one of the three answers.
 *
 * All three take the same amount off at their deepest, so the depth is not
 * the cue - what differs is where it went. Which is the question, and
 * `essDepthFor` is what makes it a fair one.
 */
function essAimSettings(puzzle) {
  const aim = puzzle.answer?.aim ?? 'band';
  const push = ESS_PUSH[puzzle.tier] ?? ESS_PUSH.medium;

  if (aim === 'none') {
    // Nothing at all: the threshold above anything in the material, so the
    // detector never fires. Which is the bypass exactly, and noticing that is
    // the answer.
    return { ...DEESS_FACE.defaults, threshold: 0, range: 0 };
  }

  // The same depth either way - the range is the depth - so what differs
  // between the two is only where the reduction went.
  return { ...DEESS_FACE.defaults, split: aim === 'band', range: push, threshold: -30 };
}

/**
 * Why there is no solve here, where the gate and the limiter both have one.
 *
 * The depth is the `range`, directly. The core clamps the reduction it asks
 * for to the range, so the deepest a de-esser goes is whatever the range is
 * set to, whatever the threshold does - and the threshold decides how much of
 * the time it is down there rather than how far down it goes.
 *
 * That was worth finding out the slow way. The first version of this file
 * solved the threshold for a wanted depth, push-measure-correct like the
 * limiter's, and it returned its starting value every time: the range had
 * already capped the answer before the loop ran. Two controls, one of which
 * is the depth and one of which is not, and the measurement said which.
 */

export const ESS_EXERCISES = {
  match: {
    id: 'match',
    label: 'Match the target',
    source: 'voice',
    other: 'Target',
    faultOf: () => null,
    targetOf: (puzzle) => puzzle.answer,
  },
  drill: {
    id: 'drill',
    label: 'What is it ducking?',
    drill: true,
    ask: 'What is this de-esser ducking?',
    lede: 'Nothing to dial here. Something is taking the same amount off the '
        + 'voice three different ways, and the question is which.',
    opening: 'Play it, flip to the untreated side, then say what is being ducked.',
    tierBlurbs: {
      easy: 'Twelve decibels off, which is hard to miss',
      medium: 'Eight decibels off',
      hard: 'Five decibels off, where the three are closest',
    },
    source: 'voice',
    other: 'Untreated',
    faultOf: () => null,
    targetOf: () => ({ ...DEESS_FACE.defaults }),
    startOf: (puzzle) => essAimSettings(puzzle),
    cleanOf: () => ({ ...DEESS_FACE.defaults, threshold: 0 }),
    restores: true,
  },
};

/** Naming where the reduction went, which is right or it is not. */
function scoreAim(state, puzzle) {
  const { answer } = puzzle;
  const mine = ESS_AIMS.find((a) => a.id === state.aim);
  const wanted = ESS_AIMS.find((a) => a.id === answer.aim) ?? ESS_AIMS[1];
  const right = state.aim === answer.aim;

  return {
    correct: right,
    cells: [
      { state: right ? HIT : MISS, text: mine?.label ?? '—' },
      {
        state: right ? HIT : MISS,
        text: right ? 'that is where it went' : `it was ${wanted.symbol}`,
        narrow: true,
      },
    ],
    why: [
      {
        label: 'Where it went',
        value: wanted.label,
        how: answer.aim === 'none'
          ? 'Nowhere. The threshold sat above everything in the material, so the '
            + 'detector never fired - and hearing that a processor is doing '
            + 'nothing is a skill of its own.'
          : answer.aim === 'band'
            ? 'Into the band above the crossover and nowhere else. The low half '
              + 'of the signal and the high half add back up to the input, so '
              + 'only the high half was ever scaled.'
            : 'Into the whole signal. The detector was still listening to the '
              + 'top, but what it did was pull everything down - which is a '
              + 'compressor with a filtered sidechain and not a de-esser.',
      },
      {
        label: 'How to tell',
        value: 'listen under the esses',
        how: 'All three take the same amount off at their deepest, so the depth '
           + 'is not the cue. What a broadband one does that a split one does '
           + 'not is pull the vowel down with the S - measured on this voice at '
           + 'the deepest this drill pushes, everything under a kilohertz comes '
           + 'down 1.51 dB under a broadband de-esser and 0.04 under a split '
           + 'one, which is the difference between hearing the voice duck and '
           + 'hearing only the sibilance go.',
      },
    ],
  };
}

export const ESS_WORK = {
  tool: 'deess',
  opening: 'Play the voice, work the de-esser, then lock it in.',

  settings: [
    {
      id: 'exercise',
      label: 'Exercise',
      options: Object.values(ESS_EXERCISES).map(({ id, label }) => ({ id, label })),
    },
  ],

  exercises: ESS_EXERCISES,

  tiers: {
    easy: { label: 'Easy', blurb: 'One crossover, one release', guesses: 3 },
    medium: { label: 'Medium', blurb: 'The crossover and the release move', guesses: 4 },
    hard: { label: 'Hard', blurb: 'Tight enough that the crossover counts', guesses: 4 },
  },

  slots(tier, settings) {
    if (settings?.exercise !== 'drill') return [];
    return [{
      id: 'aim',
      kind: 'choice',
      label: 'What it ducks',
      options: ESS_AIMS.map(({ id, label, symbol }) => ({ id, label, symbol })),
    }];
  },

  makePuzzle(rng, tier, settings) {
    if (settings.exercise === 'drill') {
      return { answer: { aim: pick(rng, ESS_AIMS.map((a) => a.id)) } };
    }

    // A target that is doing something to the sibilance and not to the voice,
    // which is a narrower band of settings than it looks.
    //
    // The crossover stays where this material has sibilance. The ess sits at
    // seven kilohertz, so a crossover above it leaves the detector with
    // nothing to hear: measured, a target at 11 kHz reads 1.57 dB from one at
    // 5.5 - most of the way to a de-esser switched off - because it has
    // stopped working rather than because it is aimed somewhere else.
    //
    // The threshold stays low enough that the detector fires on every S.
    // Measured, the same target at -26 reads 1.97 dB from a bypass where at
    // -34 it reads 4.71: past about -27 it is catching so few of them that
    // doing nothing is nearly a right answer.
    //
    // And the range stops at 12, because that is where it stops meaning
    // anything: 16 dB of range and 12 are the same processor on this voice,
    // to 0.00 dB.
    const crossover = tier === 'easy' ? 5500 : pick(rng, [4000, 5500, 7000]);
    const depth = pick(rng, tier === 'easy' ? [8, 12] : [6, 8, 12]);
    const release = tier === 'easy' ? 60 : pick(rng, [30, 60, 150]);

    // The detector follows the crossover - see `couple` in `aimed.js` for the
    // measurement that decided that - so a target has to set both or it is
    // asking for a crossover the marking cannot see.
    return {
      answer: {
        ...DEESS_FACE.defaults,
        crossover,
        scHigh: crossover,
        range: depth,
        release,
        threshold: toStep(-34 + rng() * 6, 0.5),
      },
    };
  },

  score(guess, puzzle) {
    const { answer, tier } = puzzle;
    if ((puzzle.settings?.exercise ?? 'match') === 'drill') return scoreAim(guess, puzzle);

    const { samples, rate } = essMaterial(puzzle);
    const mine = { ...DEESS_FACE.defaults, ...guess };
    const gap = distance(
      reductionReading(samples, rate, { ...mine, scHigh: mine.crossover }),
      reductionReading(samples, rate, answer),
    );

    const error = gap.off;
    const close = ESS_CLOSE[tier];
    const mark = error <= close ? HIT : error <= close * 2.5 ? NEAR : MISS;
    const { depth } = gap.detail;

    return {
      correct: error <= close,
      error,
      cells: [
        { state: mark, text: `${error.toFixed(1)} dB out` },
        {
          state: mark,
          text: error <= close ? 'sits on it'
            : `${Math.abs(depth).toFixed(1)} dB too ${depth > 0 ? 'gentle' : 'hard'}`,
          narrow: true,
        },
      ],
      why: [
        {
          label: 'Reduction, compared',
          value: `${error.toFixed(2)} dB apart`,
          how: 'Both de-essers are run over the same voice and what they did to '
             + 'it is framed at five milliseconds and compared frame by frame. '
             + 'Which means the threshold and the crossover are marked together: '
             + 'a crossover too low with a threshold that happens to cancel it '
             + 'is a right answer, because it does the same thing.',
        },
        {
          label: 'The target',
          value: `${answer.threshold.toFixed(1)} dB, from ${Math.round(answer.crossover)} Hz`,
          how: `Taking ${answer.range} dB off at its deepest over `
             + `${answer.release} ms, which is the range - the range is what `
             + 'caps the reduction, and the threshold decides how much of the '
             + 'time it is down there. The crossover is the one to find first: '
             + 'aimed too low it takes the voice with the sibilance, and aimed '
             + 'too high it misses the S altogether - though on this reading '
             + 'only the hard tier is tight enough to say so, because what is '
             + 'being compared is how much gain was asked for and two crossovers '
             + 'either side of an S ask for about the same.',
        },
        {
          label: 'Allowed',
          value: `${close.toFixed(1)} dB`,
          how: 'Measured against the mistakes somebody actually makes on this '
             + 'material: two decibels of threshold out reads 0.69, halving the '
             + 'amount reads 1.05, the wrong release reads 1.88, and leaving it '
             + 'switched off entirely reads 2.15 or worse. The numbers are small '
             + 'because a de-esser is only down for the length of each S - a '
             + 'tenth of a second at a time - so what it does to the loop as a '
             + 'whole is small even when what it does to an S is not.',
        },
      ],
    };
  },

  hints(puzzle) {
    const exercise = puzzle?.settings?.exercise ?? 'match';
    const { answer } = puzzle;

    if (exercise === 'drill') {
      return [
        'The amount is the same in all three, so do not listen to how much is '
          + 'coming off. Listen to what else moves when it does.',
        answer.aim === 'none'
          ? 'Nothing is moving. Compare the two sides on a syllable with an S '
            + 'and then on the one without, and if neither changes you have your '
            + 'answer.'
          : answer.aim === 'band'
            ? 'The esses are going down and the vowel underneath them is staying '
              + 'exactly where it was.'
            : 'The whole voice dips every time an S arrives, which is the thing '
              + 'a de-esser is supposed not to do.',
        `It is ${(ESS_AIMS.find((a) => a.id === answer.aim) ?? ESS_AIMS[1]).symbol}.`,
      ];
    }

    return [
      'Aim it before you set it. Press "Hear the band" and move the crossover '
        + 'until the esses are the loudest thing in it and the vowel is not - '
        + 'only then decide how much to take off.',
      `The target is listening from about ${Math.round(answer.crossover)} Hz up.`,
      `And it takes ${answer.range} dB off at its deepest over `
        + `${answer.release} ms - the range is what caps the reduction however `
        + 'low the threshold goes, and the release is how long it stays down '
        + 'between one syllable and the next.',
    ];
  },

  reveal(puzzle) {
    const exercise = puzzle?.settings?.exercise ?? 'match';
    const { answer } = puzzle;

    if (exercise === 'drill') {
      const wanted = ESS_AIMS.find((a) => a.id === answer.aim) ?? ESS_AIMS[1];
      return { symbol: wanted.symbol, name: 'was being ducked' };
    }

    return {
      symbol: `${answer.range} dB`,
      name: `from ${Math.round(answer.crossover)} Hz up, over ${answer.release} ms`,
    };
  },

  heard(guess, puzzle) {
    if ((puzzle?.settings?.exercise ?? 'match') !== 'drill') return null;
    if (guess?.aim === undefined) return null;
    const said = ESS_AIMS.find((a) => a.id === guess.aim);
    return { key: `ess-${guess.aim}`, label: said?.symbol ?? guess.aim };
  },

  weak(puzzle) {
    const exercise = puzzle?.settings?.exercise ?? 'match';
    const { answer } = puzzle;
    if (exercise === 'drill') {
      const wanted = ESS_AIMS.find((a) => a.id === answer.aim) ?? ESS_AIMS[1];
      return { key: `ess-${wanted.id}`, label: `hearing ${wanted.symbol}` };
    }
    return { key: 'ess-match', label: 'aiming a de-esser' };
  },

  defaults: COMP_DEFAULTS,
};
