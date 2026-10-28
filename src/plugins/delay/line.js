import { makeBiquad, setBiquad, runBiquad } from '../../lib/dsp.js';
import {
  LONGEST_TAIL, decayProfile, decayTimes, wetDryImpulse, monoOf,
} from '../../lib/response.js';
import { readingOf, stampOf } from '../../lib/read.js';
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
  diffusion: 0,      // how smeared each pass is, 0 to 1
  machine: 'digital', // what the repeats are stored on
  mix: 0.3,
};

/**
 * The all-passes diffusion is made of, as fractions of the loop.
 *
 * Three Schroeder all-passes, `y[n] = -a*x[n] + x[n-M] + a*y[n-M]`, in the
 * feedback path. Each one passes everything and delays it by frequency, so a
 * sharp repeat comes back as a short burst of itself - and because they are
 * in the loop, every pass is smeared once more than the one before. That
 * progression is the whole point: it is the road from an echo to a room, and
 * it is the only control here that crosses it.
 *
 * Fractions of the loop rather than fixed milliseconds, for two reasons. The
 * shortest delay on offer is twenty milliseconds and a fixed three-stage
 * chain in the range this wants - three to fifteen milliseconds a stage - is
 * longer than the whole loop. And measuring in fractions is what the loop
 * reading does, so diffusion looks the same to it at every time.
 *
 * Not round numbers, and not multiples of each other: all-passes at related
 * delays ring together and what should be a smear comes out as a pitch.
 *
 * Measured at 400 ms and 0.6 feedback, the middle ninety per cent of each
 * pass's energy, and where its centre of gravity sits:
 *
 *     diffusion   pass 1   pass 2   pass 3     centres
 *     0             0 ms     0 ms     0 ms     400 / 800 / 1200 ms
 *     0.5           0 ms    30 ms    68 ms     400 / 800 / 1200
 *     1             0 ms    80 ms   156 ms     400 / 800 / 1200
 *
 * Each pass wider than the last and every centre exactly on its slot. The
 * centres staying put is what shortening the line buys: without it the
 * repeats would drag later with every pass and a diffusion knob would be a
 * time knob wearing the wrong label.
 *
 * And the loop reading sees it, which is what makes it markable - 5.65 dB for
 * a tenth of diffusion against none, 15.86 for all of it, and about 5 dB
 * between adjacent quarters. Against the 6 dB the hard tier allows, that
 * resolves diffusion to roughly a third of its travel, which is about what
 * anybody can hear of it.
 */
const DIFFUSE_AT = [0.0371, 0.0241, 0.0167];

/** The coefficient at the top of the knob. */
const MOST_DIFFUSE = 0.7;

/**
 * The machines a delay can be, and what each one does to the tone.
 *
 * The one thing that tells these apart by ear is not how dark they are but
 * how their darkness moves with the time, so that is what is modelled and
 * the rest is left alone. A digital delay has the same bandwidth at every
 * setting. The other two do not, and for different reasons.
 *
 * A bucket brigade is a line of buckets clocked along, and the delay is the
 * number of stages over twice the clock - Raffel and Smith, DAFx-10. So the
 * clock is `N / 2*tau`, and a longer delay means a slower clock, which has
 * to be band-limited further down to keep its own sampling out of the audio.
 * A 4096-stage chip at 300 ms wants a 6,827 Hz clock and so a signal band-
 * limited to 3,413; the anti-alias and reconstruction filters in a real pedal
 * sit between a third and a half of the clock, which is where the corner
 * below comes from. Longer delay, darker repeats - the exact opposite of a
 * digital delay, and the tell.
 *
 * Tape with a fixed head and a variable speed is the same shape of story from
 * different physics. Every loss term on the playback side scales with
 * `k = 2*pi*f / v` (Chowdhury, DAFx-19), so halving the speed halves the
 * frequency everything happens at - and with the heads a fixed distance
 * apart, a longer delay is a slower tape. One constant in hertz-seconds
 * carries that, rather than four parameters whose values would be invented.
 * The head bump comes along with it: a head is a loop of wire that responds
 * where the wavelength on the tape matches it, so that moves with the speed
 * too, and it is what makes tape warm rather than only dark.
 *
 * Behavioural and not physical, on purpose. CHOW Tape solves a hysteresis ODE
 * at sixteen times oversampling; none of that is identifiable by ear once it
 * is inside an echo, and this runs in a browser on a phone.
 *
 * Marked by the reading that was already there, with no scoring change: the
 * decay curve reads three bands over time, and a machine that takes the top
 * off shows up in the top one. Measured, with the tolerances that decide a
 * pass being 2.6, 1.9 and 1.2 dB:
 *
 *     at 200 ms   digital vs tape   2.17 dB   digital vs bbd    4.87   tape vs bbd    4.47
 *     at 400 ms                     2.85                       12.33                 10.52
 *     at 800 ms                     6.32                       17.11                 11.37
 *
 * Further apart the longer the delay, which is the whole point of the model
 * rather than a convenience. The one weak pair is digital against tape at
 * 200 ms, which at 2.17 dB would pass the easy tier - and that is honest,
 * because a 200 ms tape delay is not very dark.
 */
