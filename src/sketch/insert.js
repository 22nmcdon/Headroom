// A track's insert, as something a plugin's interface can drive.
//
// The six tools are real plugins and the sketchpad's inserts are the same
// processing, so there is no good reason for the insert to be four knobs
// while the tool is a full interface. What stood in the way was that each
// plugin built its own player in its constructor: the interface owned its
// audio, which is right for an exercise - the loop, the A/B, the target are
// all the player's - and wrong for a track, where the audio is already in
// somebody's signal path and the plugin is a view onto it.
//
// So the plugin takes its player as an argument, and this is what a track
// hands it. The half that belongs to an exercise - loading a file, setting
// a fault, A/B-ing against an answer - is not refused, it is simply not
// there to do, and the interface hides the controls for it.
//
// The other half is live, and it is the half that matters here. An exercise
// renders a fixed loop and reads the result; a track has whatever is playing
// this bar, so the displays are fed from taps on the real signal instead:
// the spectrum behind the EQ's curve, the peaks either side of the
// compressor, the field the imager's scope draws. What the plugin is looking
// at is what is going through the track.
//
// Analysers are built for the plugin that is open and dropped when it
// closes, and only the ones that plugin reads. Leaving one on every insert
// of every track would be eight FFTs running for a page nobody is looking
// at.

/** How finely the analyser reads, and how fast it settles by default. */
export const BINS = 4096;
export const SETTLING = 0.72;

/** How long a window a meter reads a peak over. */
export const METER_WINDOW = 1024;

/** What a silent analyser reads as, rather than minus infinity. */
export const QUIET = -60;

/** Which plugin reads which tap. Nothing is built that nothing reads. */
const LISTENS_TO = {
  eq: { spectrum: true },
  compression: { meters: true },
  panning: { ears: true },
  saturation: {},
  reverb: {},
  delay: {},
};

/** The loudest sample in a window, in dB. */
function loudestDb(analyser) {
  const frame = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(frame);
  let peak = 0;
  for (const sample of frame) {
    const level = sample < 0 ? -sample : sample;
    if (level > peak) peak = level;
  }
  return 20 * Math.log10(peak + 1e-6);
}

/**
 * An effect in a chain, as a player.
 *
 * `transport` is asked rather than driven: the sketchpad's clock belongs to
 * the sketchpad, and a Play button inside a plugin that stopped the whole
 * sketch would be a surprise. The interface hides its transport for an
 * insert, and this reports the real state for anything that still asks.
 *
 * `before` is whatever feeds this effect - the chain's input, or the insert
 * in front of it. Only the compressor asks for it, and only so its meter can
 * show what went in beside what came out.
 */
export function insertPlayer(ctx, effect, { transport = null, before = null } = {}) {
  const wants = LISTENS_TO[effect.id] ?? {};
  const made = [];

  const listen = (node, size, smoothing = 0) => {
    const analyser = ctx.createAnalyser();
    analyser.fftSize = size;
    analyser.smoothingTimeConstant = smoothing;
    node.connect(analyser);
    made.push([node, analyser]);
    return analyser;
  };

  // A tap, not a link in the chain: an analyser has nothing connected after
  // it, so what it reads is what leaves the effect and the signal itself is
  // untouched.
  const spectrum = wants.spectrum ? listen(effect.out, BINS, SETTLING) : null;
  const output = listen(effect.out, METER_WINDOW);
  const input = wants.meters && before ? listen(before, METER_WINDOW) : null;

  // The two ears, for a display that is about the difference between them.
  let ears = null;
  if (wants.ears) {
    const split = ctx.createChannelSplitter(2);
    effect.out.connect(split);
    made.push([effect.out, split]);
    ears = [0, 1].map((channel) => {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = BINS;
      analyser.smoothingTimeConstant = 0;
      split.connect(analyser, channel);
      made.push([split, analyser]);
      return analyser;
    });
  }

  const bins = spectrum ? new Float32Array(spectrum.frequencyBinCount) : null;

  return {
    ready: true,
    bands: effect.params?.() ?? [],

    /**
     * No measured weights, which the auto gain already has a word for.
     *
     * A tool measures the loop it is playing and weights the auto gain by
     * what is actually in it. A track's material is whatever the clip is
     * this bar, so there is nothing fixed to measure - and `averageLift`
     * treats a missing weighting as every octave counting the same, which
     * is a fair guess and says so.
     */
    weights: null,

    /* --- the settings, which are the effect's own ------------------------ */

    setBands(next) { effect.set(next); },
    setSettings(next) { effect.set(next); },

    /**
     * Auto gain, which belongs to the effect on the track rather than to the
     * view of it. A face with the switch wired to nothing on an insert and to
     * something in a tool is two plugins wearing one chassis.
     */
    setAuto(on) { effect.setAuto?.(on); },

    /* --- what is going through it --------------------------------------- */

    spectrum() {
      if (!spectrum) return null;
      spectrum.getFloatFrequencyData(bins);
      return bins;
    },

    setBallistics(value) {
      if (spectrum) spectrum.smoothingTimeConstant = Math.max(0, Math.min(0.95, value));
    },

    /** The peak out of it, which is what a plugin writes in its corner. */
    level: () => loudestDb(output),

    /** And either side of it, for a compressor's in / gr / out. */
    levels: () => ({
      input: input ? loudestDb(input) : QUIET,
      output: loudestDb(output),
    }),

    /**
     * The deepest reduction since this was last asked.
     *
     * The compressor's own node keeps it - the worklet reports it from the
     * audio thread - so this is the same number the tool's meter shows, off
     * the same counter, and asking resets it the same way.
     */
    reduction() {
      const deepest = effect.readReduction?.() ?? 0;
      return Number.isFinite(deepest) ? Math.min(0, deepest) : 0;
    },

    frames() {
      if (!ears) return null;
      const left = new Float32Array(ears[0].fftSize);
      const right = new Float32Array(ears[1].fftSize);
      ears[0].getFloatTimeDomainData(left);
      ears[1].getFloatTimeDomainData(right);
      return { left, right };
    },

    /* --- the half an exercise has and a track does not ------------------ */

    // A plugin reads these to decide what to draw and what to grey out. They
    // are not stubs that lie: there is no loop, no answer and no fault on a
    // track, and every one of these says so.
    source: null,
    buffer: null,
    target: null,
    mine: null,
    theirs: null,
    key: null,
    uneven: 0,
    samples: null,
    evenSamples: null,
    keySamples: null,
    trace: null,
    targetTrace: null,
    position: 0,
    reading: null,
    auto: false,
    trim: 0,

    get playing() { return Boolean(transport?.playing); },
    get soloing() { return null; },

    prepare: async () => true,
    play() { /* the sketchpad's transport, not this one's */ },
    stop() { /* nor this one's to stop */ },
    measure() { return null; },
    push() {},
    sample() { return null; },
    setSolo() {},
    setTarget() {},
    setFault() {},
    setAuto() {},
    hear() {},
    load: async () => null,

    destroy() {
      for (const [from, to] of made) {
        try { from.disconnect(to); } catch { /* already gone */ }
        try { to.disconnect(); } catch { /* already gone */ }
      }
    },
  };
}
