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
  rmsTime: 12,      // ms the mean square averages over; RMS mode only
  auto: false,      // a slow gain platform under the release
  range: 60,        // the most reduction it is allowed to do, in dB
  family: 'modern', // or 'opto', which has its own two controls and no knobs
  peakReduction: 0.5, // opto only: how hard the cell is driven
  optoMode: 'compress', // opto only: or 'limit'
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
  rmsTime: [0.5, 50],
  peakReduction: [0, 1],
  range: [0, 60],
};

/**
 * An optical compressor, as a photocell with a memory.
 *
 * A T4 is an electroluminescent panel shining at a cadmium sulphide
 * photoresistor. The panel lights in a millisecond or two; the cell's
 * resistance falls quickly and comes back in two stages, and how long the
 * second stage takes depends on how long and how brightly the cell has been
 * lit. UA's manual gives about 10 ms of attack and "dual stage: ~60 ms for
 * 50% release", and Mix explains the memory: "the duration of the second
 * stage of release - ruled by the cell's memory effect - depends on how long
 * light has been shining on the cell and at what brightness before it
 * ceased."
 *
 * So: a light that is fast on and fast off, an exposure that follows it over
 * seconds, and a conductance that chases the light quickly upward and lets go
 * at a rate the exposure sets.
 *
 * Measured, lighting the bare cell and letting go:
 *
 *     attack to 63%      11.6 ms        (hardware: about 10 ms)
 *     lit 50 ms          64 ms to half  (hardware: about 60 ms to 50%)
 *     lit 200 ms         67 ms
 *     lit 600 ms         88 ms
 *     lit 2 s            273 ms
 *     lit 6 s            982 ms
 *     lit 20 s           1881 ms
 *
 * The exposure is squared on the way in, and that is not a flourish: with it
 * linear, a fifty-millisecond burst already dragged the half-release out to
 * 116 ms, nearly double what the hardware does. A flash has to leave almost
 * no memory and only a passage has to leave one.
 *
 * Through the whole loop the memory is gentler, because the cell settles at a
 * partial brightness rather than full: 64 ms to half after a short burst,
 * rising to 74 after a second, 125 after three and 313 after ten. Five times
 * the tail for ten seconds of programme, which is the effect the hardware is
 * described by even if the published figures are for full recovery rather
 * than half.
 */
export const OPTO_CELL = {
  lightOn: 0.0015,   // the panel coming up
  lightOff: 0.004,   // and going out
  memory: 6,         // how long the cell remembers having been lit
  attack: 0.010,     // conductance rising
  fastTail: 0.0866,  // the first stage: 60 ms to half
  slowTail: 4,       // and the second, at full exposure
};

/**
 * How deep the cell can pull, in decibels, and how wide its knee is.
 *
 * The ceiling is the whole reason this loop is safe where a general feedback
 * topology is not. A feedback gain computer with a slope of R - 1 and a lag
 * winds up on transients: measured on one hit at ratio 8 with a 20 ms attack,
 * it reached 92.6 dB of reduction where the feed-forward path reached 16.5.
 * A photoresistor has a floor on its resistance, so an opto cannot do that -
 * it runs out instead. Measured here, the same single hit peaks at 15.1 dB in
 * compress and 20.4 in limit and comes back cleanly.
 *
 * 36 dB because it is the point where limit stops running out of cell inside
 * its own range. Measured as the local ratio climbing through the range at
 * three ceilings:
 *
 *     ceiling   compress                     limit
 *      24 dB    1.91 2.51 3.01 3.38 3.55     4.05 5.64 5.05 2.63 1.81
 *      30 dB    1.91 2.51 3.01 3.37 3.54     4.05 5.62 6.92 5.85 3.41
 *      36 dB    1.91 2.51 3.00 3.37 3.54     4.04 5.62 6.90 7.84 7.19
 *
 * Compress never reaches any of them - it is the same curve at all three -
 * and limit stops collapsing at 36.
 *
 * The knee is twelve decibels, which is very wide, and that is most of what
 * an opto is: there is no threshold on the front panel because there is no
 * corner to put one at.
 */
export const MOST_OPTO = 36;
export const OPTO_KNEE = 12;

/**
 * What the two positions of Compress/Limit are, as ratios.
 *
 * The ratio is not a control on an opto - it emerges - but it is still what
 * the gain computer is set to, because the feedback slope of R - 1 is how a
 * ratio gets into a loop at all. What comes out is softer than what goes in:
 * measured at peak reduction 0.5, the local ratio climbs 1.21, 1.91, 2.51,
 * 3.01, 3.38 and 3.55 to one across the range in compress - the "about 4:1,
 * soft knee, program dependent" the manual claims - and 4.04 up to 7.84 in
 * limit.
 */
export const OPTO_RATIOS = { compress: 4, limit: 20 };

