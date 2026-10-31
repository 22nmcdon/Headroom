// The ways a recording gets spoiled, as arithmetic over samples.
//
// Seven of them, and the point of having them in one place is that they are
// the answers to one question: what is wrong with this? An ear that can tell
// clipping from a bad codec from mains hum is an ear that can fix a
// recording; an ear that only knows "it sounds bad" cannot.
//
// Three of these are things this app already does on purpose. Hard clipping,
// soft clipping and quantising are what the saturator is for, and the same
// arithmetic is in `plugins/saturation/shape.js` doing a job somebody asked
// for. The difference between an effect and a fault is whether anybody meant
// it, which is not a property of the signal - so the drill that uses these
// has to have both in it, or it is a drill about which of four distortions
// it is rather than about whether anything is wrong at all.
//
// The other four are nobody's idea of a good time: holding each sample for a
// while, which is what a cheap converter does; mains hum, which is what an
// unbalanced cable near a transformer does; a click, which is what a dropped
// sample or a bad edit does; and band-limiting, which is what a codec at a
// low bitrate or a telephone does.
//
// ## What is NOT in here
//
// A number for how bad it is. There is no THD reading and there will not be
// one: Geddes and Lee's work on perceived distortion found that THD and IMD
// do not predict what people hear - a high-order crossover artefact at a
// tenth of a per cent is more objectionable than soft clipping at ten per
// cent. So everything here is scored by naming it, which is the thing an ear
// can actually do.

import { integrated, kWeight } from './loudness.js';

/** Every sample, through one function, into a new array. */
const over = (samples, fn) => {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) out[i] = fn(samples[i], i);
  return out;
};

/** The loudest sample, which is what the sizes below are relative to. */
export function loudestOf(samples) {
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) peak = Math.max(peak, Math.abs(samples[i]));
  return peak;
}

/**
 * Hard clipping: everything past the ceiling is the ceiling.
 *
 * The ceiling is a fraction of what the material already peaks at, so the
 * same number does the same thing whatever it is handed - and the level is
 * put back afterwards, because a drill about what clipping sounds like is
 * not a drill about what it does to the level.
 */
export function hardClip(samples, rate, { at = 0.5 } = {}) {
  const ceiling = Math.max(1e-6, loudestOf(samples) * at);
  const out = over(samples, (x) => Math.max(-ceiling, Math.min(ceiling, x)));
  return levelled(out, samples, rate);
}

/** Soft clipping: a curve that bends instead of stopping. */
export function softClip(samples, rate, { drive = 4 } = {}) {
  const peak = Math.max(1e-6, loudestOf(samples));
  const out = over(samples, (x) => Math.tanh((x / peak) * drive) * peak);
  return levelled(out, samples, rate);
}

/**
 * Quantising: every sample rounded to the nearest step of a ladder.
 *
 * The step is 2^(1-b) for b bits over a signal that runs from -1 to 1, which
 * is the usual definition and the one that makes the usual SNR formula come
 * out: 6.02b + 1.76 dB. `snrOf` below measures whether it does.
 */
export function crushBits(samples, { bits = 8, dither = false } = {}) {
  const steps = 2 ** (bits - 1);
  const step = 1 / steps;

  return over(samples, (x) => {
    // Triangular dither: two rectangular draws added, which is what makes it
    // triangular and what takes the quantisation error off the signal. It
    // costs 4.77 dB of noise floor and buys a floor that hisses instead of
    // one that follows the music - see the table in `snrOf`.
    const noise = dither ? (Math.random() - Math.random()) * step : 0;
    return Math.round((x + noise) * steps) / steps;
  });
}

/**
 * Sample and hold: each sample kept for a while, which is a cheap converter.
 *
 * Deliberately without a filter in front of it. Decimating without one folds
 * everything above half the new rate back down into the audible band, and
 * that folding is the sound: it is why a crushed hi-hat goes sour rather than
 * just dull. A version with an anti-aliasing filter would be a low-pass with
 * extra steps.
 */
export function holdFor(samples, { hold = 8 } = {}) {
  const every = Math.max(1, Math.round(hold));
  let held = 0;
  return over(samples, (x, i) => {
    if (i % every === 0) held = x;
    return held;
  });
}

/**
 * Mains hum: a tone at the mains frequency, with its odd harmonics.
 *
 * Odd ones because the shape a transformer leaks is nearer a square than a
 * sine, and because a pure sine at 50 Hz is easy to miss on a small speaker
 * where the third at 150 is not.
 */
export function addHum(samples, rate, { hz = 50, at = -32, partials = 3 } = {}) {
  const level = 10 ** (at / 20) * Math.max(1e-6, loudestOf(samples));
  return over(samples, (x, i) => {
    let hum = 0;
    for (let p = 0; p < partials; p += 1) {
      const n = p * 2 + 1;
      hum += Math.sin((2 * Math.PI * hz * n * i) / rate) / n;
    }
    return x + hum * level;
  });
}

/**
 * A click: one sample's worth of discontinuity, which is a bad edit.
 *
 * Full scale and one sample long, because that is what a dropped sample
 * sounds like and because anything gentler is a thump rather than a click.
 * `at` is in seconds, so a round can ask where it was.
 */
export function addClick(samples, rate, { at = 1.2, size = 1 } = {}) {
  const where = Math.round(at * rate);
  const out = Float32Array.from(samples);
  if (where >= 0 && where < out.length) out[where] = Math.sign(out[where] || 1) * size;
  return out;
}

