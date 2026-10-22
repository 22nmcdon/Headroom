// Somewhere to start.
//
// A first visit used to open the help dialog and then drop you into the EQ's
// match exercise, which is the hardest thing in the app to arrive at cold:
// a six-band parametric, a target you cannot see, and no indication that
// there is an easier way in. The path is the easier way in.
//
// It is not new content and it is not a course. Every step is something that
// was already there, put in an order somebody learning would meet them in -
// read what the tool is for, be asked one question about it, then go and
// build one. What the path adds is the order and a record of where you are.
//
// Nothing is locked. Unlocks would make this a gate, and a gate is exactly
// wrong for an app somebody might open knowing precisely what they want to
// practise: the path marks what is next, and the next thing is a suggestion.

import { TOOL_IDS, toolOf } from './registry.js';

/**
 * The tools, in the order somebody would be taught them.
 *
 * EQ first because every other tool is easier to hear once you can say where
 * in the spectrum something is. Compression second because level over time is
 * the other axis everything moves on. Then the two that put a sound somewhere
 * - stereo, then reverb - then delay, which is a reverb you can count, and
 * saturation last, because what it adds was not in the recording at all and
 * that is a stranger idea than any of the others.
 */
export const TEACHING_ORDER = ['eq', 'compression', 'panning', 'reverb', 'delay', 'saturation'];

/**
 * How many solves finish a step.
 *
 * Solves rather than a run of them. A streak would mean one slip throws away
 * three rounds of work, and this app took its streaks out for a reason: they
 * measure how recently somebody played rather than how well they hear. Three
 * is enough that it cannot be luck on a four-chip drill and few enough that a
 * step is an evening rather than a project.
 */
export const ENOUGH = 3;

/** The tier the path works at. Everything else stays reachable; this is where it starts. */
export const PATH_TIER = 'easy';

/**
 * What each tool is called in a sentence.
 *
 * Not derived from the label, which gives "read what a compression is for"
 * and "build it on the eq". A tool's name on a pill and its name in a
 * sentence are different words, and there are only six of them.
 */
const CALLED = {
  eq: { reading: 'what an EQ is for', building: 'the EQ' },
  compression: { reading: 'what a compressor is for', building: 'the compressor' },
  panning: { reading: 'what width actually is', building: 'the imager' },
  reverb: { reading: 'what a room does to a sound', building: 'the reverb' },
  delay: { reading: 'what a delay is for', building: 'the delay' },
  saturation: { reading: 'what saturation adds', building: 'the saturator' },
};

/**
 * Every step, in order: three per tool.
 *
 * `kind` is what the step is - reading, a drill or work at the tool - and the
 * shell turns the other fields into "take me there".
 */
export function steps() {
  const all = [];

  for (const tool of TEACHING_ORDER.filter((id) => TOOL_IDS.includes(id))) {
    const spec = toolOf(tool);
    const called = CALLED[tool] ?? { reading: `what ${spec.label} is for`, building: spec.label };
    all.push(
      {
        id: `${tool}:read`,
        tool,
        step: 'read',
        label: `Read ${called.reading}`,
        detail: 'Four sections on what it does to a record, not which button does what.',
      },
      {
        id: `${tool}:drill`,
        tool,
        step: 'drill',
        kind: 'drill',
        tier: PATH_TIER,
        label: spec.exercises.drill?.label ?? 'Name what you hear',
        detail: spec.exercises.drill?.ask ?? '',
      },
      {
        id: `${tool}:work`,
        tool,
        step: 'work',
        kind: 'work',
        tier: PATH_TIER,
        label: `Build one on ${called.building}`,
        detail: `Solve ${ENOUGH} rounds at the easy tier.`,
      },
    );
  }

  return all;
}

/**
 * Which steps are done, and which one is next.
 *
 * `solvesOf(tool, tier, kind)` and `hasRead(tool)` are handed in rather than
 * imported, so that none of this touches storage and all of it can be checked
 * against numbers a test makes up.
 *
 * "Next" is the first step that is not done, not the first after the last one
 * that is: somebody who skipped ahead and solved the delay has the delay
 * marked done and is still pointed back at the EQ, which is where the order
 * is actually doing some work.
 */
export function progress({ solvesOf, hasRead }) {
  const marked = steps().map((step) => {
    const solves = step.kind ? solvesOf(step.tool, step.tier, step.kind) : 0;
    const done = step.step === 'read' ? hasRead(step.tool) : solves >= ENOUGH;
    return { ...step, solves, done };
  });

  const next = marked.find((step) => !step.done) ?? null;
  const done = marked.filter((step) => step.done).length;

  return {
    steps: marked,
    next,
    done,
    total: marked.length,
    finished: done === marked.length,
  };
}

/** Where somebody is, in a line. */
export function where(state) {
  if (state.finished) return 'You have been through all of it. The path is a starting order, not a ceiling.';
  if (!state.done) return 'Six tools, three steps each. Start at the top.';
  return `${state.done} of ${state.total} done.`;
}
