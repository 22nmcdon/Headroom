import { COMP_DEFAULTS, analyse, runCompressor } from '../comp/dsp.js';
import { reductionReading, materialStamp } from '../comp/reading.js';
import { distance } from '../gap.js';
import { writeTime, writeRatio } from '../comp/plugin.js';
import { HIT, NEAR, MISS, onScale, logPick, toStep, pick } from './scoring.js';

/**
 * The compressor, as the tool it is.
 *
 * Three exercises, and none of them is a quiz about a number. **Match** puts
 * a compressor on the loop and asks you to build the same one. **Even it out**
 * hands you a loop whose hits are all over the place, which is what a
 * compressor is actually for. **Duck** gives you a bass and a kick and asks
 * you to get one out of the way of the other, which is what a sidechain is
 * actually for.
 *
 * All three are marked on what came out, not on where the knobs ended up -
 * the same decision the EQ mode makes, and for the same reason. Two settings
 * that do the same thing to the same audio are the same answer, and a game
 * that said otherwise would be teaching one plugin's layout rather than an
 * ear. It costs more than comparing numbers: marking a guess means running
 * the compressor over the loop twice. It is worth it.
 */

/** What each exercise is played on, and what it is marked on. */

/**
 * Beats in a loop. `renderLoop` builds two bars of four, and both the
 * evenness reading and the duck reading slice the loop up by beat - each beat
 * of the drum bed carries exactly one hit, and the kick bed puts one on every
 * beat, so a beat is the right unit for both.
 */
const BEATS = 8;

/**
 * How close counts, per tier, in decibels.
 *
 * Set from measurement rather than taste. Over a hundred of the targets this
 * mode actually generates, run against the drum bed: leaving the compressor
 * alone reads at worst 1.7 dB out and usually six; a threshold two decibels
 * off reads 0.3 to 1.2; four decibels off reads 0.6 to 2.4; a ratio half as
 * much again reads under 1.9. So easy forgives a couple of decibels of
 * threshold, medium does not quite, and hard wants the timing as well - and
 * doing nothing at all fails every one of them.
 */
const COMP_CLOSE = {
  match: { easy: 1.5, medium: 1.0, hard: 0.6 },
  fix: { easy: 2.8, medium: 1.8, hard: 1.2 },
  duck: { easy: 2.4, medium: 1.6, hard: 1.1 },
};

/**
 * How much reduction is more than the job needs.
 *
 * Levelling a loop whose hits are N decibels apart takes about N decibels off
 * the loud ones. Taking off a great deal more also levels it - everything
 * squashed flat is level - so evenness on its own would mark the worst answer
 * full marks. This is the margin past the job that still counts as doing it.
 *
 * Twelve, because the reduction is read at its deepest and a fast attack on a
 * drum hit reads several decibels deeper than the work it is doing to the
 * body of the sound. Measured on the loop, the settings that level it land
 * between eighteen and twenty-four decibels at their deepest, and a limiter
 * set to flatten it reads forty-five.
 */
const OVERWORKED = 12;

/* ---------- reading what came out ---------- */

/**
 * How loud each beat is, in dB.
 *
 * Loudness rather than peak, and the distinction is the whole exercise. A
 * compressor with any attack worth the name does not touch a drum's peak -
 * the peak is over in a millisecond or two, which is what the attack knob is
 * for - it works on the body of the hit. Marked on peaks, a loop levelled by
 * a good engineer read no better than one nobody had touched, and the only
 * thing that scored was a limiter set to destroy. Marked on loudness, the
 * reading agrees with the ear.
 */
function beatLevels(samples) {
  const span = Math.floor(samples.length / BEATS);
  const levels = [];

  for (let beat = 0; beat < BEATS; beat += 1) {
    let sum = 0;
    const end = Math.min(samples.length, (beat + 1) * span);
    for (let i = beat * span; i < end; i += 1) sum += samples[i] * samples[i];
    levels.push(10 * Math.log10(sum / Math.max(1, end - beat * span) + 1e-12));
  }

  return levels;
}

/**
 * What the sidechain is doing, beat by beat: how far the signal is pushed
 * down when the key hits, and how long it takes to come back.
 *
 * Recovery is measured to within a decibel of where it started rather than
 * all the way, because the last decibel of an exponential takes forever and
 * nobody hears it arrive.
 */
