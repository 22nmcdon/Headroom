import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HEAT_DEFAULTS, HEAT_LATENCY, MOST_TONE,
  shape, shaperCore, runShaper, heatTrim, harmonicsOf, transferCurve, foldback,
  CURVES, CURVE_ORDER, HEAT_LIMITS, TAPE_SPEEDS, DC_CORNER, crushTo,
} from '../src/plugins/saturation/shape.js';
import {
  HARMONICS, PROBE_BIN, PROBE_LENGTH, PROBE_LEVEL, seriesGap,
} from '../src/lib/harmonics.js';
import { fft } from '../src/lib/fft.js';
import { saturatorSource } from '../src/plugins/saturation/node.js';
import { mulberry32 } from '../src/lib/random.js';
import { HEAT_WORK as saturation } from '../src/learn/work/saturation.js';
import {
  DAMAGE, DAMAGE_IDS, damageOf, damageChoices, crushBits, holdFor, addClick,
  snrOf, bitsFrom,
} from '../src/lib/damage.js';
import { integrated, kWeight } from '../src/lib/loudness.js';

const rate = 48000;

/** A tone, or a few of them together. */
function tone(freqs, seconds = 0.4, amp = 0.5) {
  const length = Math.round(rate * seconds);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    let v = 0;
    for (const f of freqs) v += Math.sin((2 * Math.PI * f * i) / rate);
    out[i] = (amp * v) / freqs.length;
  }
  return out;
}

const rms = (xs, from = 0, to = xs.length) => {
  let sum = 0;
  for (let i = from; i < to; i += 1) sum += xs[i] * xs[i];
  return Math.sqrt(sum / Math.max(1, to - from));
};

/* --- the curve ------------------------------------------------------------- */

test('the curve is odd, bounded, and straight through the middle', () => {
  for (const n of [1, 2, 3, 5]) {
    assert.equal(shape(0, n), 0);
    // Odd: what it does to a negative is what it does to the positive,
    // turned over. This is why a curve with no bias has no even harmonics.
    for (const x of [0.1, 0.4, 0.9, 2, 8]) {
      assert.ok(Math.abs(shape(-x, n) + shape(x, n)) < 1e-12);
      assert.ok(Math.abs(shape(x, n)) < 1);
    }
    // And it leaves a quiet signal alone.
    assert.ok(Math.abs(shape(0.001, n) - 0.001) < 1e-5);
  }
});

test('a hardness that never bends is a straight line, and so is no drive', () => {
  const points = transferCurve({ ...HEAT_DEFAULTS, drive: 0, mix: 1 });
  points.forEach((y, i) => {
    const x = (i / (points.length - 1)) * 2 - 1;
    // At unity the curve still bends at the extremes - that is what a
    // saturator is - but it must pass through the middle unchanged.
    if (Math.abs(x) < 0.25) assert.ok(Math.abs(y - x) < 0.02, `${x} came out ${y}`);
  });
});

/* --- what it does to a sine ------------------------------------------------ */

test('a symmetric curve makes odd harmonics only, and a biased one makes both', () => {
  const symmetric = harmonicsOf(rate, { ...HEAT_DEFAULTS, drive: 16, bias: 0 });
  for (const m of HARMONICS) {
    if (m % 2 === 0) assert.ok(symmetric.harmonics[m] < -100, `${m} should be absent`);
    else assert.ok(symmetric.harmonics[m] > -60, `${m} should be there`);
  }

  const biased = harmonicsOf(rate, { ...HEAT_DEFAULTS, drive: 16, bias: 1 });
  // Only the near half of the series: the tenth harmonic of a gentle setting
  // is genuinely down in the noise whether or not there is a bias on it.
  for (const m of [2, 3, 4, 5, 6]) assert.ok(biased.harmonics[m] > -60, `${m} should be there`);

  // And the point of the bias: the even half arrives loud enough to lead.
  assert.ok(biased.even > biased.odd, 'bias should put the even harmonics in front');
});

test('more drive is more harmonics, and mix pulls all of them back together', () => {
  let last = -Infinity;
  for (const drive of [4, 8, 12, 16, 20]) {
    const thd = harmonicsOf(rate, { ...HEAT_DEFAULTS, drive, bias: 0.4 }).thd;
    assert.ok(thd > last, `${drive} dB should be dirtier than the setting below it`);
    last = thd;
  }

  let loudest = Infinity;
  for (const mix of [1, 0.75, 0.5, 0.25]) {
    const thd = harmonicsOf(rate, { ...HEAT_DEFAULTS, drive: 18, bias: 0.4, mix }).thd;
    assert.ok(thd < loudest, `${mix} should be cleaner than the mix above it`);
    loudest = thd;
  }
});

test('the tone control takes the top of the series away', () => {
  const open = harmonicsOf(rate, { ...HEAT_DEFAULTS, drive: 18, bias: 0.4, tone: MOST_TONE });
  const shut = harmonicsOf(rate, { ...HEAT_DEFAULTS, drive: 18, bias: 0.4, tone: 1000 });

  assert.ok(shut.harmonics[10] < open.harmonics[10] - 8, 'the tenth should be well down');
  // And it takes the top more than the bottom, which is what a tone control is.
  assert.ok(open.harmonics[10] - shut.harmonics[10] > open.harmonics[2] - shut.harmonics[2]);
});

/* --- the parts that are easy to get wrong ---------------------------------- */

