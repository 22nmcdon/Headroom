import test from 'node:test';
import assert from 'node:assert/strict';

import {
  farMic, pairSum, pairBands, crossLag, notchesOf, peaksOf, alignPass, alignGap,
  lowOf, cmOf, msOf, ALIGN_HZ, ALIGN_LIMITS, ALIGN_DEFAULTS, PER_MS, LOW_TOP,
} from '../src/plugins/align/pair.js';
import { ALIGN_WORK as align } from '../src/learn/work/align.js';
import { mulberry32 } from '../src/lib/random.js';

const RATE = 48000;

/**
 * A kit to put two microphones on: the same arithmetic as the exercise's own
 * probe, which is not exported because nothing outside it has a use for it.
 */
function kit(rate = RATE, seconds = 4) {
  const n = Math.round(rate * seconds);
  const out = new Float32Array(n);
  const rng = mulberry32(0x7a1e);
  const beat = 60 / 96;
  const hit = (at, {
    tone, decay, noise, noiseDecay, level,
  }) => {
    const length = Math.round(rate * 0.4);
    for (let i = 0; i < length && at + i < n; i += 1) {
      const t = i / rate;
      out[at + i] += level * (Math.sin(2 * Math.PI * tone * t) * Math.exp(-t * decay)
        + (rng() * 2 - 1) * noise * Math.exp(-t * noiseDecay));
    }
  };
  for (let k = 0; k * beat * 0.5 < seconds; k += 1) {
    const at = Math.round(k * beat * 0.5 * rate);
    if (k % 8 === 0 || k % 8 === 5) {
      hit(at, {
        tone: 60, decay: 11, noise: 0.3, noiseDecay: 240, level: 0.7,
      });
    }
    if (k % 8 === 2 || k % 8 === 6) {
      hit(at, {
        tone: 190, decay: 16, noise: 1.6, noiseDecay: 22, level: 0.33,
      });
    }
    hit(at, {
      tone: 9000, decay: 60, noise: 2.4, noiseDecay: 90, level: k % 2 ? 0.05 : 0.09,
    });
  }
  return out;
}

const close = kit();

/** Where the sum sits against the close mic alone, band by band. */
const combOf = (far, settings) => {
  const dry = pairBands(close, RATE);
  const wet = pairBands(pairSum(close, far, RATE, settings), RATE);
  return wet.map((db, i) => db - dry[i]);
};

/* --- the arithmetic ------------------------------------------------------- */

test('a millisecond is 34.3 cm, both ways round', () => {
  assert.ok(Math.abs(cmOf(1) - 34.3) < 1e-9, 'a millisecond of air');
  assert.ok(Math.abs(msOf(34.3) - 1) < 1e-9, 'and back again');
  assert.ok(Math.abs(cmOf(msOf(80)) - 80) < 1e-9, 'a round trip');
  // The figure the whole tool is a conversion table for.
  assert.ok(Math.abs(PER_MS * 100 - 34.3) < 1e-9);
});

test('the notches of a comb are where the formula says, and so are the peaks', () => {
  for (const ms of [0.25, 0.5, 1, 2, 4]) {
    const notches = notchesOf(ms, 20000);
    assert.ok(Math.abs(notches[0] - 1000 / (2 * ms)) < 1e-9, `the first notch of ${ms} ms`);
    // Odd multiples of the first, and nothing in between.
    notches.forEach((hz, k) => {
      assert.ok(Math.abs(hz - (2 * k + 1) * notches[0]) < 1e-6, `notch ${k} of ${ms} ms`);
    });
    const peaks = peaksOf(ms, 20000);
    assert.ok(Math.abs(peaks[0] - 1000 / ms) < 1e-9, `the first peak of ${ms} ms`);
    // And each peak sits halfway between two notches, in frequency.
    assert.ok(Math.abs(peaks[0] - (notches[0] + notches[1]) / 2) < 1e-6);
  }
  assert.deepEqual(notchesOf(0), [], 'no time apart is no comb');
});

