import { svfOf, svfBiquad, svfRack } from '../src/plugins/eq/svf.js';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BAND_TYPES, STRIP, newStrip, bandGainAt, contributionOf, curveOf,
  averageLift, liftFrequencies, logFrequencies,
  SLOPES, FLAT_CORNER, RESTING_Q, sectionsOf, butterworth, exactHz, SHELF_Q, sectionGainAt,
  OCTAVE_EQUIVALENT, curveGap, curveReading, sectionTable, MOST_SECTIONS,
} from '../src/plugins/eq/filters.js';
import { eqSource } from '../src/plugins/eq/node.js';
import { tuneSections } from '../src/plugins/eq/sections.js';
import { averageSpectrum } from '../src/plugins/eq/spectrum.js';
import { EQPlugin } from '../src/plugins/eq/plugin.js';

const rate = 48000;
const on = (band) => ({ gain: 0, q: 1, on: true, ...band });

/** An AudioBuffer, near enough: the spectrum only reads these two things. */
const bufferOf = (fill, seconds = 1) => {
  const samples = new Float32Array(rate * seconds);
  for (let i = 0; i < samples.length; i += 1) samples[i] = fill(i / rate, i);
  return { sampleRate: rate, getChannelData: () => samples };
};

test('a band does exactly what it says at its own frequency', () => {
  // This is what lets a handle sit on the curve: each type contributes
  // something known where it lives.
  assert.equal(bandGainAt(on({ type: 'peaking', frequency: 1000, gain: 6, q: 2 }), 1000, rate).toFixed(3), '6.000');
  assert.equal(bandGainAt(on({ type: 'lowshelf', frequency: 200, gain: 8 }), 200, rate).toFixed(3), '4.000');
  assert.equal(bandGainAt(on({ type: 'highshelf', frequency: 5000, gain: -10 }), 5000, rate).toFixed(3), '-5.000');
  assert.equal(bandGainAt(on({ type: 'highpass', frequency: 300, q: 6 }), 300, rate).toFixed(3), '6.000');
  assert.equal(bandGainAt(on({ type: 'lowpass', frequency: 4000, q: -3 }), 4000, rate).toFixed(3), '-3.000');

  for (const [type, spec] of Object.entries(BAND_TYPES)) {
    const band = on({ type, frequency: 1000, gain: 8, q: 4 });
    const expected = spec.gain ? 8 * spec.contributes : 4;
    assert.ok(Math.abs(bandGainAt(band, 1000, rate) - expected) < 0.001,
      `${type} does not contribute what BAND_TYPES says it does`);
  }
});

test('an off band is out of the curve entirely', () => {
  const band = { type: 'peaking', frequency: 1000, gain: 12, q: 1, on: false };
  assert.equal(curveOf([band], [1000], rate)[0], 0);
  assert.equal(contributionOf(band, rate), 0);
  assert.equal(curveOf(newStrip(), logFrequencies(20), rate).every((db) => db === 0), true,
    'a fresh strip does nothing at all');
});

test('the strip is in the order an engineer reads it', () => {
  const frequencies = STRIP.map((band) => band.frequency);
  assert.deepEqual([...frequencies].sort((a, b) => a - b), frequencies, 'low to high');
  assert.equal(STRIP[0].type, 'highpass');
  assert.equal(STRIP[STRIP.length - 1].type, 'lowpass');
  for (const band of STRIP) {
    if (BAND_TYPES[band.type].resonance) {
      assert.ok(band.q <= 0, `${band.id} starts resonant; a cut should start flat`);
    }
  }
});

test('the spectrum finds where a sound actually is', () => {
  const frequencies = liftFrequencies();
  const tone = averageSpectrum(bufferOf((t) => Math.sin(2 * Math.PI * 1000 * t)), frequencies);

  const loudest = tone.indexOf(Math.max(...tone));
  assert.ok(Math.abs(frequencies[loudest] - 1000) / 1000 < 0.15,
    `a 1 kHz tone reads loudest at ${Math.round(frequencies[loudest])} Hz`);

  // And nothing an octave away from it.
  const away = frequencies.findIndex((hz) => hz > 4000);
  assert.ok(tone[away] < tone[loudest] / 1e6, 'a tone is not broadband');
});