test('a dry mix comes back out as what went in, delayed and nothing else', () => {
  // The oversampling filters hold the signal up by a fixed number of samples,
  // and if the dry path is not held up with it a mix control becomes a comb
  // filter - notches every kilohertz through the one knob whose whole point
  // is that it changes nothing else.
  const input = tone([220, 1000, 4300], 0.2);
  const out = runShaper(input, rate, { ...HEAT_DEFAULTS, drive: 24, bias: 0.6, mix: 0 });

  let worst = 0;
  for (let i = HEAT_LATENCY; i < input.length; i += 1) {
    worst = Math.max(worst, Math.abs(out[i] - input[i - HEAT_LATENCY]));
  }
  assert.ok(worst < 1e-6, `dry path is out by ${worst}`);
});

test('running the curve faster than the signal is what keeps it harmonic', () => {
  // The reason this is eight times oversampled. Every harmonic a curve makes
  // above half the sample rate folds back down to a frequency that is not a
  // harmonic of anything, and inharmonic is the one thing real saturation
  // never sounds like.
  //
  // Measured against the same curve run straight, at the rate the signal is
  // already at, which is what this did first.
  const straight = (settings, bin) => {
    const gain = 10 ** (settings.drive / 20);
    const offset = settings.bias * 0.7;
    const centre = shape(offset, settings.hardness);
    const step = (2 * Math.PI * bin) / 16384;

    const re = new Float64Array(16384);
    const im = new Float64Array(16384);
    for (let i = 0; i < re.length; i += 1) {
      re[i] = shape(0.5 * Math.sin(step * i) * gain + offset, settings.hardness) - centre;
    }
    fft(re, im);

    let total = 0;
    let series = 0;
    for (let i = 1; i < re.length / 2; i += 1) total += re[i] * re[i] + im[i] * im[i];
    for (let m = 1; bin * m < re.length / 2; m += 1) {
      series += re[bin * m] * re[bin * m] + im[bin * m] * im[bin * m];
    }
    return 10 * Math.log10(Math.max(total - series, 1e-20)
      / Math.max(re[bin] * re[bin] + im[bin] * im[bin], 1e-20));
  };

  // 440 Hz, 4.4 kHz and 13 kHz - a note, something in the middle, and a
  // hi-hat, which is the one that was unacceptable without this.
  for (const bin of [150, 1500, 4500]) {
    for (const hardness of [1, 5]) {
      const settings = { ...HEAT_DEFAULTS, drive: 30, bias: 0.6, hardness };
      const ours = foldback(rate, settings, bin);
      assert.ok(ours < -28, `bin ${bin} folded back ${ours.toFixed(1)} dB down`);

      if (bin >= 1500) {
        const plain = straight(settings, bin);
        assert.ok(ours < plain - 20,
          `bin ${bin}: ${ours.toFixed(1)} dB is no better than the ${plain.toFixed(1)} dB `
          + 'the same curve gives with no oversampling at all');
      }
    }
  }
});

test('full-wave rectification takes the note away and leaves the octave', () => {
  // The whole reason this family is here. Half-wave keeps the fundamental and
  // puts evens above it; full-wave folds the other half up, so what comes out
  // repeats twice as often as what went in and the tone at 440 is gone.
  const half = harmonicsOf(rate, { ...HEAT_DEFAULTS, mode: 'rectify', amount: 0, drive: 12 });
  const full = harmonicsOf(rate, { ...HEAT_DEFAULTS, mode: 'rectify', amount: 1, drive: 12 });

  assert.ok(half.fundamental > -1, `half wave lost the note: ${half.fundamental.toFixed(1)}`);
  assert.ok(half.even > half.odd, 'half wave should lead with evens');

  assert.ok(full.fundamental < -60, `full wave kept the note: ${full.fundamental.toFixed(1)}`);
  assert.ok(full.odd < -60, `full wave made odd harmonics: ${full.odd.toFixed(1)}`);
  assert.ok(full.harmonics[2] > -1, 'the octave should be the loudest thing left');
});

test('a reading taken when the fundamental is gone is still a reading', () => {
  // It was not. The series is read against the fundamental, and full-wave
  // rectification removes it, so the second harmonic came back 268 dB "above"
  // the fundamental - a division by nothing rather than a measurement. It is
  // read against the loudest component now, which is the same number for
  // every family that merely bends a curve.
  const full = harmonicsOf(rate, { ...HEAT_DEFAULTS, mode: 'rectify', amount: 1, drive: 12 });
  for (const m of HARMONICS) {
    assert.ok(full.harmonics[m] <= 0.01, `harmonic ${m} reads ${full.harmonics[m].toFixed(1)} dB`);
  }
  assert.ok(full.thd < 20, `thd reads ${full.thd.toFixed(1)}`);
  assert.ok(full.aliasing < -40, `the junk floor reads ${full.aliasing.toFixed(1)}`);
});

test('folding makes a dense odd series and does not alias', () => {
  // A sine folded by a sine is still a harmonic series, which this file used
  // to claim otherwise about. Measured: no foldback at six folds, and the
  // fundamental is scrambled rather than merely bent.
  const gentle = harmonicsOf(rate, { ...HEAT_DEFAULTS, mode: 'fold', folds: 1, drive: 12 });
  const hard = harmonicsOf(rate, { ...HEAT_DEFAULTS, mode: 'fold', folds: 6, drive: 12 });

  assert.ok(gentle.even < -100, 'a fold is odd-symmetric, so there are no evens');
  assert.ok(hard.even < -100, 'still none at six folds');
  assert.ok(hard.thd > gentle.thd + 10, 'more folds should be a lot more harmonics');
  assert.ok(hard.fundamental < -20, 'the note should be scrambled, not just bent');
  assert.ok(hard.aliasing < -150, `six folds aliased: ${hard.aliasing.toFixed(1)} dB`);
});

