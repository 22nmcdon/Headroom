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
  WOW_RATE, FLUTTER_RATE, MOST_WOW, MOST_FLUTTER, CHANGE_MODES, MOST_DUCK,
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
/**
 * How long a delay goes on for, in samples.
 *
 * Long enough for the repeats to die, and never longer than anything else in
 * this app measures. At the most feedback on offer that is a truncation
 * rather than a fade-out, which is honest: the display shows where it was cut
 * and both sides of a comparison are cut in the same place.
 *
 * Its own function because two things need it now. The response is this long,
 * and so is the stretch a player has to keep running after a loop has ended
 * to catch what is still sounding - the two have to agree, or the tail folded
 * back over the start of a loop is a different length from the tail drawn
 * beside it.
 */
export function echoTail(rate, settings) {
  const whole = { ...ECHO_DEFAULTS, ...settings };
  const feedback = Math.min(MOST_FEEDBACK, Math.max(0, whole.feedback));
  const step = Math.max(...sidesOf(whole)
    .map((ms) => Math.max(1, Math.round((ms / 1000) * rate))));

  // At unity and above the repeats never die, so there is no decay to work
  // out: the answer is as long as this app measures. Worked out rather than
  // asked for, the formula gives nonsense there - log(1) is zero, so the
  // division is minus infinity, the max picks the floor, and a delay howling
  // for ever came out with a response 0.42 seconds long holding exactly one
  // repeat. That is what a drawing and a mark would have been taken from.
  const seconds = feedback >= 1
    ? LONGEST_TAIL
    : Math.min(LONGEST_TAIL, Math.max(
      step / rate + 0.05,
      (step / rate) * (feedback > 0.001 ? Math.log(1e-3) / Math.log(feedback) : 1) + step / rate,
    ));
  return { length: Math.ceil(seconds * rate), step };
}

