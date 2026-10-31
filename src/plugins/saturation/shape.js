import { makeBiquad, setBiquad, runBiquad } from '../../lib/dsp.js';
import { readingOf, stampOf } from '../../lib/read.js';
import {
  PROBE_BIN, HARMONIC_AXIS, spectrumThrough, seriesOf, foldbackIn,
} from '../../lib/harmonics.js';

// Saturation: what a signal comes out as when the thing it went through was
// not quite a straight line.
//
// The version of this addressed to somebody using a saturator rather than
// changing one is in src/learn/notes/heat.js.
//
// Every other tool in this app moves energy that was already there. An EQ
// turns a band up, a compressor turns a moment down, a reverb and a delay put
// copies of it somewhere else, an imager moves it across the room. A
// nonlinearity is the only one that makes energy at frequencies that were
// never in the input - and that is the entire subject. Feed it 220 Hz and out
// come 440, 660, 880 and so on, and the recipe of that series is what people
// are hearing when they say warm, or edgy, or crunchy, or broken.
//
// The two things that decide the recipe:
//
//   Bias - whether the curve treats up and down the same. A symmetric curve
//   can only make odd harmonics: the third, the fifth, the seventh. Tilt it
//   so one half squashes before the other and the even harmonics appear -
//   the second, the fourth - and those are the ones that sound like an
//   octave rather than like distortion. Even is warm; odd is dirty. That
//   single fact is most of what an ear needs here.
//
//   Hardness - how abruptly the curve gives up, which decides when the
//   colour arrives rather than how much of it there is. Measured: at a
//   moderate drive a soft curve is already making a third harmonic while a
//   hard one is still doing nothing at all, and at a high drive it is the
//   other way round - the hard curve is a square wave, with a series running
//   all the way up, and the soft one is still mostly a third and a fifth. A
//   soft curve is always a little coloured; a hard one is clean until it
//   isn't, and then it is everything at once.

/** How far the drive goes. */
export const MOST_DRIVE = 30;

/** And how sharp the corner gets. */
export const MOST_HARDNESS = 5;

/** How lopsided the curve can be made. */
export const MOST_BIAS = 0.7;

/**
 * Where the output is uncoupled, in hertz.
 *
 * Subtracting `shape(bias)` takes away what the curve does to silence. It
 * does not take away what the curve does to a signal: the average of a bent
 * curve over a cycle is not the curve of the average, so an offset is left
 * behind, and because the bend deepens with the drive the offset grows with
 * it. Measured on a sine before this went in - at bias 1 and 30 dB of drive
 * the output rode an offset 9.6 dB under its own peak, which is a third of
 * the size of the waveform. Nothing to hear on its own, and underneath
 * everything downstream eating the headroom this app is named after.
 *
 * It leaned on the auto gain too, which is an RMS and cannot tell an offset
 * from signal: at that corner the trim came back 1.16 dB light, wider than
 * the tightest window anything here is marked to.
 *
 * Five hertz. The probe tone is 440 and the lowest harmonic read is 880, so
 * there is nothing down there to protect, and the only thing a lower corner
 * would buy is less phase against the dry path in a parallel mix - which is
 * already under six degrees by 50 Hz.
 */
export const DC_CORNER = 5;

/** The range of the tone control. At the top of it there is no filter at all. */
export const LEAST_TONE = 800;
export const MOST_TONE = 9000;

