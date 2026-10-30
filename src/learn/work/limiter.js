// What you do with a ceiling, and how it is marked.
//
// A limiter is the one processor here whose entire purpose is a trade, and
// both exercises are about that trade rather than about the knobs. **Match
// the target** hands you an amount of limiting and asks you to reproduce it,
// which is the ordinary working task: somebody says "give me six decibels"
// and you have to know what six decibels is. **How much is it limiting?**
// takes the knobs away and asks you to name the amount by ear, with the level
// matched so that the one thing left to hear is the limiting.
//
// Matching is marked on the reduction that came out, on the same kind and the
// same axis the compressor's readings use - because "how much is this
// reducing" is one question however the thing answering it is built. The
// drill is marked on the chip, as every drill here is, but the amount behind
// each chip was set by measuring the same reading: the drive that produces
// three decibels of reduction is a property of the loop and not of the knob,
// so it is measured rather than tabulated.
//
// What is NOT here is the delivery target: get this to -14 LUFS with the peak
// under -1 dBTP. It wants a table of what each service asks for, and a date
// on that table, and the loudness-matched preview that shows what the service
// will do to a master that ignores it. That is the Loudness and Master
// module, not a face's exercise.

import {
  CEIL_DEFAULTS, CEIL_DRIVE, CEIL_OUTPUT, ceilingReading, driveFor, matchOut, runCeiling,
} from '../../plugins/limiter/ceiling.js';
import { integrated, kWeight, truePeakOf } from '../../lib/loudness.js';
import { TARGETS, targetOfId, ceilingAsked } from '../../lib/targets.js';
import { distance } from '../../gap.js';
import { materialStamp } from '../../lib/reduce.js';
import { stampOf } from '../../lib/read.js';
import { HIT, NEAR, MISS, onScale, pick } from './scoring.js';
import { mulberry32 } from '../../lib/random.js';

/**
 * How close a matched reduction has to be, in decibels.
 *
 * Measured on the probe below, as how far the reduction gap reads for each
 * kind of mistake, against three targets:
 *
 *     mistake            3 dB target   6 dB target   10 dB target
 *     nothing at all        0.691         2.521         6.199
 *     drive half a dB out   0.167         0.258         0.472
 *     drive one dB out      0.333         0.516         0.946
 *     drive two dB out      0.671         1.043         1.942
 *     drive four dB out     1.371         2.726         3.941
 *     release 10 ms         0.431         2.069         3.821
 *     release 500 ms        1.200         1.491         0.860
 *
 * So the gap scales with the amount being asked for, which is why the targets
 * below start at six decibels and not at three. At a three-decibel target,
 * doing nothing at all reads 0.691 - inside any tolerance that would forgive
 * a decibel of drive, and better than being four decibels too hard. A tier
 * that let the empty answer through would be teaching nothing, and no choice
 * of tolerance fixes that: the fix is to ask for enough limiting that there
 * is something to miss.
 *
 * At six decibels and up, doing nothing reads 2.5 and worse. Easy forgives
 * about two decibels of drive, medium about one and a half, and hard about
 * one - which also means hard is the only tier where the release has to be
 * roughly right.
 */
const CEIL_CLOSE = { easy: 1.5, medium: 1.0, hard: 0.6 };

/**
 * How close a delivered master has to land on its target, in LU.
 *
 * A judgement rather than a measurement, and unusually for this app it says
 * so. Loudness moves by exactly the output trim - a gain is exact - and the
 * trim steps in tenths, so what the arithmetic can resolve is 0.1 LU and
 * everything above that is a decision about what is worth caring about.
 *
 * Set from the same place the level tool's are: the published difference
 * limen for level is about 1 dB on music, so easy sits comfortably above it,
 * medium at it, and hard below it. Hard is reachable because the meter is on
 * screen - this is not an ear test, it is a "can you hit a number" test, and
 * the skill it stands for is that a delivery spec is a number and not a
 * feeling.
 */
const CEIL_LANDED = { easy: 1.5, medium: 0.8, hard: 0.4 };

/**
 * How far over a ceiling still counts as under it, in dB.
 *
 * The ceiling has no tolerance - over is over - and this is not one. It is
 * the measurement's own floor. A limiter holding a ceiling exactly produces
 * audio whose true peak reads a hair above it, because the samples are
 * float32 and the reconstruction is arithmetic on them. Measured across
 * drives of 6 to 18 dB and ceilings of -0.1, -1 and -2:
 *
 *     ceiling   true peak out       over
 *       -1.0     -0.999999725    2.8e-7
 *       -2.0     -1.999999716    2.8e-7
 *       -0.1     -0.099999739    2.6e-7
 *
 * So the worst is three ten-millionths of a decibel, and the margin here is
 * three orders of magnitude above that and three below anything that could
 * matter. Without it, the correct answer to every delivery round - a master
 * sitting exactly on the ceiling, which is what a limiter is for - is marked
 * as a miss, which is how this was found.
 */
