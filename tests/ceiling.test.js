// What a limiter promises, and what it costs to make it keep the promise.
//
// `tests/limit.test.js` holds the arithmetic: no sample over the ceiling, on
// anything. This holds the half that makes it a tool - the drive in front of
// it, the trim after it, and the two readings that say what the pass did.
//
// The one thing here that is a derivation rather than a measurement is
// `driveFor`, and it is checked against measurement on every signal below for
// exactly that reason.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CEIL_DEFAULTS, CEIL_DRIVE, CEIL_OUTPUT, CEIL_RANGE,
  runCeiling, ceilingCost, ceilingReading, ceilingHarmonics, driveFor, matchOut,
} from '../src/plugins/limiter/ceiling.js';
import { harmonicsReading } from '../src/plugins/saturation/shape.js';
import { HEAT_DEFAULTS } from '../src/plugins/saturation/shape.js';
import { HARMONICS } from '../src/lib/harmonics.js';
import { reductionReading } from '../src/plugins/compressor/reading.js';
import { COMP_DEFAULTS } from '../src/plugins/compressor/dsp.js';
import { comparable } from '../src/lib/read.js';
import { distance } from '../src/gap.js';
import { truePeakOf, samplePeakOf } from '../src/lib/loudness.js';
import { mulberry32 } from '../src/lib/random.js';
import { CEIL_WORK } from '../src/learn/work/limiter.js';

const RATE = 44100;

/**
 * Material that ends in silence, for the reason lib/limiter.js records: a
 * true peak read off a buffer that stops mid-waveform is measuring the
 * truncation and not the signal.
 */
function fade(channels, over = 512) {
  for (const samples of channels) {
    for (let i = 0; i < over && i < samples.length / 2; i += 1) {
      const w = i / over;
      samples[i] *= w;
      samples[samples.length - 1 - i] *= w;
    }
  }
  return channels;
}

/** A master-ish loop: a steady bed with hits over it, peaking under full scale. */
function bedWithHits(rate = RATE, seconds = 4) {
  const n = Math.round(rate * seconds);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  const rng = mulberry32(0xce111);

  for (let i = 0; i < n; i += 1) {
    const at = i / rate;
    const bed = Math.sin(2 * Math.PI * 55 * at) * 0.10
      + Math.sin(2 * Math.PI * 220 * at) * 0.06
      + Math.sin(2 * Math.PI * 1100 * at) * 0.03;
    left[i] = bed;
    right[i] = bed * 0.96;
  }
  for (let k = 0; k < 16; k += 1) {
    const at = Math.round(k * 0.25 * rate);
    for (let i = 0; i < Math.round(rate * 0.05) && at + i < n; i += 1) {
      const hit = Math.exp(-(i / rate) * 140) * (rng() * 2 - 1) * 0.3;
      left[at + i] += hit;
      right[at + i] += hit * 0.9;
    }
  }

  fade([left, right]);
  return { left, right, rate };
}

/** A steady tone, which has almost no peak-to-loudness ratio to give away. */
function steady(rate = RATE, seconds = 2) {
  const n = Math.round(rate * seconds);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    left[i] = Math.sin((2 * Math.PI * 220 * i) / rate) * 0.5;
    right[i] = left[i];
  }
  fade([left, right]);
  return { left, right, rate };
}

/** Noise, which is where the two peak detectors part company worst. */
function noisy(rate = RATE, seconds = 2) {
  const n = Math.round(rate * seconds);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  const rng = mulberry32(31337);
  for (let i = 0; i < n; i += 1) {
    left[i] = (rng() * 2 - 1) * 0.4;
    right[i] = (rng() * 2 - 1) * 0.4;
  }
  fade([left, right]);
  return { left, right, rate };
}

const MATERIALS = { 'a bed with hits': bedWithHits, 'a steady tone': steady, noise: noisy };

const deepestOf = (gr) => {
  let deepest = 0;
  for (let i = 0; i < gr.length; i += 1) if (gr[i] < deepest) deepest = gr[i];
  return deepest;
};

const peakOf = (pass) => Math.max(truePeakOf(pass.left), truePeakOf(pass.right));

/* --- the promise ---------------------------------------------------------- */