test('a summed pair really is notched where notchesOf says it is', () => {
  // The formula against the measurement, which is the one claim in this
  // module that could be wrong in a way nobody would notice. Measured: a path
  // of 0.25 ms dips at 2032 Hz against a predicted 2000, 0.5 at 1016 against
  // 1000, 1 at 508 against 500, 2 at 254 against 250, 4 at 127 against 125 -
  // the formula to the resolution of a sixth-octave band set.
  for (const ms of [0.25, 0.5, 1, 2, 4]) {
    const far = farMic(close, RATE, { ms, level: 0, tilt: 20000 });
    const comb = combOf(far, { delay: 0, blend: 0, flip: false });

    let worst = 0;
    let at = 0;
    ALIGN_HZ.forEach((hz, i) => {
      if (comb[i] < worst) { worst = comb[i]; at = hz; }
    });

    const want = notchesOf(ms)[0];
    const off = Math.abs(Math.log2(at / want));
    assert.ok(off < 1 / 6, `${ms} ms dipped at ${at} Hz, not ${want.toFixed(0)}`);
    assert.ok(worst < -12, `and it should be a notch, not a dip: ${worst.toFixed(1)} dB`);
  }
});

test('aligning a pair recovers the low end, and flipping it takes it away', () => {
  const far = farMic(close, RATE, { ms: 3.5, level: -4 });
  const dry = lowOf(pairBands(close, RATE));
  const low = (settings) => lowOf(pairBands(pairSum(close, far, RATE, settings), RATE)) - dry;

  // Aligned, two microphones add up: a far mic four decibels down puts about
  // four decibels back under 200 Hz. Measured at 4.0 on the probe and 4.2 on
  // the rendered loop.
  assert.ok(low({ delay: 3.5, blend: 0, flip: false }) > 3,
    'an aligned pair should fill the bottom in');
  // And inverted, the same pair takes most of it away.
  assert.ok(low({ delay: 3.5, blend: 0, flip: true }) < -6,
    'a flipped pair should gut it');
  // Unaligned, the pair still gains some of it - at three and a half
  // milliseconds the bottom two octaves are only a third of a cycle apart, so
  // they mostly still agree. Measured at 2.26 against the aligned 4.28, which
  // is the honest shape of this: alignment is worth about two decibels of low
  // end on a pair this far apart, and the rest of what it is worth is in the
  // mids where the notch was.
  const unaligned = low({ delay: 0, blend: 0, flip: false });
  assert.ok(unaligned > 1.5 && unaligned < 3,
    `an unaligned pair gained ${unaligned.toFixed(2)} dB down there`);
  assert.ok(low({ delay: 3.5, blend: 0, flip: false }) - unaligned > 1.5,
    'and aligning it should be worth more than that');
});

test('the far mic is the close one later, quieter and darker', () => {
  const far = farMic(close, RATE, { ms: 2, level: -6, tilt: 3500 });
  const delayed = Math.round((2 / 1000) * RATE);

  // Later: nothing arrives before the path does.
  for (let i = 0; i < delayed - 1; i += 1) {
    assert.equal(far[i], 0, `the far mic cannot hear anything at sample ${i}`);
  }

  // Quieter, and darker: both measured against the close mic's own bands.
  const dry = pairBands(close, RATE);
  const wet = pairBands(far, RATE);
  const lowBand = ALIGN_HZ.findIndex((hz) => hz >= 100);
  const topBand = ALIGN_HZ.length - 1;
  assert.ok(Math.abs((wet[lowBand] - dry[lowBand]) + 6) < 1.5,
    'the level knob is the level, where the rolloff has not reached');
  // And darker by the top of the band set, which is where the rolloff has
  // started: measured at -9.6 against the -6.0 it is down at 100 Hz.
  assert.ok(wet[topBand] - dry[topBand] < -8,
    `the top of it should be further down than the rest: ${(wet[topBand] - dry[topBand]).toFixed(1)} dB`);
});

test('and the reading stops where the far mic has stopped answering', () => {
  // The measurement behind ALIGN_HZ's ceiling, on noise rather than on a kit,
  // because a kit has nothing above 10 kHz to measure a rolloff with. At -6 dB
  // and the default tilt the path is flat to 640 Hz and then goes: 6.5 dB down
  // at 1.3 kHz, 7.8 at 2.6, 10.8 at 5.1 and 15.2 at 10.2. Above the band set's
  // ceiling the far mic is too quiet to comb with, which is why the ceiling is
  // there.
  const n = RATE * 2;
  const noise = new Float32Array(n);
  const rng = mulberry32(0x1234);
  for (let i = 0; i < n; i += 1) noise[i] = (rng() * 2 - 1) * 0.2;

  const octaves = [];
  for (let hz = 40; hz <= 10240; hz *= 2) octaves.push(hz);
  const dry = pairBands(noise, RATE, octaves);
  const wet = pairBands(farMic(noise, RATE, { ms: 0, level: -6, tilt: 3500 }), RATE, octaves);
  const down = octaves.map((hz, i) => dry[i] - wet[i]);

  for (let i = 0; i < octaves.length; i += 1) {
    if (octaves[i] > 640) continue;
    assert.ok(Math.abs(down[i] - 6) < 0.2, `${octaves[i]} Hz is ${down[i].toFixed(1)} dB down`);
  }
  assert.ok(down[octaves.indexOf(5120)] > 9, 'a long way down by five kilohertz');
  assert.ok(down[octaves.indexOf(10240)] > 13, 'and further by ten');
  // Which is the claim ALIGN_HZ's ceiling rests on: at the top of the band set
  // the far mic is still in the game, and an octave above it, it is not.
  assert.ok(down[octaves.indexOf(2560)] < 9, 'still combing inside the band set');
});

