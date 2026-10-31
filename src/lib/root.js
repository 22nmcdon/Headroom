// What note a recording already sounds at.
//
// The sampler has to be told this, because playing a sample back at the right
// pitch means knowing what pitch it is at now. Until this file it was told by
// hand, from a picker defaulting to middle C, which is fine for somebody who
// knows what they hummed and useless for everybody else.
//
// ## Why this and not the FFT that is already here
//
// `lib/fft.js` is right there and the analysis view runs it over everything,
// so the obvious thing is to take the biggest bin. The obvious thing does not
// work on the material this is for. Two reasons, and they are different:
//
// The first is resolution. A bin is rate/N wide, so at 48 kHz a 4096-point
// transform has bins 11.7 Hz apart - which at the bottom of the range here
// (46 Hz, F#1) is more than four semitones. Interpolating between bins helps
// and a longer window helps, but a window long enough to resolve a low note
// is long enough that the note has moved.
//
// The second is that the biggest bin is often not the fundamental. A plucked
// string, a hummed line through a laptop microphone, anything through a small
// speaker: the second or third harmonic is routinely the loudest thing in the
// spectrum, and the fundamental can be missing outright. An ear hears the
// pitch anyway, because pitch is about the pattern and not about which
// partial is loudest, and a detector that reads the biggest bin reports an
// octave or a twelfth out.
//
// So this is the time-domain method instead, which asks the question the ear
// asks: what is the shortest lag at which this signal repeats? Measured
// against the bin method on the same material, further down.
//
// ## What it is
//
// The cumulative mean normalised difference function from de Cheveigné and
// Kawahara's YIN, which is autocorrelation with the two things that make
// autocorrelation work fixed:
//
//   - A difference function rather than a product, so a loud window does not
//     outscore a quiet one and amplitude falls out of it.
//   - That difference divided by its own running mean, which is the part that
//     stops lag zero winning every time and removes the need for a decaying
//     window to hide it.
//
// Then the first dip below a threshold rather than the deepest dip, which is
// the octave fix: a signal that repeats every period also repeats every two
// periods, slightly better, and taking the best dip reports an octave low
// about as often as not. Taking the first one that is good enough is taking
// the shortest period that explains the signal, which is the pitch.

/**
 * The notes this will answer with, as MIDI numbers.
 *
 * The same five octaves either side of middle C that the sampler's own picker
 * offers, because an answer outside the picker is an answer nobody can act
 * on. 30 is F#1 at 46.25 Hz and 90 is F#6 at 1479.98 Hz.
 */
export const ROOT_RANGE = [30, 90];

/** A MIDI note as a frequency, and back. */
export const hzOfPitch = (pitch) => 440 * 2 ** ((pitch - 69) / 12);
export const pitchOfHz = (hz) => 69 + 12 * Math.log2(hz / 440);

/**
 * How good a dip has to be before it is the answer.
 *
 * YIN's paper uses 0.1; most implementations settle on 0.15. The number is
 * one minus a correlation, so 0.15 is a window that repeats itself to within
 * about 85%.
 *
 * Swept, on seven signals at a 100 ms window, as how far out the answer came
 * in cents - and the sweep is flat, which is the useful finding:
 *
 *   threshold   sine   saw   plucked   hummed   5th apart   2nd apart   noise
 *        0.05    0.0   0.0       0.0     29.5         0.0     refused   refused
 *        0.10    0.0   0.0       0.0     29.5         0.0     refused   refused
 *        0.15    0.0   0.0       0.0     29.5         0.0     refused   refused
 *        0.20    0.0   0.0       0.0     29.5         0.0     refused   refused
 *        0.25    0.0   0.0       0.0     29.5         0.0     245 Hz    refused
 *        0.35    0.0   0.0       0.0     29.5         0.0     245 Hz    refused
 *
 * Nothing moves between 0.05 and 0.20, so this is not a tuned constant: it is
 * the middle of a plateau, which is the only kind of constant worth having.
 * What picks the top of the plateau is the second-to-last column. Two saws a
 * major second apart have no period anything like short enough to be a note,
 * and at 0.25 the detector finds one anyway and calls it 245 Hz - the average
 * of the two, which is not in the recording at all. A detector that is
 * confident about a chord is worse than one that says it cannot tell.
 *
 * The fifth-apart column is not a failure. 220 and 330 Hz genuinely repeat
 * together every 110 Hz, so 110 Hz is the right answer and the detector
 * gives it at every threshold. That is what a time-domain method does that a
 * biggest-bin method cannot: it hears the period of the whole thing.
 *
 * The hummed column is 29.5 cents at every threshold because the note itself
 * drifts 30 cents over its second - see ROOT_WINDOW. It still rounds to the
 * right semitone, and reporting "A3, 30 cents sharp" about a note that slides
 * 30 cents is the true description of it.
 */
