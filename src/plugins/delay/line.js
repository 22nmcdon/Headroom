import {
  ECHO_DEFAULTS, MOST_FEEDBACK, LONGEST_TIME, sidesOf, echoCore, headsOf,
} from './dsp.js';
import {
  LONGEST_TAIL, decayProfile, decayTimes, wetDryImpulse, monoOf,
} from '../../lib/response.js';
import { readingOf, stampOf } from '../../lib/read.js';
import { LOOP_BEAT } from '../../lib/tempo.js';

// A delay, written down: the response one click gets, where the repeats land,
// and how far two of them are apart.
//
// What a delay is, for somebody using one, is in src/learn/notes/echo.js.
//
// The loop itself is in `dsp.js`, because the audio thread needs it too. What
// is here is everything built on top of a run of it - and all of it offline,
// which is what makes the repeats you see the repeats a guess is marked
// against, and what makes the tail land exactly where the setting says
// rather than being retimed under a playhead.

// The tables and the loop are the core's, and re-exported because this is
// where the rest of the app has always asked for them.
export {
  ECHO_DEFAULTS, ECHO_LIMITS, MACHINES, BBD_STAGES, MACHINE_FLOOR, MACHINE_CEILING,
  machineTone, PING_FROM, HEAD_PATTERNS, headsOf, LONGEST_TIME, SHORTEST_TIME,
  MOST_FEEDBACK, MOST_OFFSET, sidesOf, echoCore,
  WOW_RATE, FLUTTER_RATE, MOST_WOW, MOST_FLUTTER,
} from './dsp.js';
/**
 * The note values a delay is set to, as fractions of a beat.
 *
 * Spread out on purpose. Every adjacent pair here is at least a third apart,
 * so telling one from the next is a question about the music rather than a
 * question about a stopwatch - a dotted eighth and a quarter triplet are only
 * twelve per cent apart, which is a difference you can measure and not one
 * anybody names by ear.
 */
export const DIVISIONS = [
  { id: 'quarter', label: '1/4', beats: 1 },
  { id: 'dotted8', label: 'dotted 1/8', beats: 0.75 },
  { id: 'eighth', label: '1/8', beats: 0.5 },
  { id: 'triplet8', label: '1/8 triplet', beats: 1 / 3 },
  { id: 'sixteenth', label: '1/16', beats: 0.25 },
];

/** The ones a sync menu offers, which can afford to be finer than the ear. */
export const SYNC_DIVISIONS = [
  { id: 'free', label: 'Free', beats: null },
  { id: 'quarter', label: '1/4', beats: 1 },
  { id: 'dotted8', label: 'dotted 1/8', beats: 0.75 },
  { id: 'quartertrip', label: '1/4 triplet', beats: 2 / 3 },
  { id: 'eighth', label: '1/8', beats: 0.5 },
  { id: 'dotted16', label: 'dotted 1/16', beats: 0.375 },
  { id: 'triplet8', label: '1/8 triplet', beats: 1 / 3 },
  { id: 'sixteenth', label: '1/16', beats: 0.25 },
];

/** A note value, in milliseconds of this track. */
export const timeOf = (beats) => beats * LOOP_BEAT * 1000;

/** The note value nearest a time, and how far off it is. */
export function nearestDivision(ms, among = SYNC_DIVISIONS) {
  let best = null;
  for (const division of among) {
    if (division.beats === null) continue;
    const off = Math.abs(Math.log2(ms / timeOf(division.beats)));
    if (!best || off < best.off) best = { division, off };
  }
  return best;
}

/**
 * The repeats, as samples.
 *
 * Simulated rather than worked out in closed form, because the filters in the
 * feedback path mean each repeat is a filtered copy of the last one and not a
 * scaled copy of the first. Running the loop for real is both shorter to
 * write and exactly right.
 */
