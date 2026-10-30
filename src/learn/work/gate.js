// What you do with a gate, and how it is marked.
//
// Two exercises and both are about the same decision, which is the only
// decision a gate really has: how much of the quiet to keep. **Match the
// target** hands you a gate and asks you to build it. **How far is it
// closing?** takes the knobs away and asks for the depth by ear, which is the
// figure people set by eye and never check.
//
// Marked on the reduction that came out, on the kind and the axis the
// compressor and the limiter are marked on - "how much is this reducing" is
// one question however the thing answering it is built, and a gate's answer
// being negative where a compressor's is positive does not make it a
// different question.

import { COMP_DEFAULTS, expandGain } from '../../plugins/compressor/dsp.js';
import { reductionReading } from '../../plugins/compressor/reading.js';
import { GATE_FACE } from '../../plugins/compressor/aimed.js';
import { distance } from '../../gap.js';
import { HIT, NEAR, MISS, onScale, pick, toStep } from './scoring.js';
import { mulberry32 } from '../../lib/random.js';

/**
 * How close a matched gate has to be, in decibels of reduction.
 *
 * Measured against a target at -26 with 24 dB of range and a 120 ms release,
 * as how far the reduction gap reads for each kind of mistake - on the probe
 * below, and in brackets on the rendered loop where the two differ:
 *
 *     mistake                      reads
 *     nothing at all              12.48  (13.78)
 *     threshold 1 dB out           3.01  (2.52)
 *     threshold 2 dB out           4.92  (4.51)
 *     threshold 4 dB out           8.39  (7.81)
 *     range 16 not 24              4.15
 *     range 40 not 24              8.25
 *     release 40 not 120           6.05  (6.10)
 *     release 300 not 120          5.48  (5.99)
 *     ratio 3 not 8                1.97  (2.81)
 *     hold off                     1.43  (1.80)
 *     hysteresis off               0.95  (0.99)
 *
 * The threshold dominates, which is the right way round for a gate and is why
 * the hints say to find it first. Everything a round asks for - threshold,
 * range, release - reads several decibels out when it is wrong, and the two
 * knobs a round does not ask for read under two, which is the arrangement
 * that makes this markable at all.
 *
 * The tiers are set so that the deepest NEAR is still short of doing nothing.
 * The band for a near miss is two and a half times the tolerance, and the
 * least a target this mode makes can read from an open gate is 11.04 on easy
 * and 6.38 on medium and hard (11.96 and 6.75 on the loop) - so 4.0, 2.5 and
 * 1.5 put a gate left alone outside even the near band on every tier, which
 * is the one property this mode cannot be allowed to lose.
 *
 * What that buys in knob terms is uneven, and that is the material rather
 * than the marking. The threshold's effect comes in steps: moving it across
 * the ghost notes at -25 changes what the gate does a great deal, and moving
 * it between them changes almost nothing. Measured on the loop at range 24,
 * one decibel of threshold reads anything from 0.13 to 3.66 depending on
 * where it started. So easy's four decibels forgive about a decibel of
 * threshold at a cliff and a great deal more than that on a plateau - which
 * is exactly what the ear hears, and is the reason this is marked on what the
 * gate did rather than on what the knob said.
 */
const GATE_NEAR_ENOUGH = { easy: 4.0, medium: 2.5, hard: 1.5 };

/**
 * The depths the drill offers, in decibels, as a ladder.
 *
 * Doubling, so every step is the same ratio and one chip out is always the
 * same distance in the thing being judged. Nothing under three decibels: a
 * gate closing by two is doing something nobody can reliably hear, and
 * marking somebody wrong for not hearing it would be marking them wrong for
 * being human.
 *
 * Measured, as how much quieter the loop's floor is between the hits at each
 * rung - which is what the ear actually has to compare. The probe first, the
 * rendered loop in brackets:
 *
 *     range    floor between hits
 *       0 dB        -46.3  (-46.5)
 *       3 dB        -48.3  (-48.7)
 *       6 dB        -50.3  (-50.9)
 *      12 dB        -54.1  (-55.2)
 *      24 dB        -61.3  (-63.5)
 *      40 dB        -69.9  (-73.8)
 *
 * Which is about two thirds of the range at every rung, and for one reason:
 * the release is still on its way down when the next hit arrives. So the
 * number on the knob is not the number in the gaps, which is worth knowing
 * and is why the top rung is 40 rather than 60 - past about forty the gaps
 * are below the noise of anything they would be played back on.
 */
const GATE_DEPTHS = {
  easy: [6, 12, 40],
  medium: [3, 6, 12, 24, 40],
  hard: [3, 6, 12, 24, 40],
};

/** And how far out still counts as close, in chips. */
const GATE_NEAR = { easy: 1, medium: 1, hard: 0 };