export const ROOT_THRESHOLD = 0.15;

/**
 * How long a window to look at, in seconds.
 *
 * Floored by the bottom of the range: a lag can only be measured over
 * samples that are still there after it is taken off, so a window has to
 * hold at least two periods of the lowest note to be asked about. At 46.25 Hz
 * that is 43 ms. A hundred gives four and a half periods at the bottom and a
 * hundred at the top.
 *
 * Longer is not better, and this is the one place where measuring changed the
 * answer rather than confirming it. Swept on a note that drifts 30 cents over
 * a second, which is what a hummed one does:
 *
 *     window      read       out by
 *      25 ms    220.49 Hz     +3.9 cents
 *      50 ms    223.15       +24.6
 *     100 ms    223.78       +29.5
 *     250 ms    221.92       +15.0
 *     500 ms    221.36       +10.7
 *     900 ms    221.80       +14.1
 *
 * The short window is the accurate one, because it is looking at less of a
 * note that is moving - and the long ones are not converging on anything, they
 * are averaging different stretches of a slide. On a steady saw at 110 Hz
 * every window from 25 ms to 500 reads 0.0 cents out, so none of this is
 * about the arithmetic.
 *
 * It is 100 ms anyway, because 25 cannot hold a low note at all and the
 * answer is rounded to a semitone: 29.5 cents of drift error still lands on
 * A3, and what it costs is the cents figure beside the name, which is
 * describing a note that really is sliding.
 */
export const ROOT_WINDOW = 0.1;

/**
 * Where in the recording to look.
 *
 * At the loudest 100 ms, found by a coarse sweep. Not the start, which on
 * anything recorded through a microphone is the room before the player got to
 * it, and not the middle, which on a one-shot is the tail. The loudest part
 * of a recording is the part that has the note in it.
 *
 * The sweep is in steps of a quarter window rather than per sample, because
 * this runs on a click and the answer does not change: what is being looked
 * for is which part of a recording has the signal in it, and that is not a
 * question with a sample-accurate answer.
 */
export function loudestWindow(samples, rate, seconds = ROOT_WINDOW) {
  const span = Math.min(samples.length, Math.max(2, Math.round(seconds * rate)));
  const step = Math.max(1, Math.round(span / 4));

  let best = 0;
  let bestAt = 0;
  for (let from = 0; from + span <= samples.length; from += step) {
    let sum = 0;
    for (let i = from; i < from + span; i += 1) sum += samples[i] * samples[i];
    if (sum > best) {
      best = sum;
      bestAt = from;
    }
  }
  return { from: bestAt, span, energy: Math.sqrt(best / span) };
}

/**
 * The cumulative mean normalised difference, for every lag in range.
 *
 * d(t) is the squared difference between the window and itself t samples
 * later; d'(t) is d(t) divided by the running mean of every d up to t. The
 * second step is the whole trick: d(0) is nought by construction, so a bare
 * difference function always has its best score at no lag at all, and
 * dividing by the running mean sends d'(0) to one instead.
 *
 * Exported because the test reads it directly: a dip that is in the curve but
 * not in the answer is a thresholding bug, and one that is in neither is a
 * different bug, and a function that only returned its verdict could not tell
 * them apart.
 */
export function differenceCurve(samples, rate, { from = 0, span = samples.length } = {}) {
  const shortest = Math.max(2, Math.floor(rate / hzOfPitch(ROOT_RANGE[1])));
  const longest = Math.min(Math.floor(span / 2), Math.ceil(rate / hzOfPitch(ROOT_RANGE[0])));

  const curve = new Float64Array(longest + 1);
  let running = 0;
  curve[0] = 1;

  for (let lag = 1; lag <= longest; lag += 1) {
    let sum = 0;
    for (let i = 0; i + lag < span; i += 1) {
      const off = samples[from + i] - samples[from + i + lag];
      sum += off * off;
    }
    running += sum;
    // The running mean over the lags so far, which is what makes the curve
    // start at one and dip rather than start at nought and rise.
    curve[lag] = running > 0 ? (sum * lag) / running : 1;
  }

  return { curve, shortest, longest };
}

/**
 * Where a dip really sits, between the two samples either side of it.
 *
 * A lag is a whole number of samples, and at the top of the range that is a
 * coarse grid: at 1480 Hz a period is 32 samples at 48 kHz, so the nearest
 * whole lag is a fifth of a semitone away from the right one. Fitting a
 * parabola through the three points around the dip costs nothing and takes
 * most of that off. Measured on sines, the whole lag against the refined one:
 *
 *     1318 Hz    +19.4 cents    +0.36
 *      880 Hz    -14.4          +0.10
 *      440 Hz     +1.4          +0.07
 *      110 Hz     +1.4           0.00
 *
 * It matters at the top and nowhere else, which is what the grid argument
 * predicts: the lower the note, the more samples a period has and the finer
 * the grid of lags already is.
 */
