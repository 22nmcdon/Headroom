// Starting points, per tool.
//
// A preset is a state - exactly what a face's `state()` answers and its
// `setState()` takes - with a name. Most plugins ship a handful, and most
// people reset a plugin by recalling one rather than by finding a button,
// which is why the EQ's Flatten and the compressor's Reset live off the face.
//
// Each is the tool's own defaults with a few things moved, so it is always a
// whole state: recalling one never leaves a knob where the last one put it.
// What is being listened to - `listen`, `hear` - is the monitoring rather
// than the setting, and the shell keeps whatever it is when one is recalled.
//
// These are places to start from, not answers: none is any exercise's target.

import { newStrip } from '../plugins/eq/filters.js';
import { COMP_DEFAULTS } from '../plugins/compressor/dsp.js';
import { GATE_FACE, DEESS_FACE } from '../plugins/compressor/aimed.js';
import { ECHO_DEFAULTS } from '../plugins/delay/dsp.js';
import { VERB_DEFAULTS } from '../plugins/reverb/ir.js';
import { HEAT_DEFAULTS } from '../plugins/saturation/shape.js';
import { STEREO_DEFAULTS } from '../plugins/stereo/field.js';
import { MOD_DEFAULTS } from '../plugins/modulation/dsp.js';
import { LEVEL_DEFAULTS } from '../plugins/level/gain.js';
import { CEIL_DEFAULTS } from '../plugins/limiter/ceiling.js';
import { ALIGN_DEFAULTS } from '../plugins/align/pair.js';

/** A strip of six, with some bands changed and switched on. */
function strip(changes = {}) {
  return newStrip().map((band) => (changes[band.id]
    ? { ...band, ...changes[band.id], on: true }
    : band));
}

const named = (defaults) => (name, changes = {}) => ({ name, state: { ...defaults, ...changes } });

const comp = named(COMP_DEFAULTS);
const gate = named(GATE_FACE.defaults);
const deess = named(DEESS_FACE.defaults);
const echo = named(ECHO_DEFAULTS);
const verb = named(VERB_DEFAULTS);
const heat = named(HEAT_DEFAULTS);
const image = named(STEREO_DEFAULTS);
const mod = named(MOD_DEFAULTS);
const level = named(LEVEL_DEFAULTS);
const ceil = named(CEIL_DEFAULTS);
const align = named(ALIGN_DEFAULTS);

export const PRESETS = {
  eq: [
    { name: 'Flat', state: strip() },
    { name: 'Clear the mud', state: strip({ hp: { frequency: 60 }, p1: { frequency: 300, gain: -3, q: 1.2 } }) },
    { name: 'Presence', state: strip({ p2: { frequency: 3000, gain: 3, q: 1 } }) },
    { name: 'Air', state: strip({ hs: { frequency: 10000, gain: 3 } }) },
    { name: 'Telephone', state: strip({ hp: { frequency: 400, slope: 24 }, lp: { frequency: 3500, slope: 24 } }) },
  ],
  compression: [
    comp('Default'),
    comp('Gentle glue', { threshold: -20, ratio: 2, attack: 30, release: 300, knee: 6 }),
    comp('Vocal control', { threshold: -24, ratio: 4, attack: 5, release: 80, knee: 3 }),
    comp('Let the hits through', { threshold: -24, ratio: 4, attack: 30, release: 150, knee: 3 }),
    comp('Parallel smash', { threshold: -32, ratio: 10, attack: 1, release: 60, knee: 0, mix: 0.4 }),
  ],
  gate: [
    gate('Default'),
    gate('Tight drums', { threshold: -35, range: 40, attack: 0.5, hold: 20, release: 80 }),
    gate('Gentle', { threshold: -40, range: 10, hold: 60, release: 250 }),
  ],
  deess: [
    deess('Default'),
    deess('Light', { threshold: -24, range: 6 }),
    deess('Firm', { threshold: -34, ratio: 8, range: 12 }),
  ],
  reverb: [
    verb('Default'),
    verb('Small room', { space: 'room', size: 8, decay: 0.6, preDelay: 5, mix: 0.2 }),
    verb('Vocal plate', { space: 'plate', decay: 1.8, preDelay: 30, mix: 0.25 }),
    verb('Big room', { space: 'room', size: 45, decay: 3.2, preDelay: 40, mix: 0.3 }),
    verb('Gated drums', { space: 'gated', decay: 0.8, mix: 0.35 }),
  ],
  delay: [
    echo('Default'),
    echo('Slapback', { time: 110, feedback: 0.1, mix: 0.25, tone: 5000 }),
    echo('Ping-pong', { time: 375, feedback: 0.4, pingPong: true, mix: 0.3 }),
    echo('Tape echo', { time: 330, feedback: 0.45, machine: 'tape', wow: 12, flutter: 6, tone: 3500 }),
    echo('Dark repeats', { time: 500, feedback: 0.5, machine: 'bbd', tone: 2000, lowCut: 200, mix: 0.25 }),
  ],
  saturation: [
    heat('Default'),
    heat('Warm tape', { mode: 'tape', drive: 6 }),
    heat('Tube', { mode: 'tube', drive: 8 }),
    heat('Fuzz', { mode: 'fold', drive: 12, folds: 2 }),
    heat('Lo-fi', { mode: 'crush', bits: 8, hold: 4 }),
  ],
  panning: [
    image('Default'),
    image('Mono bass', { monoBelow: 120 }),
    image('Wider', { mid: 1.3, high: 1.5 }),
    image('Narrower', { low: 0.6, mid: 0.6, high: 0.6 }),
  ],
  modulation: [
    mod('Default'),
    mod('Slow flanger', { kind: 'flanger', rate: 0.25, depth: 0.6, feedback: 0.5 }),
    mod('Vibrato', { kind: 'vibrato', rate: 5, depth: 0.3 }),
    mod('Tremolo', { kind: 'tremolo', rate: 4, depth: 0.5 }),
    mod('Auto-pan', { kind: 'autopan', rate: 0.5, depth: 0.8 }),
  ],
  level: [level('Unity')],
  limiter: [
    ceil('Default'),
    ceil('Streaming ceiling', { drive: 4, ceiling: -1 }),
    ceil('Loud', { drive: 8, ceiling: -0.3, release: 30 }),
    ceil('Clipper', { mode: 'clip', drive: 4, ceiling: -1 }),
  ],
  align: [align('As recorded')],
};

/** A tool's built-in presets, or none. */
export const presetsFor = (id) => PRESETS[id] ?? [];
