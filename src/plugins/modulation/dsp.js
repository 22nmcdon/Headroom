// Six effects that are one idea: something slow moving something fast.
//
// Chorus, flanger, vibrato, phaser, tremolo and auto-pan are usually six
// pedals and six pages of a manual, and they are one low-frequency oscillator
// pointed at one of three places. At a delay time, with the dry signal still
// there, it is a chorus or a flanger depending on how long the delay is; at a
// delay time with the dry signal gone it is vibrato; at the corner of a chain
// of all-passes it is a phaser; at a gain it is tremolo, and at two gains
// pulling opposite ways it is an auto-pan.
//
// That is the whole of what this module says, and saying it is the reason the
// suite is one tool rather than six. What differs between them is where the
// oscillator is wired and how far it is allowed to travel, and both of those
// are a row in a table.
//
// The arithmetic closes over nothing outside its own body, because `node.js`
// stringifies it and hands it to the audio thread - see `lib/worklet.js`. A
// function here that quietly referenced an import would fail there and
// nowhere else.

/**
 * Where the oscillator is wired, which is the only structural difference
 * between the six.
 *
 *   delay   it moves a read head: a comb that walks, or a pitch that bends
 *   phase   it moves the corner of a chain of all-passes: a notch that walks
 *   level   it moves a gain: both channels together, or one against the other
 *
 * The unit each family's modulation is measured in follows from where it is
 * wired, and so does what a reading of it can say. See `trace.js`.
 */
export const MOD_FAMILIES = {
  delay: { unit: 'ms', label: 'a read head' },
  phase: { unit: 'Hz', label: 'an all-pass corner' },
  level: { unit: 'dB', label: 'a gain' },
};

/**
 * The six, as rows.
 *
 * `centre` and `span` are in the family's unit and are what a depth of one
 * means: the modulation runs `centre ± span`. They are constants rather than
 * controls because they are what the effect IS - a delay of fourteen
 * milliseconds with the dry signal beside it is a chorus, and the same
 * oscillator at three milliseconds is a flanger, and no pedal has ever had a
 * knob that turns one into the other.
 *
 * The numbers are the usual ones and the reason they are the usual ones is
 * audible here: at fourteen milliseconds the comb's first notch is at 36 Hz
 * and its teeth are 71 Hz apart, so what you hear is a thickening and a
 * detune; at three the first notch is at 167 Hz and the teeth are 333 apart,
 * which is a sound with a pitch to it, and sweeping that pitch is the whole
 * of what a flanger is.
 *
 * `wet` is what the mix is fixed at, and it is fixed. A chorus at a hundred
 * per cent wet is vibrato - which is a different row in this table rather
 * than a setting of the same one - and a vibrato at fifty per cent is a
 * chorus. Leaving the mix on a knob would make three of the six reachable
 * from each other, so the face would be lying about how many things it is.
 */
export const MOD_KINDS = [
  {
    id: 'chorus',
    label: 'Chorus',
    family: 'delay',
    centre: 14,
    span: 6,
    wet: 0.5,
    feeds: false,
    knobs: ['rate', 'depth', 'spread'],
  },
  {
    id: 'flanger',
    label: 'Flanger',
    family: 'delay',
    centre: 3,
    span: 2.8,
    wet: 0.5,
    feeds: true,
    knobs: ['rate', 'depth', 'feedback', 'spread'],
  },
  {
    id: 'vibrato',
    label: 'Vibrato',
    family: 'delay',
    centre: 6,
    span: 4,
    wet: 1,
    feeds: false,
    knobs: ['rate', 'depth'],
  },
  {
    id: 'phaser',
    label: 'Phaser',
    family: 'phase',
    centre: 670,
    span: 2.16,
    wet: 0.5,
    feeds: true,
    knobs: ['rate', 'depth', 'feedback', 'spread'],
  },
  {
    id: 'tremolo',
    label: 'Tremolo',
    family: 'level',
    centre: 0,
    span: 1,
    wet: 1,
    feeds: false,
    knobs: ['rate', 'depth'],
  },
  {
    id: 'autopan',
    label: 'Auto-pan',
    family: 'level',
    centre: 0,
    span: 1,
    wet: 1,
    feeds: false,
    opposed: true,
    knobs: ['rate', 'depth'],
  },
];

export const MOD_IDS = MOD_KINDS.map((k) => k.id);

/**
 * One row, by id. Never undefined: a tool with no kind set is a bug.
 *
 * A declaration rather than an arrow on a const, as everything in this file
 * that the audio thread needs has to be: `toString` of an arrow carries no
 * name with it, so the worklet would get the body as a bare expression with
 * nothing bound to call it - and it would fail inside a blob, where a stack
 * trace is a line number. See `lib/worklet.js`.
 */