test('crushing makes junk, and more of it the harder it is crushed', () => {
  // The one family whose point is the aliasing, which is why it is the only
  // one that runs at the signal's own rate. If this ever starts coming back
  // quiet, something has put it back inside the oversampling.
  const at = (s) => harmonicsOf(rate, { ...HEAT_DEFAULTS, mode: 'crush', drive: 0, ...s }).aliasing;

  const clean = at({ bits: 16 });
  const rough = at({ bits: 8 });
  const broken = at({ bits: 4 });
  const worst = at({ bits: 2 });
  assert.ok(clean < rough && rough < broken && broken < worst,
    `the floor should climb: ${[clean, rough, broken, worst].map((v) => v.toFixed(0)).join(' ')}`);
  assert.ok(worst > -30, `two bits should be filthy, not ${worst.toFixed(1)} dB`);

  // and holding a sample is the other half of it
  assert.ok(at({ bits: 16, hold: 8 }) > at({ bits: 16, hold: 1 }) + 40, 'holding should make junk too');
});

test('a step of dither costs a bit and buys a floor that does not follow the music', () => {
  // The crusher's own dither, which is measured in steps of its own ladder
  // rather than in decibels, because a step is what it is: one step of
  // triangular noise is the classic amount and the number everybody's
  // converter used.
  assert.ok(CURVES.crush.knobs.includes('dither'), 'the crusher has no dither knob');
  assert.equal(HEAT_DEFAULTS.dither, 0, 'dither should start off, like every other colour here');

  const sine = new Float32Array(rate);
  for (let i = 0; i < rate; i += 1) sine[i] = Math.sin((2 * Math.PI * 997 * i) / rate);
  const ladder = (bits, dither) => {
    const out = new Float32Array(rate);
    for (let i = 0; i < rate; i += 1) out[i] = crushTo(sine[i], bits, dither);
    return snrOf(sine, out);
  };

  //  bits   6.02b + 1.76   no dither   half a step   one step   two steps
  //     4           25.8        26.2          24.5       21.1        16.3
  //     8           49.9        50.0          48.3       45.1        40.3
  //    12           74.0        74.0          72.2       69.3        64.4
  //    16           98.1        98.1          96.3       93.4        88.5
  //
  // One step sits 4.7 to 5.1 below the bare ladder, against the 4.77
  // triangular dither is supposed to cost - and the cost is a constant and
  // not a fraction, which is the point: it is noise added to the signal
  // rather than anything done to the rounding. The widest of them is four
  // bits, where a step of noise is an eighth of the whole travel and the
  // approximation the 4.77 comes from has stopped being a good one.
  for (const bits of [4, 8, 12, 16]) {
    const bare = ladder(bits, 0);
    assert.ok(Math.abs(bare - (6.02 * bits + 1.76)) < 0.5,
      `${bits} bits undithered read ${bare.toFixed(1)} dB`);

    const cost = bare - ladder(bits, 1);
    assert.ok(cost > 3.5 && cost < 6, `a step of dither cost ${cost.toFixed(2)} dB at ${bits} bits`);
    // And half a step costs a good deal less than half of that - 1.7 dB
    // against 4.8 - so the knob is worth turning to somewhere in between
    // rather than being a switch with a travel drawn on it.
    const half = bare - ladder(bits, 0.5);
    assert.ok(half > 1 && half < cost - 1, `half a step cost ${half.toFixed(2)} dB at ${bits} bits`);
  }

  // Nothing at all at nought, which is what keeps every other round in this
  // app repeatable: the crusher is in the marking as well as in the sound.
  for (let i = 0; i < 2000; i += 1) {
    assert.equal(crushTo(sine[i], 8, 0), crushTo(sine[i], 8),
      'dither off is not the same as no dither at all');
  }

  // The case it is for. A fade at eight bits falls off the bottom of the
  // ladder and stops - the tail is a staircase and then it is silence - and
  // a step of dither turns that into noise with the signal still in it.
  const fade = new Float32Array(rate);
  for (let i = 0; i < rate; i += 1) {
    fade[i] = Math.sin((2 * Math.PI * 440 * i) / rate) * (1 - i / rate) * 0.002;
  }
  const tailOf = (dither) => Float32Array
    .from(fade.subarray(Math.round(rate * 0.9)), (x) => crushTo(x, 8, dither));
  assert.ok(tailOf(0).every((x) => x === 0), 'a fade under half a step survived the ladder');
  assert.ok(tailOf(1).some((x) => x !== 0), 'dither left the fade to go to silence anyway');
});

test('the dither is in the audio thread, where it has to be random', () => {
  // Every other setting here is checked by holding the stringified core
  // against the module's sample for sample. This one cannot be: noise that
  // came out the same twice would not be noise. So the claim is the other
  // way round - two cores built from what the worklet actually runs must
  // agree exactly with it off and must disagree with it on - which is the
  // same seam and the only shape of test the thing being tested allows.
  const source = saturatorSource();
  const build = new Function(`${source.replace(/class HeadroomSaturator[\s\S]*$/, '')}\nreturn shaperCore;`)();

  const worst = (dither) => {
    const a = build(rate);
    const b = build(rate);
    const settings = { ...HEAT_DEFAULTS, mode: 'crush', bits: 6, dither };
    a.set(settings);
    b.set(settings);

    let off = 0;
    for (let i = 0; i < 20000; i += 1) {
      const x = Math.sin(i * 0.07) * 0.5 + Math.sin(i * 0.9) * 0.2;
      a.step(x);
      b.step(x);
      off = Math.max(off, Math.abs(a.out - b.out));
    }
    return off;
  };

  assert.equal(worst(0), 0, 'the audio thread is not repeatable with the dither off');
  // Measured: 6.4e-2, which is two steps of a six bit ladder - two draws of
  // one step apiece, drawn independently. The two cores in the worklet are
  // the two channels, so this is also the claim that a dithered stereo
  // signal gets two different noises rather than one in the middle.
  assert.ok(worst(1) > 1e-3, 'the dither knob reached the module and not the audio thread');
});