const CEIL_PEAK_SLACK = 1e-4;

/**
 * How much reduction a target asks for, in decibels.
 *
 * Six at the bottom for the reason above, twelve at the top because that is
 * where the material runs out: measured, the deepest reduction keeps going up
 * with the drive for ever, but past twelve decibels on this probe the output
 * is a wall at the ceiling and eighteen sounds identical to twelve - the
 * peak-to-loudness ratio after level-matching reads 7.12 at both.
 */
const CEIL_AMOUNTS = { easy: [6, 8], medium: [6, 8, 10], hard: [6, 8, 10, 12] };

/**
 * The releases a target may ask for, in milliseconds.
 *
 * Only on the harder tiers. Measured at a fixed six decibels of reduction,
 * level-matched, on the probe below:
 *
 *     release   average GR   between hits    PLR
 *      10 ms      -0.360        -0.000       8.42
 *      50 ms      -0.981        -0.423       8.98
 *     150 ms      -2.120        -2.000      10.06
 *     300 ms      -2.933        -3.059      10.84
 *     500 ms      -3.428        -3.661      11.29
 *
 * Monotone on all three, and the between-hits figure is the one that moves
 * most: a fast release comes all the way back between the hits and a slow one
 * never comes back at all. Which is also why a slow release reads a HIGHER
 * peak-to-loudness ratio at the same deepest reduction - it is holding the
 * quiet parts down rather than the loud ones, so there is less of the loud
 * ones taken off.
 *
 * The easy tier leaves this at the default, because asking for two things at
 * once on the tier that exists to be winnable is asking for one too many.
 */
const CEIL_RELEASES = { easy: [CEIL_DEFAULTS.release], medium: [50, 150], hard: [10, 50, 150, 300] };

/**
 * The amounts the drill offers, as a ladder, in decibels of deepest reduction.
 *
 * Doubling, so every step is the same ratio - which matters because being one
 * chip out is scored as near rather than wrong, and that only means something
 * if the chips are evenly spaced in the thing being judged.
 *
 * Measured, with the level matched so that only the limiting is audible, as
 * how much peak-to-loudness ratio each rung costs against the untouched loop
 * (which reads 13.66):
 *
 *     deepest GR   average GR    PLR    PLR given away
 *        0.75         -0.04     12.98        0.69
 *        1.50         -0.12     12.35        1.31
 *        3.00         -0.39     11.25        2.41
 *        6.00         -0.98      8.98        4.68
 *       12.00         -5.17      7.12        6.55
 *       18.00        -11.16      7.12        6.55
 *
 * Monotone up to twelve and then flat: eighteen decibels of reduction gives
 * away exactly as much as twelve does, because by then the output is a wall
 * and there is nothing left to take. So twelve is the top rung - a rung that
 * is audibly identical to the one below it is a coin toss dressed as an ear
 * test.
 */
const CEIL_LADDER = {
  easy: [3, 6, 12],
  medium: [1.5, 3, 6, 12],
  hard: [0.75, 1.5, 3, 6, 12],
};

/** And how far out still counts as close, in chips. */
const CEIL_NEAR = 1;

/** A drive, written the way the face writes one. */
const writeCeilDrive = (db) => `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`;

/** An amount of reduction, written the way a meter would say it. */
const writeCeilGR = (db) => `${db.toFixed(db < 1 ? 2 : 1)} dB`;

/**
 * A stand-in for the loop, for the times the real thing is not to hand.
 *
 * Scoring is a pure function a test can call without an audio context, as it
 * is for every other mode here. Built with hits over a steady bed and a peak
 * some six decibels under full scale, because a limiter has nothing to do
 * with material that has no peak-to-loudness ratio to give away - and faded
 * at both ends, because a true peak read off a buffer that stops mid-waveform
 * measures the truncation rather than the signal. lib/limiter.js records what
 * that cost to find out.
 */
