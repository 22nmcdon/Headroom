import { makeBiquad, setBiquad, runBiquad } from '../comp/dsp.js';
import { mulberry32 } from '../random.js';
import {
  RESPONSE_BANDS, LONGEST_TAIL, decayProfile, decayTimes, monoOf, wetDryImpulse,
} from '../fx/response.js';

// A room, as an impulse response.
//
// What a reverb is, for somebody using one, is in src/notes/verb.js.
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
  preDelay: 20,      // ms of silence before the room answers
  decay: 1.8,        // RT60, in seconds
  size: 18,          // metres - how far away the first walls are
  damping: 0.55,     // how much shorter the highs decay: 1 is not at all
  early: 0.35,       // the level of the early reflections against the tail
  lowCut: 20,        // Hz, on the way in
  highCut: 20000,    // Hz, on the way in
  mix: 0.3,          // 0 is dry, 1 is nothing but room
};

/**
 * Where the tail is split into something that damps and something that does
 * not, and how sharply.
 *
 * Sharply matters. A first-order split left a fifth of the slow band's energy
 * sitting up at 4 kHz, so once the fast part had died the slow part's leakage
 * took over and a room set to decay five times faster up top measured only
 * one and a half times faster. Two cascaded Butterworths - a Linkwitz-Riley
 * crossover, which is what a speaker uses and sums flat - put the bands
 * thirty decibels apart where the reading is taken.
 */
const DAMP_CROSSOVER = 1200;
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
  damping: [0.2, 1],
  early: [0, 0.8],
  lowCut: [20, 800],
  highCut: [1500, 20000],
  mix: [0, 1],
};
const CACHE_SECONDS = MOST_DECAY * 1.1 + 0.5;

/**
 * The noise the rooms are all made from, split once and kept.
 *
 * Every room is the same noise under a different envelope - the filtering
 * that splits it into something that damps and something that does not
 * depends on neither the decay nor the damping, only on the crossover. Doing
 * it per room meant four biquads a sample a channel, which came to a sixth of
 * a second to build an eight second hall: a knob you could turn and then wait
 * for. Split once, building a room is a multiply and an add.
 *
 * It also means a room is the same room every time it is asked for, on every
 * machine, which is what a shared daily needs.
 */
const splits = new Map();

function noiseBands(rate) {
  const held = splits.get(rate);
  if (held) return held;

  const length = Math.ceil(rate * CACHE_SECONDS);
  const noise = mulberry32(0x5eed1e);
  const bands = { low: [], high: [], length };

  for (let c = 0; c < 2; c += 1) {
    const low = new Float32Array(length);
    const high = new Float32Array(length);

    const lows = Array.from({ length: CROSSOVER_POLES },
      () => setBiquad(makeBiquad(), 'lowpass', DAMP_CROSSOVER, rate));
    const highs = Array.from({ length: CROSSOVER_POLES },
      () => setBiquad(makeBiquad(), 'highpass', DAMP_CROSSOVER, rate));

    for (let i = 0; i < length; i += 1) {
      const white = noise() * 2 - 1;
      let l = white;
      let h = white;
      for (const stage of lows) l = runBiquad(stage, l);
      for (const stage of highs) h = runBiquad(stage, h);
      low[i] = l;
      high[i] = h;
    }

    bands.low.push(low);
    bands.high.push(high);
  }

  splits.set(rate, bands);
  return bands;
}

/**
 * The room, as samples.
 *
 * Two channels, from two uncorrelated noises: a reverb in mono is a filter,
 * and what makes a room sound like a room is that the two ears are not
 * hearing the same thing.
 *
 * The tail is built in two bands. The low one decays over the time on the
 * knob, the high one over a fraction of it, and that fraction is the damping
 * control - which is how a real room behaves and, more to the point, how a
 * decay time is actually quoted: per band, because there is no such thing as
 * one decay time for a room with soft furnishings in it.
 */
export function makeImpulse(rate, params = {}) {
  const { preDelay, decay, size, damping, early, lowCut, highCut } = { ...VERB_DEFAULTS, ...params };

  const pre = Math.round((preDelay / 1000) * rate);
  const tailFor = Math.max(decay, decay * damping, (2 * size) / SPEED * 1.6);
  const length = Math.max(rate * 0.05, Math.ceil(pre + rate * (tailFor * 1.08 + 0.02)));
  const channels = [new Float32Array(length), new Float32Array(length)];

  const bands = noiseBands(rate);
  const lowRate = -3 / Math.max(0.05, decay);
  const highRate = -3 / Math.max(0.05, decay * damping);

  // How far apart the walls are, in time: the reflection off the far wall and
  // back is the whole of what tells you how big a place is.
  const across = (2 * size) / SPEED;

  // The diffuse tail arrives, it does not begin. In a real room the sound has
  // to bounce a few times before it is a wash, and until then what you hear
  // is the walls one at a time. Starting the tail at full level buried every
  // early reflection underneath it, which meant the size control changed the
  // numbers and nothing anybody could hear.
  const build = Math.max(0.004, Math.min(across * 1.4, decay * 0.35));

  // The envelopes are exponential, so they are stepped rather than evaluated:
  // one multiply a sample instead of a call to pow. Over eight seconds that
  // is a million and a half of them, and it was most of the time it took to
  // build a hall.
  const lowStep = 10 ** (lowRate / rate);
  const highStep = 10 ** (highRate / rate);
  const buildSamples = Math.max(1, build * rate);

  for (let c = 0; c < channels.length; c += 1) {
    const out = channels[c];
    const low = bands.low[c];
    const high = bands.high[c];
    const last = Math.min(length, pre + bands.length);

    // 10^(-3t/RT) is -60 dB at t = RT, which is what RT60 means.
    let lowEnv = 1;
    let highEnv = 1;

    for (let i = pre; i < last; i += 1) {
      const j = i - pre;
      const swell = j < buildSamples ? j / buildSamples : 1;
      out[i] = swell * (low[j] * lowEnv + high[j] * highEnv);
      lowEnv *= lowStep;
      highEnv *= highStep;
    }
  }

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
  const tailEnergy = channels.reduce((sum, out) => {
    let band = 0;
    for (let i = 0; i < length; i += 1) band += out[i] * out[i];
    return sum + band;
  }, 0);

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

  // The send filters. In the response rather than in the graph, so that the
  // impulse is the whole of the answer: what is drawn, what is convolved and
  // what a guess is marked against are then one array.
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

  // Normalised to unit energy, which is what a convolution reverb does with
  // the responses it ships. Without it a long room is a loud room, and the
  // A/B becomes a level test again - the same false positive auto gain exists
  // to kill everywhere else in this app.
  let energy = 0;
  for (const out of channels) for (let i = 0; i < length; i += 1) energy += out[i] * out[i];
  const scale = energy > 0 ? 1 / Math.sqrt(energy) : 0;
  for (const out of channels) for (let i = 0; i < length; i += 1) out[i] *= scale;

  return { channels, rate, length, seconds: length / rate, preDelay: pre / rate };
}

/** A room, built and read in the terms a guess is marked in. */
export function roomProfile(rate, settings, times = decayTimes()) {
  const impulse = makeImpulse(rate, settings);
  return decayProfile(wetDryImpulse(impulse, settings.mix ?? VERB_DEFAULTS.mix), rate, times);
}
