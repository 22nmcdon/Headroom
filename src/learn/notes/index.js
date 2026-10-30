import { EQ_NOTES } from './eq.js';
import { COMP_NOTES } from './comp.js';
import { STEREO_NOTES } from './stereo.js';
import { VERB_NOTES } from './verb.js';
import { ECHO_NOTES } from './echo.js';
import { HEAT_NOTES } from './heat.js';
import { LEVEL_NOTES } from './level.js';
import { CEIL_NOTES } from './limiter.js';
import { GATE_NOTES } from './gate.js';
import { DEESS_NOTES } from './deess.js';
import { ALIGN_NOTES } from './align.js';
import { MOD_NOTES } from './modulation.js';

// The written half of the tool.
//
// There are about twenty thousand words of explanation in this project and
// until now a user could reach around two thousand of them; the rest was at
// the top of the DSP files, addressed to whoever was next to change the code.
// Some of it was never addressed to a maintainer at all - what mid/side is,
// what a pre-delay does, why even harmonics sound like an octave - and had no
// business being somewhere only a reader of source would find it.
//
// So the conceptual half moved out here and the files keep a pointer. The
// decisions stay in the code, where they belong: a paragraph justifying a
// tolerance is for whoever changes the number.

export const NOTES = {
  eq: EQ_NOTES,
  compression: COMP_NOTES,
  panning: STEREO_NOTES,
  reverb: VERB_NOTES,
  delay: ECHO_NOTES,
  saturation: HEAT_NOTES,
  level: LEVEL_NOTES,
  limiter: CEIL_NOTES,
  gate: GATE_NOTES,
  deess: DEESS_NOTES,
  align: ALIGN_NOTES,
  modulation: MOD_NOTES,
};

export const notesFor = (tool) => NOTES[tool] ?? null;
