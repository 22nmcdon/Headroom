// Moving a recording's pitch without moving its length.
//
// `lib/pitch.js` already shifts pitch, and this is not a replacement for it.
// That one runs live, a sample at a time, inside a worklet, and its own file
// says what it is: two heads reading a delay line at different rates, whose
// output is never heard on its own. The reverb sends it back into a room and
// the imager buries it in the side of a pair. At the ratios those two use -
// nine cents, twenty-five cents - it is fine.
//
// A sampler is the case where a shifter is heard on its own, at an octave,
// with nothing to hide behind. Measured, on a one-second note at 220 Hz, as
// everything that is not a harmonic of the target against everything that
// is, and as what a pitch detector reads back off the result:
//
//     interval        the live shifter        this          resampling
//                     junk      at       junk      at     junk      at   length
//     down an octave  -9.2 dB   110    -30.1 dB   110    -34.6    110    2.00 s
//     down a fifth   -21.0      147    -31.6      147    -39.6    147    1.50
//     down a tone    -35.1      196    -32.6      196    -40.4    196    1.12
//     unchanged      -40.8      220    -40.7      220    -40.8    220    1.00
//     up a tone      -35.4      247    -30.5      247    -36.3    247    0.89
//     up a fifth      -8.8      329    -29.9      330    -34.2    330    0.67
//     up an octave    +1.8      440    -30.9      440    -37.9    440    0.50
//
// Read the first column from the middle outwards. It is clean near unity and
// falls apart at the ends, because the two heads lap each other at a rate
// proportional to how far the ratio is from one and the lapping is a comb.
// At an octave up it makes more junk than signal.
//
// This one sits about five decibels behind resampling at every interval and
// holds the length, which is the whole trade. The last column is what
// resampling costs: a sample is twice as long an octave down and half as
// long an octave up, and for a one-shot that is the correct behaviour and
// for a sustained note it is not.
//
// ## How it works, and the wrong turn on the way
//
// Pitch-synchronous overlap-add, as a time stretch followed by a resample.
// Stretch by the ratio with the pitch held - grains a period long, laid down
// a period apart, taken from wherever in the recording that moment maps to -
// and then resample by the same ratio, which moves the pitch and puts the
// length back where it started.
//
// The first version did it in one step: lay the grains down at the period
// the NEW pitch wants, taking each from the nearest period boundary of the
// old one. Upwards that works and is the textbook move. Downwards it does
// nothing at all - and the measurement that was supposed to catch it said
// -40.7 dB, better than any other row in the table.
//
// It said that because the metric was wrong, not because the shift was
// right. Everything-not-a-harmonic credited six harmonics of the target, so
// an unshifted 220 Hz note measured against a target of 110 Hz scored
// beautifully: 220 is the second harmonic of 110. Asking the pitch detector
// what the output was actually at is what found it - 220 Hz, when 110 had
// been asked for. A measurement that cannot fail is not a measurement, and
// a spectral distance that credits the input as a correct output is one of
// those.
//
// ## What it is not good at
//
// One period for the whole recording, so a note that slides is a note whose
// grains stop landing on its periods. Measured on a note drifting 40 cents
// over a second the junk figure is about -11 dB, but so is the figure for
// the same recording untouched, because a note that is not at one frequency
// has no harmonics for the measurement to credit. The honest statement is
// that the measurement cannot separate the method from the material there,
// not that either number is a verdict.
//
// Polyphony it cannot do, and that is not a tuning problem: a chord has no
// one period to cut grains on. Nor can it help a drum, which has no period
// either. Resampling stays on the other setting for both, and for every
// one-shot where getting shorter as it goes up is the point.
//
// And it needs to be told the truth about the period, which resampling does
// not. Resampling shifts by the interval between the note and the root, so
// a root that is wrong moves everything by the same amount and a player
// transposes around it without ever finding out. This cuts grains on the
// period the root names, so a wrong root is grains landing at arbitrary
// phases of the waveform. Measured through the sampler's own stage, with a
// root a fifth out and an octave down asked for: resampling came out 0 cents
// from the octave, this came out 938 - near enough a whole octave wrong.
//
// Which is the other reason `lib/root.js` exists, and why the button that
// uses it sits beside the picker this depends on.