test('every family has a deck, and the three universal knobs are not in it', () => {
  // knobs are what the family adds; drive, tone and mix are always there and
  // naming them per family would be three chances to forget one.
  for (const id of CURVE_ORDER) {
    const curve = CURVES[id];
    assert.ok(curve, `${id} is offered but not defined`);
    assert.ok(curve.label, `${id} has no label`);
    for (const knob of curve.knobs) {
      assert.ok(knob in HEAT_LIMITS, `${id} wants a ${knob} knob with no limits`);
      assert.ok(!['drive', 'tone', 'mix'].includes(knob), `${id} names ${knob}, which every family has`);
      assert.ok(knob in HEAT_DEFAULTS, `${id} wants a ${knob} knob with no default`);
    }
  }
});

/** THD at whatever frequency we like, by moving the probe bin. */
function heatThdAt(settings, bin) {
  const step = (2 * Math.PI * bin) / PROBE_LENGTH;
  const amp = Math.pow(10, -12 / 20) * Math.SQRT2;
  const core = shaperCore(rate, false);
  core.set({ ...HEAT_DEFAULTS, ...settings, listen: 'out' });
  for (let i = 0; i < 24000; i += 1) core.step(amp * Math.sin(step * i));
  const re = new Float64Array(PROBE_LENGTH);
  const im = new Float64Array(PROBE_LENGTH);
  for (let i = 0; i < PROBE_LENGTH; i += 1) {
    core.step(amp * Math.sin(step * (i + 24000)));
    re[i] = core.out;
  }
  fft(re, im);
  let total = 0;
  let first = 0;
  for (let i = 1; i < PROBE_LENGTH / 2; i += 1) {
    const power = re[i] * re[i] + im[i] * im[i];
    total += power;
    if (i === bin) first = power;
  }
  return 10 * Math.log10(Math.max(total - first, 1e-20) / Math.max(first, 1e-20));
}

test('tape breaks up at the top before the bottom, and only while there is room', () => {
  // The whole of why this family exists. Everything else here treats every
  // frequency alike; tape lifts the top going in and puts it back down coming
  // out, so the highs reach the curve loudest and bend first.
  //
  // And it narrows as the drive comes up, which is the part worth knowing:
  // once the curve is saturated a lift has nothing left to give. Measured
  // when this was written - 5.5 dB of spread at drive 0, 0.6 dB at drive 14.
  const thdAt = heatThdAt;

  const LOW = 50;    // 147 Hz, well under the emphasis corner
  const HIGH = 1200; // 3.5 kHz, well over it

  // the soft clipper it is built on cares about no frequency in particular
  const flatLow = thdAt({ mode: 'soft', drive: 0, bias: 0.3 }, LOW);
  const flatHigh = thdAt({ mode: 'soft', drive: 0, bias: 0.3 }, HIGH);
  assert.ok(Math.abs(flatLow - flatHigh) < 0.5,
    `the soft curve should be frequency-blind: ${flatLow.toFixed(1)} against ${flatHigh.toFixed(1)}`);

  const quiet = { mode: 'tape', drive: 0, bias: 0.3, speed: 0 };
  const spread = thdAt(quiet, HIGH) - thdAt(quiet, LOW);
  assert.ok(spread > 3, `tape should break up at the top first, by ${spread.toFixed(1)} dB`);

  const loud = { ...quiet, drive: 14 };
  const narrowed = thdAt(loud, HIGH) - thdAt(loud, LOW);
  assert.ok(narrowed < spread - 2,
    `the spread should close as the curve saturates: ${spread.toFixed(1)} then ${narrowed.toFixed(1)}`);
});

test('a tube remembers what was playing before, and a knob says how much', () => {
  // The one family the steady-tone probe cannot see at all: a steady tone has
  // a steady envelope, so it measures the settled curve and reports no bloom
  // whatever. It is measured on a burst instead - the same quiet passage,
  // once cold and once straight after a loud one.
  const N = 2048;
  const BIN = 20;
  const step = (2 * Math.PI * BIN) / N;

  const colourOf = (settings, levels, want) => {
    const core = shaperCore(rate, false);
    core.set({ ...HEAT_DEFAULTS, ...settings, listen: 'out' });
    let n = 0;
    let out = 0;
    for (let w = 0; w < levels.length; w += 1) {
      const re = new Float64Array(N);
      const im = new Float64Array(N);
      for (let i = 0; i < N; i += 1) {
        core.step(levels[w] * Math.sin(step * n));
        re[i] = core.out;
        n += 1;
      }
      if (w !== want) continue;
      fft(re, im);
      let evens = 0;
      let odds = 0;
      for (let m = 2; m <= 10; m += 1) {
        const bin = BIN * m;
        const power = bin < N / 2 ? re[bin] * re[bin] + im[bin] * im[bin] : 0;
        if (m % 2 === 0) evens += power; else odds += power;
      }
      out = 10 * Math.log10(Math.max(evens, 1e-30) / Math.max(odds, 1e-30));
    }
    return out;
  };

  const LOUD = Math.pow(10, -4 / 20) * Math.SQRT2;
  const SOFT = Math.pow(10, -22 / 20) * Math.SQRT2;
  /** How much the colour of a quiet window moves for having had a loud one before it. */
  const memory = (bloom) => {
    const settings = { mode: 'tube', bias: 0.15, bloom, drive: 10 };
    const cold = colourOf(settings, [SOFT, SOFT, SOFT, SOFT], 1);
    const after = colourOf(settings, [LOUD, LOUD, LOUD, SOFT, SOFT], 4);
    return after - cold;
  };

  const none = memory(0);
  const some = memory(0.6);
  const lots = memory(1);

  assert.ok(Math.abs(none) < 0.5, `a fixed point should have no memory: ${none.toFixed(1)} dB`);
  assert.ok(lots > 12, `the bloom should be audible: ${lots.toFixed(1)} dB`);

  // and the knob may not turn back on itself, which the first version did:
  // the even lead peaks around an operating point of 0.35 and falls past it,
  // so a bloom allowed the whole range got weaker as it was turned up.
  assert.ok(lots > some && some > none,
    `more bloom should be more memory: ${[none, some, lots].map((v) => v.toFixed(1)).join(' ')}`);
});

