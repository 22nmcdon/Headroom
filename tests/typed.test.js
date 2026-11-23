import test from 'node:test';
import assert from 'node:assert/strict';

import { readNumber, readTyped } from '../src/lib/knob.js';

test('a number and its unit, however the readout wrote them', () => {
  assert.deepEqual(readNumber('−18.0 dB'), { number: -18, unit: 'db' });
  assert.deepEqual(readNumber('4.0 : 1'), { number: 4, unit: null });
  assert.deepEqual(readNumber('× 0.55'), { number: 0.55, unit: null });
  assert.deepEqual(readNumber('0.4k'), { number: 0.4, unit: 'k' });
  assert.deepEqual(readNumber('+3.5'), { number: 3.5, unit: null });
  assert.equal(readNumber('off'), null);
});

test('typed in the unit shown, the number is the setting', () => {
  assert.equal(readTyped('-24', { shown: '-18.0 dB', real: -18 }), -24);
  assert.equal(readTyped('6:1', { shown: '4.0 : 1', real: 4 }), 6);
  assert.equal(readTyped('150', { shown: '120 ms', real: 120 }), 150);
});

test('a different unit of the same kind is converted', () => {
  assert.equal(readTyped('1.2 s', { shown: '120 ms', real: 120 }), 1200);
  assert.equal(readTyped('900 ms', { shown: '1.80 s', real: 1.8 }), 0.9);
  assert.equal(readTyped('1k', { shown: '20 Hz', real: 20 }), 1000);
  assert.equal(readTyped('4.5 kHz', { shown: '20 Hz', real: 20 }), 4500);
});

test('a frequency typed in hertz on a knob that reads kilohertz means hertz', () => {
  assert.equal(readTyped('400', { shown: '6.0 kHz', real: 6000 }), 400);
  assert.equal(readTyped('4.5', { shown: '6.0 kHz', real: 6000 }), 4500);
});

test('a percentage of a 0-to-1 setting is a fraction', () => {
  assert.equal(readTyped('50', { shown: '35 %', real: 0.35 }), 0.5);
  assert.equal(readTyped('50%', { shown: '0 %', real: 0, max: 1 }), 0.5);
  assert.equal(readTyped('50', { shown: '35 %', real: 35, max: 100 }), 50);
});

test('a rounded readout does not skew the scale', () => {
  assert.equal(readTyped('2', { shown: '1.8 s', real: 1.79 }), 2);
});

test('nothing numeric is nothing', () => {
  assert.equal(readTyped('loud', { shown: '-18.0 dB', real: -18 }), null);
});