test('the ceiling holds at every drive and every ceiling the knobs reach', () => {
  for (const [name, make] of Object.entries(MATERIALS)) {
    const material = make();
    for (const ceiling of [CEIL_RANGE[0], -1, CEIL_RANGE[1]]) {
      for (const drive of [0, 6, 12, 24]) {
        const pass = runCeiling(
          material.left, material.right, { ...CEIL_DEFAULTS, ceiling, drive }, RATE,
        );
        // Faded again: the pass is a new buffer and its ends are a cut.
        fade([pass.left, pass.right]);
        const over = peakOf(pass) - ceiling;
        assert.ok(over < 0.01,
          `${name} at drive ${drive} came out ${over.toFixed(3)} dB over a ${ceiling} dB ceiling`);
      }
    }
  }
});

test('the sample detector is not a ceiling for an encoder, and the true one is', () => {
  const material = bedWithHits();
  const settings = { ...CEIL_DEFAULTS, drive: 12 };

  const cheap = runCeiling(material.left, material.right, { ...settings, peak: 'sample' }, RATE);
  const proper = runCeiling(material.left, material.right, { ...settings, peak: 'true' }, RATE);
  fade([cheap.left, cheap.right, proper.left, proper.right]);

  // The samples are held either way - that is what the cheap detector is for.
  assert.ok(Math.max(samplePeakOf(cheap.left), samplePeakOf(cheap.right)) <= -1 + 1e-6);
  // Measured: 0.92 dB over full scale on this material, where the ceiling was
  // asked for -1. Which is what an encoder would have been handed.
  assert.ok(peakOf(cheap) > 0.5,
    `the sample detector should have let the waveform past, got ${peakOf(cheap).toFixed(2)}`);
  assert.ok(peakOf(proper) < -0.99);
});

/* --- the drive ------------------------------------------------------------ */

test('deeper drive never means less reduction', () => {
  for (const [name, make] of Object.entries(MATERIALS)) {
    const material = make();
    let last = 0;
    for (let drive = CEIL_DRIVE[0]; drive <= CEIL_DRIVE[1]; drive += 2) {
      const pass = runCeiling(material.left, material.right, { ...CEIL_DEFAULTS, drive }, RATE);
      const deepest = deepestOf(pass.gr);
      assert.ok(deepest <= last + 1e-6,
        `${name}: ${drive} dB of drive reduced less than ${drive - 2} did`);
      last = deepest;
    }
  }
});

test('the drive for a wanted reduction is the one that produces it', () => {
  // The closed form in `driveFor` is the only derivation in this folder, so
  // it is held against the reduction the limiter actually reaches. Measured,
  // it lands within 2.4e-7 dB, which is float arithmetic and not a model.
  for (const [name, make] of Object.entries(MATERIALS)) {
    const material = make();
    for (const peak of ['true', 'sample']) {
      for (const want of [1, 2, 3, 6, 10]) {
        const settings = { ...CEIL_DEFAULTS, peak };
        const drive = driveFor(material, RATE, settings, want);
        const pass = runCeiling(material.left, material.right, { ...settings, drive }, RATE);
        const got = -deepestOf(pass.gr);
        assert.ok(Math.abs(got - want) < 0.01,
          `${name} (${peak} peak): asked for ${want} dB, got ${got.toFixed(4)}`);
      }
    }
  }
});

test('no drive is asked for when no reduction is wanted', () => {
  const material = bedWithHits();
  assert.equal(driveFor(material, RATE, CEIL_DEFAULTS, 0), 0);
  assert.equal(driveFor(material, RATE, CEIL_DEFAULTS, -3), 0);
});

/* --- the trim after it ---------------------------------------------------- */

test('the output trim is after the ceiling, so it scales what came out', () => {
  const material = bedWithHits();
  const settings = { ...CEIL_DEFAULTS, drive: 12 };
  const open = runCeiling(material.left, material.right, settings, RATE);
  const down = runCeiling(material.left, material.right, { ...settings, output: -6 }, RATE);

  const g = 10 ** (-6 / 20);
  for (let i = 0; i < open.left.length; i += 997) {
    assert.ok(Math.abs(down.left[i] - open.left[i] * g) < 1e-6,
      `the trim should be a plain gain on the output, and is not at sample ${i}`);
  }

  // And the reduction trace is untouched by it: the trim is not the limiter's
  // business, which is the whole reason it goes after.
  for (let i = 0; i < open.gr.length; i += 97) assert.equal(down.gr[i], open.gr[i]);
});

