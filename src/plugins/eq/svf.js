// One filter, described once, for the picture and for the sound.
//
// The EQ is the only one of the six tools whose audio and whose marking have
// ever been different code: cookbook coefficients in filters.js to draw and to
// score, native BiquadFilterNodes to hear. They agree - measured, to 0.015 dB
// on every bell and shelf, because the W3C spec defines Web Audio's biquads
// with the same formulas - but they agree by hand, and everything the EQ still
// wants is on the other side of that. Shelves with a slope, six and eighteen
// decibels an octave, a width that moves with the gain, a response that does
// not squash itself flat at Nyquist: a BiquadFilterNode will do none of them.
//
// So: a state-variable filter, trapezoidal, after Zavalishin and Simper. Two
// things recommend it over another set of biquad coefficients.
//
// Its states are integrator outputs rather than past inputs and outputs, so
// moving a corner mid-signal behaves like turning a pot rather than like
// splicing tape - which is what makes a filter safe to modulate, and a dynamic
// EQ is a filter being modulated at audio rate.
//
// And one structure gives every shape from the same two states: low-pass,
// high-pass, band-pass, notch, all-pass, bell, and shelves that take a Q.
//
// What it does NOT do on its own is uncramp. A trapezoidal SVF is the bilinear
// transform wearing different clothes, so it warps near Nyquist exactly as the
// cookbook does. That is deliberate here: this file's first job is to produce
// what the EQ already produces, to the last decibel, so that swapping the
// engine underneath is a change nobody can hear. Matched responses come after,
// and come to this file.

// One thing this file can already do that the sound cannot: a shelf with a Q.
// Web Audio's shelves ignore Q and are fixed at S = 1, so until the worklet
// is actually running the audio, a shelf set anywhere but SHELF_Q draws what
// it does not play - by 0.038 dB at a Q of 0.7, measured. Nothing exposes a
// shelf Q for that reason, and tests/browser/eq-curve.mjs is what would catch
// it if something did.

/** Web Audio reads a cut's resonance in decibels; so does this app's UI. */
const qOf = (db) => 10 ** (db / 20);

/**
 * The five numbers a band becomes.
 *
 * `g` is the warped corner, `k` the damping, and `m0 m1 m2` mix the input, the
 * band-pass state and the low-pass state into whatever shape was asked for.
 * Straight out of Simper, except that the cuts take their resonance in
 * decibels because that is what Web Audio has always done and what every
 * saved sketch in this app has stored.
 */
export function svfOf({ type, frequency, gain = 0, q = 0 }, rate) {
  const w = Math.tan((Math.PI * Math.min(frequency, rate * 0.49)) / rate);
  const A = 10 ** (gain / 40);

  switch (type) {
    case 'lowpass':
      return { g: w, k: 1 / qOf(q), m0: 0, m1: 0, m2: 1 };
    case 'highpass': {
      const k = 1 / qOf(q);
      return { g: w, k, m0: 1, m1: -k, m2: -1 };
    }
    case 'bandpass':
      return { g: w, k: 1 / q, m0: 0, m1: 1, m2: 0 };
    case 'notch': {
      const k = 1 / q;
      return { g: w, k, m0: 1, m1: -k, m2: 0 };
    }
    case 'allpass': {
      const k = 1 / q;
      return { g: w, k, m0: 1, m1: -2 * k, m2: 0 };
    }
    case 'peaking': {
      const k = 1 / (q * A);
      return { g: w, k, m0: 1, m1: k * (A * A - 1), m2: 0 };
    }
    case 'lowshelf': {
      const k = 1 / q;
      return { g: w / Math.sqrt(A), k, m0: 1, m1: k * (A - 1), m2: A * A - 1 };
    }
    case 'highshelf': {
      const k = 1 / q;
      return { g: w * Math.sqrt(A), k, m0: A * A, m1: k * (1 - A) * A, m2: 1 - A * A };
    }
    default:
      return { g: w, k: 1, m0: 1, m1: 0, m2: 0 };
  }
}

/**
 * The same filter as a biquad, so one coefficient set can be drawn and heard.
 *
 * A trapezoidal SVF is the bilinear transform of the analog prototype, so it
 * has an exact biquad equivalent and there is no need for a second model to
 * draw with. Its denominator is
 *
 *     D(z) = (1 + gk + g²) + (2g² - 2)z⁻¹ + (1 - gk + g²)z⁻²
 *
 * and its three outputs are g²(1+z⁻¹)² for the low-pass, g(1 - z⁻²) for the
 * band-pass and (1-z⁻¹)² for the high-pass, all over D. Mixing them by
 * m0 m1 m2 and collecting powers of z gives what is below.
 */
export function svfBiquad({ g, k, m0, m1, m2 }) {
  const gg = g * g;
  const a0 = 1 + g * k + gg;
  const a1 = 2 * gg - 2;
  const a2 = 1 - g * k + gg;

  const b0 = m0 * a0 + m1 * g + m2 * gg;
  const b1 = m0 * a1 + 2 * m2 * gg;
  const b2 = m0 * a2 - m1 * g + m2 * gg;

  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** The two states one section carries between samples. */
export const svfState = () => ({ ic1: 0, ic2: 0 });

/**
 * One sample through one section.
 *
 * The delay-free loop solved rather than approximated, which is the whole
 * point of the structure: `a1 a2 a3` below are the solution, not a filter.
 */
export function svfTick(state, { g, k, m0, m1, m2 }, x) {
  const a1 = 1 / (1 + g * (g + k));
  const a2 = g * a1;
  const a3 = g * a2;

  const v3 = x - state.ic2;
  const v1 = a1 * state.ic1 + a2 * v3;
  const v2 = state.ic2 + a2 * state.ic1 + a3 * v3;
  state.ic1 = 2 * v1 - state.ic1;
  state.ic2 = 2 * v2 - state.ic2;

  return m0 * x + m1 * v1 + m2 * v2;
}