test('auto gain knows a move is worth what the material has there', () => {
  const frequencies = liftFrequencies();
  // Something with energy only down low, as a bass-heavy loop is.
  const bass = averageSpectrum(bufferOf((t) => Math.sin(2 * Math.PI * 80 * t)), frequencies);

  const lowShelf = [{ type: 'lowshelf', frequency: 200, gain: 10, q: 0.7, on: true }];
  const highShelf = [{ type: 'highshelf', frequency: 6000, gain: 10, q: 0.7, on: true }];

  // Weighted by what is actually there, lifting the bass is a real change and
  // lifting the top is nearly nothing. Unweighted, the two look alike.
  assert.ok(averageLift(lowShelf, rate, bass) > 9, 'a shelf over the bass of a bass-heavy loop is loud');
  assert.ok(averageLift(highShelf, rate, bass) < 0.5, 'a shelf where there is no energy is not');

  const evenly = averageLift(highShelf, rate);
  assert.ok(evenly > 2, `unweighted, the same move looks like ${evenly.toFixed(1)} dB`);
});

test('auto gain is a fair trade: it never rewards boosting', () => {
  const frequencies = liftFrequencies();
  const pink = averageSpectrum(bufferOf(() => Math.random() * 2 - 1), frequencies);

  for (const gain of [3, 6, 12, 18]) {
    const boost = [{ type: 'peaking', frequency: 1000, gain, q: 0.8, on: true }];
    const cut = [{ type: 'peaking', frequency: 1000, gain: -gain, q: 0.8, on: true }];

    assert.ok(averageLift(boost, rate, pink) > 0, 'a boost lifts');
    assert.ok(averageLift(cut, rate, pink) < 0, 'a cut drops');
  }

  assert.equal(averageLift(newStrip(), rate, pink).toFixed(6), '0.000000', 'and a flat EQ does neither');
});

/* --- slopes ---------------------------------------------------------------- */

test('a cut is as steep as the number written on it', () => {
  for (const slope of SLOPES) {
    const band = { type: 'highpass', frequency: 1000, gain: 0, q: FLAT_CORNER, slope, on: true };

    // Measured well below the corner, where the asymptote has arrived: an
    // octave of frequency should cost exactly the decibels on the label.
    const lower = bandGainAt(band, 1000 / 16, 48000);
    const upper = bandGainAt(band, 1000 / 8, 48000);
    const measured = upper - lower;

    assert.ok(Math.abs(measured - slope) < 0.2,
      `a ${slope} dB/oct cut measured ${measured.toFixed(2)} dB/oct`);
  }
});

test('a cut is three decibels down at its corner, however steep it is', () => {
  // This is what keeps the handle on the curve without the drawing having to
  // know anything about slope: the section Qs of a Butterworth cascade
  // multiply to 1/root 2 at every even order.
  for (const slope of SLOPES) {
    for (const type of ['highpass', 'lowpass']) {
      const band = { type, frequency: 500, gain: 0, q: FLAT_CORNER, slope, on: true };
      assert.ok(Math.abs(bandGainAt(band, 500, 48000) - FLAT_CORNER) < 0.01,
        `${slope} dB/oct ${type} sits at ${bandGainAt(band, 500, 48000).toFixed(3)} at its corner`);
    }
  }
});

test('resonance is what a cut contributes at its corner, at any slope', () => {
  for (const slope of SLOPES) {
    for (const resonance of [-12, FLAT_CORNER, 0, 6, 12]) {
      const band = { type: 'highpass', frequency: 800, gain: 0, q: resonance, slope, on: true };
      const there = contributionOf(band, 48000);
      assert.ok(Math.abs(there - resonance) < 0.01,
        `${slope} dB/oct with ${resonance.toFixed(1)} dB of resonance contributes ${there.toFixed(3)}`);
    }
  }
});

