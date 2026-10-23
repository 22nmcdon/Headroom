import { VERB_DEFAULTS, makeImpulse, roomProfile } from '../../plugins/reverb/ir.js';
import { decayCurve, decayReading, monoOf, rt60 } from '../../lib/response.js';
import { distance } from '../../gap.js';
import { writeSeconds } from '../../plugins/reverb/plugin.js';
import { LOOP_BEAT } from '../../lib/tempo.js';
import { HIT, NEAR, MISS, onScale, dialled, logPick, toStep, pick } from './scoring.js';

/**
 * The room, as a thing you build rather than a thing you name.
 *
 * Two exercises. **Match the space** puts a room on the loop and asks you to
 * build the same one. **Fit the tempo** asks for a room that belongs to this
 * track: one that answers on the beat and is gone before the next one lands,
 * which is what setting a reverb to a song actually consists of.
 *
 * Both are marked on the decay - how much of the room is still to come, band
 * by band, moment by moment. One reading covers every control at once: the
 * slope of it is the decay time, the flat part at the start is the pre-delay,
 * the three bands pulling apart is the damping, the first few decibels are
 * the early reflections, and where each band starts is what the send filters
 * did. So two rooms whose decays sit on each other are the same room, however
 * their knobs were arrived at - the same decision the EQ and the compressor
 * make, for the same reason.
 */

/* --- the drill ------------------------------------------------------------ */

/**
 * How big the space is, which is a different question from how long it rings.
 *
 * Size is where the first walls are, and what it does is set the gap before
 * the room answers. Measured, with the pre-delay at zero so that nothing else
 * is making a gap: six metres answers at 6.9 ms, eighteen at 20.7 and forty
 * at 46.0. That is the slap you hear in front of the tail, and it is what
 * tells a tiled bathroom from a church at the same decay time.
 *
 * Three, and exact or nothing at every tier. Small, medium and large are
 * three kinds of space rather than three points on a scale, and a room that
 * is nearly a hall is a room.
 */
const SIZES = [
  { id: 'small', metres: 6, symbol: 'Small', name: 'a room' },
  { id: 'medium', metres: 18, symbol: 'Medium', name: 'a hall' },
  { id: 'large', metres: 40, symbol: 'Large', name: 'a church' },
];

const sizeAt = (id) => SIZES.findIndex((size) => size.id === id);

/**
 * What the tail is dialled against, and how close counts.
 *
 * The answer is the RT60 this app measures off the room it built, not the
 * number on the decay control - they are not the same, and the ear hears the
 * first. Measured: a decay of 0.5 rings for 0.35-0.44 s, 1.2 for 0.78-1.04,
 * 2.6 for 1.67-1.88 and 5.0 for 3.15-3.32, the spread across the three sizes.
 * So the control reads about half again as long as the room actually rings,
 * and a drill marked on the control would be teaching that number.
 *
 * Close is a ratio, because time is heard in ratios: half a second against
 * three quarters is an obviously different room, and three seconds against
 * three and a quarter is not. A fifth of an octave is about 15 per cent.
 * Loosened at the easy tier, because this is dialled blind - there is no
 * second room to compare against, and judging a decay in the absolute is a
 * good deal harder than telling two apart.
 */
const TAIL_DRILL = {
  easy: { sizes: ['small', 'large'], decays: [0.8, 3.6], hit: 0.5, near: 1.0 },
  medium: { sizes: SIZES.map((s) => s.id), decays: [0.5, 1.2, 2.6, 5.0], hit: 0.35, near: 0.7 },
  hard: {
    sizes: SIZES.map((s) => s.id),
    decays: [0.5, 0.8, 1.2, 1.8, 2.6, 3.6, 5.0],
    hit: 0.25,
    near: 0.5,
  },
};

/** The room a drill round is built from, and how long it actually rings. */
function drillRoom(size, decay) {
  return {
    ...VERB_DEFAULTS,
    size: SIZES[sizeAt(size)].metres,
    decay,
    // Zero, so that the gap before the room answers is the size and nothing
    // else. A pre-delay would be a second answer to the same question.
    preDelay: 0,
    early: 0.45,
    damping: 0.55,
    mix: 0.45,
  };
}

