import { makeBiquad, setBiquad, runBiquad } from '../../lib/dsp.js';
import { LONGEST_TAIL, decayProfile, decayTimes, wetDryImpulse } from '../../lib/response.js';
import { LOOP_BEAT } from '../../lib/tempo.js';

// A delay, as an impulse response.
//
// What a delay is, for somebody using one, is in src/learn/notes/echo.js.
//
// The same trick the reverb plays, and for the same reason: a delay is linear,
// so everything it will ever do to anything is in what it does to one click.
// Writing it down that way means the repeats you see are the repeats you
// hear and the repeats a guess is marked against, and it means the tail lands
// exactly where the setting says rather than being retimed under a playhead.

/** Every knob, and where it starts. */
export const ECHO_DEFAULTS = {
  time: 375,         // ms between repeats
  feedback: 0.35,    // how much of each repeat goes round again
  tone: 6000,        // the low-pass inside the loop: repeats get darker
  lowCut: 120,       // the high-pass inside it: repeats get thinner
  pingPong: false,   // repeats alternating ears
  pingPongFrom: 'left', // which ear they start in
  offset: 0,         // ms the right side is behind the left, or in front of it
  heads: 'single',   // how many places the line is read from
  mix: 0.3,
};

/** Which side a ping-pong may be started from. */
export const PING_FROM = ['left', 'right'];

/**
 * The heads a delay can be read with, as fractions of the time on the knob.
 *
 * Fractions and not multiples, so the knob always means the longest repeat.
 * Multiples would put the last head of a four-head pattern four times further
 * out than the number on the control, and off the end of the range at
 * anything past a third of it.
 *
 * The feedback is taken from the longest head, so what goes round is the
 * whole pattern rather than one tap of it - which is what a tape loop with
 * three heads on it does.
 *
 * `heads3` is the RE-201's three playback heads. UA's model of the unit gives
 * head ranges of 69-177 ms, 131-337 and 189-489, which is 1 : 1.90 : 2.75 at
 * either end of the sweep; as fractions of the longest that is what these are.
 * The ratio repeated in guides is 1 : 2 : 3, and the hardware is not that -
 * so the measured figures win and the folklore is noted rather than used.
 *
 * `heads4` is Binson's drum: four heads equally spaced around it. With the
 * longest on a quarter note the others land on a sixteenth, an eighth and a
 * dotted eighth, which is where the dotted-eighth guitar idiom came from.
 *
 * What these cannot be is marked, and that is worth saying here rather than
 * discovering while writing an exercise. Read the way a delay guess is read -
 * as an energy decay curve - the patterns are almost the same thing:
 *
 *                 single    heads3    heads4
 *     single        0.00      1.16      1.32
 *     heads3        1.16      0.00      0.45
 *     heads4        1.32      0.45      0.00
 *
 * The tolerances that decide a pass are 2.6, 1.9 and 1.2 dB, so three heads
 * against four is a hit at every tier and one head against four is a hit at
 * two of the three. A decay curve says how the energy falls away and adding
 * earlier heads barely changes that - they fill in between the repeats while
 * the slope stays the feedback's. The positions are in the response and the
 * reading is not looking at them.
 *
 * Worse for an exercise, a time error swamps a pattern error: one head at
 * 300 ms against four at 400 reads 3.76 dB, so somebody could use the wrong
 * pattern and pass by getting the time right.
 *
 * So these are a sound to use and not yet a question to be asked. "Which
 * pattern?" wants a reading that looks at where the repeats are rather than
 * at how the energy goes - which is what `repeatsOf` below already describes,
 * and what diffusion would need too.
 */
export const HEAD_PATTERNS = [
  { id: 'single', label: 'One head', taps: [1] },
  { id: 'heads3', label: 'Three heads', taps: [1 / 2.75, 1.9 / 2.75, 1] },
  { id: 'heads4', label: 'Four heads', taps: [0.25, 0.5, 0.75, 1] },
];

/** One pattern, by id, and one head for anything that is not a pattern. */
export const headsOf = (id) =>
  HEAD_PATTERNS.find((pattern) => pattern.id === id) ?? HEAD_PATTERNS[0];

/** As long as a repeat may be, and as much of it as may go round again. */
export const LONGEST_TIME = 1500;
export const SHORTEST_TIME = 20;
export const MOST_FEEDBACK = 0.8;

/**
 * How far the two sides may be pulled apart, in milliseconds.
 *
 * A hundred and fifty covers both things an offset is for. Under about thirty
 * the two sides fuse and what you hear is width rather than two echoes - the
 * precedence effect, whose threshold is five to ten milliseconds on clicks
 * and nearer fifty on music, which is why this tool's beds are music. Above
 * that they come apart into two echoes on two sides, and a hundred and fifty
 * against the shortest delay on offer is as far apart as they need to go to
 * be plainly two.
 */
export const MOST_OFFSET = 150;

/**
 * How far each of those may be moved, which is where a plugin's knob ends.
 *
 * Here rather than in the plugin because two things now need it: the plugin,
 * to lay out a slider, and the sketchpad, which stores an insert's settings
 * and has to put a loaded file's numbers back inside the range the processor
 * expects. Two tables would be two tables to keep in step, and the day they
 * drift is the day a saved sketch loads as a different sound.
 */
