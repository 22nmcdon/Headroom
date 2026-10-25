// One filter, described once, for the picture and for the sound.
//
// The EQ used to be the only one of the six tools whose audio and whose
// marking were different code: cookbook coefficients in filters.js to draw and
// to score, native BiquadFilterNodes to hear. They agreed - measured, to
// 0.015 dB on every bell and shelf, because the W3C spec defines Web Audio's
// biquads with the same formulas - but they agreed by hand, and everything the
// EQ still wanted was on the other side of that. Shelves with a slope, six and
// eighteen decibels an octave, a width that moves with the gain, a response
// that does not squash itself flat at Nyquist: a BiquadFilterNode will do none
// of them.
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
// This is now what the EQ sounds like as well as what it draws: node.js runs
// `svfRack` on the audio thread, out of this file's own source, over the
// coefficients `sectionTable` hands the drawing. tests/eq.test.js holds the
// two against each other - the rack's impulse response against the curve - and
// they agree to a ten-millionth of a decibel.
//
// What it does NOT do on its own is uncramp. A trapezoidal SVF is the bilinear
// transform wearing different clothes, so it warps near Nyquist exactly as the
// cookbook does. That was deliberate: this file's first job was to produce what
// the EQ already produced, to the last decibel, so that swapping the engine
// underneath was a change nobody could hear. Matched responses come after, and
// come to this file.
//
// Shelf Q is the first thing the swap has unlocked. Web Audio's shelves ignore
// it and are fixed at S = 1, so for as long as the sound was a
// BiquadFilterNode a shelf anywhere but SHELF_Q drew what it did not play, by
// 0.038 dB at a Q of 0.7. The rack honours it. Nothing on the face offers it
// yet, which is a face decision rather than an engine one.

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
export function svfOf({ type, frequency, gain = 0, q = 0, one = false }, rate) {
  const w = Math.tan((Math.PI * Math.min(frequency, rate * 0.49)) / rate);
  const A = 10 ** (gain / 40);

  // A real pole on its own, which is what the odd slopes are made of and
  // what a second-order structure cannot be asked to pretend to be. One
  // integrator, one state, six decibels an octave. `k` and `m2` are not read.
  if (one) {
    return type === 'highpass'
      ? { g: w, k: 0, m0: 1, m1: -1, m2: 0, one: 1 }
      : { g: w, k: 0, m0: 0, m1: 1, m2: 0, one: 1 };
  }

  switch (type) {
    case 'lowpass':
      return { g: w, k: 1 / qOf(q), m0: 0, m1: 0, m2: 1, one: 0 };
    case 'highpass': {
      const k = 1 / qOf(q);
      return { g: w, k, m0: 1, m1: -k, m2: -1, one: 0 };
    }
    case 'bandpass':
      return { g: w, k: 1 / q, m0: 0, m1: 1, m2: 0, one: 0 };
    case 'notch': {
      const k = 1 / q;
      return { g: w, k, m0: 1, m1: -k, m2: 0, one: 0 };
    }
    case 'allpass': {
      const k = 1 / q;
      return { g: w, k, m0: 1, m1: -2 * k, m2: 0, one: 0 };
    }
    case 'peaking': {
      const k = 1 / (q * A);
      return { g: w, k, m0: 1, m1: k * (A * A - 1), m2: 0, one: 0 };
    }
    case 'lowshelf': {
      const k = 1 / q;
      return { g: w / Math.sqrt(A), k, m0: 1, m1: k * (A - 1), m2: A * A - 1, one: 0 };
    }
    case 'highshelf': {
      const k = 1 / q;
      return { g: w * Math.sqrt(A), k, m0: A * A, m1: k * (1 - A) * A, m2: 1 - A * A, one: 0 };
    }
    default:
      return { g: w, k: 1, m0: 1, m1: 0, m2: 0, one: 0 };
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
export function svfBiquad({ g, k, m0, m1, m2, one = 0 }) {
  // One pole, bilinear. The integrator's own output is
  //
  //     H_lp(z) = G(1 + z^-1) / (1 + a1 z^-1),  G = g/(1+g),  a1 = (g-1)/(1+g)
  //
  // and the section returns m0 x + m1 lp, so collecting powers of z gives
  // b0 = m0 + m1 G and b1 = m0 a1 + m1 G. The second order is simply empty.
  //
  // b1 was -m0 + m1 G in the first version of this, which is right for a
  // low-pass because m0 is zero there and wrong for a high-pass by twenty
  // decibels - the corner read +0.14 dB instead of -3.01. The test that
  // compares the drawn response against the sample loop found it in a minute,
  // which is the whole reason that test exists.
  if (one) {
    const scale = g / (1 + g);
    const pole = (g - 1) / (1 + g);
    return {
      b0: m0 + m1 * scale,
      b1: m0 * pole + m1 * scale,
      b2: 0,
      a1: pole,
      a2: 0,
    };
  }

  const gg = g * g;
  const a0 = 1 + g * k + gg;
  const a1 = 2 * gg - 2;
  const a2 = 1 - g * k + gg;

  const b0 = m0 * a0 + m1 * g + m2 * gg;
  const b1 = m0 * a1 + 2 * m2 * gg;
  const b2 = m0 * a2 - m1 * g + m2 * gg;

  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/**
 * How many numbers one section takes in a table: g, k, m0, m1, m2, and
 * whether it is a single real pole rather than a pair.
 *
 * Six rather than five since the odd slopes landed. The flag could have been
 * folded into one of the other five - k is unused on a real pole, and k is
 * one over Q so it is never negative on a real section - but a table that has
 * to be decoded is a table somebody decodes wrongly.
 */
export const SECTION_WIDTH = 6;

/**
 * The two states one section carries between samples.
 *
 * A declaration rather than an arrow in a const, because this is one of the
 * functions the worklet is written out of and `Function.prototype.toString`
 * of an arrow carries no name with it - the audio thread would get the body
 * as a bare expression and nothing bound to call it.
 */
export function svfState() {
  return { ic1: 0, ic2: 0 };
}

/**
 * One sample through one section.
 *
 * The delay-free loop solved rather than approximated, which is the whole
 * point of the structure: `a1 a2 a3` below are the solution, not a filter.
 */
export function svfTick(state, { g, k, m0, m1, m2, one = 0 }, x) {
  if (one) {
    // Trapezoidal, same as the pair below and with half the state: solve the
    // one-sample loop rather than approximate it.
    const v = ((x - state.ic1) * g) / (1 + g);
    const low = v + state.ic1;
    state.ic1 = low + v;
    return m0 * x + m1 * low;
  }

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

/**
 * How long a coefficient takes to get where it was sent, in seconds.
 *
 * The same ten milliseconds the native chain used, and the same law: Web
 * Audio's `setTargetAtTime` is a one-pole approach to a target with a time
 * constant, which is exactly what the rack below does to `g k m0 m1 m2`. So a
 * knob feels the way it felt before by construction rather than by taste.
 *
 * Smoothing the coefficients rather than the settings is only safe because
 * this is an SVF. Interpolating biquad coefficients can walk the poles
 * straight out of the unit circle on the way between two stable filters; here
 * stability is `g > 0` and `k > 0`, and a straight line between two positive
 * numbers is positive the whole way.
 */
export const SVF_GLIDE = 0.01;

/**
 * Near enough to stop moving, summed over the five.
 *
 * Exported because the worklet's prelude is built from this module's values
 * rather than from a list somebody keeps up to date - the saturator learned
 * that the hard way, three families in a row.
 */
export const SVF_SETTLED = 1e-6;

/**
 * A rack of sections in series, with the coefficients smoothed.
 *
 * This is the whole of the EQ's audio path, and it is here rather than in
 * node.js for the same reason the saturator's core is in shape.js: node.js
 * makes Web Audio nodes, and the thing that has to run identically on the
 * audio thread, on the main thread and in a test cannot know what a node is.
 *
 * `slots` is sections, not bands - six bands of four is twenty-four, and a
 * section a band's slope does not need is handed a peak with no gain, which
 * is exactly nothing. States are kept per channel and nothing is shared
 * between them: an EQ that summed its channels to decide anything would be a
 * stereo effect.
 *
 * Twenty-four sections running on both channels, all six bands lifted, costs
 * 1.5% of one core - and 1.7% with every section of all six gliding at once,
 * which is a state nothing can actually get into. Measured over ten seconds
 * of stereo at 48 kHz. Native biquads would be cheaper and they cannot do any
 * of the things this was swapped in for.
 */
export function svfRack(rate, slots, channels = 2) {
  const flat = () => ({ g: 0, k: 1, m0: 1, m1: 0, m2: 0, one: 0 });
  const now = Array.from({ length: slots }, flat);
  const target = Array.from({ length: slots }, flat);
  const moving = new Uint8Array(slots);
  const states = Array.from({ length: channels }, () =>
    Array.from({ length: slots }, svfState));

  // One pole, per sample, at the time constant above.
  const rise = 1 - Math.exp(-1 / (rate * SVF_GLIDE));

  return {
    /**
     * Where the sections are going: five numbers each, laid out flat.
     *
     * Flat because this crosses a port. `immediately` is for a render rather
     * than a performance - an offline render of a track with an EQ on it
     * starts at its first sample, and ten milliseconds of a filter arriving
     * is ten milliseconds of a measurement being wrong.
     */
    tune(table, immediately = false) {
      for (let s = 0; s < slots; s += 1) {
        const t = target[s];
        const i = s * SECTION_WIDTH;
        t.g = table[i]; t.k = table[i + 1];
        t.m0 = table[i + 2]; t.m1 = table[i + 3]; t.m2 = table[i + 4];
        // Not glided. A section is either a pair of poles or a single one and
        // there is nothing in between to be half way to, so what a change of
        // order needs is for the five numbers to glide to where the new shape
        // wants them while the shape itself changes at once. Which is also
        // what a change of band type has always done.
        const was = now[s].one;
        t.one = table[i + 5];
        now[s].one = t.one;
        if (immediately || was !== t.one) {
          const c = now[s];
          c.g = t.g; c.k = t.k; c.m0 = t.m0; c.m1 = t.m1; c.m2 = t.m2;
          moving[s] = 0;
        } else {
          moving[s] = 1;
        }
      }
    },

    /** One block, however many channels came in. */
    block(ins, outs) {
      // A channel nobody allocated for, which is a mono insert on a chain
      // built for two or the other way round. Once, outside the sample loop.
      while (states.length < outs.length) {
        states.push(Array.from({ length: slots }, svfState));
      }

      const length = outs[0].length;
      for (let i = 0; i < length; i += 1) {
        // The glide is per sample and shared, so it has to happen outside the
        // channel loop or two channels walk it twice as fast as one.
        for (let s = 0; s < slots; s += 1) {
          if (!moving[s]) continue;
          const c = now[s];
          const t = target[s];
          c.g += (t.g - c.g) * rise;
          c.k += (t.k - c.k) * rise;
          c.m0 += (t.m0 - c.m0) * rise;
          c.m1 += (t.m1 - c.m1) * rise;
          c.m2 += (t.m2 - c.m2) * rise;
          const left = Math.abs(t.g - c.g) + Math.abs(t.k - c.k)
            + Math.abs(t.m0 - c.m0) + Math.abs(t.m1 - c.m1) + Math.abs(t.m2 - c.m2);
          if (left < SVF_SETTLED) {
            c.g = t.g; c.k = t.k; c.m0 = t.m0; c.m1 = t.m1; c.m2 = t.m2;
            moving[s] = 0;
          }
        }

        for (let c = 0; c < outs.length; c += 1) {
          const from = ins[c] || ins[0];
          const state = states[c];
          let x = from[i];
          for (let s = 0; s < slots; s += 1) x = svfTick(state[s], now[s], x);
          outs[c][i] = x;
        }
      }
    },
  };
}