function ceilProbe(rate, seconds = 3) {
  const n = Math.round(rate * seconds);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  const rng = mulberry32(0xce111);

  for (let i = 0; i < n; i += 1) {
    const at = i / rate;
    const bed = Math.sin(2 * Math.PI * 55 * at) * 0.10
      + Math.sin(2 * Math.PI * 220 * at) * 0.06
      + Math.sin(2 * Math.PI * 1100 * at) * 0.03;
    left[i] = bed;
    right[i] = bed * 0.96;
  }
  for (let k = 0; k < 16; k += 1) {
    const at = Math.round(k * 0.25 * rate);
    for (let i = 0; i < Math.round(rate * 0.05) && at + i < n; i += 1) {
      const hit = Math.exp(-(i / rate) * 140) * (rng() * 2 - 1) * 0.3;
      left[at + i] += hit;
      right[at + i] += hit * 0.9;
    }
  }

  const fade = 512;
  for (let i = 0; i < fade; i += 1) {
    const w = i / fade;
    left[i] *= w;
    right[i] *= w;
    left[n - 1 - i] *= w;
    right[n - 1 - i] *= w;
  }

  return { left, right, rate };
}

/**
 * The probe, built once.
 *
 * It is deterministic and three seconds of it is 265 000 floats, and the
 * scoring path asks for it on every call - so a cached one is the difference
 * between a test suite and a wait.
 */
let probeKept = null;
const ceilKeptProbe = () => {
  if (!probeKept) probeKept = ceilProbe(44100);
  return probeKept;
};

const ceilMaterial = (puzzle) => puzzle?.material ?? ceilKeptProbe();

/**
 * The settings the drill puts on the tool.
 *
 * The limiter goes on the tool rather than into the material, for the
 * compressor's reason: a limiter doing six decibels is a limiter and not a
 * faulty loop. Which means the tool's own controls are the answer, so the
 * exercise `restores` them on the way out.
 *
 * Two passes - one to find the drive for the wanted reduction, one to find
 * the output trim that matches the level. Both measured rather than derived
 * from the drive, because the level-matched bypass is the whole instrument
 * here: without it the drill asks which side is louder.
 */
function ceilDrillSettings(puzzle) {
  const material = ceilMaterial(puzzle);
  const want = puzzle.answer?.amount ?? CEIL_LADDER.easy[0];

  const settings = { ...CEIL_DEFAULTS, drive: 0, output: 0 };
  settings.drive = driveFor(material, material.rate, settings, want);
  settings.output = matchOut(material, material.rate, settings);
  return settings;
}

/**
 * The drive that asks the probe for this much reduction, remembered.
 *
 * A target has to be a settings object - every tool-answered exercise here
 * marks a guess against the settings it was given, and a puzzle that carried
 * an amount instead would have nothing to hand the tool. So the amount is
 * turned into a drive when the puzzle is made, against the probe.
 *
 * The probe is only where it starts. A drive that asks the probe for six
 * decibels of reduction would ask a quieter loop for none at all, so
 * `ceilSettle` measures it again against the loop the round is actually
 * played on - see below. What this one is for is `makePuzzle`, which runs
 * before there is a loop and still has to hand back something a tool could be
 * set to.
 *
 * Memoised because `makePuzzle` is called forty times a tier in the tests and
 * each miss is a true-peak pass over three seconds of stereo - about 100 ms.
 * The drive is independent of the release, measured: the deepest reduction is
 * set by the single loudest moment and the release only decides how the gain
 * comes back from it. The key carries the release anyway, so a change to that
 * assumption shows up as a slower test rather than as a wrong answer.
 */
const CEIL_DRIVES = new Map();

function ceilDriveFor(amount, release) {
  const key = `${amount}:${release}`;
  if (CEIL_DRIVES.has(key)) return CEIL_DRIVES.get(key);

  const probe = ceilKeptProbe();
  const drive = driveFor(probe, probe.rate, { ...CEIL_DEFAULTS, release }, amount);
  CEIL_DRIVES.set(key, drive);
  return drive;
}

/**
 * The target's drive, re-measured against the loop it is actually heard on.
 *
 * `makePuzzle` sets the drive against the probe, because it has nothing else
 * - and a drive that asks the probe for six decibels of reduction would ask a
 * quieter loop for none at all, which is a round whose answer is to leave the
 * limiter alone. So the drive is settled again once the bench has pinned the
 * material, which it does before it asks for the target.
 *
 * The answer is mutated rather than copied, because the tool is handed this
 * object and a guess is marked against it: two of them that agree if nothing
 * moved is exactly the kind of near-miss this app keeps finding.
 *
 * Settled once, tracked in a set rather than with a flag on the answer. A
 * settings object with a `settled` field on it is a field every reading would
 * then stamp, and the next person to add a knob would wonder what it did.
 */
