import { makeBiquad, setBiquad, runBiquad } from '../../lib/dsp.js';
import { mulberry32 } from '../../lib/random.js';
import {
  RESPONSE_BANDS, LONGEST_TAIL, decayProfile, decayTimes, monoOf, wetDryImpulse,
} from '../../lib/response.js';

// A room, as an impulse response.
//
// What a reverb is, for somebody using one, is in src/learn/notes/verb.js.
//
// The reverb here is convolution: the settings make an impulse response and
// the loop is convolved with it. That is more work than an algorithmic reverb
// and it buys the thing this whole app is built on - the picture on screen is
// not a drawing of what the reverb is doing, it is the reverb. The same array
// is convolved, measured, displayed and marked, so there is nothing for the
// three of them to disagree about.
//
// It also means the numbers are real numbers. A decay time is measured off
// the response the way an acoustician measures a hall, rather than being
// whatever the feedback coefficient happened to produce.

/** Every knob, and where it starts. */
export const VERB_DEFAULTS = {
  space: 'room',     // which kind of space this is
  preDelay: 20,      // ms of silence before the room answers
  decay: 1.8,        // RT60 of the mid band, in seconds - the number anyone quotes
  size: 18,          // metres - how far away the first walls are
  bass: 1,           // how much longer the lows ring than the mids: 1 is not at all
  damping: 0.55,     // how much shorter the highs decay: 1 is not at all
  early: 0.35,       // the level of the early reflections against the tail
  lowCut: 20,        // Hz, on the way in
  highCut: 20000,    // Hz, on the way in
  spread: 0.5,       // dispersion: how far ahead of the lows the highs arrive
  tension: 0.5,      // a spring's: how fast the bounces come round
  mix: 0.3,          // 0 is dry, 1 is nothing but room
};

/**
 * The kinds of space, and which knobs each one has.
 *
 * A space is not a preset. A room has walls, so it has a size in metres and a
 * level for the reflections off them; a plate has neither, because a plate is
 * a sheet of steel and there is nothing in it for sound to bounce off at a
 * distance. Handing a plate a Size knob that quietly does nothing would be a
 * preset wearing a plugin's controls.
 *
 * So each space says what it is called, what to call it on the display, what
 * it is made of and what it answers to - the way the saturator's curve
 * families do - and the deck is rebuilt when it changes.
 * What the two share - pre-delay, decay, damping, the send filters, the mix -
 * keeps its setting across the change: what you had the decay at is still
 * what you want the decay at.
 */
export const SPACES = {
  room: {
    label: 'Room',
    shown: 'the room',
    knobs: ['preDelay', 'decay', 'bass', 'damping', 'size', 'early', 'lowCut', 'highCut', 'mix'],
  },
  plate: {
    label: 'Plate',
    shown: 'the plate',
    knobs: ['preDelay', 'decay', 'bass', 'damping', 'spread', 'lowCut', 'highCut', 'mix'],
  },
  gated: {
    label: 'Gated',
    shown: 'the gate',
    // No band multiples: nothing decays for them to be multiples of. The
    // decay knob says how long it holds before the gate shuts.
    knobs: ['preDelay', 'decay', 'size', 'early', 'lowCut', 'highCut', 'mix'],
  },
  reverse: {
    label: 'Reverse',
    shown: 'the room, backwards',
    knobs: ['preDelay', 'decay', 'bass', 'damping', 'size', 'early', 'lowCut', 'highCut', 'mix'],
  },
  spring: {
    label: 'Spring',
    shown: 'the tank',
    // No size, no early, no bass. A tank has no walls to be a distance from
    // and nothing underneath to lift.
    knobs: ['preDelay', 'decay', 'tension', 'spread', 'damping', 'lowCut', 'highCut', 'mix'],
  },
};

export const SPACE_ORDER = ['room', 'plate', 'gated', 'reverse', 'spring'];

/** Which knobs a space has, by id, for a deck to be built from. */
export const verbDeckFor = (space) => (SPACES[space] ?? SPACES.room).knobs;

