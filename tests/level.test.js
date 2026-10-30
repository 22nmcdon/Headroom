import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TRIM_RANGE, TRIM_STEP, LEVEL_DEFAULTS, gainOf, runTrim, levelReading,
} from '../src/plugins/level/gain.js';
import { loudnessReading, ABSOLUTE_GATE } from '../src/lib/loudness.js';
import { LEVEL_WORK, LEVEL_EXERCISES } from '../src/learn/work/level.js';
import { distance } from '../src/gap.js';
import { mulberry32 } from '../src/lib/random.js';

const rate = 48000;

/**
 * Material with a swell in it, so the gating has blocks of different levels
 * to keep and throw away rather than one steady tone - which is the case
 * where the gate does nothing and a bug in it would not show.
 */
function bed(seconds = 4, at = rate) {
  const n = Math.round(at * seconds);
  const x = new Float32Array(n);
  const noise = mulberry32(0xbeef);
  let lp = 0;
  for (let i = 0; i < n; i += 1) {
    const t = i / at;
    lp += ((noise() * 2 - 1) - lp) * 0.2;
    const swell = 0.6 + 0.4 * Math.sin(2 * Math.PI * 0.3 * t);
    x[i] = (Math.sin(2 * Math.PI * 110 * t) * 0.4
      + Math.sin(2 * Math.PI * 440 * t) * 0.3
      + Math.sin(2 * Math.PI * 2200 * t) * 0.2 + lp * 0.6) * swell * 0.22;
  }
  return x;
}

/* --- the one thing the tool rests on -------------------------------------- */

test('a trim moves the loudness by exactly the trim', () => {
  // The whole tool is built on this and it is worth holding to the decimal,
  // because every exercise here marks a trim by reading the output rather
  // than by trusting the knob. Measured at every step from -12 to +12, both
  // the integrated loudness and the true peak move by exactly the trim.
  const x = bed();
  const base = loudnessReading([x, x], rate).values;

  for (const db of [-12, -6, -3, -1, -0.5, 0.5, 1, 3, 6, 12]) {
    const out = runTrim(x, x, { trim: db });
    const got = loudnessReading([out.left, out.right], rate).values;
    assert.ok(Math.abs((got.integrated - base.integrated) - db) < 0.001,
      `a ${db} dB trim moved the loudness by ${(got.integrated - base.integrated).toFixed(4)}`);
    assert.ok(Math.abs((got.truePeak - base.truePeak) - db) < 0.001,
      `and the peak by ${(got.truePeak - base.truePeak).toFixed(4)}`);
  }
});

test('the trim is exact until the gate eats it, and the range stays inside that', () => {
  // Where the line above stops being true, which is the reason the range is
  // what it is. Integrated loudness throws away any 400 ms block under -70
  // LUFS, so a trim deep enough to push blocks under that stops moving the
  // reading by the trim. Measured on this bed, which reads -21.633 LUFS:
  //
  //     trim   out by   blocks kept
  //      -24   0.0000        36
  //      -30   0.0000        36
  //      -40   0.4582        32
  //      -44   1.1919        26
  //      -50   2.5697        12
  //      -55       -           0, and the reading is -Infinity
  //
  // Where exactly it starts depends on the material rather than on the trim:
  // this table was first written from a quieter bed and read 0.6997 at -40,
  // which is the same effect arriving sooner.
  const x = bed();
  const base = loudnessReading([x, x], rate).values.integrated;
  const outBy = (db) => {
    const out = runTrim(x, x, { trim: db });
    const got = loudnessReading([out.left, out.right], rate).values.integrated;
    return Math.abs((got - base) - db);
  };

  // `runTrim` clamps to the range, so the deep trims are measured as the raw
  // gains they would be rather than through a control that will not go there.
  const deep = (db) => {
    const g = 10 ** (db / 20);
    const scaled = Float32Array.from(x, (v) => v * g);
    const got = loudnessReading([scaled, scaled], rate).values.integrated;
    return Math.abs((got - base) - db);
  };

  assert.ok(deep(-44) > 0.5, 'by -44 the gate is already taking blocks');
  assert.ok(!Number.isFinite(
    loudnessReading([Float32Array.from(x, (v) => v * 10 ** (-55 / 20))], rate).values.integrated,
  ), 'and by -55 there is no reading left');

  // Which is why the range stops where it does: at both ends of it the trim
  // is still exact on material anywhere near a normal mix level.
  for (const edge of TRIM_RANGE) {
    assert.ok(outBy(edge) < 0.001, `the trim should be exact at ${edge} dB, and was ${outBy(edge).toFixed(4)} out`);
  }
  assert.ok(ABSOLUTE_GATE === -70, 'and the gate is where BS.1770 puts it');
});

