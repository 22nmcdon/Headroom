// Making side out of middle, which is the one thing the rest of this folder
// cannot do.
//
// Every control in field.js is a ratio on side that is already there. Turn
// the three widths up on a mono source and nothing happens, because two times
// nothing is nothing. What makes a mono thing wide is a filter that produces
// a second signal from the first, and every widener ever sold is some version
// of that: side = something(middle). Which "something" decides how it sounds,
// whether it survives mono, and - this is the part worth teaching - whether
// any measurement can tell it from width that was recorded rather than made.
//
// There is no setting of these that is the same as having recorded two
// microphones. What there is instead is five different ways of being wrong
// about it, each wrong in a way you can learn to hear.

/**
 * The kinds, and what each one does to the two things that matter.
 *
 * Measured through this arithmetic, on a mono source with content in every
 * band, at an amount of 0.8 and a delay of 12 ms:
 *
 *     kind           width     mono    one side    lag      coherence
 *     Haas           -9.1 dB   2.85     6.01      11.6 ms   0.84-1.00
 *     comb           -1.9      0.00     6.01      -9.5      0.53-0.99
 *     all-pass       -1.9      0.00     5.99       9.5      1.00
 *     decorrelator   -1.1      0.00     4.13      -4.8      0.99-1.00
 *     micro-pitch    -6.6      5.86     6.45       0.0      0.19-0.73
 *
 * `mono` and `one side` are how uneven the spectrum is - the standard
 * deviation in decibels at a twelfth of an octave, so a comb's teeth are
 * resolved rather than averaged away - of the mono sum and of the worse of
 * the two channels, each against the input.
 *
 * Two things separate cleanly and one does not.
 *
 * The mono column splits Haas from the three complementary kinds. Sending the
 * delayed copy to one side leaves nearly three decibels of comb in the sum;
 * putting it in the side leaves exactly none, because L = M + D and R = M - D
 * add back to M whatever D is. That is the mono-compatibility question asked
 * properly, and it is invisible to every width meter.
 *
 * The coherence column splits micro-pitch from everything else. It reads near
 * one for every static kind - including the decorrelator, which was the
 * surprise. A velvet-noise response is a linear time-invariant filter like
 * any other, so however diffuse it sounds, each channel stays perfectly
 * predictable from the other. Only the kind that moves reads low. So
 * coherence does not separate artificial width from natural; it separates
 * time-invariant from time-varying, and the only one here that passes is the
 * one that drifts for ever.
 *
 * What does not separate is comb against all-pass. The usual reason for
 * preferring Orban's all-pass version is that it is "less comb-like", and
 * measured as unevenness that is simply not true: 5.99 against 6.01. Each
 * channel is 1 +/- g times an all-pass, and an all-pass has unit magnitude at
 * every frequency, so the sum swings between 1-g and 1+g just as a delay's
 * does. What differs is where the teeth are, not how deep: a delay puts its
 * nulls at odd multiples of one over twice the delay, which an ear hears as a
 * pitch, and a chain of all-passes puts them wherever its phase happens to
 * cross, which an ear hears as phasiness. No reading here measures that, and
 * saying so is better than implying the numbers prove something they do not.
 *
 * One asymmetry worth knowing about, since the design looks symmetric: for the
 * all-pass kind the two channels are not equally uneven - 1.58 one side
 * against 5.99 the other - because its phase does not sweep evenly, so
 * 1 + g*AP and 1 - g*AP are not mirror images the way they are for a delay.
 */
export const WIDEN_KINDS = [
  {
    // No prose on this one. The line under the picker leaves the widener out
    // whenever it is not running, and off is the one kind that never is.
    id: 'off',
    label: 'Off',
  },
  {
    id: 'haas',
    label: 'Haas',
    said: 'a delayed copy on one side',
  },
  {
    id: 'comb',
    label: 'Comb',
    said: 'a delayed copy in the side',
  },
  {
    id: 'allpass',
    label: 'All-pass',
    said: 'a phase-smeared copy in the side',
  },
  {
    id: 'velvet',
    label: 'Decorrelator',
    said: 'a sparse random response in the side',
  },
  {
    id: 'micro',
    label: 'Micro-pitch',
    said: 'the two sides detuned against each other',
  },
];