/* --- the search ----------------------------------------------------------- */

test('the search finds the lag and the polarity, and agrees with brute force', () => {
  const brute = (a, b, mostMs) => {
    const length = Math.min(a.length, b.length, RATE);
    const most = Math.round((mostMs / 1000) * RATE);
    let ea = 0;
    let eb = 0;
    for (let i = 0; i < length; i += 1) { ea += a[i] * a[i]; eb += b[i] * b[i]; }
    const norm = Math.sqrt(ea * eb);
    let best = 0;
    let found = 0;
    for (let lag = -most; lag <= most; lag += 1) {
      let sum = 0;
      const from = Math.max(0, -lag);
      const to = Math.min(length, length - lag);
      for (let i = from; i < to; i += 1) sum += a[i] * b[i + lag];
      const r = sum / norm;
      if (Math.abs(r) > Math.abs(best)) { best = r; found = lag; }
    }
    return { lagMs: (found / RATE) * 1000, sign: Math.sign(best) };
  };

  for (const ms of [0.3, 1, 3, 8]) {
    for (const flip of [false, true]) {
      const far = farMic(close, RATE, { ms, level: -4, flip });
      const found = crossLag(close, far, RATE);
      const want = brute(close, far, 25);

      assert.ok(Math.abs(found.lagMs - want.lagMs) < 1e-9,
        `coarse-and-fine found ${found.lagMs} where brute force found ${want.lagMs}`);
      assert.equal(found.sign, want.sign, 'and they agree about which way up it is');
      // To the sample, which at 48 kHz is a fiftieth of a millisecond.
      assert.ok(Math.abs(found.lagMs - ms) <= 1000 / RATE,
        `${ms} ms apart read as ${found.lagMs.toFixed(3)}`);
      assert.equal(found.sign, flip ? -1 : 1, 'the sign is the relative polarity');
      assert.ok(found.peak > 0.9, `and the two should look alike: ${found.peak.toFixed(3)}`);
    }
  }
});

test('the correlation at zero lag is not a polarity meter, and says so', () => {
  // The finding this tool exists to show, pinned: on a pair eight
  // milliseconds apart the console meter reads negative when the two are the
  // same way up and positive when one of them is inverted. It is not broken;
  // it is answering a question about the spacing.
  const same = crossLag(close, farMic(close, RATE, { ms: 8, level: -4 }), RATE);
  const flipped = crossLag(close, farMic(close, RATE, { ms: 8, level: -4, flip: true }), RATE);

  assert.ok(same.zero < -0.5, `a pair the same way up reading ${same.zero.toFixed(3)} at zero`);
  assert.ok(flipped.zero > 0.5, `and a flipped one reading ${flipped.zero.toFixed(3)}`);
  assert.ok(Math.abs(same.zero + flipped.zero) < 1e-6, 'which are the same number, opposite ways');

  // While the peak gets it right both times.
  assert.equal(same.sign, 1);
  assert.equal(flipped.sign, -1);
});

/* --- the reading ---------------------------------------------------------- */

test('the band set is sixth-octave, and stops where the far mic does', () => {
  assert.equal(ALIGN_HZ[0], 40);
  assert.ok(ALIGN_HZ[ALIGN_HZ.length - 1] <= 4100 && ALIGN_HZ[ALIGN_HZ.length - 1] > 3500,
    `the top band is ${ALIGN_HZ[ALIGN_HZ.length - 1]} Hz`);
  // A sixth of an octave each, to the nearest hertz - the centres are rounded
  // for the display's sake, which at the bottom of the set is worth up to two
  // hundredths of an octave: 40 to 45 is 0.170 where a sixth is 0.167.
  for (let i = 1; i < ALIGN_HZ.length; i += 1) {
    const step = Math.log2(ALIGN_HZ[i] / ALIGN_HZ[i - 1]);
    assert.ok(Math.abs(step - 1 / 6) < 0.025, `band ${i} is ${step.toFixed(3)} of an octave up`);
  }
  // And the whole set spans what it says: six and a third octaves of it.
  const octaves = Math.log2(ALIGN_HZ[ALIGN_HZ.length - 1] / ALIGN_HZ[0]);
  assert.ok(Math.abs(octaves - (ALIGN_HZ.length - 1) / 6) < 0.05,
    `${ALIGN_HZ.length} bands spanning ${octaves.toFixed(2)} octaves`);
});