const measuredTail = (room) => rt60(monoOf(makeImpulse(48000, { ...room, mix: 1 })), 48000);

/** What each exercise is played on, and what the other side of the A/B is. */

/**
 * How far two rooms may be apart, in decibels of decay, and still match.
 *
 * Set from measurement. Over seventy of the targets this mode generates: a
 * decay fifteen per cent too long reads about 1.4 dB out, forty per cent too
 * long reads about 3.3, a mix fifteen points off reads about 3, and the
 * damping left off reads about 4.2. So easy forgives the fifteen per cent,
 * medium does not, and hard wants the pre-delay as well. The room the plugin
 * opens on is never closer than 3.5 dB to a target, so submitting it
 * untouched fails at every tier.
 *
 * The tempo numbers are how far past the window still reads as near rather
 * than as a miss; the window itself is below.
 */
const VERB_CLOSE = {
  match: { easy: 1.7, medium: 1.1, hard: 0.75 },
  tempo: { easy: 6, medium: 5, hard: 4 },
};

/** How far out the pre-delay may be, as a fraction of the subdivision. */
const IN_TIME = { easy: 0.35, medium: 0.22, hard: 0.14 };

/**
 * Where the tail has to have got to by the time the next hit lands - and how
 * much deader than that still counts.
 *
 * A range rather than a number, because a range is what the ear actually
 * gives you. Nobody hears "the tail is thirty decibels down"; what anybody
 * hears is whether the room is still ringing when the next hit arrives, and
 * that is a threshold. Asked for thirty decibels give or take two and a half,
 * the window came to about seven per cent of the decay time - finer than the
 * knob feels. Asked for gone, but no deader than it needs to be, it is the
 * judgement an engineer is actually making: as much room as the track will
 * take.
 */
const CLEARED = -30;
const STILL_A_ROOM = { easy: 20, medium: 14, hard: 9 };

/**
 * The subdivisions a reverb is asked to answer on.
 *
 * Its own list rather than the delay's: a pre-delay is a gap of a few tens of
 * milliseconds and a delay is a repeat of a few hundred, so the two want
 * different ends of the bar.
 */
const PRE_DIVISIONS = [
  { id: 'thirtysecond', label: 'a 32nd', beats: 1 / 8 },
  { id: 'sixteenth', label: 'a 16th', beats: 1 / 4 },
  { id: 'eighth', label: 'an 8th', beats: 1 / 2 },
];

/**
 * The two exercises, in the shape a session can set up.
 *
 * In match there is a room on the other side of the A/B. In the tempo
 * exercise there is nothing there: what you compare against is the loop with
 * no room on it at all.
 */
export const VERB_EXERCISES = {
  match: {
    id: 'match',
    label: 'Match the space',
    source: 'instrument',
    other: 'Target',
    targetOf: (puzzle) => puzzle.answer,
  },
  tempo: {
    id: 'tempo',
    label: 'Fit the tempo',
    source: 'drums',
    other: 'Dry',
    targetOf: () => ({ ...VERB_DEFAULTS, mix: 0 }),
  },
  drill: {
    id: 'drill',
    label: 'How big, how long?',
    drill: true,
    ask: 'How long does this room ring, and how big is it?',
    lede: 'There is a room on this sound. Say how long its tail runs, in '
        + 'seconds, and whether the space is a room, a hall or a church.',
    opening: 'Play it dry and wet. Listen for the gap before it answers, then '
           + 'for how long it takes to go.',
    tierBlurbs: {
      easy: 'Two spaces, two lengths, 1.41× either way',
      medium: 'Three spaces, 1.27× either way',
      hard: 'Three spaces, 1.19× either way',
    },
    source: 'instrument',
    other: 'Dry',
    targetOf: () => ({ ...VERB_DEFAULTS, mix: 0 }),

    startOf: (puzzle) => puzzle.room,
    cleanOf: () => ({ ...VERB_DEFAULTS, mix: 0 }),
    restores: true,
  },
};