function duckOf(gr, rate) {
  const span = Math.floor(gr.length / BEATS);
  const depths = [];
  const recoveries = [];
  let held = 0;   // beats that never came back up before the next one

  for (let beat = 0; beat < BEATS; beat += 1) {
    const from = beat * span;
    const to = Math.min(gr.length, from + span);

    let deepest = 0;
    let at = from;
    for (let i = from; i < to; i += 1) {
      if (gr[i] < deepest) { deepest = gr[i]; at = i; }
    }
    if (deepest > -0.5) continue;

    depths.push(-deepest);
    let back = null;
    for (let i = at; i < to; i += 1) {
      if (gr[i] > -1) { back = i; break; }
    }
    // Still down when the next one lands. Reporting the gap between kicks as
    // though it had recovered would read as a long release rather than as a
    // release so long the track never comes back up, which is a different
    // mistake and wants saying differently.
    if (back === null) { held += 1; continue; }
    recoveries.push(((back - at) / rate) * 1000);
  }

  const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0);
  return {
    depth: mean(depths),
    recovery: mean(recoveries),
    hits: depths.length,
    held,
  };
}

/**
 * A stand-in for the loop, for the times the real thing is not to hand.
 *
 * The surface renders the material the moment it mounts, so in the app this
 * is never what marks a guess. It exists so that scoring is a pure function
 * that a test can call without an audio context, and so that a guess
 * submitted in the first moments of a round is read rather than dropped.
 */
function probeFor(rate, uneven = 0) {
  const seconds = 4;
  const samples = new Float32Array(Math.round(rate * seconds));
  const span = samples.length / BEATS;
  const quiet = 10 ** (-uneven / 20);

  for (let beat = 0; beat < BEATS; beat += 1) {
    const level = beat % 2 === 1 ? quiet : 1;
    const from = Math.floor(beat * span);
    const length = Math.floor(rate * 0.22);

    for (let i = 0; i < length && from + i < samples.length; i += 1) {
      const t = i / rate;
      // A struck sound: a low body under a bright edge, decaying fast.
      const body = Math.sin(2 * Math.PI * 90 * t) * Math.exp(-t * 22);
      const edge = Math.sin(2 * Math.PI * 1800 * t) * Math.exp(-t * 90);
      samples[from + i] = 0.62 * level * (body + 0.35 * edge);
    }
  }

  return samples;
}

/**
 * A track for the key to work on: sustained, the way a bass is.
 *
 * The ducking exercise needs two stems or it is not about ducking at all. A
 * compressor pointed at a train of hits ducks on every one of them whether or
 * not it is keyed, so a stand-in made of hits alone let an un-keyed
 * compressor pass for a sidechain - it measured 8.7 dB of duck and 287 ms of
 * recovery off nothing but its own transients.
 */
function steadyProbe(rate) {
  const samples = new Float32Array(Math.round(rate * 4));
  for (let i = 0; i < samples.length; i += 1) {
    const t = i / rate;
    samples[i] = 0.45 * (Math.sin(2 * Math.PI * 55 * t) + 0.35 * Math.sin(2 * Math.PI * 110 * t));
  }
  return samples;
}

/** The audio a guess is read against - the exercise's own, never the monitor's. */
function materialOf(puzzle) {
  if (puzzle?.material?.samples) return puzzle.material;

  const rate = 48000;
  if ((puzzle?.settings?.exercise ?? 'match') === 'duck') {
    const bass = steadyProbe(rate);
    return { rate, samples: bass, even: bass, key: probeFor(rate, 0) };
  }

  return {
    rate,
    samples: probeFor(rate, puzzle?.uneven ?? 0),
    even: probeFor(rate, 0),
    key: null,
  };
}

const settle = (guess) => ({ ...COMP_DEFAULTS, ...guess });

/* --- the drill ------------------------------------------------------------ */

/**
 * How much it is doing, in the amounts an engineer says out loud.
 *
 * "Gain reduction" has two meanings on a drum loop and only one of them is a
 * thing you can hear. The meter's needle is the deepest moment, and on drums
 * with any attack at all that is a transient - measured here, the same
 * compressor reads -16.5 dB at its deepest with a 1 ms attack and -6.0 dB
 * with a 60 ms one, while doing much the same work to the body of the sound.
 * What you hear is the other one: how much quieter the loop got overall,
 * which is exactly the gain auto-makeup puts back. So that is what these
 * numbers are, and it is what the solver below hits.
 */