const CEIL_SETTLED = new WeakSet();

function ceilSettle(puzzle) {
  const answer = puzzle?.answer;
  if (!answer || CEIL_SETTLED.has(answer)) return answer;

  const material = ceilMaterial(puzzle);
  answer.drive = driveFor(
    material, material.rate, answer, answer.asked ?? CEIL_AMOUNTS.easy[0],
  );
  CEIL_SETTLED.add(answer);
  return answer;
}

/**
 * A reading of these settings over this loop, remembered.
 *
 * Marking a guess means reading the loop twice - once through the guess and
 * once through the target - and the target's half is the same measurement
 * every time. Measured, a match guess cost 258 ms and a true-peak pass over
 * the probe is about 130 of it, so remembering the target's reading halves
 * what a round costs. The guess's own settings change every time and so its
 * half is always a miss, which is the honest cost of marking on the output.
 *
 * Keyed on the material as well as the settings, because a reading over one
 * loop is not a reading over another - that is the whole of what the axis
 * stamp is for, and a cache that forgot it would be the same mistake the
 * stamp exists to refuse. Cleared rather than grown, because a session plays
 * many rounds and nothing here needs the first one's readings.
 */
const CEIL_READINGS = new Map();

function ceilRead(material, settings) {
  const key = `${materialStamp([material.left, material.right])}:${stampOf(settings)}`;
  const kept = CEIL_READINGS.get(key);
  if (kept) return kept;

  const reading = ceilingReading(material, material.rate, settings).reading;
  if (CEIL_READINGS.size > 32) CEIL_READINGS.clear();
  CEIL_READINGS.set(key, reading);
  return reading;
}

/** What the target is doing to the loop in front of it, at its deepest. */
function ceilDepthOf(puzzle, settings) {
  return ceilRead(ceilMaterial(puzzle), settings).values.deepest;
}

/**
 * Which delivery targets a round may ask for, per tier.
 *
 * Named services rather than bare numbers, because the skill being practised
 * is "a client asked for a Spotify master" and not "put this at -14". The
 * figures and their provenance live in `lib/targets.js`, which is the one
 * place in this app where a number is somebody's policy rather than a
 * measurement.
 *
 * Easy is one target and it is the one everybody has heard of. Medium adds
 * Apple's, which is two decibels quieter and wants a different drive for the
 * same material. Hard adds the two that are not normalisers at all: YouTube,
 * where being under the target is not fixed for you, and R 128 at -23, which
 * on this loop is reached by turning DOWN - a round that cannot be won by
 * pushing harder, which is the point of including it.
 */
const CEIL_SERVICES = {
  easy: ['spotify'],
  medium: ['spotify', 'apple'],
  hard: ['spotify', 'apple', 'youtube', 'r128'],
};

/** What a master of this loop reads, in the two figures a spec is written in. */
function ceilMasterOf(material, settings) {
  const pass = runCeiling(material.left, material.right, settings, material.rate);
  const weighted = [pass.left, pass.right].map((channel) => kWeight(channel, material.rate));
  return {
    integrated: integrated(weighted, material.rate).lufs,
    truePeak: Math.max(truePeakOf(pass.left), truePeakOf(pass.right)),
  };
}

/**
 * Settings that land this loop on this target.
 *
 * Not a formula, because there is not one: under the knee a decibel of drive
 * is a decibel of loudness exactly, and past it the limiter is giving some of
 * that back, by an amount that depends on where the music peaks. So it is
 * solved the way a person would - push, measure, correct by the error - and
 * the correction converges because the curve is smooth and monotone.
 *
 * Measured on the probe, chasing -14 LUFS from -20.41: the first guess is
 * 5.6 dB of drive and lands 0.26 LU short, the second lands within 0.02, and
 * the third is exact to the measurement. Four rounds is slack.
 *
 * The output trim finishes the job, and only downward - it is after the
 * ceiling, so lifting with it would break the one promise the limiter makes.
 * Which is also why a target quieter than the loop needs no drive at all:
 * that whole round is the trim.
 */