/** Every control, and where it starts. */
/**
 * The families of curve, and what each one is for.
 *
 * `shape()` above is one family - a soft clipper with a knee you can set -
 * and for a long time it was the only one, which made this a saturator with
 * one sound and a lot of knobs. These are the others, chosen because each
 * teaches something the rest cannot:
 *
 *   soft     the bend. Parity and knee, which is most of analogue distortion.
 *   rectify  the octave. Full-wave rectification removes the fundamental
 *            outright and leaves evens, which is the most unmistakable
 *            demonstration of what an even harmonic is that exists.
 *   fold     the wall it does not stop at. A non-monotonic curve, so the
 *            series goes dense rather than deep - a lot of harmonics at once
 *            rather than a run of them falling away. This said it aliased,
 *            which was a guess and was wrong: measured at six folds it is odd
 *            harmonics only with no foldback at all, because a sine folded by
 *            a sine is still a harmonic series and the eight times covers it.
 *   tape     the one that breaks up at one end before the other. Everything
 *            else here treats every frequency alike; this records with the
 *            top lifted and plays back with it put down, so the highs reach
 *            the curve loudest and bend first. Measured, a tone at 3.5 kHz
 *            comes back about 14 dB more distorted than one at 82 Hz - and
 *            far less than that once the drive is up, because by then the
 *            curve is saturated and a lift has nothing left to give. Which
 *            is the lesson: emphasis is something you hear at the quiet end.
 *
 *            The first numbers tried here lifted 10 dB from 1500 Hz and gave
 *            three decibels of tilt, which is not a thing anybody could be
 *            asked to hear. Measured across a grid, the corner mattered more
 *            than the amount: bringing it down to 900 is most of the
 *            difference between a tape you can name and one you cannot.
 *   tube     the one that remembers. Drive the grid positive and it draws
 *            current, charging the capacitor in front of it and pushing the
 *            operating point out; the capacitor takes tens of milliseconds to
 *            let go. So the curve a note meets depends on what was playing
 *            before it. Measured: a quiet passage straight after a loud one
 *            leads with its even harmonics by 22 dB more than the same quiet
 *            passage cold, and falls back over about 130 ms. With the bloom
 *            at zero the two are the same number to the decimal, which is
 *            the control this was checked against.
 *   iron     the other end, and the exact mirror of tape. Flux in a core is
 *            the integral of the voltage across the winding, so for a signal
 *            of a given size it goes as one over the frequency and the core
 *            runs out of room at the bottom first. Measured at drive 0: 147 Hz
 *            comes back at -17 dB of harmonics and 3.5 kHz at -71, which is
 *            54 dB of spread falling about twelve decibels an octave - the
 *            six the flux loses, doubled, because the third harmonic grows as
 *            its square. No frequency appears anywhere in the arithmetic.
 *   crush    the one that is not analogue at all. Quantising and holding make
 *            energy at frequencies that are not multiples of anything, which
 *            is the single thing no real saturator does.
 *
 * `knobs` is what the deck shows. The three that are always there are drive,
 * tone and mix; the rest belong to the family and come and go with it.
 * `inharmonic` says whether the reading between the harmonics means anything,
 * which decides what the face draws along the bottom of the series.
 */
export const CURVES = {
  soft: {
    label: 'Soft clip',
    knobs: ['bias', 'hardness'],
    inharmonic: false,
  },
  rectify: {
    label: 'Rectify',
    knobs: ['amount'],
    inharmonic: false,
  },
  fold: {
    label: 'Fold',
    knobs: ['folds'],
    inharmonic: true,
  },
  crush: {
    label: 'Crush',
    knobs: ['bits', 'hold', 'dither'],
    inharmonic: true,
  },
  tape: {
    label: 'Tape',
    knobs: ['speed', 'bias'],
    inharmonic: false,
  },
  iron: {
    label: 'Transformer',
    knobs: ['core'],
    inharmonic: false,
  },
  tube: {
    label: 'Tube',
    knobs: ['bias', 'bloom'],
    inharmonic: false,
  },
};

/**
 * How a tube's operating point moves, and how fast.
 *
 * Every other family here answers the sample in front of it the same way
 * every time. A tube does not: drive the grid positive and it draws current,
 * which charges the capacitor in front of it and pushes the operating point
 * the other way - and the capacitor takes tens of milliseconds to let go
 * again. So the curve a note meets on its attack is not the curve its tail
 * meets, and the harmonics change shape while one note is sounding.
 *
 * That is the whole of what makes a tube sound like a tube rather than like
 * a soft clipper with a tilt on it, and it is the one thing on this list the
 * steady-tone probe cannot see at all - a steady tone has a steady envelope,
 * so it measures the settled curve and reports no bloom whatever. It is
 * measured on a burst instead; see tests/heat.test.js.
 *
 * Charges quickly through the grid, lets go slowly through the leak.
 */
export const TUBE_CHARGE = 0.005;
export const TUBE_LEAK = 0.060;

/** And the bend itself is gentle, which is the other half of the character. */
export const TUBE_KNEE = 1.6;

/**
 * How far the operating point may be pushed, which is less far than it looks.
 *
 * Measured against this knee: the even harmonics lead the odd ones by more
 * and more as the point moves out to about 0.35, and then by less and less
 * past it - at a tenth of full scale the lead peaks at 47 dB and has fallen
 * back to 32 by the end of the travel. So a bloom allowed the whole range is
 * a knob that turns back on itself, which the first version of this was.
 *
 * The static bias sets a point inside this, and the bloom moves it through
 * whatever is left, so turning either of them up always does more of the
 * same thing.
 */
export const TUBE_MOST = 0.35;

/**
 * Where the core is reckoned to saturate, as a frequency.
 *
 * The flux in an iron core is the integral of the voltage across the winding,
 * so for a signal of a given size the flux is inversely proportional to its
 * frequency - and the core runs out of room at the bottom of the spectrum
 * first. That is the whole of why a transformer distorts bass and leaves the
 * top alone, and it is the exact mirror of what tape does.
 *
 * The integrator is scaled so that a full-scale tone at this frequency fills
 * a core of size 1. Everything below it fills more, at six decibels an
 * octave; everything above it fills less.
 */