/**
 * Band-limiting: no bottom and no top, which is a codec or a telephone.
 *
 * Two one-pole filters each way, run forwards only. Not a good filter and
 * not meant to be: what is being asked is whether somebody can hear that the
 * ends are gone, and a steeper one would only make that easier.
 */
export function bandLimit(samples, rate, { from = 300, to = 3400 } = {}) {
  // Level-matched at the end, like the two clippers: taking the ends off a
  // signal takes energy with them, and a drill answered by "that one got
  // quieter" is a drill about a fader.
  const high = Math.exp((-2 * Math.PI * from) / rate);
  const low = Math.exp((-2 * Math.PI * to) / rate);

  let lowPassed = 0;
  let lowPassedAgain = 0;
  let last = 0;
  let highPassed = 0;

  const out = over(samples, (x) => {
    lowPassed = x * (1 - low) + lowPassed * low;
    lowPassedAgain = lowPassed * (1 - low) + lowPassedAgain * low;
    highPassed = high * (highPassed + lowPassedAgain - last);
    last = lowPassedAgain;
    return highPassed;
  });
  return levelled(out, samples, rate);
}

/**
 * Back to the loudness it came in at, so nothing here is a volume change.
 *
 * Loudness and not RMS, which is the second attempt. Matching the RMS left
 * clipping 5.5 dB down at the peak and band-limiting 4.6, because both of
 * them move energy about rather than only removing it - and a drill whose
 * answers can be told apart by how loud they are is a drill about a fader.
 * The K-weighted, gated figure is the one the rest of this app means by
 * loud, so it is the one to hold still.
 */
function levelled(out, like, rate) {
  const was = loudnessIn(like, rate);
  const now = loudnessIn(out, rate);
  if (!Number.isFinite(was) || !Number.isFinite(now)) return out;

  const by = 10 ** ((was - now) / 20);
  for (let i = 0; i < out.length; i += 1) out[i] *= by;
  return out;
}

const loudnessIn = (samples, rate) => integrated([kWeight(samples, rate)], rate).lufs;

/**
 * The seven, by id, with what each one is called and what it takes.
 *
 * `apply` is the only thing anything outside this file needs: hand it the
 * samples, the rate and whatever the round decided, and get back a spoiled
 * copy.
 */
export const DAMAGE = [
  {
    id: 'clip',
    symbol: 'Clipped',
    name: 'the tops are flat',
    apply: (samples, rate, how) => hardClip(samples, rate, how),
  },
  {
    id: 'soft',
    symbol: 'Soft clipped',
    name: 'the tops are rounded',
    apply: (samples, rate, how) => softClip(samples, rate, how),
  },
  {
    id: 'bits',
    symbol: 'Quantised',
    name: 'too few bits',
    apply: (samples, rate, how) => crushBits(samples, how),
  },
  {
    id: 'rate',
    symbol: 'Decimated',
    name: 'too few samples',
    apply: (samples, rate, how) => holdFor(samples, how),
  },
  {
    id: 'hum',
    symbol: 'Hum',
    name: 'mains, and its harmonics',
    apply: (samples, rate, how) => addHum(samples, rate, how),
  },
  {
    id: 'click',
    symbol: 'A click',
    name: 'one bad sample',
    apply: (samples, rate, how) => addClick(samples, rate, how),
  },
  {
    id: 'band',
    symbol: 'Band-limited',
    name: 'no bottom, no top',
    apply: (samples, rate, how) => bandLimit(samples, rate, how),
  },
];

export const DAMAGE_IDS = DAMAGE.map((one) => one.id);

/** One of them, by id. */
export const damageOf = (id) => DAMAGE.find((one) => one.id === id) ?? DAMAGE[0];

/** What a round offers, in the shape a picker takes. */
export const damageChoices = (ids = DAMAGE_IDS) =>
  ids.map((id) => {
    const one = damageOf(id);
    return { id: one.id, symbol: one.symbol, name: one.name };
  });

/**
 * How far above the noise a signal is, in decibels, against a clean copy.
 *
 * For quantising this is the number everybody quotes - 6.02 bits plus 1.76 -
 * and the reason to measure it rather than print the formula is that the
 * formula is about a full-scale sine and music is not one.
 *
 *     bits   6.02b + 1.76   a sine   with dither   music, normalised   as it comes
 *        8           49.9     50.0          45.2                37.0          31.8
 *       12           74.0     74.0          69.2                60.5          55.2
 *       16           98.1     98.1          93.3                84.6          79.2
 *
 * The sine column is the formula to a tenth of a decibel, which is the
 * quantiser saying it is a quantiser. The dither column is 4.8 below it,
 * against the 4.77 that triangular dither is supposed to cost. And then the
 * music: thirteen decibels worse than the sine even after normalising, which
 * is the crest factor - a loop peaks where a sine does and spends most of its
 * time a long way below. The loop as it comes peaks at 0.54, and those six
 * decibels of headroom come off the top as well.
 *
 * So `bitsFrom` is only honest about a sine, and that is what it is for.
 */
export function snrOf(clean, spoiled) {
  let signal = 0;
  let noise = 0;
  const n = Math.min(clean.length, spoiled.length);
  for (let i = 0; i < n; i += 1) {
    signal += clean[i] * clean[i];
    const off = spoiled[i] - clean[i];
    noise += off * off;
  }
  if (noise <= 0) return Infinity;
  return 10 * Math.log10(Math.max(signal, 1e-30) / noise);
}

/** The bit depth a signal-to-noise ratio implies, which is the formula back. */
export const bitsFrom = (snr) => (snr - 1.76) / 6.02;