test('a cut is built from as many biquads as its slope needs, resonance on the last', () => {
  for (const slope of SLOPES) {
    const band = { type: 'lowpass', frequency: 2000, gain: 0, q: 9, slope, on: true };
    const sections = sectionsOf(band);

    assert.equal(sections.length, slope / 12, `${slope} dB/oct wants ${slope / 12} biquads`);
    for (const section of sections) {
      assert.equal(section.type, 'lowpass');
      assert.equal(section.frequency, 2000);
    }

    // The resonance rides on the sharpest section and the rest stay flat.
    const last = sections[sections.length - 1];
    assert.ok(last.q > (sections[0]?.q ?? 0) || sections.length === 1, 'the last section is the sharp one');
    assert.ok(Math.abs(sections.reduce((sum, s) => sum + s.q, 0) - 9) < 0.01,
      'the sections together come to the resonance asked for');
  }

  // Everything else is one biquad, and is itself.
  for (const type of ['peaking', 'lowshelf', 'highshelf']) {
    const band = { type, frequency: 1000, gain: 3, q: 1.2, slope: 48, on: true };
    assert.deepEqual(sectionsOf(band), [band], `a ${type} is one filter, slope or no slope`);
  }
});

test('a steep cut that is switched off is still out of the circuit', () => {
  // The same promise the twelve dB one makes: an off band is not a band
  // parked somewhere quiet, it is not there at all.
  const off = { type: 'lowpass', frequency: 15000, gain: 0, q: FLAT_CORNER, slope: 48, on: false };
  const curve = curveOf([off], [1000, 8000, 12000, 16000], 48000);
  for (const value of curve) assert.equal(value, 0);
});

/* --- changing what a band is ---------------------------------------------- */

test('every band type has a resting Q that means something in its own terms', () => {
  for (const type of Object.keys(BAND_TYPES)) {
    const resting = RESTING_Q[type];
    assert.equal(typeof resting, 'number', `${type} has no resting Q`);

    if (BAND_TYPES[type].resonance) {
      // A cut reads Q as decibels, so its resting value has to be flat - a
      // peak's 1.4 carried across would be 1.4 dB of ring on the corner.
      assert.ok(Math.abs(resting - FLAT_CORNER) < 0.01, `${type} should rest flat`);
    } else {
      assert.ok(resting > 0.3 && resting < 12, `${type} should rest on a usable Q`);
    }
  }
});

/* --- typing a number in ---------------------------------------------------- */

test('a frequency can be written however an engineer writes it', () => {
  const read = (text) => EQPlugin.readEntry(text, 'frequency');

  for (const text of ['3150', '3.15k', '3.15 kHz', '3k15', ' 3150 Hz ', '3.15K']) {
    assert.ok(Math.abs(read(text) - 3150) < 0.5, `"${text}" should be 3150, and read ${read(text)}`);
  }

  assert.equal(read('80'), 80);
  assert.equal(read('nonsense'), null, 'what cannot be read leaves the band alone');
  assert.equal(read(''), null);
});

test('gains and Qs are read as plain numbers, units and all', () => {
  assert.equal(EQPlugin.readEntry('-4.5 dB', 'gain'), -4.5);
  assert.equal(EQPlugin.readEntry('+6', 'gain'), 6);
  assert.equal(EQPlugin.readEntry('1.25', 'q'), 1.25);
  assert.equal(EQPlugin.readEntry('  ', 'gain'), null);
});