test('a transformer breaks up at the bottom, which is tape upside down', () => {
  // Flux is the integral of the voltage, so for a signal of a given size it
  // goes as one over the frequency and the core runs out of room at the
  // bottom first. Nothing in the arithmetic names a frequency; this falls out
  // of the integrator, and if it ever stops falling out something has turned
  // the integrator into a filter.
  //
  // Measured at drive 0 when this was written: -17.0 dB of harmonics at
  // 147 Hz against -71.0 at 3.5 kHz.
  const low = heatThdAt({ mode: 'iron', drive: 0, core: 0.3 }, 50);
  const high = heatThdAt({ mode: 'iron', drive: 0, core: 0.3 }, 1200);
  assert.ok(low - high > 30, `the bottom should break up first, by ${(low - high).toFixed(1)} dB`);

  // and it is the mirror of tape, which is the pair that makes the question
  // "which end is distorting" worth asking
  const tapeLow = heatThdAt({ mode: 'tape', drive: 0, bias: 0.3, speed: 0 }, 50);
  const tapeHigh = heatThdAt({ mode: 'tape', drive: 0, bias: 0.3, speed: 0 }, 1200);
  assert.ok(tapeHigh > tapeLow, 'tape leans on the top');
  assert.ok(low > high, 'iron leans on the bottom');

  // a smaller core has less room, so it bends sooner
  const roomy = heatThdAt({ mode: 'iron', drive: 0, core: 1 }, 50);
  assert.ok(low > roomy + 6, `a small core should bend sooner: ${low.toFixed(1)} against ${roomy.toFixed(1)}`);
});

test('a slower tape lifts more, loses more, and bumps lower', () => {
  // Not a real machine's numbers, but they have to move in the directions the
  // physics moves in or the three speeds are just three sounds.
  for (let i = 1; i < TAPE_SPEEDS.length; i += 1) {
    const slower = TAPE_SPEEDS[i - 1];
    const faster = TAPE_SPEEDS[i];
    assert.ok(slower.emphasis > faster.emphasis, `${slower.label} should lift more than ${faster.label}`);
    assert.ok(slower.corner < faster.corner, `${slower.label} should lift from lower down`);
    assert.ok(slower.loss < faster.loss, `${slower.label} should lose more at the top`);
    assert.ok(slower.bumpHz < faster.bumpHz, `${slower.label} should bump lower down`);
  }
});

test('a biased curve leaves no offset under the sound', () => {
  // Subtracting shape(bias) takes away what the curve does to silence, which
  // is not what it does to a signal: the average of a bent curve over a cycle
  // is not the curve of the average, so an offset is left behind and it grows
  // with the drive. Measured before this was fixed, a sine at bias 1 and 30 dB
  // came out riding -9.6 dB of its own peak, which is a third of the waveform.
  const sine = tone([440], 2, 0.25);

  // Read after half a second. The filter's own time constant is 32 ms and a
  // first-order decay needs about fifteen of them to be this far down, so
  // anything measured sooner is the filter settling rather than the offset
  // staying - which was the first version of this test, and it failed on the
  // transient while the steady state was already at numerical zero.
  const SETTLED = Math.round(rate * 0.5);

  for (const bias of [0.3, 0.6, 1]) {
    for (const drive of [6, 18, 30]) {
      const out = runShaper(sine, rate, { ...HEAT_DEFAULTS, bias, drive });
      let sum = 0;
      let peak = 0;
      for (let i = SETTLED; i < out.length; i += 1) {
        sum += out[i];
        peak = Math.max(peak, Math.abs(out[i]));
      }
      const offset = Math.abs(sum / (out.length - SETTLED));
      const under = 20 * Math.log10(offset / Math.max(peak, 1e-12));
      assert.ok(under < -120, `bias ${bias} at ${drive} dB sits ${under.toFixed(1)} dB under its peak`);
    }
  }
});

