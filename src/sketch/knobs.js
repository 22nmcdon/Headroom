// What an insert puts on the panel.
//
// The six effects have between five and thirteen settings each and no two of
// them the same shape, which is right for six plugins and wrong for a strip
// in a sketchpad: a track with three inserts would be forty controls, on a
// page whose job is to get an idea down before it goes.
//
// So each one gets three or four - the ones that change what you hear most,
// chosen the way somebody reaching for that effect on a sketch would reach -
// and everything else stays at the setting the plugin already defaults to.
// The full version of any of these is the tool itself, two tabs away, and
// that is the right place for it.
//
// The defaults here are read from the real ones rather than written out
// again, so a plugin whose resting state changes changes here too.

import { COMP_DEFAULTS } from '../comp/dsp.js';
import { HEAT_DEFAULTS } from '../heat/shape.js';
import { IMAGE_DEFAULTS } from '../image/field.js';
import { VERB_DEFAULTS } from '../verb/ir.js';
import { ECHO_DEFAULTS } from '../echo/line.js';
import { EFFECT_IDS } from '../core/effects.js';
import { RESTING_Q } from '../eq/filters.js';

/**
 * The EQ is the one that is not its own settings.
 *
 * Its effect takes a strip of band objects, which is the right shape for a
 * six-band plugin and far too much for a track insert. These four values are
 * what the panel holds, and `paramsFor` turns them into the strip - a shelf
 * at each end and one movable bell in the middle, which is the EQ anybody
 * puts on a part in a sketch.
 */
export const EQ_REST = { low: 0, mid: 0, midHz: 800, high: 0 };

const TONE = (values) => [
  { id: 'ls', type: 'lowshelf', frequency: 120, gain: values.low, q: RESTING_Q.lowshelf, slope: 12, on: values.low !== 0 },
  { id: 'p1', type: 'peaking', frequency: values.midHz, gain: values.mid, q: 1.1, slope: 12, on: values.mid !== 0 },
  { id: 'hs', type: 'highshelf', frequency: 6000, gain: values.high, q: RESTING_Q.highshelf, slope: 12, on: values.high !== 0 },
];

/** Three or four a piece, in the order a hand would reach for them. */
export const KNOBS = {
  eq: [
    { id: 'low', label: 'Low', min: -12, max: 12, step: 0.5, unit: 'dB', signed: true },
    { id: 'mid', label: 'Mid', min: -12, max: 12, step: 0.5, unit: 'dB', signed: true },
    { id: 'midHz', label: 'Mid at', min: 200, max: 6000, step: 25, unit: 'Hz' },
    { id: 'high', label: 'High', min: -12, max: 12, step: 0.5, unit: 'dB', signed: true },
  ],
  compression: [
    { id: 'threshold', label: 'Threshold', min: -48, max: 0, step: 1, unit: 'dB', signed: true },
    { id: 'ratio', label: 'Ratio', min: 1, max: 12, step: 0.5, unit: ':1' },
    { id: 'attack', label: 'Attack', min: 1, max: 100, step: 1, unit: 'ms' },
    { id: 'release', label: 'Release', min: 20, max: 600, step: 10, unit: 'ms' },
  ],
  // Width has nothing to act on unless there is already something stereo on
  // the track. A synthesised instrument is the same signal in both ears, so
  // this insert does nothing on one until there is a room or a delay in
  // front of it - measured, and it is the physics rather than a fault: a
  // mono source has no side to widen.
  panning: [
    { id: 'low', label: 'Low width', min: 0, max: 2.5, step: 0.05 },
    { id: 'mid', label: 'Mid width', min: 0, max: 2.5, step: 0.05 },
    { id: 'high', label: 'High width', min: 0, max: 2.5, step: 0.05 },
  ],
  reverb: [
    { id: 'mix', label: 'Amount', min: 0, max: 1, step: 0.02 },
    { id: 'decay', label: 'Decay', min: 0.2, max: 5, step: 0.1, unit: 's' },
    { id: 'preDelay', label: 'Pre-delay', min: 0, max: 120, step: 5, unit: 'ms' },
    { id: 'damping', label: 'Damping', min: 0.1, max: 1, step: 0.05 },
  ],
  delay: [
    { id: 'time', label: 'Time', min: 60, max: 800, step: 5, unit: 'ms' },
    { id: 'feedback', label: 'Feedback', min: 0, max: 0.85, step: 0.05 },
    { id: 'mix', label: 'Amount', min: 0, max: 1, step: 0.02 },
    { id: 'tone', label: 'Tone', min: 1000, max: 16000, step: 250, unit: 'Hz' },
  ],
  saturation: [
    { id: 'drive', label: 'Drive', min: 0, max: 24, step: 0.5, unit: 'dB' },
    { id: 'bias', label: 'Bias', min: 0, max: 1, step: 0.05 },
    { id: 'hardness', label: 'Hardness', min: 0.5, max: 6, step: 0.1 },
    { id: 'mix', label: 'Amount', min: 0, max: 1, step: 0.02 },
  ],
};

