// What you do with two microphones, and how it is marked.
//
// Three exercises, and the split between them is the one the research forced.
// **Align the pair** is the craft: a pair arrives out of time and possibly
// wired backwards, and you put it right with the tool's own displays in front
// of you. The two drills take the displays away and ask the two questions an
// engineer answers by ear - how far apart are they, and is one of them upside
// down - because those are the ones worth training and the ones a meter is
// not trustworthy about.
//
// Nothing here ever asks about one signal on its own. Absolute polarity is a
// coin: 780 trials at 49.87 per cent. Relative polarity between two
// correlated signals cancels, which is a sound, which is a question.

import {
  ALIGN_DEFAULTS, farMic, alignPass, alignGap, crossLag, cmOf, msOf,
} from '../../plugins/align/pair.js';
import { distance } from '../../gap.js';
import {
  HIT, NEAR, MISS, onScale, pick, toStep,
} from './scoring.js';
import { mulberry32 } from '../../lib/random.js';

/**
 * How close a matched pair has to be, in decibels across the band set.
 *
 * Measured over the rounds this mode actually makes - six medium ones, and
 * the range across them - with the far mic between two and six decibels down:
 *
 *     mistake                      reads
 *     nothing at all           3.30 to 8.68
 *     polarity wrong          10.05 to 14.90
 *     0.02 ms out (one step)   0.10 to 0.12
 *     0.1 ms out               0.71 to 0.86
 *     0.2 ms out               2.56 to 3.45
 *     0.5 ms out               3.59 to 4.66
 *     far mic 3 dB up                  1.33
 *     far mic 6 dB up                  2.91
 *
 * Two things in that table are worth saying out loud.
 *
 * The first is that it saturates. Half a millisecond out reads 4.42 where no
 * alignment at all reads 5.00, because a comb at 1 kHz and a comb at 500 Hz
 * are both combs and the reading is not told which one it was supposed to be.
 * That is honest - they sound about equally wrong - and it is why the
 * feedback says how far out in milliseconds rather than leaving somebody to
 * infer it from a decibel figure that stopped moving.
 *
 * The second is the bottom of it. Below a tenth of a millisecond the reading
 * is dominated by the interpolator rather than by the comb: one step of the
 * delay knob reads 0.10 and two and a half steps read 0.05, which is not a
 * monotone sequence. Both are a fortieth of what no alignment reads, so
 * nothing is decided down there - but a tolerance of a twentieth of a decibel
 * would be a tolerance measuring a rounding error, and the hard tier's 0.6 is
 * set well clear of it: it forgives three steps of the knob and refuses five.
 *
 * The tiers are fixed by the near band, as everywhere else here: two and a
 * half times the tolerance has to stay short of doing nothing, so that
 * leaving the pair alone is never reported as close. Measured over forty
 * rounds a tier, the least an unaligned pair reads is 4.80 on easy - where
 * the far mic is never more than four decibels down - and 3.30 and 3.29 on
 * medium and hard, where it can be six down. Against near bands of 3.75, 2.50
 * and 1.50.
 */
const ALIGN_CLOSE = { easy: 1.5, medium: 1.0, hard: 0.6 };

/**
 * How far apart the drill's pairs are, in centimetres.
 *
 * Doubling, because the cue doubles with it: the first notch of a comb is at
 * 1/2t, so every step down this ladder is an octave down in the place the
 * sound is hollowed out. Measured on the probe, as where the deepest dip in
 * the sum lands:
 *
 *     apart      path    first notch
 *      10 cm   0.29 ms       1715 Hz
 *      20 cm   0.58 ms        857 Hz
 *      40 cm   1.17 ms        429 Hz
 *      80 cm   2.33 ms        214 Hz
 *     160 cm   4.66 ms        107 Hz
 *     320 cm   9.33 ms         54 Hz
 *
 * An octave a step, which is what makes this a fair ear test rather than a
 * guess: one chip out is always the same distance in the thing being judged.
 * The bottom rung is 10 cm rather than 5 because at 5 the notch is up at 3.4
 * kHz where a kit has little to cancel, and the top is 320 because past about
 * three metres the second mic stops being a comb and starts being an echo -
 * which is a different lesson, and the reverb's.
 */
const APART = {
  easy: [10, 40, 160],
  medium: [10, 20, 40, 80, 160, 320],
  hard: [10, 20, 40, 80, 160, 320],
};

