// What an insert puts on the panel.
//
// The case worth a test is the one that is silent when it is wrong: handing
// a worklet four settings instead of its thirteen is a compressor doing
// arithmetic on undefined, which does not throw and does not sound like
// anything in particular.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  KNOBS, knobsFor, restFor, tidy, tidyAll, paramsFor, optionsFor, writeKnob, EQ_REST,
} from '../src/sketch/knobs.js';
import { EFFECT_IDS } from '../src/core/effects.js';
import { COMP_DEFAULTS } from '../src/comp/dsp.js';
import { HEAT_DEFAULTS } from '../src/heat/shape.js';
import { IMAGE_DEFAULTS } from '../src/image/field.js';
import { newProject, setTrack, serialise, parse } from '../src/sketch/project.js';

test('every effect has knobs, and every knob a workable range', () => {
  for (const id of EFFECT_IDS) {
    const knobs = knobsFor(id);
    assert.ok(knobs.length >= 3 && knobs.length <= 4, `${id} has ${knobs.length} knobs`);

    for (const knob of knobs) {
      assert.ok(knob.label, `${id}.${knob.id} has no label`);
      assert.ok(knob.max > knob.min, `${id}.${knob.id} has no range`);
      assert.ok(knob.step > 0 && knob.step <= knob.max - knob.min, `${id}.${knob.id} step`);
    }
  }
});

test('the resting values come from the plugins own defaults', () => {
  assert.equal(restFor('compression').threshold, COMP_DEFAULTS.threshold);
  assert.equal(restFor('saturation').drive, HEAT_DEFAULTS.drive);
  assert.equal(restFor('panning').mid, IMAGE_DEFAULTS.mid);
  assert.deepEqual(restFor('eq'), EQ_REST);
});

test('every resting value is inside its own knob', () => {
  for (const id of EFFECT_IDS) {
    const rest = restFor(id);
    for (const knob of knobsFor(id)) {
      assert.ok(rest[knob.id] >= knob.min && rest[knob.id] <= knob.max,
        `${id}.${knob.id} rests at ${rest[knob.id]}, outside ${knob.min}..${knob.max}`);
    }
  }
});

test('what is handed to a worklet is the whole settings object, not the knobs', () => {
  // Four keys where the processor wants thirteen is a processor doing
  // arithmetic on undefined, and it does not throw.
  const params = paramsFor('compression', { ratio: 8 });

  assert.equal(params.ratio, 8);
  for (const key of Object.keys(COMP_DEFAULTS)) {
    assert.ok(params[key] !== undefined, `${key} was dropped`);
  }
  assert.equal(params.detector, COMP_DEFAULTS.detector);
  assert.equal(params.knee, COMP_DEFAULTS.knee);
});

test('the EQ becomes a strip of bands, and a flat one is switched off', () => {
  const flat = paramsFor('eq', EQ_REST);
  assert.ok(Array.isArray(flat));
  assert.deepEqual(flat.map((band) => band.on), [false, false, false]);

  const bright = paramsFor('eq', { ...EQ_REST, high: 4, mid: -3, midHz: 1200 });
  assert.deepEqual(bright.map((band) => band.on), [false, true, true]);
  assert.equal(bright.find((band) => band.id === 'p1').frequency, 1200);
  assert.equal(bright.find((band) => band.id === 'hs').gain, 4);
});

test('an effect is given its settings under the key its maker wants', () => {
  assert.ok(Array.isArray(optionsFor('eq', EQ_REST).bands));
  assert.equal(optionsFor('eq', EQ_REST).settings, undefined);
  for (const id of EFFECT_IDS.filter((each) => each !== 'eq')) {
    assert.ok(optionsFor(id, {}).settings, `${id} got no settings`);
  }
});

test('a value out of range is clamped and a value that is not one is ignored', () => {
  assert.equal(tidy('reverb', { decay: 99 }).decay, 5);
  assert.equal(tidy('reverb', { decay: -4 }).decay, 0.2);
  assert.equal(tidy('reverb', { decay: 'loud' }).decay, restFor('reverb').decay);
  assert.equal(tidy('reverb', {}).decay, restFor('reverb').decay);

  // A control a later version added and this one does not have.
  assert.equal(tidy('reverb', { shimmer: 1 }).shimmer, undefined);
});

test('settings for an effect that does not exist are dropped', () => {
  const tidied = tidyAll({ eq: { low: 2 }, telephone: { nonsense: 1 } });
  assert.deepEqual(Object.keys(tidied), ['eq']);
  assert.equal(tidied.eq.low, 2);
});

test('a knob reads as something a person would write', () => {
  const [low, mid, midHz] = KNOBS.eq;
  assert.equal(writeKnob(low, 3), '+3.0 dB');
  assert.equal(writeKnob(low, -4.5), '−4.5 dB');
  assert.equal(writeKnob(mid, 0), '0.0 dB');
  assert.equal(writeKnob(midHz, 800), '800');
  assert.equal(writeKnob(midHz, 2400), '2.4k');

  // A space before a word and none before a colon, which is how both are
  // written on a desk.
  const ratio = KNOBS.compression.find((knob) => knob.id === 'ratio');
  assert.equal(writeKnob(ratio, 4), '4.0:1');
  assert.equal(writeKnob(KNOBS.delay[0], 375), '375 ms');
});

test('an insert keeps its settings when it is taken off and put back', () => {
  let project = newProject();
  project = setTrack(project, 0, { inserts: ['delay'], settings: { delay: { feedback: 0.6 } } });
  project = setTrack(project, 0, { inserts: [] });

  assert.deepEqual(project.tracks[0].inserts, []);
  assert.equal(project.tracks[0].settings.delay.feedback, 0.6);

  project = setTrack(project, 0, { inserts: ['delay'] });
  assert.equal(project.tracks[0].settings.delay.feedback, 0.6);
});

test('a track settings survive being written out and read back', () => {
  const project = setTrack(newProject(), 2, {
    inserts: ['saturation'], settings: { saturation: { drive: 9 } },
  });
  assert.equal(parse(serialise(project)).tracks[2].settings.saturation.drive, 9);
});