const REDUCTIONS = [
  { id: '0', db: 0, symbol: '0', name: 'none' },
  { id: '2', db: 2, symbol: '2', name: 'a touch' },
  { id: '4', db: 4, symbol: '4', name: 'gentle' },
  { id: '6', db: 6, symbol: '6', name: 'working' },
  { id: '9', db: 9, symbol: '9', name: 'hard' },
  { id: '12', db: 12, symbol: '12', name: 'squashed' },
];

const reductionAt = (id) => REDUCTIONS.findIndex((r) => r.id === id);

/**
 * The compressor the drill sets, and which amounts it offers.
 *
 * Ratio and attack are fixed so the only thing that moves between rounds is
 * how much it is doing, which is the question. 8:1 at 5 ms reaches the whole
 * range on this loop - measured, the thresholds that hit 0, 2, 4, 6, 9 and 12
 * dB are 0, -12.5, -17, -21.5, -30 and -41 - where a gentler 4:1 at 10 ms
 * runs out at 11.3 dB with the threshold on the floor.
 *
 * What makes two of these sound different, level-matched, is the crest
 * factor: peak over RMS, which is how much of the loop is transient and how
 * much is body. Measured on the same renders it climbs 21.6, 23.1, 24.9,
 * 26.6, 28.8, 30.5 dB across the six - 1.5 to 2.2 dB a step, every step in
 * the same direction. That is the sound of it: the hits stay and everything
 * between them comes up.
 *
 * `near` is one step where the steps are 2 dB, and nothing at the easy tier,
 * whose three amounts are 4 and 5 dB apart - the same rule the EQ drill
 * follows, and for the same reason.
 */
const REDUCTION_DRILL = {
  easy: { amounts: ['0', '4', '9'], near: 0 },
  medium: { amounts: REDUCTIONS.map((r) => r.id), near: 1 },
  hard: { amounts: REDUCTIONS.map((r) => r.id), near: 0 },
};

/** Fixed, so that the only thing that changes between rounds is the amount. */
const DRILL_SHAPE = { ratio: 8, attack: 5, release: 150, knee: 6 };

/**
 * The threshold that takes `want` decibels off this loop.
 *
 * Solved rather than stored, because the answer is a property of the audio:
 * the same threshold does a different amount of work to a different loop, and
 * the loop is rendered by the browser at a sample rate this code does not
 * choose. Bisection over the threshold, with the compressor run over the
 * material each time - fourteen passes, which is one more than enough to land
 * inside a tenth of a decibel.
 *
 * This runs once per round, in `startOf`, which the session calls after the
 * material has arrived and been pinned. Before that there is nothing to solve
 * against.
 */
const solved = new Map();

function thresholdFor(want, samples, rate) {
  if (want <= 0) return 0;

  // Kept, because the answer is a property of the loop and the loop does not
  // change: the same six thresholds come out for every round of every tier.
  // Fourteen passes over a five-second loop is about 300 ms, which is a
  // noticeable stall to pay once and absurd to pay every round.
  const held = `${materialStamp(samples)}:${rate}:${want}`;
  if (solved.has(held)) return solved.get(held);

  let low = -60;
  let high = 0;
  for (let i = 0; i < 14; i += 1) {
    const mid = (low + high) / 2;
    if (analyse(samples, rate, { ...COMP_DEFAULTS, ...DRILL_SHAPE, threshold: mid }).makeup < want) {
      high = mid;
    } else {
      low = mid;
    }
  }

  const threshold = toStep((low + high) / 2, 0.5);
  solved.set(held, threshold);
  return threshold;
}

/** The compressor that does this round's amount of work to this round's loop. */
function drillSettings(puzzle) {
  const { samples, rate } = materialOf(puzzle);
  const want = REDUCTIONS[reductionAt(puzzle.answer.reduction)].db;
  const threshold = thresholdFor(want, samples, rate);

  // The makeup is the measured reduction put back, so that the two sides of
  // the A/B are the same loudness. Without it the drill is "which one is
  // quieter", which is a level test and not a compression test.
  const settings = { ...COMP_DEFAULTS, ...DRILL_SHAPE, threshold, makeup: 0 };
  settings.makeup = want <= 0 ? 0 : analyse(samples, rate, settings).makeup;
  return settings;
}

