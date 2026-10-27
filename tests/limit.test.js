// The only thing a ceiling has to do is be one.
//
// The node this replaced was measured at 2.92 dB over its own ceiling on
// transient material, so the assertion here is not "close enough" - it is that
// no sample, on any signal, comes out above the ceiling.

import test from 'node:test';
import assert from 'node:assert/strict';

import { makeLimiter, LIMIT_AHEAD, CEILING_DB } from '../src/lib/limiter.js';
import { mulberry32 } from '../src/lib/random.js';

const RATE = 48000;
const ROOF = 10 ** (CEILING_DB / 20);

/** Through the limiter in blocks, as an audio callback would hand it over. */
function through(samples, over = {}, span = 128) {
  const limiter = makeLimiter(RATE, over);
  const out = new Float32Array(samples.length);
  for (let at = 0; at < samples.length; at += span) {
    const block = samples.slice(at, Math.min(at + span, samples.length));
    limiter.block([block]);
    out.set(block, at);
  }
  return out;
}

const peakOf = (samples) => {
  let peak = 0;
  for (const v of samples) peak = Math.max(peak, Math.abs(v));
  return peak;
};

/* --- the signals it has to hold ------------------------------------------- */

const SIGNALS = {
  'a steady tone, 20 dB over': () => {
    const n = RATE;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i += 1) out[i] = Math.sin((2 * Math.PI * 220 * i) / RATE) * 10;
    return out;
  },

  'clicks, one sample each': () => {
    const n = RATE;
    const out = new Float32Array(n);
    for (let k = 0; k < 40; k += 1) out[Math.round(k * 0.025 * RATE)] = k % 2 ? 24 : -24;
    return out;
  },

  'a step onto full level': () => {
    const n = RATE;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i += 1) out[i] = i < RATE * 0.3 ? 0 : 8;
    return out;
  },

  'hits over a sustained bed': () => {
    const n = Math.round(RATE * 2);
    const out = new Float32Array(n);
    const rng = mulberry32(4242);
    for (let i = 0; i < n; i += 1) out[i] = Math.sin((2 * Math.PI * 70 * i) / RATE) * 0.8;
    for (let k = 0; k < 12; k += 1) {
      const at = Math.round(k * 0.16 * RATE);
      for (let i = 0; i < Math.round(RATE * 0.02) && at + i < n; i += 1) {
        out[at + i] += Math.exp(-(i / RATE) * 180) * (rng() * 2 - 1) * 14;
      }
    }
    return out;
  },

  'noise, loud': () => {
    const n = RATE;
    const out = new Float32Array(n);
    const rng = mulberry32(99);
    for (let i = 0; i < n; i += 1) out[i] = (rng() * 2 - 1) * 6;
    return out;
  },

  'already quiet': () => {
    const n = RATE;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i += 1) out[i] = Math.sin((2 * Math.PI * 440 * i) / RATE) * 0.2;
    return out;
  },
};

test('no sample comes out above the ceiling, on anything', () => {
  for (const [name, make] of Object.entries(SIGNALS)) {
    const out = through(make());
    const peak = peakOf(out);
    assert.ok(peak <= ROOF + 1e-6,
      `${name} came out at ${(20 * Math.log10(peak)).toFixed(2)} dB, over the `
      + `${CEILING_DB} dB ceiling`);
  }
});

test('the block size it is handed does not change what comes out', () => {
  // An audio callback picks the block size, not this file. If the answer
  // depended on it, the sketch would sound different in a worklet from in a
  // render, which is the class of bug the EQ's worklet was built to end.
  const signal = SIGNALS['hits over a sustained bed']();
  const once = through(signal, {}, signal.length);
  for (const span of [1, 7, 128, 512, 4096]) {
    const got = through(signal, {}, span);
    let worst = 0;
    for (let i = 0; i < got.length; i += 1) worst = Math.max(worst, Math.abs(got[i] - once[i]));
    assert.ok(worst < 1e-6, `a block of ${span} differs by ${worst.toExponential(2)}`);
  }
});

test('it leaves alone what is already under the ceiling', () => {
  // A safety limiter that colours a quiet sketch is a safety limiter nobody
  // should have in the path. Delayed by the lookahead, and otherwise the
  // samples it was given.
  const signal = SIGNALS['already quiet']();
  const out = through(signal);
  const ahead = Math.round(LIMIT_AHEAD * RATE);

  let worst = 0;
  for (let i = ahead; i < signal.length; i += 1) {
    worst = Math.max(worst, Math.abs(out[i] - signal[i - ahead]));
  }
  assert.ok(worst < 1e-6, `a quiet signal came back changed by ${worst.toExponential(2)}`);
});

test('the gain is in place before the peak it is for arrives', () => {
  // Which is the whole reason for the lookahead, and the thing the three
  // millisecond attack on the node this replaced could not do. A single
  // sample at twenty-four times full scale, with silence either side: the
  // limiter has to be down by the time it comes through, and it cannot be
  // down before it has any reason to be.
  const n = Math.round(RATE * 0.2);
  const signal = new Float32Array(n);
  const spike = Math.round(n / 2);
  signal[spike] = 24;

  const out = through(signal);
  assert.ok(Math.abs(out[spike + Math.round(LIMIT_AHEAD * RATE)]) <= ROOF + 1e-6,
    'the spike came through over the ceiling');

  // And nothing else moved: the signal either side of it was already silent,
  // so a limiter that pumped would show up as something other than zero.
  let elsewhere = 0;
  for (let i = 0; i < n; i += 1) {
    if (i === spike + Math.round(LIMIT_AHEAD * RATE)) continue;
    elsewhere = Math.max(elsewhere, Math.abs(out[i]));
  }
  assert.equal(elsewhere, 0, 'silence either side of the spike did not stay silent');
});

test('both channels move together, so the image does not', () => {
  // One gain across the channels. A limiter that worked each side separately
  // would swing the image every time it bit, which on a sketch bus is worse
  // than the overs it is there to catch.
  const n = Math.round(RATE * 0.5);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    left[i] = Math.sin((2 * Math.PI * 220 * i) / RATE) * 9;   // loud
    right[i] = Math.sin((2 * Math.PI * 220 * i) / RATE) * 0.5; // quiet
  }

  const limiter = makeLimiter(RATE);
  limiter.block([left, right]);

  // The ratio between the sides is what the image is, and it has to survive.
  const ahead = limiter.ahead;
  for (let i = ahead + 100; i < n; i += 97) {
    if (Math.abs(right[i]) < 1e-4) continue;
    const ratio = Math.abs(left[i] / right[i]);
    assert.ok(Math.abs(ratio - 18) < 0.2,
      `the sides came out ${ratio.toFixed(2)} apart rather than 18`);
  }
  assert.ok(peakOf(left) <= ROOF + 1e-6, 'and the loud side is still under the ceiling');
});

test('a ceiling of its own is honoured', () => {
  for (const ceiling of [0, -3, -12]) {
    const roof = 10 ** (ceiling / 20);
    const out = through(SIGNALS['hits over a sustained bed'](), { ceiling });
    assert.ok(peakOf(out) <= roof + 1e-6,
      `asked for ${ceiling} dB, got ${(20 * Math.log10(peakOf(out))).toFixed(2)}`);
  }
});