/** And how far out still counts as close, in chips. */
const APART_NEAR = { easy: 1, medium: 1, hard: 0 };

/**
 * What can be wrong with a pair, which is the second drill's three answers.
 *
 * It started as two - flipped or not - and the drill contract refused it, for
 * a reason worth keeping: a question with two answers is a question somebody
 * can pass half the time by picking the same chip, and `tests/drill.test.js`
 * holds every drill to three.
 *
 * Which turned out to be the better exercise anyway. "Is it inverted?" is a
 * yes-or-no about one fault; "what is wrong with this pair?" is the question
 * an engineer actually faces, and it has three answers because a pair can be
 * fine, upside down, or just too far apart. Within a tier the first two are
 * the same distance and differ only in polarity, and the third is the same
 * polarity and differs only in distance - so each of the two questions is
 * asked on its own, in a round that does not say which one it is asking.
 */
const FAULTS = [
  { id: 'nothing', label: 'Nothing - it is fine', symbol: 'nothing wrong' },
  { id: 'flipped', label: 'One is inverted', symbol: 'inverted' },
  { id: 'late', label: 'They are far apart', symbol: 'too far apart' },
];

/**
 * How far apart the pair is for each answer, per tier, in centimetres.
 *
 * `nothing` and `flipped` share a distance so that the only thing between
 * them is the polarity. `late` is the one that moves, and how far it moves is
 * the whole of what makes a tier: two and a half octaves of notch between the
 * two on easy, and a little over one on hard.
 */
const FAULT_CM = {
  easy: { near: 8, far: 200 },
  medium: { near: 10, far: 80 },
  hard: { near: 15, far: 50 },
};

/* ---------- the material ---------- */

/**
 * A stand-in for the drum loop, for the times the real thing is not to hand.
 *
 * Scoring is a pure function a test can call without an audio context, so
 * this has to be the same material in every way the marking can see: a kit
 * with a kick, a backbeat and hats, broadband because a pair of microphones
 * on something with no top in it is a pair whose alignment nobody can hear.
 *
 * Calibrated against the rendered loop band by band - the numbers are in
 * `tests/align.test.js`, which asserts they stay that way.
 */
function kitProbe(rate, seconds = 4) {
  const n = Math.round(rate * seconds);
  const out = new Float32Array(n);
  const rng = mulberry32(0x7a1e);
  const beat = 60 / 96;

  const hit = (at, {
    tone, decay, noise, noiseDecay, level,
  }) => {
    const length = Math.round(rate * 0.4);
    for (let i = 0; i < length && at + i < n; i += 1) {
      const t = i / rate;
      out[at + i] += level * (Math.sin(2 * Math.PI * tone * t) * Math.exp(-t * decay)
        + (rng() * 2 - 1) * noise * Math.exp(-t * noiseDecay));
    }
  };

  for (let k = 0; k * beat * 0.5 < seconds; k += 1) {
    const at = Math.round(k * beat * 0.5 * rate);
    if (k % 8 === 0 || k % 8 === 5) {
      hit(at, {
        tone: 60, decay: 11, noise: 0.3, noiseDecay: 240, level: 0.7,
      });
    }
    if (k % 8 === 2 || k % 8 === 6) {
      hit(at, {
        tone: 190, decay: 16, noise: 1.6, noiseDecay: 22, level: 0.33,
      });
    }
    hit(at, {
      tone: 9000, decay: 60, noise: 2.4, noiseDecay: 90, level: k % 2 ? 0.05 : 0.09,
    });
  }

  return out;
}

let kitKept = null;
const keptKit = () => {
  if (!kitKept) kitKept = { close: kitProbe(48000), rate: 48000 };
  return kitKept;
};

/**
 * The pair a guess is read against: the close mic that was pinned, and the
 * far one rebuilt from it.
 *
 * The far microphone is deliberately not pinned with the material. It is not
 * a recording - it is a function of the close mic and the round's path, and
 * rebuilding it here with the same arithmetic the player used costs a few
 * milliseconds and removes the only ordering problem this exercise had:
 * `attach` pins the material before it sets the fault, so a far mic pinned
 * with the material would be the one from the round before.
 */
