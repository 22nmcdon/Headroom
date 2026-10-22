// Tapping a rhythm in.
//
// Drawing a drum part on a grid is fine for a part you already know and
// hopeless for one you do not: a groove is a thing hands know before heads
// do, and the way to get it out is to play it. So: three pads, the clock
// running, and whatever you tap lands on the nearest line of the grid.
//
// Nearest, not the line before. A hit played a hair early is a hit on the
// beat played by somebody with good time; rounding it down puts it a whole
// step early, which is the one thing that makes a quantiser feel broken.
//
// All of it is arithmetic over ticks, so the off-by-ones are in a test and
// not in the hands of whoever is tapping.

/**
 * The nearest line of the grid, wrapped into the clip.
 *
 * A tap in the last half-step of a clip belongs on its first line, not on a
 * line past the end: the clip is a loop, and the hit that lands a hair
 * before the one is the one.
 */
export function snap(tick, step, length) {
  if (!(step > 0) || !(length > 0)) return 0;

  const lines = Math.round(length / step);
  const at = Math.round(tick / step);
  return (((at % lines) + lines) % lines) * step;
}

/**
 * A tap, as the clip's notes.
 *
 * A second hit on a line that already has one is left alone rather than
 * doubled: two notes at the same tick on the same drum is one hit at twice
 * the velocity, and nobody taps that on purpose.
 */
export function tapInto(clip, pitch, tick, step, { velocity = 100 } = {}) {
  const notes = clip?.notes ?? [];
  const length = clip?.length ?? 0;
  if (!(length > 0)) return notes;

  const at = snap(tick, step, length);
  if (notes.some((note) => note.pitch === pitch && note.start === at)) return notes;

  return [...notes, {
    pitch,
    start: at,
    length: Math.max(1, Math.min(step, length - at)),
    velocity: Math.max(1, Math.min(127, Math.round(velocity))),
  }];
}

/**
 * How far a tap was from the line it landed on, in ticks and signed.
 *
 * Positive is late. Not used to move anything - the note is already on the
 * line - but worth having: somebody who is consistently twenty ticks early
 * is somebody the interface can tell, and a run of these is the only
 * feedback a quantised pad can honestly give.
 */
export function drift(tick, step, length) {
  if (!(step > 0) || !(length > 0)) return 0;
  const to = snap(tick, step, length);
  const raw = ((tick % length) + length) % length;
  const off = raw - to;
  // Across the loop point, the short way round is the right way.
  if (off > length / 2) return off - length;
  if (off < -length / 2) return off + length;
  return off;
}

/** The average of a run of drifts, for saying whether somebody is early. */
export const timing = (drifts) =>
  (drifts.length ? drifts.reduce((sum, off) => sum + off, 0) / drifts.length : 0);