/**
 * Where the tail is split, and why the two edges are not in the same place.
 *
 * It used to split once at 1200 Hz into something that damps and something
 * that does not, while `decayProfile` read three bands at 60-400, 400-3000
 * and 3000-12000 - two band plans with nothing to do with each other. The
 * result was a damping knob that moved one of the three readings. Measured,
 * at decay 1.8 s, across the whole range of the knob:
 *
 *     damping    low(60-400)   mid(400-3k)   high(3k-12k)
 *       0.20       1.80 s        1.83 s        0.41 s
 *       0.55       1.80 s        1.65 s        1.01 s
 *       1.00       1.83 s        1.80 s        1.80 s
 *
 * The low band never moved at all - it sat entirely inside the slow half of a
 * split at 1200 - and the mid band moved ten per cent, which is inside the
 * smallest difference in reverberation time anyone can hear.
 *
 * The obvious fix is to split where the bands are read, so each knob names a
 * reading. Half of it works. The other half does not, and the measurement is
 * worth keeping because the answer is not symmetrical:
 *
 *     split at       damping 0.2 -> 1.0, read 3k-12k      bass 0.5 -> 2.0, read 60-400
 *     400 / 3000     1.19 0.99 1.13 1.40 1.82  <- falls then rises
 *     400 / 2000     0.53 0.69 1.02 1.37 1.82      1.28 1.52 1.91 2.65 3.61
 *     400 / 1500     0.38 0.65 1.01 1.37 1.82      1.28 1.50 1.92 2.67 3.61
 *     300 / 1500     0.38 0.66 1.01 1.37 1.82      1.53 1.61 1.91 2.65 3.52
 *     250 / 1500     0.38 0.66 1.01 1.37 1.82      1.64 1.71 1.91 2.53 3.45
 *
 * Splitting the top at 3000 gives a damping knob that goes down and then back
 * up. At 0.2 the high band dies so fast that what is left in the reading is
 * the mid band's skirt, and the skirt is strongest right at 3000 because that
 * is where the crossover is. A band has to be well clear of the skirt of the
 * one below it by the time the reading that measures it begins - so the top
 * splits an octave early, at 1500, where by 3000 the mid band is 24 dB down
 * and the reading is the high band and nothing else.
 *
 * The bottom has the opposite problem and so takes the opposite answer. The
 * low reading is 60-400, which is narrow and ends where the crossover would
 * be, so putting the split at 400 is what puts the whole of that reading
 * inside the band the knob moves. Moving it down to 250 costs the bass knob
 * most of its downward range: 0.5x reads 1.64 s instead of 1.28.
 *
 * Sharpness is not a taste either. Measured as how much of each band's energy
 * lands in the reading it is meant for, and how flat the three sum back:
 *
 *     stages   low / mid / high purity      summed against white
 *       1      73% / 76% / 95%              -3.61 / -4.81 / -2.01 dB
 *       2      90% / 90% / 98%              -0.05 / -0.18 / -0.02 dB
 *       3      95% / 95% / 99%              -2.14 / -2.41 / -0.89 dB
 *
 * One stage is too shallow to separate and does not sum flat; three separate
 * better and do not sum flat either. Two does both, which is the whole reason
 * Linkwitz-Riley exists, and is what makes a space with no damping and no
 * bass lift the flat noise it always was.
 */
const BAND_EDGES = [RESPONSE_BANDS[0].high, 1500];
const CROSSOVER_POLES = 2;

/**
 * Early reflections, as fractions of the time it takes sound to cross the
 * room and come back.
 *
 * A fixed pattern rather than a random one, so that a room of a given size is
 * the same room every time it is built - on every machine, for everybody's
 * daily. The spacing is uneven because a rectangular room's first reflections
 * are uneven; an even comb sounds like a comb.
 */
const TAPS = [0.21, 0.34, 0.41, 0.58, 0.63, 0.79, 0.87, 1.0, 1.19, 1.31];

/** How fast sound travels, in metres a second. */
const SPEED = 343;

/**
 * How long a room of a given size takes to become a wash, in seconds.
 *
 * This used to be the time it takes sound to cross the room and come back,
 * times 1.4 - which is linear in size, and mixing time is not. The number of
 * reflections arriving by time t grows as t cubed over the volume, so the
 * moment the reflections run together goes as the square root of the volume:
 * Griesinger's rule of thumb is sqrt(V) milliseconds, V in cubic metres. The
 * knob names one dimension, so a cube of that side is the fair reading of it,
 * and sqrt(size cubed) is size to the three halves.
 *
 * Measured, against what the old rule gave:
 *
 *     size     was      is    the old rule was
 *      4 m    33 ms    8 ms       4.08x too slow
 *      8 m    65 ms   23 ms       2.89x
 *     18 m   147 ms   76 ms       1.92x
 *     35 m   286 ms  207 ms       1.38x
 *     60 m   490 ms  465 ms       1.05x
 *
 * Right at the top of the range and four times out at the bottom, which is
 * the shape of an error that comes from using a length where a volume
 * belongs. What it sounded like is a small room taking as long to turn to a
 * wash as a hall does - so the size knob changed the delay before the wash
 * and barely the character of it, and small rooms did not sound small.
 *
 * The numbers it gives are the ones the acoustics books give: eight
 * milliseconds for a room four metres across, 76 for a hall of eighteen,
 * 465 for a cathedral of sixty.
 */
export const mixingTime = (size) => size ** 1.5 / 1000;

/** The longest room on offer, plus room for it to finish. */
export const MOST_DECAY = LONGEST_TAIL;

/**
 * How far each of those may be moved, which is where a plugin's knob ends.
 *
 * Here rather than in the plugin because two things now need it: the plugin,
 * to lay out a slider, and the sketchpad, which stores an insert's settings
 * and has to put a loaded file's numbers back inside the range the processor
 * expects. Two tables would be two tables to keep in step, and the day they
 * drift is the day a saved sketch loads as a different sound.
 */
export const VERB_LIMITS = {
  preDelay: [0, 200],
  decay: [0.2, MOST_DECAY],
  size: [4, 60],
  bass: [0.5, 2],
  damping: [0.2, 1],
  early: [0, 0.8],
  lowCut: [20, 800],
  highCut: [1500, 20000],
  spread: [0, 1],
  tension: [0, 1],
  mix: [0, 1],
};
const CACHE_SECONDS = MOST_DECAY * 1.1 + 0.5;

