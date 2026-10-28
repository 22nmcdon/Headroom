import { makeBiquad, setBiquad, runBiquad } from '../../lib/dsp.js';

// One delay, as arithmetic.
//
// What a delay is, for somebody using one, is in src/learn/notes/echo.js.
//
// Split out of `line.js` because the audio thread now needs it. A delay that
// only ever stood still could be written down as an impulse response and
// convolved, and for a long time this one was: linear, so everything it will
// ever do to anything is in what it does to one click. Wow and flutter end
// that. A response says "a click in, these repeats out" once and for all,
// and convolving with it puts the same displacement under every input sample
// - so a tape that wanders would come out detuned by a fixed amount instead
// of wandering. The modulation has to happen while the audio is going past.
//
// So this is the loop itself, and it is run two ways: by a worklet on the
// audio thread, and by `makeEcho` offline to get the response that is drawn
// and marked. One implementation, so what you hear is what you are scored
// on - the same arrangement the compressor has.

/** Every knob, and where it starts. */
export const ECHO_DEFAULTS = {
  time: 375,         // ms between repeats
  feedback: 0.35,    // how much of each repeat goes round again
  tone: 6000,        // the low-pass inside the loop: repeats get darker
  lowCut: 120,       // the high-pass inside it: repeats get thinner
  pingPong: false,   // repeats alternating ears
  pingPongFrom: 'left', // which ear they start in
  offset: 0,         // ms the right side is behind the left, or in front of it
  heads: 'single',   // how many places the line is read from
  diffusion: 0,      // how smeared each pass is, 0 to 1
  machine: 'digital', // what the repeats are stored on
  mix: 0.3,
};

/**
 * The all-passes diffusion is made of, as fractions of the loop.
 *
 * Three Schroeder all-passes, `y[n] = -a*x[n] + x[n-M] + a*y[n-M]`, in the
 * feedback path. Each one passes everything and delays it by frequency, so a
 * sharp repeat comes back as a short burst of itself - and because they are
 * in the loop, every pass is smeared once more than the one before. That
 * progression is the whole point: it is the road from an echo to a room, and
 * it is the only control here that crosses it.
 *
 * Fractions of the loop rather than fixed milliseconds, for two reasons. The
 * shortest delay on offer is twenty milliseconds and a fixed three-stage
 * chain in the range this wants - three to fifteen milliseconds a stage - is
 * longer than the whole loop. And measuring in fractions is what the loop
 * reading does, so diffusion looks the same to it at every time.
 *
 * Not round numbers, and not multiples of each other: all-passes at related
 * delays ring together and what should be a smear comes out as a pitch.
 *
 * Measured at 400 ms and 0.6 feedback, the middle ninety per cent of each
 * pass's energy, and where its centre of gravity sits:
 *
 *     diffusion   pass 1   pass 2   pass 3     centres
 *     0             0 ms     0 ms     0 ms     400 / 800 / 1200 ms
 *     0.5           0 ms    30 ms    68 ms     400 / 800 / 1200
 *     1             0 ms    80 ms   156 ms     400 / 800 / 1200
 *
 * Each pass wider than the last and every centre exactly on its slot. The
 * centres staying put is what shortening the line buys: without it the
 * repeats would drag later with every pass and a diffusion knob would be a
 * time knob wearing the wrong label.
 *
 * And the loop reading sees it, which is what makes it markable - 5.65 dB for
 * a tenth of diffusion against none, 15.86 for all of it, and about 5 dB
 * between adjacent quarters. Against the 6 dB the hard tier allows, that
 * resolves diffusion to roughly a third of its travel, which is about what
 * anybody can hear of it.
 */
export const DIFFUSE_AT = [0.0371, 0.0241, 0.0167];

/** The coefficient at the top of the knob. */
export const MOST_DIFFUSE = 0.7;

