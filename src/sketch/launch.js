// What a track plays while a launch is landing.
//
// Pressing a clip has to do something on a bar line rather than under your
// finger, or two parts started a moment apart never line up. The transport
// already knows where the next bar is; what is here is the other half of it -
// a scheduling window that a bar line falls inside has to be booked in two
// pieces, the old clip up to the line and the new one after it.
//
// It is arithmetic and nothing else, so it is here rather than in the stage,
// and the off-by-ones are in a test rather than in your ears.
//
// A clip's phase is anchored to the tick it was launched at, not to the
// global grid. Press a two-bar clip on bar three and you hear its first bar,
// which is what anybody pressing it expects. Scenes stay together because a
// scene launch gives every track the same anchor.

/** Where a track is: which scene, since when, and what is coming. */
export const resting = (scene = null, anchor = 0) => ({ scene, anchor, next: null });

/** Queue a scene - `null` to stop - to land at a tick. */
export const queue = (state, scene, at) => ({ ...state, next: { scene, at } });

/** Nothing queued any more. The press that is taken back before it lands. */
export const unqueue = (state) => ({ ...state, next: null });

/**
 * One scheduling window, split where a launch lands in it.
 *
 * Returns the pieces to book and the state after the window. A piece on no
 * scene is left out rather than returned empty, because "play nothing" is not
 * a thing a caller should have to check for.
 *
 * A launch whose tick has already gone by - a pass that was late, or a launch
 * queued for a bar line the booking had already passed - lands across the
 * whole window rather than being dropped. Its anchor is still the tick it was
 * meant for, so the clip is in the phase it would have been in.
 */
export function booking(from, to, state) {
  const { scene, anchor, next } = state;

  if (!next || next.at >= to) {
    return { pieces: playing(from, to, scene, anchor), state };
  }

  const at = Math.max(from, next.at);
  const after = { scene: next.scene, anchor: next.at, next: null };

  return {
    pieces: [
      ...playing(from, at, scene, anchor),
      ...playing(at, to, next.scene, next.at),
    ],
    state: after,
  };
}

const playing = (from, to, scene, anchor) =>
  (scene === null || to <= from ? [] : [{ from, to, scene, anchor }]);