test('the trim cannot be used to break the ceiling', () => {
  const material = bedWithHits();
  const pass = runCeiling(
    material.left, material.right, { ...CEIL_DEFAULTS, drive: 12, output: 12 }, RATE,
  );
  fade([pass.left, pass.right]);
  // Asked for twelve decibels up, held to the top of the range, which is zero.
  assert.equal(CEIL_OUTPUT[1], 0);
  assert.ok(peakOf(pass) < -0.99,
    `a positive trim got past the clamp: ${peakOf(pass).toFixed(3)} dBTP`);
});

test('a matched output leaves the two sides the same loudness', () => {
  for (const [name, make] of Object.entries(MATERIALS)) {
    const material = make();
    for (const drive of [0, 3, 6, 12, 18]) {
      const settings = { ...CEIL_DEFAULTS, drive };
      const output = matchOut(material, RATE, settings);
      const pass = runCeiling(material.left, material.right, { ...settings, output }, RATE);
      const { match } = ceilingCost(material, pass, RATE);
      assert.ok(Math.abs(match) < 0.05,
        `${name} at drive ${drive}: ${match.toFixed(3)} LU apart after matching`);
    }
  }
});

/* --- what the pass cost --------------------------------------------------- */

test('under the knee the drive is a volume knob and nothing else', () => {
  // The first lesson of the tool, as a measurement. The probe peaks 5.76 dB
  // under the default ceiling, so four decibels of drive cannot reach it: the
  // loudness moves by exactly the drive and the peak-to-loudness ratio does
  // not move at all.
  const material = bedWithHits();
  const dry = ceilingCost(
    material, runCeiling(material.left, material.right, CEIL_DEFAULTS, RATE), RATE,
  ).before;

  for (const drive of [1, 2, 4]) {
    const pass = runCeiling(material.left, material.right, { ...CEIL_DEFAULTS, drive }, RATE);
    const { after } = ceilingCost(material, pass, RATE);
    assert.ok(Math.abs(after.lufs - (dry.lufs + drive)) < 0.01,
      `${drive} dB of drive moved the loudness by ${(after.lufs - dry.lufs).toFixed(3)}`);
    assert.ok(Math.abs(after.plr - dry.plr) < 0.01,
      `and moved the PLR by ${(after.plr - dry.plr).toFixed(3)}, which it should not have`);
    assert.equal(deepestOf(pass.gr), 0);
  }
});

test('past the knee loudness is bought and peak-to-loudness ratio is spent', () => {
  const material = bedWithHits();
  let lastLufs = -Infinity;
  let lastPlr = Infinity;

  for (const drive of [6, 9, 12, 15]) {
    const pass = runCeiling(material.left, material.right, { ...CEIL_DEFAULTS, drive }, RATE);
    const { after } = ceilingCost(material, pass, RATE);
    assert.ok(after.lufs > lastLufs, `the loudness stopped rising at ${drive} dB of drive`);
    assert.ok(after.plr < lastPlr, `the PLR stopped falling at ${drive} dB of drive`);
    lastLufs = after.lufs;
    lastPlr = after.plr;
  }

  // And it runs out. Measured on this material: -8.21 LUFS at fifteen
  // decibels of drive, -8.12 at eighteen, -8.12 at twenty-four. The last six
  // decibels buy nothing and cost six more decibels of reduction.
  const wall = [18, 24].map((drive) => ceilingCost(
    material, runCeiling(material.left, material.right, { ...CEIL_DEFAULTS, drive }, RATE), RATE,
  ).after.lufs);
  assert.ok(Math.abs(wall[1] - wall[0]) < 0.05,
    `six more decibels of drive moved the loudness by ${(wall[1] - wall[0]).toFixed(3)}`);
});

/* --- the reading ---------------------------------------------------------- */