/**
 * A stand-in for the room loop, for the times the real thing is not to hand.
 *
 * Scoring is a pure function a test can call without an audio context, as it
 * is for every other mode here - so this has to be the same material in every
 * way the marking can see. Four hits and four ghost notes on an eighth-note
 * grid at 96 bpm, over a floor of rolled-off noise and a tone at the snare's
 * shell pitch, which is what `core/audio.js` lays down for the `room` bed.
 *
 * Measured, the rendered loop and this probe side by side, in the loudest ten
 * millisecond frame after each step and in the floor between them:
 *
 *     step            loop    probe
 *     0  kick         -6.1     -5.9
 *     1  ghost       -27.2    -26.7
 *     2  snare       -10.0    -10.5
 *     3  ghost       -24.6    -26.6
 *     4  ghost       -25.0    -24.5
 *     5  kick         -7.8     -7.8
 *     6  snare       -10.2    -10.5
 *     7  ghost       -24.1    -25.9
 *     floor         -46.3    -46.2
 *
 * Which is near enough that the tolerances below hold on both: every figure
 * in this file was measured twice, once on the rendered loop and once on the
 * probe, and both are quoted wherever they differ enough to matter.
 */
const GATE_BPM = 96;
const GATE_STEPS = [1, 0.1, 0.7, 0.1, 0.1, 1, 0.7, 0.1];

function gateProbe(rate, seconds = 5) {
  const n = Math.round(rate * seconds);
  const out = new Float32Array(n);
  const rng = mulberry32(0x9a7e);

  // The floor: noise rolled off at four kilohertz, and the bleed under it.
  // The one-pole is not the bed's biquad, and it does not have to be - what
  // has to match is the level the gate's detector sees.
  const roll = 1 - Math.exp((-2 * Math.PI * 4000) / rate);
  let low = 0;
  for (let i = 0; i < n; i += 1) {
    low += (rng() * 2 - 1) * roll - low * roll;
    out[i] = low * 0.0125 + Math.sin((2 * Math.PI * 180 * i) / rate) * 0.0045;
  }

  // And the kit: a step every eighth note, the backbeat loud and the ghosts
  // under it. The hit is noise and a tone together, decaying - which is close
  // enough to a snare for a detector, and a detector is all that reads this.
  const step = (60 / GATE_BPM) / 2;
  for (let k = 0; k * step < seconds; k += 1) {
    const level = GATE_STEPS[k % GATE_STEPS.length];
    const at = Math.round(k * step * rate);
    for (let i = 0; i < Math.round(rate * 0.3) && at + i < n; i += 1) {
      const decay = Math.exp(-(i / rate) * 26);
      out[at + i] += level * decay * ((rng() * 2 - 1) * 0.3
        + Math.sin((2 * Math.PI * 190 * i) / rate) * 0.22);
    }
  }

  return { samples: out, rate };
}

/** Built once: five seconds of it, and the marking runs it twice a guess. */
let gateProbeKept = null;
const gateKeptProbe = () => {
  if (!gateProbeKept) gateProbeKept = gateProbe(48000);
  return gateProbeKept;
};

/** What a guess is read against: the pinned loop, or the probe. */
function gateMaterial(puzzle) {
  const pinned = puzzle?.material;
  if (Array.isArray(pinned)) return { samples: pinned[0], rate: 48000 };
  if (pinned?.samples) return pinned;
  return gateKeptProbe();
}

/**
 * The settings behind one rung of the drill.
 *
 * The threshold is -26 because that is where the gate is unambiguously
 * working: above the ghost notes it would be cutting the part rather than the
 * room, and below about -32 it hardly shuts at all. Everything else is fixed,
 * so the only thing left to hear is the depth.
 */
function gateDrillSettings(puzzle) {
  return {
    ...GATE_FACE.defaults,
    range: puzzle.answer?.depth ?? 12,
    threshold: -26,
    ratio: 8,
    attack: 1,
    hold: 40,
    release: 140,
    hysteresis: 6,
  };
}

export const GATE_EXERCISES = {
  match: {
    id: 'match',
    label: 'Match the target',
    source: 'room',
    other: 'Target',
    faultOf: () => null,
    targetOf: (puzzle) => puzzle.answer,
  },
  drill: {
    id: 'drill',
    label: 'How far is it closing?',
    drill: true,
    ask: 'How far is this gate closing?',
    lede: 'Nothing to dial here. A gate is on the loop and everything about it '
        + 'is fixed except how deep it goes.',
    opening: 'Play it, flip to the untreated side, then say how far down it goes.',
    tierBlurbs: {
      easy: 'Three depths, far apart',
      medium: 'Five depths, a step forgiven',
      hard: 'Five depths, exact',
    },
    source: 'room',
    other: 'Untreated',
    faultOf: () => null,
    targetOf: () => ({ ...GATE_FACE.defaults }),
    startOf: (puzzle) => gateDrillSettings(puzzle),
    cleanOf: () => ({ ...GATE_FACE.defaults, range: 0 }),
    restores: true,
  },
};