export const MACHINES = [
  { id: 'digital', label: 'Digital' },
  { id: 'tape', label: 'Tape' },
  { id: 'bbd', label: 'Bucket brigade' },
];

/** The stages in the chip this is modelled on, an MN3005. */
export const BBD_STAGES = 4096;

/** Where the pedal's own filters sit, as a fraction of the clock. */
const BBD_AT = 0.4;

/**
 * Tape's corner, in hertz-seconds.
 *
 * At 375 ms this puts it at 6 kHz, which is about where a worn quarter-inch
 * loop at a few inches a second gives out. Divided by the time, so half the
 * speed is half the corner.
 */
const TAPE_AT = 2250;

/**
 * And its head bump: where, in hertz-seconds, how much, and how far it may go.
 *
 * Its own range, which is the bug this comment exists for. The corner's clamp
 * runs from 1500 Hz up, and reusing it here pinned the bump at 1500 at every
 * delay - a peak in the middle of the midrange wearing the name of something
 * that lives two octaves below it. A head bump is tens of hertz, so it gets
 * tens of hertz.
 */
const TAPE_BUMP_AT = 45;
const TAPE_BUMP_DB = 2.5;
const BUMP_FLOOR = 35;
const BUMP_CEILING = 160;

/**
 * The tone the medium's makeup is referenced to, in hertz.
 *
 * Three hundred: under the 1500 Hz floor the corner has, so it is always on
 * the flat part of the response, and well above the head bump's ceiling so
 * the bump is not what is being levelled.
 */
const MEDIUM_REF = 300;

/** As dark and as bright as any machine is allowed to get. */
export const MACHINE_FLOOR = 1500;
export const MACHINE_CEILING = 18000;

const inRange = (hz) => Math.min(MACHINE_CEILING, Math.max(MACHINE_FLOOR, hz));

/**
 * What a machine does to the tone at a given delay, or null for none.
 *
 * `stages` is how many cascaded low-passes it takes. Two for a bucket
 * brigade, because a pedal has an anti-alias filter going in and a
 * reconstruction filter coming out and the pair of them is steep; one for
 * tape, whose losses roll off gently. Cascaded rather than a designed
 * Butterworth: `setBiquad` holds Q at root-half, so two of them put the
 * corner 6 dB down rather than 3 - which is nearer what a cascade of
 * Sallen-Key stages in a real pedal does than a textbook fourth-order would
 * be, and the model is behavioural anyway.
 */