/**
 * The three exercises, in the shape a session can set up.
 *
 * This is the descriptor that used to be spelled out inside `mount` - the
 * source, the key, the A/B's name, the fault and the target - and having it
 * as data is what lets one tool be handed from one exercise to the next
 * without being destroyed in between.
 *
 * In match there is a compressor on the other side of the A/B. In the other
 * two there is nothing there: what you compare against is the loop untouched,
 * which is what a bypass button is.
 */
export const COMP_EXERCISES = {
  match: {
    id: 'match',
    label: 'Match the target',
    source: 'drums',
    sourceOptions: { key: null },
    other: 'Target',
    faultOf: () => null,
    targetOf: (puzzle) => puzzle.answer,
  },
  fix: {
    id: 'fix',
    label: 'Even it out',
    source: 'drums',
    sourceOptions: { key: null },
    other: 'Untreated',
    faultOf: (puzzle) => ({ uneven: puzzle.uneven ?? 0 }),
    targetOf: () => ({ ...COMP_DEFAULTS, mix: 0 }),
  },
  duck: {
    id: 'duck',
    label: 'Duck it',
    source: 'bass',
    sourceOptions: { key: 'kick' },
    other: 'Untreated',
    faultOf: () => null,
    targetOf: () => ({ ...COMP_DEFAULTS, mix: 0 }),
  },
  drill: {
    id: 'drill',
    label: 'How much is it doing?',
    drill: true,
    ask: 'How much gain reduction is this compressor doing?',
    lede: 'Nothing to dial here. A compressor is on the loop and the level has '
        + 'been put back, so what is left to hear is how hard it is working.',
    opening: 'Play it, flip to the uncompressed side, then say how much.',
    tierBlurbs: {
      easy: 'Three amounts, far apart',
      medium: 'Six amounts, a step forgiven',
      hard: 'Six amounts, exact',
    },
    source: 'drums',
    sourceOptions: { key: null },
    other: 'Untreated',
    faultOf: () => null,
    targetOf: () => ({ ...COMP_DEFAULTS, mix: 0 }),

    // The compressor goes on the tool rather than into the material, because
    // a compressor doing 6 dB is a compressor and not a faulty loop. Which
    // means the tool's own controls are the answer - so `restores` puts them
    // back on the way out, or the next exercise opens with them on the knobs.
    startOf: (puzzle) => drillSettings(puzzle),
    cleanOf: () => ({ ...COMP_DEFAULTS, mix: 0, makeup: 0 }),
    restores: true,
  },
};

/**
 * Name the amount.
 *
 * Two readings for one chip, because a chip on its own only repeats the guess
 * back. The second is the useful one: how far off, and which way - "two steps
 * light" is a correction, "wrong" is not.
 */
function scoreReduction(state, puzzle) {
  const { answer, tier } = puzzle;
  const spec = REDUCTION_DRILL[tier] ?? REDUCTION_DRILL.medium;
  const offered = REDUCTIONS.filter((r) => spec.amounts.includes(r.id));

  const guessedAt = offered.findIndex((r) => r.id === state.reduction);
  const answerAt = offered.findIndex((r) => r.id === answer.reduction);
  const mark = onScale(guessedAt, answerAt, { near: spec.near });

  const guessed = REDUCTIONS[reductionAt(state.reduction)];
  const wanted = REDUCTIONS[reductionAt(answer.reduction)];
  const off = guessed.db - wanted.db;

  return {
    correct: mark === HIT,
    cells: [
      { state: mark, text: `${guessed.symbol} dB · ${guessed.name}` },
      {
        state: mark,
        text: off === 0 ? 'that is it'
          : `${Math.abs(off)} dB too ${off > 0 ? 'much' : 'little'}`,
        narrow: true,
      },
    ],
    why: [
      {
        label: 'How far off',
        value: off === 0 ? 'on it' : `${Math.abs(off)} dB ${off > 0 ? 'over' : 'under'}`,
        how: 'In decibels of reduction, not in chips - the amounts on offer are '
           + 'not evenly spaced, and the easy tier leaves some out.',
      },
      {
        label: 'What reduction means here',
        value: 'how much quieter the loop got',
        how: 'Not the meter\'s deepest moment: on drums that is a transient, and '
           + 'the same compressor reads -16.5 dB at its deepest with a 1 ms '
           + 'attack and -6.0 dB with a 60 ms one while doing much the same '
           + 'work. This is the overall level the compressor took off, which is '
           + 'exactly what auto-makeup puts back - and what you can hear.',
      },
      {
        label: 'What tells them apart',
        value: 'the crest factor, about 2 dB a step',
        how: 'Measured on this loop, level-matched: peak over RMS climbs 21.6, '
           + '23.1, 24.9, 26.6, 28.8, 30.5 dB across the six amounts. The hits '
           + 'stay where they are and everything between them comes up, which '
           + 'is what more compression sounds like on drums.',
      },
    ],
  };
}

