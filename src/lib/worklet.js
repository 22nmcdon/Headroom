// Getting a piece of DSP onto the audio thread without writing it twice.
//
// Every processor in this app that is not a filter is a function written once
// in a module and then needed in three places: the audio thread that makes
// the sound, the scoring that reads a guess, and the tests that measure it.
// Keeping a second copy of it in a template literal would mean two
// processors, and the day they drifted apart the game would be marking people
// against a sound nobody made.
//
// So the worklet is written out of the module's own source: the functions are
// stringified and handed to the audio thread verbatim. What each processor
// still owns is its own process() - what its inputs mean and what it reports
// back - because that part really does differ.

/**
 * A worklet module, as source.
 *
 * `constants` are the module-level values the functions read, written out as
 * a table rather than spelled into a template, for two reasons. The values
 * come from the real constants, so the audio thread cannot drift from the
 * module. And the declarations never appear as source in the calling file,
 * which keeps the bundler's duplicate-name check from reading a string as a
 * second declaration of something a module already owns.
 */
export function workletModule({ constants = {}, parts = [], processor }) {
  const prelude = Object.entries(constants)
    .map(([name, value]) => `const ${name} = ${value};`)
    .join('\n');

  return `${prelude}

${parts.map((part) => part.toString()).join('\n\n')}

${processor}`;
}

/**
 * Loads a worklet into a context once, and remembers whether it took.
 *
 * Keyed by the context AND the module, which it was not. A WeakMap on the
 * context alone meant the first processor installed into a context won and
 * every later one silently was not added at all - `addModule` was never
 * called for it, and the cached `true` from the first said everything was
 * fine. Constructing the node then threw "the node name is not defined in
 * AudioWorkletGlobalScope", from the one place that reads as a browser
 * problem rather than as a cache.
 *
 * It was invisible for as long as a tool was torn down when you left it: you
 * heard whichever of the three worklet processors you opened first, and the
 * other two fell back to the main-thread path or failed outright. Three
 * tools, one slot.
 */
const loaded = new WeakMap();

export function installWorklet(ctx, source) {
  if (!loaded.has(ctx)) loaded.set(ctx, new Map());
  const perContext = loaded.get(ctx);
  if (perContext.has(source)) return perContext.get(source);

  const attempt = (async () => {
    if (!ctx.audioWorklet) return false;
    const url = URL.createObjectURL(new Blob([source], { type: 'application/javascript' }));
    try {
      await ctx.audioWorklet.addModule(url);
      return true;
    } catch {
      // Blocked, or an older browser. Whoever asked has a fallback.
      return false;
    } finally {
      URL.revokeObjectURL(url);
    }
  })();

  perContext.set(source, attempt);
  return attempt;
}