export function makeEcho(rate, params = {}) {
  const settings = { ...ECHO_DEFAULTS, ...params };
  const core = echoCore(rate).set(settings);

  const feedback = Math.min(MOST_FEEDBACK, Math.max(0, settings.feedback));
  const step = Math.max(...sidesOf(settings)
    .map((ms) => Math.max(1, Math.round((ms / 1000) * rate))));

  // Long enough for the repeats to die, and never longer than anything else
  // in this app measures. At the most feedback on offer that is a truncation
  // rather than a fade-out, which is honest: the display shows where it was
  // cut and both sides of a comparison are cut in the same place.
  const fading = feedback > 0.001
    ? (step / rate) * (Math.log(1e-3) / Math.log(feedback))
    : step / rate;
  const seconds = Math.min(LONGEST_TAIL, Math.max(step / rate + 0.05, fading + step / rate));
  const length = Math.ceil(seconds * rate);

  const channels = [new Float32Array(length), new Float32Array(length)];
  for (let i = 0; i < length; i += 1) {
    // An impulse in, once, on both sides.
    const input = i === 0 ? 1 : 0;
    core.stereo(input, input);
    channels[0][i] = core.left;
    channels[1][i] = core.right;
  }

  // Not normalised, and that is the whole of what is left to say about the
  // level: one repeat comes back at the level it went in.
  //
  // This used to divide the whole response by its own energy, the way the
  // rooms do, to stop "more feedback" reading as "louder". It worked, and it
  // put the feedback knob on the first repeat's level while it was at it.
  // Measured at 375 ms, before:
  //
  //     feedback   first repeat   repeats over -60 dB   tail used
  //     0              -3.01 dB                     1      0.75 s
  //     0.35           -3.58 dB                     7      2.84 s
  //     0.5            -4.26 dB                    10      4.11 s
  //     0.8            -7.45 dB                    21      8.00 s
  //
  // Three of those decibels are the constant cost of summing two channels;
  // the other 4.44 at the bottom is exactly the sqrt(1 - g^2) that
  // normalising a comb to its energy predicts. So turning the feedback up
  // made the first repeat quieter - a level cue pointing the wrong way,
  // bundled with the repeat count that the exercise is actually about.
  // Hardware keeps the two apart: a Space Echo has an Echo Level and an
  // Intensity, and they are two knobs.
  //
  // Nothing had to be added to get the first repeat to unity, which is the
  // part worth knowing. The output tap reads the delay line before the loop
  // filters rather than after, so the first repeat is the input itself - it
  // was already exactly 1 and the normalisation was what moved it.
  //
  // The wet path is louder for it, and checked: the app's drum bed through an
  // insert at every mix, with the feedback at its limit and the loop opened
  // right up, peaks at -4.76 dB against a dry of -6.23 - because the repeats
  // land between the hits rather than on top of them. Nothing clips.
  //
  // The marks move a little, and the first version of this comment said they
  // could not. `decayProfile` divides every band by the whole response's
  // energy, so the reading is blind to the wet level - but `wetDryImpulse`
  // puts the dry in as one unity sample and does not scale it, so the wet's
  // absolute level survives as the wet-dry balance and reaches the reading
  // that way. A test caught the claim; the measurement is beside it.
  //
  // What it comes to: every distance moved outward by about four per cent of
  // itself, which against tolerances of 2.6, 1.9 and 1.2 dB is a boundary
  // shifting by hundredths. An exact answer still reads exactly zero, and
  // every exercise test that asks whether a right answer passes and its
  // neighbour fails still passes.
  return { channels, rate, length, seconds: length / rate, step: step / rate };
}

/**
 * Where the repeats land, in seconds, while they are still worth hearing.
 *
 * Each one carries the side it is on, because with two times there are two
 * answers and "both" is only one of three. A plain delay puts every repeat on
 * both sides at once; an offset gives each side its own train; a ping-pong
 * alternates, and with an offset as well it alternates on two different legs.
 *
 * Sorted by when they arrive, which is what anything drawing them wants.
 */