/**
 * The machines a delay can be, and what each one does to the tone.
 *
 * The one thing that tells these apart by ear is not how dark they are but
 * how their darkness moves with the time, so that is what is modelled and
 * the rest is left alone. A digital delay has the same bandwidth at every
 * setting. The other two do not, and for different reasons.
 *
 * A bucket brigade is a line of buckets clocked along, and the delay is the
 * number of stages over twice the clock - Raffel and Smith, DAFx-10. So the
 * clock is `N / 2*tau`, and a longer delay means a slower clock, which has
 * to be band-limited further down to keep its own sampling out of the audio.
 * A 4096-stage chip at 300 ms wants a 6,827 Hz clock and so a signal band-
 * limited to 3,413; the anti-alias and reconstruction filters in a real pedal
 * sit between a third and a half of the clock, which is where the corner
 * below comes from. Longer delay, darker repeats - the exact opposite of a
 * digital delay, and the tell.
 *
 * Tape with a fixed head and a variable speed is the same shape of story from
 * different physics. Every loss term on the playback side scales with
 * `k = 2*pi*f / v` (Chowdhury, DAFx-19), so halving the speed halves the
 * frequency everything happens at - and with the heads a fixed distance
 * apart, a longer delay is a slower tape. One constant in hertz-seconds
 * carries that, rather than four parameters whose values would be invented.
 * The head bump comes along with it: a head is a loop of wire that responds
 * where the wavelength on the tape matches it, so that moves with the speed
 * too, and it is what makes tape warm rather than only dark.
 *
 * Behavioural and not physical, on purpose. CHOW Tape solves a hysteresis ODE
 * at sixteen times oversampling; none of that is identifiable by ear once it
 * is inside an echo, and this runs in a browser on a phone.
 *
 * Marked by the reading that was already there, with no scoring change: the
 * decay curve reads three bands over time, and a machine that takes the top
 * off shows up in the top one. Measured, with the tolerances that decide a
 * pass being 2.6, 1.9 and 1.2 dB:
 *
 *     at 200 ms   digital vs tape   2.17 dB   digital vs bbd    4.87   tape vs bbd    4.47
 *     at 400 ms                     2.85                       12.33                 10.52
 *     at 800 ms                     6.32                       17.11                 11.37
 *
 * Further apart the longer the delay, which is the whole point of the model
 * rather than a convenience. The one weak pair is digital against tape at
 * 200 ms, which at 2.17 dB would pass the easy tier - and that is honest,
 * because a 200 ms tape delay is not very dark.
 */
export const MACHINES = [
  { id: 'digital', label: 'Digital' },
  { id: 'tape', label: 'Tape' },
  { id: 'bbd', label: 'Bucket brigade' },
];

/** The stages in the chip this is modelled on, an MN3005. */
export const BBD_STAGES = 4096;

/** Where the pedal's own filters sit, as a fraction of the clock. */
export const BBD_AT = 0.4;

/**
 * Tape's corner, in hertz-seconds.
 *
 * At 375 ms this puts it at 6 kHz, which is about where a worn quarter-inch
 * loop at a few inches a second gives out. Divided by the time, so half the
 * speed is half the corner.
 */
export const TAPE_AT = 2250;

/**
 * And its head bump: where, in hertz-seconds, how much, and how far it may go.
 *
 * Its own range, which is the bug this comment exists for. The corner's clamp
 * runs from 1500 Hz up, and reusing it here pinned the bump at 1500 at every
 * delay - a peak in the middle of the midrange wearing the name of something
 * that lives two octaves below it. A head bump is tens of hertz, so it gets
 * tens of hertz.
 */
export const TAPE_BUMP_AT = 45;
export const TAPE_BUMP_DB = 2.5;
export const BUMP_FLOOR = 35;
export const BUMP_CEILING = 160;

/**
 * The tone the medium's makeup is referenced to, in hertz.
 *
 * Three hundred: under the 1500 Hz floor the corner has, so it is always on
 * the flat part of the response, and well above the head bump's ceiling so
 * the bump is not what is being levelled.
 */
export const MEDIUM_REF = 300;

/** As dark and as bright as any machine is allowed to get. */
export const MACHINE_FLOOR = 1500;
export const MACHINE_CEILING = 18000;