export function machineTone(id, ms) {
  const seconds = Math.max(ms, 1) / 1000;

  if (id === 'bbd') {
    const clock = BBD_STAGES / (2 * seconds);
    return { corner: inRange(clock * BBD_AT), stages: 2, bump: 0, bumpAt: 0, clock };
  }

  if (id === 'tape') {
    return {
      corner: inRange(TAPE_AT / seconds),
      stages: 1,
      bump: TAPE_BUMP_DB,
      bumpAt: Math.min(BUMP_CEILING, Math.max(BUMP_FLOOR, TAPE_BUMP_AT / seconds)),
      clock: 0,
    };
  }

  return null;
}

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
  diffusion: [0, 1],
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
  // Diffusion's all-passes sit in the feedback path, and they add their own
  // delay to the loop - so the line is shortened by exactly as much, and the
  // loop comes out at the time on the knob whatever the diffusion is. In
  // integer samples on both sides of that subtraction, or the compensation
  // would be a sample or two out and the repeats would drift.
  const smear = Math.min(1, Math.max(0, settings.diffusion ?? 0)) * MOST_DIFFUSE;
  const spread = steps.map((n) => DIFFUSE_AT.map((f) => Math.max(1, Math.round(n * f))));
  const held = spread.map((list) => list.reduce((sum, d) => sum + d, 0));

  const lines = steps.map((n, c) => new Float32Array(Math.max(1, n - held[c])));
  const spans = lines.map((line) => line.length);
  // The output is taken in front of the all-passes, so that the first repeat
  // is still the unfiltered sound that went in - and it is delayed by what
  // they hold, so it still lands on the time rather than early.
  const lag = held.map((n) => new Float32Array(Math.max(1, n)));
  const lagAt = [0, 0];
  // One buffer and one output per all-pass stage.
  const apBuf = spread.map((list) => list.map((d) => new Float32Array(d)));
  const apAt = spread.map((list) => list.map(() => 0));

  const ats = [0, 0];
  const from = startsAt(settings);

  /** One all-pass stage, in place. */
  const allpass = (c, k, x) => {
    const buf = apBuf[c][k];
    const at = apAt[c][k];
    const was = buf[at];
    const out = was - smear * x;
    buf[at] = x + smear * out;
    apAt[c][k] = (at + 1) % buf.length;
    return out;
  };

  // Where each head reads, in samples back from the write head. The longest
  // is the line itself, which is the one the feedback is taken from, so it is
  // read as the sample about to be overwritten rather than as an offset.
  // A head at a fraction of the loop has to come out at that fraction of the
  // time, and everything read here goes out through the lag - so the offset
  // into the line is the fraction of the whole loop less what the all-passes
  // hold. Measured against the full step and not the shortened line, which is
  // the mistake that put four heads at 76, 152, 228 ms instead of 100, 200,
  // 300 and was caught by the test that names those numbers.
  const taps = steps.map((n, c) => headsOf(settings.heads).taps
    .slice(0, -1)
    .map((tap) => Math.round(n * tap) - held[c])
    .filter((d) => d >= 1 && d < spans[c]));
  const tone = channels.map(() => setBiquad(makeBiquad(), 'lowpass', settings.tone, rate));
  const cut = channels.map(() => setBiquad(makeBiquad(), 'highpass', settings.lowCut, rate));

  // The machine's own response, which is not a knob: its corner comes from
  // the delay time and the medium, and it sits on the way into the line
  // rather than in the feedback path with the user's filters. That is the
  // difference between a medium and an EQ - a signal goes through a bucket
  // brigade once to come back once, so the first repeat is already dark,
  // where the tone knob leaves it alone by design.
  const medium = machineTone(settings.machine, times[0]);
  const mediumLp = channels.map(() => (medium
    ? Array.from({ length: medium.stages },
      () => setBiquad(makeBiquad(), 'lowpass', medium.corner, rate))
    : []));
  const mediumBump = channels.map(() => (medium && medium.bump > 0
    ? setBiquad(makeBiquad(), 'peaking', medium.bumpAt, rate, medium.bump)
    : null));

  /**
   * What the medium costs, taken back off it.
   *
   * A machine that changed the level would make choosing one a loudness test,
   * which is the one comparison this app refuses to leave in. Measured on an
   * impulse at 400 ms, before this:
   *
   *     digital   peak   0.00 dB   energy   3.77 dB
   *     tape      peak  -9.03 dB   energy  -1.04 dB
   *     bbd       peak -20.97 dB   energy  -7.86 dB
   *
   * Five decibels of energy for tape and twelve for a bucket brigade, which
   * is a volume knob wearing a machine's name. Hardware does not do that
   * either: a BBD pedal has a compander across the chip and 0 to 2 dB of
   * insertion gain, and a tape machine has a record level.
   *
   * So the chain's gain is measured once, here, and divided out on the way to
   * the ears - on the output and not inside the loop, which is the whole of
   * what makes this safe. Putting it in the loop multiplies the feedback by
   * it: at 400 ms a bucket brigade's chain wants 3.8 times gain, so a
   * feedback of 0.4 became a loop gain of 1.52 and the thing ran away.
   * Measured as it did, the response came out at +27.78 dB of energy against
   * digital's +3.77.
   *
   * Outside the loop it corrects the first repeat and leaves the compounding
   * alone, which is right: a pass through a bucket brigade costs top end, so
   * each repeat really is darker and shorter-lived than the last, and a
   * machine with fewer usable repeats than a digital delay is a machine
   * behaving. What is taken out is the insertion loss - the 0 to 2 dB a real
   * pedal makes up with a compander - and not the medium itself.
   *
   * Referenced to a tone in the body of the sound rather than to the whole
   * impulse's energy, which was the first thing tried and is wrong in a way
   * that reads as a feature. Matching total energy gives a dark machine all
   * of its lost energy back across whatever bandwidth it has left, so it
   * comes out bassier than a digital delay rather than merely duller -
   * measured, a bucket brigade read 12.8 dB hotter than digital over 60 to
   * 400 Hz. Matching one tone below every corner this allows leaves the body
   * where it was and lets the top go, which is what a machine takes.
   */
  const mediumGain = (() => {
    if (!medium) return 1;
    const probe = Array.from({ length: medium.stages },
      () => setBiquad(makeBiquad(), 'lowpass', medium.corner, rate));
    const bump = medium.bump > 0
      ? setBiquad(makeBiquad(), 'peaking', medium.bumpAt, rate, medium.bump)
      : null;

    // A tone at MEDIUM_REF, run until it settles, and the amplitude of what
    // comes out. Below every corner a machine is allowed and above every
    // head bump, so it is measuring the flat part of the response rather
    // than any of the shape.
    const settle = Math.ceil(rate * 0.25);
    let loudest = 0;
    for (let i = 0; i < settle; i += 1) {
      let value = Math.sin((2 * Math.PI * MEDIUM_REF * i) / rate);
      for (const lp of probe) value = runBiquad(lp, value);
      if (bump) value = runBiquad(bump, value);
      // The last tenth, by which time the filters have forgotten their start.
      if (i > settle * 0.9) loudest = Math.max(loudest, Math.abs(value));
    }
    return loudest > 1e-6 ? 1 / loudest : 1;
  })();

  /** One pass through the medium, if there is one. No gain: see above. */
  const through = (c, x) => {
    if (!medium) return x;
    let value = x;
    for (const lp of mediumLp[c]) value = runBiquad(lp, value);
    if (mediumBump[c]) value = runBiquad(mediumBump[c], value);
    return value;
  };

  for (let i = 0; i < length; i += 1) {
    // An impulse in, once.
    const input = i === 0 ? 1 : 0;

    // The longest head: the sample written a whole line ago, which is both an
    // output and the only thing that goes round again.
    const taken = [lines[0][ats[0]], lines[1][ats[1]]];

    // Out through the lag, so the first repeat lands on the time even though
    // it is read in front of the all-passes.
    const heard = [0, 0];
    for (let c = 0; c < 2; c += 1) {
      heard[c] = lag[c][lagAt[c]];
      lag[c][lagAt[c]] = taken[c];
      // And the shorter heads, which are heard and not fed back - so a
      // pattern repeats as a pattern instead of each head breeding its own
      // train. Read against the line's own length, which diffusion shortens.
      for (const d of taps[c]) {
        lag[c][lagAt[c]] += lines[c][(ats[c] - d + spans[c]) % spans[c]];
      }
    }
    channels[0][i] = heard[0] * mediumGain;
    channels[1][i] = heard[1] * mediumGain;

    // Each side is filtered once a sample, and then routed. Filtering it
    // again on the way past the other channel would be running one filter's
    // state forward twice in a sample, which is a different filter.
    const rounded = [0, 0];
    for (let c = 0; c < 2; c += 1) {
      let value = taken[c];
      if (settings.tone < 20000) value = runBiquad(tone[c], value);
      if (settings.lowCut > 20) value = runBiquad(cut[c], value);
      // The all-passes last, so what gets smeared is what is going round
      // again rather than what is coming out. At a coefficient of nothing
      // each one is `x[n-M]` exactly, with no arithmetic left in it, so the
      // whole chain is a pure delay and no diffusion is bit-identical to a
      // delay that never had any.
      for (let k = 0; k < apBuf[c].length; k += 1) value = allpass(c, k, value);
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
      lines[c][ats[c]] = through(c, feed + rounded[feeds] * feedback);
    }

    lagAt[0] = (lagAt[0] + 1) % lag[0].length;
    lagAt[1] = (lagAt[1] + 1) % lag[1].length;
    ats[0] = (ats[0] + 1) % spans[0];
    ats[1] = (ats[1] + 1) % spans[1];
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
 * Two either side. Without it the reading is a hair trigger - a repeat that
 * moves into the next frame swings the full sixty decibels - and with it a
 * small shift is a small change.
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

/** Where a delay's repeats land inside its own loop, in an envelope. */
export function repeatsReading(rate, settings, { source = null } = {}) {
  const whole = { ...ECHO_DEFAULTS, ...settings };
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
