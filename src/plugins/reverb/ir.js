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
  spread: 0.5,       // a plate's dispersion: how far ahead the highs arrive
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
 * So each space says what it is made of and what it answers to, the way the
 * saturator's curve families do, and the deck is rebuilt when it changes.
 * What the two share - pre-delay, decay, damping, the send filters, the mix -
 * keeps its setting across the change: what you had the decay at is still
 * what you want the decay at.
 */
export const SPACES = {
  room: {
    label: 'Room',
    knobs: ['preDelay', 'decay', 'bass', 'damping', 'size', 'early', 'lowCut', 'highCut', 'mix'],
  },
  plate: {
    label: 'Plate',
    knobs: ['preDelay', 'decay', 'bass', 'damping', 'spread', 'lowCut', 'highCut', 'mix'],
  },
};

export const SPACE_ORDER = ['room', 'plate'];

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
 */
function tail(channels, length, pre, rate, settings, build) {
  const bands = noiseBands(rate);
  const seconds = decaySeconds(settings);

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
 * A room: walls at a distance, then a wash that closes over them.
 */
function roomImpulse(rate, settings) {
  const { preDelay, size, early } = settings;

  const pre = Math.round((preDelay / 1000) * rate);
  const longest = decaySeconds(settings);
  const tailFor = Math.max(longest.low, longest.mid, longest.high, (2 * size) / SPEED * 1.6);
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
  const build = Math.max(0.004, Math.min(across * 1.4, longest.mid * 0.35));
  const lowRate = tail(channels, length, pre, rate, settings, build);

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

      const level = (10 ** (lowRate * ((at - pre) / rate))) * (0.85 ** k);
      walls.push({ c, at, level: (k % 2 ? -1 : 1) * level });
    });
  }

  const wallEnergy = walls.reduce((sum, wall) => sum + wall.level * wall.level, 0);
  const share = Math.min(0.85, Math.max(0, early));
  if (wallEnergy > 0 && tailEnergy > 0 && share > 0) {
    const scale = Math.sqrt(((share / (1 - share)) * tailEnergy) / wallEnergy);
    for (const wall of walls) channels[wall.c][wall.at] += wall.level * scale;
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
  tail(channels, length, pre, rate, settings, 0);

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
 * The space, as samples.
 *
 * An unknown space is a room rather than a throw: the sketchpad keeps a
 * string here and a file written by a later version may name a space this
 * one does not have, and the right answer to that is a reverb rather than
 * silence.
 */
export function makeImpulse(rate, params = {}) {
  const settings = { ...VERB_DEFAULTS, ...params };
  return settings.space === 'plate'
    ? plateImpulse(rate, settings)
    : roomImpulse(rate, settings);
}

/** A room, built and read in the terms a guess is marked in. */
export function roomProfile(rate, settings, times = decayTimes()) {
  const impulse = makeImpulse(rate, settings);
  return decayProfile(wetDryImpulse(impulse, settings.mix ?? VERB_DEFAULTS.mix), rate, times);
}
