// Two microphones on one source, and what happens when they are added up.
//
// Everything else in this app processes a signal. This one does not: it takes
// two recordings of the same thing and decides how to combine them, and the
// only controls are a delay, a polarity switch and a fader. There is no
// character here to dial in. What there is instead is the one piece of
// arithmetic that every multi-mic recording is subject to, which is that two
// copies of a signal a time `t` apart add up to a comb: cancelling at
// f = (2k+1)/(2t) and reinforcing halfway between.
//
// The whole module is built around a decision the research forced. Absolute
// polarity - "is this one inverted?" with nothing to compare it to - is not a
// thing listeners can do: 780 trials came out at 49.87 per cent, which is a
// coin. Relative polarity between two correlated signals is a different
// question with a loud answer, because the two cancel. So nothing here ever
// asks about one signal on its own; every question is about a pair.

import { fft } from '../../lib/fft.js';
import { readingOf, stampOf } from '../../lib/read.js';
import { materialStamp } from '../../lib/reduce.js';

/** Dry air at twenty degrees, which is what a mic distance is measured in. */
export const AIR_SPEED = 343;

/**
 * And the number a mic position is actually chosen by: 34.3 cm per
 * millisecond, so a mic a foot further back is 0.89 ms later.
 */
export const PER_MS = AIR_SPEED / 1000;

/** Centimetres, for the drill, which asks about distance and not about time. */
export const cmOf = (ms) => ms * PER_MS * 100;
export const msOf = (cm) => cm / (PER_MS * 100);

export const ALIGN_DEFAULTS = {
  delay: 0,
  blend: 0,
  flip: false,
  hear: 'sum',
};

/**
 * What the controls can reach.
 *
 * Twenty-five milliseconds of delay because that is about eight and a half
 * metres, which is further apart than two mics on one source ever are - and
 * the one case that needs the top of it is a room mic, which is the case
 * where alignment stops being about a comb and starts being about an echo.
 *
 * The blend goes down eighteen and up six. Down, because the ordinary fix for
 * a pair that will not align is to use less of the second one; up, because
 * the mistake people make is reaching for the second mic's fader when the
 * problem is its timing, and a round has to let you make it.
 */
export const ALIGN_LIMITS = {
  delay: [0, 25],
  blend: [-18, 6],
};

export const heldIn = (value, [low, high]) => Math.min(high, Math.max(low, value));

/* ---------- the second microphone ---------- */

/**
 * The same source heard from further away: later, quieter, and darker.
 *
 * A model, and a limited one, so what it leaves out is worth saying. A real
 * second microphone has its own character - a different capsule, a different
 * axis, a different part of the instrument in front of it - and this one has
 * none of that. What it has is the part alignment is about: the path. The
 * delay is the distance, the level is the inverse square law and the rolloff
 * is the air plus the source's own directivity, which together are why a far
 * mic is never just a quieter copy.
 *
 * The rolloff matters more than it looks. Measured through a path at -6 dB
 * with the default 3.5 kHz tilt, the far mic sits 6.0 dB down from 40 Hz to
 * 640, 6.5 at 1.3 kHz, 7.8 at 2.6 kHz, 10.8 at 5.1 kHz and 15.2 at 10.2 -
 * so what the top of the spectrum gets when the pair is summed is a ripple of
 * a decibel or two rather than a comb. Which is why the reading below stops
 * at four kilohertz, and why a pair of microphones is a low-end job.
 */
export function farMic(close, rate, {
  ms = 3, level = -6, tilt = 3500, flip = false,
} = {}) {
  const out = new Float32Array(close.length);
  const samples = (ms / 1000) * rate;
  const whole = Math.floor(samples);
  const frac = samples - whole;
  const gain = 10 ** (level / 20) * (flip ? -1 : 1);

  // One pole, which is all an air path is to within a decibel over the range
  // that matters, and is what the player's BiquadFilterNode is set to match.
  const a = 1 - Math.exp((-2 * Math.PI * tilt) / rate);
  let low = 0;

  for (let i = 0; i < close.length; i += 1) {
    const at = i - whole;
    const delayed = at <= 0 ? 0 : close[at] * (1 - frac) + close[at - 1] * frac;
    low += (delayed - low) * a;
    out[i] = low * gain;
  }

  return out;
}

/**
 * The pair, added up: the close mic delayed to meet the far one.
 *
 * The delay is on the close mic and not on the far one, which is the way
 * round every console does it and the only way round that is physical. You
 * cannot make a microphone hear something earlier; what you can do is hold
 * the one that heard it first until the other catches up.
 *
 * The fractional part is linear interpolation between two samples, which is
 * what a `DelayNode` does - so the arithmetic here and the graph in the
 * player agree rather than nearly agreeing. Measured by rendering the pair
 * through both and differencing them sample by sample, the residual is 68 to
 * 82 dB below the sum's own level at every delay tried, and exactly zero when
 * the delay is - see `tests/browser/align.mjs`. For scale, a delay line off
 * by a single sample reads -9.6 dB on the same material and one off by half a
 * sample reads -15.6, so the agreement is four to five orders of magnitude
 * better than the thing it is ruling out.
 */