function ceilDeliverFor(material, target) {
  const asked = (lufs) => ceilingAsked(target, lufs);

  // The ceiling first, because everything else is measured through it. A
  // provisional one off the loop's own loudness, replaced once there is a
  // master to read - Spotify's ceiling depends on how loud you ended up.
  const dry = ceilMasterOf(material, { ...CEIL_DEFAULTS, drive: 0, output: 0 });
  let settings = { ...CEIL_DEFAULTS, ceiling: asked(target.lufs), drive: 0, output: 0 };

  let drive = Math.max(CEIL_DRIVE[0], Math.min(CEIL_DRIVE[1], target.lufs - dry.integrated));
  let got = dry;

  for (let round = 0; round < 4; round += 1) {
    settings = { ...settings, drive, output: 0 };
    got = ceilMasterOf(material, settings);
    const off = target.lufs - got.integrated;
    if (Math.abs(off) < 0.05) break;
    const next = Math.max(CEIL_DRIVE[0], Math.min(CEIL_DRIVE[1], drive + off));
    if (next === drive) break;
    drive = next;
  }

  // Whatever is left over comes off with the trim, which can only go down -
  // so this closes the gap when the drive overshot or when the target was
  // always below the loop, and does nothing when the drive fell short.
  const over = got.integrated - target.lufs;
  const output = Math.max(CEIL_OUTPUT[0], Math.min(CEIL_OUTPUT[1], -over));

  return { ...settings, drive, output };
}

/**
 * The spec a delivery round is working to, as the tool is handed it.
 *
 * Carries `lufs` and `peak` - the two numbers a brief is written in - beside
 * the ordinary settings. The face draws those two and never the knob fields,
 * which is the whole distinction: a spec is the brief and the knob positions
 * are the answer.
 *
 * Solving the round happens here too, because this is the first call the
 * bench makes after it has pinned the material and the drive that hits -14
 * LUFS depends entirely on what the loop was.
 */
function ceilSpecOf(puzzle) {
  const target = targetOfId(puzzle.answer?.service) ?? TARGETS[0];
  if (!CEIL_SETTLED.has(puzzle.answer)) {
    const solved = ceilDeliverFor(ceilMaterial(puzzle), target);
    Object.assign(puzzle.answer, solved);
    CEIL_SETTLED.add(puzzle.answer);
  }

  const reached = ceilMasterOf(ceilMaterial(puzzle), puzzle.answer);
  return {
    ...CEIL_DEFAULTS,
    ceiling: ceilingAsked(target, reached.integrated),
    lufs: target.lufs,
    peak: ceilingAsked(target, reached.integrated),
    service: target.name,
  };
}

export const CEIL_EXERCISES = {
  match: {
    id: 'match',
    label: 'Match the target',
    source: 'mix',
    other: 'Target',
    faultOf: () => null,
    targetOf: ceilSettle,
  },
  deliver: {
    id: 'deliver',
    label: 'Master it to a target',
    source: 'mix',
    other: 'Untreated',
    faultOf: () => null,
    targetOf: ceilSpecOf,
  },
  drill: {
    id: 'drill',
    label: 'How much is it limiting?',
    drill: true,
    ask: 'How much is this limiter taking off at its deepest?',
    lede: 'Nothing to dial here. A limiter is on the loop and the level has '
        + 'been put back, so what is left to hear is how hard it is working.',
    opening: 'Play it, flip to the bypass, then say how much.',
    tierBlurbs: {
      easy: 'Three amounts, far apart',
      medium: 'Four amounts, a step forgiven',
      hard: 'Five amounts, down to three quarters of a decibel',
    },
    source: 'mix',
    other: 'Bypass',
    faultOf: () => null,
    targetOf: () => ({ ...CEIL_DEFAULTS }),
    startOf: (puzzle) => ceilDrillSettings(puzzle),
    cleanOf: () => ({ ...CEIL_DEFAULTS }),
    restores: true,
  },
};

/** Naming an amount, which is marked on the chip and not on the audio. */
function scoreHowMuch(state, puzzle) {
  const { answer, tier } = puzzle;
  const offered = CEIL_LADDER[tier] ?? CEIL_LADDER.medium;

  const at = offered.indexOf(state.amount);
  const wanted = offered.indexOf(answer.amount);
  const mark = onScale(at, wanted, { near: CEIL_NEAR });

  const steps = at - wanted;
  const away = Math.abs(steps);

  return {
    correct: mark === HIT,
    cells: [
      { state: mark, text: writeCeilGR(state.amount) },
      {
        state: mark,
        text: away === 0 ? 'that is the amount'
          : `${away} step${away === 1 ? '' : 's'} too ${steps > 0 ? 'much' : 'little'}`,
        narrow: true,
      },
    ],
    why: [
      {
        label: 'How much it was taking off',
        value: writeCeilGR(answer.amount),
        how: 'At its deepest, which is what a gain-reduction meter reads and '
           + 'what anybody means by "I am hitting three decibels". The drive '
           + 'was set by measurement to land exactly there rather than by a '
           + 'rule of thumb - a limiter\'s reduction depends on the material, '
           + 'not on the knob.',
      },
      {
        label: 'What it cost',
        value: 'peak-to-loudness ratio',
        how: 'The level was matched, so the two sides are the same loudness '
           + 'and the only difference left is what the limiting did. Measured '
           + 'on this material, three decibels of reduction gives away 2.4 dB '
           + 'of peak-to-loudness ratio, six gives away 4.7, and twelve gives '
           + 'away 6.6 - which is also where it stops, because by then the '
           + 'output is a wall at the ceiling.',
      },
    ],
  };
}