/**
 * How many periods long a grain is.
 *
 * Two, which is the usual choice and the one that makes a raised cosine sum
 * to something near flat when the grains are laid a period apart. One is too
 * short to carry the waveform's own shape; four smears anything that moves.
 */
export const GRAIN_PERIODS = 2;

/**
 * The range of ratios this will take, as a multiple of the pitch.
 *
 * Two octaves either way, where it still measures around -30 dB: 0.25 reads
 * 55.1 Hz against the 55.0 asked for, and 4 reads 880.1 against 880.0. Past
 * that a grain is either repeated so often that the recording is a drone or
 * skipped so often that it is a stutter, and the sampler falls back to
 * resampling rather than refusing to make a sound.
 */
export const PSOLA_RANGE = [0.25, 4];

/** Whether a ratio is one this can be asked for. */
export const canHoldLength = (ratio) =>
  Number.isFinite(ratio) && ratio >= PSOLA_RANGE[0] && ratio <= PSOLA_RANGE[1];

/**
 * The recording, longer or shorter, at the pitch it came in at.
 *
 * `by` is the factor the length is multiplied by, and `period` is in samples
 * - hand it `rate / hz` for the note the recording sounds at. Grains go down
 * a period apart, which is what keeps the pitch where it was; which grain
 * goes down is decided by where that moment maps back to in the input, so a
 * stretch repeats grains and a squeeze skips them.
 *
 * Exported because it is the half of this that is worth having on its own:
 * a sampler that could hold a sample to the length of the note it is given,
 * whatever pitch it is at, would use this and not the function below.
 */
export function stretchTo(samples, by = 1, period = 0) {
  // Nothing in gives nothing out, rather than one sample of it: every
  // caller here is handed a recording that may not have arrived yet.
  const span = samples.length ? Math.max(1, Math.round(samples.length * by)) : 0;
  const out = new Float32Array(span);
  if (!(period > 1) || !Number.isFinite(by) || by <= 0) {
    out.set(samples.subarray(0, Math.min(samples.length, span)));
    return out;
  }

  const grain = Math.max(4, Math.round(period * GRAIN_PERIODS));
  const shape = new Float32Array(grain);
  for (let i = 0; i < grain; i += 1) {
    shape[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (grain - 1));
  }
  const middle = Math.round(grain / 2);

  for (let at = 0; at < span; at += period) {
    // Snapped to the input's own period grid, which is what keeps successive
    // grains in phase with each other. Taken from wherever they happened to
    // land, they would cancel each other's harmonics as often as reinforce
    // them, and the output would be the note with a tremolo on it.
    const takeFrom = Math.round(Math.round((at / by) / period) * period) - middle;
    const putAt = Math.round(at) - middle;

    const first = Math.max(0, Math.max(-takeFrom, -putAt));
    const last = Math.min(grain, Math.min(samples.length - takeFrom, span - putAt));
    for (let i = first; i < last; i += 1) {
      out[putAt + i] += samples[takeFrom + i] * shape[i];
    }
  }

  return out;
}

/**
 * The recording at a new pitch, for exactly as long as it was.
 *
 * `ratio` is what to multiply the pitch by - 2 for an octave up, 0.5 for an
 * octave down - and `period` is the recording's own, in samples.
 *
 * Stretch by the ratio, then read back at the ratio. The second step is
 * ordinary resampling and does both of the things resampling does: it moves
 * the pitch by the ratio and divides the length by it, which is why the
 * first step multiplied the length by the same number.
 *
 * A ratio of one is not a special case and does not need to be: grains laid
 * down at the period they were cut at reassemble the recording, and measured,
 * that round trip reads -40.7 dB of junk against the recording's own -40.8.
 */
export function holdLength(samples, ratio = 1, period = 0) {
  const out = new Float32Array(samples.length);
  if (!(period > 1) || !Number.isFinite(ratio) || ratio <= 0) {
    out.set(samples);
    return out;
  }

  const longer = stretchTo(samples, ratio, period);
  for (let i = 0; i < out.length; i += 1) {
    const at = i * ratio;
    const whole = Math.floor(at);
    const frac = at - whole;
    const a = longer[whole] ?? 0;
    const b = longer[whole + 1] ?? 0;
    out[i] = a * (1 - frac) + b * frac;
  }
  return out;
}