/**
 * The noise every space is made from, split once and kept.
 *
 * Every space is the same noise under three envelopes - the filtering that
 * splits it depends on neither the decay nor the damping, only on where the
 * bands are read. Doing it per room meant biquads a sample a channel, which
 * came to a sixth of a second to build an eight second hall: a knob you could
 * turn and then wait for. Split once, building a space is a multiply and an
 * add.
 *
 * It also means a space is the same space every time it is asked for, on
 * every machine, which is what a shared daily needs.
 *
 * The middle band is a band-pass and not what is left over after the other
 * two. Subtraction looks exact - the three sum back to the original by
 * construction - and is not a split at all: measured, `white - low - high`
 * put 73% of its energy above 3 kHz, because a steep high-pass has phase
 * shift up there and subtracting it does not cancel. A ladder of lowpasses
 * sums exactly too and separates no better: its top band reads 31% in the mid
 * band. See BAND_EDGES for the slope, which is the other half of this.
 */
const splits = new Map();

function noiseBands(rate) {
  const held = splits.get(rate);
  if (held) return held;

  const length = Math.ceil(rate * CACHE_SECONDS);
  const noise = mulberry32(0x5eed1e);
  const bands = { low: [], mid: [], high: [], length };
  const stack = (kind, hz) => Array.from({ length: CROSSOVER_POLES },
    () => setBiquad(makeBiquad(), kind, hz, rate));

  for (let c = 0; c < 2; c += 1) {
    const low = new Float32Array(length);
    const mid = new Float32Array(length);
    const high = new Float32Array(length);

    const lows = stack('lowpass', BAND_EDGES[0]);
    const midLows = stack('highpass', BAND_EDGES[0]);
    const midHighs = stack('lowpass', BAND_EDGES[1]);
    const highs = stack('highpass', BAND_EDGES[1]);

    for (let i = 0; i < length; i += 1) {
      const white = noise() * 2 - 1;
      let l = white;
      let m = white;
      let h = white;
      for (const stage of lows) l = runBiquad(stage, l);
      for (const stage of midLows) m = runBiquad(stage, m);
      for (const stage of midHighs) m = runBiquad(stage, m);
      for (const stage of highs) h = runBiquad(stage, h);
      low[i] = l;
      mid[i] = m;
      high[i] = h;
    }

    bands.low.push(low);
    bands.mid.push(mid);
    bands.high.push(high);
  }

  splits.set(rate, bands);
  return bands;
}

/**
 * How a plate scatters a sound across the audio band, and why that is the
 * whole of what makes it a plate rather than a short bright room.
 *
 * A plate is a steel sheet about half a millimetre thick, and what travels
 * across it is a bending wave rather than a pressure wave. Bending waves are
 * dispersive: group velocity goes as the square root of frequency, so the top
 * of a transient crosses the plate and arrives while the bottom of it is
 * still on the way. That is the "whip" on the front of every plate record
 * ever made, and no amount of filtering a noise tail will produce it.
 *
 * A cascade of first-order allpasses does the same thing to a signal. One
 * stage, y[n] = a·x[n] + x[n-1] - a·y[n-1], has a group delay of (1-a)/(1+a)
 * samples at DC and (1+a)/(1-a) at Nyquist - so at a = -0.6 the bottom is
 * held back four samples and the top a quarter of one, and N of them in
 * series multiply both. Measured, at 48 kHz: see PER_STAGE below.
 */
const DISPERSE_A = -0.6;

/**
 * How much further back one stage holds the bottom than the top, in samples.
 *
 * (1-a)/(1+a) - (1+a)/(1-a) at a = -0.6, which is 4 - 0.25. Measured on the
 * built chirp rather than trusted: at 48 kHz the full 24 ms is 307 stages,
 * and fed a single sample that cascade peaks at 3.94 ms in the high band and
 * 26.38 ms in the low - 22.44 ms apart, against the 23.98 the arithmetic asks
 * for. In the plate itself, which is a tail rather than one sample, the low
 * band's centre of energy goes from 10.6 ms behind the high band's at no
 * spread to 19.0 ms at full spread - the crossfade below gives a little of
 * that back, and the join itself measures 0.71 of the local noise either side
 * of it, which is to say there is no join.
 */
const PER_STAGE = (1 - DISPERSE_A) / (1 + DISPERSE_A) - (1 + DISPERSE_A) / (1 - DISPERSE_A);

/**
 * How long a gate takes to shut, in seconds.
 *
 * Fixed rather than a knob. What a gated reverb is recognised by is the cut,
 * not how the cut is shaped, and the RMX16 - which is the record every gated
 * snare is measured against - has a Decay control for the length and nothing
 * for the shape. Thirty milliseconds is slow enough not to click and fast
 * enough to be the effect.
 */
const GATE_CLOSE = 0.03;

/** The most dispersion the knob can ask for, in milliseconds. */
const MOST_SPREAD = 24;

/**
 * The cascade, over the onset, crossfaded back into the tail behind it.
 *
 * Over the onset and not the whole tail, and the reason is not that the two
 * are the same. Measured, they are not: a plate dispersed end to end reads up
 * to 1.07 dB away from this one in the low band, because the cascade holds
 * low-frequency energy back and over a decaying tail that moves the whole
 * decay curve. What it is, is that there is no "real" plate here being
 * approximated. Both are plates. This one costs 452 thousand multiplies and
 * the other costs 29 million for a two-second tail and four times that for an
 * eight-second one, which is most of a second of arithmetic under a knob
 * somebody is dragging.
 *
 * What the cascade is actually for is the onset. An allpass leaves a
 * magnitude spectrum exactly where it found it and moves only the phase, so
 * over stationary noise it produces noise with the same spectrum; the one
 * place it does something you can point at is where the signal is not
 * stationary, which is the few milliseconds where the tail starts from
 * nothing. That is where the whip is.
 *
 * The crossfade matters and was missing from the first version of this. Past
 * the window the raw tail resumes, and dispersed noise and raw noise are two
 * different realisations of the same statistics - so the join was a step from
 * one to the other. Equal power over the last fifth of the window.
 */