test('a reading of a pair knows which pair, and will not be compared with another', () => {
  const far = farMic(close, RATE, { ms: 2, level: -4 });
  const other = farMic(close, RATE, { ms: 5, level: -4 });
  const settings = { ...ALIGN_DEFAULTS, delay: 2 };

  const mine = alignPass({ close, far }, RATE, settings).reading;
  const same = alignPass({ close, far }, RATE, settings).reading;
  const theirs = alignPass({ close, far: other }, RATE, settings).reading;

  assert.equal(mine.of.axis.over, same.of.axis.over, 'the same pair stamps the same');
  assert.notEqual(mine.of.axis.over, theirs.of.axis.over, 'a different far mic is different material');
  assert.equal(alignGap(mine, same).off, 0, 'and reads as no distance at all');
});

test('the gap says how much time is left between the mics, and which way', () => {
  const far = farMic(close, RATE, { ms: 3, level: -4 });
  const pair = { close, far };
  const right = alignPass(pair, RATE, { ...ALIGN_DEFAULTS, delay: 3 }).reading;

  const short = alignGap(alignPass(pair, RATE, { ...ALIGN_DEFAULTS, delay: 2 }).reading, right);
  const over = alignGap(alignPass(pair, RATE, { ...ALIGN_DEFAULTS, delay: 4 }).reading, right);

  assert.ok(short.detail.left > 0.9 && short.detail.left < 1.1, 'a millisecond short');
  assert.ok(over.detail.left < -0.9 && over.detail.left > -1.1, 'and a millisecond past');
  assert.equal(short.where, '500 Hz', 'and where that millisecond is heard');

  const flipped = alignGap(
    alignPass(pair, RATE, { ...ALIGN_DEFAULTS, delay: 3, flip: true }).reading, right,
  );
  assert.equal(flipped.detail.flipped, true, 'and that the polarity disagrees');
  assert.ok(flipped.off > 8, `which is the loudest mistake there is: ${flipped.off.toFixed(1)} dB`);
});

/* --- the rounds ----------------------------------------------------------- */

const roundsOf = (tier, exercise, n = 40) => {
  const settings = { exercise };
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const rng = mulberry32(0x4a11 + i * 2311);
    out.push({ tier, settings, ...align.makePuzzle(rng, tier, settings) });
  }
  return out;
};

test('every pair a round asks for is one the controls can answer', () => {
  for (const tier of ['easy', 'medium', 'hard']) {
    for (const { answer, path } of roundsOf(tier, 'match')) {
      assert.ok(answer.delay >= ALIGN_LIMITS.delay[0] && answer.delay <= ALIGN_LIMITS.delay[1],
        `${tier} asked for ${answer.delay} ms of delay`);
      // On the knob's own grid, or the round cannot be won: measured, being a
      // step and a half out reads 0.1 dB, which is inside every tolerance -
      // but being half a step out of reach on every round is a tool that
      // cannot land on its answer.
      assert.ok(Math.abs(answer.delay / 0.02 - Math.round(answer.delay / 0.02)) < 1e-9,
        `${tier} asked for ${answer.delay} ms, which is between two steps`);
      assert.equal(answer.delay, path.ms, 'the answer is the path, in time');
      assert.equal(answer.flip, path.flip, 'and the polarity the path arrived with');
      assert.equal(answer.blend, 0, 'the fader is not part of the answer');
    }
  }

  // Easy never asks for a polarity flip, and the other two sometimes do.
  const flips = (tier) => roundsOf(tier, 'match').filter(({ path }) => path.flip).length;
  assert.equal(flips('easy'), 0, 'easy is about time alone');
  assert.ok(flips('medium') > 5, 'medium flips some of them');
  assert.ok(flips('hard') > 5, 'and so does hard');
});

