// Width that is not the same at every frequency.
//
// The three band widths already do this in steps. What is here is the two
// things a step cannot do: take the side out from under a corner entirely,
// and lift it where a record needs lifting. Both are older than any plugin
// that has them - Blumlein's patent had a width control in 1931, and the
// shelf version of this is what EMI's Stereosonic system shuffled with in the
// mid-fifties.
//
// They are separate from the band widths on purpose. A band width is a ratio
// applied inside a crossover slice; these two are filters on the side signal
// across the whole range, which is a different thing and reads differently.

/**
 * Where the side signal can be taken away below, in Hz, and how steeply.
 *
 * The low end of a record is the part that cannot be wide. Lateral groove
 * motion carries the middle and vertical motion carries the side, so a big
 * low-frequency side throws the cutter out of the groove - which is why
 * Neumann's elliptical equaliser existed and why its crossover pairs were
 * 75/150 and 150/300 Hz at six decibels an octave. A club system with both
 * sides summed into one sub has the same problem for a different reason.
 *
 * The bottom of the range is off, rather than a zero below it. A default has
 * to sit inside its own limits or a saved file gets clamped into them - a
 * `monoBelow` of 0 would load back as 40 and quietly switch the filter on,
 * which an existing test caught the moment this knob existed. Forty hertz
 * costs nothing to give up: there is little side energy down there and a cut
 * at 40 is indistinguishable from no cut, so the bottom of the knob can mean
 * off and mean it honestly.
 *
 * Two slopes, because the difference between them is the point. Measured,
 * how much side is left with the corner at 150 Hz:
 *
 *        Hz      40     60     75    100    150    200    300    400
 *     6 dB/oct  -11.9   -8.7   -7.1   -5.2   -3.1   -2.0   -1.1   -0.7
 *    24 dB/oct  -46.0  -32.1  -24.6  -15.7   -6.0   -2.4   -0.5   -0.2
 *
 * "Mono below 150" at six decibels an octave leaves seven decibels of side at
 * 75 Hz and twelve at 40, which is not mono at all - it is the classic cut,
 * and it is why the old elliptical equalisers were quoted as crossover pairs
 * rather than as a single number. At twenty-four it really is gone: twenty-
 * five decibels further down at 75 Hz. Somebody who can hear which one is in
 * use can hear what a slope is, and the gap between the two rows is how much
 * there is to hear.
 */
export const MONO_RANGE = [40, 500];
export const MONO_SLOPES = [
  { id: 'gentle', label: '6 dB/oct', order: 1 },
  { id: 'steep', label: '24 dB/oct', order: 2 },
];

/**
 * Two biquads and not four, which is worth a line because the first attempt
 * was four and the label said 24.
 *
 * Every biquad in this app is at a Q of one over root two, which is a
 * second-order Butterworth - twelve decibels an octave each. Two of them
 * cascaded is a fourth-order Linkwitz-Riley, which is the 24 dB/oct in the
 * label and is six decibels down at the corner. Four of them is eighth order,
 * forty-eight an octave, and twelve decibels down at the corner - measured,
 * which is how the mislabelling was caught rather than reasoned about.
 */
export const STEEP_STAGES = 2;

/**
 * How much the side may be lifted at the bottom, and below what.
 *
 * The other half of frequency-dependent width, and the opposite move. Gerzon
 * calls shuffling "in effect, a frequency dependent width control" and
 * describes the shelf version as raising width by a factor of 1.6 to 2.5 at
 * low frequencies; Griesinger suggested four to eight decibels of side below
 * about 600 Hz. The reason is that the sense of space in a stereo recording
 * depends more on what the bass is doing than on what the top is.
 *
 * So this knob and the one above pull in opposite directions in the same part
 * of the spectrum, which is not a contradiction - it is the whole argument
 * about low-frequency width, and having both on one face is the only way to
 * hear both sides of it.
 */
export const SHUFFLE_RANGE = [0, 8];
export const SHUFFLE_AT = 600;

