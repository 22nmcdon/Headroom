import test from 'node:test';
import assert from 'node:assert/strict';

// What a face folds behind its More row is shut on the easy and medium tiers.
// So no round on those tiers may need it: a target set on a knob nobody can
// see without knowing to look is a round that cannot be won by listening.
// The harder tiers open the row, and may ask about anything in it.

import { makePuzzle, startingGuess } from '../src/learn/game.js';
import { TOOLS } from '../src/learn/bench/registry.js';
import { COMP_MORE } from '../src/plugins/compressor/plugin.js';
import { COMP_DEFAULTS } from '../src/plugins/compressor/dsp.js';
import { GATE_FACE } from '../src/plugins/compressor/aimed.js';
import { VERB_MORE } from '../src/plugins/reverb/plugin.js';
import { VERB_DEFAULTS } from '../src/plugins/reverb/ir.js';
import { ECHO_MORE } from '../src/plugins/delay/plugin.js';
import { ECHO_DEFAULTS } from '../src/plugins/delay/dsp.js';
import { STEREO_MORE } from '../src/plugins/stereo/plugin.js';
import { STEREO_DEFAULTS } from '../src/plugins/stereo/field.js';

const FOLDED = {
  compression: [COMP_MORE, COMP_DEFAULTS],
  gate: [GATE_FACE.more, GATE_FACE.defaults],
  reverb: [VERB_MORE, VERB_DEFAULTS],
  delay: [ECHO_MORE, ECHO_DEFAULTS],
  panning: [STEREO_MORE, STEREO_DEFAULTS],
};

test('no easy or medium round asks about a knob behind the More row', () => {
  for (const [mode, [more, defaults]] of Object.entries(FOLDED)) {
    assert.ok(more.length, `${mode} folds nothing`);
    for (const key of more) assert.ok(key in defaults, `${mode}: ${key} has no default`);

    for (const [id, exercise] of Object.entries(TOOLS[mode].exercises)) {
      if (exercise.drill) continue;
      for (const tier of ['easy', 'medium']) {
        for (let n = 0; n < 40; n += 1) {
          const puzzle = makePuzzle({ mode, tier, settings: { exercise: id }, seed: `more-${n}` });
          // The target as the shell puts it on the controls ("Put it on the controls").
          const target = exercise.targetOf?.(puzzle) ?? exercise.answerOf?.(puzzle) ?? puzzle.answer;
          for (const state of [target, startingGuess(mode, tier, { exercise: id })]) {
            if (!state || typeof state !== 'object') continue;
            for (const key of more) {
              if (state[key] === undefined) continue;
              assert.deepEqual(state[key], defaults[key],
                `${mode}/${id}/${tier}: ${key} is ${state[key]}, folded away at ${defaults[key]}`);
            }
          }
        }
      }
    }
  }
});