/**
 * What a machine does to the tone at a given delay, or null for none.
 *
 * `stages` is how many cascaded low-passes it takes. Two for a bucket
 * brigade, because a pedal has an anti-alias filter going in and a
 * reconstruction filter coming out and the pair of them is steep; one for
 * tape, whose losses roll off gently. Cascaded rather than a designed
 * Butterworth: `setBiquad` holds Q at root-half, so two of them put the
 * corner 6 dB down rather than 3 - which is nearer what a cascade of
 * Sallen-Key stages in a real pedal does than a textbook fourth-order would
 * be, and the model is behavioural anyway.
 */
export function machineTone(id, ms) {
  const seconds = Math.max(ms, 1) / 1000;

  if (id === 'bbd') {
    const clock = BBD_STAGES / (2 * seconds);
    const corner = Math.min(MACHINE_CEILING, Math.max(MACHINE_FLOOR, clock * BBD_AT));
    return { corner, stages: 2, bump: 0, bumpAt: 0, clock };
  }

  if (id === 'tape') {
    return {
      corner: Math.min(MACHINE_CEILING, Math.max(MACHINE_FLOOR, TAPE_AT / seconds)),
      stages: 1,
      bump: TAPE_BUMP_DB,
      bumpAt: Math.min(BUMP_CEILING, Math.max(BUMP_FLOOR, TAPE_BUMP_AT / seconds)),
      clock: 0,
    };
  }

  return null;
}

/** Which side a ping-pong may be started from. */
export const PING_FROM = ['left', 'right'];

/**
 * The heads a delay can be read with, as fractions of the time on the knob.
 *
 * Fractions and not multiples, so the knob always means the longest repeat.
 * Multiples would put the last head of a four-head pattern four times further
 * out than the number on the control, and off the end of the range at
 * anything past a third of it.
 *
 * The feedback is taken from the longest head, so what goes round is the
 * whole pattern rather than one tap of it - which is what a tape loop with
 * three heads on it does.
 *
 * `heads3` is the RE-201's three playback heads. UA's model of the unit gives
 * head ranges of 69-177 ms, 131-337 and 189-489, which is 1 : 1.90 : 2.75 at
 * either end of the sweep; as fractions of the longest that is what these are.
 * The ratio repeated in guides is 1 : 2 : 3, and the hardware is not that -
 * so the measured figures win and the folklore is noted rather than used.
 *
 * `heads4` is Binson's drum: four heads equally spaced around it. With the
 * longest on a quarter note the others land on a sixteenth, an eighth and a
 * dotted eighth, which is where the dotted-eighth guitar idiom came from.
 *
 * What these cannot be is marked, and that is worth saying here rather than
 * discovering while writing an exercise. Read the way a delay guess is read -
 * as an energy decay curve - the patterns are almost the same thing:
 *
 *                 single    heads3    heads4
 *     single        0.00      1.16      1.32
 *     heads3        1.16      0.00      0.45
 *     heads4        1.32      0.45      0.00
 *
 * The tolerances that decide a pass are 2.6, 1.9 and 1.2 dB, so three heads
 * against four is a hit at every tier and one head against four is a hit at
 * two of the three. A decay curve says how the energy falls away and adding
 * earlier heads barely changes that - they fill in between the repeats while
 * the slope stays the feedback's. The positions are in the response and the
 * reading is not looking at them.
 *
 * Worse for an exercise, a time error swamps a pattern error: one head at
 * 300 ms against four at 400 reads 3.76 dB, so somebody could use the wrong
 * pattern and pass by getting the time right.
 *
 * So these are a sound to use and not yet a question to be asked. "Which
 * pattern?" wants a reading that looks at where the repeats are rather than
 * at how the energy goes - which is what `repeatsOf` below already describes,
 * and what diffusion would need too.
 */
export const HEAD_PATTERNS = [
  { id: 'single', label: 'One head', taps: [1] },
  { id: 'heads3', label: 'Three heads', taps: [1 / 2.75, 1.9 / 2.75, 1] },
  { id: 'heads4', label: 'Four heads', taps: [0.25, 0.5, 0.75, 1] },
];

/** One pattern, by id, and one head for anything that is not a pattern. */
export function headsOf(id) {
  return HEAD_PATTERNS.find((pattern) => pattern.id === id) ?? HEAD_PATTERNS[0];
}

