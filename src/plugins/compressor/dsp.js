// The compressor itself, as arithmetic.
//
// What a compressor is doing, for somebody using one, is in
// src/learn/notes/comp.js.
//
// Web Audio has a compressor node and this does not use it. That node cannot
// be fed a sidechain, has no RMS detector and no lookahead, its release curve
// is not the one written on it, and it applies a makeup gain of its own that
// lives in the implementation rather than in the arithmetic - which the old
// version of this mode had to measure on a grid and cancel by hand. A mode
// whose subject is compression cannot be built on a box whose behaviour has to
// be reverse-engineered.
//
// So: one detector, one static curve, one smoother, written out. The same
// code runs in three places - the worklet that makes the sound, the scoring
// that reads a guess, and the tests - which is the only way the three can be
// held to agree.
//
// Everything here is self-contained on purpose. `src/plugins/compressor/node.js` builds the
// worklet by stringifying these functions, so none of them may close over
// anything outside its own body.

import { makeBiquad, setBiquad, runBiquad, signalRms } from '../../lib/dsp.js';
/**
 * How many decibels of gain to apply to a signal sitting at @p inputDb -
 * the compressor with the time taken out of it, which is the curve drawn on
 * every plugin's display.
 *
 * Returns 0 or less, always: this is the reduction, not the output level.
 */
export function staticGain(inputDb, threshold, ratio, knee) {
  const over = inputDb - threshold;

  // The knee is a parabola through the corner: it leaves the 1:1 line at
  // threshold - knee/2 with slope 1, and arrives on the ratio line at
  // threshold + knee/2 with slope 1/ratio. Anything less than that is a
  // corner you can hear working.
  if (knee > 0 && 2 * Math.abs(over) <= knee) {
    return ((1 / ratio) - 1) * ((over + knee / 2) ** 2) / (2 * knee);
  }

  if (over <= 0) return 0;
  return over * ((1 / ratio) - 1);
}

/** Where every knob starts, and the whole of what a setting is. */
export const COMP_DEFAULTS = {
  threshold: -18,
  ratio: 4,
  attack: 10,       // ms
  release: 120,     // ms
  knee: 6,          // dB, total width
  makeup: 0,        // dB
  mix: 1,           // 1 is all compressor, 0 is none - parallel lives between
  lookahead: 0,     // ms
  detector: 'peak', // or 'rms'
  sidechain: false, // listen to the key input instead of the signal
  scHigh: 20,       // detector high-pass corner
  scLow: 20000,     // detector low-pass corner
  listen: false,    // monitor the detector's own signal
};

/** The longest lookahead any of this offers, in seconds. */
export const MOST_LOOKAHEAD = 0.02;

/**
 * How far each of those may be moved, which is where a plugin's knob ends.
 *
 * Here rather than in the plugin because two things now need it: the plugin,
 * to lay out a slider, and the sketchpad, which stores an insert's settings
 * and has to put a loaded file's numbers back inside the range the processor
 * expects. Two tables would be two tables to keep in step, and the day they
 * drift is the day a saved sketch loads as a different sound.
 */
export const COMP_LIMITS = {
  threshold: [-60, 0],
  ratio: [1, 20],
  attack: [0.1, 200],
  release: [5, 2000],
  knee: [0, 24],
  makeup: [-12, 24],
  mix: [0, 1],
  lookahead: [0, MOST_LOOKAHEAD * 1000],
  scHigh: [20, 1000],
  scLow: [200, 20000],
};

/**
 * How fast the peak detector's envelope falls away, in seconds.
 *
 * Short enough to follow a drum hit, long enough to ride over the individual
 * cycles of anything above a couple of hundred hertz. Below that it does
 * ripple - a peak detector on a bass note is tracking the note's own
 * waveform - which is not a fault to be hidden but the exact reason the
 * sidechain high-pass on this plugin exists.
 */
export const PEAK_DECAY = 0.01;

/**
 * A compressor, one sample at a time.
 *
 * `step(signal, key)` returns the processed sample and leaves the gain
 * reduction it just applied on `reduction`, in decibels, at or below zero.
 */