function disperse(out, from, until, stages) {
  const span = until - from;
  if (span <= 0 || stages <= 0) return;

  const raw = out.slice(from, until);
  const states = new Float64Array(stages * 2);

  for (let i = 0; i < span; i += 1) {
    let x = raw[i];
    for (let s = 0; s < stages; s += 1) {
      const last = s * 2;
      const y = DISPERSE_A * x + states[last] - DISPERSE_A * states[last + 1];
      states[last] = x;
      states[last + 1] = y;
      x = y;
    }
    out[from + i] = x;
  }

  const blend = Math.max(1, Math.round(span * 0.2));
  for (let i = 0; i < blend; i += 1) {
    const t = (i + 1) / (blend + 1);
    const back = Math.cos((t * Math.PI) / 2);
    const forth = Math.sin((t * Math.PI) / 2);
    const at = until - blend + i;
    out[at] = out[at] * back + raw[span - blend + i] * forth;
  }
}

/**
 * The send filters and the level, which every space finishes with.
 *
 * Not `finish`, which main.js already owns: the bundler flattens every module
 * into one scope and will not have two of a name. It caught this one within a
 * minute of the split.
 *
 * In the response rather than in the graph, so that the impulse is the whole
 * of the answer: what is drawn, what is convolved and what a guess is marked
 * against are then one array.
 *
 * Normalised to unit energy, which is what a convolution reverb does with the
 * responses it ships. Without it a long room is a loud room, and the A/B
 * becomes a level test again - the same false positive auto gain exists to
 * kill everywhere else in this app.
 */
function finishImpulse(channels, length, rate, { lowCut, highCut }) {
  for (const out of channels) {
    if (lowCut > 20) {
      const hp = setBiquad(makeBiquad(), 'highpass', lowCut, rate);
      for (let i = 0; i < length; i += 1) out[i] = runBiquad(hp, out[i]);
    }
    if (highCut < 20000) {
      const lp = setBiquad(makeBiquad(), 'lowpass', highCut, rate);
      for (let i = 0; i < length; i += 1) out[i] = runBiquad(lp, out[i]);
    }
  }

  let energy = 0;
  for (const out of channels) for (let i = 0; i < length; i += 1) energy += out[i] * out[i];
  const scale = energy > 0 ? 1 / Math.sqrt(energy) : 0;
  for (const out of channels) for (let i = 0; i < length; i += 1) out[i] *= scale;

  return { channels, rate, length, seconds: length / rate, preDelay: 0 };
}

/**
 * The three decay times, in seconds, as the knobs come to them.
 *
 * Capped at the longest tail the app has, which is not pedantry: the noise is
 * cached to a fixed length, so a low band asked to ring for sixteen seconds
 * did not fade out at all - it stopped dead at the end of the cache, 9.3
 * seconds in, inside a seventeen-second buffer whose last eight seconds were
 * silence being convolved. Decay 8 with a bass lift of two is reachable from
 * the knobs, so it had to be reachable from here.
 */
function decaySeconds({ decay, bass, damping }) {
  const held = (seconds) => Math.min(MOST_DECAY, Math.max(0.05, seconds));
  return {
    low: held(decay * bass),
    mid: held(decay),
    high: held(decay * damping),
  };
}

/**
 * The tail every space is made of: the cached noise, under three envelopes.
 *
 * Two channels, from two uncorrelated noises: a reverb in mono is a filter,
 * and what makes a space sound like a space is that the two ears are not
 * hearing the same thing.
 *
 * One decay time per band, because there is no such thing as one decay time
 * for a room with soft furnishings in it, and because that is how a decay
 * time is actually quoted. The knob names the mid band - which is the number
 * anybody means by "a one-point-eight second hall" - and the other two are
 * multiples of it. A hall rings longer in the bass than the mids, which this
 * could not do at all before: damping only ever shortened the top, so the
 * lows were pinned to the decay knob and every space was a room with its
 * treble turned down.
 *
 * `build` is how long the wash takes to arrive at full level. A room needs
 * one; a plate is handed zero, because being dense from the first sample is
 * most of what a plate is.
 *
 * `seconds` is handed in rather than worked out here, because not every space
 * decays: a gated burst holds at full level until it is cut, which is three
 * decay times of Infinity and an envelope that stays at one.
 */
function tail(channels, length, pre, rate, seconds, build) {
  const bands = noiseBands(rate);

  // The envelopes are exponential, so they are stepped rather than evaluated:
  // one multiply a sample instead of a call to pow. Over eight seconds that
  // is a million and a half of them, and it was most of the time it took to
  // build a hall.
  //
  // 10^(-3t/RT) is -60 dB at t = RT, which is what RT60 means.
  const steps = {
    low: 10 ** (-3 / seconds.low / rate),
    mid: 10 ** (-3 / seconds.mid / rate),
    high: 10 ** (-3 / seconds.high / rate),
  };
  const buildSamples = Math.max(1, build * rate);

  for (let c = 0; c < channels.length; c += 1) {
    const out = channels[c];
    const low = bands.low[c];
    const mid = bands.mid[c];
    const high = bands.high[c];
    const last = Math.min(length, pre + bands.length);

    let lowEnv = 1;
    let midEnv = 1;
    let highEnv = 1;

    for (let i = pre; i < last; i += 1) {
      const j = i - pre;
      const swell = build > 0 && j < buildSamples ? j / buildSamples : 1;
      out[i] = swell * (low[j] * lowEnv + mid[j] * midEnv + high[j] * highEnv);
      lowEnv *= steps.low;
      midEnv *= steps.mid;
      highEnv *= steps.high;
    }
  }

  // The rate the walls fall at. The mid band, because a reflection is a whole
  // copy of the sound rather than a part of its spectrum, and the mid band is
  // the one the decay knob names.
  return -3 / seconds.mid;
}