test('taking the offset away moves nothing that is marked', () => {
  // The offset is at nothing per second and every reading here is taken at
  // 440 or above, so removing it may not shift a single number the exercises
  // score on. These are the readings from before the filter went in.
  const before = [
    [{ bias: 0, drive: 12 }, -17.9007, -277.4680, -17.9008,
      [-277.4680, -18.0727, -277.4680, -32.2267, -277.4680, -45.3600, -277.4680, -58.0263, -277.4680]],
    [{ bias: 0.45, drive: 14, hardness: 3 }, -14.0482, -17.4706, -16.6823,
      [-17.9731, -16.7945, -27.2566, -32.6853, -41.4370, -51.0099, -61.6518, -63.8016, -55.7896]],
    [{ bias: 1, drive: 30 }, -8.0499, -18.9328, -8.6311,
      [-24.3058, -10.2055, -25.0446, -15.6669, -25.9903, -19.8983, -27.0904, -23.6483, -28.3161]],
    [{ bias: 0.6, drive: 18, tone: 4000 }, -12.1432, -16.9936, -13.8651,
      [-18.4128, -14.1924, -23.5050, -25.4920, -30.1609, -38.1338, -38.7722, -54.4584, -49.2035]],
  ];

  // Not "close enough": the probe is bypassed, so these are the same numbers
  // to the last place the table was written to.
  const same = (was, now, what) => assert.ok(
    Math.abs(now - was) < 1e-4, `${what} moved to ${now.toFixed(4)} from ${was.toFixed(4)}`,
  );

  for (const [settings, thd, even, odd, harmonics] of before) {
    const now = harmonicsOf(rate, { ...HEAT_DEFAULTS, ...settings });
    const where = JSON.stringify(settings);
    same(thd, now.thd, `${where}: thd`);
    same(even, now.even, `${where}: even`);
    same(odd, now.odd, `${where}: odd`);
    HARMONICS.forEach((m, i) => same(harmonics[i], now.harmonics[m], `${where}: harmonic ${m}`));
  }
});

test('the probe may leave the offset filter out, because settled it does nothing', () => {
  // The justification for the bypass in spectrumOf, measured rather than
  // asserted. Prime one probe for five seconds so the filter is long settled,
  // run the other without it, and compare every bin - not just the harmonic
  // ones, because the aliasing reading lives in the quiet bins between them
  // and that is exactly what the unsettled filter was drowning.
  const probe = (settings, prime, blockDc) => {
    const step = (2 * Math.PI * PROBE_BIN) / PROBE_LENGTH;
    const amp = Math.pow(10, PROBE_LEVEL / 20) * Math.SQRT2;
    const core = shaperCore(rate, blockDc);
    core.set({ ...settings, listen: 'out' });
    for (let i = 0; i < prime; i += 1) core.step(amp * Math.sin(step * i));
    const re = new Float64Array(PROBE_LENGTH);
    const im = new Float64Array(PROBE_LENGTH);
    for (let i = 0; i < PROBE_LENGTH; i += 1) {
      core.step(amp * Math.sin(step * (i + prime)));
      re[i] = core.out;
    }
    fft(re, im);
    const power = new Float64Array(PROBE_LENGTH / 2);
    for (let i = 0; i < power.length; i += 1) power[i] = re[i] * re[i] + im[i] * im[i];
    return power;
  };

  for (const settings of [{ bias: 0.45, drive: 14, hardness: 3 }, { bias: 1, drive: 30 }]) {
    const full = { ...HEAT_DEFAULTS, ...settings };
    const settled = probe(full, rate * 5, true);
    const without = probe(full, 4096, false);

    let worst = 0;
    for (let i = 1; i < settled.length; i += 1) {
      const a = 10 * Math.log10(Math.max(settled[i], 1e-30) / settled[PROBE_BIN]);
      const b = 10 * Math.log10(Math.max(without[i], 1e-30) / without[PROBE_BIN]);
      if (a < -150 && b < -150) continue;
      worst = Math.max(worst, Math.abs(a - b));
    }
    assert.ok(worst < 0.01, `${JSON.stringify(settings)}: bins differ by ${worst.toFixed(4)} dB`);
  }
});

test('the corner is far below anything the series reaches', () => {
  // A first-order high pass is |H| = f / sqrt(f^2 + fc^2). The probe tone is
  // 440 and the lowest harmonic read is 880, so the filter has to be nothing
  // at both - and the only thing a lower corner would buy is less phase
  // against the dry path in a parallel mix, which is under six degrees by 50.
  const at = (f) => 20 * Math.log10(f / Math.sqrt(f * f + DC_CORNER * DC_CORNER));
  assert.ok(Math.abs(at(440)) < 0.001, `${at(440).toFixed(4)} dB at the probe tone`);
  assert.ok(Math.abs(at(880)) < 0.001, `${at(880).toFixed(4)} dB at the second harmonic`);
  assert.ok((Math.atan(DC_CORNER / 50) * 180) / Math.PI < 6, 'too much phase at 50 Hz');
});

test('auto gain leaves a driven signal as loud as it was', () => {
  const material = new Float32Array(rate);
  const rng = mulberry32(0x5a7);
  for (let i = 0; i < material.length; i += 1) {
    material[i] = (rng() * 2 - 1) * 0.3 * (1 + Math.sin((2 * Math.PI * 3 * i) / rate));
  }

  // Bias 1 is in here because the auto gain is an RMS and an RMS counts an
  // offset as signal: with the offset still in it the trim came back 1.16 dB
  // light at the far corner, which is wider than the tightest window anything
  // in this app is marked to.
  for (const bias of [0.5, 1]) {
    for (const drive of [6, 18, 30]) {
      const settings = { ...HEAT_DEFAULTS, drive, bias };
      const trim = heatTrim(material, rate, settings);
      const out = runShaper(material, rate, { ...settings, trim });
      const off = 20 * Math.log10(rms(out, HEAT_LATENCY) / rms(material, 0, material.length - HEAT_LATENCY));
      assert.ok(Math.abs(off) < 0.35, `bias ${bias} at ${drive} dB came out ${off.toFixed(2)} dB off`);
    }
  }
});