export const IRON_PIVOT = 100;

/**
 * What each tape speed is.
 *
 * The emphasis pair is the whole of why this family sounds like tape and not
 * like the soft clipper it is built on. Tape records with the top lifted and
 * plays back with it put down again, so the highs arrive at the curve louder
 * than everything else, break up first, and then get turned back down along
 * with the harmonics they just made. Nothing else here distorts one end of
 * the spectrum before the other.
 *
 * Slower tape lifts more and lifts lower, loses more at the top, and bumps
 * lower down - which is why 7.5 sounds like a different machine rather than
 * the same one run slowly. The head bump is a real thing and these are not a
 * real machine's numbers: they are chosen to be audibly apart and to move in
 * the directions the physics moves in. Measured effects are in the comments
 * on `CURVES` and in tests/heat.test.js.
 */
export const TAPE_SPEEDS = [
  { label: '7½ ips', emphasis: 16, corner: 900, bump: 2.5, bumpHz: 40, loss: 14000 },
  { label: '15 ips', emphasis: 12, corner: 1800, bump: 2.0, bumpHz: 60, loss: 17000 },
  { label: '30 ips', emphasis: 8, corner: 3500, bump: 1.5, bumpHz: 90, loss: 20000 },
];

/** The order they are offered in: gentlest first, least analogue last. */
export const CURVE_ORDER = ['soft', 'tape', 'iron', 'tube', 'rectify', 'fold', 'crush'];

export const HEAT_DEFAULTS = {
  mode: 'soft',    // which family of curve - see CURVES
  drive: 0,        // dB into the curve
  bias: 0,         // 0 symmetric, 1 lopsided - the even-harmonic control
  hardness: 2,     // 1 is a gentle bend, MOST_HARDNESS is nearly a hard clip
  amount: 1,       // rectify: 0 is half-wave, 1 is full-wave
  folds: 1,        // fold: how many times the curve turns back on itself
  bits: 16,        // crush: the depth it is quantised to
  hold: 1,         // crush: how many samples each one is held for
  dither: 0,       // crush: triangular noise added before the rounding
  speed: 1,        // tape: which of TAPE_SPEEDS
  core: 0.5,       // transformer: how much room the iron has
  bloom: 0.5,      // tube: how far the envelope moves the operating point
  tone: MOST_TONE, // a low-pass after the curve, on the harmonics it just made
  mix: 1,          // 0 is the dry signal, 1 is all shaped
  trim: 0,         // output, in dB - auto gain writes this
  listen: 'out',   // 'out', or 'diff' for only what the curve added
};

/**
 * How far each of those may be moved, which is where a plugin's knob ends.
 *
 * Here rather than in the plugin because two things now need it: the plugin,
 * to lay out a slider, and the sketchpad, which stores an insert's settings
 * and has to put a loaded file's numbers back inside the range the processor
 * expects. Two tables would be two tables to keep in step, and the day they
 * drift is the day a saved sketch loads as a different sound.
 */
export const HEAT_LIMITS = {
  drive: [0, MOST_DRIVE],
  bias: [0, 1],
  hardness: [1, MOST_HARDNESS],
  amount: [0, 1],
  folds: [1, 6],
  bits: [2, 16],
  hold: [1, 16],
  dither: [0, 2],
  speed: [0, 2],
  core: [0.05, 1],
  bloom: [0, 1],
  tone: [LEAST_TONE, MOST_TONE],
  mix: [0, 1],
  trim: [-24, 24],
};

/**
 * The curve itself: a family of soft clippers with one parameter.
 *
 *   f(x) = x / (1 + |x|^n)^(1/n)
 *
 * At n = 1 the line is bending from the moment anything goes in, so there is
 * always a little colour and it reaches a long way up the series. As n grows
 * the bend pulls back towards the ends and tightens into a corner, and by
 * n = 5 the line is straight until it isn't. Either way the output never
 * leaves the range the input was in, so nothing downstream has to be told
 * what to do about a number that ran off.
 */
export function shape(x, n) {
  const size = x < 0 ? -x : x;
  if (size < 1e-9) return x;
  return x / Math.pow(1 + Math.pow(size, n), 1 / n);
}

/**
 * Half-wave through to full-wave, and then the soft clipper.
 *
 * Rectifying on its own is scale-invariant - a louder sine comes out a louder
 * rectified sine with the same series - so drive would do nothing audible but
 * turn it up. Putting the soft curve after it gives the drive something to
 * work on, which is also what an octave fuzz actually is.
 *
 * At `amount` 0 it keeps the positive half and drops the other, which leaves
 * the fundamental in place with evens above it. At 1 it folds the negative
 * half upwards, and the fundamental goes: what comes out is at twice the rate
 * it went in, which is an octave, which is the whole lesson.
 */