export function compressorCore(rate) {
  const state = {
    threshold: -18, ratio: 4, attack: 10, release: 120, knee: 6,
    makeup: 0, mix: 1, lookahead: 0,
    detector: 'peak', sidechain: false, scHigh: 20, scLow: 20000, listen: false,
  };

  const hp = makeBiquad();
  const lp = makeBiquad();

  let attackCoef = 0;
  let releaseCoef = 0;
  let meanCoef = 0;
  let envCoef = 0;
  let held = 0;   // the reduction currently applied, in dB
  let mean = 0;   // running mean square, for the RMS detector
  let env = 0;    // the peak detector's own envelope

  // The audio is delayed against the detector, so that a compressor with
  // lookahead is already pulling down by the time the transient arrives.
  const delay = new Float32Array(Math.ceil(rate * MOST_LOOKAHEAD) + 2);
  let writeAt = 0;
  let delayed = 0;

  function retime() {
    // A time constant, not a 10-to-90 time: the reduction covers 63% of the
    // distance in the attack written on the knob. Stated because the two
    // conventions differ by a factor of about two and a compressor mode that
    // was vague about which it meant would be teaching a number, not an ear.
    attackCoef = Math.exp(-1 / Math.max(1, state.attack * 0.001 * rate));
    releaseCoef = Math.exp(-1 / Math.max(1, state.release * 0.001 * rate));
    meanCoef = Math.exp(-1 / (0.012 * rate));
    envCoef = Math.exp(-1 / (PEAK_DECAY * rate));
    delayed = Math.min(delay.length - 1, Math.round(state.lookahead * 0.001 * rate));
    setBiquad(hp, 'highpass', state.scHigh, rate);
    setBiquad(lp, 'lowpass', state.scLow, rate);
  }

  retime();

  return {
    settings: state,
    reduction: 0,

    set(next) {
      for (const key in next) if (key in state) state[key] = next[key];
      retime();
    },

    step(signal, key) {
      // What the detector is looking at, which is not necessarily what comes
      // out: a sidechained compressor is listening to something else entirely.
      let side = state.sidechain ? key : signal;
      if (state.scHigh > 20) side = runBiquad(hp, side);
      if (state.scLow < 20000) side = runBiquad(lp, side);

      let level;
      if (state.detector === 'rms') {
        mean = meanCoef * mean + (1 - meanCoef) * side * side;
        level = Math.sqrt(mean);
      } else {
        // A peak detector, not a bare rectifier. Handing the gain computer
        // the raw |x| looks like the same thing and is not: it falls to zero
        // twice a cycle, so the smoother below spends half its time in
        // release, and an attack knob set to 20 ms measured 32. Catching the
        // peak instantly and letting it fall away over PEAK_DECAY gives the
        // gain computer a level to work on, and the knobs their meaning back.
        const rect = side < 0 ? -side : side;
        env = rect > env ? rect : envCoef * env;
        level = env;
      }

      const db = 20 * Math.log10(level + 1e-9);
      const wanted = staticGain(db, state.threshold, state.ratio, state.knee);

      // Attack is the way down and release is the way back: the smoother
      // branches on which way the gain is about to move, which is what makes
      // the two knobs mean what they say.
      const coef = wanted < held ? attackCoef : releaseCoef;
      held = coef * held + (1 - coef) * wanted;
      this.reduction = held;

      delay[writeAt] = signal;
      const readAt = (writeAt - delayed + delay.length) % delay.length;
      const dry = delay[readAt];
      writeAt = (writeAt + 1) % delay.length;

      // Key listen: what the detector hears, so you can aim the sidechain
      // filters at the thing that is actually triggering it.
      if (state.listen) return side;

      const wet = dry * (10 ** (held / 20));
      // Dry is the delayed signal rather than the live one, so the parallel
      // path stays in step with the compressed one instead of phasing it.
      return (dry * (1 - state.mix) + wet * state.mix) * (10 ** (state.makeup / 20));
    },
  };
}

/* ---------- the same thing over a whole buffer ---------- */

/** A buffer through a compressor: what came out, and what it did to get there. */
export function runCompressor(input, rate, params, key = null) {
  const core = compressorCore(rate);
  core.set(params);

  const out = new Float32Array(input.length);
  const gr = new Float32Array(input.length);

  for (let i = 0; i < input.length; i += 1) {
    out[i] = core.step(input[i], key ? key[i] : 0);
    gr[i] = core.reduction;
  }

  return { out, gr };
}

/**
 * One pass over a loop, for everything that wants to know what the compressor
 * is doing to it: the reduction moment by moment, how deep it goes, and the
 * makeup gain that puts the loudness back.
 *
 * That last one matters more here than anywhere else in this app. A
 * compressor's whole job is to change level, so an A/B between two settings is
 * a loudness test unless something takes the loudness back out - and louder
 * wins every time, without anybody hearing a thing about the compression.
 *
 * `into` is a buffer to write the reduction into. A knob being dragged asks
 * for this several times a second, and handing back the same array each time
 * keeps a megabyte of garbage per second out of it.
 */
export function analyse(input, rate, params, key = null, into = null) {
  const core = compressorCore(rate);
  core.set({ ...params, makeup: 0, listen: false });

  const gr = into && into.length === input.length ? into : new Float32Array(input.length);
  let sumIn = 0;
  let sumOut = 0;
  let sumGr = 0;
  let deepest = 0;

  for (let i = 0; i < input.length; i += 1) {
    const out = core.step(input[i], key ? key[i] : 0);
    gr[i] = core.reduction;
    if (core.reduction < deepest) deepest = core.reduction;
    sumGr += core.reduction;
    sumIn += input[i] * input[i];
    sumOut += out * out;
  }

  const before = Math.sqrt(sumIn / Math.max(1, input.length));
  const after = Math.sqrt(sumOut / Math.max(1, input.length));

  return {
    gr,
    deepest,
    average: sumGr / Math.max(1, input.length),
    makeup: before < 1e-9 || after < 1e-9 ? 0 : 20 * Math.log10(before / after),
  };
}

/** Just the makeup gain, for when that is all anybody wanted. */
export function autoGain(input, rate, params, key = null) {
  return analyse(input, rate, params, key).makeup;
}

/** The loudest sample in each short frame, in dB - how a meter reads. */
export function peakEnvelope(samples, rate, frameMs = 5) {
  const span = Math.max(1, Math.round((frameMs / 1000) * rate));
  const out = new Float32Array(Math.ceil(samples.length / span));

  for (let f = 0; f < out.length; f += 1) {
    let peak = 0;
    const end = Math.min(samples.length, (f + 1) * span);
    for (let i = f * span; i < end; i += 1) {
      const level = samples[i] < 0 ? -samples[i] : samples[i];
      if (level > peak) peak = level;
    }
    out[f] = 20 * Math.log10(peak + 1e-9);
  }

  return out;
}

/** A signal averaged into frames - for reading a gain-reduction trace. */
export function meanFrames(samples, rate, frameMs = 5) {
  const span = Math.max(1, Math.round((frameMs / 1000) * rate));
  const out = new Float32Array(Math.ceil(samples.length / span));

  for (let f = 0; f < out.length; f += 1) {
    const end = Math.min(samples.length, (f + 1) * span);
    let sum = 0;
    for (let i = f * span; i < end; i += 1) sum += samples[i];
    out[f] = sum / Math.max(1, end - f * span);
  }

  return out;
}