/** The energy in a set of channels, which is what `early` is a share of. */
function energyOf(channels, length) {
  return channels.reduce((sum, out) => {
    let band = 0;
    for (let i = 0; i < length; i += 1) band += out[i] * out[i];
    return sum + band;
  }, 0);
}

/**
 * The body every room-shaped space is built from: a wash, and walls in front
 * of it.
 *
 * Shared because a gated reverb is a room that is cut off and a reverse one
 * is a room played backwards. Neither is a different generator; they are this
 * one with something done to the envelope afterwards, which is also why both
 * are still a single impulse response and still marked the way everything
 * else here is.
 */
function roomBody(rate, settings, seconds, { tailFor }) {
  const { preDelay, size, early } = settings;

  const pre = Math.round((preDelay / 1000) * rate);
  const length = Math.max(rate * 0.05, Math.ceil(pre + rate * (tailFor * 1.08 + 0.02)));
  const channels = [new Float32Array(length), new Float32Array(length)];

  // How far apart the walls are, in time: the reflection off the far wall and
  // back is the whole of what tells you how big a place is.
  const across = (2 * size) / SPEED;

  // The diffuse tail arrives, it does not begin. In a real room the sound has
  // to bounce a few times before it is a wash, and until then what you hear
  // is the walls one at a time. Starting the tail at full level buried every
  // early reflection underneath it, which meant the size control changed the
  // numbers and nothing anybody could hear.
  //
  // How long that takes is `mixingTime`, which is a property of the room's
  // volume rather than of the distance across it. The cap is still the tail
  // itself: a burst that is over in a fifth of a second cannot spend half of
  // it arriving, whatever the walls are doing.
  const build = Math.max(0.004, Math.min(mixingTime(size), tailFor * 0.35));
  const fall = tail(channels, length, pre, rate, seconds, build);

  // The early reflections: the walls, one at a time, before the room turns to
  // a wash.
  //
  // Set by energy rather than by amplitude, and the difference is the whole
  // control. A reflection is one sample and the tail is a hundred thousand of
  // them, so a tap at the tail's own amplitude is a ten-thousandth of the
  // room and changes neither the sound nor any reading of it - the first
  // version of this had an early-late control that measured as nothing at
  // all. A real reflection towers over the diffuse tail, because it is a
  // whole copy of the sound arriving at once. So `early` is the share of the
  // room's energy that arrives as walls, and the taps are scaled to it.
  const tailEnergy = energyOf(channels, length);

  const walls = [];
  for (let c = 0; c < channels.length; c += 1) {
    TAPS.forEach((tap, k) => {
      // A little apart in the two ears, or the reflections arrive as one
      // click in the middle of your head.
      const skew = 1 + (c === 0 ? -1 : 1) * 0.06 * ((k % 3) - 1);
      const at = pre + Math.round(across * tap * skew * rate);
      if (at >= length) return;

      const level = (10 ** (fall * ((at - pre) / rate))) * (0.85 ** k);
      walls.push({ c, at, level: (k % 2 ? -1 : 1) * level });
    });
  }

  const wallEnergy = walls.reduce((sum, wall) => sum + wall.level * wall.level, 0);
  const share = Math.min(0.85, Math.max(0, early));
  if (wallEnergy > 0 && tailEnergy > 0 && share > 0) {
    const scale = Math.sqrt(((share / (1 - share)) * tailEnergy) / wallEnergy);
    for (const wall of walls) channels[wall.c][wall.at] += wall.level * scale;
  }

  return { channels, length, pre };
}

/**
 * A room: walls at a distance, then a wash that closes over them.
 */
function roomImpulse(rate, settings) {
  const longest = decaySeconds(settings);
  const tailFor = Math.max(longest.low, longest.mid, longest.high,
    (2 * settings.size) / SPEED * 1.6);
  const { channels, length, pre } = roomBody(rate, settings, longest, { tailFor });

  const out = finishImpulse(channels, length, rate, settings);
  out.preDelay = pre / rate;
  return out;
}

/**
 * A gated room: the same walls and the same wash, not decaying, then cut.
 *
 * Not a natural thing and not pretending to be. The AMS RMX16's NonLin2
 * programs hold a reverb pattern at level for a time the Decay control sets
 * and then drop it, and that is the sound on every big snare of the eighties.
 * So the three decay times are Infinity, the envelope stays at one, and the
 * decay knob says how long before the gate shuts rather than how long the
 * room rings. The band multiples are not on its deck, because nothing decays
 * for them to be multiples of.
 *
 * What it keeps is the walls. A gated reverb is a gated *room*, and the
 * reflections arriving one at a time under a burst that does not fade is most
 * of what gives it its size.
 */
