import { makeBiquad, setBiquad, runBiquad } from '../../lib/dsp.js';
import { fft } from '../../lib/fft.js';
import { readingOf, stampOf } from '../../lib/read.js';

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
export const HEAT_DEFAULTS = {
  drive: 0,        // dB into the curve
  bias: 0,         // 0 symmetric, 1 lopsided - the even-harmonic control
  hardness: 2,     // 1 is a gentle bend, MOST_HARDNESS is nearly a hard clip
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

const OVERSAMPLE = 8;
const OVER_TAPS = 257;

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
  const state = {
    drive: 0, bias: 0, hardness: 2, tone: 20000, mix: 1, trim: 0, listen: 'out',
  };

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

  function retune() {
    gain = Math.pow(10, state.drive / 20);
    offset = state.bias * MOST_BIAS;
    // The bias puts a constant on the input, which comes out of the curve as
    // a constant on the output - a DC offset that would sit under the sound
    // doing nothing audible except eating headroom. Subtracting what the
    // curve does to silence leaves the asymmetry and takes the offset away.
    centre = shape(offset, state.hardness);
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
      slowAt = slowAt === 0 ? branch - 1 : slowAt - 1;
      slow[slowAt] = x;
      slow[slowAt + branch] = x;

      let wet = 0;

      for (let p = 0; p < OVERSAMPLE; p += 1) {
        let up = 0;
        const taps = phases[p];
        for (let k = 0; k < branch; k += 1) up += taps[k] * slow[slowAt + k];

        fastAt = fastAt === 0 ? OVER_TAPS - 1 : fastAt - 1;
        const shaped = shape(up * gain + offset, state.hardness) - centre;
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

      // On the shaped path and nothing else. The dry signal never went
      // through a curve, so it has no offset to take off it, and taking one
      // off anyway would tilt the one control whose point is changing nothing.
      if (blockDc) {
        const lifted = wet - dcWas + dcPole * dcOut;
        dcWas = wet;
        dcOut = lifted;
        wet = lifted;
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
// above about 3 kHz measured identically, and a third of that control was
// invisible to the marking. At 440 the series runs to 4.4 kHz and the tone
// control sweeps through the whole of it.
export const PROBE_LENGTH = 16384;
export const PROBE_BIN = 150;
export const PROBE_LEVEL = -12;
const PROBE_PRIME = 4096;

/** How many harmonics are read, and shown. */
export const HARMONICS = [2, 3, 4, 5, 6, 7, 8, 9, 10];

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
  const power = spectrumOf(rate, settings, PROBE_BIN);

  const first = power[PROBE_BIN];
  const dbOf = (p) => 10 * Math.log10(Math.max(p, 1e-20) / Math.max(first, 1e-20));

  const harmonics = {};
  let evens = 0;
  let odds = 0;
  for (const m of HARMONICS) {
    const bin = PROBE_BIN * m;
    harmonics[m] = bin < power.length ? dbOf(power[bin]) : -120;
    if (bin >= power.length) continue;
    if (m % 2 === 0) evens += power[bin]; else odds += power[bin];
  }

  let total = 0;
  for (let i = 1; i < power.length; i += 1) total += power[i];

  return {
    harmonics,
    // Total harmonic distortion: everything the curve added, against the
    // tone it was given.
    thd: 10 * Math.log10(Math.max(total - first, 1e-20) / Math.max(first, 1e-20)),
    // The two halves of the series, each as a whole. Which of these is the
    // louder is the single thing an ear can hear about a saturator without
    // being trained: even is an octave and a twelfth above, which sounds like
    // the note getting richer, and odd is a fifth and a major third, which
    // sounds like something going wrong.
    even: dbOf(evens),
    odd: dbOf(odds),
    aliasing: foldbackIn(power, PROBE_BIN),
  };
}

/** One bin-aligned sine through a setting, as power per bin. */
function spectrumOf(rate, settings, bin) {
  const step = (2 * Math.PI * bin) / PROBE_LENGTH;
  const amplitude = Math.pow(10, PROBE_LEVEL / 20) * Math.SQRT2;

  const core = shaperCore(rate, false);
  core.set({ ...settings, listen: 'out' });

  // Without the offset filter, which is the one piece of this the probe
  // leaves out.
  //
  // It is not dodging it. A first-order corner at DC_CORNER is 0.0006 dB at
  // 440 Hz and flatter above, so at steady state it does nothing a reading
  // here can see - measured bin by bin across the whole spectrum against a
  // probe primed for five seconds, and the two agree to 0.0006 dB everywhere,
  // the quiet bins between the harmonics included.
  //
  // What it does do is start. The filter needs about fifteen of its 32 ms
  // time constants to settle, and a decaying exponential inside a rectangular
  // window is not periodic in it, so until it has settled it leaks across
  // every bin at once. That put the noise floor between the harmonics - which
  // is the whole of the aliasing reading - up from -279 dB to -46. Priming it
  // out would cost six times the prime on a measurement that already runs on
  // every turn of a knob, to arrive back at the number bypassing it gives for
  // nothing.

  // Let the tone filter settle before anything is measured, or its ringing
  // turns up in the answer as harmonics nothing made.
  for (let i = 0; i < PROBE_PRIME; i += 1) core.step(amplitude * Math.sin(step * i));

  const re = new Float64Array(PROBE_LENGTH);
  const im = new Float64Array(PROBE_LENGTH);
  for (let i = 0; i < PROBE_LENGTH; i += 1) {
    core.step(amplitude * Math.sin(step * (i + PROBE_PRIME)));
    re[i] = core.out;
  }

  fft(re, im);

  const power = new Float64Array(PROBE_LENGTH / 2);
  for (let i = 0; i < power.length; i += 1) power[i] = re[i] * re[i] + im[i] * im[i];
  return power;
}

/**
 * Everything that is neither the tone nor a harmonic of it, against the tone.
 *
 * On an honest curve this is the noise floor. If it climbs, it is aliasing -
 * harmonics that went past half the sample rate and folded back down to
 * frequencies with no musical relationship to anything - and that is the one
 * failure mode of shaping a signal without running the curve faster than the
 * signal first.
 *
 * Nothing in the app calls this to make a sound or mark a guess. It exists so
 * that the claim the oversampling is there to make can be checked rather than
 * asserted, at whatever frequency somebody wants to check it at.
 */
export function foldback(rate, settings, bin = PROBE_BIN) {
  return foldbackIn(spectrumOf(rate, settings, bin), bin);
}

function foldbackIn(power, bin) {
  let total = 0;
  for (let i = 1; i < power.length; i += 1) total += power[i];

  let series = 0;
  for (let m = 1; bin * m < power.length; m += 1) series += power[bin * m];

  return 10 * Math.log10(Math.max(total - series, 1e-20) / Math.max(power[bin], 1e-20));
}

/**
 * How far apart two harmonic profiles are: the worst harmonic, in decibels.
 *
 * The worst rather than the average, for the reason every other mode here
 * found in turn. What anybody means by two saturators sounding the same is
 * that the whole series matches - a third harmonic eight decibels out is
 * audible as a different distortion however well the other eight agree, and
 * averaging it across nine numbers turns it into a rounding error.
 *
 * Only harmonics that can be heard count, and what can be heard depends on
 * the rest of the series. A fixed floor was the first version of this and it
 * was not enough: these curves put real interference nulls in the series, so
 * a target whose seventh harmonic happens to land at -58 while everything
 * around it is at -12 would charge somebody thirty decibels for a harmonic
 * nobody could pick out under the ones either side of it. The floor rides
 * MASKED below the loudest harmonic there is, and never climbs above the
 * absolute one.
 *
 * **Pairwise only.** The masking floor is derived from both readings at once -
 * it rides MASKED below the loudest harmonic in *either* of them - so this is
 * not a metric and cannot be used to rank three readings against each other.
 * `heatGap(a, b)` and `heatGap(a, c)` are measured against different floors
 * and their `off` values are not on the same scale. That is the right
 * behaviour for the question it answers, and the wrong thing to build a
 * nearest-neighbour search on.
 */
export const HEAT_FLOOR = -62;
export const MASKED = 38;

export function heatGap(mine, theirs) {
  const a = mine.values ?? mine;
  const b = theirs.values ?? theirs;

  let loudest = -Infinity;
  for (const m of HARMONICS) {
    if (a.harmonics[m] > loudest) loudest = a.harmonics[m];
    if (b.harmonics[m] > loudest) loudest = b.harmonics[m];
  }
  const floor = Math.max(HEAT_FLOOR, loudest - MASKED);

  let off = 0;
  let which = null;
  let louder = 0;

  for (const m of HARMONICS) {
    const mine_m = Math.max(a.harmonics[m], floor);
    const theirs_m = Math.max(b.harmonics[m], floor);
    const gap = Math.abs(mine_m - theirs_m);
    if (gap > off) { off = gap; which = m; louder = mine_m - theirs_m; }
  }

  // A label, not an index. This used to hand back the number 3 and leave every
  // caller to turn it into "3rd harmonic" itself, which is how a comparator
  // ends up with three conventions between four implementations.
  return {
    off,
    where: which === null ? null : `${ordinal(which)} harmonic`,
    detail: { harmonic: which, louder, thd: a.thd - b.thd },
  };
}

export const heatDistance = (mine, theirs) => heatGap(mine, theirs).off;

/** 2nd, 3rd, 4th - how anybody says which harmonic they mean. */
export function ordinal(n) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/** What a harmonic reading is indexed by: which harmonics, in order. */
export const HARMONIC_AXIS = { kind: 'harmonics', ids: HARMONICS };

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
  const drive = settings.drive ?? 0;
  const gain = Math.pow(10, drive / 20);
  const hardness = settings.hardness ?? HEAT_DEFAULTS.hardness;
  const offset = (settings.bias ?? 0) * MOST_BIAS;
  const mix = settings.mix ?? 1;
  const centre = shape(offset, hardness);
  const reach = curveReach(drive);

  const out = new Float64Array(points);
  for (let i = 0; i < points; i += 1) {
    const x = ((i / (points - 1)) * 2 - 1) * reach;
    out[i] = (shape(x * gain + offset, hardness) - centre) * mix + x * (1 - mix);
  }

  return out;
}