export function rectify(x, amount) {
  const half = x > 0 ? x : 0;
  const full = x < 0 ? -x : x;
  return shape(half + (full - half) * amount, 2);
}

/**
 * A curve that turns back instead of flattening.
 *
 * Every other family here is monotonic: more in is never less out. This one
 * is not, so the series goes dense rather than deep - a lot of harmonics at
 * once rather than a run of them falling away - and that is a sound nothing
 * else in this app makes.
 */
export function foldOver(x, folds) {
  return Math.sin(x * folds * Math.PI * 0.5);
}

/**
 * Quantising, and holding.
 *
 * Run at the signal's own rate and never oversampled, because here the
 * aliasing is not a defect to be filtered away - it is the entire subject.
 * Taking it out would leave a mode that teaches nothing.
 */
export function crushTo(x, bits, dither = 0) {
  const steps = Math.pow(2, bits - 1);
  // Triangular dither: two rectangular draws added, which is what makes it
  // triangular and what takes the error off the signal. Measured on a sine,
  // it costs 4.8 dB of signal to noise against the 4.77 the theory says, and
  // what it buys is a floor that hisses instead of one that follows the
  // music - audible on anything that fades, where an undithered eight bits
  // turns the tail into a staircase and a dithered one turns it into noise.
  const shake = dither ? (Math.random() - Math.random()) * dither / steps : 0;
  return Math.round((x + shake) * steps) / steps;
}

// Running the curve eight times faster than the signal, because the
// alternative was measured and it was not acceptable.
//
// A nonlinearity makes harmonics without limit, and every one of them above
// half the sample rate folds back down to a frequency that is not a harmonic
// of anything. Shaped at 48 kHz, a 220 Hz note is fine - the folded energy
// comes back 61 dB down. A hi-hat is not: at a high drive the junk lands
// 10 dB under the signal, and it is inharmonic, which is the one thing real
// saturation never sounds like. A mode built on that would be teaching
// people to recognise a sound no piece of gear makes.
//
// So the curve runs at eight times the rate, with a linear-phase filter
// either side of it - one to fill in the samples in between, one to take
// away what the curve made above the old Nyquist before the rate drops back.
// Both are the same kernel: flat to 21 kHz and gone by 27 kHz, which is far
// enough either side of half the old rate to catch the first image on the way
// up and the first fold on the way down. Measured again afterwards, the same
// hi-hat comes back 48 dB down rather than 10, and a note 91 rather than 61.

// Exported, though nothing outside reads them, because the worklet takes its
// constants from this module's exports now rather than from a list somebody
// has to remember to add to.
export const OVERSAMPLE = 8;
export const OVER_TAPS = 257;

/** The interpolation kernel, and the same one again for the way back down. */
export function overKernel() {
  const middle = (OVER_TAPS - 1) / 2;
  const cut = 0.5 / OVERSAMPLE;
  const h = new Float64Array(OVER_TAPS);
  let sum = 0;

  for (let i = 0; i < OVER_TAPS; i += 1) {
    const x = i - middle;
    const sinc = x === 0 ? 2 * cut : Math.sin(2 * Math.PI * cut * x) / (Math.PI * x);
    // Blackman, for a stopband deep enough that what gets through is quieter
    // than anything else in the signal.
    const w = 0.42
      - 0.5 * Math.cos((2 * Math.PI * i) / (OVER_TAPS - 1))
      + 0.08 * Math.cos((4 * Math.PI * i) / (OVER_TAPS - 1));
    h[i] = sinc * w;
    sum += h[i];
  }

  for (let i = 0; i < OVER_TAPS; i += 1) h[i] /= sum;
  return h;
}

/** How long the pair of filters holds the signal up, in samples. */
export const HEAT_LATENCY = (OVER_TAPS - 1) / OVERSAMPLE;

/**
 * The saturator, one sample at a time.
 *
 * `step(x)` leaves what came out on `out`.
 */
/**
 * `blockDc` is false only for the probe, and only because of what a filter
 * does when it starts rather than what it does. See `spectrumOf`.
 */