function gatedImpulse(rate, settings) {
  const hold = Math.max(0.02, Math.min(MOST_DECAY, settings.decay));
  const held = { low: Infinity, mid: Infinity, high: Infinity };
  const { channels, length, pre } = roomBody(rate, settings, held,
    { tailFor: hold + GATE_CLOSE });

  const shuts = pre + Math.round(hold * rate);
  const closing = Math.round(GATE_CLOSE * rate);
  for (const out of channels) {
    for (let i = shuts; i < length; i += 1) {
      const gone = i - shuts;
      // A raised cosine rather than a straight line, because a gate that
      // shuts on a corner is a click at the corner.
      out[i] *= gone < closing ? 0.5 * (1 + Math.cos((Math.PI * gone) / closing)) : 0;
    }
  }

  const out = finishImpulse(channels, length, rate, settings);
  out.preDelay = pre / rate;
  return out;
}

/**
 * The room, backwards.
 *
 * Which is what a reverse reverb has always literally been - a tape turned
 * over - and is why this is the room's own generator rather than a rising
 * envelope on fresh noise. Everything the room does happens in reverse order:
 * the top end that died first is the last thing to arrive, the wash swells
 * out of nothing, and the reflections off the walls land as a rattle just
 * before the end.
 *
 * It also ends properly by accident. The room begins with its build-up, so
 * reversed it finishes with one - a few milliseconds of fade rather than the
 * hard cut that a rising envelope on its own would leave, and a hard cut is a
 * click.
 *
 * Only the part after the pre-delay is turned over. Reversing the whole
 * buffer would put the silence at the end, which is a reverb that answers
 * before it is asked.
 */
function reverseImpulse(rate, settings) {
  const longest = decaySeconds(settings);
  const tailFor = Math.max(longest.low, longest.mid, longest.high,
    (2 * settings.size) / SPEED * 1.6);
  const { channels, length, pre } = roomBody(rate, settings, longest, { tailFor });

  for (const out of channels) {
    for (let i = pre, j = length - 1; i < j; i += 1, j -= 1) {
      const held = out[i];
      out[i] = out[j];
      out[j] = held;
    }
  }

  const out = finishImpulse(channels, length, rate, settings);
  out.preDelay = pre / rate;
  return out;
}

/**
 * A plate: no walls, no distance, dense from the first sample, and dispersive.
 *
 * Three of the four things that separate it from a room are what it does not
 * have. There are no early reflections, because a sheet of steel has no far
 * wall to come back off. There is no build-up, because the wave crosses the
 * plate and comes back in a couple of milliseconds and is a wash immediately -
 * Dattorro's word for the class is "instantaneous high-density reflections
 * with smooth exponential decay". And there is no size in metres, because the
 * dimension that matters is how much the plate scatters rather than how far
 * away anything is.
 *
 * The fourth is the one it does have, and the only one that is new DSP: the
 * highs arrive before the lows. See `disperse`.
 */
function plateImpulse(rate, settings) {
  const { preDelay, spread } = settings;

  const pre = Math.round((preDelay / 1000) * rate);
  const longest = decaySeconds(settings);
  const tailFor = Math.max(longest.low, longest.mid, longest.high);
  const length = Math.max(rate * 0.05, Math.ceil(pre + rate * (tailFor * 1.08 + 0.02)));
  const channels = [new Float32Array(length), new Float32Array(length)];

  // Nothing for the wash to wait for.
  tail(channels, length, pre, rate, longest, 0);

  const stages = Math.round((Math.min(1, Math.max(0, spread)) * MOST_SPREAD / 1000) * rate / PER_STAGE);
  if (stages > 0) {
    // Far enough past the onset to hold the whole chirp - the bottom of it is
    // held back four samples a stage - and a fifth of that again for the
    // crossfade back into the tail to happen in.
    const until = Math.min(length, pre + Math.ceil(stages * 4 * 1.25) + 64);
    for (const out of channels) disperse(out, pre, until, stages);
  }

  const out = finishImpulse(channels, length, rate, settings);
  out.preDelay = pre / rate;
  return out;
}

/**
 * A spring, and why it is the only space here that is a loop rather than a
 * shaped noise.
 *
 * A reverb tank is a helical spring with a transducer at each end, and what
 * travels along it is a torsional wave - which is dispersive, hard. The top
 * of a transient reaches the far end while the bottom is still halfway, so
 * every single traverse arrives as a chirp sweeping downwards, and then it
 * reflects and does it again. What you hear is not a wash at all: it is a
 * train of chirps, which is the "boing", and the metallic ring on top of them
 * is the dispersion rippling across the band rather than sliding smoothly.
 *
 * None of that can be done by putting an envelope on noise, which is why the
 * other four spaces could share a generator and this one cannot.
 *
 * After Valimaki, Parker and Abel: a cascade of identical *stretched*
 * allpasses, H(z) = (a + z^-K)/(1 + a z^-K), inside a feedback loop. The
 * stretch is what makes it a spring rather than a plate. An ordinary
 * first-order allpass slides its group delay once from top to bottom; a
 * stretched one wraps that K times across the band, so the chirp ripples
 * instead of sweeping, and the ripple is the metal.
 *
 * It also sets the two round trips a spring has, which is the whole of the
 * sound. At a = -0.6 a stretched stage holds the bottom back 4K samples and
 * the top 0.25K, so with a plain 20 ms line the lows come round every 40 ms
 * and the highs every 21. Measured on the built response: the bounces land
 * 17.4 ms apart at a 16 ms line, and across the first 120 ms the low band's
 * energy sits 31 ms behind the high band's.
 *
 * The stretch is 20 and that is a measured trade rather than a number from
 * the paper. A chirp of a given length can be built from many weak stages or
 * few strong ones, and the cost is all in the stages - for a 20 ms chirp:
 *
 *     K x stages    low behind high    bounces      to build
 *      5 x 48          37.3 ms         17.4 ms       21 ms
 *     10 x 24          35.0 ms         17.4 ms        9 ms
 *     20 x 12          31.1 ms         17.4 ms        5 ms
 *     40 x  6          26.7 ms         17.5 ms        4 ms
 *     80 x  3          24.2 ms         17.7 ms        3 ms
 *
 * The bounce never moves, because the chirp length is what sets it. What a
 * coarser chain costs is a few milliseconds of the sweep. Twenty is where
 * that stops being a good trade: half the work of ten for four milliseconds.
 *
 * It is still the expensive one. Three springs in two channels is six passes
 * with the chain inside each of them, which comes to 29 ms a knob move
 * against 11 to 15 for the other four spaces. Worth knowing and not worth
 * fixing: it is twice the worst of the rest, not ten times it, and the
 * picture is built on the main thread for all five of them.
 */