test('a Butterworth cascade is flat at its corner at every order', () => {
  // The fact the whole slope design rests on. The section Qs multiply to
  // 1/root 2 whatever the order, so the cascade is 3 dB down at its corner
  // whether it is one biquad or four - which is why the drawing does not have
  // to know about slope to put a handle on the curve.
  for (const slope of SLOPES) {
    const corners = butterworth(slope / 6);
    const together = corners.reduce((sum, db) => sum + db, 0);
    assert.ok(Math.abs(together - FLAT_CORNER) < 1e-9,
      `${slope} dB/oct comes to ${together.toFixed(6)} dB, not ${FLAT_CORNER.toFixed(6)}`);
    // And they are sorted gentlest first, so the last one is the sharp one.
    for (let i = 1; i < corners.length; i += 1) assert.ok(corners[i] > corners[i - 1]);
  }
});

test('a frequency survives being written down and read back', () => {
  for (const hz of [20, 80, 315, 1000, 3150, 6300, 12500, 20000]) {
    const written = exactHz(hz);
    const read = EQPlugin.readEntry(written, 'frequency');
    assert.ok(Math.abs(read - hz) < 0.5, `${hz} was written "${written}" and read back ${read}`);
  }
});

test('a narrow miss is worth less than a wide one of the same depth', () => {
  // Measured on this app's bed: a bell at 1 kHz, what the curve claims against
  // how far the bed's own octave band actually moves.
  //
  //       width   3 dB    6 dB    9 dB   12 dB
  //    1.92 oct   1.88    3.49    4.78    5.74
  //    1.00 oct   1.67    3.16    4.39    5.34
  //    0.48 oct   1.01    2.04    3.09    4.09
  //    0.24 oct   0.56    1.29    2.20    3.27
  //    0.12 oct   0.37    0.91    1.69    2.69
  //
  // Twelve decibels of narrow bell move it less than six of a wide one, which
  // is why the worst point alone could fail a match on something nobody can
  // hear. These are the ratios that table gives, inverted and referred to an
  // octave.
  for (const [octaves, want] of [[1.92, 1], [1, 1], [0.48, 1.44], [0.24, 2.04], [0.12, 2.89]]) {
    const got = OCTAVE_EQUIVALENT(octaves);
    assert.ok(Math.abs(got - want) < 0.1,
      `${octaves} octaves should be worth ${want}x, not ${got.toFixed(2)}x`);
  }
  // and it never forgives a wide one, nor forgives any more than threefold
  assert.equal(OCTAVE_EQUIVALENT(4), 1);
  assert.equal(OCTAVE_EQUIVALENT(0.001), 3);
});

test('a band put in the wrong place is not a narrow miss', () => {
  // The first version of the width read outwards from the worst point until
  // the miss halved, and called this narrow: a band a third of an octave off
  // its mark makes two misses, up on one side and down on the other, and
  // measuring only the lobe the worst point sits in forgave an audible
  // misplacement. The width is the whole area over the peak now.
  const rate = 48000;
  const right = curveReading([{ type: 'peaking', frequency: 1000, gain: 9, q: 1.41, on: true }], rate);
  const shifted = curveReading([{ type: 'peaking', frequency: 1260, gain: 9, q: 1.41, on: true }], rate);
  const narrow = curveReading([{ type: 'peaking', frequency: 1000, gain: 9, q: 8, on: true }], rate);
  const flat = curveReading([], rate);

  const moved = curveGap(shifted, right);
  assert.ok(moved.octaves > 1,
    `a misplaced band should read wide, not ${moved.octaves.toFixed(2)} octaves`);
  assert.ok(Math.abs(moved.off - moved.peak) < 0.01, 'and should get no forgiveness for it');

  // where a genuinely narrow miss still does
  const pointy = curveGap(narrow, flat);
  assert.ok(pointy.octaves < 0.5, `a Q of 8 should read narrow, not ${pointy.octaves.toFixed(2)}`);
  assert.ok(pointy.off < pointy.peak * 0.8, 'and should be forgiven for it');
});