export function repeatsOf(settings) {
  const [left, right] = sidesOf(settings).map((ms) => ms / 1000);
  const feedback = Math.min(MOST_FEEDBACK, Math.max(0, settings.feedback));
  const dies = (level) => level <= 1e-3;

  const found = [];
  const add = (seconds, level, side) => {
    if (seconds <= LONGEST_TAIL && !dies(level)) found.push({ at: seconds, level, side });
  };

  // The heads, as fractions of each side's own time. Every pass of the loop
  // sounds all of them, because the feedback is taken from the longest.
  const { taps } = headsOf(settings.heads);

  if (settings.pingPong) {
    // One leg at a time, alternating: the side it starts on for one time, the
    // other for the other, so the n-th pass is however many of each it has
    // been through. Even on the same time this is the series that makes a
    // ping-pong - the round trip is the two legs together.
    const from = settings.pingPongFrom === 'right' ? 'right' : 'left';
    const other = from === 'left' ? 'right' : 'left';
    const legs = from === 'right' ? [right, left] : [left, right];
    let when = 0;
    let level = 1;
    for (let n = 0; when <= LONGEST_TAIL && !dies(level); n += 1) {
      const leg = legs[n % 2];
      const side = n % 2 === 0 ? from : other;
      // The heads of this pass land inside the leg it is on, and the last of
      // them is the leg itself.
      for (const tap of taps) add(when + leg * tap, level, side);
      when += leg;
      level *= feedback;
      if (feedback <= 0.001) break;
    }
    return found.sort((a, b) => a.at - b.at);
  }

  // Both sides fed, so each has its own train - and when the two times are
  // the same those trains coincide, which is one repeat on both sides rather
  // than two repeats that happen to agree.
  const together = left === right;
  for (const [side, time] of [['left', left], ['right', right]]) {
    let level = 1;
    for (let n = 0; n * time <= LONGEST_TAIL && !dies(level); n += 1) {
      for (const tap of taps) add((n + tap) * time, level, together ? 'both' : side);
      level *= feedback;
      if (feedback <= 0.001) break;
    }
    if (together) break;
  }

  return found.sort((a, b) => a.at - b.at);
}

/* ---------- the shape of a loop, as a reading ---------- */

/**
 * How many frames one pass of the loop is cut into.
 *
 * Sixty-four, so a four-head pattern lands sixteen frames apart and the
 * shortest delay on offer still has three frames between its repeats.
 */
export const LOOP_FRAMES = 64;

/** And how many passes are looked at. */
export const LOOP_PASSES = 4;

/** The whole reading, in frames. */
export const ARRIVALS = LOOP_FRAMES * LOOP_PASSES;

/** Below this a frame has nothing in it, and says so rather than -Infinity. */
export const ARRIVAL_FLOOR = -60;

/**
 * How far a frame's energy is smeared into its neighbours, in frames.
 *
 * Two either side, which softens the hair trigger without removing it - and
 * the first version of this comment claimed it removed it, which is measurably
 * wrong.
 *
 * The trigger is a repeat crossing a frame edge. The smear spreads energy, but
 * the floor below is in decibels, so a frame holding nothing reads -60 and the
 * same frame holding a ninth of a repeat reads about -9: a sixty-decibel step
 * softened into a fifty-decibel one. Measured, three samples of flutter moving
 * the first repeat from sample 18000 to 17997 - and sample 18000 is exactly
 * where frame 64 begins, so the whole repeat changed frames:
 *
 *     frames on the floor with no wander        239 of 256
 *     of those, lifted off it by the three      6
 *     worst single frame                        55.2 dB
 *     the whole reading                          7.0 dB
 *
 * Seven decibels from three samples, against the six this reading's tolerance
 * allows. Nothing in the app moved sub-frame until the transport could wander,
 * which is why it has never bitten.
 *
 * The fix, when something needs it, is to frame the response with an
 * overlapping window rather than a box and a smear afterwards - then a
 * three-sample shift moves every frame by a per cent or so, continuously. It
 * is not done here because it would move every number this reading has ever
 * produced, and the measurements built on them: the diffusion table, the head
 * pattern distances, the pattern drill's fairness figures, and the tolerance
 * itself. What is done instead is to keep the wander out of this reading, for
 * which see `repeatsReading` below - a reading measures one thing.
 */