test('the audio thread runs the same arithmetic as the marking', () => {
  const source = saturatorSource();
  const build = new Function(`${source.replace(/class HeadroomSaturator[\s\S]*$/, '')}\nreturn shaperCore;`)();

  const theirs = build(rate);
  const mine = shaperCore(rate);
  const settings = { drive: 18, hardness: 3, bias: 0.6, tone: 3000, mix: 0.7, trim: -2 };
  theirs.set(settings);
  mine.set(settings);

  let worst = 0;
  for (let i = 0; i < 20000; i += 1) {
    const x = Math.sin(i * 0.07) * 0.5 + Math.sin(i * 0.9) * 0.2;
    theirs.step(x);
    mine.step(x);
    worst = Math.max(worst, Math.abs(theirs.out - mine.out));
  }
  assert.equal(worst, 0);
});

/* --- how far apart two saturators are -------------------------------------- */

test('the gap is the worst harmonic, and names it', () => {
  const theirs = harmonicsOf(rate, { ...HEAT_DEFAULTS, drive: 16, bias: 0.5 });
  assert.equal(seriesGap(theirs, theirs).off, 0);

  const mine = harmonicsOf(rate, { ...HEAT_DEFAULTS, drive: 16, bias: 0 });
  const gap = seriesGap(mine, theirs);
  // No bias against a biased target: the even harmonics are what is missing.
  assert.ok(gap.detail.harmonic % 2 === 0, `worst harmonic was the ${gap.where}`);
  assert.ok(gap.detail.louder < 0, 'and there should be too little of it');

  // And it says which one in words rather than handing back a number for the
  // caller to phrase. Three of the four comparators here had their own
  // convention for this; now none of them do.
  assert.equal(gap.where, `${gap.detail.harmonic}${gap.detail.harmonic === 2 ? 'nd' : 'th'} harmonic`);
  assert.equal(seriesGap(theirs, theirs).where, null, 'nothing stands out against itself');
});

/* --- the mode -------------------------------------------------------------- */

const round = (exercise, tier, seed = 0x5a7) => {
  const puzzle = saturation.makePuzzle(mulberry32(seed), tier, { exercise });
  puzzle.settings = { exercise };
  puzzle.rate = rate;
  return puzzle;
};

test('the target is always something you can hear', () => {
  for (const tier of Object.keys(saturation.tiers)) {
    for (let i = 0; i < 25; i += 1) {
      const puzzle = round('match', tier, 0x5a7 + i * 7919);
      const thd = harmonicsOf(rate, puzzle.answer).thd;
      assert.ok(thd > -22, `${tier} asked for a target ${thd.toFixed(1)} dB down`);
    }
  }
});

test('leaving the plugin alone is never the answer', () => {
  for (const exercise of ['amount', 'match', 'even']) {
    for (const tier of Object.keys(saturation.tiers)) {
      for (let i = 0; i < 12; i += 1) {
        const puzzle = round(exercise, tier, 0x5a7 + i * 7919);
        const result = saturation.score({ ...HEAT_DEFAULTS }, { ...puzzle, tier: tier });
        assert.equal(result.correct, false, `${exercise}/${tier} was won by doing nothing`);
      }
    }
  }
});

test('matching is marked on the harmonics, not on the knobs', () => {
  for (const tier of Object.keys(saturation.tiers)) {
    for (let i = 0; i < 12; i += 1) {
      const puzzle = round('match', tier, 0x5a7 + i * 7919);
      const exact = saturation.score(puzzle.answer, { ...puzzle, tier: tier });
      assert.equal(exact.correct, true, `${tier} rejected its own answer`);

      // The same series by another route is the same answer: turning the
      // trim, and monitoring the difference, change nothing about what the
      // curve makes.
      const elsewhere = { ...puzzle.answer, trim: -6, listen: 'diff' };
      assert.equal(saturation.score(elsewhere, { ...puzzle, tier: tier }).correct, true);
    }
  }
});

test('warmth without grit cannot be had by driving it harder', () => {
  for (const tier of Object.keys(saturation.tiers)) {
    for (let i = 0; i < 10; i += 1) {
      const puzzle = round('even', tier, 0x5a7 + i * 7919);

      // Slammed and lopsided: plenty of even harmonics, and a pile of odd
      // ones underneath them.
      const slammed = saturation.score(
        { ...HEAT_DEFAULTS, drive: 26, bias: 1, hardness: 4 }, { ...puzzle, tier: tier });
      assert.equal(slammed.correct, false, `${tier} accepted a slammed guess`);

      // And there is a way through: gently, with the bias doing the work.
      const found = [2, 4, 6, 8, 10, 12, 14].flatMap((drive) =>
        [0.4, 0.6, 0.85, 1].map((bias) => ({ ...HEAT_DEFAULTS, drive, bias, hardness: 2, tone: 2000, mix: 0.6 })))
        .some((guess) => saturation.score(guess, { ...puzzle, tier: tier }).correct);
      assert.ok(found, `${tier} asked for ${puzzle.want} dB of even harmonics and nothing reaches it`);
    }
  }
});

/* --- the ways a recording gets spoiled ------------------------------------ */

const RATE = 48000;

/** A second of something with a shape to it, for the artefacts to spoil. */
const material = () => {
  const out = new Float32Array(RATE);
  for (let i = 0; i < RATE; i += 1) {
    const env = 0.3 + 0.7 * Math.abs(Math.sin((2 * Math.PI * 2 * i) / RATE));
    out[i] = Math.sin((2 * Math.PI * 220 * i) / RATE) * 0.6 * env;
  }
  return out;
};