test('an unaligned pair is never an answer, on any round this mode makes', () => {
  // The property the tolerances are set by: two and a half times the
  // tolerance has to stay short of doing nothing, so that leaving the pair
  // alone is not reported as close. Measured over forty rounds a tier, the
  // least an unaligned pair reads is 4.80 on easy and about 3.3 on the other
  // two, against near bands of 3.75, 2.50 and 1.50.
  const idle = { ...ALIGN_DEFAULTS, delay: 0, blend: 0, flip: false };
  for (const tier of ['easy', 'medium', 'hard']) {
    for (const puzzle of roundsOf(tier, 'match')) {
      const score = align.score(idle, puzzle);
      assert.ok(!score.correct,
        `${tier} accepted an unaligned pair at ${puzzle.path.ms} ms`);
      for (const cell of score.cells) {
        assert.equal(cell.state, 'miss',
          `${tier} read an unaligned pair as ${cell.state} at ${score.error.toFixed(2)} dB out`);
      }
    }
  }
});

test('the answer to a round is accepted, and a flip of it never is', () => {
  for (const tier of ['easy', 'medium', 'hard']) {
    for (const puzzle of roundsOf(tier, 'match', 12)) {
      assert.ok(align.score(puzzle.answer, puzzle).correct,
        `${tier} refused its own answer at ${puzzle.path.ms} ms`);
      const upside = { ...puzzle.answer, flip: !puzzle.answer.flip };
      assert.ok(!align.score(upside, puzzle).correct,
        `${tier} accepted the pair the wrong way up at ${puzzle.path.ms} ms`);
    }
  }
});

test('the distance drill is an octave a step, which is what makes it fair', () => {
  for (const tier of ['easy', 'medium', 'hard']) {
    const offered = align.slots(tier, { exercise: 'drill' })[0].options.map((o) => o.id);
    for (let i = 1; i < offered.length; i += 1) {
      const step = Math.log2(offered[i] / offered[i - 1]);
      // Easy offers every other rung, so its steps are two octaves.
      assert.ok(Math.abs(step - (tier === 'easy' ? 2 : 1)) < 1e-9,
        `${tier} steps ${step} octaves between ${offered[i - 1]} and ${offered[i]} cm`);
    }

    for (const puzzle of roundsOf(tier, 'drill', 12)) {
      assert.ok(offered.includes(puzzle.answer.apart), 'the answer is one of the chips');
      // The path is the distance, in time: the drill asks about centimetres
      // and the tool is set in milliseconds, and those have to be the same
      // fact or the round is marked on something it did not play.
      assert.ok(Math.abs(cmOf(puzzle.path.ms) - puzzle.answer.apart) < 1e-9,
        `${puzzle.answer.apart} cm came out as ${cmOf(puzzle.path.ms).toFixed(1)} cm of path`);
    }
  }
});

test('the fault drill asks two questions at once, each on its own', () => {
  for (const tier of ['easy', 'medium', 'hard']) {
    const rounds = roundsOf(tier, 'flip', 30);
    const of = (id) => rounds.filter((p) => p.answer.wrong === id);

    for (const puzzle of rounds) {
      assert.equal(puzzle.path.flip, puzzle.answer.wrong === 'flipped',
        'the pair is inverted exactly when that is the answer');
    }

    // The point of the design: within a tier, "nothing wrong" and "inverted"
    // are the same distance apart and differ only in polarity, and "too far
    // apart" has the same polarity and differs only in distance. So neither
    // question can be answered by noticing the other.
    const fine = of('nothing')[0];
    const flipped = of('flipped')[0];
    const late = of('late')[0];
    assert.ok(fine && flipped && late, `${tier} does not offer all three`);
    assert.equal(fine.path.ms, flipped.path.ms, 'the flip is the only difference');
    assert.equal(fine.path.flip, late.path.flip, 'and the distance is the only other one');
    assert.ok(late.path.ms > fine.path.ms * 3,
      `${tier} puts them ${late.path.ms.toFixed(2)} ms apart against ${fine.path.ms.toFixed(2)}`);

    // And the easy tier separates the two distances by more than the hard one.
    assert.ok(fine.path.ms < 0.6, `the close pair is ${fine.path.ms.toFixed(2)} ms apart`);
  }

  const spread = (tier) => {
    const rounds = roundsOf(tier, 'flip', 30);
    const close = rounds.find((p) => p.answer.wrong === 'nothing').path.ms;
    const far = rounds.find((p) => p.answer.wrong === 'late').path.ms;
    return Math.log2(far / close);
  };
  assert.ok(spread('easy') > spread('hard') + 1,
    'easy should put more octaves between the two than hard does');
});