/**
 * Name the size, dial the tail.
 *
 * The dialled reading comes first because it is the one that says which way
 * to move, and because that is where the shell looks for it. `dialled` does
 * the arithmetic in ratios - the unit is a factor, not a number of seconds -
 * so a reading comes back as "1.4x long" rather than "0.6 s out", which is
 * the difference between a correction and a number.
 */
function scoreRoom(state, puzzle) {
  const { answer, tier } = puzzle;
  const spec = TAIL_DRILL[tier] ?? TAIL_DRILL.medium;
  const offered = SIZES.filter((size) => spec.sizes.includes(size.id));

  const tail = dialled(state.tail, answer.tail, {
    unit: 'x', hit: spec.hit, near: spec.near, below: 'short', above: 'long',
  });
  const size = onScale(
    offered.findIndex((s) => s.id === state.size),
    offered.findIndex((s) => s.id === answer.size),
    // Exact or nothing: small, medium and large are three kinds of space, and
    // a room that is nearly a hall is a room.
    { near: 0 },
  );

  const guessed = SIZES[sizeAt(state.size)];
  const correct = tail.state === HIT && size === HIT;

  return {
    correct,
    cells: [
      tail,
      { state: size, text: guessed.symbol },
      {
        state: correct ? HIT : tail.state === HIT || size === HIT ? NEAR : MISS,
        text: correct ? 'that is the room'
          : size === HIT ? 'right space, wrong length'
          : tail.state === HIT ? 'right length, wrong space'
          : 'neither yet',
        narrow: true,
      },
    ],
    why: [
      {
        label: 'How long it rang',
        value: `${writeSeconds(answer.tail)} measured`,
        how: 'The RT60 of the room this round built, measured off its own '
           + 'impulse rather than read off the decay control - the two are not '
           + 'the same. A decay of 1.2 rings for 0.78 to 1.04 s and one of 5.0 '
           + 'for 3.15 to 3.32, so the control reads about half again as long '
           + 'as the room actually rings.',
      },
      {
        label: 'Close is',
        value: `${(2 ** spec.hit).toFixed(2)}x either way`,
        how: 'A ratio, because time is heard in ratios: half a second against '
           + 'three quarters is an obviously different room and three seconds '
           + 'against three and a quarter is not. Wider at the easy tier, '
           + 'because this is dialled blind - there is no second room to '
           + 'compare against, and judging a decay in the absolute is harder '
           + 'than telling two apart.',
      },
      {
        label: 'What the size does',
        value: `${SIZES[sizeAt(answer.size)].metres} m - the gap before it answers`,
        how: 'Measured with the pre-delay at zero so nothing else is making a '
           + 'gap: six metres answers at 6.9 ms, eighteen at 20.7 and forty at '
           + '46.0. That slap in front of the tail is what tells a tiled '
           + 'bathroom from a church at the same decay time.',
      },
    ],
  };
}