export const ECHO_LIMITS = {
  time: [SHORTEST_TIME, LONGEST_TIME],
  feedback: [0, MOST_FEEDBACK],
  tone: [500, 20000],
  lowCut: [20, 800],
  offset: [-MOST_OFFSET, MOST_OFFSET],
  mix: [0, 1],
};

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
 * The two sides' times, in milliseconds, from one setting.
 *
 * The left is the time on the knob and the right is that plus the offset,
 * clamped back into the range a delay is allowed to be - otherwise a 1500 ms
 * delay with a positive offset would ask for a line longer than anything
 * else in this app renders.
 */
export function sidesOf(settings) {
  const left = Math.min(LONGEST_TIME, Math.max(SHORTEST_TIME, settings.time));
  const offset = Math.min(MOST_OFFSET, Math.max(-MOST_OFFSET, settings.offset ?? 0));
  const right = Math.min(LONGEST_TIME, Math.max(SHORTEST_TIME, left + offset));
  return [left, right];
}

/** Which ear a ping-pong starts in, as a channel index. */
const startsAt = (settings) => (settings.pingPongFrom === 'right' ? 1 : 0);

export function makeEcho(rate, params = {}) {
  const settings = { ...ECHO_DEFAULTS, ...params };
  const times = sidesOf(settings);
  const feedback = Math.min(MOST_FEEDBACK, Math.max(0, settings.feedback));
  // One line a side, because the two sides can be on two times. They shared
  // a length and an index when they could only ever be the same.
  const steps = times.map((ms) => Math.max(1, Math.round((ms / 1000) * rate)));
  const step = Math.max(...steps);

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
  const lines = steps.map((n) => new Float32Array(n));
  const ats = [0, 0];
  const from = startsAt(settings);

  // Where each head reads, in samples back from the write head. The longest
  // is the line itself, which is the one the feedback is taken from, so it is
  // read as the sample about to be overwritten rather than as an offset.
  const taps = steps.map((n) => headsOf(settings.heads).taps
    .slice(0, -1)
    .map((tap) => Math.max(1, Math.round(n * tap)))
    .filter((d) => d < n));
  const tone = channels.map(() => setBiquad(makeBiquad(), 'lowpass', settings.tone, rate));
  const cut = channels.map(() => setBiquad(makeBiquad(), 'highpass', settings.lowCut, rate));

  for (let i = 0; i < length; i += 1) {
    // An impulse in, once.
    const input = i === 0 ? 1 : 0;

    // The longest head: the sample written a whole line ago, which is both an
    // output and the only thing that goes round again.
    const taken = [lines[0][ats[0]], lines[1][ats[1]]];
    channels[0][i] = taken[0];
    channels[1][i] = taken[1];

    // And the shorter heads, which are heard and not fed back - so a pattern
    // repeats as a pattern instead of each head breeding its own train.
    for (let c = 0; c < 2; c += 1) {
      for (const d of taps[c]) {
        channels[c][i] += lines[c][(ats[c] - d + steps[c]) % steps[c]];
      }
    }

    // Each side is filtered once a sample, and then routed. Filtering it
    // again on the way past the other channel would be running one filter's
    // state forward twice in a sample, which is a different filter.
    const rounded = [0, 0];
    for (let c = 0; c < 2; c += 1) {
      let value = taken[c];
      if (settings.tone < 20000) value = runBiquad(tone[c], value);
      if (settings.lowCut > 20) value = runBiquad(cut[c], value);
      rounded[c] = value;
    }

    for (let c = 0; c < 2; c += 1) {
      // Ping-pong sends what came out of one ear into the other, so the
      // repeats walk across rather than sitting on top of each other - and
      // the input lands in one line alone, because that is what starts them
      // alternating. Which one is now a setting.
      //
      // The crossing is in the response and not in the graph, and that is a
      // limit worth knowing: a two-channel convolver pairs channel with
      // channel, so a source already hard on one side has nothing on the
      // other for the crossed half of the response to act on. Measured, a
      // 375 ms ping-pong at half feedback, repeats only:
      //
      //     source       plain delay L / R        ping-pong L / R
      //     centred      -5.33 / -5.33 dB         -5.33 / -11.36 dB
      //     hard left    -2.23 / silent           -2.23 / silent
      //     hard right    silent / -2.23 dB        silent / -8.26 dB
      //
      // So a hard-panned source does not ping-pong at all. Everything in this
      // app that reaches a delay is mono - the beds are, and a track's pan is
      // applied after its inserts - so it is right where it is used and wrong
      // where it is not. Crossing properly wants a four-channel response and
      // true-stereo convolution, which is its own job.
      const feeds = settings.pingPong ? 1 - c : c;
      const feed = settings.pingPong ? (c === from ? input : 0) : input;
      lines[c][ats[c]] = feed + rounded[feeds] * feedback;
    }

    ats[0] = (ats[0] + 1) % steps[0];
    ats[1] = (ats[1] + 1) % steps[1];
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

/** A delay, built and read in the terms a guess is marked in. */
export function echoProfile(rate, settings, times = decayTimes()) {
  const echo = makeEcho(rate, settings);
  return decayProfile(wetDryImpulse(echo, settings.mix ?? ECHO_DEFAULTS.mix), rate, times);
}