export function modKind(id) {
  return MOD_KINDS.find((k) => k.id === id) ?? MOD_KINDS[0];
}

export const MOD_DEFAULTS = {
  kind: 'chorus',
  // Where the rate came from, which is a note value or nothing. The core
  // never reads it - a modulation runs in hertz - but the face writes the
  // rate from it and a saved sketch has to remember which it was, or every
  // reload turns a synced sweep into a free one that happens to agree.
  sync: 'free',
  rate: 0.6,
  depth: 0.4,
  feedback: 0,
  spread: 90,
  shape: 'sine',
  // Out of the way entirely, which is what the exercises play on the other
  // side of their A/B. Not on the face: a bypass that is a setting rather
  // than a switch is a bypass somebody can save a sketch with.
  dry: false,
};

/**
 * What the controls can reach.
 *
 * The rate stops at twelve hertz, which is where a tremolo stops being a
 * tremolo and starts being a ring modulator's poor cousin: past about fifteen
 * the sidebands are far enough from the carrier to be heard as pitches of
 * their own rather than as a wobble. It starts at a quarter of a hertz, which
 * is four seconds a cycle, and that bottom is the reading's rather than the
 * ear's: a path watched for four seconds cannot be told the rate of
 * something that has not been round once. A slower sweep than this is a real
 * thing on a real phaser and it is not a thing this can mark.
 *
 * The feedback goes both ways and the two ways are two instruments. Measured
 * on a frozen flanger at three milliseconds, where the comb's first notch is
 * at 167 Hz and its first peak at 333:
 *
 *     feedback     167 Hz     333 Hz     500 Hz
 *       -0.8        +5.7       -2.2       +5.4
 *       -0.4        -9.7       -1.4       -9.9
 *        0.0       -44.7       -0.0      -38.0
 *       +0.4       -16.8       +2.4      -16.7
 *       +0.8       -13.0       +9.1      -13.0
 *
 * Positive feedback sharpens the comb it already has - nine decibels up where
 * it was adding. Negative feedback moves it: the teeth land where the peaks
 * were, so what was a notch at 167 comes out five decibels up. One whistles
 * and the other is hollow, and neither is a depth control.
 *
 * Nine tenths rather than one, because a comb with unity feedback is an
 * oscillator.
 */
export const MOD_LIMITS = {
  rate: [0.25, 12],
  depth: [0, 1],
  feedback: [-0.9, 0.9],
  spread: [0, 180],
};

export function modHeld(value, [low, high]) {
  return Math.min(high, Math.max(low, value));
}

/**
 * Where the two sides of a stereo modulation sit, as a phase offset.
 *
 * Three positions rather than a knob, because those are the three a pedal has
 * ever offered and because the marking cannot tell the difference between a
 * knob's neighbouring degrees: measured, five degrees of spread reads 1.7 per
 * cent of travel against a tolerance of 1.5 at its tightest, so a knob would
 * be a control whose answer is a step and a half wide. A picker is reachable.
 */
export const MOD_SPREADS = [
  { id: 0, label: 'Mono' },
  { id: 90, label: 'Quarter turn' },
  { id: 180, label: 'Opposite' },
];

/** The two shapes, which are the two every pedal has ever offered. */
export const MOD_SHAPES = [
  { id: 'sine', label: 'Sine' },
  { id: 'triangle', label: 'Triangle' },
];

/**
 * The oscillator, as a number between minus one and one.
 *
 * A sine spends most of its time near the ends of its travel and a triangle
 * spends the same amount of time everywhere, which is the whole of the
 * difference and is audible on a tremolo immediately: the sine breathes and
 * the triangle chops.
 */
export function lfoAt(phase, shape) {
  const turn = phase - Math.floor(phase);
  if (shape === 'triangle') return 4 * Math.abs(turn - 0.5) - 1;
  return Math.sin(2 * Math.PI * turn);
}

/** How long the line is, which is the deepest a delay-family sweep can go. */
export const LINE_MS = 32;

/**
 * How far down a level modulation is followed, in decibels.
 *
 * A tremolo at full depth touches zero and an auto-pan at full travel
 * silences one side, and the logarithm of zero is not a number a reading can
 * be compared on. Forty decibels down is forty decibels down as far as
 * anybody is concerned - at that point the other side is carrying everything
 * - and it keeps both the display and the distance finite.
 */
export const MOVE_FLOOR = -40;