export const VERB_WORK = {
  tool: 'reverb',
  opening: 'Play the loop, build the room, then lock it in.',

  settings: [
    {
      id: 'exercise',
      label: 'Exercise',
      options: Object.values(VERB_EXERCISES).map(({ id, label }) => ({ id, label })),
    },
  ],

  exercises: VERB_EXERCISES,

  tiers: {
    easy: { label: 'Easy', blurb: 'Decay and mix', guesses: 4, shape: false, detail: false },
    medium: { label: 'Medium', blurb: 'And the gap before it', guesses: 4, shape: true, detail: false },
    hard: { label: 'Hard', blurb: 'And the walls and the tone', guesses: 4, shape: true, detail: true },
  },

  /**
   * Answered on the plugin, except in the drill - which is the one place in
   * this app where something is both picked and dialled: how big is chips,
   * and how long is a control with seconds written on it.
   */
  slots(tier, settings) {
    if (settings?.exercise !== 'drill') return [];

    const spec = TAIL_DRILL[tier] ?? TAIL_DRILL.medium;
    return [
      {
        id: 'tail',
        kind: 'range',
        label: 'How long it rings',
        min: 0.2,
        max: 4,
        // Dialled in log space, so a given distance along it is the same
        // ratio wherever you are - which is how the ear hears a decay.
        log: true,
        start: 1.2,
        format: (seconds) => writeSeconds(seconds),
        unit: 'x',
        hit: spec.hit,
        near: spec.near,
        below: 'short',
        above: 'long',
      },
      {
        id: 'size',
        kind: 'choice',
        label: 'How big the space is',
        options: SIZES.filter((size) => spec.sizes.includes(size.id)),
      },
    ];
  },

  makePuzzle(rng, tier, settings) {
    if (settings.exercise === 'drill') {
      const spec = TAIL_DRILL[tier] ?? TAIL_DRILL.medium;
      const size = pick(rng, SIZES.filter((s) => spec.sizes.includes(s.id)));
      const room = drillRoom(size.id, pick(rng, spec.decays));

      // Measured off the room, not read off its decay control. One impulse
      // and one curve, about 14 ms.
      return { room, answer: { tail: toStep(measuredTail(room), 0.005), size: size.id } };
    }

    if (settings.exercise === 'tempo') {
      const division = pick(rng, PRE_DIVISIONS);
      return {
        answer: {
          // How long the room may go on for: to the next beat, or the one after.
          clearBy: pick(rng, [1, 2]),
          preDelay: toStep(division.beats * LOOP_BEAT * 1000, 1),
          division: division.label,
        },
      };
    }

    // A room or a hall, never the middle. The plugin opens on a room of about
    // a second and three quarters, and a target drawn from either side of it
    // is a target you have to do something to reach - without this, one
    // target in twenty-four sat close enough to the opening settings that
    // submitting them untouched passed.
    const spec = this.tiers[tier];
    const near = rng() < 0.5;
    const answer = {
      ...VERB_DEFAULTS,
      decay: toStep(near ? logPick(rng, 0.4, 1.3) : logPick(rng, 2.5, 5.5), 0.05),
      mix: toStep(0.15 + rng() * 0.35, 0.01),
    };

    if (spec.shape) {
      answer.preDelay = toStep(rng() * 120, 1);
      answer.damping = toStep(0.25 + rng() * 0.7, 0.01);
    }
    if (spec.detail) {
      answer.size = toStep(logPick(rng, 5, 50), 1);
      answer.early = toStep(rng() * 0.6, 0.01);
      answer.lowCut = toStep(logPick(rng, 20, 500), 5);
      answer.highCut = toStep(logPick(rng, 2500, 18000), 100);
    }

    return { answer };
  },

  /* ---------- marking ---------- */

  score(state, puzzle) {
    if (puzzle?.settings?.exercise === 'drill') return scoreRoom(state, puzzle);

    const { answer, tier } = puzzle;
    const guess = state;
    const exercise = puzzle?.settings?.exercise ?? 'match';
    const settings = { ...VERB_DEFAULTS, ...guess };
    // The rooms are built from numbers rather than recorded, so marking needs
    // no audio and gives the same answer on every machine.
    const rate = 48000;

    if (exercise === 'tempo') return this.scoreTempo(settings, answer, tier, rate);

    // Readings rather than bare profiles: they carry the time axis they were
    // measured on, which `profileDistance` used to assume the two of them
    // shared without either of them recording it.
    const mine = decayReading('reverb', roomProfile(rate, settings), { state: settings });
    const wanted = { ...VERB_DEFAULTS, ...answer };
    const theirs = decayReading('reverb', roomProfile(rate, wanted), { state: wanted });
    const gap = distance(mine, theirs);
    const error = gap.off;

    const close = VERB_CLOSE.match[tier];
    const mark = error <= close ? HIT : error <= close * 2.5 ? NEAR : MISS;

    // Which way it is out, said in the terms the room is built in.
    const longer = this.decayOf(settings, rate) - this.decayOf({ ...VERB_DEFAULTS, ...answer }, rate);
    const ahead = settings.preDelay - (answer.preDelay ?? VERB_DEFAULTS.preDelay);

    return {
      correct: error <= close,
      error,
      cells: [
        { state: mark, text: `${error.toFixed(1)} dB out` },
        {
          state: mark,
          text: error <= close ? 'that is the room'
            : Math.abs(longer) > 0.12 ? `${writeSeconds(Math.abs(longer))} too ${longer > 0 ? 'long' : 'short'}`
            : Math.abs(ahead) > 12 ? `answers ${Math.round(Math.abs(ahead))} ms too ${ahead > 0 ? 'late' : 'early'}`
            : 'the right length, the wrong room',
        },
      ],
      why: [
        {
          label: 'Decay, compared',
          value: `${error.toFixed(2)} dB apart, worst in ${gap.where}`,
          how: 'Both rooms are built and their decays read in three bands, moment '
             + 'by moment. One reading covers every control at once: the slope is '
             + 'the decay time, the flat part at the start is the pre-delay, the '
             + 'bands pulling apart is the damping, and where each band starts is '
             + 'what the send filters did.',
        },
        {
          label: 'Length',
          value: `${writeSeconds(Math.abs(longer))} too ${longer > 0 ? 'long' : 'short'}`,
          how: 'Each room measured down to thirty decibels and extrapolated to '
             + 'sixty, which is the RT60 everybody quotes.',
        },
        {
          label: 'Pre-delay',
          value: `${Math.round(Math.abs(ahead))} ms too ${ahead > 0 ? 'late' : 'early'}`,
          how: 'How long the room waits before it answers. It is what stops a '
             + 'reverb sounding bolted onto the front of the sound.',
        },
      ],
    };
  },

  /** The decay time of a room, measured off it. */
  decayOf(settings, rate) {
    const impulse = makeImpulse(rate, settings);
    const times = [];
    for (let t = 0; t < impulse.seconds; t += 0.01) times.push(t);
    const curve = decayCurve(monoOf(impulse), rate, times);

    for (let i = 0; i < curve.length; i += 1) if (curve[i] <= -30) return times[i] * 2;
    return impulse.seconds * 2;
  },

  /**
   * Does the room belong to the track?
   *
   * Two readings, both taken off the decay: where the tail has got to when
   * the next hit lands, and how long the room waits before it answers. A
   * reverb that is still going when the next beat arrives is the single most
   * common way a mix turns to soup, and a reverb that answers on the
   * subdivision is how it stops sounding bolted on.
   */
  scoreTempo(settings, answer, tier, rate) {
    const impulse = makeImpulse(rate, settings);
    const when = answer.clearBy * LOOP_BEAT;
    const left = decayCurve(monoOf(impulse), rate, [when])[0];

    const floor = CLEARED - STILL_A_ROOM[tier];
    const ringing = left - CLEARED;        // above zero is still going
    const dead = floor - left;             // above zero is deader than it needs to be
    const timing = Math.abs(settings.preDelay - answer.preDelay) / answer.preDelay;

    const clear = left <= CLEARED && left >= floor;
    const inTime = timing <= IN_TIME[tier];
    const off = Math.max(ringing, dead);

    return {
      correct: clear && inTime,
      error: Math.max(0, off),
      cells: [
        {
          state: clear ? HIT : off <= VERB_CLOSE.tempo[tier] ? NEAR : MISS,
          text: clear ? 'gone by the beat'
            : ringing > 0 ? `${left.toFixed(0)} dB left when it lands`
            : 'gone long before it',
        },
        {
          state: inTime ? HIT : timing <= IN_TIME[tier] * 2.5 ? NEAR : MISS,
          text: inTime ? `answers on ${answer.division}`
            : `answers ${Math.round(Math.abs(settings.preDelay - answer.preDelay))} ms too `
              + `${settings.preDelay > answer.preDelay ? 'late' : 'early'}`,
        },
      ],
      why: [
        {
          label: 'Left when the next hit lands',
          value: `${left.toFixed(1)} dB, wanted ${CLEARED} give or take `
               + `${STILL_A_ROOM[tier]}`,
          how: 'Your room is built and read at exactly the moment the next hit '
             + 'arrives. A range rather than a number, because a range is what '
             + 'the ear gives you: nobody hears "thirty decibels down", what '
             + 'anybody hears is whether it is still ringing when the next hit '
             + 'comes.',
        },
        {
          label: 'Which way',
          value: ringing > 0 ? `${ringing.toFixed(1)} dB still going`
               : `${dead.toFixed(1)} dB deader than it needs to be`,
          how: 'Above the window is soup; below it there is no room left, which '
             + 'is a different way of not fitting the track.',
        },
        {
          label: 'Pre-delay, as a fraction',
          value: `${(timing * 100).toFixed(0)}% out of ${answer.division}`,
          how: 'Measured against the subdivision rather than in milliseconds, '
             + 'because answering on the beat is what makes a room belong to a '
             + 'track and a beat is a different length at every tempo.',
        },
      ],
    };
  },

  hints(puzzle) {
    const { answer, tier } = puzzle;

    if ((puzzle?.settings?.exercise ?? 'match') === 'drill') {
      const size = SIZES[sizeAt(answer.size)];
      return [
        'Flip to dry and back. The gap before the room answers is the size of '
          + 'it, and how long it takes to disappear is the tail.',
        answer.tail < 0.8 ? 'The tail is under a second - it is gone quickly.'
          : answer.tail < 2 ? 'The tail runs somewhere between one and two seconds.'
          : 'The tail runs well over two seconds, which is a long space.',
        `The gap before it answers puts it at about ${size.metres} metres across, `
          + `which is ${size.name}.`,
      ];
    }

    if ((puzzle?.settings?.exercise ?? 'match') === 'tempo') {
      return [
        `The room has to be gone by the time the next hit lands - `
          + `${answer.clearBy === 1 ? 'one beat' : 'two beats'} - and it has to `
          + 'answer in time with the track.',
        `The pre-delay wants to be on ${answer.division}. The decay is what you `
          + 'set to clear the beat; damping the top will get you there without '
          + 'shortening it further.',
      ];
    }

    const settings = { ...VERB_DEFAULTS, ...answer };
    return [
      settings.decay < 0.8 ? 'It is a small room - short, and it stops quickly.'
        : settings.decay < 2.5 ? 'It is a room rather than a hall: a second or two.'
        : 'It is a hall - long, and it goes on well past the note.',
      `Roughly ${Math.round(settings.preDelay)} ms in front of it, and the top `
        + `${settings.damping < 0.5 ? 'dies well before the bottom'
          : settings.damping < 0.85 ? 'comes off gradually' : 'hangs on nearly as long'}. `
        + `About ${Math.round(settings.mix * 100)}% wet.`,
    ];
  },

  reveal(puzzle) {
    const { answer } = puzzle;

    if ((puzzle?.settings?.exercise ?? 'match') === 'drill') {
      const size = SIZES[sizeAt(answer.size)];
      return {
        symbol: writeSeconds(answer.tail),
        name: `in ${size.name}, about ${size.metres} metres across`,
      };
    }

    if ((puzzle?.settings?.exercise ?? 'match') === 'tempo') {
      return {
        symbol: `${answer.clearBy === 1 ? 'one beat' : 'two beats'}`,
        name: `to clear, answering on ${answer.division}`,
      };
    }

    const settings = { ...VERB_DEFAULTS, ...answer };
    return {
      symbol: writeSeconds(settings.decay),
      name: `${Math.round(settings.preDelay)} ms in front, highs × ${settings.damping.toFixed(2)}, `
          + `${Math.round(settings.mix * 100)}% wet`,
    };
  },

  /** What a guess says it heard, in `weak`'s own words. */
  heard(guess, puzzle) {
    if ((puzzle?.settings?.exercise ?? 'match') !== 'drill') return null;
    const size = SIZES[sizeAt(guess.size)];
    if (!size) return null;
    return { key: `size-${size.id}`, label: `${size.symbol.toLowerCase()} rooms` };
  },

  weak(puzzle) {
    const { answer } = puzzle;
    if ((puzzle?.settings?.exercise ?? 'match') === 'drill') {
      const size = SIZES[sizeAt(answer.size)];
      return { key: `size-${size.id}`, label: `${size.symbol.toLowerCase()} rooms` };
    }
    if ((puzzle?.settings?.exercise ?? 'match') === 'tempo') {
      return { key: 'in time', label: 'rooms that fit the track' };
    }

    const decay = (answer?.decay ?? VERB_DEFAULTS.decay);
    const room = decay < 0.8 ? 'small rooms' : decay < 2.5 ? 'rooms' : 'halls';
    return { key: room, label: room };
  },
};