const SPRING_STRETCH = 20;

/**
 * The springs in the tank, as ratios of the shortest.
 *
 * Real tanks have two or three of slightly different lengths, which is what
 * stops the bounces landing on top of each other and turning into a pitch.
 * Nothing harmonic: 1.00, 1.14 and 1.29 share no small ratio.
 */
const SPRING_RATIOS = [1, 1.14, 1.29];

/** How long the plain part of the loop is, at most and least tension, in ms. */
const SPRING_BOUNCE = [26, 7];

/** The longest a tank rings. Eight seconds is not a spring, it is a hall. */
const SPRING_LONGEST = 4;

/**
 * Where a tank stops having any bottom at all.
 *
 * A spring is thin and that is not a flaw to be corrected: there is no air in
 * it and no room, only a wire, and what makes a spring recognisable on a
 * guitar is as much what is missing underneath as the boing on top.
 */
const SPRING_FLOOR = 110;

/**
 * One spring: the chain and the line, round and round.
 *
 * Stable by construction - the cascade is allpass, so unity gain at every
 * frequency, the one-pole can only lose, and the feedback is under one.
 */
function springLoop(out, from, until, { stages, delay, feedback, damp }) {
  const K = SPRING_STRETCH;
  // The rings are stored by position and then by stage, which reads better
  // and is worth nothing at all. It looked like it should be worth a lot:
  // every sample touches one slot in each stage, and stage-major those slots
  // sit K doubles apart so the chain walks a fresh cache line for each one,
  // where position-major they are side by side. Measured at fourteen stages
  // over two seconds, twenty runs each: 8.63 ms stage-major against 8.50
  // position-major. The rings are two kilobytes and they were in L1 either
  // way. Recorded so nobody spends the afternoon on it twice.
  const xs = new Float64Array(K * stages);
  const ys = new Float64Array(K * stages);
  const line = new Float64Array(delay);
  let at = 0;
  let head = 0;
  let lost = 0;

  for (let i = from; i < until; i += 1) {
    let v = out[i] + feedback * line[head];

    const ring = at * stages;
    for (let s = 0; s < stages; s += 1) {
      const slot = ring + s;
      const y = DISPERSE_A * v + xs[slot] - DISPERSE_A * ys[slot];
      xs[slot] = v;
      ys[slot] = y;
      v = y;
    }
    at += 1;
    if (at === K) at = 0;

    // What the wire loses on the way round, which takes the top off first.
    lost += (v - lost) * damp;
    line[head] = lost;
    head += 1;
    if (head === delay) head = 0;

    out[i] = v;
  }
}

/**
 * Where a spring's decay is reckoned, in Hz.
 *
 * A choice, and not a detail. A stretched allpass does not delay the whole
 * band by one amount - at a = -0.6 and K = 20 it holds a frequency back
 * anywhere between 5 and 80 samples a stage depending where it falls in the
 * ripple - so there is no such thing as *the* round trip, and the loop's
 * one-pole takes a different amount out at every frequency on top of that.
 * Which means there is no such thing as *the* decay time either. That is
 * what dispersion is; it is not a flaw in the model.
 *
 * So the knob is a request and the reading on the face is the truth, and this
 * is the frequency that gets them closest. Swept, as the worst ratio between
 * the decay asked for and the mid band's measured RT60 over twenty-four
 * settings - every damping against every decay, and the ends of tension and
 * spread:
 *
 *      500 Hz   worst 1.75x    0.91 - 1.75
 *      700 Hz   worst 1.85x    0.54 - 1.39
 *      900 Hz   worst 2.45x    0.41 - 1.15
 *     1095 Hz   worst 2.77x    0.36 - 1.04   <- the mid band's own centre
 *     1800 Hz   worst 3.06x    0.33 - 0.98
 *
 * Five hundred is both the closest and the right kind of wrong: every ratio
 * is at or above one, so a spring asked for two seconds never rings for three
 * and a half. The centre of the band it is read in reads best on average and
 * overshoots worst, which on a knob is the trade nobody wants.
 */
const QUOTED_AT = 500;

/**
 * How long one stretched stage holds a frequency back, in samples.
 *
 * The group delay of (a + z^-K)/(1 + a z^-K), which is K(1-a^2) over
 * (1 + 2a cos Kw + a^2). It is the cos Kw that makes a spring a spring: K
 * times across the band the delay swings between its longest and its
 * shortest, and that ripple is the metal.
 */