test('the trim can reach any answer the exercise sets', () => {
  // A knob that cannot express the answer is a knob that marks somebody wrong
  // for the shape of the control. The faults are whole tenths and the step is
  // a tenth, so a perfect answer exists rather than nearly exists.
  const rng = mulberry32(0x5eed);
  for (let i = 0; i < 200; i += 1) {
    const puzzle = LEVEL_WORK.makePuzzle(rng, 'hard', { exercise: 'match' });
    const wanted = puzzle.answer.trim;
    assert.ok(wanted >= TRIM_RANGE[0] && wanted <= TRIM_RANGE[1],
      `${wanted} is off the trim's own scale`);
    assert.ok(Math.abs(wanted / TRIM_STEP - Math.round(wanted / TRIM_STEP)) < 1e-6,
      `${wanted} is not a whole number of steps`);
    assert.ok(Math.abs(wanted) >= 1, `${wanted} is inside the tolerance before anybody starts`);
  }
});

/* --- the reading --------------------------------------------------------- */

test('a level reading is the loudness reading, and compares as one', () => {
  // Deliberately the same reading rather than a second opinion: a level tool
  // that measured level its own way would be teaching its own arithmetic
  // instead of the one every delivery spec is written in.
  const x = bed();
  const mine = levelReading(x, x, rate, { trim: 3 });
  const theirs = levelReading(x, x, rate, { trim: 0 });

  assert.equal(mine.kind, 'loudness');
  assert.equal(mine.tool, 'level');
  const gap = distance(mine, theirs);
  assert.ok(Math.abs(gap.off - 3) < 0.001, `three decibels apart reads ${gap.off.toFixed(4)}`);
  assert.ok(gap.detail.louder > 0, 'and it says which way');

  // And it compares with one taken by the analysis page, because they are the
  // same measurement of the same thing.
  const page = loudnessReading([x, x], rate);
  assert.equal(page.tool, 'analysis');
  assert.doesNotThrow(() => distance(theirs, page));
});

test('a reading goes stale when the trim moves', () => {
  // The envelope's whole job. The analysis page has no settings to stamp - a
  // file is a file - so the loudness reading defaults to stamping the shape
  // of the audio, and the level tool passes its settings instead.
  const x = bed(1);
  const at = (trim) => levelReading(x, x, rate, { trim }).of.state;
  assert.notEqual(at(0), at(0.1), 'a tenth of a decibel is a different reading');
  assert.equal(at(2), at(2), 'and the same trim is the same one');
});

/* --- the exercises -------------------------------------------------------- */

test('matching a level is marked on the output, not the knob', () => {
  const rng = mulberry32(0x1234);
  const puzzle = {
    ...LEVEL_WORK.makePuzzle(rng, 'medium', { exercise: 'match' }),
    tier: 'medium',
    settings: { exercise: 'match' },
  };

  // The answer nulls it exactly, because a gain is exact.
  const right = LEVEL_WORK.score({ trim: puzzle.answer.trim }, puzzle);
  assert.ok(right.correct, 'the answer should be the answer');
  assert.ok(right.error < 0.001, `and read ${right.error.toFixed(4)} LU out`);

  // Leaving it alone never is, which is what makes it a round.
  const nothing = LEVEL_WORK.score({ trim: 0 }, puzzle);
  assert.equal(nothing.correct, false, 'doing nothing is never the answer');

  // And the error is the distance in LU, so being out by a decibel reads as a
  // decibel rather than as a knob position.
  const nearly = LEVEL_WORK.score({ trim: puzzle.answer.trim + 1 }, puzzle);
  assert.ok(Math.abs(nearly.error - 1) < 0.01,
    `a decibel out should read as a decibel, and read ${nearly.error.toFixed(3)}`);
});