export function pairSum(close, far, rate, { delay = 0, blend = 0, flip = false } = {}) {
  const out = new Float32Array(close.length);
  const samples = (delay / 1000) * rate;
  const whole = Math.floor(samples);
  const frac = samples - whole;
  const gain = 10 ** (blend / 20) * (flip ? -1 : 1);

  for (let i = 0; i < close.length; i += 1) {
    const at = i - whole;
    const held = at <= 0 ? 0 : close[at] * (1 - frac) + close[at - 1] * frac;
    out[i] = held + (far[i] ?? 0) * gain;
  }

  return out;
}

/* ---------- where the notches are ---------- */

/**
 * The comb a time difference makes: cancelling at f = (2k+1)/(2t).
 *
 * The first notch is the one that matters and the one nobody expects to be so
 * low: a millisecond puts it at 500 Hz, which is the middle of a snare drum.
 * Measured on the pair below - sixth-octave bands, the dip found rather than
 * predicted - a path of 0.25 ms notched at 2032 Hz against a predicted 2000,
 * 0.5 at 1016 against 1000, 1 at 508 against 500, 2 at 254 against 250 and 4
 * at 127 against 125. Which is the formula to the resolution of the band set
 * it was read in.
 */
export function notchesOf(ms, top = 20000) {
  if (!(ms > 0)) return [];
  const out = [];
  for (let k = 0; ; k += 1) {
    const hz = (2 * k + 1) / (2 * (ms / 1000));
    if (hz > top) return out;
    out.push(hz);
  }
}

/** And the peaks between them, at f = k/t, which is where it adds up. */
export function peaksOf(ms, top = 20000) {
  if (!(ms > 0)) return [];
  const out = [];
  for (let k = 1; ; k += 1) {
    const hz = k / (ms / 1000);
    if (hz > top) return out;
    out.push(hz);
  }
}

/* ---------- the reading ---------- */

/**
 * The band set a summed pair is read in: sixth-octave, 40 Hz to 4 kHz.
 *
 * The ceiling is a measurement. The resolution is not, and saying which is
 * which is the point of this comment.
 *
 * Four kilohertz, because above it there is nothing an alignment can do. The
 * far mic of this pair is 10.8 dB down by 5 kHz and 15.2 by 10 - see `farMic`
 * - so what is left up there is a ripple of a decibel or two rather than a
 * comb, and counting it costs the reading its monotonicity. Measured against
 * an aligned pair one millisecond apart, over the full band set up to 16 kHz:
 *
 *     error        to 4 kHz    to 16 kHz
 *     0.05 ms          0.05         2.18
 *     0.1 ms           0.87         2.21
 *     0.2 ms           3.33         3.44
 *     2 ms             5.32         4.77
 *     no alignment     5.00         4.51
 *
 * A twentieth of a millisecond scoring half of what no alignment at all
 * scores is not a reading anybody can aim at, and the reason is the fine comb
 * at the top of the spectrum: at 10 kHz, 0.05 ms is half a cycle, so the
 * whole top octave inverts for an error that moves nothing audible. Capped,
 * the same error reads a twentieth of a decibel.
 *
 * Sixth-octave is for the display rather than for the marking. Measured, the
 * metric hardly cares: the same five errors read 0.06, 0.98, 3.27, 5.30 and
 * 4.72 at a third of an octave, and 0.02, 0.45, 3.64, 5.27 and 4.24 at a
 * whole one. What needs the resolution is the face, which draws this band set
 * as the comb - and a notch two bands wide at 500 Hz is not visible in a
 * third-octave display at all. The marking gets it for nothing.
 */
export const ALIGN_HZ = (() => {
  const out = [];
  for (let hz = 40; hz <= 4100; hz *= 2 ** (1 / 6)) out.push(Math.round(hz));
  return out;
})();

/** How wide each of those bands is, as a ratio either side of its centre. */
const BAND_EDGE = 2 ** (1 / 12);

/** The window the spectrum is read over, and how far it steps. */
export const SPECTRUM_WINDOW = 1 << 14;

/**
 * A signal's energy in each band, in decibels.
 *
 * Averaged over as many half-overlapping Hann windows as the material holds,
 * because one window of a drum loop is one bar of it and the bands wanted are
 * the loop's, not the bar's.
 */