function stageDelay(hz, rate) {
  const w = SPRING_STRETCH * ((2 * Math.PI * hz) / rate);
  const a = DISPERSE_A;
  return (SPRING_STRETCH * (1 - a * a)) / (1 + 2 * a * Math.cos(w) + a * a);
}

/**
 * The feedback a spring needs to ring for as long as the knob says.
 *
 * Not simply 10^(-3t/RT), which is what every other space here uses, because
 * the loop has a filter in it. The one-pole that takes the top off on each
 * pass takes some of the middle off too, so the loss per round trip is the
 * feedback and the filter together - and the knob was out by anywhere from
 * 1.41x to 3.85x depending on where the other three knobs were:
 *
 *     ratio asked / got     decay 0.5   1.2   1.8   3.0
 *       damping 0.20          3.33    3.33  3.53  3.85
 *       damping 0.55          1.96    1.90  2.00  2.13
 *       damping 1.00          1.75    1.60  1.54  1.54
 *
 * No constant fixes that. What does is dividing the filter back out: a
 * one-pole y += (x - y)a has magnitude a / |1 - (1-a)e^-jw|, so asking for
 * the feedback that lands the *pair* on 60 dB over the decay is a matter of
 * evaluating it at the frequency the decay is quoted at. The mid band is
 * 400 to 3000, so that is 1095 Hz, its geometric centre.
 *
 * Held under one, because a loop at unity gain is a space that never stops.
 */
function springFeedback(trip, rings, rate, damp) {
  const w = (2 * Math.PI * QUOTED_AT) / rate;
  const pole = 1 - damp;
  const loss = damp / Math.hypot(1 - pole * Math.cos(w), pole * Math.sin(w));
  const wanted = 10 ** ((-3 * trip) / (rings * rate));
  return Math.min(0.9995, wanted / Math.max(1e-6, loss));
}

function springImpulse(rate, settings) {
  const { preDelay, decay, tension, spread, damping } = settings;

  const pre = Math.round((preDelay / 1000) * rate);
  const rings = Math.min(SPRING_LONGEST, Math.max(0.05, decay));
  const length = Math.max(rate * 0.05, Math.ceil(pre + rate * (rings * 1.08 + 0.02)));
  const channels = [new Float32Array(length), new Float32Array(length)];

  // How far the chirp smears, which is the same knob the plate dispersion
  // sits on, and for the same reason - it is the same thing happening.
  const held = Math.min(1, Math.max(0, spread));
  const chirp = Math.round(((4 + held * 26) / 1000) * rate);
  const stages = Math.max(1, Math.round(chirp / (4 * SPRING_STRETCH)));

  const tight = Math.min(1, Math.max(0, tension));
  const bounce = SPRING_BOUNCE[0] + tight * (SPRING_BOUNCE[1] - SPRING_BOUNCE[0]);

  // A one-pole, so the coefficient is the knob: at 1 nothing is lost on the
  // way round and at 0.2 the loop is down 3 dB by about 1.5 kHz.
  const damp = Math.min(1, Math.max(0.2, damping));
  const voice = new Float64Array(length);

  for (let c = 0; c < channels.length; c += 1) {
    const out = channels[c];
    for (const ratio of SPRING_RATIOS) {
      // A hair apart in the two ears. A real tank is one mono box; two of
      // them an inch different is what a stereo send to one sounds like, and
      // identical in both ears is a sound inside your head.
      const skew = ratio * (1 + (c === 0 ? -0.018 : 0.018));
      const delay = Math.max(1, Math.round(((bounce * skew) / 1000) * rate));
      // One round trip at the frequency the decay is quoted at - not at DC,
      // which is a different trip entirely. See `springTrip`.
      const trip = delay + stages * stageDelay(QUOTED_AT, rate);

      voice.fill(0);
      voice[pre] = 1 / SPRING_RATIOS.length;
      springLoop(voice, pre, length, {
        stages,
        delay,
        feedback: springFeedback(trip, rings, rate, damp),
        damp,
      });
      for (let i = pre; i < length; i += 1) out[i] += voice[i];
    }

    // The tank's own bottom end, which it has never had.
    const floor = Array.from({ length: 2 },
      () => setBiquad(makeBiquad(), 'highpass', SPRING_FLOOR, rate));
    for (let i = 0; i < length; i += 1) {
      let v = out[i];
      for (const stage of floor) v = runBiquad(stage, v);
      out[i] = v;
    }
  }

  const out = finishImpulse(channels, length, rate, settings);
  out.preDelay = pre / rate;
  return out;
}

/**
 * The space, as samples.
 *
 * An unknown space is a room rather than a throw: the sketchpad keeps a
 * string here and a file written by a later version may name a space this
 * one does not have, and the right answer to that is a reverb rather than
 * silence.
 */
export function makeImpulse(rate, params = {}) {
  const settings = { ...VERB_DEFAULTS, ...params };
  return (BUILDERS[settings.space] ?? roomImpulse)(rate, settings);
}

const BUILDERS = {
  room: roomImpulse,
  plate: plateImpulse,
  gated: gatedImpulse,
  reverse: reverseImpulse,
  spring: springImpulse,
};

/** A room, built and read in the terms a guess is marked in. */
export function roomProfile(rate, settings, times = decayTimes()) {
  const impulse = makeImpulse(rate, settings);
  return decayProfile(wetDryImpulse(impulse, settings.mix ?? VERB_DEFAULTS.mix), rate, times);
}