function alignPair(puzzle) {
  const pinned = puzzle?.material?.close ? puzzle.material : keptKit();
  const { close, rate } = pinned;
  const path = puzzle?.path ?? { ms: 3.5, level: -4, flip: false };
  return { close, far: farMic(close, rate, path), rate };
}

/* ---------- the rounds ---------- */

/**
 * Where a pair can be, in milliseconds.
 *
 * The bottom is a third of a millisecond, which is a hand's width: closer
 * than that and the first notch is above 1.5 kHz, where the comb is a
 * colouration rather than a hole. The top is twelve, which is four metres -
 * a room mic, and about as far as the word "pair" stretches.
 *
 * Easy stays inside the band where the comb is unmistakable and the far mic
 * is never quieter than four decibels down, because that is what keeps an
 * unaligned pair reading 4.30 dB away from an aligned one - outside the near
 * band of the easy tolerance, which is the property every tier here has to
 * keep.
 */
const PATHS = {
  easy: { ms: [0.6, 6], level: [-4, -2], flips: false },
  medium: { ms: [0.3, 12], level: [-6, -2], flips: true },
  hard: { ms: [0.3, 12], level: [-6, -2], flips: true },
};

export const ALIGN_EXERCISES = {
  match: {
    id: 'match',
    label: 'Align the pair',
    source: 'drums',
    other: 'Aligned',
    faultOf: (puzzle) => puzzle.path,
    targetOf: (puzzle) => puzzle.answer,
  },

  drill: {
    id: 'drill',
    label: 'How far apart are they?',
    drill: true,
    ask: 'How far apart are these two microphones?',
    lede: 'Nothing to dial here. Two mics are on one kit with nothing done '
        + 'about it, and the question is how far apart they are - which the '
        + 'comb will tell you if you know where to listen.',
    opening: 'Play it, flip to the aligned side, then say how far apart they are.',
    tierBlurbs: {
      easy: 'Three distances, two octaves apart',
      medium: 'Six distances, a step forgiven',
      hard: 'Six distances, exact',
    },
    source: 'drums',
    other: 'Aligned',
    faultOf: (puzzle) => puzzle.path,
    // The pair as it arrived: nothing dialled in, so what is heard is the
    // comb the distance makes.
    startOf: () => ({ ...ALIGN_DEFAULTS, delay: 0, blend: 0, flip: false }),
    // And the same pair put right, which is the only fair reference: same
    // source, same level, no comb.
    targetOf: (puzzle) => ({ ...ALIGN_DEFAULTS, delay: puzzle.path.ms, blend: 0 }),
    cleanOf: (puzzle) => ({ ...ALIGN_DEFAULTS, delay: puzzle.path.ms, blend: 0 }),
    restores: true,
  },

  flip: {
    id: 'flip',
    label: 'What is wrong with this pair?',
    drill: true,
    ask: 'What is wrong with this pair of microphones?',
    lede: 'A kick drum with a mic inside it and a mic on the front head. One '
        + 'of three things is true: they are fine, one of them is wired '
        + 'backwards, or they are much further apart than they look.',
    opening: 'Play it, flip to the single mic, then say what is wrong.',
    tierBlurbs: {
      easy: 'A hand\'s width against two metres',
      medium: 'Closer together, so the comb moves up',
      hard: 'Half a metre against fifteen centimetres',
    },
    source: 'kick',
    other: 'One mic',
    faultOf: (puzzle) => puzzle.path,
    startOf: () => ({ ...ALIGN_DEFAULTS, delay: 0, blend: 0, flip: false }),
    // The far mic taken out rather than put right, because what tells you a
    // pair disagrees is what happens when the second one arrives: the low end
    // either fills in or falls away.
    targetOf: () => ({ ...ALIGN_DEFAULTS, delay: 0, blend: -18 }),
    cleanOf: () => ({ ...ALIGN_DEFAULTS, delay: 0, blend: -18 }),
    restores: true,
  },
};

