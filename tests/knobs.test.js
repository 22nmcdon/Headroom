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
import { COMP_DEFAULTS, COMP_LIMITS } from '../src/plugins/compressor/dsp.js';
import { HEAT_DEFAULTS, HEAT_LIMITS } from '../src/plugins/saturation/shape.js';
import { IMAGE_DEFAULTS, IMAGE_LIMITS } from '../src/plugins/stereo/field.js';
import { VERB_DEFAULTS, VERB_LIMITS } from '../src/plugins/reverb/ir.js';
import { ECHO_DEFAULTS, ECHO_LIMITS } from '../src/plugins/delay/line.js';
import { newProject, setTrack, serialise, parse } from '../src/sketch/project.js';

/** The five that are their own settings. The EQ's four are not. */
const WHOLE = {
  compression: [COMP_DEFAULTS, COMP_LIMITS],
  panning: [IMAGE_DEFAULTS, IMAGE_LIMITS],
  reverb: [VERB_DEFAULTS, VERB_LIMITS],
  delay: [ECHO_DEFAULTS, ECHO_LIMITS],
  saturation: [HEAT_DEFAULTS, HEAT_LIMITS],
};

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
  // The plugin's range, not the panel's: an insert opens the real plugin, so
  // the decay a sketch can hold is the decay a room can be set to - eight
  // seconds - rather than the five the panel's own slider reaches.
  assert.equal(tidy('reverb', { decay: 99 }).decay, VERB_LIMITS.decay[1]);
  assert.equal(tidy('reverb', { decay: -4 }).decay, VERB_LIMITS.decay[0]);
  assert.equal(tidy('reverb', { decay: 'loud' }).decay, restFor('reverb').decay);
  assert.equal(tidy('reverb', {}).decay, restFor('reverb').decay);

  // A control a later version added and this one does not have.
  assert.equal(tidy('reverb', { shimmer: 1 }).shimmer, undefined);
});

test('an insert keeps every setting the effect has, not only the panel\'s few', () => {
  // The case this is here for: somebody opens the compressor on a track,
  // sets the knee and the makeup - neither of which is on the panel - and
  // reloads. Dropping them would be a plugin that forgets, which is worse
  // than one that was never there.
  const kept = tidy('compression', { threshold: -24, knee: 1.5, makeup: 6, detector: 'rms' });
  assert.equal(kept.threshold, -24);
  assert.equal(kept.knee, 1.5);
  assert.equal(kept.makeup, 6);
  assert.equal(kept.detector, 'rms');

  // Every key the effect has, plus where its detector listens, which is
  // the compressor's own setting and not the processor's.
  assert.deepEqual(Object.keys(kept).sort(), [...Object.keys(COMP_DEFAULTS), 'keyFrom'].sort());

  // Kinds are respected: a number where a string belongs is not a setting.
  assert.equal(tidy('compression', { detector: 7 }).detector, COMP_DEFAULTS.detector);
  assert.equal(tidy('compression', { sidechain: 'yes' }).sidechain, COMP_DEFAULTS.sidechain);
  assert.equal(tidy('compression', { sidechain: true }).sidechain, true);
});

test('every numeric setting an effect has can be clamped', () => {
  // A setting with no limit is a setting a loaded file could put anywhere,
  // and some of them - a decay, a delay time - buy an allocation with it.
  for (const [id, [defaults, limits]] of Object.entries(WHOLE)) {
    for (const [key, value] of Object.entries(defaults)) {
      if (typeof value !== 'number') continue;
      assert.ok(limits[key], `${id}.${key} has no limit`);
      const [low, high] = limits[key];
      assert.ok(high > low, `${id}.${key} has no range`);
      assert.ok(value >= low && value <= high, `${id}.${key} rests outside its own range`);
    }
  }
});

test('where a detector listens is kept with the settings and not handed to the processor', () => {
  // It belongs on the compressor's face, which is why it is stored with
  // the compressor's settings; it means nothing to a worklet, which is why
  // it is taken out before one is handed them.
  assert.equal(tidy('compression', { keyFrom: 'kit' }).keyFrom, 'kit');
  assert.equal(tidy('compression', {}).keyFrom, null);
  assert.equal(tidy('compression', { keyFrom: 7 }).keyFrom, null);

  const given = paramsFor('compression', { keyFrom: 'kit' });
  assert.equal('keyFrom' in given, false);

  // And setting a source is what turns the detector round, so that nobody
  // has to set two things to get one.
  assert.equal(given.sidechain, true);
  assert.equal(paramsFor('compression', {}).sidechain, false);
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