test('the tiers get harder and none of them is below what anybody can hear', () => {
  const rng = mulberry32(0xabc);
  const errorAt = (tier, off) => {
    const puzzle = {
      ...LEVEL_WORK.makePuzzle(rng, tier, { exercise: 'match' }),
      tier,
      settings: { exercise: 'match' },
    };
    return LEVEL_WORK.score({ trim: puzzle.answer.trim + off }, puzzle).correct;
  };

  // Easy forgives a decibel, hard does not. The published difference limen
  // for level is about one decibel on music, so the hard tier is deliberately
  // under it - which is reachable only because the A/B is instant.
  assert.equal(errorAt('easy', 1.0), true, 'a decibel out still passes on easy');
  assert.equal(errorAt('hard', 1.0), false, 'and never on hard');
  assert.equal(errorAt('hard', 0.3), true, 'where three tenths does');
});

test('the drill asks for an amount and marks the chip', () => {
  const rng = mulberry32(0x999);
  for (const tier of ['easy', 'medium', 'hard']) {
    const puzzle = {
      ...LEVEL_WORK.makePuzzle(rng, tier, { exercise: 'drill' }),
      tier,
      settings: { exercise: 'drill' },
    };
    const offered = LEVEL_WORK.slots(tier, { exercise: 'drill' })[0].options.map((o) => o.id);

    assert.ok(offered.includes(puzzle.answer.louder),
      `${tier} asked for ${puzzle.answer.louder} dB and does not offer it`);
    assert.ok(Math.min(...offered) >= 0.5,
      `${tier} offers ${Math.min(...offered)} dB, which is under what anybody can reliably hear`);

    // The fault is the thing being named, so the two agree by construction
    // rather than by a second table that could drift.
    assert.equal(puzzle.fault.trim, puzzle.answer.louder);

    assert.ok(LEVEL_WORK.score({ louder: puzzle.answer.louder }, puzzle).correct);
    const wrong = offered.find((db) => db !== puzzle.answer.louder);
    assert.equal(LEVEL_WORK.score({ louder: wrong }, puzzle).correct, false);
  }
});

test('the drill offers a ladder, so one chip out is always the same ratio', () => {
  // It matters because a chip one place out is marked near rather than wrong,
  // and that only means something if the places are evenly spaced in the
  // thing being judged. Doubling is even in decibels of ratio.
  for (const tier of ['easy', 'medium', 'hard']) {
    const offered = LEVEL_WORK.slots(tier, { exercise: 'drill' })[0].options.map((o) => o.id);
    for (let i = 1; i < offered.length; i += 1) {
      assert.ok(Math.abs(offered[i] / offered[i - 1] - 2) < 1e-9,
        `${tier} goes ${offered[i - 1]} to ${offered[i]}, which is not a doubling`);
    }
  }
});

test('every exercise bakes its fault rather than leaving it switchable', () => {
  // A fault that can be bypassed is a setting to be found rather than a
  // mistake to be fixed, and here it would be the answer: a bypass button on
  // the matching exercise is a button that solves it.
  const rng = mulberry32(0x77);
  for (const id of Object.keys(LEVEL_EXERCISES)) {
    const puzzle = LEVEL_WORK.makePuzzle(rng, 'medium', { exercise: id });
    const fault = LEVEL_EXERCISES[id].faultOf(puzzle);
    assert.ok(Math.abs(fault.trim) > 0, `${id} hands over a loop with nothing wrong with it`);
  }
});

test('the tool opens on a trim of nothing', () => {
  // The rest position has to be inside the range or a saved session loads
  // back clamped, and it has to be zero or the tool arrives having already
  // done something to the audio.
  assert.equal(LEVEL_DEFAULTS.trim, 0);
  assert.ok(LEVEL_DEFAULTS.trim >= TRIM_RANGE[0] && LEVEL_DEFAULTS.trim <= TRIM_RANGE[1]);
  assert.equal(gainOf(0), 1, 'and a trim of nothing is a gain of one');
});
