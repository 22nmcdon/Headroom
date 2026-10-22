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
// One analyser a view, built when the plugin opens and dropped when it
// closes. Leaving one on every insert of every track would be eight FFTs
// running for a page nobody is looking at.

/** How finely the analyser reads, and how fast it settles by default. */
export const BINS = 4096;
export const SETTLING = 0.72;

/**
 * An effect in a chain, as a player.
 *
 * `transport` is asked rather than driven: the sketchpad's clock belongs to
 * the sketchpad, and a Play button inside a plugin that stopped the whole
 * sketch would be a surprise. The interface hides its transport for an
 * insert, and this reports the real state for anything that still asks.
 */
export function insertPlayer(ctx, effect, { transport = null } = {}) {
  const analyser = ctx.createAnalyser();
  analyser.fftSize = BINS;
  analyser.smoothingTimeConstant = SETTLING;

  // A tap, not a link in the chain: the analyser has nothing connected
  // after it, so what it reads is what leaves the effect and the signal
  // itself is untouched.
  effect.out.connect(analyser);

  const bins = new Float32Array(analyser.frequencyBinCount);

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

    setBands(next) { effect.set(next); },

    spectrum() {
      analyser.getFloatFrequencyData(bins);
      return bins;
    },

    setBallistics(value) {
      analyser.smoothingTimeConstant = Math.max(0, Math.min(0.95, value));
    },

    get playing() { return Boolean(transport?.playing); },
    play() { /* the sketchpad's transport, not this one's */ },
    stop() { /* nor this one's to stop */ },

    /* --- the half an exercise has and a track does not ------------------ */

    get soloing() { return null; },
    setSolo() {},
    setTarget() {},
    setFault() {},
    hear() {},
    load: async () => null,

    destroy() {
      try { effect.out.disconnect(analyser); } catch { /* already gone */ }
      try { analyser.disconnect(); } catch { /* already gone */ }
    },
  };
}