/** As long as a repeat may be, and as much of it as may go round again. */
export const LONGEST_TIME = 1500;
export const SHORTEST_TIME = 20;
export const MOST_FEEDBACK = 0.8;

/**
 * How far the two sides may be pulled apart, in milliseconds.
 *
 * A hundred and fifty covers both things an offset is for. Under about thirty
 * the two sides fuse and what you hear is width rather than two echoes - the
 * precedence effect, whose threshold is five to ten milliseconds on clicks
 * and nearer fifty on music, which is why this tool's beds are music. Above
 * that they come apart into two echoes on two sides, and a hundred and fifty
 * against the shortest delay on offer is as far apart as they need to go to
 * be plainly two.
 */
export const MOST_OFFSET = 150;

/**
 * How far each of those may be moved, which is where a plugin's knob ends.
 *
 * Here rather than in the plugin because two things now need it: the plugin,
 * to lay out a slider, and the sketchpad, which stores an insert's settings
 * and has to put a loaded file's numbers back inside the range the processor
 * expects. Two tables would be two tables to keep in step, and the day they
 * drift is the day a saved sketch loads as a different sound.
 */
export const ECHO_LIMITS = {
  time: [SHORTEST_TIME, LONGEST_TIME],
  feedback: [0, MOST_FEEDBACK],
  tone: [500, 20000],
  lowCut: [20, 800],
  offset: [-MOST_OFFSET, MOST_OFFSET],
  diffusion: [0, 1],
  mix: [0, 1],
};

/**
 * The two sides' times, in milliseconds, from one setting.
 *
 * The left is the time on the knob and the right is that plus the offset,
 * clamped back into the range a delay is allowed to be - otherwise a 1500 ms
 * delay with a positive offset would ask for a line longer than anything
 * else in this app renders.
 */
export function sidesOf(settings) {
  const left = Math.min(LONGEST_TIME, Math.max(SHORTEST_TIME, settings.time));
  const offset = Math.min(MOST_OFFSET, Math.max(-MOST_OFFSET, settings.offset ?? 0));
  const right = Math.min(LONGEST_TIME, Math.max(SHORTEST_TIME, left + offset));
  return [left, right];
}

/* ---------- the loop itself ---------- */

/**
 * One delay, as state and a step.
 *
 * `set(settings)` then `stereo(left, right)` a sample at a time, which leaves
 * what came out on `left` and `right`. The same shape the compressor's core
 * has, and for the same reason: the audio thread drives it live, `makeEcho`
 * drives it offline over an impulse, and neither of them is a second
 * implementation of a delay.
 *
 * Every buffer is allocated once, for the longest line this delay is allowed
 * to be, and the read offsets move instead. Three things come of that. The
 * audio thread never allocates on a knob move. A time change becomes a move
 * of the read head, which is what a real delay does and what the time-change
 * modes will need. And the arithmetic is unchanged: a read `d` samples back
 * out of a long circular buffer is the same number as a read at the same
 * index of a buffer exactly `d` long, which is how the version this came out
 * of was written.
 *
 * What it does not do is clear the line when the time changes. Neither does
 * hardware - what you hear is the old contents at the new speed - and the
 * offline runs each build a core of their own, so nothing stale reaches a
 * reading.
 */