export function shaperCore(rate, blockDc = true) {
  // From the defaults rather than copied out of them. This was a literal, and
  // every family added since has begun by forgetting to put its parameter in
  // it - which does not throw, it quietly reads undefined and comes out as a
  // knob that does nothing or a core that saturates to NaN.
  const state = { ...HEAT_DEFAULTS };

  const kernel = overKernel();
  const branch = Math.ceil(OVER_TAPS / OVERSAMPLE);
  const middle = (OVER_TAPS - 1) / 2;

  // The interpolation filter, split by phase: filling in seven samples
  // between every two is the same arithmetic as running eight short filters,
  // once each, on the samples that are actually there.
  const phases = [];
  for (let p = 0; p < OVERSAMPLE; p += 1) {
    const taps = new Float64Array(branch);
    for (let k = 0; k < branch; k += 1) {
      taps[k] = (k * OVERSAMPLE + p < OVER_TAPS ? kernel[k * OVERSAMPLE + p] : 0) * OVERSAMPLE;
    }
    phases.push(taps);
  }

  // Rings, written twice and read forwards, rather than arrays that get
  // shifted along. Moving 257 numbers up by one eight times per sample costs
  // more than all the multiplying does, and a saturator that eats a sixth of
  // a core is not one anybody can put on a track.
  const slow = new Float64Array(branch * 2);
  const fast = new Float64Array(OVER_TAPS * 2);
  const dry = new Float64Array(HEAT_LATENCY + 1);
  let slowAt = 0;
  let fastAt = 0;
  let dryAt = 0;

  // The core's flux, and the last value it came back out at. Both carry
  // between samples, which is what makes this family the first one here that
  // is not a function of the sample in front of it.
  let flux = 0;
  let wasSat = 0;
  let ironing = false;
  let charge = 0;
  const tubeUp = 1 - Math.exp(-1 / (TUBE_CHARGE * rate * OVERSAMPLE));
  const tubeDown = 1 - Math.exp(-1 / (TUBE_LEAK * rate * OVERSAMPLE));
  const fluxStep = (2 * Math.PI * IRON_PIVOT) / (rate * OVERSAMPLE);
  const fluxLeak = 1 - (2 * Math.PI * 8) / (rate * OVERSAMPLE);

  // The pair either side of the curve, and the two that come after it. Only
  // the tape family uses them, and only it pays for them.
  const pre = makeBiquad();
  const post = makeBiquad();
  const bump = makeBiquad();
  const loss = makeBiquad();
  let taping = false;

  const tone = [makeBiquad(), makeBiquad()];
  // y[n] = x[n] - x[n-1] + R*y[n-1]. Unity through the band, nothing at
  // nothing, and one multiply to get there.
  const dcPole = 1 - (2 * Math.PI * DC_CORNER) / rate;
  let dcWas = 0;
  let dcOut = 0;
  let filtered = false;
  let gain = 1;
  let offset = 0;
  let centre = 0;
  let level = 1;
  let curve = (v) => v;
  let crushing = false;
  let crushHeld = 0;
  let holdAt = 0;

  function retune() {
    gain = Math.pow(10, state.drive / 20);
    // Bias is the soft curve's. The other families have no use for a constant
    // on the input, and one would only move them off centre.
    // The tube works out its own, because for it the point moves while the
    // sound is playing and the generic one is a constant.
    offset = ['soft', 'tape'].includes(state.mode) ? state.bias * MOST_BIAS : 0;
    // The bias puts a constant on the input, which comes out of the curve as
    // a constant on the output - a DC offset that would sit under the sound
    // doing nothing audible except eating headroom. Subtracting what the
    // curve does to silence leaves the asymmetry and takes the offset away.
    centre = shape(offset, state.hardness);

    // Which family, resolved once here rather than branched per sample - the
    // inner loop runs eight times for every sample that arrives.
    crushing = state.mode === 'crush';
    taping = state.mode === 'tape';
    ironing = state.mode === 'iron';
    if (taping) {
      const pick = Math.round(state.speed);
      const at = TAPE_SPEEDS[Number.isFinite(pick)
        ? Math.max(0, Math.min(TAPE_SPEEDS.length - 1, pick)) : 1];
      setBiquad(pre, 'highshelf', at.corner, rate, at.emphasis);
      setBiquad(post, 'highshelf', at.corner, rate, -at.emphasis);
      setBiquad(bump, 'peaking', at.bumpHz, rate, at.bump);
      setBiquad(loss, 'lowpass', Math.min(at.loss, rate * 0.45), rate);
    }
    if (state.mode === 'rectify') {
      const amount = state.amount;
      const middle = rectify(0, amount);
      curve = (v) => rectify(v, amount) - middle;
    } else if (state.mode === 'fold') {
      const folds = state.folds;
      curve = (v) => foldOver(v, folds);
    } else if (crushing) {
      // Nothing happens in the oversampled loop. The filters either side of
      // it are flat to 21 kHz, so the signal comes out of the round trip as
      // it went in, and the crushing is done below at the rate it belongs to.
      curve = (v) => v;
    } else if (state.mode === 'tube') {
      const base = state.bias * TUBE_MOST;
      const room = (TUBE_MOST - base) * state.bloom;
      curve = (v) => {
        // The envelope, up quickly and down slowly, exactly as a capacitor
        // charged through a grid and bled through a resistor behaves.
        const size = v < 0 ? -v : v;
        charge += (size > charge ? tubeUp : tubeDown) * (size - charge);
        // Where the curve is sitting this instant: the static point, plus as
        // much of what is left above it as the envelope has earned.
        const at = base + room * (charge > 1 ? 1 : charge);
        return shape(v + at, TUBE_KNEE) - shape(at, TUBE_KNEE);
      };
    } else if (ironing) {
      // Integrate to get the flux, saturate the flux, differentiate to get
      // the voltage back. Where the core has room the two undo each other
      // exactly and the signal comes through untouched; where it does not,
      // the flux flattens and what comes out of the differentiator is the
      // bend. No frequency appears in this arithmetic - the frequency
      // dependence falls out of the integrator, which is the point.
      const size = state.core;
      curve = (v) => {
        flux = fluxLeak * flux + v * fluxStep;
        const sat = Math.tanh(flux / size) * size;
        const out = (sat - wasSat) / fluxStep;
        wasSat = sat;
        return out;
      };
    } else {
      const hardness = state.hardness;
      curve = (v) => shape(v, hardness) - centre;
    }
    level = Math.pow(10, state.trim / 20);
    // At the top of its travel the tone control is not a gentle filter near
    // Nyquist, it is no filter: a biquad asked for a corner that close to
    // half the sample rate is warped far enough to colour the top octave
    // whether or not anybody asked it to.
    filtered = state.tone < MOST_TONE;
    if (filtered) {
      for (const stage of tone) setBiquad(stage, 'lowpass', Math.min(state.tone, rate * 0.45), rate);
    }
  }

  retune();

  return {
    settings: state,
    out: 0,

    set(next) {
      for (const key in next) if (key in state) state[key] = next[key];
      retune();
    },

    step(x) {
      // Into the curve with the top lifted, if this is tape. The dry path
      // below keeps the signal as it arrived, because a mix control that
      // blends in an equalised copy is an equaliser.
      const into = taping ? runBiquad(pre, x) : x;

      slowAt = slowAt === 0 ? branch - 1 : slowAt - 1;
      slow[slowAt] = into;
      slow[slowAt + branch] = into;

      let wet = 0;

      for (let p = 0; p < OVERSAMPLE; p += 1) {
        let up = 0;
        const taps = phases[p];
        for (let k = 0; k < branch; k += 1) up += taps[k] * slow[slowAt + k];

        fastAt = fastAt === 0 ? OVER_TAPS - 1 : fastAt - 1;
        const shaped = curve(up * gain + offset);
        fast[fastAt] = shaped;
        fast[fastAt + OVER_TAPS] = shaped;

        // The one sample of the eight that lines up. Both filters are linear
        // phase and hold the signal up by half their length, so the output
        // that belongs to this input is the one taken on the phase the input
        // itself sits on - and taking any of the other seven would be a
        // fraction of a sample out, which at the top of the spectrum is a
        // quarter of a cycle and reads as everything being wrong.
        //
        // Linear phase also means the kernel reads the same backwards, so
        // each pair of taps either side of the middle can share a multiply.
        if (p === 0) {
          for (let i = 0; i < middle; i += 1) {
            wet += kernel[i] * (fast[fastAt + i] + fast[fastAt + OVER_TAPS - 1 - i]);
          }
          wet += kernel[middle] * fast[fastAt + middle];
        }
      }

      // Quantise and hold at the signal's own rate, after the oversampled
      // round trip rather than inside it, so that the decimation filter runs
      // before this and cannot take away what it makes. The round trip is
      // transparent, so this is the base-rate signal - and the latency and the
      // dry delay carry on lining up, which they would not if the family
      // bypassed the filters outright.
      if (crushing) {
        if (holdAt <= 0) {
          crushHeld = crushTo(wet, state.bits, state.dither);
          holdAt = Math.max(1, Math.round(state.hold));
        }
        holdAt -= 1;
        wet = crushHeld;
      }

      // On the shaped path and nothing else. The dry signal never went
      // through a curve, so it has no offset to take off it, and taking one
      // off anyway would tilt the one control whose point is changing nothing.
      if (blockDc) {
        const lifted = wet - dcWas + dcPole * dcOut;
        dcWas = wet;
        dcOut = lifted;
        wet = lifted;
      }

      // Put the top back down, then the bump the heads make and what the
      // tape could not hold on to. The first of these undoes the lift, taking
      // the harmonics it caused down with it - which is the part that sounds
      // like tape rather than like a bright distortion.
      if (taping) {
        wet = runBiquad(post, wet);
        wet = runBiquad(bump, wet);
        wet = runBiquad(loss, wet);
      }

      if (filtered) for (const stage of tone) wet = runBiquad(stage, wet);

      // The dry signal has to arrive when the wet one does. The two filters
      // together hold the sound up by a fixed number of samples, and a
      // parallel mix of a signal against a delayed copy of itself is a comb
      // filter - which would put notches every kilohertz or so through the
      // one control whose whole point is that it changes nothing else.
      dry[dryAt] = x;
      dryAt = (dryAt + 1) % dry.length;
      const held = dry[dryAt];

      // Parallel, not in series: the dry signal is the one that came in, not
      // the one that went through the curve at a lower setting. Which is what
      // makes a mix control on a saturator worth having - you can keep the
      // transient intact and hear the harmonics underneath it.
      const mixed = wet * state.mix + held * (1 - state.mix);
      this.out = (state.listen === 'diff' ? mixed - held : mixed) * level;
    },
  };
}