function refine(curve, at) {
  const left = curve[at - 1];
  const here = curve[at];
  const right = curve[at + 1];
  if (!Number.isFinite(left) || !Number.isFinite(right)) return at;

  const bottom = left + right - 2 * here;
  if (bottom <= 0) return at;
  return at + (left - right) / (2 * bottom);
}

/**
 * What note a recording sounds at.
 *
 * Returns the pitch rounded to the nearest semitone, the frequency it was
 * rounded from, how far off that frequency is from the note in cents, and
 * how sure it is - one minus the dip, so a perfect repeat is 1 and the
 * threshold above is 0.85.
 *
 * `found` is false when nothing in range repeated well enough, which is the
 * honest answer for a chord, for noise, and for silence. A detector that
 * always answers is a detector whose answer means nothing.
 */
export function rootOf(samples, rate) {
  const quiet = { found: false, pitch: null, hz: null, cents: 0, sure: 0, why: 'nothing to listen to' };
  if (!samples || samples.length < rate * 0.02) return quiet;

  const { from, span, energy } = loudestWindow(samples, rate);
  // Only "is there anything here at all", which is a lower bar than it looks:
  // whether what is here has a pitch is the threshold's job, and it does it
  // well enough that this one does not have to help. Measured, hiss at -10 dB
  // is refused at every floor from 1e-3 down to 3e-5, so a low floor costs
  // nothing in false answers and buys quiet takes.
  //
  //     level    1e-3      3e-4      1e-4      3e-5
  //     -40 dB     ok        ok        ok        ok
  //     -55        no        ok        ok        ok
  //     -70        no        no        ok        ok
  //     -80        no        no        no        ok
  //
  // 1e-4 is about -69 dBFS of window RMS. It reads a note recorded at -70 and
  // refuses digital silence and a track carrying nothing but 16-bit dither,
  // which are the two things this is actually for. 1e-3, where this started,
  // threw away a readable note at -55.
  if (!(energy > 1e-4)) return quiet;

  const { curve, shortest, longest } = differenceCurve(samples, rate, { from, span });

  // The first dip below the threshold, not the deepest one - see the top of
  // this file. Within a dip, walk down to its own bottom before taking it,
  // or the answer is the lag where the curve crossed rather than where it
  // settled, which reads a few cents sharp every time.
  let at = 0;
  for (let lag = shortest; lag <= longest; lag += 1) {
    if (curve[lag] >= ROOT_THRESHOLD) continue;
    while (lag + 1 <= longest && curve[lag + 1] < curve[lag]) lag += 1;
    at = lag;
    break;
  }

  if (!at) {
    return {
      found: false, pitch: null, hz: null, cents: 0, sure: 0,
      why: 'nothing in it repeats - a chord, or noise, or two things at once',
    };
  }

  const hz = rate / refine(curve, at);
  const exact = pitchOfHz(hz);
  const pitch = Math.max(ROOT_RANGE[0], Math.min(ROOT_RANGE[1], Math.round(exact)));

  return {
    found: true,
    pitch,
    hz,
    // How far the recording is from the note it was rounded to, which is
    // worth saying: 40 cents out is somebody singing flat, and knowing that
    // is different from knowing which key to put it in.
    cents: Math.round((exact - pitch) * 100),
    sure: Math.max(0, Math.min(1, 1 - curve[at])),
    why: null,
  };
}

/**
 * The same answer in a sentence, bar the note's own name.
 *
 * The name is not in here because `lib` may not reach into `sketch`, and
 * `pitchName` lives there with the grid that spells every other note in this
 * app - a second spelling table in lib would be the `said` field's mistake
 * one folder along. The caller has the name and puts this after it.
 *
 * The cents matter to somebody choosing a root and the confidence matters to
 * somebody deciding whether to believe it, so both are said rather than one
 * being folded into the other. Under eight cents is left out: that is inside
 * what anybody hears as in tune, and a detector that reports three cents
 * flat on a sine is reporting its own arithmetic.
 */
export function rootSaid(found) {
  if (!found.found) return found.why;

  const off = Math.abs(found.cents) >= 8
    ? `${Math.abs(found.cents)} cents ${found.cents > 0 ? 'sharp' : 'flat'}, `
    : '';
  const sure = found.sure >= 0.95 ? 'certain'
    : found.sure >= 0.9 ? 'fairly sure'
      : 'not very sure';
  return `${off}${sure}`;
}
