// What an effect is, once it has to go in series with another one.
//
// The six plugins were each built as a whole thing: source at one end, the
// output at the other, and the processing somewhere in the middle with no way
// to get at it. That is the right shape for a tool you work at on its own and
// the wrong one for everything coming next. A mix exercise wants three of
// them on a stem; a sketchpad track wants the same; and in both cases what is
// needed is a box with two ends.
//
// So: an effect is an input node, an output node, a way to set its
// parameters, and a way to take it apart. Nothing about a display, nothing
// about an A/B, nothing about where the sound came from or where it is going.
// A plugin can still be built on one - it adds a face and a source either
// side - and so can a track in a grid.
//
// None of this can be tested by `npm test`, because an AudioNode needs a
// browser. The pure parts are tested there; the graphs are measured in
// Chromium and the numbers written down beside them, which is how every other
// audio claim in this project is checked.

/**
 * The contract.
 *
 * `in` and `out` are the two ends. `set` takes whatever that effect's
 * parameters are - the same objects the plugins already pass around, so
 * nothing has to be translated. `read` is optional and gives back the tool's
 * own measurement where there is one, in the envelope from `src/lib/read.js`.
 */
export const EFFECT_SHAPE = ['id', 'in', 'out', 'set', 'destroy'];

/** Does this thing have two ends and a way to be set? */
export function isEffect(effect) {
  if (!effect || typeof effect !== 'object') return false;
  return EFFECT_SHAPE.every((key) => (
    key === 'set' || key === 'destroy' ? typeof effect[key] === 'function' : effect[key] != null
  ));
}

/**
 * Several effects, in series.
 *
 * Returns something with the same two ends, so a chain is itself an effect
 * and can go wherever one goes - including inside another chain, which is not
 * a thing a sketchpad needs but is a thing that falling out of the shape for
 * free says the shape is right.
 *
 * An empty chain is a wire. That is not a special case to be guarded against
 * somewhere else: a track with no inserts on it is the common case, and a
 * chain that could not be empty would mean every caller writing the branch.
 */
export function chainOf(ctx, effects = []) {
  const entry = ctx.createGain();
  const exit = ctx.createGain();

  let at = entry;
  for (const effect of effects) {
    if (!isEffect(effect)) throw new Error(`${effect?.id ?? 'something'} is not an effect`);
    at.connect(effect.in);
    at = effect.out;
  }
  at.connect(exit);

  return {
    id: 'chain',
    in: entry,
    out: exit,
    effects,

    /** Set one of them, by id or by position. */
    set(which, params) {
      const effect = typeof which === 'number' ? effects[which] : effects.find((e) => e.id === which);
      effect?.set(params);
      return this;
    },

    /**
     * What feeds one of them: the chain's own input, or the one in front.
     *
     * An effect knows where its signal goes and not where it came from, and
     * a meter that shows what went in has to tap the thing upstream. The
     * chain is the only thing that knows which that is.
     */
    feeding(which) {
      const index = typeof which === 'number' ? which : effects.findIndex((e) => e.id === which);
      if (index < 0) return null;
      return index === 0 ? entry : effects[index - 1].out;
    },

    destroy() {
      // Disconnect before destroying, and in the order the signal runs: a
      // node taken apart while something upstream is still feeding it is how
      // a click gets into the output of an otherwise correct teardown.
      try { entry.disconnect(); } catch { /* already gone */ }
      for (const effect of effects) {
        try { effect.out.disconnect(); } catch { /* already gone */ }
        effect.destroy();
      }
      try { exit.disconnect(); } catch { /* already gone */ }
    },
  };
}

/**
 * A wet/dry pair around something that only makes the wet part.
 *
 * A convolver has no dry path of its own: it hands back the room and nothing
 * else, and a reverb at 30 per cent is a mix of that with the signal that
 * went in. Written once here because the reverb and the delay both want it
 * and they are the same arithmetic - the only difference is which impulse.
 *
 * Equal-gain rather than equal-power. A room at half mix should be half the
 * room, which is what somebody reaching for the control means; equal-power
 * would make the wet 0.71 at the middle and the two sides would not add up
 * to what either of them says.
 */
export function wetDry(ctx, wetNode) {
  const entry = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const exit = ctx.createGain();

  entry.connect(dry).connect(exit);
  entry.connect(wetNode);
  wetNode.connect(wet).connect(exit);

  dry.gain.value = 1;
  wet.gain.value = 0;

  return {
    in: entry,
    out: exit,
    /** 0 is dry, 1 is nothing but the effect. */
    setMix(amount, at = ctx.currentTime) {
      const mix = Math.max(0, Math.min(1, amount));
      dry.gain.setTargetAtTime(1 - mix, at, 0.01);
      wet.gain.setTargetAtTime(mix, at, 0.01);
    },
    destroy() {
      for (const node of [entry, dry, wet, exit]) {
        try { node.disconnect(); } catch { /* already gone */ }
      }
    },
  };
}