/* ---------- the same thing over a whole buffer ---------- */

/** A signal through the saturator. */
export function runShaper(samples, rate, settings) {
  const core = shaperCore(rate);
  core.set(settings);

  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    core.step(samples[i]);
    out[i] = core.out;
  }

  return out;
}

/**
 * The trim that leaves a setting as loud as what went into it.
 *
 * Louder wins, which is the oldest false positive there is and the reason
 * every other tool here compensates too. A saturator is the worst offender:
 * turning the drive up makes everything louder and denser at the same time,
 * and without this nobody would ever pick the quieter answer even when it is
 * the one they were asked for.
 *
 * Read off a second of it rather than all of it. The shaping runs at eight
 * times the rate, so a whole loop costs the best part of a second to measure
 * and this has to happen on every turn of the knob - and a second of a loop
 * that repeats already says everything about its level that five do.
 */
const GAIN_WINDOW = 1;

export function heatTrim(samples, rate, settings) {
  const excerpt = samples.length > rate * GAIN_WINDOW
    ? samples.subarray(0, Math.round(rate * GAIN_WINDOW))
    : samples;

  const quiet = rms(excerpt);
  if (quiet < 1e-6) return 0;
  const loud = rms(runShaper(excerpt, rate, { ...settings, trim: 0, listen: 'out' }));
  if (loud < 1e-9) return 0;
  return Math.max(-24, Math.min(24, 20 * Math.log10(quiet / loud)));
}