test('a limiter reading and a compressor reading of the same loop compare', () => {
  // Deliberate, and the point of reusing the kind and the axis: "how much is
  // this reducing" is one question however the thing answering it is built.
  const material = bedWithHits();
  const channels = [material.left, material.right];

  const theirs = reductionReading(channels, RATE, { ...COMP_DEFAULTS, threshold: -24, ratio: 8 });
  const mine = ceilingReading(material, RATE, { ...CEIL_DEFAULTS, drive: 12 }).reading;

  assert.equal(comparable(mine, theirs), null,
    `they should be comparable and are not: ${comparable(mine, theirs)}`);
  assert.ok(Number.isFinite(distance(mine, theirs).off));
});

test('a reading over one loop refuses to be compared with one over another', () => {
  const settings = { ...CEIL_DEFAULTS, drive: 12 };
  const mine = ceilingReading(bedWithHits(), RATE, settings).reading;
  const theirs = ceilingReading(steady(), RATE, settings).reading;
  assert.ok(comparable(mine, theirs), 'two different loops must not compare');
});

test('the reading says what the trace says', () => {
  const material = bedWithHits();
  const settings = { ...CEIL_DEFAULTS, drive: 12 };
  const { reading, trace } = ceilingReading(material, RATE, settings);

  assert.equal(reading.values.deepest, deepestOf(trace));
  let total = 0;
  for (let i = 0; i < trace.length; i += 1) total += trace[i];
  assert.ok(Math.abs(reading.values.average - total / trace.length) < 1e-6);
  // Framed at five milliseconds, which is what makes it comparable with the
  // compressor's: a per-sample trace is the same measurement at a resolution
  // nothing compares at.
  assert.equal(reading.values.gr.length, Math.ceil(trace.length / Math.round(0.005 * RATE)));
});

/* --- the exercises' own numbers -------------------------------------------- */

test('every rung of the drill ladder gives away more than the one below it', () => {
  // The table in `work/limiter.js`, held. The level is matched at every rung,
  // so what separates them is not loudness - it is how much peak-to-loudness
  // ratio has been spent, and a rung that spent the same as the one under it
  // would be a coin toss dressed as an ear test. Which is why the ladder stops
  // at twelve: eighteen decibels of reduction gives away exactly as much as
  // twelve does, because by then the output is a wall at the ceiling.
  const material = bedWithHits();
  const dry = ceilingCost(
    material, runCeiling(material.left, material.right, CEIL_DEFAULTS, RATE), RATE,
  ).before;

  let spent = 0;
  for (const want of [0.75, 1.5, 3, 6, 12]) {
    const drive = driveFor(material, RATE, CEIL_DEFAULTS, want);
    const base = { ...CEIL_DEFAULTS, drive };
    const output = matchOut(material, RATE, base);
    const pass = runCeiling(material.left, material.right, { ...base, output }, RATE);
    const cost = ceilingCost(material, pass, RATE);

    assert.ok(Math.abs(cost.match) < 0.05, `${want} dB is not level-matched`);
    const gave = dry.plr - cost.after.plr;
    assert.ok(gave > spent + 0.3,
      `${want} dB gave away ${gave.toFixed(2)} LU against ${spent.toFixed(2)} at the rung below`);
    spent = gave;
  }
});

test('leaving the limiter alone fails every tier of the matching exercise', () => {
  // The reason the targets start at six decibels and not at three. Measured at
  // a three-decibel target, doing nothing read 0.691 - inside any tolerance
  // that would forgive a decibel of drive. No choice of tolerance fixes that;
  // asking for more reduction does.
  const material = bedWithHits();
  const nothing = { ...CEIL_DEFAULTS };

  for (const tier of ['easy', 'medium', 'hard']) {
    for (let i = 0; i < 6; i += 1) {
      const puzzle = CEIL_WORK.makePuzzle(mulberry32(i + 1), tier, { exercise: 'match' });
      puzzle.tier = tier;
      puzzle.settings = { exercise: 'match' };
      puzzle.material = material;

      const score = CEIL_WORK.score(nothing, puzzle);
      assert.ok(!score.correct,
        `${tier} accepted an untouched limiter against its own target (off ${score.error})`);
    }
  }
});

