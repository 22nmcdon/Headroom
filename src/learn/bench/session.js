// Putting an exercise on a tool, and taking it back off.
//
// The inversion, in one file. Until now an exercise mounted a plugin and the
// plugin was destroyed when the exercise changed - so changing the dropdown
// tore the tool down, stopped the audio, and built a new one. That is the
// wrong way round for a workbench: the tool is the thing you are working at,
// and an exercise is something that arrives, sets it up, and leaves.
//
// Everything here is decisions rather than drawing. There are no DOM classes
// below this line and no canvas; what a tool is, as far as this is concerned,
// is the dozen methods in the contract. That is deliberate - it means the
// order things happen in, what is restored, and what happens when material
// never arrives can all be tested headless against a tool made of nothing but
// promises, which is where the awkward cases actually live.
//
// The risk this was written for: `destroy()` has run before every mount this
// app has ever done, so no plugin has ever had to survive a state change.
// `lock()` had no inverse until a stage ago, `showTarget` left a ghost drawn
// over the next exercise, and `setTarget(null)` had never been called by
// anybody - the EQ's would have walked null as an array. Attaching twice in a
// row exercises all of it.

/**
 * What a tool was doing before an exercise arrived.
 *
 * Not whether it is playing: nothing in an attach stops the audio, which is
 * the whole point of the inversion - the loop keeps running and a new exercise
 * is a crossfade rather than a stop. And `playing` on these plugins is a
 * setter, so calling it to ask would answer by turning the sound off.
 */
function snapshotOf(tool) {
  return {
    state: tool.state(),
    source: tool.source?.() ?? null,
    abLabel: tool.abLabel?.() ?? null,
  };
}

/**
 * Hand a tool to an exercise.
 *
 * Returns a detach, which is the only way back. Order matters and is not
 * arbitrary:
 *
 *   1. remember what the tool was doing, before anything touches it
 *   2. put the exercise's material on, and WAIT for it
 *   3. pin that material on the exercise - what you are marked on is fixed now
 *   4. fault, then target, then the A/B's name
 *   5. the starting settings last, so `onChange` fires once, at the end
 *
 * `startOf` is the fifth step asked of the puzzle rather than fixed on the
 * exercise, and it is deliberately after the material. A drill that asks how
 * much a compressor is doing has to set a compressor that does that much to
 * THIS loop, which cannot be worked out until the loop exists - so it is
 * worked out here, where it does.
 *
 * Material is awaited rather than set and hoped for. The compression exercise
 * used to fill `puzzle.material` from an unawaited IIFE and fall back to a
 * synthetic probe when it had not arrived - which in a live workbench is
 * "marked on drums while hearing noise". Here its absence is an explicit
 * not-ready state and the round says so.
 */
export async function attach(tool, exercise, puzzle = {}) {
  const before = snapshotOf(tool);

  // Nothing is drawn from the last exercise while this one is arriving.
  tool.showTarget(null);
  tool.unlock?.();

  if (exercise.source) await tool.setSource(exercise.source, exercise.sourceOptions ?? {});

  // What a guess is marked against, rendered once and pinned. The monitor
  // source stays free after this: changing what you listen to must not change
  // what you are scored on, or the way to pass is to switch to pink noise
  // where every setting does much the same thing.
  await materialFor(tool, exercise, puzzle);

  if (exercise.faultOf) await tool.setFault(exercise.faultOf(puzzle));
  if (exercise.targetOf) await tool.setTarget(exercise.targetOf(puzzle));
  if (exercise.other) tool.nameAB(exercise.other);

  tool.setState(exercise.startOf?.(puzzle) ?? exercise.start ?? before.state);

  let done = false;
  return async function detach() {
    // Idempotent, and awaitable. Half of what it undoes is asynchronous -
    // taking a fault out of the material means rendering the loop again - and
    // a detach that fired those and returned left them to land on a tool that
    // had since been torn down.
    if (done) return;
    done = true;

    // In the reverse order, and all of it. What is being undone is not the
    // settings - somebody may want to keep working from where the exercise
    // left them - it is everything the exercise imposed: the drawn answer,
    // the lock, the fault in the material, the other side of the A/B.
    //
    // The settings are the exception when the exercise set them itself. An
    // exercise that drives the tool's own controls is a drill, the controls
    // are the answer, and leaving them where they were put means the next
    // exercise opens with the last drill's answer sitting on the knobs.
    if (exercise.restores) tool.setState(before.state);
    tool.showTarget(null);
    tool.unlock?.();
    await tool.setTarget(null);
    if (exercise.faultOf) await tool.setFault(null);
    if (exercise.other && before.abLabel) tool.nameAB(before.abLabel);
    if (exercise.source && before.source && before.source !== exercise.source) {
      await tool.setSource(before.source);
    }
  };
}

/**
 * The loop an answer is read against.
 *
 * Asked of the tool, because only the tool knows what its own material is -
 * a compressor needs samples and a key, an imager needs two channels, and a
 * delay needs no audio at all because it is built from numbers. A tool with
 * nothing to render says so by returning null, and that is not a failure.
 */
async function materialFor(tool, exercise, puzzle) {
  if (!tool.material) return null;

  const material = await tool.material().catch(() => null);
  // Pinned on the puzzle rather than handed back, because the scorer is given
  // the puzzle and nothing else - and because pinning it is what stops it
  // moving when the monitor source does.
  if (material) puzzle.material = material;
  return material;
}

/**
 * One tool, one exercise at a time.
 *
 * A thin thing over `attach`, and the only piece of state a shell needs to
 * keep: whatever was attached last is detached before the next one lands.
 * Without it, two exercises on one tool leave two sets of impositions and the
 * second detach restores a snapshot taken after the first had already changed
 * things.
 */
export function bench() {
  let release = null;
  let current = null;
  // Serialised, because `attach` awaits. Two calls in quick succession - which
  // is one dropdown change arriving while the last one is still rendering its
  // loop - would otherwise both start, both resolve, and the second would
  // overwrite the first's detach without ever running it. Everything the first
  // exercise imposed would then be left on the tool forever.
  let queue = Promise.resolve();

  return {
    put(tool, exercise, puzzle) {
      queue = queue.then(async () => {
        await release?.();
        release = await attach(tool, exercise, puzzle);
        current = { tool, exercise };
      }).catch(async (why) => {
        // An exercise that cannot be set up leaves the bench empty rather
        // than half-attached, and never wedges the queue for the next one.
        //
        // And it says so. This swallowed the reason for a while, which meant
        // a tool whose contract had a hole in it looked exactly like a tool
        // with nothing to do: the exercise simply never arrived, in silence.
        console.error('[bench] could not put an exercise on the tool:', why);
        await release?.().catch(() => {});
        release = null;
        current = null;
      });
      return queue;
    },

    clear() {
      queue = queue.then(async () => {
        await release?.();
        release = null;
        current = null;
      });
      return queue;
    },

    /** Whatever is on the bench, or null. */
    get on() { return current; },

    /** Everything the bench has been asked to do has happened. */
    settled() { return queue; },
  };
}