function rms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, samples.length));
}

/* ---------- reading the harmonics ---------- */

// A tone chosen so that every harmonic lands exactly on a bin.
//
// This matters more than it looks. A sine at a frequency that falls between
// two bins smears across the whole spectrum, and the smear from a fundamental
// at 0 dB buries harmonics at -60. Put the fundamental on bin PROBE_BIN of a
// PROBE_LENGTH transform and harmonic m is exactly on bin PROBE_BIN * m, with
// nothing either side of it, and the numbers that come back are the real ones
// rather than the window's.
//
// Which bin decides what the reading can see. The first one tried put the
// tone at 220 Hz, where the tenth harmonic is 2.2 kHz - so every tone setting

/**
 * What a sine comes out of a setting as: the harmonic series, in decibels
 * below the fundamental.
 *
 * This one reading is the whole instrument. Drive decides how far up the
 * series goes, hardness decides how fast it falls away, bias decides whether
 * the even harmonics are there at all, tone tilts the top of it, and mix
 * pulls all of it down together. Nothing about a saturator is invisible to
 * it - which is why the guess is marked on it rather than on the knobs.
 */
export function harmonicsOf(rate, settings) {
  return seriesOf(spectrumOf(rate, settings, PROBE_BIN), PROBE_BIN);
}

/**
 * One bin-aligned sine through a setting, as power per bin.
 *
 * The probe itself is `lib/harmonics.js`'s, shared with everything else here
 * that distorts; what belongs to the saturator is the core being probed and
 * the one thing that core is asked to leave out.
 *
 * Without the offset filter, which is the one piece of this the probe leaves
 * out.
 *
 * It is not dodging it. A first-order corner at DC_CORNER is 0.0006 dB at
 * 440 Hz and flatter above, so at steady state it does nothing a reading
 * here can see - measured bin by bin across the whole spectrum against a
 * probe primed for five seconds, and the two agree to 0.0006 dB everywhere,
 * the quiet bins between the harmonics included.
 *
 * What it does do is start. The filter needs about fifteen of its 32 ms time
 * constants to settle, and a decaying exponential inside a rectangular window
 * is not periodic in it, so until it has settled it leaks across every bin at
 * once. That put the noise floor between the harmonics - which is the whole
 * of the aliasing reading - up from -279 dB to -46. Priming it out would cost
 * six times the prime on a measurement that already runs on every turn of a
 * knob, to arrive back at the number bypassing it gives for nothing.
 */
