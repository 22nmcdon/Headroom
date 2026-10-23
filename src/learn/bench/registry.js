// What a tool is, put back together.
//
// Each of the six is now three files: what it is and how to open it in
// src/tools, what you do with it in src/learn/work, and the long prose in
// src/notes. Something has to say those three are the EQ, and this is it.
//
// The split is not tidiness. A tool that knows about answers cannot be opened
// without a round, which is what made changing an exercise a teardown; an
// exercise that knows about canvases cannot be tested without a browser,
// which is why the lifecycle had never been tested at all. Keeping them apart
// is what lets one tool outlive many exercises and lets the decisions between
// them be checked headless.

import { EQ_TOOL } from '../../tools/eq.js';
import { COMPRESSION_TOOL } from '../../tools/compression.js';
import { PANNING_TOOL } from '../../tools/panning.js';
import { REVERB_TOOL } from '../../tools/reverb.js';
import { DELAY_TOOL } from '../../tools/delay.js';
import { SATURATION_TOOL } from '../../tools/saturation.js';

import { EQ_WORK } from '../work/eq.js';
import { COMP_WORK } from '../work/compression.js';
import { STEREO_WORK } from '../work/panning.js';
import { VERB_WORK } from '../work/reverb.js';
import { ECHO_WORK } from '../work/delay.js';
import { HEAT_WORK } from '../work/saturation.js';

import { notesFor } from '../notes/index.js';

/** One tool, with everything anybody asks of it in one place. */
const assemble = (tool, work) => ({
  ...tool,
  ...work,
  id: tool.id,
  notes: notesFor(tool.id),
});

export const TOOLS = {
  eq: assemble(EQ_TOOL, EQ_WORK),
  compression: assemble(COMPRESSION_TOOL, COMP_WORK),
  panning: assemble(PANNING_TOOL, STEREO_WORK),
  reverb: assemble(REVERB_TOOL, VERB_WORK),
  delay: assemble(DELAY_TOOL, ECHO_WORK),
  saturation: assemble(SATURATION_TOOL, HEAT_WORK),
};

export const TOOL_IDS = Object.keys(TOOLS);

export const toolOf = (id) => TOOLS[id] ?? TOOLS.eq;

/**
 * The exercise a tool is currently set to.
 *
 * Every tool has exercises and every round has one, so the fallback is the
 * first rather than nothing: a settings object that has lost its exercise is
 * a bug somewhere else, and refusing to open at all would make it harder to
 * find rather than easier.
 */
export function exerciseOf(id, settings = {}) {
  const tool = toolOf(id);
  return tool.exercises[settings.exercise] ?? Object.values(tool.exercises)[0];
}