test('the state-variable filter is the cookbook filter, written another way', () => {
  // The whole basis for swapping the engine underneath the EQ: every band type
  // the app has, the cookbook coefficients it used to compute against the ones
  // the SVF produces, at 200 frequencies from 20 Hz to 23 kHz.
  //
  // Measured bit-identical - genuinely 0.000000 dB - for bells at every
  // frequency including 15 kHz, for both shelves, and for cuts flat and
  // resonant. A trapezoidal SVF is the bilinear transform in other clothes, so
  // it warps near Nyquist exactly as the cookbook does, which is the point:
  // the first job was to change nothing.
  //
  // The shelves were the one exception until the resting Q became root-half.
  // See SHELF_Q.
  const rate = 48000;
  const probe = logFrequencies(200, 20, 23000);

  const cookbook = ({ type, frequency, gain, q }) => {
    const w0 = (2 * Math.PI * frequency) / rate;
    const cos = Math.cos(w0);
    const sin = Math.sin(w0);
    const A = 10 ** (gain / 40);
    let b0; let b1; let b2; let a0; let a1; let a2;
    if (type === 'peaking') {
      const alpha = sin / (2 * q);
      b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A;
      a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A;
    } else if (type === 'lowshelf' || type === 'highshelf') {
      const alpha = (sin / 2) * Math.sqrt(2);
      const root = 2 * Math.sqrt(A) * alpha;
      if (type === 'lowshelf') {
        b0 = A * ((A + 1) - (A - 1) * cos + root);
        b1 = 2 * A * ((A - 1) - (A + 1) * cos);
        b2 = A * ((A + 1) - (A - 1) * cos - root);
        a0 = (A + 1) + (A - 1) * cos + root;
        a1 = -2 * ((A - 1) + (A + 1) * cos);
        a2 = (A + 1) + (A - 1) * cos - root;
      } else {
        b0 = A * ((A + 1) + (A - 1) * cos + root);
        b1 = -2 * A * ((A - 1) + (A + 1) * cos);
        b2 = A * ((A + 1) + (A - 1) * cos - root);
        a0 = (A + 1) - (A - 1) * cos + root;
        a1 = 2 * ((A - 1) - (A + 1) * cos);
        a2 = (A + 1) - (A - 1) * cos - root;
      }
    } else {
      const alpha = sin / (2 * 10 ** (q / 20));
      if (type === 'lowpass') { b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2; } else { b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2; }
      a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
    }
    return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
  };

  const CASES = [
    { type: 'peaking', frequency: 1000, gain: 9, q: 1.4 },
    { type: 'peaking', frequency: 15000, gain: 9, q: 2 },
    { type: 'peaking', frequency: 60, gain: -12, q: 4 },
    { type: 'lowshelf', frequency: 120, gain: 8, q: SHELF_Q },
    { type: 'lowshelf', frequency: 40, gain: -10, q: SHELF_Q },
    { type: 'highshelf', frequency: 8000, gain: -8, q: SHELF_Q },
    { type: 'highshelf', frequency: 12000, gain: 10, q: SHELF_Q },
    { type: 'lowpass', frequency: 6000, gain: 0, q: FLAT_CORNER },
    { type: 'lowpass', frequency: 6000, gain: 0, q: 6 },
    { type: 'highpass', frequency: 100, gain: 0, q: FLAT_CORNER },
    { type: 'highpass', frequency: 100, gain: 0, q: 6 },
  ];

  for (const band of CASES) {
    const was = cookbook(band);
    const now = svfBiquad(svfOf(band, rate));
    let worst = 0;
    for (const hz of probe) {
      worst = Math.max(worst, Math.abs(sectionGainAt(was, hz, rate) - sectionGainAt(now, hz, rate)));
    }
    assert.ok(worst < 1e-6,
      `${band.type} at ${band.frequency} Hz is ${worst.toFixed(6)} dB away from the cookbook`);
  }
});