export const ARRIVAL_SMEAR = 2;

/**
 * The shape of one pass of the loop: where the energy arrives inside it.
 *
 * In fractions of the loop rather than in milliseconds, and that is the whole
 * design. The first version of this framed the response in fixed ten
 * millisecond frames, which saw the pattern and the time at once and could
 * not tell them apart:
 *
 *     the arrival gap when one thing is off, pattern right
 *       time 1 % long            6.29 dB
 *       time 3 % long           13.08 dB
 *       time 10 % long          15.75 dB
 *     and when the pattern is wrong
 *       single                  13.06 dB
 *       heads3                  14.76 dB
 *
 * A one per cent time error read half a wrong pattern and a three per cent
 * error read exactly one, so there was no tolerance that admitted a near-miss
 * on the time and refused the wrong number of heads. Useless in a match,
 * where the time is being matched too.
 *
 * Cut into fractions of the loop instead, the time falls out of it entirely:
 *
 *       exact                    0.00 dB
 *       time 1 % long            0.06 dB
 *       time 10 % long           0.40 dB
 *       time 50 % long           0.48 dB
 *       feedback 0.15 more       2.31 dB
 *       tone an octave down      1.45 dB
 *       single head             21.47 dB
 *       three heads             26.61 dB
 *
 * Which is a reading worth having: the pattern at twenty decibels and
 * everything else at two.
 *
 * Not quite blind to the time, and the residue is the loop filters. With the
 * loop opened right up it is exactly time-invariant; with the filters in, a
 * 120 Hz high-pass rings for about eight milliseconds whatever the loop is,
 * which is two fifths of a twenty millisecond loop and a two-hundredth of a
 * fifteen-hundred one:
 *
 *     pair            default loop    wide open loop
 *     380 vs 420          0.28 dB          0.00 dB
 *     300 vs 900          0.71 dB          0.00 dB
 *     200 vs 900          1.17 dB          0.00 dB
 *     20 vs 1500          5.97 dB          0.00 dB
 *
 * Nothing anywhere a match is played, where the two delays are on the same
 * material and one is trying to be the other. It is the complement of the decay curve rather than
 * a replacement - that one says how the energy falls away and is blind to
 * where inside the loop it lands; this one says where it lands and is blind
 * to how long the loop is. Together they cover a delay.
 *
 * Over the wet response alone, not the wet-dry mix: the dry is one sample at
 * the front that would sit on the first frame and move with a control that
 * has nothing to do with the question.
 */
export function loopShape(samples, rate, ms) {
  const span = ((ms / 1000) * rate) / LOOP_FRAMES;
  const raw = new Float64Array(ARRIVALS);

  for (let f = 0; f < ARRIVALS; f += 1) {
    const from = Math.floor(f * span);
    const to = Math.min(samples.length, Math.floor((f + 1) * span));
    let energy = 0;
    for (let i = from; i < to; i += 1) energy += samples[i] * samples[i];
    raw[f] = energy;
  }

  // Smeared in energy rather than in decibels: adding two levels is adding
  // their energies, and a triangle over the logarithms averages the wrong
  // thing.
  const smeared = new Float64Array(ARRIVALS);
  let loudest = 0;
  for (let f = 0; f < ARRIVALS; f += 1) {
    let sum = 0;
    let weight = 0;
    for (let k = -ARRIVAL_SMEAR; k <= ARRIVAL_SMEAR; k += 1) {
      const at = f + k;
      if (at < 0 || at >= ARRIVALS) continue;
      const w = ARRIVAL_SMEAR + 1 - Math.abs(k);
      sum += raw[at] * w;
      weight += w;
    }
    smeared[f] = weight > 0 ? sum / weight : 0;
    if (smeared[f] > loudest) loudest = smeared[f];
  }

  const out = new Float32Array(ARRIVALS);
  for (let f = 0; f < ARRIVALS; f += 1) {
    out[f] = loudest > 1e-20
      ? Math.max(ARRIVAL_FLOOR, 10 * Math.log10(Math.max(smeared[f], 1e-20) / loudest))
      : ARRIVAL_FLOOR;
  }
  return out;
}