/** Naming a distance, which is marked on the chip and not on the audio. */
function scoreApart(state, puzzle) {
  const { answer, tier } = puzzle;
  const offered = APART[tier] ?? APART.medium;

  const at = offered.indexOf(state.apart);
  const wanted = offered.indexOf(answer.apart);
  const mark = onScale(at, wanted, { near: APART_NEAR[tier] ?? 1 });
  const steps = at - wanted;
  const away = Math.abs(steps);
  const notch = 1000 / (2 * msOf(answer.apart));

  return {
    correct: mark === HIT,
    cells: [
      { state: mark, text: `${state.apart} cm` },
      {
        state: mark,
        text: away === 0 ? 'that is the distance'
          : `${away} step${away === 1 ? '' : 's'} too ${steps > 0 ? 'far' : 'close'}`,
        narrow: true,
      },
    ],
    why: [
      {
        label: 'How far apart',
        value: `${answer.apart} cm`,
        how: `Which is ${msOf(answer.apart).toFixed(2)} ms of air at 34.3 cm per `
           + 'millisecond - the conversion worth knowing by heart, because it turns '
           + 'a sound into a distance you can check with your hands.',
      },
      {
        label: 'What you were listening for',
        value: `the notch at ${Math.round(notch)} Hz`,
        how: 'Two copies of a signal a time t apart cancel at 1/2t and every odd '
           + 'multiple of it. Every step down this ladder doubles the distance, '
           + 'which halves the notch - so the chips are an octave apart in the '
           + 'thing being judged, and one chip out always sounds the same amount '
           + 'wrong.',
      },
    ],
  };
}

/** And naming what is wrong with a pair, which is right or it is not. */
function scoreFault(state, puzzle) {
  const { answer, tier } = puzzle;
  const mine = FAULTS.find((p) => p.id === state.wrong);
  const wanted = FAULTS.find((p) => p.id === answer.wrong) ?? FAULTS[0];
  const right = state.wrong === answer.wrong;
  const cm = FAULT_CM[tier] ?? FAULT_CM.medium;

  return {
    correct: right,
    cells: [
      { state: right ? HIT : MISS, text: mine?.label ?? '—' },
      {
        state: right ? HIT : MISS,
        text: right ? 'that is the pair' : `it was ${wanted.symbol}`,
        narrow: true,
      },
    ],
    why: [
      {
        label: 'The pair',
        value: wanted.label,
        how: answer.wrong === 'flipped'
          ? `Both mics ${cm.near} cm apart, and one of them wired backwards - so `
            + 'where they should have added up they took each other away. On a pair '
            + 'this close that is the low end: the kick arrives twice and leaves '
            + 'once.'
          : answer.wrong === 'late'
            ? `The two were ${cm.far} cm apart rather than ${cm.near}, which puts the `
              + `notch at ${Math.round(1000 / (2 * msOf(cm.far)))} Hz instead of `
              + `${Math.round(1000 / (2 * msOf(cm.near)))}. Nothing is inverted; it `
              + 'is just hollow in a different place.'
            : `${cm.near} cm apart and both the same way up, which is a pair doing `
              + 'what a pair should: adding the second one fills the bottom in '
              + 'rather than taking it out.',
      },
      {
        label: 'How to tell',
        value: 'bring the second mic in and out',
        how: 'Not by listening to either mic on its own - nobody can hear that. '
           + 'Measured over 780 trials, listeners asked whether a single signal '
           + 'was inverted were right 49.87 per cent of the time, which is a coin. '
           + 'What you can hear is two signals disagreeing: if the bottom goes '
           + 'away when the second mic arrives, something is backwards, and if it '
           + 'goes hollow in the mids instead, they are further apart than you '
           + 'thought.',
      },
    ],
  };
}