test('every artefact is in the table, and every one of them changes something', () => {
  assert.equal(DAMAGE.length, 7);
  assert.equal(new Set(DAMAGE_IDS).size, 7);

  const clean = material();
  for (const one of DAMAGE) {
    assert.ok(one.symbol && one.symbol.length <= 14, `${one.id} has no readable symbol`);
    assert.ok(one.name && one.name.length > 8, `${one.id} does not say what it is`);

    // A click's default is a second and a fifth in, which is inside the
    // loops this is used on and outside the one second here - so it is told
    // where to go. That a click asked for past the end of the material does
    // nothing at all is held two tests down.
    const spoiled = one.apply(clean, RATE, one.id === 'click' ? { at: 0.5 } : {});
    assert.equal(spoiled.length, clean.length, `${one.id} changed the length`);

    let worst = 0;
    for (let i = 0; i < clean.length; i += 1) worst = Math.max(worst, Math.abs(spoiled[i] - clean[i]));
    assert.ok(worst > 1e-4, `${one.id} did nothing at all`);

    // And it did not write over what it was handed, which would make the
    // clean side of the A/B the spoiled one.
    assert.notEqual(spoiled, clean);
  }

  assert.equal(damageOf('hum').id, 'hum');
  assert.equal(damageOf('nonsense').id, DAMAGE[0].id);
  assert.equal(damageChoices(['hum', 'click']).length, 2);
});

test('quantising is a ladder of 2 to the one minus b, and the formula comes out', () => {
  const sine = new Float32Array(RATE);
  for (let i = 0; i < RATE; i += 1) sine[i] = Math.sin((2 * Math.PI * 997 * i) / RATE);

  for (const bits of [8, 12, 16]) {
    const crushed = crushBits(sine, { bits });
    const step = 1 / 2 ** (bits - 1);

    // Every sample is on the ladder.
    for (let i = 0; i < 2000; i += 1) {
      const rungs = crushed[i] / step;
      assert.ok(Math.abs(rungs - Math.round(rungs)) < 1e-6, `${bits} bits came off the ladder`);
    }

    // And the noise is where the arithmetic says it is: 6.02b + 1.76.
    const snr = snrOf(sine, crushed);
    assert.ok(Math.abs(snr - (6.02 * bits + 1.76)) < 0.5,
      `${bits} bits read ${snr.toFixed(1)} dB`);
    assert.ok(Math.abs(bitsFrom(snr) - bits) < 0.1, `${bits} bits read back as ${bitsFrom(snr).toFixed(2)}`);
  }
});

test('dither costs what triangular dither costs, and buys a floor that does not follow', () => {
  const sine = new Float32Array(RATE);
  for (let i = 0; i < RATE; i += 1) sine[i] = Math.sin((2 * Math.PI * 997 * i) / RATE);

  const plain = snrOf(sine, crushBits(sine, { bits: 10 }));
  const dithered = snrOf(sine, crushBits(sine, { bits: 10, dither: true }));

  // Two rectangular draws added is triangular, and triangular costs 4.77 dB.
  const cost = plain - dithered;
  assert.ok(cost > 3.5 && cost < 6, `dither cost ${cost.toFixed(2)} dB`);

  // A quiet signal is the case dither is for: under half a step, quantising
  // without it produces nothing at all, and with it produces noise that has
  // the signal in it.
  const tiny = Float32Array.from(sine, (x) => x * 2 ** -12);
  const bare = crushBits(tiny, { bits: 8 });
  assert.ok(bare.every((x) => x === 0), 'a signal under half a step survived quantising');

  const shaken = crushBits(tiny, { bits: 8, dither: true });
  assert.ok(shaken.some((x) => x !== 0), 'dither added nothing to a signal that had vanished');
});

test('hold keeps each sample for as long as it says, and a click is one sample', () => {
  const clean = material();

  for (const hold of [2, 4, 8]) {
    const held = holdFor(clean, { hold });
    for (let i = 0; i < 400; i += 1) {
      const kept = held[Math.floor(i / hold) * hold];
      assert.equal(held[i], kept, `held for ${hold} and sample ${i} is not the one it kept`);
    }
  }

  const clicked = addClick(clean, RATE, { at: 0.5, size: 1 });
  const where = Math.round(0.5 * RATE);
  assert.equal(Math.abs(clicked[where]), 1);
  for (const i of [where - 1, where + 1]) assert.equal(clicked[i], clean[i]);

  // Past the end it does nothing, and does it loudly rather than wrapping
  // round to somewhere nobody asked for: a round that put its click outside
  // the loop would be a round with no answer in it, and silently moving it
  // would hide that from whoever wrote the round.
  const missed = addClick(clean, RATE, { at: 99 });
  for (let i = 0; i < clean.length; i += 1) assert.equal(missed[i], clean[i]);
});

test('nothing in the library changes how loud it is', () => {
  const clean = material();
  const lufs = (samples) => integrated([kWeight(samples, RATE)], RATE).lufs;
  const was = lufs(clean);

  for (const one of DAMAGE) {
    // Hum and a click put something there that was not there, so they are
    // allowed to be a shade louder; the rest are matched on the way out.
    const allowed = ['hum', 'click'].includes(one.id) ? 1.5 : 0.5;
    const now = lufs(one.apply(clean, RATE, one.id === 'click' ? { at: 0.5 } : {}));
    assert.ok(Math.abs(now - was) <= allowed,
      `${one.id} moved the loudness by ${(now - was).toFixed(2)} dB`);
  }
});