test('a target is settled against the loop it is actually heard on', () => {
  // The drive that asks the probe for six decibels of reduction would ask a
  // quieter loop for none at all, and a round whose answer is to leave the
  // limiter alone is not a round. So the drive is measured again once the
  // material is pinned - and the proof is that a loop six decibels quieter
  // gets six decibels more drive.
  const loud = bedWithHits();
  const quiet = {
    left: Float32Array.from(loud.left, (v) => v * 0.5),
    right: Float32Array.from(loud.right, (v) => v * 0.5),
    rate: RATE,
  };

  const asked = [];
  for (const material of [loud, quiet]) {
    const puzzle = CEIL_WORK.makePuzzle(mulberry32(7), 'hard', { exercise: 'match' });
    puzzle.tier = 'hard';
    puzzle.settings = { exercise: 'match' };
    puzzle.material = material;

    // Through the exercise's own door, which is what the bench calls.
    const target = CEIL_WORK.exercises.match.targetOf(puzzle);
    asked.push(target.drive);

    const got = -ceilingReading(material, RATE, target).reading.values.deepest;
    assert.ok(Math.abs(got - target.asked) < 0.01,
      `asked for ${target.asked} dB and the target reaches ${got.toFixed(3)}`);
  }

  assert.ok(Math.abs((asked[1] - asked[0]) - 6) < 0.05,
    `half the level should want six more decibels of drive, wanted ${(asked[1] - asked[0]).toFixed(3)}`);
});

/* --- the other way of holding it ------------------------------------------ */

test('a limiter is transparent to a steady tone and a clipper cannot be', () => {
  // The reading that separates the two modes, and it separates them
  // completely. A limiter's gain settles on a steady tone and what comes out
  // is the same wave, quieter; a clipper is cutting the shape of the wave, and
  // the shape is the series.
  const material = bedWithHits();
  const hard = { ...CEIL_DEFAULTS, drive: 12 };

  const limited = ceilingHarmonics(material, RATE, { ...hard, mode: 'limit' }).values;
  const clipped = ceilingHarmonics(material, RATE, { ...hard, mode: 'clip' }).values;

  // Measured: -121.9 dB, which is the arithmetic's own noise floor and not a
  // harmonic series. A display of that would be a display of nothing, drawn
  // convincingly, which is why the face shows it only when something is
  // cutting the waveform.
  assert.ok(limited.thd < -100, `the limiter added ${limited.thd.toFixed(1)} dB`);
  assert.ok(clipped.thd > -30, `the clipper should be obvious, read ${clipped.thd.toFixed(1)}`);
  assert.ok(clipped.harmonics[3] > -25, 'with a third harmonic to show for it');
  assert.ok(clipped.harmonics[2] < -100, 'and no even ones, because the cut is symmetric');
});

test('at no drive the tool is not distorting anything and says so', () => {
  const material = bedWithHits();
  for (const mode of ['limit', 'clip', 'both']) {
    const quiet = ceilingHarmonics(material, RATE, { ...CEIL_DEFAULTS, mode }).values;
    assert.ok(quiet.thd < -100, `${mode} at no drive read ${quiet.thd.toFixed(1)} dB`);
  }
});

test('the harmonic reading compares with the saturator\'s', () => {
  // The point of moving the probe into lib. Both are `kind: 'harmonics'` on
  // the same axis, so "is this clipper adding more than that saturator" is a
  // question with an answer.
  const material = bedWithHits();
  const mine = ceilingHarmonics(material, RATE, { ...CEIL_DEFAULTS, mode: 'clip', drive: 12 });
  const theirs = harmonicsReading(RATE, { ...HEAT_DEFAULTS, drive: 12 });

  assert.equal(comparable(mine, theirs), null,
    `they should compare and do not: ${comparable(mine, theirs)}`);
  assert.ok(Number.isFinite(distance(mine, theirs).off));
});

test('the clipper gets louder than the limiter at the same drive', () => {
  // Which is the whole reason anybody reaches for one. The limiter is holding
  // the peak down with a gain, and the gain is on everything; the clipper only
  // takes the tips off.
  const material = bedWithHits();
  const read = (mode) => ceilingCost(
    material,
    runCeiling(material.left, material.right, { ...CEIL_DEFAULTS, mode, drive: 14 }, RATE),
    RATE,
  ).after;

  const limited = read('limit');
  const clipped = read('clip');
  assert.ok(clipped.lufs > limited.lufs + 1,
    `clipping came out ${(clipped.lufs - limited.lufs).toFixed(2)} LU louder, wanted more than 1`);

  // And it is over the ceiling for it, which is the price: a clipper is not a
  // ceiling, and `lib/limiter.js` measures by how much.
  assert.ok(clipped.peak > -1, `the clipper should overshoot, read ${clipped.peak.toFixed(2)}`);
  assert.ok(Math.abs(limited.peak + 1) < 0.01, 'where the limiter holds exactly');
});