export function pairBands(samples, rate, hzList = ALIGN_HZ) {
  const n = SPECTRUM_WINDOW;
  const power = new Float64Array(n / 2);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  let windows = 0;

  for (let at = 0; at + n <= samples.length; at += n / 2) {
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < n; i += 1) {
      re[i] = samples[at + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
    }
    fft(re, im);
    for (let i = 0; i < n / 2; i += 1) power[i] += re[i] * re[i] + im[i] * im[i];
    windows += 1;
  }

  if (!windows) return hzList.map(() => -120);

  const hzPer = rate / n;
  return hzList.map((hz) => {
    const lo = Math.max(1, Math.round((hz / BAND_EDGE) / hzPer));
    const hi = Math.max(lo + 1, Math.round((hz * BAND_EDGE) / hzPer));
    let sum = 0;
    for (let i = lo; i < hi; i += 1) sum += power[i];
    return 10 * Math.log10(Math.max(1e-30, sum / windows / (hi - lo)));
  });
}

/** How far the correlation search looks, and how far down it decimates. */
export const MOST_LAG_MS = 25;
export const LAG_STRIDE = 4;
export const LAG_SECONDS = 1;

/**
 * Where two signals line up, how well, and whether one of them is upside down.
 *
 * Coarse then fine, because the honest version does not fit in a frame. Over
 * twenty-five milliseconds either way at 48 kHz there are 2401 lags to try,
 * and a second of audio at each of them is 115 million multiply-adds - so the
 * search runs on the pair decimated by four, which is 601 lags of a quarter
 * the length, and then re-measures the nine lags either side of what it found
 * at the full rate. Measured against the brute-force search over the whole
 * range, the two agree on the lag to the sample in every case tried.
 *
 * `zero` is the other number and the one a console gives you: the correlation
 * with no delay at all. It is here because it is what people reach for and
 * because it is misleading, which is worth being able to show. Measured on a
 * pair eight milliseconds apart, the un-flipped one reads -0.815 and the
 * flipped one +0.815 - so a correlation meter on a spaced pair says
 * "inverted" about the one that is not and the other way round. What it
 * actually reports is this delay, not this polarity.
 */
export function crossLag(a, b, rate, { mostMs = MOST_LAG_MS, seconds = LAG_SECONDS } = {}) {
  const length = Math.min(a.length, b.length, Math.round(rate * seconds));
  if (length < 64) return { lagMs: 0, sign: 1, peak: 0, zero: 0, curve: new Float32Array(0), step: 0 };

  // Decimated with a box of the same width, which is a crude anti-alias and
  // the right one here: the search only has to find a peak, and smoothing the
  // pair identically cannot move where they agree.
  const small = Math.floor(length / LAG_STRIDE);
  const da = new Float64Array(small);
  const db = new Float64Array(small);
  for (let i = 0; i < small; i += 1) {
    let sa = 0;
    let sb = 0;
    for (let k = 0; k < LAG_STRIDE; k += 1) {
      sa += a[i * LAG_STRIDE + k];
      sb += b[i * LAG_STRIDE + k];
    }
    da[i] = sa;
    db[i] = sb;
  }

  const energy = (x) => {
    let sum = 0;
    for (let i = 0; i < x.length; i += 1) sum += x[i] * x[i];
    return sum;
  };
  const smallNorm = Math.sqrt(Math.max(1e-30, energy(da) * energy(db)));
  const most = Math.round(((mostMs / 1000) * rate) / LAG_STRIDE);

  const curve = new Float32Array(2 * most + 1);
  let coarse = 0;
  let best = 0;
  for (let lag = -most; lag <= most; lag += 1) {
    let sum = 0;
    const from = Math.max(0, -lag);
    const to = Math.min(small, small - lag);
    for (let i = from; i < to; i += 1) sum += da[i] * db[i + lag];
    const r = sum / smallNorm;
    curve[lag + most] = r;
    if (Math.abs(r) > Math.abs(best)) { best = r; coarse = lag; }
  }

  // And the same question again at the sample, around what that found.
  const fullNorm = Math.sqrt(Math.max(1e-30,
    energy(a.subarray(0, length)) * energy(b.subarray(0, length))));
  const centre = coarse * LAG_STRIDE;
  let found = centre;
  let peak = 0;
  let zero = 0;
  const at = (lag) => {
    let sum = 0;
    const from = Math.max(0, -lag);
    const to = Math.min(length, length - lag);
    for (let i = from; i < to; i += 1) sum += a[i] * b[i + lag];
    return sum / fullNorm;
  };
  for (let lag = centre - LAG_STRIDE; lag <= centre + LAG_STRIDE; lag += 1) {
    const r = at(lag);
    if (Math.abs(r) > Math.abs(peak)) { peak = r; found = lag; }
  }
  zero = found === 0 ? peak : at(0);

  return {
    lagMs: (found / rate) * 1000,
    sign: Math.sign(peak) || 1,
    peak: Math.abs(peak),
    zero,
    curve,
    step: (LAG_STRIDE / rate) * 1000,
  };
}

