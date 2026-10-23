import test from 'node:test';
import assert from 'node:assert/strict';

import { dialValue, pickedLabel, pickerState } from '../src/learn/bench/picker.js';

// The picker has no consumer at the moment. The four modes that asked you to
// name what you heard are gone, and the drills that will ask the same shape of
// question about a band or a harmonic are not written yet.
//
// So these are here to stop it rotting in between. The log-space arithmetic in
// particular is the sort of thing that is obviously right until somebody
// changes a step size.

const hz = {
  id: 'frequency',
  kind: 'range',
  label: 'Frequency',
  min: 30,
  max: 16000,
  log: true,
  format: (v) => `${Math.round(v)} Hz`,
};

const db = {
  id: 'gain',
  kind: 'range',
  label: 'Gain',
  min: -12,
  max: 12,
  step: 0.5,
  format: (v) => `${v.toFixed(1)} dB`,
};

const chips = {
  id: 'band',
  label: 'Band',
  options: [
    { id: 'low', symbol: '120', name: 'low' },
    { id: 'mid', symbol: '1k', name: 'mid' },
  ],
};

/* --- what a slider position means ----------------------------------------- */

test('a log control is dialled in octaves, and comes back in hertz', () => {
  // The whole point of the log path: an octave is the same distance wherever
  // you are on the slider, which is how the ear hears frequency.
  for (const frequency of [30, 100, 440, 3150, 16000]) {
    const raw = Math.log2(frequency);
    assert.ok(Math.abs(dialValue(hz, raw) - frequency) < 1e-9, `${frequency} did not round-trip`);
  }

  // And equal moves on the slider are equal ratios in the answer.
  const step = 1; // one octave in log space
  const low = dialValue(hz, Math.log2(100));
  const high = dialValue(hz, Math.log2(100) + step);
  const higher = dialValue(hz, Math.log2(100) + 2 * step);
  assert.ok(Math.abs(high / low - 2) < 1e-9);
  assert.ok(Math.abs(higher / high - 2) < 1e-9);
});

test('a linear control lands on its own step, never between two', () => {
  // A slider can report anything; what comes back has to be a number somebody
  // could have meant to dial.
  for (const raw of [0, 0.1, 0.24, 0.26, -3.3, 11.9]) {
    const value = dialValue(db, raw);
    const steps = value / db.step;
    assert.ok(Math.abs(steps - Math.round(steps)) < 1e-9, `${raw} came back as ${value}`);
  }

  assert.equal(dialValue(db, 0.24), 0);
  assert.equal(dialValue(db, 0.26), 0.5);
  assert.equal(dialValue(db, -3.3), -3.5);
});

/* --- what the picker is showing ------------------------------------------- */

test('an answer is summarised in the units it was asked in', () => {
  assert.equal(pickedLabel(hz, 3150), '3150 Hz');
  assert.equal(pickedLabel(db, -4.5), '-4.5 dB');
  assert.equal(pickedLabel(chips, 'mid'), '1k');
  // Nothing picked is not an error, it is just nothing to say.
  assert.equal(pickedLabel(chips, undefined), '');
});

test('the picker knows when it has been answered, and when it is a dial', () => {
  assert.deepEqual(pickerState([chips], {}), {
    complete: false, dialling: false, summary: '',
  });

  assert.deepEqual(pickerState([chips], { band: 'low' }), {
    complete: true, dialling: false, summary: '120',
  });

  // Two slots, one answered: not done.
  const both = [chips, { ...chips, id: 'second' }];
  assert.equal(pickerState(both, { band: 'low' }).complete, false);
  assert.equal(pickerState(both, { band: 'low', second: 'mid' }).complete, true);
  assert.equal(pickerState(both, { band: 'low', second: 'mid' }).summary, '120 · 1k');

  // A range slot changes what the button under it should say.
  assert.equal(pickerState([hz], { frequency: 440 }).dialling, true);
  assert.equal(pickerState([hz], { frequency: 440 }).summary, '440 Hz');
});