/** Naming a depth, which is marked on the chip and not on the audio. */
function scoreDepth(state, puzzle) {
  const { answer, tier } = puzzle;
  const offered = GATE_DEPTHS[tier] ?? GATE_DEPTHS.medium;

  const at = offered.indexOf(state.depth);
  const wanted = offered.indexOf(answer.depth);
  const mark = onScale(at, wanted, { near: GATE_NEAR[tier] ?? 1 });

  const steps = at - wanted;
  const away = Math.abs(steps);

  return {
    correct: mark === HIT,
    cells: [
      { state: mark, text: `${state.depth} dB` },
      {
        state: mark,
        text: away === 0 ? 'that is how far'
          : `${away} step${away === 1 ? '' : 's'} too ${steps > 0 ? 'deep' : 'shallow'}`,
        narrow: true,
      },
    ],
    why: [
      {
        label: 'How far it closed',
        value: `${answer.depth} dB`,
        how: 'The range, which is the only control a gate has that says when to '
           + 'stop rather than how fast to move. Everything else was fixed, so '
           + 'this was the whole of what changed between rounds.',
      },
      {
        label: 'What you were listening to',
        value: 'the floor between the hits',
        how: 'Measured on this loop, the floor comes down 2.2 dB at a range of '
           + '3, 8.7 at 12 and 27.3 at 40 - about two thirds of the range every '
           + 'time, because the release is still on its way down when the next '
           + 'hit arrives. The number on the knob is not the number in the '
           + 'gaps.',
      },
    ],
  };
}