export const CEIL_WORK = {
  settings: [
    {
      id: 'exercise',
      label: 'Exercise',
      options: Object.values(CEIL_EXERCISES).map(({ id, label }) => ({ id, label })),
    },
  ],

  exercises: CEIL_EXERCISES,

  tiers: {
    easy: {
      label: 'Easy',
      blurb: 'Moderate amounts, one delivery target, the release left alone',
      guesses: 3,
    },
    medium: {
      label: 'Medium',
      blurb: 'More to take off, two targets, and the release moves',
      guesses: 4,
    },
    hard: {
      label: 'Hard',
      blurb: 'Up to twelve decibels, four targets, and one of them is reached by turning down',
      guesses: 4,
    },
  },

  /** Answered on the plugin, except in the drill, which asks with chips. */
  slots(tier, settings) {
    if (settings?.exercise !== 'drill') return [];

    const offered = CEIL_LADDER[tier] ?? CEIL_LADDER.medium;
    return [{
      id: 'amount',
      kind: 'choice',
      label: 'How much',
      options: offered.map((db) => ({
        id: db,
        label: writeCeilGR(db),
        symbol: writeCeilGR(db),
      })),
    }];
  },

  makePuzzle(rng, tier, settings) {
    if (settings.exercise === 'drill') {
      const offered = CEIL_LADDER[tier] ?? CEIL_LADDER.medium;
      return { answer: { amount: pick(rng, offered) } };
    }

    if (settings.exercise === 'deliver') {
      const offered = CEIL_SERVICES[tier] ?? CEIL_SERVICES.medium;
      // The rest of the answer is filled in by `ceilSpecOf`, once the bench
      // has pinned the loop: the drive that hits -14 LUFS is a property of
      // the music and there is no music yet.
      return { answer: { ...CEIL_DEFAULTS, service: pick(rng, offered) } };
    }

    const amounts = CEIL_AMOUNTS[tier] ?? CEIL_AMOUNTS.medium;
    const releases = CEIL_RELEASES[tier] ?? CEIL_RELEASES.medium;
    const amount = pick(rng, amounts);
    const release = pick(rng, releases);

    // The answer IS the settings, which is the shape every tool-answered
    // exercise here uses: a guess is whatever the knobs are set to, so an
    // answer has to be something the knobs can be set to.
    return {
      answer: {
        ...CEIL_DEFAULTS,
        release,
        drive: ceilDriveFor(amount, release),
        // How the target was chosen, kept for the hints and the reveal. Not a
        // setting, and harmless as one: the plugin reads the four it knows.
        asked: amount,
      },
    };
  },

  score(guess, puzzle) {
    const { tier } = puzzle;
    const exercise = puzzle.settings?.exercise ?? 'match';

    if (exercise === 'drill') return scoreHowMuch(guess, puzzle);
    if (exercise === 'deliver') return this.scoreDeliver(guess, puzzle);

    const material = ceilMaterial(puzzle);
    const target = ceilSettle(puzzle);
    const mine = ceilRead(material, { ...CEIL_DEFAULTS, ...guess });
    const theirs = ceilRead(material, target);

    return this.scoreMatch(mine, theirs, target, tier);
  },

  /** Is it doing the same thing to the loop? */
  scoreMatch(mine, theirs, target, tier) {
    const gap = distance(mine, theirs);
    const off = gap.off ?? Infinity;

    const close = CEIL_CLOSE[tier];
    const mark = off <= close ? HIT : off <= close * 2.5 ? NEAR : MISS;

    return {
      correct: off <= close,
      error: off,
      cells: [
        { state: mark, text: `${Number.isFinite(off) ? off.toFixed(2) : '--'} dB` },
        {
          state: mark,
          text: off <= close ? 'that is the same amount'
            : `${Number.isFinite(off) ? off.toFixed(1) : '--'} dB of reduction apart`,
          narrow: true,
        },
      ],
      why: [
        {
          label: 'Yours',
          value: `${mine.values.deepest.toFixed(2)} dB at its deepest`,
          how: 'Read off the gain reduction the limiter applied over the loop, '
             + 'framed at five milliseconds - the same reading, on the same '
             + 'axis, that the compressor is marked on.',
        },
        {
          label: 'The target',
          value: `${theirs.values.deepest.toFixed(2)} dB at its deepest`,
          how: `Reached with ${writeCeilDrive(target.drive ?? 0)} of drive and a `
             + `${Math.round(target.release ?? CEIL_DEFAULTS.release)} ms release. The drive `
             + 'is worked out from the material rather than fixed, because how '
             + 'much a limiter takes off depends on where the music peaks.',
        },
        {
          label: 'Allowed',
          value: `${close.toFixed(1)} dB`,
          how: 'Measured against the mistakes somebody actually makes: half a '
             + 'decibel of drive out reads about a quarter of a decibel here, '
             + 'two decibels out reads about one, and leaving the limiter alone '
             + 'entirely reads two and a half or worse. So every tier refuses '
             + 'the empty answer.',
        },
      ],
    };
  },

  /**
   * Did it land on the number, and did it stay under the ceiling?
   *
   * Two conditions and both have to hold, which is what a delivery spec is.
   * A master at exactly -14 LUFS that peaks at -0.4 dBTP has not met
   * Spotify's spec and a master 0.2 LU out that respects the ceiling has
   * nearly met it - so the loudness is the number being marked and the peak
   * is a gate on it rather than a second score.
   *
   * The ceiling is read off what YOU ended up at, not off what was asked
   * for. Spotify wants -1 dBTP from a master quieter than -14 LUFS and -2
   * from one louder, so overshooting the loudness target quietly tightens
   * the ceiling by a decibel - which is a real trap and worth walking into
   * once.
   */
  scoreDeliver(guess, puzzle) {
    const { tier } = puzzle;
    const material = ceilMaterial(puzzle);
    const spec = ceilSpecOf(puzzle);
    const target = targetOfId(puzzle.answer?.service) ?? TARGETS[0];

    const got = ceilMasterOf(material, { ...CEIL_DEFAULTS, ...guess });
    const off = got.integrated - target.lufs;
    const asked = ceilingAsked(target, got.integrated);
    const over = got.truePeak - asked;

    const close = CEIL_LANDED[tier];
    const landed = Math.abs(off) <= close;
    const held = over <= CEIL_PEAK_SLACK;
    const mark = landed && held ? HIT
      : (Math.abs(off) <= close * 2.5 && held) ? NEAR : MISS;

    return {
      correct: landed && held,
      error: Math.abs(off),
      cells: [
        { state: landed ? mark : MISS, text: `${got.integrated.toFixed(1)} LUFS` },
        {
          state: held ? mark : MISS,
          text: held
            ? `${got.truePeak.toFixed(1)} dBTP, under ${asked.toFixed(1)}`
            : `${over.toFixed(2)} dB over the ${asked.toFixed(1)} dBTP ceiling`,
          narrow: true,
        },
      ],
      why: [
        {
          label: `What ${target.name} asks for`,
          value: `${target.lufs.toFixed(1)} LUFS, ${asked.toFixed(1)} dBTP`,
          how: target.says,
        },
        {
          label: 'What you delivered',
          value: `${got.integrated.toFixed(1)} LUFS, ${got.truePeak.toFixed(1)} dBTP`,
          how: landed
            ? 'On the number. Read off the audio that came out of the limiter '
              + 'rather than off the knobs, so any route that lands there counts.'
            : `${Math.abs(off).toFixed(1)} LU too ${off > 0 ? 'loud' : 'quiet'}. `
              + 'The output trim moves loudness by exactly itself, so the last '
              + 'decibel is a trim rather than more drive.',
        },
        {
          label: 'Allowed',
          value: `${close.toFixed(1)} LU`,
          how: 'Set from the published difference limen for level - about a '
             + 'decibel on music - rather than from what the measurement can '
             + 'resolve, which is a tenth of one. The ceiling has no tolerance '
             + 'at all: over is over.',
        },
      ],
    };
  },

  /**
   * What to say when somebody is stuck.
   *
   * The first rung is the technique, because for this tool the technique is
   * most of it: nothing can be judged until the level is matched, and the
   * Match button is on the face for that reason.
   */
  hints(puzzle) {
    const exercise = puzzle?.settings?.exercise ?? 'match';
    const { answer } = puzzle;

    if (exercise === 'drill') {
      const db = answer.amount;
      return [
        'Flip to the bypass often and in short bursts. The levels are already '
          + 'matched, so anything you can hear is the limiting and not the volume.',
        db >= 6
          ? 'It is a lot - the transients are being flattened rather than caught.'
          : db >= 3
            ? 'It is a working amount: the hits are being held but the loop still breathes.'
            : 'It is gentle - the sort of amount that catches the odd peak and little else.',
        `It is ${writeCeilGR(db)} at its deepest, which is `
          + `${db >= 6 ? 'the heavy end of what this tier offers'
            : db >= 3 ? 'the middle of what this tier offers'
              : 'the lightest step this tier offers'}.`,
      ];
    }

    if (exercise === 'deliver') {
      const target = targetOfId(answer?.service) ?? TARGETS[0];
      const spec = ceilSpecOf(puzzle);
      return [
        'Two numbers have to be true at once: the loudness and the ceiling. '
          + 'Set the ceiling first and leave it there - it is the one that '
          + 'cannot be negotiated - then go looking for the loudness.',
        `${target.name} wants ${target.lufs.toFixed(1)} LUFS with the peak under `
          + `${spec.peak.toFixed(1)} dBTP. The drive gets you most of the way; the `
          + 'last decibel is the output trim, which moves loudness by exactly itself.',
        `About ${writeCeilDrive(answer.drive ?? 0)} of drive and `
          + `${writeCeilDrive(answer.output ?? 0)} on the output lands it on this loop.`,
      ];
    }

    const gr = -ceilDepthOf(puzzle, ceilSettle(puzzle));
    const release = answer.release ?? CEIL_DEFAULTS.release;
    return [
      'Match the level first, then compare. A limiter that made the loop louder '
        + 'will always seem to have helped, and until that is taken out you are '
        + 'judging the volume.',
      `The target is taking off ${writeCeilGR(gr)} at its deepest on this loop, so `
        + 'push the drive until your own reduction meter reads the same.',
      `And the release is ${Math.round(release)} ms - ${release <= 50
        ? 'fast, so the gain is back between the hits'
        : 'slow, so the gain stays down across them'}.`,
    ];
  },

  /** What the answer was, for the board to print when the round ends. */
  reveal(puzzle) {
    const exercise = puzzle?.settings?.exercise ?? 'match';
    const { answer } = puzzle;

    if (exercise === 'drill') {
      return { symbol: writeCeilGR(answer.amount), name: 'at its deepest' };
    }

    if (exercise === 'deliver') {
      const target = targetOfId(answer?.service) ?? TARGETS[0];
      return {
        symbol: `${target.lufs.toFixed(1)} LUFS`,
        name: `for ${target.name}, under ${ceilingAsked(target, target.lufs).toFixed(1)} dBTP`,
      };
    }

    return {
      symbol: writeCeilDrive(answer.drive ?? 0),
      name: `of drive, with a ${Math.round(answer.release ?? CEIL_DEFAULTS.release)} ms release`,
    };
  },

  /**
   * What a guess says it heard, in `weak`'s own words.
   *
   * Only the drill has one, because only the drill has an answer that is a
   * name rather than a number: the stats page counts how often "6 dB" was
   * called something else, which needs the guess filed under the same key as
   * the answer.
   */
  heard(guess, puzzle) {
    if ((puzzle?.settings?.exercise ?? 'match') !== 'drill') return null;
    if (guess?.amount === undefined) return null;
    return { key: `ceil-${guess.amount}`, label: `${writeCeilGR(guess.amount)} of limiting` };
  },

  /** What a miss here says you need more of. */
  weak(puzzle) {
    const exercise = puzzle?.settings?.exercise ?? 'match';
    const { answer } = puzzle;
    if (exercise === 'drill') {
      return { key: `ceil-${answer.amount}`, label: `${writeCeilGR(answer.amount)} of limiting` };
    }
    if (exercise === 'deliver') {
      const target = targetOfId(answer?.service) ?? TARGETS[0];
      return { key: `deliver-${target.id}`, label: `delivering to ${target.name}` };
    }
    return { key: 'ceil-match', label: 'matching an amount of limiting' };
  },

  /** The range, so a caller can tell whether a target is reachable. */
  reach: CEIL_DRIVE,
};