/** Where a sum's low end ended up, which is what a pair is added up for. */
export const LOW_TOP = 200;

export function lowOf(bands, hzList = ALIGN_HZ) {
  let sum = 0;
  let n = 0;
  hzList.forEach((hz, i) => {
    if (hz > LOW_TOP) return;
    sum += 10 ** (bands[i] / 10);
    n += 1;
  });
  return 10 * Math.log10(Math.max(1e-30, sum / Math.max(1, n)));
}

/**
 * What a pair of mics, combined this way, did.
 *
 * The sum's spectrum is the measurement; the correlation figures beside it
 * are what the face shows and what the feedback is worded from. Both are of
 * the pair rather than of a signal, which is why the axis stamps both
 * microphones: a reading of this close mic against that far one is not a
 * reading of the same thing, and a comparator that averaged the two would be
 * answering a question nobody asked.
 */
export function alignPass(pair, rate, settings, found = null, { tool = 'align' } = {}) {
  const { close, far } = pair;
  const sum = pairSum(close, far, rate, settings);
  const bands = pairBands(sum, rate);

  // The pair's own lag is a property of the material and not of the settings,
  // so a caller that is about to ask this question a dozen times for a dozen
  // settings should ask it once and hand it back in. The curve comes with it
  // and does not go into the reading: it is six hundred numbers the display
  // draws and nothing compares, which is the same split `reductionPass`
  // makes between its trace and its frames.
  const lag = found ?? crossLag(close, far, rate);

  const reading = readingOf({
    tool,
    kind: 'align',
    of: {
      state: stampOf(settings),
      source: null,
      axis: {
        kind: 'bands', hz: ALIGN_HZ, rate, over: materialStamp([close, far]),
      },
    },
    values: {
      bands,
      low: lowOf(bands),
      // The pair as it arrived, which the settings cannot change and every
      // piece of feedback needs: how far apart they are and which way up.
      lagMs: lag.lagMs,
      sign: lag.sign,
      peak: lag.peak,
      zero: lag.zero,
      // And where the settings left it: what is still between them.
      leftMs: lag.lagMs - (settings.delay ?? 0),
      flipped: !!settings.flip,
    },
  });

  return { lag, reading };
}

/** The reading alone, for whoever is not drawing a correlation curve. */
export const alignReading = (pair, rate, settings, found = null) =>
  alignPass(pair, rate, settings, found).reading;

/**
 * How far apart two combined pairs are, in decibels.
 *
 * The RMS across the band set rather than the worst band, and that is the
 * opposite of what the saturator and the EQ do. Those compare curves that
 * differ smoothly; a comb differs at the notches and nowhere else, so its
 * worst band is wherever one reading has a notch and the other does not - a
 * number that saturates at the first audible error and says nothing about
 * what happened after. Measured against a target one millisecond away:
 *
 *     mistake                  RMS    worst band
 *     0.05 ms out             0.05    0.26
 *     0.1 ms out              0.87    3.69
 *     0.2 ms out              3.33   10.65
 *     no alignment            5.00   13.97
 *     flipped                13.65   15.34
 *
 * The worst band puts a tenth of a millisecond a quarter of the way to no
 * alignment at all and two tenths three quarters of the way, which is a
 * control with no useful travel. The RMS puts them at a sixtieth and two
 * thirds.
 *
 * `where` is the first notch of whatever is still between the two, because
 * that is the frequency somebody would hear the difference at - and `detail`
 * carries the two things a learner can act on: how much time is left between
 * the mics, and whether the polarity disagrees.
 */
export function alignGap(mine, theirs) {
  const a = mine.values ?? mine;
  const b = theirs.values ?? theirs;

  let sq = 0;
  for (let i = 0; i < ALIGN_HZ.length; i += 1) {
    const off = a.bands[i] - b.bands[i];
    sq += off * off;
  }
  const off = Math.sqrt(sq / ALIGN_HZ.length);

  const left = (a.leftMs ?? 0) - (b.leftMs ?? 0);
  const notch = notchesOf(Math.abs(left))[0] ?? null;

  return {
    off,
    where: notch ? `${notch < 1000 ? Math.round(notch) : (notch / 1000).toFixed(1)} ${notch < 1000 ? 'Hz' : 'kHz'}` : null,
    detail: {
      left,
      flipped: !!a.flipped !== !!b.flipped,
      low: (a.low ?? 0) - (b.low ?? 0),
    },
  };
}