/**
 * How long the delay is, in milliseconds, and why the range stops where it
 * does.
 *
 * Precedence holds from about two milliseconds to about fifty: inside that
 * the two arrivals fuse into one wider, louder image that leans towards
 * whichever came first, and past it they come apart into a source and an
 * echo. Below about two and a half it stops being a position and starts being
 * a comb you hear as tone. So the range is 1 to 40 and it rests at 12, which
 * is in the middle of where the effect is an effect.
 *
 * The same number is the comb's tooth spacing in mono. A Haas delay of t
 * milliseconds puts nulls at every odd multiple of 1/(2t), so twelve
 * milliseconds notches at 42 Hz, 125, 208 and on up. That is why the delay
 * knob and the mono button belong on the same face.
 */
export const WIDEN_DELAY = [1, 40];

/** How much of the made-up signal is added, as a gain on the side. */
export const WIDEN_AMOUNT = [0, 1];

/**
 * How far the two sides are detuned, in cents, for the micro-pitch kind.
 *
 * Nine each way is the figure the classic hardware recipe is usually quoted
 * at, and it is small enough to read as width rather than as being out of
 * tune. The shifter underneath is better at small ratios than large - see
 * lib/pitch.js - so this is the easy case for it.
 */
export const WIDEN_CENTS = [2, 25];

/**
 * The all-pass chain's coefficients, and the velvet response's shape.
 *
 * Four all-pass stages at spread delays, which is the arrangement Orban
 * described: enough phase dispersion to smear a transient across the side
 * without the regular tooth spacing a single delay gives. The lengths are
 * co-prime so their periodicities do not line up.
 *
 * The velvet response is a sparse train of plus and minus ones under a decay -
 * one pulse per interval, placed at random inside it, which is what makes it
 * cheap. Thirty milliseconds and about fifteen hundred pulses a second comes
 * to forty-five taps, against the thousand-plus a dense random-phase response
 * needs for the same diffuseness.
 */
export const ALLPASS_TAPS = [0.0131, 0.0097, 0.0073, 0.0051];
export const VELVET_MS = 30;
export const VELVET_PER_SECOND = 1500;
export const VELVET_DECAY = 3;

/**
 * A fixed, repeatable velvet-noise response.
 *
 * Fixed because a widener that is a different filter every time the tool is
 * opened is a widener nobody can be asked to identify. The sequence comes
 * from a counter rather than from Math.random for the same reason every other
 * generated thing in this app does: the same setting has to be the same sound
 * on every machine and every day.
 */
export function velvetTaps(rate) {
  const span = Math.max(2, Math.round((VELVET_MS / 1000) * rate));
  const count = Math.max(1, Math.round((VELVET_MS / 1000) * VELVET_PER_SECOND));
  const per = span / count;

  let seed = 0x5ee3;
  const next = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  const at = new Int32Array(count);
  const sign = new Float32Array(count);
  let energy = 0;
  for (let m = 0; m < count; m += 1) {
    at[m] = Math.min(span - 1, Math.round(m * per + next() * (per - 1)));
    sign[m] = (next() > 0.5 ? 1 : -1) * Math.exp((-VELVET_DECAY * at[m]) / span);
    energy += sign[m] * sign[m];
  }
  // Normalised so the response passes as much energy as it is given, which
  // keeps the amount knob meaning the same thing across the kinds.
  const norm = Math.sqrt(energy) || 1;
  for (let m = 0; m < count; m += 1) sign[m] /= norm;

  return { at, sign, span, count };
}

/**
 * The widener: middle in, a pair of contributions out.
 *
 * `addL` and `addR` are added to the decoded left and right rather than
 * returned as a side, because one of the five is not symmetric. Haas sends
 * its copy to one side only, and that asymmetry is the whole of what makes it
 * comb in mono where the others do not - forcing it into a side would have
 * made it the comb kind and lost the distinction the face is for.
 */