export function echoCore(rate) {
  const state = { ...ECHO_DEFAULTS };

  // The longest line, in samples. Both sides are clamped to LONGEST_TIME, so
  // an offset cannot push past it.
  const longest = Math.ceil((LONGEST_TIME / 1000) * rate) + 2;
  const lines = [new Float32Array(longest), new Float32Array(longest)];
  const ats = [0, 0];

  // The all-passes diffusion is made of, and the lag that compensates for
  // what they hold. Each allocated for its own widest case.
  const apBuf = [0, 1].map(() => DIFFUSE_AT.map(
    (f) => new Float32Array(Math.ceil(f * longest) + 2),
  ));
  const apAt = [[0, 0, 0], [0, 0, 0]];
  // Room for the three stages' own rounding on top of the sum of fractions.
  const lagSpan = Math.ceil(DIFFUSE_AT.reduce((sum, f) => sum + f, 0) * longest) + 8;
  const lag = [new Float32Array(lagSpan), new Float32Array(lagSpan)];
  const lagAt = [0, 0];

  const tone = [setBiquad(makeBiquad(), 'lowpass', ECHO_DEFAULTS.tone, rate),
    setBiquad(makeBiquad(), 'lowpass', ECHO_DEFAULTS.tone, rate)];
  const cut = [setBiquad(makeBiquad(), 'highpass', ECHO_DEFAULTS.lowCut, rate),
    setBiquad(makeBiquad(), 'highpass', ECHO_DEFAULTS.lowCut, rate)];
  // Up to two cascaded low-passes a channel for the medium, plus its bump.
  const mediumLp = [[makeBiquad(), makeBiquad()], [makeBiquad(), makeBiquad()]];
  const mediumBump = [makeBiquad(), makeBiquad()];

  // Everything retune() works out, held where the step can read it.
  let feedback = 0;
  let smear = 0;
  let from = 0;
  let stages = 0;
  let bumping = false;
  let mediumGain = 1;
  let madeFor = null;   // the medium the makeup above was worked out for
  const steps = [0, 0];
  const spans = [0, 0];
  const holds = [0, 0];
  const spread = [[0, 0, 0], [0, 0, 0]];
  const taps = [[], []];

  function retune() {
    const times = sidesOf(state);
    feedback = Math.min(MOST_FEEDBACK, Math.max(0, state.feedback));
    from = state.pingPongFrom === 'right' ? 1 : 0;

    // Diffusion's all-passes sit in the feedback path and add their own delay
    // to the loop, so the line is shortened by exactly as much and the loop
    // comes out at the time on the knob whatever the diffusion is. In integer
    // samples on both sides of that subtraction, or the compensation would be
    // a sample or two out and the repeats would drift.
    smear = Math.min(1, Math.max(0, state.diffusion ?? 0)) * MOST_DIFFUSE;
    for (let c = 0; c < 2; c += 1) {
      steps[c] = Math.max(1, Math.round((times[c] / 1000) * rate));
      let held = 0;
      for (let k = 0; k < DIFFUSE_AT.length; k += 1) {
        spread[c][k] = Math.max(1, Math.round(steps[c] * DIFFUSE_AT[k]));
        held += spread[c][k];
      }
      holds[c] = Math.max(1, held);
      spans[c] = Math.max(1, steps[c] - held);

      // Where each shorter head reads, in samples back from the write head.
      // A head at a fraction of the loop has to come out at that fraction of
      // the time, and everything read here goes out through the lag - so the
      // offset into the line is the fraction of the whole loop less what the
      // all-passes hold. Measured against the full step and not the shortened
      // line, which is the mistake that put four heads at 76, 152, 228 ms
      // instead of 100, 200, 300.
      taps[c] = headsOf(state.heads).taps
        .slice(0, -1)
        .map((tap) => Math.round(steps[c] * tap) - held)
        .filter((d) => d >= 1 && d < spans[c]);

      setBiquad(tone[c], 'lowpass', state.tone, rate);
      setBiquad(cut[c], 'highpass', state.lowCut, rate);
    }

    // The machine's own response, which is not a knob: its corner comes from
    // the delay time and the medium, and it sits on the way into the line
    // rather than in the feedback path with the user's filters. That is the
    // difference between a medium and an EQ - a signal goes through a bucket
    // brigade once to come back once, so the first repeat is already dark,
    // where the tone knob leaves it alone by design.
    const medium = machineTone(state.machine, times[0]);
    stages = medium ? medium.stages : 0;
    bumping = !!medium && medium.bump > 0;
    for (let c = 0; c < 2; c += 1) {
      for (let k = 0; k < stages; k += 1) {
        setBiquad(mediumLp[c][k], 'lowpass', medium.corner, rate);
      }
      if (bumping) setBiquad(mediumBump[c], 'peaking', medium.bumpAt, rate, medium.bump);
    }
    // The makeup costs a quarter of a second of filtered tone to work out,
    // and `set` is called on every knob move - including the mix, which the
    // medium does not depend on. So it is worked out when the medium itself
    // changes and remembered otherwise. The number is the same number.
    const asked = medium
      ? `${medium.stages}|${medium.corner}|${medium.bump}|${medium.bumpAt}`
      : '';
    if (asked !== madeFor) {
      madeFor = asked;
      mediumGain = medium ? makeupFor(medium, rate) : 1;
    }
  }

  /** One pass through the medium, if there is one. No gain: see makeupFor. */
  function through(c, x) {
    let value = x;
    for (let k = 0; k < stages; k += 1) value = runBiquad(mediumLp[c][k], value);
    if (bumping) value = runBiquad(mediumBump[c], value);
    return value;
  }

  /** One all-pass stage, in place. */
  function allpass(c, k, x) {
    const buf = apBuf[c][k];
    const at = apAt[c][k];
    const was = buf[(at - spread[c][k] + buf.length) % buf.length];
    const out = was - smear * x;
    buf[at] = x + smear * out;
    apAt[c][k] = (at + 1) % buf.length;
    return out;
  }

  const core = {
    left: 0,
    right: 0,

    set(next) {
      Object.assign(state, next);
      retune();
      return core;
    },

    params() { return { ...state }; },

    /** One sample in on each side, one sample out on each. */
    stereo(inL, inR) {
      const feedIn = [inL, inR];

      // The longest head: the sample written a whole line ago, which is both
      // an output and the only thing that goes round again.
      const takenL = lines[0][(ats[0] - spans[0] + longest) % longest];
      const takenR = lines[1][(ats[1] - spans[1] + longest) % longest];
      const taken = [takenL, takenR];

      // Out through the lag, so the first repeat lands on the time even
      // though it is read in front of the all-passes.
      const heard = [0, 0];
      for (let c = 0; c < 2; c += 1) {
        const span = lag[c].length;
        heard[c] = lag[c][(lagAt[c] - holds[c] + span) % span];
        // And the shorter heads, which are heard and not fed back - so a
        // pattern repeats as a pattern instead of each head breeding its own
        // train. Into the lag with the longest head rather than straight out:
        // they are read in front of the all-passes too, so they owe the same
        // compensation, and adding them to what is leaving would sound them
        // early by exactly what the all-passes hold.
        // Summed into the buffer and not into a local, which is not the
        // indirection it looks like: the element is a float32, so each head
        // added rounds to single precision. Summing in a double and storing
        // once is more accurate and is a different number, and the one in
        // every response this app has drawn and marked is this one. Visible
        // only with diffusion on - without it the response is sparse spikes
        // and the heads rarely carry anything at the same sample, so there is
        // nothing to round.
        lag[c][lagAt[c]] = taken[c];
        for (let t = 0; t < taps[c].length; t += 1) {
          lag[c][lagAt[c]] += lines[c][(ats[c] - taps[c][t] + longest) % longest];
        }
      }

      // Each side is filtered once a sample, and then routed. Filtering it
      // again on the way past the other channel would be running one
      // filter's state forward twice in a sample, which is a different
      // filter.
      const rounded = [0, 0];
      for (let c = 0; c < 2; c += 1) {
        let value = taken[c];
        if (state.tone < 20000) value = runBiquad(tone[c], value);
        if (state.lowCut > 20) value = runBiquad(cut[c], value);
        // The all-passes last, so what gets smeared is what is going round
        // again rather than what is coming out. At a coefficient of nothing
        // each one is `x[n-M]` exactly, with no arithmetic left in it, so the
        // whole chain is a pure delay and no diffusion is bit-identical to a
        // delay that never had any.
        for (let k = 0; k < apBuf[c].length; k += 1) value = allpass(c, k, value);
        rounded[c] = value;
      }

      for (let c = 0; c < 2; c += 1) {
        // Ping-pong sends what came out of one ear into the other, so the
        // repeats walk across rather than sitting on top of each other - and
        // the input lands in one line alone, because that is what starts them
        // alternating. Which one is a setting.
        const feeds = state.pingPong ? 1 - c : c;
        const feed = state.pingPong
          ? (c === from ? (inL + inR) / 2 : 0)
          : feedIn[c];
        lines[c][ats[c]] = through(c, feed + rounded[feeds] * feedback);
      }

      lagAt[0] = (lagAt[0] + 1) % lag[0].length;
      lagAt[1] = (lagAt[1] + 1) % lag[1].length;
      ats[0] = (ats[0] + 1) % longest;
      ats[1] = (ats[1] + 1) % longest;

      core.left = heard[0] * mediumGain;
      core.right = heard[1] * mediumGain;
      return core;
    },
  };

  retune();
  return core;
}

