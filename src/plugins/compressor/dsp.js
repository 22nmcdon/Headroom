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
 * How long the release stage holds a peak before it starts letting go.
 *
 * This used to be PEAK_DECAY, a fixed ten milliseconds on a separate peak
 * detector sitting in front of the gain computer, and it was quietly setting
 * the floor under the release knob. Measured, 63% recovery after a tone
 * stops, at ratio 4:
 *
 *     knob      was      is
 *      5 ms   21.6    10.7 ms
 *     10 ms   25.9    15.8
 *     20 ms   34.7    25.6
 *     50 ms   63.8    55.3
 *    200 ms  213.3   205.0
 *    500 ms  513.2   505.0
 *
 * Thirteen to seventeen milliseconds added to everything, which at the bottom
 * of the knob is four times the number written on it. The arithmetic was
 * plain once looked for: a ten-millisecond decay falls at 8.69 dB per ten
 * milliseconds, and at ratio 4 the level has to fall 14.5 dB for the
 * reduction to come back 63%, which takes 16.7 ms whatever the release knob
 * says.
 *
 * It is zero now - there is no separate detector. The release stage of the
 * ballistics below holds the peak itself, which is the whole reason that form
 * is the one Giannoulis, Massberg and Reiss recommend: `max` catches the peak
 * on the sample it arrives and the smoothing beside it is the user's own
 * release. One stage, two knobs, no third number.
 *
 * Kept as a name rather than deleted because the audio thread is built by
 * stringifying this file and a test holds the two against each other.
 */
export const PEAK_HOLD = 0;

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
  let held = 0;   // the reduction currently applied, in dB
  let mean = 0;   // running mean square, for the RMS detector
  let letGo = 0;  // the release stage, which is also what holds the peak

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

      // Peak is the sample itself. There is no envelope in front of the gain
      // computer any more: handing it raw |x| used to corrupt the attack,
      // because |x| falls to zero twice a cycle and a smoother that branches
      // on direction spent half its time in release - an attack knob set to
      // 20 ms measured 32. The ballistics below hold the peak instead, which
      // costs nothing and takes the floor out from under the release knob.
      let level;
      if (state.detector === 'rms') {
        mean = meanCoef * mean + (1 - meanCoef) * side * side;
        level = Math.sqrt(mean);
      } else {
        level = side < 0 ? -side : side;
      }

      const db = 20 * Math.log10(level + 1e-9);
      // Positive decibels of reduction, which is the sign the ballistics want:
      // `max` has to mean "more reduction" for the release stage to hold a
      // peak rather than drop it.
      const wanted = -staticGain(db, state.threshold, state.ratio, state.knee);

      // Smooth decoupled, after Giannoulis, Massberg and Reiss. The release
      // stage catches the peak on the sample it arrives - that is what the
      // `max` is for - and lets go at the release knob's rate. The attack
      // stage is the only thing between that and the gain.
      //
      // Both knobs read true on their own: measured, 0.1 ms of attack lands
      // at 0.17 and 50 ms at 50.06, and release at 200 ms lands at 205. The
      // leftover five is the attack, exactly - a release measures its own
      // time plus the attack's, because the attack stage is still running on
      // the way back up. That is the known cost of this form and it is a
      // better one than a hidden sixteen milliseconds.
      letGo = Math.max(wanted, releaseCoef * letGo + (1 - releaseCoef) * wanted);
      held = attackCoef * held + (1 - attackCoef) * letGo;
      this.reduction = -held;

      delay[writeAt] = signal;
      const readAt = (writeAt - delayed + delay.length) % delay.length;
      const dry = delay[readAt];
      writeAt = (writeAt + 1) % delay.length;

      // Key listen: what the detector hears, so you can aim the sidechain
      // filters at the thing that is actually triggering it.
      if (state.listen) return side;

      const wet = dry * (10 ** (-held / 20));
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