export const COMP_WORK = {
  tool: 'compression',
  opening: 'Play the loop, work the compressor, then lock it in.',

  settings: [
    {
      id: 'exercise',
      label: 'Exercise',
      options: Object.values(COMP_EXERCISES).map(({ id, label }) => ({ id, label })),
    },
  ],

  exercises: COMP_EXERCISES,

  tiers: {
    easy: { label: 'Easy', blurb: 'Threshold and ratio', guesses: 4, timing: false, knee: false },
    medium: { label: 'Medium', blurb: 'And the timing', guesses: 4, timing: true, knee: false },
    hard: { label: 'Hard', blurb: 'And the knee', guesses: 4, timing: true, knee: true },
  },

  /**
   * Answered on the plugin, except in the drill - which is a listening
   * question, and asks with chips.
   */
  slots(tier, settings) {
    if (settings?.exercise !== 'drill') return [];

    const spec = REDUCTION_DRILL[tier] ?? REDUCTION_DRILL.medium;
    return [{
      id: 'reduction',
      kind: 'choice',
      label: 'How much reduction',
      options: REDUCTIONS.filter((r) => spec.amounts.includes(r.id)),
    }];
  },

  makePuzzle(rng, tier, settings) {
    const spec = this.tiers[tier];

    if (settings.exercise === 'drill') {
      const drill = REDUCTION_DRILL[tier] ?? REDUCTION_DRILL.medium;
      const amount = pick(rng, REDUCTIONS.filter((r) => drill.amounts.includes(r.id)));
      // The settings that produce it are not here: they depend on the loop,
      // which does not exist yet. `startOf` works them out once it does.
      return { answer: { reduction: amount.id } };
    }

    if (settings.exercise === 'fix') {
      // The loop's hits are `uneven` dB apart. There is no set of knobs that
      // is the answer - the answer is a loop that sits still.
      return { uneven: toStep(9 + rng() * 6, 1), answer: null };
    }

    if (settings.exercise === 'duck') {
      return {
        answer: {
          depth: toStep(4 + rng() * 8, 0.5),
          recovery: toStep(logPick(rng, 120, 420), 10),
        },
      };
    }

    // The threshold sits well under the peak of the bed, because the bed is
    // drums: sparse, and quiet between the hits, so its average level is a
    // long way below the tops. Drawn from -8 dBFS down, as the obvious range,
    // most targets did under a decibel of work - and a target that does
    // nothing is one that anybody matches by doing nothing. Measured on the
    // loop: -42 does three to six decibels, -26 does one and a half to three.
    const answer = {
      ...COMP_DEFAULTS,
      threshold: toStep(-42 + rng() * 16, 0.5),
      ratio: toStep(logPick(rng, 2.5, 12), 0.1),
    };

    if (spec.timing) {
      answer.attack = toStep(logPick(rng, 1, 60), 0.5);
      answer.release = toStep(logPick(rng, 40, 600), 5);
    }
    if (spec.knee) answer.knee = toStep(rng() * 18, 0.5);

    return { answer };
  },

  /* ---------- marking ---------- */

  score(state, puzzle) {
    const { answer, tier } = puzzle;
    const guess = state;
    const exercise = puzzle?.settings?.exercise ?? 'match';
    if (exercise === 'drill') return scoreReduction(guess, puzzle);

    const material = materialOf(puzzle);
    const settings = settle(guess);

    if (exercise === 'fix') return this.scoreFix(settings, material, tier, puzzle);
    if (exercise === 'duck') return this.scoreDuck(settings, answer, material, tier);
    return this.scoreMatch(settings, answer, material, tier);
  },

  /**
   * Two compressors over the same audio, compared by what they did to it.
   *
   * The reduction moment by moment is the compressor's whole output - depth
   * and timing together - so the distance between two of them is the distance
   * between two settings in the only terms that matter. Framed at five
   * milliseconds first, so that a single sample of disagreement on a transient
   * does not read as a wrong answer.
   */
  scoreMatch(guess, answer, material, tier) {
    const { samples, rate, key } = material;
    // The reading is the framed form, and the framing is the reading's rather
    // than this function's. What used to be here took two settings objects,
    // ran both passes, framed both results and compared them - five steps of
    // which only the last is about marking a guess.
    const gap = distance(
      reductionReading(samples, rate, guess, key),
      reductionReading(samples, rate, answer, key),
    );

    const error = gap.off;
    const { depth, shape } = gap.detail;
    const close = COMP_CLOSE.match[tier];
    const mark = error <= close ? HIT : error <= close * 2.5 ? NEAR : MISS;

    return {
      correct: error <= close,
      error,
      cells: [
        { state: mark, text: `${error.toFixed(1)} dB out` },
        {
          state: mark,
          text: error <= close ? 'sits on it'
            : Math.abs(depth) > shape ? `${Math.abs(depth).toFixed(1)} dB too ${depth > 0 ? 'gentle' : 'hard'}`
            : 'right depth, wrong timing',
        },
      ],
      why: [
        {
          label: 'Reduction, compared',
          value: `${error.toFixed(2)} dB RMS apart`,
          how: 'Both compressors are run over the same loop and what they did to '
             + 'it - the gain reduction, moment by moment - is framed at five '
             + 'milliseconds and compared frame by frame. Framed first so that a '
             + 'single sample of disagreement on a transient does not read as a '
             + 'wrong answer.',
        },
        {
          label: 'Amount',
          value: `${depth > 0 ? '+' : ''}${depth.toFixed(2)} dB`
               + `${Math.abs(depth) < 0.05 ? '' : depth > 0 ? ' - yours works less' : ' - yours works harder'}`,
          how: 'The average of that difference. This is threshold and ratio: how '
             + 'much reduction yours does overall, regardless of when.',
        },
        {
          label: 'Timing',
          value: `${shape.toFixed(2)} dB`,
          how: 'What is left once the amount is taken out. This is attack and '
             + 'release - the same total reduction arriving and leaving at a '
             + 'different moment - and it is the half most people find hard to '
             + 'hear.',
        },
      ],
    };
  },

  /**
   * Did the loop end up sitting still, and at what cost.
   *
   * Sitting still is not every beat at the same level. A kick and a snare are
   * not the same loudness on any record ever made, and a reading that asked
   * for it would hand full marks to the one answer an engineer would call
   * wrong - everything flattened. What is being taken out is the fault, so
   * what the result is held against is the same loop without the fault in it:
   * the profile the bed would have had, which the surface renders alongside.
   *
   * Overall level is taken out of both first. Making the loop even is the
   * question; making it loud is what the makeup gain is for.
   */
  scoreFix(guess, material, tier, puzzle) {
    const { samples, even, rate, key } = material;
    const { out, gr } = runCompressor(samples, rate, guess, key);

    const mine = beatLevels(out);
    const want = beatLevels(even);
    const mean = (list) => list.reduce((a, b) => a + b, 0) / list.length;
    const mineMean = mean(mine);
    const wantMean = mean(want);

    let sum = 0;
    for (let i = 0; i < mine.length; i += 1) {
      sum += ((mine[i] - mineMean) - (want[i] - wantMean)) ** 2;
    }
    const off = Math.sqrt(sum / mine.length);

    let deepest = 0;
    for (const value of gr) if (value < deepest) deepest = value;

    const uneven = puzzle?.uneven ?? 12;
    const ceiling = uneven + OVERWORKED;
    const close = COMP_CLOSE.fix[tier];

    const level = off <= close;
    const gentle = -deepest <= ceiling;
    const mark = level && gentle ? HIT : (off <= close * 2.2 && gentle) ? NEAR : MISS;

    return {
      correct: level && gentle,
      error: off,
      cells: [
        { state: mark, text: `${off.toFixed(1)} dB out of line` },
        {
          state: gentle ? mark : MISS,
          text: !gentle ? `${(-deepest).toFixed(0)} dB of reduction — squashed`
            : level ? 'sits still'
            : off > uneven / 3 ? 'barely touched'
            : 'closer',
        },
      ],
      why: [
        {
          label: 'Beats out of line',
          value: `${off.toFixed(2)} dB, from ${uneven} dB`,
          how: 'Each beat of your output is measured and held against the same '
             + 'loop without the fault in it - not against every beat being the '
             + 'same loudness, because a kick and a snare are not the same '
             + 'loudness on any record ever made. Overall level is taken out of '
             + 'both first: making it even is the question, making it loud is '
             + 'what the makeup gain is for.',
        },
        {
          label: 'Deepest reduction',
          value: `${(-deepest).toFixed(1)} dB, ceiling ${ceiling} dB`,
          how: `The most the compressor pulled down at any moment. Flattening `
             + `everything would level the loop perfectly and throw the `
             + `performance away, so anything past ${OVERWORKED} dB more than the `
             + `fault itself fails whatever the levels came out at.`,
        },
      ],
    };
  },

  /** Did the bass get out of the way, by how much, and for how long. */
  scoreDuck(guess, answer, material, tier) {
    const { samples, rate, key } = material;
    const { gr } = analyse(samples, rate, guess, key);
    const got = duckOf(gr, rate);

    const close = COMP_CLOSE.duck[tier];
    const depthOff = Math.abs(got.depth - answer.depth);
    // Time is heard in ratios, so being out by a hundred milliseconds means
    // something different at 120 than it does at 400.
    const stuck = got.hits === 0 || got.recovery <= 0;
    const timeOff = stuck ? 4 : Math.abs(Math.log2(got.recovery / answer.recovery));

    const depthOk = depthOff <= close;
    const timeOk = timeOff <= 0.42; // a third of the way to twice as long
    const mark = depthOk && timeOk ? HIT : (depthOk || timeOff <= 0.8) ? NEAR : MISS;

    return {
      correct: depthOk && timeOk,
      error: depthOff,
      cells: [
        {
          state: depthOk ? HIT : depthOff <= close * 2.5 ? NEAR : MISS,
          text: got.hits === 0 ? 'not ducking' : `${got.depth.toFixed(1)} dB of duck`,
        },
        {
          state: timeOk ? HIT : timeOff <= 0.8 ? NEAR : MISS,
          text: got.hits === 0 ? 'key it off the kick'
            : stuck ? 'never comes back up'
            : got.held ? `back in ${Math.round(got.recovery)} ms, when it comes back`
            : `back in ${Math.round(got.recovery)} ms`,
        },
      ],
      why: [
        {
          label: 'Depth',
          value: `${got.depth.toFixed(2)} dB, wanted ${answer.depth.toFixed(1)}`,
          how: 'Measured off the gain reduction at each kick rather than read off '
             + 'the threshold and ratio, because what a sidechain actually does '
             + 'depends on how loud the key signal is when it arrives.',
        },
        {
          label: 'Recovery',
          value: stuck ? 'never comes back up'
               : `${Math.round(got.recovery)} ms, wanted ${Math.round(answer.recovery)}`,
          how: 'How long it takes to climb back to within a couple of decibels of '
             + 'where it started, averaged over the kicks in the loop.',
        },
        {
          label: 'Time, as a ratio',
          value: stuck ? 'out of range' : `${timeOff.toFixed(2)} octaves out`,
          how: 'Time is heard in ratios, so this is compared in log space: a '
             + 'hundred milliseconds out means something quite different at 120 '
             + 'than it does at 400. A third of the way to twice as long is the '
             + 'window.',
        },
      ],
    };
  },

  /**
   * The way out, in two rungs, worked out from the answer.
   *
   * What people get wrong first on a compressor is almost never the number -
   * it is the kind of thing being asked for. So the first rung says what sort
   * of compression this is, and the second puts a region round the control
   * that is doing the work.
   */
  hints(puzzle) {
    const { answer, tier } = puzzle;
    const exercise = puzzle?.settings?.exercise ?? 'match';

    if (exercise === 'drill') {
      const amount = REDUCTIONS[reductionAt(answer.reduction)];
      return [
        amount.db === 0
          ? 'Listen to the transients: if the hits still jump the way they do '
            + 'untreated, nothing is being done to them at all.'
          : 'Flip to the untreated side and back. The level is matched, so what '
            + 'changes is how much of the loop sits between the hits.',
        amount.db === 0 ? 'Nothing is being held down here.'
          : amount.db <= 4 ? 'It is in the half an engineer would call polite - '
            + 'you would have to be listening for it.'
          : 'It is in the half you can hear without being told - the loop has '
            + 'visibly less room in it.',
        `An engineer would describe this one as ${amount.name}.`,
      ];
    }

    if (exercise === 'fix') {
      const uneven = puzzle?.uneven ?? 12;
      return [
        `The loop is about ${uneven} dB apart beat to beat, and the job is to `
          + 'close that up without flattening it.',
        'Work down from a gentle ratio rather than up from a hard one: the '
          + 'threshold is doing most of this, and there is a ceiling on how much '
          + 'reduction counts as levelling rather than squashing.',
      ];
    }

    if (exercise === 'duck') {
      return [
        'This is keyed off the kick, so the detector is listening to something '
          + 'other than what you are hearing come out.',
        `It wants around ${answer.depth.toFixed(0)} dB of duck, back up in `
          + `${answer.recovery < 180 ? 'under a fifth of a second' : answer.recovery < 320 ? 'roughly a quarter of a second' : 'something over a third of a second'}. `
          + 'The release is what sets that, not the ratio.',
      ];
    }

    const settings = settle(answer);
    const ratio = settings.ratio;
    return [
      ratio >= 8 ? 'It is working hard - a limiting sort of ratio, not a gentle one.'
        : ratio >= 4 ? 'It is a working ratio: audible, but not limiting.'
        : 'It is gentle - a low ratio doing a little, everywhere.',
      `The attack is ${settings.attack < 8 ? 'fast enough to catch the transient'
        : settings.attack < 40 ? 'middling - the transient gets through, then it clamps'
        : 'slow: it lets the hit past before it does anything'}, and the release is `
        + `${settings.release < 120 ? 'short' : settings.release < 350 ? 'medium' : 'long'}.`,
    ];
  },

  reveal(puzzle) {
    const { answer } = puzzle;
    const exercise = puzzle?.settings?.exercise ?? 'match';

    if (exercise === 'drill') {
      const amount = REDUCTIONS[reductionAt(answer.reduction)];
      return {
        symbol: `${amount.db} dB`,
        name: amount.db === 0 ? 'of gain reduction, which is to say none at all'
          : `of gain reduction, which an engineer would call ${amount.name}`,
      };
    }

    if (exercise === 'fix') {
      return {
        symbol: `${puzzle?.uneven ?? 12} dB apart`,
        name: 'level it without flattening it',
      };
    }

    if (exercise === 'duck') {
      return {
        symbol: `${answer.depth.toFixed(1)} dB`,
        name: `of duck, back in ${Math.round(answer.recovery)} ms`,
      };
    }

    const settings = settle(answer);
    return {
      symbol: writeRatio(settings.ratio),
      name: `over ${settings.threshold.toFixed(1)} dB, `
          + `${writeTime(settings.attack)} / ${writeTime(settings.release)}`,
    };
  },

  /** What a guess says it heard, in `weak`'s own words. */
  heard(guess, puzzle) {
    if ((puzzle?.settings?.exercise ?? 'match') !== 'drill') return null;
    const amount = REDUCTIONS[reductionAt(guess.reduction)];
    if (!amount) return null;
    return { key: `reduction-${amount.id}`, label: `${amount.db} dB (${amount.name})` };
  },

  weak(puzzle) {
    const { answer } = puzzle;
    const exercise = puzzle?.settings?.exercise ?? 'match';

    if (exercise === 'drill') {
      const amount = REDUCTIONS[reductionAt(answer.reduction)];
      return { key: `reduction-${amount.id}`, label: `${amount.db} dB (${amount.name})` };
    }
    if (exercise === 'fix') return { key: 'levelling', label: 'levelling a loop' };
    if (exercise === 'duck') return { key: 'sidechain', label: 'sidechain ducking' };

    const ratio = settle(answer).ratio;
    const hard = ratio >= 8 ? 'hard ratios' : ratio >= 4 ? 'working ratios' : 'gentle ratios';
    return { key: hard, label: hard };
  },
};