/**
 * What the medium costs, to be taken back off it.
 *
 * A machine that changed the level would make choosing one a loudness test,
 * which is the one comparison this app refuses to leave in. Measured on an
 * impulse at 400 ms, before this:
 *
 *     digital   peak   0.00 dB   energy   3.77 dB
 *     tape      peak  -9.03 dB   energy  -1.04 dB
 *     bbd       peak -20.97 dB   energy  -7.86 dB
 *
 * Five decibels of energy for tape and twelve for a bucket brigade, which is
 * a volume knob wearing a machine's name. Hardware does not do that either: a
 * BBD pedal has a compander across the chip and 0 to 2 dB of insertion gain,
 * and a tape machine has a record level.
 *
 * So the chain's gain is measured once, here, and divided out on the way to
 * the ears - on the output and not inside the loop, which is the whole of
 * what makes this safe. Putting it in the loop multiplies the feedback by it:
 * at 400 ms a bucket brigade's chain wants 3.8 times gain, so a feedback of
 * 0.4 became a loop gain of 1.52 and the thing ran away. Measured as it did,
 * the response came out at +27.78 dB of energy against digital's +3.77.
 *
 * Outside the loop it corrects the first repeat and leaves the compounding
 * alone, which is right: a pass through a bucket brigade costs top end, so
 * each repeat really is darker and shorter-lived than the last, and a machine
 * with fewer usable repeats than a digital delay is a machine behaving. What
 * is taken out is the insertion loss - the 0 to 2 dB a real pedal makes up
 * with a compander - and not the medium itself.
 *
 * Referenced to a tone in the body of the sound rather than to the whole
 * impulse's energy, which was the first thing tried and is wrong in a way
 * that reads as a feature. Matching total energy gives a dark machine all of
 * its lost energy back across whatever bandwidth it has left, so it comes out
 * bassier than a digital delay rather than merely duller - measured, a bucket
 * brigade read 12.8 dB hotter than digital over 60 to 400 Hz. Matching one
 * tone below every corner this allows leaves the body where it was and lets
 * the top go, which is what a machine takes.
 *
 * A tone run until it settles rather than the filters' magnitude worked out
 * in closed form, which would be exact and free. The probe samples a
 * sinusoid at whole samples and so reads a hair under its true peak, and that
 * hair is in every delay this app has ever drawn or marked. Keeping it is
 * keeping those numbers.
 */
export function makeupFor(medium, rate) {
  const probe = [makeBiquad(), makeBiquad()];
  for (let k = 0; k < medium.stages; k += 1) {
    setBiquad(probe[k], 'lowpass', medium.corner, rate);
  }
  const bump = medium.bump > 0
    ? setBiquad(makeBiquad(), 'peaking', medium.bumpAt, rate, medium.bump)
    : null;

  // A tone at MEDIUM_REF, run until it settles, and the amplitude of what
  // comes out. Below every corner a machine is allowed and above every head
  // bump, so it is measuring the flat part of the response rather than any of
  // the shape.
  const settle = Math.ceil(rate * 0.25);
  let loudest = 0;
  for (let i = 0; i < settle; i += 1) {
    let value = Math.sin((2 * Math.PI * MEDIUM_REF * i) / rate);
    for (let k = 0; k < medium.stages; k += 1) value = runBiquad(probe[k], value);
    if (bump) value = runBiquad(bump, value);
    // The last tenth, by which time the filters have forgotten their start.
    if (i > settle * 0.9) loudest = Math.max(loudest, Math.abs(value));
  }
  return loudest > 1e-6 ? 1 / loudest : 1;
}