/**
 * How much reduction this compressor is allowed to do at all.
 *
 * Every knob here says how hard to work on what is over the threshold, and
 * none of them says when to stop. A desk bus compressor has that control -
 * Cytomic's Glue calls it Range and gives it 0 to -82 dB - and it turns a
 * compressor into something that catches the loud parts and then gets out of
 * the way rather than riding everything.
 *
 * The range runs to 60 dB because that is past anything this compressor can
 * be asked for. Measured on a full-scale tone at the corners of its own knob
 * ranges, the deepest it reaches is 57.0 dB - the threshold on its -60 floor
 * at 20:1 - so at 60 the control is not in the signal path at all, and a test
 * holds that the top of the knob is the compressor that was there before this
 * existed.
 *
 *     threshold   ratio 4   ratio 8   ratio 20
 *       -10 dB        7.5       8.7        9.5
 *       -30 dB       22.5      26.2       28.5
 *       -60 dB       45.0      52.5       57.0
 *
 * It is on the modern family only. An opto already has a ceiling and it is
 * the cell's rather than a control: a photoresistor runs out at MOST_OPTO,
 * which is the whole reason that loop is safe, and a knob in front of it
 * would be two limits arguing.
 */

/**
 * The slow half of a program-dependent release, in seconds.
 *
 * A compressor with one release time treats a snare hit and a loud chorus the
 * same way, and no desk compressor does. The 2254 and the 33609 and the SSL
 * bus all have an auto mode, and the AMS Neve manual describes what it is:
 * "both the attack and recovery times are composite and self-adjusting... the
 * programme rides on a slowly moving gain platform". Isolated peaks come back
 * at the fast rate; a passage that stays loud builds something underneath
 * that comes back over seconds.
 *
 * So: a second release path that only charges while reduction is being held,
 * and drains slowly when it is not. The gain takes whichever of the two is
 * deeper, so the platform can only ever hold reduction on for longer - it
 * cannot deepen it.
 *
 * `CHARGE` is how long the platform takes to build and `PLATFORM` how long it
 * takes to drain. Measured against auto off, at a 120 ms release, as the time
 * to recover 63% and 90% of the reduction after a passage of a given length:
 *
 *     loud for     63% off / on        90% off / on
 *       30 ms      125 / 125 ms        282 / 282 ms
 *      200 ms      125 / 125           281 / 281
 *      500 ms      125 / 125           281 / 2307
 *     1200 ms      125 / 399           281 / 4306
 *     3000 ms      125 / 1735          281 / 5643
 *     6000 ms      125 / 2068          281 / 5976
 *
 * which is the behaviour as described: nothing at all on isolated hits - the
 * same number to the millisecond - and a tail that stretches by eight to
 * twenty-one times once a passage has stayed loud for half a second or more.
 * Half a second in, only the tail has moved; by a second the whole recovery
 * has. It stops getting slower around six seconds, where the platform is
 * fully charged.
 *
 * Fixed rather than derived from the release knob, because that is what the
 * desks do - the 33609's two auto modes are fixed pairs, 100 ms with 2 s and
 * 50 ms with 5 s - and because a slow platform that got slower as you slowed
 * the fast path would be two controls pretending to be one.
 *
 * Where this departs from the hardware: on a desk, Auto is a position on the
 * release control and replaces it. Here the release knob stays live as the
 * fast path and auto adds the platform under it. A knob that still shows a
 * number while doing nothing is the fault two commits back; and it makes the
 * two interact, which is worth hearing - auto over a fast release is a very
 * different thing from auto over a slow one.
 */
export const CHARGE = 1.5;
export const PLATFORM = 3;

/**
 * What an RMS window costs, and why it is a knob rather than a constant.
 *
 * It was twelve milliseconds, fixed and invisible, and that is not a bug in
 * the value - an averaging window is what RMS detection is - but it was the
 * one time constant on this compressor nobody could see or set. With the peak
 * path honest, it was also the only dishonest thing left: at ratio 4 a 0.1 ms
 * attack measured 2.46 ms and a 1 ms release measured 41, where the peak path
 * reads 0.17 and 6.1. The two detector modes answered the same knob
 * differently by up to thirty-five milliseconds and the face said nothing.
 *
 * Measured across the window, at ratio 4:
 *
 *     window    attack 0.1   attack 10   release 20   release 200   50 Hz ripple
 *      0.5 ms        0.29       10.23         26.8         206.1       1.32 dB
 *        1 ms        0.35       10.42         28.0         207.3       1.05
 *        2 ms        0.50       10.83         30.4         209.7       0.71
 *        5 ms        1.17       12.13         38.3         216.8       0.34
 *       12 ms        2.46       14.63         58.9         233.6       0.15
 *       20 ms        4.19       16.96         83.0         253.4       0.09
 *       50 ms       10.23       23.90        171.0         333.0       0.04
 *
 * which is a real trade and the reason it earns a control: short reads the
 * knobs truthfully and lets the waveform through, long rides over the
 * waveform and makes both knobs slower than they say. Neither end is wrong -
 * that is the whole of what choosing an averaging time is.
 *
 * It still rests at twelve. The fault was that the number could not be seen
 * or moved, not that it was the wrong number, so nothing anybody has saved
 * changes its sound.
 */

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
/**
 * One photocell, one sample at a time.
 *
 * Closes over nothing but its own state, because node.js stringifies it onto
 * the audio thread along with everything else in here.
 */