/**
 * The axis two of these must share.
 *
 * The delay time is deliberately not in it. An axis is what stops two
 * readings being compared when they are of different things, and two delays
 * on two different times are the same kind of thing here - that is the point
 * of measuring in fractions of a loop rather than in milliseconds.
 */
export const ARRIVAL_AXIS = { kind: 'arrivals', perLoop: LOOP_FRAMES, passes: LOOP_PASSES };

/**
 * Where a delay's repeats land inside its own loop, in an envelope.
 *
 * With the transport held still, whatever it is set to. This reading answers
 * where inside a pass the repeats fall - which heads, how smeared - and the
 * question has an answer only if the pass is the same length every time
 * round. A wandering line moves each repeat by a few samples, which is nothing
 * to the ear and everything to a reading whose frames have edges: three
 * samples read seven decibels, measured, which is more than its whole
 * tolerance. See ARRIVAL_SMEAR above for why that happens and what the real
 * fix would cost.
 *
 * So the wander is somebody else's to measure, and `wanderReading` measures
 * it. The alternative was to let this one react to both and call the sum a
 * reading, which is how you get a tolerance that cannot be set: too tight and
 * five cents of flutter fails a correct pattern, too loose and the pattern
 * stops being marked at all.
 */
export function repeatsReading(rate, settings, { source = null } = {}) {
  const whole = { ...ECHO_DEFAULTS, ...settings, wow: 0, flutter: 0 };
  const [left] = sidesOf(whole);
  return readingOf({
    tool: 'delay',
    kind: 'arrivals',
    of: { state: stampOf(whole), source, axis: ARRIVAL_AXIS },
    values: loopShape(monoOf(makeEcho(rate, whole)), rate, left),
  });
}

/**
 * How far apart two delays are in the shape of their loops.
 *
 * The root mean square across the frames, which is what the decay comparator
 * does across its own, so a tolerance set against one is not a surprise
 * against the other.
 *
 * `where` is where inside the loop they disagree about most, as a fraction -
 * "a quarter of the way in" is a thing to go and listen for, where a frame
 * number is not. `detail.extra` above zero is a repeat of yours arriving
 * where theirs has none.
 */
export function repeatGap(mine, theirs) {
  const a = mine.values;
  const b = theirs.values;
  const n = Math.min(a.length, b.length);

  let sum = 0;
  let worst = 0;
  let at = 0;
  for (let i = 0; i < n; i += 1) {
    const off = a[i] - b[i];
    sum += off * off;
    if (Math.abs(off) > Math.abs(worst)) { worst = off; at = i; }
  }

  const through = (at % LOOP_FRAMES) / LOOP_FRAMES;
  return {
    off: Math.sqrt(sum / Math.max(1, n)),
    where: `${Math.round(through * 100)} % through the loop`,
    detail: { extra: worst, pass: Math.floor(at / LOOP_FRAMES) + 1 },
  };
}

/** A delay, built and read in the terms a guess is marked in. */
export function echoProfile(rate, settings, times = decayTimes()) {
  const echo = makeEcho(rate, settings);
  return decayProfile(wetDryImpulse(echo, settings.mix ?? ECHO_DEFAULTS.mix), rate, times);
}