function spectrumOf(rate, settings, bin) {
  const core = shaperCore(rate, false);
  core.set({ ...settings, listen: 'out' });

  return spectrumThrough((x) => { core.step(x); return core.out; }, bin);
}

/**
 * How much of what came out is neither the tone nor a harmonic of it.
 *
 * Nothing in the app calls this to make a sound or mark a guess. It exists so
 * that the claim the oversampling is there to make can be checked rather than
 * asserted, at whatever frequency somebody wants to check it at.
 */
export function foldback(rate, settings, bin = PROBE_BIN) {
  return foldbackIn(spectrumOf(rate, settings, bin), bin);
}

/** A harmonic series, in an envelope. */
export function harmonicsReading(rate, settings, { source = null } = {}) {
  return readingOf({
    tool: 'saturation',
    kind: 'harmonics',
    of: { state: stampOf(settings), source, axis: HARMONIC_AXIS },
    values: harmonicsOf(rate, settings),
  });
}

/**
 * How much of the input range the transfer curve is worth drawing over.
 *
 * Not all of it, past the first few decibels of drive. A curve drawn from
 * minus one to plus one with eight times gain in front of it is a vertical
 * line through the middle and two flat shelves: technically what the curve
 * does to a full-scale input, and useless as a picture of anything. Nothing
 * is ever at full scale anyway - the knee is where the signal lives, and
 * that is what somebody turning the knob needs to see.
 *
 * Pulling in as the square root of the gain is the compromise that keeps
 * both readings. The knee moves inwards as the drive goes up, so more drive
 * still looks like more drive, and it never collapses to a line.
 */
export const curveReach = (drive) => 1 / Math.sqrt(Math.max(1, Math.pow(10, drive / 20)));

/**
 * The transfer curve, for drawing: what comes out for every level that could
 * go in, over the part of the range worth looking at.
 *
 * The one picture that explains the whole thing. A straight line does
 * nothing. A line that bends away from straight is a saturator, and how
 * sharply it bends is the hardness. A line that is not symmetric about the
 * middle - one end bending sooner than the other - is a biased one, and that
 * visible lopsidedness is exactly what the even harmonics are.
 */
export function transferCurve(settings, points = 129) {
  const mode = settings.mode ?? HEAT_DEFAULTS.mode;
  const drive = settings.drive ?? 0;
  const gain = Math.pow(10, drive / 20);
  const hardness = settings.hardness ?? HEAT_DEFAULTS.hardness;
  const offset = mode === 'soft' ? (settings.bias ?? 0) * MOST_BIAS : 0;
  const mix = settings.mix ?? 1;
  const centre = shape(offset, hardness);
  const reach = curveReach(drive);

  // Every family draws a different shape here, which makes this panel the
  // plainest statement of which one you are in: a soft S, a V with one side
  // folded up, a line that turns back on itself, a staircase. Nothing else on
  // the face has to say it.
  const amount = settings.amount ?? HEAT_DEFAULTS.amount;
  const folds = settings.folds ?? HEAT_DEFAULTS.folds;
  const bits = settings.bits ?? HEAT_DEFAULTS.bits;
  const middle = rectify(0, amount);
  // The transformer is the one family whose panel is not input against
  // output, because for it those two are not a fixed pair - what comes out
  // depends on how long the signal has been going in. What is fixed is the
  // core: flux in, saturated flux out, which is the shape that decides
  // everything else. The face says which it is drawing.
  const core = settings.core ?? HEAT_DEFAULTS.core;
  let curve;
  if (mode === 'iron') curve = (v) => Math.tanh(v / core) * core;
  else if (mode === 'rectify') curve = (v) => rectify(v, amount) - middle;
  else if (mode === 'fold') curve = (v) => foldOver(v, folds);
  // The bare ladder, with no dither on it. A dithered staircase drawn as a
  // curve is a fuzzy band that is different every repaint, and what the panel
  // is for is saying which family you are in - the dither's own lesson is a
  // number, and the head readout is where it goes.
  else if (mode === 'crush') curve = (v) => crushTo(v, bits);
  else curve = (v) => shape(v, hardness) - centre;

  const out = new Float64Array(points);
  for (let i = 0; i < points; i += 1) {
    const x = ((i / (points - 1)) * 2 - 1) * reach;
    out[i] = curve(x * gain + offset) * mix + x * (1 - mix);
  }

  return out;
}