export function makeEcho(rate, params = {}) {
  const settings = { ...ECHO_DEFAULTS, ...params };
  const core = echoCore(rate).set(settings);
  const { length, step } = echoTail(rate, settings);

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
 * How wide each frame's window is, in frames.
 *
 * The frames overlap, and that is the whole point of this number. A reading
 * cut into boxes has edges, and a repeat crossing one takes its whole energy
 * into the next frame in a single sample. The box this replaced had the
 * edges; smearing the frames afterwards softened them and the comment here
 * used to claim that fixed it, which was measurably wrong. Spreading energy
 * across neighbours cannot remove a step underneath it: a floor in decibels
 * turns a frame going from nothing to a ninth of a repeat into a
 * fifty-decibel jump rather than a sixty-decibel one.
 *
 * Measured on a 375 ms loop, where the frames are 281.25 samples and the
 * first repeat lands on sample 18000, which is exactly where frame 64 begins.
 * The whole reading, and its worst single frame:
 *
 *     the first repeat moves    1 early   3 early   5 early   10 early
 *       a box and a smear      5.22 dB   5.94 dB   6.62 dB    6.99 dB
 *         worst frame         55.23     55.23     55.23      55.23
 *       this window            0.01      0.04      0.06       0.12
 *         worst frame          0.08      0.25      0.43       0.86
 *
 * One sample took five decibels out of a reading whose tolerance is six. Only
 * early: a repeat arriving late stays in the frame it was in, so the box read
 * 0.01 dB in that direction and nothing ever caught it. The window reads the
 * same either way, because it is continuous in the arrival time, which is
 * what this reading was always supposed to be.
 *
 * What that buys, through the wander a transport actually has:
 *
 *     flutter        1 cent    5 cents   25 cents
 *       the box      2.88 dB   6.21 dB    7.25 dB
 *       the window   0.05      0.31       0.40
 *
 * The width has to be even, and that is a fact about where the window's ends
 * land rather than a preference. Frame f's window runs from (f + 0.5 - W/2)
 * frames to (f + 0.5 + W/2). For an odd width those ends fall on whole
 * frames, so whenever a repeat sits on a frame boundary there is some frame
 * holding it exactly at its own window's end, where the weight is zero - and
 * a frame reading almost nothing swings wildly in decibels for an arrival
 * that barely moves. Measured, three samples at 375 ms:
 *
 *     width     2       3       4       5       6       8
 *     whole  0.04    1.40    0.04    1.06    0.04    0.04
 *     worst  0.35   22.16    0.25   16.94    0.24    0.24
 *
 * and at widths 3 and 5 the frame carrying it is exactly the one the
 * arithmetic names. Even widths put the ends half a frame off the grid, where
 * nothing lands.
 *
 * Four of the even ones, and what picks it is the room either side of the
 * tolerance rather than any single reading. SHAPE_CLOSE is six, and six has
 * to sit above everything that is not the head pattern and below the closest
 * pair of patterns. Swept over every pattern and every other control:
 *
 *     width   worst incidental   closest wrong pattern   diffusion 0 vs 0.5
 *         2          5.14 dB              10.96 dB             11.00 dB
 *         4          4.57                 14.96                10.42
 *         6          4.47                 18.18                10.15
 *         8          4.37                 20.94                 9.81
 *
 * At a width of two the tolerance has 0.86 dB of room underneath it - a tape
 * machine against a digital one on four heads, which is not a wrong answer
 * and must not read as one. Four gives that 1.43 dB and the other side nine,
 * and six and eight buy almost nothing more on either while blurring the
 * diffusion further. So the narrow end is ruled out by a measurement and the
 * wide end by diminishing returns, which leaves four.
 *
 * The blurring is the one real cost and it is paid at every length, not just
 * at short ones: the diffusion all-passes sit 2.37, 1.54 and 1.07 frames into
 * the loop whatever the loop is, because DIFFUSE_AT is a fraction of it. So
 * any window of two frames or more is already as wide as the thing it is
 * reading. Measured, that costs about half a decibel out of eleven.
 */
export const ARRIVAL_WIDTH = 4;

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
 *       time 1 % long            0.04 dB
 *       time 10 % long           0.34 dB
 *       time 50 % long           0.91 dB
 *       feedback 0.15 more       2.27 dB
 *       tone an octave down      1.34 dB
 *       single head             18.76 dB
 *       three heads             23.87 dB
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
 *     380 vs 420          0.16 dB          0.00 dB
 *     300 vs 900          0.87 dB          0.00 dB
 *     200 vs 900          1.38 dB          0.00 dB
 *     20 vs 1500          6.05 dB          0.00 dB
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

  // A frame is not a whole number of samples - 375 ms at 48 kHz is 281.25 of
  // them - so the window is placed at its true fractional position and the
  // raised cosine is evaluated at each sample's real offset into it, rather
  // than being built once as an array and started at a rounded sample.
  // Rounding the start leaves each frame's weights up to half a sample out of
  // step with the grid, which shows up as the reading being slightly
  // different depending on which way a frame's start happened to round, and
  // as one direction of movement reading differently from the other.
  const half = (span * ARRIVAL_WIDTH) / 2;
  const level = new Float64Array(ARRIVALS);
  let loudest = 0;
  for (let f = 0; f < ARRIVALS; f += 1) {
    const opens = (f + 0.5) * span - half;
    const from = Math.ceil(opens);
    const to = Math.floor(opens + 2 * half);

    // Each frame is the windowed mean power around its own middle. Weighting
    // the power rather than the samples, because a frame is asking how much
    // energy arrived near here and energies add where amplitudes do not.
    // Anything off either end of the response counts as the silence it is -
    // its weight still goes into the divisor - so the first frame is not
    // lifted by having nothing in front of it.
    let sum = 0;
    let weight = 0;
    for (let at = from; at <= to; at += 1) {
      const w = 0.5 - 0.5 * Math.cos((Math.PI * (at - opens)) / half);
      weight += w;
      if (at < 0 || at >= samples.length) continue;
      sum += w * samples[at] * samples[at];
    }
    level[f] = weight > 0 ? sum / weight : 0;
    if (level[f] > loudest) loudest = level[f];
  }

  const out = new Float32Array(ARRIVALS);
  for (let f = 0; f < ARRIVALS; f += 1) {
    out[f] = loudest > 1e-20
      ? Math.max(ARRIVAL_FLOOR, 10 * Math.log10(Math.max(level[f], 1e-20) / loudest))
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
 * round.
 *
 * It used to be held still because it had to be. Through the box this reading
 * was framed with, five cents of flutter read 6.21 dB against a tolerance of
 * six, and twenty-five read 7.25 - a correct head pattern failing on a
 * transport nobody was being asked about. See ARRIVAL_WIDTH: that was frame
 * edges, and the overlapping window removed it. The same two now read 0.31
 * and 0.40.
 *
 * It is still held still, and the reason is now a real one rather than a
 * defect. Measured with the guard taken off on purpose:
 *
 *     flutter 25 cents           0.40 dB
 *     wow 5 cents                0.57 dB
 *     wow 25 and flutter 25      5.86 dB
 *     wow 50 cents               8.01 dB
 *
 * Deep wow is not jitter. It is slow enough that a whole pass goes by at a
 * stretched length, so the repeats really do land somewhere else - two frames
 * out at fifty cents - and a reading of where the repeats land is right to
 * say so. Which is exactly why it must not: that is the wander's question,
 * and `wanderReading` asks it. Both numbers read the same through the box as
 * through the window, 8.03 against 8.01, which is how you can tell this half
 * was never the frame edges.
 *
 * The alternative was to let this one react to both and call the sum a
 * reading, which is how you get a tolerance that cannot be set: too tight and
 * deep wow fails a correct pattern, too loose and the pattern stops being
 * marked at all.
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

/* ---------- how badly the transport holds time, as a reading ---------- */

/**
 * The tone the transport is watched with, how long for, and in how many
 * frames.
 *
 * A thousand hertz, because it sits in the middle of everything and well
 * inside every corner this delay can put in front of its line - a probe the
 * loop filters were rolling off would be measuring the filter.
 *
 * Four seconds, because wow is slow. At 0.55 Hz that is a little over two
 * cycles, which is enough to see the shape of one, and a hundred and
 * twenty-eight frames across it samples the deviation at 32 Hz - twice over
 * for the fastest flutter on offer.
 */
export const WANDER_PROBE = 1000;
export const WANDER_SECONDS = 4;
export const WANDER_FRAMES = 128;

/**
 * The modulation rates the deviation is sorted into, in hertz.
 *
 * Four bands, placed around the two rates this transport actually has rather
 * than swept in octaves - because a hundred and twenty-eight frames over four
 * seconds resolves a quarter of a hertz, and wow at 0.55 does not land on a
 * bin. Octave bands from a quarter of a hertz put the edge at 0.5, a twentieth
 * of a hertz below the wow rate, and split every wander in two: measured, 50
 * cents of wow read 34.3 in one band and 9.8 in the one below it, and 10 cents
 * of flutter read 4.1 and 4.8 either side of the 8 Hz edge. The bands here are
 * wide enough that each rate and its skirts fall inside one of them.
 *
 * The two in the middle and at the top hold nothing that either knob makes.
 * They are there because this is a reading of a transport and not of two
 * controls - anything that wanders between a quarter of a hertz and sixteen
 * has somewhere to be seen.
 *
 * Bands rather than the deviation curve itself, and that is the whole design.
 * Where in its cycle the window opens depends on how far back the probe had
 * to be read, which is the delay time - so two delays wandering identically
 * at two different times would have the same curve shifted sideways and read
 * as far apart as it is possible to be. That is exactly the mistake the first
 * arrival reading made by framing itself in milliseconds, and it is caught
 * the same way: measure the thing being asked about and nothing else. Energy
 * in a band does not know about phase.
 */
export const WANDER_BANDS = [
  { id: 'wow', from: 0.25, to: 1.5 },
  { id: 'middle', from: 1.5, to: 4.5 },
  { id: 'flutter', from: 4.5, to: 12 },
  { id: 'scrape', from: 12, to: 16 },
];

/**
 * How far the demodulator's smoothing corner sits below the probe.
 *
 * A tenth, three poles of it. Multiplying by the probe's own frequency leaves
 * the wander near nothing and an image of it up at twice the probe, and three
 * poles an octave and a bit down put that image eighty-odd decibels away
 * while costing a fifth of a decibel at sixteen hertz.
 */
const WANDER_CORNER = 0.1;
const WANDER_POLES = 3;

/**
 * The pitch the repeats come back at, frame by frame, in cents.
 *
 * A tone in, the wet taken out, and the instantaneous frequency of it read
 * off a quadrature pair: multiply by the probe to bring it down to nothing,
 * smooth, and take `(I*dQ - Q*dI) / (I*I + Q*Q)`, which is the derivative of
 * the phase without the arctangent or the unwrapping either side of it.
 *
 * With the feedback shut and on one head, and both of those are decisions
 * rather than conveniences.
 *
 * The feedback, because a delay that is fed back is a pile of repeats arriving
 * at once, each read at its own moment and so each at its own pitch, and the
 * deviation of a sum of copies is not the deviation of any of them. How long
 * the tail is is the decay curve's question.
 *
 * The head, because several heads on one transport are a comb. They are all
 * displaced by the same amount at the same moment, so their sum is a single
 * tone at the right instantaneous pitch and a fixed amplitude - which is fine
 * until that amplitude is near one of the comb's nulls, and then the pitch is
 * being read off almost nothing. Measured before this line existed: a
 * four-head pattern at 375 ms reported 6669 cents of wow where 50 was asked
 * for, which is not a wander, it is a tracker reading noise.
 *
 * What one head costs is a corner: the line's limit on how deep the wander
 * may go is held against the nearest head, so a short multi-head delay really
 * does wander less than this reading says. Measured, asked for fifty cents -
 * four heads at 20 ms gets 20.1 against the 27.4 one head gets, and at 40 ms
 * 40.4 against 50.0. Above sixty milliseconds there is no difference at all,
 * and the shortest delay any exercise asks for is a sixteenth note.
 */
export function wanderTrack(rate, settings) {
  const whole = { ...ECHO_DEFAULTS, ...settings };
  const core = echoCore(rate).set({ ...whole, feedback: 0, heads: 'single' });
  const [left] = sidesOf(whole);

  // Past the first repeat's arrival, and past the loop filters settling on it.
  const lead = Math.ceil(((left + 60) / 1000) * rate);
  const span = Math.ceil(WANDER_SECONDS * rate);
  const per = span / WANDER_FRAMES;

  // The probe and the pair it is demodulated against, as one rotation rather
  // than three trigonometric calls a sample. Three of them over four seconds
  // of audio is most of what this reading costs, and a complex multiply is
  // four multiplies and two adds. Renormalised every so often, because a
  // rotator's magnitude drifts with rounding and a probe that quietly fades
  // would read as a transport doing nothing.
  const step = (2 * Math.PI * WANDER_PROBE) / rate;
  const turnCos = Math.cos(step);
  const turnSin = Math.sin(step);
  let spinCos = 1;
  let spinSin = 0;
  const smooth = Math.exp(-2 * Math.PI * WANDER_PROBE * WANDER_CORNER / rate);
  const poleI = new Float64Array(WANDER_POLES);
  const poleQ = new Float64Array(WANDER_POLES);

  const frames = new Float32Array(WANDER_FRAMES);
  const counts = new Float32Array(WANDER_FRAMES);
  let lastI = 0;
  let lastQ = 0;

  for (let i = 0; i < lead + span; i += 1) {
    const x = spinSin;
    core.stereo(x, x);
    const heard = core.left;

    let valueI = heard * spinCos;
    let valueQ = -heard * spinSin;
    for (let k = 0; k < WANDER_POLES; k += 1) {
      poleI[k] = poleI[k] * smooth + valueI * (1 - smooth);
      poleQ[k] = poleQ[k] * smooth + valueQ * (1 - smooth);
      valueI = poleI[k];
      valueQ = poleQ[k];
    }

    if (i >= lead) {
      const power = valueI * valueI + valueQ * valueQ;
      // In cycles a sample, then in hertz, then in cents of the probe.
      const turn = power > 1e-12
        ? (valueI * (valueQ - lastQ) - valueQ * (valueI - lastI)) / power
        : 0;
      const hz = (turn * rate) / (2 * Math.PI);
      const cents = 1200 * Math.log2(Math.max(0.5, 1 + hz / WANDER_PROBE));
      const frame = Math.min(WANDER_FRAMES - 1, Math.floor((i - lead) / per));
      frames[frame] += cents;
      counts[frame] += 1;
    }
    lastI = valueI;
    lastQ = valueQ;

    const nextCos = spinCos * turnCos - spinSin * turnSin;
    spinSin = spinCos * turnSin + spinSin * turnCos;
    spinCos = nextCos;
    if ((i & 8191) === 8191) {
      const size = Math.sqrt(spinCos * spinCos + spinSin * spinSin);
      if (size > 1e-9) { spinCos /= size; spinSin /= size; }
    }
  }

  for (let f = 0; f < WANDER_FRAMES; f += 1) {
    if (counts[f] > 0) frames[f] /= counts[f];
  }
  return frames;
}

/**
 * That curve, as one RMS figure in cents a band.
 *
 * A plain Hann-windowed transform of a hundred and twenty-eight frames, and
 * the one-sided power in each band's bins. The window's own amplitude is
 * divided back out, so a pure wander of A cents peak reads as A over root two
 * in the band it falls in and nothing anywhere else. Measured:
 *
 *     setting         wow   middle   flutter   scrape      wanted
 *     wow 10         7.06     0.03      0.00     0.00        7.07
 *     wow 25        17.72     0.06      0.00     0.00       17.68
 *     wow 50        35.70     0.12      0.00     0.00       35.36
 *     flutter 10     0.05     0.00      6.34     0.01        7.07
 *     flutter 25     0.14     0.00     15.93     0.03       17.68
 *     both at 25    17.71     0.06     15.93     0.06
 *
 * Wow to within one per cent. Flutter nine per cent light, and the nine per
 * cent is the frames: a frame is 31.25 ms and a flutter cycle is 127, so
 * averaging the deviation across a frame costs sinc(7.9/32) = 0.911 of it.
 * Left uncorrected rather than scaled back up, because a per-band constant
 * fitted to one rate would be a calibration pretending to be a measurement -
 * and both sides of any comparison are measured the same way, so what it
 * costs is nine per cent of the reading's sensitivity to flutter and nothing
 * else. The bottom row is the one that matters: two wanders at once read as
 * themselves, side by side, neither hiding the other.
 */
export function wanderBands(frames) {
  const n = frames.length;
  // `taper` rather than the obvious name for it, because a DSP file that
  // mentions the browser's `window` is a DSP file that cannot be lifted out,
  // and there is a test in tests/seams.test.js that says so. It caught this.
  const taper = new Float64Array(n);
  let taperPower = 0;
  for (let i = 0; i < n; i += 1) {
    taper[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
    taperPower += taper[i] * taper[i];
  }
  const taperRms = Math.sqrt(taperPower / n);

  // The mean is the delay standing still, which is not wander.
  let mean = 0;
  for (let i = 0; i < n; i += 1) mean += frames[i];
  mean /= n;

  const perFrame = WANDER_FRAMES / WANDER_SECONDS;
  const out = new Float32Array(WANDER_BANDS.length);
  for (let b = 0; b < WANDER_BANDS.length; b += 1) {
    const band = WANDER_BANDS[b];
    let power = 0;
    for (let k = 1; k < n / 2; k += 1) {
      const hz = (k * perFrame) / n;
      if (hz < band.from || hz >= band.to) continue;
      let real = 0;
      let imag = 0;
      for (let i = 0; i < n; i += 1) {
        const turn = (2 * Math.PI * k * i) / n;
        const value = (frames[i] - mean) * taper[i];
        real += value * Math.cos(turn);
        imag -= value * Math.sin(turn);
      }
      power += 2 * ((real / n) ** 2 + (imag / n) ** 2);
    }
    out[b] = Math.sqrt(power) / taperRms;
  }
  return out;
}

/**
 * The axis two of these must share.
 *
 * No delay time in it, for the same reason the arrival axis has none: two
 * delays on two different times are the same kind of thing here, and saying
 * so is what makes "does yours wander like mine" a question at all.
 */
export const WANDER_AXIS = {
  kind: 'wander',
  bands: WANDER_BANDS.map((band) => band.id).join(','),
  probe: WANDER_PROBE,
  seconds: WANDER_SECONDS,
};

/** How much a delay's repeats wander, and at what rates. */
export function wanderReading(rate, settings, { source = null } = {}) {
  const whole = { ...ECHO_DEFAULTS, ...settings };
  return readingOf({
    tool: 'delay',
    kind: 'wander',
    of: { state: stampOf(whole), source, axis: WANDER_AXIS },
    values: wanderBands(wanderTrack(rate, whole)),
  });
}

/**
 * How far apart two transports are, in cents.
 *
 * The root mean square across the bands, which is what the other two
 * comparators do across theirs. Cents, so a tolerance set on it is in the
 * unit the knob is in, and `where` names the band they disagree about most -
 * "wow" and "flutter" being two different things to go and listen for.
 *
 * Measured, at 375 ms and half feedback:
 *
 *     wow 0 vs 10          3.53 cents      the time, 375 vs 900    0.00
 *     wow 10 vs 20         3.55            the feedback, +0.15     0.00
 *     wow 20 vs 30         3.57            the tone, an octave     0.00
 *     wow 30 vs 50         7.20            four heads              0.00
 *     flutter 0 vs 10      3.17            diffusion               0.00
 *     flutter 10 vs 25     4.79            tape                    0.00
 *     wow 25 vs flutter 25    11.86        ping-pong               0.00
 *                                          the mix                 0.00
 *
 * Linear in the depth, at about 3.5 cents for every ten on the knob, so a
 * tolerance resolves the wander to a fixed number of cents rather than to a
 * fraction of wherever it happens to be. Decisive between the two rates:
 * twenty-five cents of wow against twenty-five of flutter is twelve, which is
 * three times the gap between adjacent depths of either. And exactly zero for
 * everything that is not the transport, which is the half of a reading that
 * is usually the hard half - the probe runs with the feedback shut and on one
 * head, so there is nothing else in it to see. Nine of those eleven are
 * exactly zero; the two media read 2.11e-6 and 1.23e-4 cents, which is the
 * makeup gain changing the amplitude and so the rounding, not the phase.
 *
 * The same wander at five different delay times reads the same to within an
 * eighth of a cent, which is the phase-blindness the bands were chosen for.
 */
export function wanderGap(mine, theirs) {
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

  return {
    off: Math.sqrt(sum / Math.max(1, n)),
    where: WANDER_BANDS[at]?.id ?? 'nowhere',
    detail: { extra: worst, band: WANDER_BANDS[at]?.id ?? null },
  };
}

/* ---------- how far out of the way the repeats get, as a reading ---------- */

/**
 * The phrase this is measured against, and how finely.
 *
 * Something playing, a gap, something playing again - which is the whole
 * situation ducking exists for, and the shortest material that contains it.
 * Nothing about the delay is in the probe, so two delays set differently are
 * asked the same question.
 *
 * A reading over material rather than over a response, because the response
 * cannot carry this. A ducker's gain comes from a detector, a detector
 * integrates over time, and an impulse has no time: measured, one sample
 * raises a five-millisecond detector to 0.4 per cent of full scale, which is
 * four per cent of the threshold. So the duck a click causes is no duck at
 * all: 24 dB of it moves the response 0.35 dB, the decay reading 0.005 and the
 * loop shape 0.003, against tolerances of 2.6, 1.9 and 1.2. That is not a flaw
 * in the response - it is what an impulse is.
 *
 * Three seconds and ninety-six frames, so a frame is 31 ms - short enough to
 * see the duck arrive within one of them and long enough that the detector's
 * own ripple averages out of it.
 */
export const DUCK_SECONDS = 3;
export const DUCK_FRAMES = 96;

/** Where the probe says something and where it says nothing, in seconds. */
export const DUCK_PHRASES = [[0.1, 0.9], [1.6, 2.4]];

/**
 * The duck's own gain, frame by frame, in decibels.
 *
 * The gain and not the output, which is the decision that makes this a reading
 * of ducking rather than a reading of a delay. A wet output's envelope depends
 * on the time, the feedback, the heads and the tone as well; the gain the
 * ducker applies depends on the dry signal and the depth and nothing else. The
 * compressor is read the same way, and for the same reason.
 */
export function duckTrack(rate, settings) {
  const whole = { ...ECHO_DEFAULTS, ...settings };
  const core = echoCore(rate).set(whole);
  const span = Math.ceil(DUCK_SECONDS * rate);
  const per = span / DUCK_FRAMES;

  const frames = new Float32Array(DUCK_FRAMES);
  const counts = new Float32Array(DUCK_FRAMES);

  for (let i = 0; i < span; i += 1) {
    const at = i / rate;
    let x = 0;
    for (const [from, to] of DUCK_PHRASES) {
      if (at < from || at > to) continue;
      // Up and down at the ends, so the probe is a phrase rather than a pair
      // of clicks with a tone between them.
      const into = Math.min(1, (at - from) * 40);
      const outOf = Math.min(1, (to - at) * 40);
      x = (Math.sin(2 * Math.PI * 220 * (at - from)) * 0.5
        + Math.sin(2 * Math.PI * 440 * (at - from)) * 0.2) * into * outOf;
    }
    core.stereo(x, x);
    const frame = Math.min(DUCK_FRAMES - 1, Math.floor(i / per));
    frames[frame] += 20 * Math.log10(Math.max(1e-6, core.ducked));
    counts[frame] += 1;
  }

  for (let f = 0; f < DUCK_FRAMES; f += 1) {
    if (counts[f] > 0) frames[f] /= counts[f];
  }
  return frames;
}

/**
 * The axis two of these must share.
 *
 * The probe is in it, because a reading taken against one phrase cannot be
 * held against a reading taken against another - and unlike the delay time,
 * which two delays may differ in and still be compared, the probe is the
 * question rather than the answer.
 */
export const DUCK_AXIS = {
  kind: 'ducking',
  frames: DUCK_FRAMES,
  seconds: DUCK_SECONDS,
  phrases: DUCK_PHRASES.map(([a, b]) => `${a}-${b}`).join(','),
};

/** How far a delay gets its repeats out of the way, over a phrase and a gap. */
export function duckReading(rate, settings, { source = null } = {}) {
  const whole = { ...ECHO_DEFAULTS, ...settings };
  return readingOf({
    tool: 'delay',
    kind: 'ducking',
    of: { state: stampOf(whole), source, axis: DUCK_AXIS },
    values: duckTrack(rate, whole),
  });
}

/**
 * How far apart two duckers are, in decibels.
 *
 * The root mean square across the frames, as the other comparators do, and
 * `where` says whether they part company while the phrase is playing or in
 * the gap after it - which are two different faults: too little duck and too
 * slow to come back.
 */
export function duckGap(mine, theirs) {
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

  const when = (at / DUCK_FRAMES) * DUCK_SECONDS;
  const playing = DUCK_PHRASES.some(([from, to]) => when >= from && when <= to);
  return {
    off: Math.sqrt(sum / Math.max(1, n)),
    where: playing ? 'while the phrase is playing' : 'in the gap after it',
    detail: { extra: worst, at: when },
  };
}

/** A delay, built and read in the terms a guess is marked in. */
export function echoProfile(rate, settings, times = decayTimes()) {
  const echo = makeEcho(rate, settings);
  return decayProfile(wetDryImpulse(echo, settings.mix ?? ECHO_DEFAULTS.mix), rate, times);
}
