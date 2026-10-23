// The grid everything in this app is cut to.
//
// Here rather than in the engine because the delay needs it to write a time
// in beats, and a plugin that has to import the engine to name a beat is a
// plugin that cannot be lifted out of this app. See tests/seams.test.js.

/**
 * The shape of every loop this app plays: two bars of four, at 96.
 *
 * Named because things outside the engine need them. A reverb asked to clear
 * by the next beat has to know how long a beat is, and working that out
 * backwards from the loop's length would be working out an answer from an
 * answer.
 */
export const LOOP_BPM = 96;
export const LOOP_BARS = 2;
export const LOOP_BEAT = 60 / LOOP_BPM;
