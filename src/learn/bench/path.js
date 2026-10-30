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
 * Level first, and it went in at the front rather than the back because every
 * mixing curriculum surveyed puts it there and the reason is structural
 * rather than pedagogical: louder sounds better, so every A/B anybody makes
 * about any other tool is partly an A/B about level until they can take the
 * level out of it. A decibel is enough to swing a judgement. Starting
 * anywhere else means teaching five comparisons that are quietly
 * contaminated.
 *
 * Then EQ, because every tool after it is easier to hear once you can say
 * where in the spectrum something is. Compression third because level over
 * time is the other axis everything moves on. Then the two that put a sound
 * somewhere - stereo, then reverb - then delay, which is a reverb you can
 * count, and saturation after that, because what it adds was not in the
 * recording at all and that is a stranger idea than any of the others.
 *
 * The gate and the de-esser go straight after the compressor, because they are
 * the compressor: the same detector and the same smoother with the curve
 * mirrored and the gain aimed at a band. Put anywhere else they are two more
 * devices to learn; put here they are two things you already know.
 *
 * The limiter is last, and that is where it belongs twice over: it is the end
 * of the chain, and its lesson is the only one here that is about cost rather
 * than about sound. Deciding how much loudness is worth giving up a mix's
 * dynamics for is not a judgement anybody can make before they can hear what
 * the dynamics were doing.
 */
export const TEACHING_ORDER = [
  'level', 'eq', 'compression', 'gate', 'deess', 'panning', 'align', 'reverb',
  'delay', 'saturation', 'limiter',
];

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
 * How many mixes finish the last step.
 *
 * One, not three. A mix round is four parts and several submits, and the
 * point of it here is not drilling - it is the moment where the tools stop
 * being a list of exercises and become one job. Doing that once is the
 * thing; doing it three times is a different suggestion.
 */
export const ENOUGH_MIXES = 1;

/**
 * What each tool is called in a sentence.
 *
 * Not derived from the label, which gives "read what a compression is for"
 * and "build it on the eq". A tool's name on a pill and its name in a
 * sentence are different words, and there are only seven of them.
 */
const CALLED = {
  level: { reading: 'what a decibel is worth', building: 'the trim' },
  eq: { reading: 'what an EQ is for', building: 'the EQ' },
  compression: { reading: 'what a compressor is for', building: 'the compressor' },
  panning: { reading: 'what width actually is', building: 'the imager' },
  reverb: { reading: 'what a room does to a sound', building: 'the reverb' },
  delay: { reading: 'what a delay is for', building: 'the delay' },
  saturation: { reading: 'what saturation adds', building: 'the saturator' },
  limiter: { reading: 'what loudness costs', building: 'the limiter' },
  gate: { reading: 'what to do with the quiet', building: 'the gate' },
  deess: { reading: 'why a detector is not the signal', building: 'the de-esser' },
  align: { reading: 'what two mics do to each other', building: 'the alignment' },
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

  // And then the one that is not about a single tool at all.
  all.push({
    id: 'mix:match',
    tool: null,
    step: 'mix',
    kind: 'mix',
    tier: PATH_TIER,
    enough: ENOUGH_MIXES,
    label: 'Mix something',
    detail: 'Four parts, one balance, and a mix to match. Everything above, at once.',
  });

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
    const solves = step.kind ? solvesOf(step.tool ?? step.kind, step.tier, step.kind) : 0;
    const enough = step.enough ?? ENOUGH;
    const done = step.step === 'read' ? hasRead(step.tool) : solves >= enough;
    return { ...step, solves, enough, done };
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
  if (!state.done) return 'Eleven tools, three steps each, and then all of them at once. Start at the top.';
  return `${state.done} of ${state.total} done.`;
}