test('a shelf rests where S = 1 has always put it', () => {
  // 0.7 was close enough to be invisible and wrong enough to make two models
  // disagree: 0.038 dB at the corner, which is nothing to hear and everything
  // to chase.
  assert.ok(Math.abs(SHELF_Q - Math.SQRT1_2) < 1e-12);
  for (const band of STRIP) {
    if (band.type === 'lowshelf' || band.type === 'highshelf') {
      assert.equal(band.q, SHELF_Q, `the ${band.id} band rests at ${band.q}`);
    }
  }
  assert.equal(RESTING_Q.lowshelf, SHELF_Q);
  assert.equal(RESTING_Q.highshelf, SHELF_Q);
});

/* --- the filter the audio thread actually runs ------------------------------ */

/**
 * What a rack does to an impulse, in decibels, at the frequencies asked for.
 *
 * Measured rather than read back out of the coefficients, which is the whole
 * point: `sectionGainAt` is arithmetic on numbers, and this is the sample loop
 * that will be running on the audio thread, with its own states and its own
 * order of operations.
 */
function responseOf(rack, frequencies, rate, length = 65536) {
  const ins = [new Float64Array(length)];
  const outs = [new Float64Array(length)];
  ins[0][0] = 1;
  rack.block(ins, outs);

  return frequencies.map((hz) => {
    // Goertzel, which is one bin of a DFT for two multiplies a sample rather
    // than a sine and a cosine. It is worth the four lines because the length
    // has to be this long: a Q of 8 at 50 Hz rings for a third of a second,
    // and at sixteen thousand samples the tail that was cut off read as
    // 0.065 dB of disagreement between the filter and the curve. At
    // sixty-five thousand it reads as zero.
    const w = (2 * Math.PI * hz) / rate;
    const twice = 2 * Math.cos(w);
    let s1 = 0;
    let s2 = 0;
    for (let n = 0; n < length; n += 1) {
      const s0 = outs[0][n] + twice * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    const re = s1 - s2 * Math.cos(w);
    const im = s2 * Math.sin(w);
    return 20 * Math.log10(Math.max(Math.hypot(re, im), 1e-12));
  });
}

test('the filter the audio runs is the curve the app draws', () => {
  // The one claim that matters, and the one that used to rest on the W3C spec
  // defining BiquadFilterNode with the cookbook formulas filters.js
  // implemented. It now rests on there being one filter: `svfOf` makes the
  // coefficients, `sectionGainAt` reads their response for the picture, and
  // `svfTick` runs them for the sound.
  //
  // Measured, below: the impulse response of the rack and the drawn curve
  // agree to a ten-millionth of a decibel from 30 Hz to 16 kHz, on the whole
  // strip at once and on every band type on its own. Most cases come in at
  // 1e-11 dB, which is double precision and nothing else; the worst is the
  // 50 Hz bell at 3e-7, which is the last of its ring still being cut off at
  // sixty-five thousand samples rather than any disagreement.
  const probe = logFrequencies(64, 30, 16000);

  const CASES = [
    ['a bell at 1 kHz', [on({ type: 'peaking', frequency: 1000, gain: 9, q: 1.4 })]],
    ['a bell at 15 kHz', [on({ type: 'peaking', frequency: 15000, gain: -12, q: 2 })]],
    ['a narrow bell at 50 Hz', [on({ type: 'peaking', frequency: 50, gain: 9, q: 8 })]],
    ['a low shelf', [on({ type: 'lowshelf', frequency: 120, gain: 8, q: SHELF_Q })]],
    ['a high shelf', [on({ type: 'highshelf', frequency: 8000, gain: -8, q: SHELF_Q })]],
    ['a 48 dB/oct high-pass',
      [on({ type: 'highpass', frequency: 100, q: FLAT_CORNER, slope: 48 })]],
    ['a resonant low-pass', [on({ type: 'lowpass', frequency: 6000, q: 6, slope: 24 })]],
    ['the whole strip', [
      on({ type: 'highpass', frequency: 40, q: FLAT_CORNER, slope: 24 }),
      on({ type: 'lowshelf', frequency: 120, gain: 5, q: SHELF_Q }),
      on({ type: 'peaking', frequency: 400, gain: -4, q: 1.4 }),
      on({ type: 'peaking', frequency: 2500, gain: 6, q: 2 }),
      on({ type: 'highshelf', frequency: 9000, gain: 4, q: SHELF_Q }),
      on({ type: 'lowpass', frequency: 17000, q: FLAT_CORNER }),
    ]],
  ];

  for (const [label, bands] of CASES) {
    const rack = svfRack(rate, bands.length * MOST_SECTIONS, 1);
    // Immediately: a glide is for a knob, and this is the filter arriving.
    rack.tune(sectionTable(bands, bands.length, rate), true);

    const heard = responseOf(rack, probe, rate);
    const drawn = curveOf(bands, probe, rate);

    let worst = 0;
    let worstAt = 0;
    for (let i = 0; i < probe.length; i += 1) {
      const off = Math.abs(heard[i] - drawn[i]);
      if (off > worst) { worst = off; worstAt = probe[i]; }
    }
    assert.ok(worst < 1e-6,
      `${label}: the rack is ${worst.toExponential(2)} dB from the curve at ${Math.round(worstAt)} Hz`);
  }
});

test('a section the slope does not need, and a band switched off, are nothing', () => {
  // Not "nearly nothing": a peak with no gain has m1 of exactly zero, so the
  // section returns its input bit for bit. Which is what lets the chain be a
  // fixed run of sections that is never added to or taken from - and a graph
  // rebuilt under a running loop clicks.
  const bands = [on({ type: 'peaking', frequency: 1000, gain: 0, q: 1.4 }), { ...STRIP[0], on: false }];
  const rack = svfRack(rate, bands.length * MOST_SECTIONS, 1);
  rack.tune(sectionTable(bands, bands.length, rate), true);

  const ins = [new Float64Array(512)];
  const outs = [new Float64Array(512)];
  for (let i = 0; i < 512; i += 1) ins[0][i] = Math.sin(i * 0.07) * 0.5 + Math.sin(i * 0.9) * 0.2;
  rack.block(ins, outs);

  for (let i = 0; i < 512; i += 1) assert.equal(outs[0][i], ins[0][i]);
});

test('a knob glides to where it was sent, and arrives', () => {
  // Ten milliseconds, the same time constant the AudioParams used, so a knob
  // feels the way it felt before the engine changed underneath it.
  const rack = svfRack(rate, MOST_SECTIONS, 1);
  const flat = sectionTable([on({ type: 'peaking', frequency: 1000, gain: 0, q: 1.4 })], 1, rate);
  const lifted = sectionTable([on({ type: 'peaking', frequency: 1000, gain: 12, q: 1.4 })], 1, rate);

  rack.tune(flat, true);
  rack.tune(lifted);

  // A fifth of a second, because an exponential never actually arrives and
  // this test wants exactness rather than inaudibility. The rack snaps the
  // last of the distance once the five coefficients are within a millionth
  // of where they were sent, which for twelve decibels of bell takes about
  // fourteen time constants; twenty is comfortably past it. Ten was not, and
  // read as seven millionths of a decibel at 30 Hz.
  const warm = [new Float64Array(Math.round(rate * 0.2))];
  rack.block(warm, [new Float64Array(warm[0].length)]);

  const probe = logFrequencies(48, 30, 16000);
  const heard = responseOf(rack, probe, rate);
  const drawn = curveOf([on({ type: 'peaking', frequency: 1000, gain: 12, q: 1.4 })], probe, rate);
  for (let i = 0; i < probe.length; i += 1) {
    assert.ok(Math.abs(heard[i] - drawn[i]) < 1e-6,
      `after gliding, ${Math.round(probe[i])} Hz is ${(heard[i] - drawn[i]).toExponential(2)} dB out`);
  }
});

test('the audio thread runs the same arithmetic as the marking', () => {
  // The worklet is written out of svf.js's own source, so this asks the
  // stringified copy and the module for the same thing and insists on zero.
  // The saturator's version of this test caught three constants missing from
  // a hand-kept prelude; this one is the reason the prelude is derived.
  const source = eqSource();
  const build = new Function(`${source.replace(/class HeadroomEq[\s\S]*$/, '')}\nreturn svfRack;`)();

  const bands = [on({ type: 'peaking', frequency: 1200, gain: 7, q: 2 }),
    on({ type: 'highpass', frequency: 90, q: 4, slope: 48 })];
  const table = sectionTable(bands, bands.length, rate);

  const theirs = build(rate, bands.length * MOST_SECTIONS, 1);
  const mine = svfRack(rate, bands.length * MOST_SECTIONS, 1);
  theirs.tune(table, true);
  mine.tune(table, true);

  const ins = [new Float64Array(4096)];
  for (let i = 0; i < 4096; i += 1) ins[0][i] = Math.sin(i * 0.07) * 0.5 + Math.sin(i * 0.9) * 0.2;
  const a = [new Float64Array(4096)];
  const b = [new Float64Array(4096)];
  theirs.block(ins, a);
  mine.block(ins, b);

  let worst = 0;
  for (let i = 0; i < 4096; i += 1) worst = Math.max(worst, Math.abs(a[0][i] - b[0][i]));
  assert.equal(worst, 0);
});

/* --- what the face draws, as arithmetic ------------------------------------ */

test("a band's shaded edge is the curve the other bands make", () => {
  // The property the display now rests on. Each band is drawn as the curve
  // against the curve without that band, which is what makes its shaded
  // region touch the line rather than float under it - and the face computes
  // that second edge as `whole - own`, one subtraction per point, rather than
  // by building a second curve out of the other five.
  //
  // That is only the same thing because a curve is the sum of its bands in
  // decibels. Nothing says it has to stay that way: fold the auto gain into
  // `curveOf`, or clamp it, and every region quietly stops meaning what it
  // says while the picture still looks plausible.
  const probe = logFrequencies(64, 20, 20000);
  const strip = [
    on({ type: 'highpass', frequency: 55, q: FLAT_CORNER, slope: 24 }),
    on({ type: 'lowshelf', frequency: 150, gain: 7, q: SHELF_Q }),
    on({ type: 'peaking', frequency: 450, gain: -6, q: 2.2 }),
    on({ type: 'peaking', frequency: 2500, gain: 8, q: 1.1 }),
    on({ type: 'highshelf', frequency: 7000, gain: 5, q: SHELF_Q }),
  ];

  const whole = curveOf(strip, probe, rate);

  strip.forEach((band, i) => {
    const own = curveOf([band], probe, rate);
    const others = curveOf(strip.filter((_, n) => n !== i), probe, rate);
    let worst = 0;
    for (let n = 0; n < probe.length; n += 1) {
      worst = Math.max(worst, Math.abs((whole[n] - own[n]) - others[n]));
    }
    assert.ok(worst < 1e-9,
      `band ${i}: the edge drawn is ${worst.toExponential(2)} dB from the curve without it`);
  });
});

test('auto gain can be switched off, and then the trim is unity', () => {
  // The switch on the face is a real one. It was tempting to make it a label
  // - the number is right there beside it - and a switch that does nothing is
  // worse than no switch.
  const bands = [on({ type: 'peaking', frequency: 1000, gain: 9, q: 1.4 })];
  const chain = { bands: 0, engine: null, trim: { gain: { value: 1 } } };

  tuneSections(chain, bands, 0, rate, null, { glide: false });
  const lift = averageLift(bands, rate, null);
  assert.ok(lift > 0.1, 'a +9 dB bell should lift the whole curve');
  assert.ok(Math.abs(chain.trim.gain.value - 10 ** (-lift / 20)) < 1e-12);

  tuneSections(chain, bands, 0, rate, null, { glide: false, autoGain: false });
  assert.equal(chain.trim.gain.value, 1);
});