/** Where each effect's knobs rest, taken from the plugin's own defaults. */
const REST = {
  eq: EQ_REST,
  compression: COMP_DEFAULTS,
  panning: IMAGE_DEFAULTS,
  reverb: VERB_DEFAULTS,
  delay: ECHO_DEFAULTS,
  saturation: HEAT_DEFAULTS,
};

export const knobsFor = (id) => KNOBS[id] ?? [];

/** What an insert's panel holds when nothing has been touched. */
export const restFor = (id) => Object.fromEntries(
  knobsFor(id).map((knob) => [knob.id, REST[id]?.[knob.id] ?? knob.min]),
);

/**
 * A stored settings object, with everything missing filled in and everything
 * impossible taken out.
 *
 * Every value is put back through its own knob, so a file written by a later
 * version with a control this one does not have loads without it, and a
 * number outside the range is clamped rather than handed to a filter.
 */
export function tidy(id, stored = {}) {
  const rest = restFor(id);
  const out = { ...rest };

  for (const knob of knobsFor(id)) {
    const value = Number(stored[knob.id]);
    if (!Number.isFinite(value)) continue;
    out[knob.id] = Math.max(knob.min, Math.min(knob.max, value));
  }

  return out;
}

/** Every insert's settings on a track, tidied. */
export const tidyAll = (settings = {}) => Object.fromEntries(
  EFFECT_IDS
    .filter((id) => settings[id])
    .map((id) => [id, tidy(id, settings[id])]),
);

/**
 * What to hand an effect's `set`.
 *
 * The panel's few values *on top of the whole default*, never instead of it.
 * The worklets take their settings object as the settings object - a
 * compressor handed four keys is a compressor with no knee, no detector and
 * no makeup, which is not a quiet degradation but a processor doing
 * arithmetic on undefined.
 *
 * The EQ is the exception in shape rather than in principle: it takes a
 * strip of bands, which is what `TONE` builds out of the same few values.
 */
export const paramsFor = (id, values) => (id === 'eq'
  ? TONE(tidy('eq', values))
  : { ...REST[id], ...tidy(id, values) });

/**
 * And what to hand its constructor.
 *
 * Which is the same thing under a different key, because the EQ's maker takes
 * `bands` and everything else's takes `settings`. One line here rather than a
 * branch in every caller.
 */
export const optionsFor = (id, values) =>
  (id === 'eq' ? { bands: paramsFor(id, values) } : { settings: paramsFor(id, values) });

/** A knob's value, as something to read. */
export function writeKnob(knob, value) {
  const places = knob.step >= 1 ? 0 : (knob.step >= 0.1 ? 1 : 2);
  const sign = knob.signed && value > 0 ? '+' : (value < 0 ? '−' : '');
  const shown = Math.abs(value) >= 1000 && knob.unit === 'Hz'
    ? `${(Math.abs(value) / 1000).toFixed(1)}k`
    : Math.abs(value).toFixed(places);

  // A space before "dB" and none before ":1", which is how both are written.
  if (!knob.unit || knob.unit === 'Hz') return `${sign}${shown}`;
  return `${sign}${shown}${/^[a-z]/i.test(knob.unit) ? ' ' : ''}${knob.unit}`;
}