export function widenCore(rate, makeAP, setAP, runAP, pitch) {
  const longest = Math.max(2, Math.round((WIDEN_DELAY[1] / 1000) * rate) + 2);
  const line = new Float32Array(longest);
  let write = 0;

  const velvet = velvetTaps(rate);
  const velvetLine = new Float32Array(velvet.span + 1);
  let velvetAt = 0;

  const chain = ALLPASS_TAPS.map(() => makeAP());
  const up = pitch ? pitch(rate) : null;
  const down = pitch ? pitch(rate) : null;

  const state = { widen: 'off', widenDelay: 12, widenAmount: 0, widenCents: 9 };
  let kind = 'off';
  let back = 0;
  let amount = 0;

  function retune() {
    kind = WIDEN_KINDS.some((k) => k.id === state.widen) ? state.widen : 'off';
    const ms = Math.max(WIDEN_DELAY[0], Math.min(WIDEN_DELAY[1], state.widenDelay ?? 12));
    back = Math.max(1, Math.round((ms / 1000) * rate));
    amount = Math.max(WIDEN_AMOUNT[0], Math.min(WIDEN_AMOUNT[1], state.widenAmount ?? 0));

    // The all-pass chain's corners, set from the tap lengths as frequencies -
    // a first-order all-pass at 1/(2 pi t) turns through ninety degrees where
    // a delay of t would turn through a quarter cycle.
    for (let k = 0; k < chain.length; k += 1) {
      setAP(chain[k], 'allpass', 1 / (2 * Math.PI * ALLPASS_TAPS[k]), rate);
    }

    if (up && down) {
      const cents = Math.max(WIDEN_CENTS[0], Math.min(WIDEN_CENTS[1], state.widenCents ?? 9));
      up.set({ ratio: 2 ** (cents / 1200) });
      down.set({ ratio: 2 ** (-cents / 1200) });
    }
  }

  retune();

  const core = {
    addL: 0,
    addR: 0,

    set(next) {
      for (const key in next) if (key in state) state[key] = next[key];
      retune();
      return core;
    },

    /** True when it is adding nothing, so the caller can skip the work. */
    get resting() { return kind === 'off' || amount <= 0; },

    step(m) {
      // The delay line is written whatever the kind, so switching kinds mid
      // signal does not start from an empty line.
      line[write] = m;
      const readAt = write - back < 0 ? write - back + longest : write - back;
      const delayed = line[readAt];
      write += 1;
      if (write === longest) write = 0;

      velvetLine[velvetAt] = m;
      const velvetNow = velvetAt;
      velvetAt += 1;
      if (velvetAt > velvet.span) velvetAt = 0;

      let addL = 0;
      let addR = 0;

      if (kind === 'haas') {
        // One side only, which is what makes it the loud, leaning, combing
        // one. In mono the sum is the input plus a delayed copy of it.
        addR = amount * delayed;
      } else if (kind === 'comb') {
        // The same copy, but into the side: opposite signs, so the mono sum
        // is exactly the input and each channel alone is a comb.
        addL = amount * delayed;
        addR = -addL;
      } else if (kind === 'allpass') {
        let v = m;
        for (const stage of chain) v = runAP(stage, v);
        addL = amount * v;
        addR = -addL;
      } else if (kind === 'velvet') {
        let d = 0;
        for (let t = 0; t < velvet.count; t += 1) {
          let from = velvetNow - velvet.at[t];
          if (from < 0) from += velvet.span + 1;
          d += velvet.sign[t] * velvetLine[from];
        }
        addL = amount * d;
        addR = -addL;
      } else if (kind === 'micro' && up && down) {
        // The only one that is not a fixed filter: each side gets its own
        // detune, so the two drift against each other for ever.
        up.stereo(m, 0);
        down.stereo(m, 0);
        addL = amount * up.left;
        addR = amount * down.left;
      }

      core.addL = addL;
      core.addR = addR;
      return core;
    },
  };

  return core;
}