/**
 * Why there is no phase compensation on the middle, which the obvious design
 * has.
 *
 * The worry is real and worth stating. A filter on the side alone does not
 * only change how much side there is, it changes when the side arrives
 * relative to the middle - and the pair decodes as L = M + S and R = M - S,
 * so a side that is late against the middle tilts and smears the image rather
 * than narrowing it. Gerzon measured an eight-decibel side shelf at about
 * twenty-five degrees of phase lag around 600 Hz and called what it does
 * "phasiness". The textbook answer is to put a matching all-pass on the
 * middle so the two have the same phase.
 *
 * It cannot be done here, and the reason is not an implementation detail. A
 * high-pass and a shelf are both minimum-phase: their phase is determined by
 * their magnitude, and an all-pass has a phase of its own that is not that
 * one. There is no all-pass whose phase equals a high-pass's. What the
 * classic compensators do is approximate a shelf's phase over a narrow range,
 * which is a different and smaller claim than "matched".
 *
 * What makes it acceptable is the thing that matters most for both of these
 * controls: mono is the middle, and the middle is untouched. Both filters are
 * therefore perfectly mono-compatible by construction, which is the whole
 * reason somebody reaches for the first of them.
 *
 * The cost is confined to what the image does in the transition band in
 * stereo. Measured, as the phase the side picks up against the middle:
 *
 *        Hz      40     60     75    100    150    200    300    600
 *     6 dB/oct    75     68     64     56     45     37     27     14
 *    +8 dB shelf  -3     -4     -5     -6    -10    -14    -22    -36
 *
 * The high-pass's worst is at the bottom, where it has also taken most of the
 * side away - forty-five degrees at the corner, where the side is three
 * decibels down, and seventy-five at 40 Hz where there is twelve decibels
 * less of it to be out of phase. The shelf is the other way round: its phase
 * is worst where it is doing least, thirty-six degrees at 600 Hz. That last
 * figure is Gerzon's warning reproduced - he put an eight-decibel side shelf
 * at about twenty-five degrees around 600 Hz, and this one measures
 * thirty-six, which is the same finding at the same place.
 */
export const PHASE_MATCHED = false;

/**
 * The two filters on the side.
 *
 * Takes the biquad helpers rather than importing them, so the module stays
 * free of anything the audio thread would have to be handed separately - the
 * imager's core already has them and passes them in.
 *
 * The middle comes back out as well, unchanged, so the caller's loop reads the
 * same whether this is doing anything or not.
 */
export function shuffleCore(rate, make, set, run) {
  // Four stages for the steepest slope on offer. The gentle one is a one-pole
  // and cannot be a biquad: a biquad at this file's Q is two poles whatever
  // you ask it for, and six decibels an octave is one.
  const sideHP = [make(), make(), make(), make()];
  const sideShelf = make();
  const onePole = { a: 0, z: 0 };

  let order = 0;
  let gentle = false;
  let cutting = false;
  let lifting = false;

  const state = { monoBelow: MONO_RANGE[0], monoSlope: 'gentle', shuffle: 0 };

  function retune() {
    cutting = (state.monoBelow ?? MONO_RANGE[0]) > MONO_RANGE[0];
    const hz = Math.max(MONO_RANGE[0], Math.min(MONO_RANGE[1], state.monoBelow || MONO_RANGE[0]));
    const slope = MONO_SLOPES.find((s) => s.id === state.monoSlope) ?? MONO_SLOPES[0];
    gentle = slope.order === 1;
    order = slope.order;

    if (cutting) {
      if (gentle) onePole.a = Math.exp((-2 * Math.PI * hz) / rate);
      else for (const stage of sideHP) set(stage, 'highpass', hz, rate);
    }

    lifting = (state.shuffle ?? 0) > 0;
    if (lifting) set(sideShelf, 'lowshelf', SHUFFLE_AT, rate, state.shuffle);
  }

  retune();

  const core = {
    mid: 0,
    side: 0,

    set(next) {
      for (const key in next) if (key in state) state[key] = next[key];
      retune();
      return core;
    },

    /** True when neither filter is doing anything, so a caller can skip it. */
    get resting() { return !cutting && !lifting; },

    step(m, s) {
      let side = s;

      if (cutting) {
        if (gentle) {
          // A one-pole high-pass written as the input less its own low-pass,
          // which is exactly six decibels an octave and one state variable.
          onePole.z = side * (1 - onePole.a) + onePole.z * onePole.a;
          side -= onePole.z;
        } else {
          for (let k = 0; k < STEEP_STAGES; k += 1) side = run(sideHP[k], side);
        }
      }

      if (lifting) side = run(sideShelf, side);

      core.mid = m;
      core.side = side;
      return core;
    },
  };

  return core;
}
