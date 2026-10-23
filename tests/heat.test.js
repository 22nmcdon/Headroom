import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HEAT_DEFAULTS, HEAT_LATENCY, HARMONICS, MOST_TONE,
  shape, shaperCore, runShaper, heatTrim, harmonicsOf, heatGap, transferCurve, foldback,
  DC_CORNER, PROBE_BIN, PROBE_LENGTH, PROBE_LEVEL,
} from '../src/heat/shape.js';
import { fft } from '../src/fx/fft.js';
import { saturatorSource } from '../src/heat/node.js';
import { mulberry32 } from '../src/random.js';
import { HEAT_WORK as saturation } from '../src/work/saturation.js';

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
  assert.equal(heatGap(theirs, theirs).off, 0);

  const mine = harmonicsOf(rate, { ...HEAT_DEFAULTS, drive: 16, bias: 0 });
  const gap = heatGap(mine, theirs);
  // No bias against a biased target: the even harmonics are what is missing.
  assert.ok(gap.detail.harmonic % 2 === 0, `worst harmonic was the ${gap.where}`);
  assert.ok(gap.detail.louder < 0, 'and there should be too little of it');

  // And it says which one in words rather than handing back a number for the
  // caller to phrase. Three of the four comparators here had their own
  // convention for this; now none of them do.
  assert.equal(gap.where, `${gap.detail.harmonic}${gap.detail.harmonic === 2 ? 'nd' : 'th'} harmonic`);
  assert.equal(heatGap(theirs, theirs).where, null, 'nothing stands out against itself');
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
