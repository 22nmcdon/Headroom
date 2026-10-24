import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BAND_TYPES, STRIP, newStrip, bandGainAt, contributionOf, curveOf,
  averageLift, liftFrequencies, logFrequencies,
  SLOPES, FLAT_CORNER, RESTING_Q, sectionsOf, butterworth, exactHz,
  OCTAVE_EQUIVALENT, curveGap, curveReading,
} from '../src/plugins/eq/filters.js';
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