/**
 * The all-pass corner that puts a notch where it is wanted, as a coefficient.
 *
 * One pole and one zero, mirrored about the unit circle: all-pass in
 * magnitude, and the phase runs from zero at nothing to minus a half turn at
 * Nyquist, passing a quarter turn at the corner. Two of them in series are
 * half a turn at the corner, and a half turn added back to the dry signal is
 * a cancellation - which is why a phaser's notches are at the corner of each
 * pair rather than at the corner of each stage.
 */
export function apCoef(hz, rate) {
  const t = Math.tan((Math.PI * Math.min(hz, rate * 0.45)) / rate);
  return (t - 1) / (t + 1);
}

/** How many all-pass stages a phaser has, and so how many notches. */
export const AP_STAGES = 6;

/**
 * One modulation, running.
 *
 * `stereo` is one sample in on each side and one out on each, as every other
 * core in this app is, and `moving` is what the oscillator is doing to this
 * sample - which is the measurement `trace.js` takes and the display draws.
 * It is reported rather than recomputed for the same reason the compressor
 * reports its reduction: the gain is the thing being taught, so the gain is
 * what a reading of it should come from.
 */
export function modCore(rate) {
  const state = { ...MOD_DEFAULTS };

  const longest = Math.ceil((LINE_MS / 1000) * rate) + 4;
  const lines = [new Float32Array(longest), new Float32Array(longest)];
  const ats = [0, 0];

  const apX = [new Float64Array(AP_STAGES), new Float64Array(AP_STAGES)];
  const apY = [new Float64Array(AP_STAGES), new Float64Array(AP_STAGES)];
  const back = [0, 0];

  let phase = 0;
  let kind = modKind(state.kind);

  // Everything the hot loop needs, as numbers rather than as property
  // lookups and string comparisons. A core whose inner loop reads
  // `state.depth`, calls a clamp four times and compares `kind.family` to
  // three strings every sample is a core that spends its time asking what it
  // is rather than being it - and the first version of this allocated two
  // arrays a sample as well, which over a four second measurement is three
  // hundred thousand of them. It runs on the audio thread too, where a
  // measurement that takes too long is a measurement nobody takes and a
  // sample that takes too long is a click.
  let family = 0;        // 0 delay, 1 phase, 2 level
  let centre = 0;
  let span = 0;
  let wet = 0;
  let opposed = false;
  let feeds = false;
  let depth = 0;
  let step = 0;          // phase per sample
  let feed = 0;
  let sides = 0;         // the second channel's phase offset, in turns
  let triangle = false;

  function retune() {
    kind = modKind(state.kind);
    family = kind.family === 'phase' ? 1 : kind.family === 'level' ? 2 : 0;
    centre = kind.centre;
    span = kind.span;
    wet = kind.wet;
    opposed = !!kind.opposed;
    feeds = !!kind.feeds;

    depth = modHeld(state.depth ?? 0, MOD_LIMITS.depth);
    step = modHeld(state.rate ?? 0, MOD_LIMITS.rate) / rate;
    feed = feeds ? modHeld(state.feedback ?? 0, MOD_LIMITS.feedback) : 0;
    sides = opposed ? 0.5 : modHeld(state.spread ?? 0, MOD_LIMITS.spread) / 360;
    triangle = state.shape === 'triangle';
  }

  /** The oscillator, inlined: see `lfoAt`, which is this and is exported. */
  function wave(turn) {
    const part = turn - Math.floor(turn);
    if (triangle) return 4 * Math.abs(part - 0.5) - 1;
    return Math.sin(2 * Math.PI * part);
  }

  /**
   * The line, read somewhere between two samples.
   *
   * Four-point Catmull-Rom, which is the same interpolator the delay reads
   * its line with and for the same reason: linear interpolation of a line
   * whose length is changing is a comb filter whose notch moves with it, so
   * the top end breathes in time with the modulation. On a chorus that is not
   * a subtle fault - the modulation is the point, and a chorus whose treble
   * pumps at the rate of its own sweep sounds like a broken one.
   *
   * At a whole number it is exactly the sample, with no arithmetic left in
   * it, so a modulation at no depth at all is a plain delay.
   */
  function readAt(c, at) {
    const buf = lines[c];
    const whole = Math.floor(at);
    const part = at - whole;
    const i = whole >= longest ? whole - longest : whole;
    if (part === 0) return buf[i];

    const m1 = buf[(i - 1 + longest) % longest];
    const p0 = buf[i];
    const p1 = buf[(i + 1) % longest];
    const p2 = buf[(i + 2) % longest];
    const a1 = 0.5 * (p1 - m1);
    const a2 = m1 - 2.5 * p0 + 2 * p1 - 0.5 * p2;
    const a3 = 0.5 * (p2 - m1) + 1.5 * (p0 - p1);
    return ((a3 * part + a2) * part + a1) * part + p0;
  }

  /** One side through the all-pass chain, with whatever is fed back into it. */
  function phased(c, dry, a) {
    const xs = apX[c];
    const ys = apY[c];
    let value = dry + feed * back[c];
    for (let k = 0; k < AP_STAGES; k += 1) {
      const y = a * value + xs[k] - a * ys[k];
      xs[k] = value;
      ys[k] = y;
      value = y;
    }
    back[c] = value;
    return dry * (1 - wet) + value * wet;
  }

  /** And one side through the line, read wherever the oscillator has put it. */
  function swept(c, dry, ms) {
    const samples = (ms / 1000) * rate;
    const held = Math.min(longest - 3, Math.max(3, samples));
    const heard = readAt(c, ats[c] - held + longest);
    lines[c][ats[c]] = dry + feed * heard;
    ats[c] = ats[c] + 1 >= longest ? 0 : ats[c] + 1;
    core.moving[c] = (held / rate) * 1000;
    return dry * (1 - wet) + heard * wet;
  }

  const core = {
    left: 0,
    right: 0,
    /**
     * Where the oscillator has put things this sample, per channel, in the
     * family's own unit: milliseconds of delay, hertz of corner, or decibels
     * of gain.
     */
    moving: [0, 0],

    set(next) {
      Object.assign(state, next);
      retune();
      return core;
    },

    params() { return { ...state }; },

    /** Back to the top of the sweep, so two runs of a probe agree. */
    reset() {
      phase = 0;
      for (let c = 0; c < 2; c += 1) {
        lines[c].fill(0);
        apX[c].fill(0);
        apY[c].fill(0);
        ats[c] = 0;
        back[c] = 0;
        core.moving[c] = 0;
      }
      return core;
    },

    /**
     * One sample in on each side, one out on each.
     *
     * Written out twice rather than looped over two channels, which is the
     * one place in this file where the shape of the code is about speed. A
     * loop needs the input and the output in arrays, and two arrays a sample
     * is three hundred thousand allocations over a four second measurement.
     */
    stereo(inL, inR) {
      if (state.dry) {
        core.left = inL;
        core.right = inR;
        core.moving[0] = family === 1 ? centre : 0;
        core.moving[1] = core.moving[0];
        return core;
      }

      const lfoL = wave(phase);
      const lfoR = wave(phase + sides);

      if (family === 2) {
        // Tremolo goes down from unity and never above it, which is what
        // every tremolo circuit ever built does and the only version of it
        // that can be put in a chain without changing the level. Auto-pan is
        // equal power referenced to its own centre: the pair's total is
        // constant, nothing moves at a depth of nought, and at full travel
        // one side is silent while the other is three decibels up - which is
        // not a bug but what equal power means.
        const gainL = opposed
          ? Math.SQRT2 * Math.cos((Math.PI / 4) * (1 + lfoL * depth))
          : 1 - depth * 0.5 * (1 - lfoL);
        const gainR = opposed
          ? Math.SQRT2 * Math.cos((Math.PI / 4) * (1 + lfoR * depth))
          : 1 - depth * 0.5 * (1 - lfoR);
        core.left = inL * gainL;
        core.right = inR * gainR;
        core.moving[0] = Math.max(MOVE_FLOOR, 20 * Math.log10(Math.max(1e-7, gainL)));
        core.moving[1] = Math.max(MOVE_FLOOR, 20 * Math.log10(Math.max(1e-7, gainR)));
      } else if (family === 1) {
        // The corner, swept in octaves either side of the centre, because
        // frequency is heard that way: a sweep that is linear in hertz spends
        // nine tenths of its time in the top octave.
        const cornerL = centre * (2 ** (lfoL * depth * span));
        const cornerR = centre * (2 ** (lfoR * depth * span));
        core.left = phased(0, inL, apCoef(cornerL, rate));
        core.right = phased(1, inR, apCoef(cornerR, rate));
        core.moving[0] = cornerL;
        core.moving[1] = cornerR;
      } else {
        core.left = swept(0, inL, centre + lfoL * depth * span);
        core.right = swept(1, inR, centre + lfoR * depth * span);
      }

      phase += step;
      if (phase >= 1) phase -= Math.floor(phase);
      return core;
    },
  };

  retune();
  return core;
}