export function optoCell(rate) {
  const on = 1 - Math.exp(-1 / (OPTO_CELL.lightOn * rate));
  const off = 1 - Math.exp(-1 / (OPTO_CELL.lightOff * rate));
  const mem = 1 - Math.exp(-1 / (OPTO_CELL.memory * rate));
  const up = 1 - Math.exp(-1 / (OPTO_CELL.attack * rate));

  let light = 0;
  let expo = 0;
  let cond = 0;

  return {
    /** `drive` is how hard the panel is lit, 0 to 1. Returns conductance. */
    step(drive) {
      light += (drive > light ? on : off) * (drive - light);
      expo += mem * (light - expo);

      // Squared, so a flash leaves almost no memory and only a passage does.
      const soaked = Math.min(1, expo) * Math.min(1, expo);
      const tail = OPTO_CELL.fastTail + (OPTO_CELL.slowTail - OPTO_CELL.fastTail) * soaked;
      const down = 1 - Math.exp(-1 / (tail * rate));

      cond += (light > cond ? up : down) * (light - cond);
      return cond;
    },
  };
}

export function compressorCore(rate) {
  const state = {
    threshold: -18, ratio: 4, attack: 10, release: 120, knee: 6,
    makeup: 0, mix: 1, lookahead: 0,
    detector: 'peak', sidechain: false, scHigh: 20, scLow: 20000, listen: false,
    rmsTime: 12, auto: false, range: 60,
    family: 'modern', peakReduction: 0.5, optoMode: 'compress',
  };

  const hp = makeBiquad();
  const lp = makeBiquad();

  let attackCoef = 0;
  let releaseCoef = 0;
  let meanCoef = 0;
  let chargeCoef = 0;
  let platformCoef = 0;
  let held = 0;     // the reduction currently applied, in dB
  let mean = 0;     // running mean square, for the RMS detector
  let letGo = 0;    // the release stage, which is also what holds the peak
  let platform = 0; // the slow release underneath it, when auto is on
  const cell = optoCell(rate);
  let lastOut = 0;  // what the cell is looking at, one sample back

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
    meanCoef = Math.exp(-1 / Math.max(1, state.rmsTime * 0.001 * rate));
    chargeCoef = Math.exp(-1 / Math.max(1, CHARGE * rate));
    platformCoef = Math.exp(-1 / Math.max(1, PLATFORM * rate));
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

      // The optical path, which is a different instrument rather than a
      // different setting: no threshold, no ratio, no attack and no release,
      // because a T4 has none of those on its front panel. Peak Reduction
      // slides the onset and the cell does all the timing.
      //
      // It is a feedback design - the cell sits across the output, so the
      // light it sees is the light after the reduction - and the slope has to
      // be R - 1 rather than 1 - 1/R for the ratio to come out as R at all,
      // which is the same factor-of-R rule a general feedback topology needs.
      // What makes this one safe where that one is not is the ceiling: a
      // photoresistor runs out, so the loop cannot wind up.
      if (state.family === 'opto') {
        const ratio = OPTO_RATIOS[state.optoMode] ?? OPTO_RATIOS.compress;
        const onset = -4 - Math.min(1, Math.max(0, state.peakReduction)) * 40;
        const seen = state.sidechain ? side : lastOut;
        const heard = 20 * Math.log10(Math.abs(seen) + 1e-9);
        const want = Math.min(MOST_OPTO,
          -staticGain(heard, onset, ratio, OPTO_KNEE) * ratio);

        held = MOST_OPTO * cell.step(want / MOST_OPTO);
        this.reduction = -held;

        delay[writeAt] = signal;
        const read = (writeAt - delayed + delay.length) % delay.length;
        const was = delay[read];
        writeAt = (writeAt + 1) % delay.length;

        const squashed = was * (10 ** (-held / 20));
        lastOut = squashed;
        if (state.listen) return side;
        return (was * (1 - state.mix) + squashed * state.mix) * (10 ** (state.makeup / 20));
      }

      const db = 20 * Math.log10(level + 1e-9);
      // Positive decibels of reduction, which is the sign the ballistics want:
      // `max` has to mean "more reduction" for the release stage to hold a
      // peak rather than drop it.
      // Capped at the range, which is the only control here that says when to
      // stop rather than how hard to work. The target is clamped rather than
      // the gain, so the ballistics arrive at the limit at the attack's own
      // rate instead of hitting a wall.
      const wanted = Math.min(state.range,
        -staticGain(db, state.threshold, state.ratio, state.knee));

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

      // The gain platform: a second release that charges only while reduction
      // is being held and drains over seconds when it is not. It charges
      // toward whichever of the two is smaller, so a single peak - which the
      // fast path has already let go of - cannot build one.
      if (state.auto) {
        const toward = Math.min(wanted, letGo);
        platform = toward > platform
          ? chargeCoef * platform + (1 - chargeCoef) * toward
          : platformCoef * platform;
        if (platform > letGo) letGo = platform;
      } else {
        platform = 0;
      }

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