export const ALIGN_WORK = {
  tool: 'align',
  opening: 'Play the pair, put it in time, then lock it in.',

  settings: [
    {
      id: 'exercise',
      label: 'Exercise',
      options: Object.values(ALIGN_EXERCISES).map(({ id, label }) => ({ id, label })),
    },
  ],

  exercises: ALIGN_EXERCISES,

  tiers: {
    easy: { label: 'Easy', blurb: 'In time, and never backwards', guesses: 3 },
    medium: { label: 'Medium', blurb: 'Polarity too, and further apart', guesses: 4 },
    hard: { label: 'Hard', blurb: 'To a tenth of a millisecond', guesses: 4 },
  },

  /** Answered on the tool, except in the drills, which ask with chips. */
  slots(tier, settings) {
    const exercise = settings?.exercise ?? 'match';

    if (exercise === 'drill') {
      const offered = APART[tier] ?? APART.medium;
      return [{
        id: 'apart',
        kind: 'choice',
        label: 'How far apart',
        options: offered.map((cm) => ({ id: cm, label: `${cm} cm`, symbol: `${cm} cm` })),
      }];
    }

    if (exercise === 'flip') {
      return [{
        id: 'wrong',
        kind: 'choice',
        label: 'What is wrong',
        options: FAULTS.map(({ id, label, symbol }) => ({ id, label, symbol })),
      }];
    }

    return [];
  },

  makePuzzle(rng, tier, settings) {
    const exercise = settings.exercise ?? 'match';

    if (exercise === 'drill') {
      const offered = APART[tier] ?? APART.medium;
      const apart = pick(rng, offered);
      return {
        answer: { apart },
        path: { ms: msOf(apart), level: -3, flip: false },
      };
    }

    if (exercise === 'flip') {
      const cm = FAULT_CM[tier] ?? FAULT_CM.medium;
      const wrong = pick(rng, FAULTS.map((f) => f.id));
      return {
        answer: { wrong },
        path: {
          ms: msOf(wrong === 'late' ? cm.far : cm.near),
          level: -2,
          flip: wrong === 'flipped',
        },
      };
    }

    const band = PATHS[tier] ?? PATHS.medium;
    // On the delay knob's own grid, so the answer is reachable: a target
    // between two steps would be a round nobody could win.
    const ms = toStep(band.ms[0] + rng() * (band.ms[1] - band.ms[0]), 0.02);
    const level = toStep(band.level[0] + rng() * (band.level[1] - band.level[0]), 0.5);
    const flip = band.flips ? rng() < 0.5 : false;

    return {
      path: { ms, level, flip },
      // The fix, which is the answer: hold the close mic for as long as the
      // far one took to arrive, and put the polarity back the way it was. The
      // far mic's fader is not part of it - the mistake this round is built to
      // punish is reaching for the fader when the problem is the timing.
      answer: { ...ALIGN_DEFAULTS, delay: ms, blend: 0, flip },
    };
  },

  score(guess, puzzle) {
    const exercise = puzzle.settings?.exercise ?? 'match';
    if (exercise === 'drill') return scoreApart(guess, puzzle);
    if (exercise === 'flip') return scoreFault(guess, puzzle);

    const { answer, tier } = puzzle;
    const pair = alignPair(puzzle);
    const lag = crossLag(pair.close, pair.far, pair.rate);
    const gap = distance(
      alignPass(pair, pair.rate, { ...ALIGN_DEFAULTS, ...guess }, lag).reading,
      alignPass(pair, pair.rate, answer, lag).reading,
    );

    const error = gap.off;
    const close = ALIGN_CLOSE[tier];
    const mark = error <= close ? HIT : error <= close * 2.5 ? NEAR : MISS;
    const { left, flipped } = gap.detail;

    return {
      correct: error <= close,
      error,
      cells: [
        { state: mark, text: `${error.toFixed(1)} dB out` },
        {
          state: mark,
          text: flipped ? 'the wrong way up'
            : error <= close ? 'in time'
              : `${Math.abs(left).toFixed(2)} ms ${left > 0 ? 'short' : 'too far'}`,
          narrow: true,
        },
      ],
      why: [
        {
          label: 'The pair, compared',
          value: `${error.toFixed(2)} dB apart`,
          how: 'Both sums are read in sixth-octave bands from 40 Hz to 4 kHz and '
             + 'compared band by band, which is the comb and nothing else. Above '
             + 'four kilohertz the far mic is ten decibels down and what is left '
             + 'is a ripple - counting it would score a twentieth of a millisecond '
             + 'as half of no alignment at all.',
        },
        {
          label: 'The pair',
          value: `${answer.delay.toFixed(2)} ms apart`
            + `${answer.flip ? ', and wired backwards' : ''}`,
          how: `Which is ${cmOf(answer.delay).toFixed(0)} cm of air, and puts the `
             + `first notch at ${Math.round(1000 / (2 * answer.delay))} Hz until `
             + 'the delay catches up with it. The polarity is one button and the '
             + 'first thing to settle: searching for a peak with the two the wrong '
             + 'way up is searching for a trough.',
        },
        {
          label: 'Allowed',
          value: `${close.toFixed(1)} dB`,
          how: 'Measured against the mistakes somebody actually makes: a tenth of '
             + 'a millisecond out reads about 0.8, two tenths reads about 3, the '
             + 'polarity wrong reads 10 or more, and leaving the pair alone reads at '
             + 'least 3.3. So every tier refuses the empty answer outright, and the '
             + 'hard one wants the delay inside about a twentieth of a millisecond.',
        },
      ],
    };
  },

  hints(puzzle) {
    const exercise = puzzle?.settings?.exercise ?? 'match';
    const { answer } = puzzle;

    if (exercise === 'drill') {
      const notch = 1000 / (2 * msOf(answer.apart));
      return [
        'Listen for where the sound is hollow rather than for how hollow it is. '
          + 'Flip to the aligned side and back: what comes and goes is a notch, '
          + 'and where it sits is the whole answer.',
        notch > 800
          ? 'The hole is up in the attack of the snare, which is a close pair.'
          : notch > 200
            ? 'The hole is in the body of the kit, around the low mids.'
            : 'The hole is down in the kick itself, which means they are far apart.',
        `It is ${answer.apart} cm, which notches at about ${Math.round(notch)} Hz.`,
      ];
    }

    if (exercise === 'flip') {
      return [
        'Do not listen to either microphone on its own - absolute polarity is not '
          + 'something anybody can hear. Compare the pair against the single mic '
          + 'and listen to what the bottom does when the second one arrives.',
        answer.wrong === 'flipped'
          ? 'Adding the second mic makes the kick smaller. That only happens one way.'
          : answer.wrong === 'late'
            ? 'The bottom is still there. What has gone is further up, which is a '
              + 'notch, which is distance.'
            : 'Adding the second mic fills the bottom in and takes nothing out, '
              + 'which is what a pair should do.',
        answer.wrong === 'flipped'
          ? 'It is the polarity: one of the two is wired backwards.'
          : answer.wrong === 'late'
            ? 'It is the distance: they are much further apart than they look.'
            : 'There is nothing wrong with it. Saying so is the answer.',
      ];
    }

    return [
      'Settle the polarity first, then the time. The correlation display tells '
        + 'you which way to move: when the mark you are dragging meets the peak, '
        + 'the pair is in time.',
      `The far mic is about ${cmOf(answer.delay).toFixed(0)} cm further from the `
        + `source, which is ${answer.delay.toFixed(2)} ms${answer.flip ? ' - and it is wired backwards' : ''}.`,
      `So: ${answer.delay.toFixed(2)} ms of delay on the close mic`
        + `${answer.flip ? ', the far one flipped' : ''}, and leave the fader alone.`,
    ];
  },

  reveal(puzzle) {
    const exercise = puzzle?.settings?.exercise ?? 'match';
    const { answer } = puzzle;

    if (exercise === 'drill') return { symbol: `${answer.apart} cm`, name: 'apart' };
    if (exercise === 'flip') {
      const wanted = FAULTS.find((p) => p.id === answer.wrong) ?? FAULTS[0];
      return { symbol: wanted.symbol, name: 'is what was wrong with it' };
    }
    return {
      symbol: `${answer.delay.toFixed(2)} ms`,
      name: answer.flip ? 'with the far mic flipped' : 'of delay on the close mic',
    };
  },

  heard(guess, puzzle) {
    const exercise = puzzle?.settings?.exercise ?? 'match';
    if (exercise === 'drill') {
      if (guess?.apart === undefined) return null;
      return { key: `align-${guess.apart}`, label: `${guess.apart} cm apart` };
    }
    if (exercise === 'flip') {
      if (guess?.wrong === undefined) return null;
      const said = FAULTS.find((p) => p.id === guess.wrong);
      return { key: `align-${guess.wrong}`, label: said?.symbol ?? guess.wrong };
    }
    return null;
  },

  weak(puzzle) {
    const exercise = puzzle?.settings?.exercise ?? 'match';
    const { answer } = puzzle;
    if (exercise === 'drill') {
      return { key: `align-${answer.apart}`, label: `${answer.apart} cm apart` };
    }
    if (exercise === 'flip') {
      const wanted = FAULTS.find((p) => p.id === answer.wrong) ?? FAULTS[0];
      return { key: `align-${wanted.id}`, label: `hearing a pair with ${wanted.symbol}` };
    }
    return { key: 'align-match', label: 'putting a pair in time' };
  },

  defaults: ALIGN_DEFAULTS,
};