export const GATE_WORK = {
  tool: 'gate',
  opening: 'Play the loop, work the gate, then lock it in.',

  settings: [
    {
      id: 'exercise',
      label: 'Exercise',
      options: Object.values(GATE_EXERCISES).map(({ id, label }) => ({ id, label })),
    },
  ],

  exercises: GATE_EXERCISES,

  tiers: {
    easy: { label: 'Easy', blurb: 'One release, and a decibel forgiven', guesses: 3 },
    medium: { label: 'Medium', blurb: 'The release varies too', guesses: 4 },
    hard: { label: 'Hard', blurb: 'The release varies, and the threshold is exact', guesses: 4 },
  },

  /** Answered on the tool, except in the drill, which asks with chips. */
  slots(tier, settings) {
    if (settings?.exercise !== 'drill') return [];

    const offered = GATE_DEPTHS[tier] ?? GATE_DEPTHS.medium;
    return [{
      id: 'depth',
      kind: 'choice',
      label: 'How far down',
      options: offered.map((db) => ({ id: db, label: `${db} dB`, symbol: `${db} dB` })),
    }];
  },

  makePuzzle(rng, tier, settings) {
    if (settings.exercise === 'drill') {
      const offered = GATE_DEPTHS[tier] ?? GATE_DEPTHS.medium;
      return { answer: { depth: pick(rng, offered) } };
    }

    // A target that is doing something, and the band is narrower than it
    // looks. The loop's floor sits at -46, its ghost notes at about -25 and
    // its backbeat at -7, and a gate with six decibels of hysteresis closes
    // six decibels below wherever its threshold is - so:
    //
    //   under -32   it hardly shuts: measured, a target at -31 with a slow
    //               release reads 2.33 dB from an open gate and one at -40
    //               reads 0.00, which is a round whose right answer is to
    //               leave the tool alone
    //   over -21    it is shut on the ghost notes as well, and from there
    //               upwards there is little left to do: four decibels of
    //               threshold from -22 to -18 moves the reading 1.21, where
    //               one decibel in the middle of the band moves it three
    //
    // So -29 to -22, which is the band where the threshold is a decision.
    const threshold = toStep(-29 + rng() * 7, 0.5);
    // And 24 dB at least, for the same reason. A shallower gate is a quieter
    // difference from no gate at all: measured, 18 dB of range with a slow
    // release reads about 4.8 from an open gate, which is inside medium's
    // near band, and a round that calls doing nothing a near miss is a round
    // that teaches the wrong thing.
    const range = toStep(24 + rng() * 16, 1);
    const release = tier === 'easy' ? 120 : pick(rng, [40, 120, 300]);
    // The hold and the hysteresis are left at their defaults and not varied.
    // Measured on this material, turning the hold off moves the reduction
    // reading by 1.43 dB and the hysteresis by 0.95 - both inside easy's
    // tolerance, so a round that asked for either would be asking for
    // something it could not then mark.
    return {
      answer: {
        ...GATE_FACE.defaults, threshold, range, release,
      },
    };
  },

  score(guess, puzzle) {
    const { answer, tier } = puzzle;
    if ((puzzle.settings?.exercise ?? 'match') === 'drill') return scoreDepth(guess, puzzle);

    const { samples, rate } = gateMaterial(puzzle);
    const gap = distance(
      reductionReading(samples, rate, { ...GATE_FACE.defaults, ...guess }),
      reductionReading(samples, rate, answer),
    );

    const error = gap.off;
    const close = GATE_NEAR_ENOUGH[tier];
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
            : `${Math.abs(depth).toFixed(1)} dB too ${depth > 0 ? 'open' : 'shut'}`,
          narrow: true,
        },
      ],
      why: [
        {
          label: 'Reduction, compared',
          value: `${error.toFixed(2)} dB apart`,
          how: 'Both gates are run over the same loop and what they did to it - '
             + 'moment by moment - is framed at five milliseconds and compared '
             + 'frame by frame. Which means any route to the same behaviour '
             + 'counts, and a threshold a decibel out with a range that happens '
             + 'to cancel it is a right answer.',
        },
        {
          label: 'The target',
          value: `${answer.threshold.toFixed(1)} dB, ${answer.range} dB of range`,
          how: `Opening in ${answer.attack ?? 1} ms and closing in `
             + `${answer.release} - and the threshold is the one to find first, `
             + 'because nothing else means anything until the gate is opening on '
             + 'the hits and the ghost notes and staying shut on the room. '
             + 'Measured, two decibels of threshold out reads further than eight '
             + 'decibels of range.',
        },
        {
          label: 'Allowed',
          value: `${close.toFixed(1)} dB`,
          how: 'Measured against the mistakes somebody actually makes: one '
             + 'decibel of threshold out reads 3.01, two reads 4.92, eight '
             + 'decibels of range out reads 4.15, the wrong release reads 5.48 '
             + 'or worse, and leaving the gate alone entirely reads 12.48. So '
             + 'every tier refuses the empty answer, and only the hard one '
             + 'wants the threshold exactly.',
        },
      ],
    };
  },

  hints(puzzle) {
    const exercise = puzzle?.settings?.exercise ?? 'match';
    const { answer } = puzzle;

    if (exercise === 'drill') {
      const db = answer.depth;
      return [
        'Listen between the hits rather than to them. The gate is open on every '
          + 'hit at every setting here, so the hits all sound the same - what '
          + 'changes is how much of the room survives in the gaps.',
        db >= 24
          ? 'The gaps are nearly silent. Whatever was in the room is gone.'
          : db >= 6
            ? 'There is still something in the gaps, and it is clearly quieter.'
            : 'It is barely closing - the room is still there, just a little further back.',
        `It is ${db} dB, which is ${db >= 24 ? 'the deep end of what this tier offers'
          : db >= 6 ? 'the middle of what this tier offers'
            : 'the shallowest step this tier offers'}.`,
      ];
    }

    return [
      'Find the threshold first. Turn the range all the way up so you can hear '
        + 'the gate working, then move the threshold until it opens on the ghost '
        + 'notes as well as the backbeat and stays shut on the room - and only '
        + 'then set the range back.',
      `The target opens at about ${answer.threshold.toFixed(0)} dB, which on this `
        + 'loop is above the room and below the quietest thing the drummer '
        + 'played.',
      `And it closes ${answer.range} dB, letting go over ${answer.release} ms.`,
    ];
  },

  reveal(puzzle) {
    const exercise = puzzle?.settings?.exercise ?? 'match';
    const { answer } = puzzle;

    if (exercise === 'drill') {
      return { symbol: `${answer.depth} dB`, name: 'of range' };
    }

    return {
      symbol: `${answer.threshold.toFixed(0)} dB`,
      name: `with ${answer.range} dB of range`,
    };
  },

  heard(guess, puzzle) {
    if ((puzzle?.settings?.exercise ?? 'match') !== 'drill') return null;
    if (guess?.depth === undefined) return null;
    return { key: `gate-${guess.depth}`, label: `${guess.depth} dB of range` };
  },

  weak(puzzle) {
    const exercise = puzzle?.settings?.exercise ?? 'match';
    const { answer } = puzzle;
    if (exercise === 'drill') {
      return { key: `gate-${answer.depth}`, label: `${answer.depth} dB of range` };
    }
    return { key: 'gate-match', label: 'building a gate' };
  },

  /** The curve, so a caller can tell what the tool can reach. */
  curveOf: expandGain,
  defaults: COMP_DEFAULTS,
};
