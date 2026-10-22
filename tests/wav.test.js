// Audio, as a file.
//
// Every one of these is about a byte being in the right place, which is the
// one kind of bug that produces a file that opens and sounds wrong.

import test from 'node:test';
import assert from 'node:assert/strict';

import { writeWav, readWav, quantise, HEADER, BITS } from '../src/sketch/wav.js';

const tone = (hz, rate, seconds, gain = 0.5) => {
  const out = new Float32Array(Math.round(rate * seconds));
  for (let i = 0; i < out.length; i += 1) out[i] = gain * Math.sin((2 * Math.PI * hz * i) / rate);
  return out;
};

const tag = (bytes, at) => String.fromCharCode(...bytes.slice(at, at + 4));

test('the header says what every program reads first', () => {
  const bytes = writeWav([tone(440, 48000, 0.1), tone(440, 48000, 0.1)], 48000);
  const view = new DataView(bytes.buffer);

  assert.equal(tag(bytes, 0), 'RIFF');
  assert.equal(tag(bytes, 8), 'WAVE');
  assert.equal(tag(bytes, 12), 'fmt ');
  assert.equal(tag(bytes, 36), 'data');

  assert.equal(view.getUint16(20, true), 1, 'not plain PCM');
  assert.equal(view.getUint16(22, true), 2, 'not stereo');
  assert.equal(view.getUint32(24, true), 48000);
  assert.equal(view.getUint16(34, true), BITS);

  // The two sizes, which are what a short read gets wrong.
  assert.equal(view.getUint32(4, true), bytes.length - 8);
  assert.equal(view.getUint32(40, true), bytes.length - HEADER);
});

test('the rate fields agree with each other', () => {
  const bytes = writeWav([tone(440, 44100, 0.05)], 44100, { bits: 16 });
  const view = new DataView(bytes.buffer);

  const channels = view.getUint16(22, true);
  const bits = view.getUint16(34, true);
  assert.equal(view.getUint16(32, true), channels * (bits / 8), 'bytes a frame');
  assert.equal(view.getUint32(28, true), 44100 * channels * (bits / 8), 'bytes a second');
});

test('a file is exactly as long as the audio in it', () => {
  for (const bits of [8, 16, 24, 32]) {
    const bytes = writeWav([new Float32Array(1000), new Float32Array(1000)], 48000, { bits });
    assert.equal(bytes.length, HEADER + 1000 * 2 * (bits / 8), `${bits} bit`);
  }
});

test('what goes in comes back out, to the resolution it was written at', () => {
  const rate = 48000;
  const left = tone(440, rate, 0.05);
  const right = tone(220, rate, 0.05, 0.25);

  const back = readWav(writeWav([left, right], rate));
  assert.equal(back.rate, rate);
  assert.equal(back.bits, 24);
  assert.equal(back.frames, left.length);

  // 24 bit is one part in 8.4 million; a tenth of that is plenty of room.
  let worst = 0;
  for (let i = 0; i < left.length; i += 1) {
    worst = Math.max(worst, Math.abs(back.channels[0][i] - left[i]));
    worst = Math.max(worst, Math.abs(back.channels[1][i] - right[i]));
  }
  assert.ok(worst < 1e-6, `off by ${worst}`);
});

test('the channels stay in their own lanes', () => {
  const rate = 8000;
  const left = new Float32Array(16).fill(0.5);
  const right = new Float32Array(16).fill(-0.25);

  const back = readWav(writeWav([left, right], rate, { bits: 16 }));
  assert.ok(back.channels[0].every((v) => Math.abs(v - 0.5) < 1e-4));
  assert.ok(back.channels[1].every((v) => Math.abs(v + 0.25) < 1e-4));
});

test('a sample past full scale is clipped, not wrapped', () => {
  // Wrapping takes the loudest positive sample to the loudest negative one,
  // which is the single worst sound a converter can be asked to make.
  const back = readWav(writeWav([Float32Array.from([2, -2, 0.5])], 8000, { bits: 16 }));
  assert.ok(back.channels[0][0] > 0.99);
  assert.ok(back.channels[0][1] < -0.99);
  assert.ok(Math.abs(back.channels[0][2] - 0.5) < 1e-4);
});

test('quantising is symmetrical enough that a full-scale sine does not clip', () => {
  // Two's complement holds one more negative value than positive. Scaling by
  // the positive maximum is what keeps the bottom of the wave inside.
  const most = 2 ** 23 - 1;
  assert.equal(quantise(1), most);
  assert.equal(quantise(-1), -most);
  assert.equal(quantise(0), 0);
  assert.equal(quantise(1, 16), 32767);
  assert.equal(quantise(-1, 16), -32767);
});

test('channels of different lengths are cut to the shortest', () => {
  const bytes = writeWav([new Float32Array(100), new Float32Array(60)], 8000, { bits: 16 });
  assert.equal(readWav(bytes).frames, 60);
});

test('a wav with no channels, or a depth nobody has, is refused', () => {
  assert.throws(() => writeWav([], 48000), /at least one channel/);
  assert.throws(() => writeWav([new Float32Array(4)], 48000, { bits: 12 }), /bit depth/);
});

test('something that is not a wav reads as nothing', () => {
  assert.equal(readWav(new Uint8Array(64)), null);
});