test('the knee is measured from the ceiling, wherever the ceiling is', () => {
  // A knee is a distance below the ceiling, not an absolute level, so moving
  // the ceiling has to move the bend with it. Checked on what it does rather
  // than on where the output lands: a clipper's output does not land on its
  // ceiling at all - band-limiting the cut puts the overshoot back, by up to
  // three and a half decibels, which `lib/limiter.js` measures.
  const material = bedWithHits();

  // The same push relative to the ceiling in both cases, which is the only
  // way to ask the question: the probe is a -12 dBFS sine, so a drive of
  // ceiling + 14 puts it two decibels over whatever the ceiling is. Pushed by
  // an absolute amount instead, a signal five decibels past a six-decibel
  // knee has saturated the curve and reads as a hard cut again - which is how
  // the first version of this test asked the wrong thing.
  const seen = [-3, -1].map((ceiling) => {
    const at = (knee) => ceilingHarmonics(
      material, RATE,
      { ...CEIL_DEFAULTS, mode: 'clip', ceiling, knee, drive: ceiling + 14 },
    ).values;

    const hard = at(0);
    const soft = at(6);
    assert.ok(soft.harmonics[7] < hard.harmonics[7] - 3,
      `at a ${ceiling} dB ceiling the knee did not round the corner off: `
      + `${hard.harmonics[7].toFixed(1)} to ${soft.harmonics[7].toFixed(1)}`);
    return soft;
  });

  // And the two ceilings give the same series, which is what "measured from
  // the ceiling" means: a knee is a distance below it and not a level.
  //
  // Only the harmonics that are there. A symmetric cut makes no even ones at
  // all, so those bins hold the arithmetic's noise floor - measured, around
  // -277 dB - and two noise floors agreeing to a decibel is not a thing to
  // ask for.
  for (const m of HARMONICS) {
    if (seen[0].harmonics[m] < -80 && seen[1].harmonics[m] < -80) continue;
    assert.ok(Math.abs(seen[0].harmonics[m] - seen[1].harmonics[m]) < 1,
      `the ${m}th harmonic moved with the ceiling: `
      + `${seen[0].harmonics[m].toFixed(1)} against ${seen[1].harmonics[m].toFixed(1)}`);
  }
});

test('the three answers the drill offers are three different things', () => {
  // Held as a measurement rather than as a claim about ears. All three are
  // level-matched against the loop, so loudness is not the cue; what differs
  // is how far each has moved the signal and what it left behind.
  const material = bedWithHits();
  const seen = {};

  for (const held of ['none', 'limit', 'clip']) {
    const puzzle = { answer: { held }, tier: 'medium', settings: { exercise: 'held' }, material };
    const settings = CEIL_WORK.exercises.held.startOf(puzzle);
    const pass = runCeiling(material.left, material.right, settings, RATE);
    const cost = ceilingCost(material, pass, RATE);

    let deepest = 0;
    for (let i = 0; i < pass.gr.length; i += 1) if (pass.gr[i] < deepest) deepest = pass.gr[i];
    seen[held] = { deepest, match: cost.match, settings };

    assert.ok(Math.abs(cost.match) < 0.05,
      `${held} is not level-matched: ${cost.match.toFixed(3)} LU apart`);
  }

  // Nothing at all: no reduction, and the drive stopped short of the knee.
  assert.equal(seen.none.deepest, 0);
  // A limiter: a gain that moved.
  assert.ok(seen.limit.deepest < -1,
    `the limiter should be working, read ${seen.limit.deepest.toFixed(2)} dB`);
  // A clipper: no gain at all, ever.
  assert.equal(seen.clip.deepest, 0);
  // And the clipper is pushed harder than the one that is doing nothing, so
  // "no reduction" cannot be the whole of the cue.
  assert.ok(seen.clip.settings.drive > seen.none.settings.drive + 2,
    'the clipper should be pushed well past the knee');
});
