import test from 'node:test';
import assert from 'node:assert/strict';

import {
  modCore, modKind, lfoAt, apCoef, MOD_KINDS, MOD_IDS, MOD_DEFAULTS, MOD_LIMITS,
  MOD_SPREADS, MOD_SHAPES, MOVE_FLOOR, AP_STAGES, LINE_MS,
} from '../src/plugins/modulation/dsp.js';
import {
  modTrack, modReading, modGap, rateOf, depthOf, travelOf, unitOf, apartOf,
  MOD_FRAMES, MOD_SECONDS, MOD_RATE, MOD_PER_SECOND,
} from '../src/plugins/modulation/trace.js';
import { modSource } from '../src/plugins/modulation/node.js';
import { MOD_WORK as modulation } from '../src/learn/work/modulation.js';
import { comparable } from '../src/lib/read.js';
import { distance } from '../src/gap.js';
import { DIVISIONS, rateFor } from '../src/lib/tempo.js';
import { fft } from '../src/lib/fft.js';
import { mulberry32 } from '../src/lib/random.js';

const RATE = 48000;

/* --- the oscillator ------------------------------------------------------- */

test('the oscillator is a cycle long and goes all the way to both ends', () => {
  for (const { id } of MOD_SHAPES) {
    let low = Infinity;
    let high = -Infinity;
    for (let i = 0; i < 1000; i += 1) {
      const at = lfoAt(i / 1000, id);
      low = Math.min(low, at);
      high = Math.max(high, at);
      // Periodic, to the bit, which is what lets a path be compared against
      // another path taken four seconds later.
      assert.ok(Math.abs(lfoAt(i / 1000 + 3, id) - at) < 1e-12, `${id} is not periodic`);
    }
    assert.ok(Math.abs(low + 1) < 0.01 && Math.abs(high - 1) < 0.01,
      `${id} ran from ${low.toFixed(3)} to ${high.toFixed(3)}`);
  }

  // A sine spends most of its time near the ends and a triangle spends the
  // same amount of time everywhere, which is the whole of the difference.
  const share = (shape) => {
    let near = 0;
    for (let i = 0; i < 1000; i += 1) if (Math.abs(lfoAt(i / 1000, shape)) > 0.7) near += 1;
    return near / 1000;
  };
  assert.ok(share('sine') > 0.48, `a sine is near its ends ${share('sine')} of the time`);
  assert.ok(share('triangle') < 0.32, `a triangle is ${share('triangle')}`);
});

test('every kind sweeps exactly the range its row says it does', () => {
  // The table and the core, held against each other: `centre` and `span` are
  // the whole of what a depth of one means, and a row whose numbers drifted
  // from its arithmetic would be a face lying about what it is set to.
  for (const kind of MOD_KINDS) {
    const core = modCore(RATE).set({ ...MOD_DEFAULTS, kind: kind.id, rate: 1, depth: 1 }).reset();
    let low = Infinity;
    let high = -Infinity;
    for (let i = 0; i < RATE; i += 1) {
      core.stereo(0, 0);
      low = Math.min(low, core.moving[0]);
      high = Math.max(high, core.moving[0]);
    }

    if (kind.family === 'delay') {
      assert.ok(Math.abs(low - (kind.centre - kind.span)) < 0.02, `${kind.id} bottomed at ${low}`);
      assert.ok(Math.abs(high - (kind.centre + kind.span)) < 0.02, `${kind.id} topped at ${high}`);
      // And the line is long enough for it, with the interpolator's elbows.
      assert.ok(kind.centre + kind.span < LINE_MS - 1, `${kind.id} sweeps past its own line`);
    } else if (kind.family === 'phase') {
      assert.ok(Math.abs(Math.log2(low / kind.centre) + kind.span) < 0.01, `${kind.id} bottomed at ${low}`);
      assert.ok(Math.abs(Math.log2(high / kind.centre) - kind.span) < 0.01, `${kind.id} topped at ${high}`);
    } else {
      assert.equal(low, MOVE_FLOOR, `${kind.id} should reach the floor at full depth`);
      assert.ok(high >= 0 && high < 3.1, `${kind.id} topped at ${high} dB`);
    }
  }
});

test('a modulation at no depth at all does nothing, and a dry one does less', () => {
  for (const id of MOD_IDS) {
    const core = modCore(RATE).set({ ...MOD_DEFAULTS, kind: id, dry: true }).reset();
    let worst = 0;
    for (let i = 0; i < 4000; i += 1) {
      const x = Math.sin(i * 0.07) * 0.5;
      core.stereo(x, -x);
      worst = Math.max(worst, Math.abs(core.left - x), Math.abs(core.right + x));
    }
    assert.equal(worst, 0, `a dry ${id} changed the signal`);
    // And its path is flat, which is what the drills play on the clean side.
    assert.equal(modReading({ kind: id, dry: true }).values.depth, 0);
  }
});

/* --- what each family does to a signal ------------------------------------ */

/** White noise through a core, as a spectrum in dB against the input. */
function through(settings) {
  const n = 1 << 17;
  const core = modCore(RATE).set({ ...MOD_DEFAULTS, ...settings }).reset();
  const rng = mulberry32(0x31);
  const inp = new Float32Array(n);
  for (let i = 0; i < n; i += 1) inp[i] = (rng() * 2 - 1) * 0.25;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) { core.stereo(inp[i], inp[i]); out[i] = core.left; }

  const N = 1 << 15;
  const spec = (x) => {
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    const power = new Float64Array(N / 2);
    let windows = 0;
    for (let at = N; at + N <= x.length; at += N / 2) {
      re.fill(0);
      im.fill(0);
      for (let i = 0; i < N; i += 1) re[i] = x[at + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
      fft(re, im);
      for (let i = 0; i < N / 2; i += 1) power[i] += re[i] * re[i] + im[i] * im[i];
      windows += 1;
    }
    return power.map((p) => p / windows);
  };

  const dry = spec(inp);
  const wet = spec(out);
  const db = Array.from(wet, (v, i) => 10 * Math.log10(Math.max(1e-30, v) / Math.max(1e-30, dry[i])));
  return { db, hzPer: RATE / N, at: (hz) => db[Math.round(hz / (RATE / N))] };
}

/** The dips in a response, deepest first in each neighbourhood. */
function dips(r, { from = 60, to = 12000, under = -8 } = {}) {
  const out = [];
  for (let i = 2; i < r.db.length - 1; i += 1) {
    const hz = i * r.hzPer;
    if (hz < from || hz > to) continue;
    if (r.db[i] < under && r.db[i] < r.db[i - 1] && r.db[i] <= r.db[i + 1]) out.push(Math.round(hz));
  }
  return out.filter((hz, i) => i === 0 || hz > out[i - 1] * 1.2);
}

test('a frozen flanger is a comb, and the teeth are where the arithmetic says', () => {
  // Two copies t apart cancel at (2k+1)/2t. At three milliseconds that is
  // 167, 500, 833, 1167, 1500 - which is what it measures, to the resolution
  // of a 32768-point transform.
  const flanger = modKind('flanger');
  const found = dips(through({ kind: 'flanger', rate: 0, depth: 0 }), { to: 1800, under: -10 });
  const want = [1, 3, 5, 7, 9].map((k) => Math.round((k * 1000) / (2 * flanger.centre)));

  assert.equal(found.length, want.length, `found ${found.join(', ')}`);
  found.forEach((hz, i) => {
    assert.ok(Math.abs(Math.log2(hz / want[i])) < 0.03,
      `tooth ${i} at ${hz} Hz, not ${want[i]}`);
  });
});

test('a frozen phaser has three notches, spread out rather than evenly spaced', () => {
  // Six one-pole all-passes are a half turn at the corner and the dry signal
  // added back cancels wherever the chain is at a half turn or an odd
  // multiple: at 670 Hz that is 180, 669 and 2480 - measured, against a comb's
  // even spacing, which is the whole difference between the two devices.
  const found = dips(through({ kind: 'phaser', rate: 0, depth: 0 }), { to: 12000, under: -8 });
  assert.equal(found.length, AP_STAGES / 2, `found ${found.join(', ')}`);

  const corner = modKind('phaser').centre;
  assert.ok(Math.abs(Math.log2(found[1] / corner)) < 0.05,
    `the middle notch should sit on the corner: ${found[1]} against ${corner}`);
  // Spread out: each gap is wider than the last, where a comb's are equal.
  const gaps = [Math.log2(found[1] / found[0]), Math.log2(found[2] / found[1])];
  assert.ok(gaps[0] > 1.5 && gaps[1] > 1.5, `the notches are ${gaps.map((g) => g.toFixed(2))} octaves apart`);
});

test('vibrato has no comb at all, because there is nothing to comb with', () => {
  // Fully wet: a pure delay, so the magnitude response is flat and the only
  // thing moving is the pitch. This is the measurement behind the decision in
  // trace.js - anything watching the level is blind to this device.
  const r = through({ kind: 'vibrato', rate: 0, depth: 0 });
  let worst = 0;
  for (let hz = 60; hz < 12000; hz += 60) worst = Math.max(worst, Math.abs(r.at(hz)));
  // Measured at 0.25 dB, and what is left is the estimator rather than the
  // device: a delay of six milliseconds at this rate is a whole number of
  // samples, so the interpolator is not even running - the two spectra are of
  // the same noise windowed at two different offsets. On a tone, where there
  // is no such variance, the same frozen vibrato reads 0.00.
  assert.ok(worst < 0.5, `a frozen vibrato moved the spectrum by ${worst.toFixed(2)} dB`);
});

test('feedback sharpens a comb one way round and moves it the other', () => {
  // The measurement the notes quote. At three milliseconds the comb has a
  // notch at 167 Hz and a peak at 333.
  const notch = 167;
  const peak = 333;
  const read = (feedback) => through({ kind: 'flanger', rate: 0, depth: 0, feedback });

  const none = read(0);
  assert.ok(none.at(notch) < -20, `with no feedback the notch is a notch: ${none.at(notch).toFixed(1)}`);

  const up = read(0.8);
  assert.ok(up.at(peak) > 6, `positive feedback should drive the peak up: ${up.at(peak).toFixed(1)}`);
  assert.ok(up.at(notch) < -6, 'and leave the notch a notch');

  const down = read(-0.8);
  assert.ok(down.at(notch) > 2,
    `negative feedback should move the comb, lifting 167 Hz: ${down.at(notch).toFixed(1)}`);
});

test('an auto-pan is equal power, and in mono it disappears', () => {
  const core = modCore(RATE).set({
    ...MOD_DEFAULTS, kind: 'autopan', rate: 2, depth: 1,
  }).reset();

  let worstPower = 0;
  let worstMono = 0;
  let centre = 0;
  for (let i = 0; i < RATE; i += 1) {
    const x = 0.5;
    core.stereo(x, x);
    const power = (core.left / x) ** 2 + (core.right / x) ** 2;
    worstPower = Math.max(worstPower, Math.abs(power - 2));
    // Summed to mono, an auto-pan is a gain that does not move - the two
    // sides are exactly opposite, so what one takes the other gives back.
    const mono = (core.left + core.right) / (2 * x);
    if (i === 0) centre = mono;
    worstMono = Math.max(worstMono, Math.abs(mono - centre));
  }

  assert.ok(worstPower < 1e-9, `the pair's power wandered by ${worstPower}`);
  assert.ok(worstMono < 0.3, `folded to mono it still moved by ${worstMono.toFixed(3)}`);
});

/* --- the path ------------------------------------------------------------- */

test('the path finds the rate it was set to, and says so when it cannot', () => {
  // Measured against what was asked for: better than the quarter-hertz bin
  // spacing by a factor of sixty, because a sine through a Hann window is
  // very nearly the parabola the interpolation fits.
  for (const hz of [0.55, 0.8, 1.6, 2.2, 3, 4.8, 6.4, 9, 12]) {
    const found = modReading({ kind: 'chorus', rate: hz, depth: 0.5 }).values.hz;
    assert.ok(Math.abs(found - hz) < 0.01, `${hz} Hz read as ${found.toFixed(4)}`);
  }

  // And below two bins it refuses rather than guessing: the fit collapses to
  // about 0.37 Hz for anything slower, which is a number nobody should be
  // shown. The control still goes there.
  for (const hz of [0.25, 0.4]) {
    assert.equal(modReading({ kind: 'chorus', rate: hz, depth: 0.5 }).values.hz, 0,
      `${hz} Hz should be reported as unreadable`);
  }
  assert.equal(MOD_LIMITS.rate[0], 0.25);
  assert.ok(MOD_PER_SECOND === MOD_FRAMES / MOD_SECONDS);
});

test('the path is the same at the rate it is run at and at the audio rate', () => {
  // The claim MOD_RATE rests on: the oscillator is the slowest thing in the
  // app, and the only part of the core that depends on the sample rate is a
  // three sample guard at the end of a line no sweep here reaches.
  for (const id of MOD_IDS) {
    for (const hz of [0.55, 3, 12]) {
      const settings = {
        kind: id, rate: hz, depth: 0.8, spread: 90,
      };
      const mine = modTrack(settings);
      // The same arithmetic at the audio rate, by hand, because modTrack is
      // deliberately fixed at MOD_RATE.
      const core = modCore(RATE).set({ ...MOD_DEFAULTS, ...settings }).reset();
      const span = Math.round(MOD_SECONDS * RATE);
      const per = span / MOD_FRAMES;
      const theirs = new Float32Array(MOD_FRAMES);
      let frame = 0;
      let sum = 0;
      let count = 0;
      for (let i = 0; i < span; i += 1) {
        core.stereo(0, 0);
        sum += core.moving[0];
        count += 1;
        if (i + 1 >= per * (frame + 1) && frame < MOD_FRAMES) {
          theirs[frame] = travelOf(modKind(id), sum / count);
          frame += 1;
          sum = 0;
          count = 0;
        }
      }

      let worst = 0;
      for (let i = 0; i < MOD_FRAMES; i += 1) worst = Math.max(worst, Math.abs(mine.left[i] - theirs[i]));
      assert.ok(worst < 2e-3, `${id} at ${hz} Hz differs by ${worst.toExponential(2)} of travel`);
    }
  }
  assert.equal(MOD_RATE, 6000);
});

test('travel and the unit it is in are the same fact, both ways round', () => {
  for (const kind of MOD_KINDS) {
    for (const travel of [-1, -0.4, 0, 0.3, 0.9]) {
      const back = travelOf(kind, unitOf(kind, travel));
      // The level family floors at -40 dB, so the round trip is exact
      // everywhere except where the floor has taken over.
      if (kind.family === 'level' && 1 + travel <= 10 ** (MOVE_FLOOR / 20)) continue;
      assert.ok(Math.abs(back - travel) < 1e-6,
        `${kind.id} turned ${travel} into ${back}`);
    }
  }
});

test('the two sides read as apart when they are, and together when they are not', () => {
  const sides = (spread) => modReading({ kind: 'chorus', rate: 1, depth: 0.6, spread }).values.sides;
  assert.equal(sides(0), 0, 'mono is one line');
  assert.ok(sides(90) > 0.3, `a quarter turn reads ${sides(90)}`);
  assert.ok(sides(180) > sides(90), 'and opposite reads further');

  // An auto-pan is always opposite, whatever the spread says.
  const pan = modReading({ kind: 'autopan', rate: 1, depth: 0.6, spread: 0 }).values;
  assert.ok(pan.sides > 0.3, `an auto-pan with the spread at nought still reads ${pan.sides}`);

  // And the path itself: both channels are the same array for a mono setting.
  const { left, right } = modTrack({ kind: 'tremolo', rate: 2, depth: 0.5, spread: 0 });
  assert.deepEqual(Array.from(left), Array.from(right));
  assert.ok(apartOf(left, right) === 0);
});

test('the depth a path measures is the travel, which is not always the knob', () => {
  // Symmetric kinds read the knob back. The two level kinds are not symmetric
  // and are not meant to be, so they read their own geometry - which is why
  // the face quotes the travel in its own unit rather than a percentage.
  for (const id of ['chorus', 'flanger', 'vibrato', 'phaser']) {
    const { depth } = modReading({ kind: id, rate: 1, depth: 0.5 }).values;
    assert.ok(Math.abs(depth - 0.5) < 0.01, `${id} read ${depth}`);
  }

  const full = (id) => modReading({ kind: id, rate: 1, depth: 1 }).values.depth;
  const half = (id) => modReading({ kind: id, rate: 1, depth: 0.5 }).values.depth;
  assert.ok(Math.abs(half('tremolo') / full('tremolo') - 0.50) < 0.02,
    `a tremolo at half reads ${(half('tremolo') / full('tremolo')).toFixed(3)} of its travel`);
  assert.ok(Math.abs(half('autopan') / full('autopan') - 0.54) < 0.02,
    `an auto-pan at half reads ${(half('autopan') / full('autopan')).toFixed(3)} of its travel`);

  // And the frames cost the top of the rate control some depth, which is the
  // averaging rather than the oscillator: measured at 0.73 of the real travel
  // at twelve hertz, against the 0.79 a sine averaged over three eighths of a
  // cycle predicts.
  const slow = modReading({ kind: 'chorus', rate: 0.55, depth: 1 }).values.depth;
  const fast = modReading({ kind: 'chorus', rate: 12, depth: 1 }).values.depth;
  assert.ok(fast / slow > 0.7 && fast / slow < 0.8, `twelve hertz reads ${(fast / slow).toFixed(2)}`);
});

/* --- comparing two of them ------------------------------------------------ */

test('two modulations of different families cannot be compared at all', () => {
  const chorus = modReading({ kind: 'chorus', rate: 1, depth: 0.5 });
  const flanger = modReading({ kind: 'flanger', rate: 1, depth: 0.5 });
  const tremolo = modReading({ kind: 'tremolo', rate: 1, depth: 0.5 });

  // Same family, same quantity: a chorus and a flanger are both a read head
  // moving, as a fraction of its own travel, so the question has an answer.
  assert.equal(comparable(chorus, flanger), null);
  assert.ok(distance(chorus, flanger).off >= 0);

  // Different family, different quantity, and refused rather than averaged.
  assert.ok(comparable(chorus, tremolo), 'a time and a gain are not the same measurement');
  assert.throws(() => distance(chorus, tremolo), /cannot be compared/);
});

test('the gap is nought for the same settings and linear in the depth', () => {
  const base = { kind: 'chorus', rate: rateFor(0.5), depth: 0.4, spread: 90 };
  const read = (extra = {}) => modReading({ ...base, ...extra });

  assert.equal(modGap(read(), read()).off, 0, 'the same modulation twice');

  // About 0.7 per hundredth of travel, all the way up - which is what makes
  // one tolerance mean the same thing at every depth.
  const per = [0.02, 0.05, 0.1, 0.2].map((d) => modGap(read({ depth: 0.4 + d }), read()).off / (d * 100));
  for (const slope of per) {
    assert.ok(Math.abs(slope - 0.7) < 0.05, `the slope came out ${slope.toFixed(3)} per cent`);
  }

  // And the feedback is invisible, exactly, which is why no round asks for it.
  assert.equal(modGap(read({ kind: 'flanger', feedback: 0.9 }),
    read({ kind: 'flanger', feedback: -0.9 })).off, 0);
});

test('the gap names which of the three it mostly was', () => {
  const base = { kind: 'chorus', rate: rateFor(0.5), depth: 0.4, spread: 90 };
  const read = (extra = {}) => modReading({ ...base, ...extra });

  assert.equal(modGap(read({ depth: 0.5 }), read()).where, 'the depth');
  assert.equal(modGap(read({ rate: rateFor(0.5) * 1.2 }), read()).where, 'the rate');
  assert.equal(modGap(read({ spread: 0 }), read()).where, 'the two sides');
  assert.equal(modGap(read(), read()).where, null, 'and nothing at all when they agree');

  // Which way to turn it, which is what the feedback on the face says.
  assert.equal(modGap(read({ depth: 0.2 }), read()).detail.deeper, true);
  assert.equal(modGap(read({ depth: 0.6 }), read()).detail.deeper, false);
});

/* --- the audio thread ----------------------------------------------------- */

test('the worklet is built from the module, not from a copy of it', () => {
  const source = modSource();

  for (const name of ['modCore', 'modKind', 'apCoef', 'MOD_KINDS', 'MOD_LIMITS',
    'MOD_DEFAULTS', 'AP_STAGES', 'LINE_MS', 'MOVE_FLOOR']) {
    assert.ok(source.includes(name), `the audio thread needs ${name}`);
  }

  // Run the string the audio thread is given and hold it against the module,
  // sample for sample, through a setting change partway - a missing part
  // fails inside a blob on the audio thread where nothing can report it, and
  // what you get is a device that outputs silence and measures beautifully.
  const theirs = new Function(
    `${source.replace(/class HeadroomModulation[\s\S]*$/, '')}; return modCore;`,
  )();

  for (const id of MOD_IDS) {
    const settings = {
      ...MOD_DEFAULTS, kind: id, rate: 2.5, depth: 0.7, feedback: 0.6, spread: 90,
    };
    const mine = modCore(RATE).set(settings).reset();
    const yours = theirs(RATE).set(settings).reset();

    let worst = 0;
    for (let i = 0; i < 20000; i += 1) {
      if (i === 9000) {
        mine.set({ depth: 0.3, shape: 'triangle' });
        yours.set({ depth: 0.3, shape: 'triangle' });
      }
      const x = Math.sin((2 * Math.PI * 220 * i) / RATE) * (i % 4000 < 1000 ? 0.9 : 0.2);
      mine.stereo(x, x * 0.6);
      yours.stereo(x, x * 0.6);
      worst = Math.max(worst,
        Math.abs(mine.left - yours.left), Math.abs(mine.right - yours.right));
    }
    assert.equal(worst, 0, `${id}: what you hear has to be what you are marked on`);
  }
});

/* --- the rounds ----------------------------------------------------------- */

const roundsOf = (tier, exercise, n = 40) => {
  const settings = { exercise };
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const rng = mulberry32(0x3b0d + i * 7717);
    out.push({ tier, settings, ...modulation.makePuzzle(rng, tier, settings) });
  }
  return out;
};

test('every modulation a round asks for is one the controls can reach', () => {
  for (const tier of ['easy', 'medium', 'hard']) {
    for (const { answer } of roundsOf(tier, 'match')) {
      assert.ok(MOD_IDS.includes(answer.kind), `${tier} asked for ${answer.kind}`);
      // On a note value, because a path four seconds long can tell half a per
      // cent of rate from none - which is not a tolerance anybody could hit by
      // turning a knob, and is why these are a menu choice.
      const division = DIVISIONS.find((d) => d.id === answer.sync);
      assert.ok(division, `${tier} asked for a free rate: ${answer.sync}`);
      assert.ok(Math.abs(answer.rate - rateFor(division.beats)) < 1e-9,
        'the rate and the note value have to be the same fact');
      // On the depth knob's own hundredths, and never at either end.
      assert.ok(Math.abs(answer.depth * 100 - Math.round(answer.depth * 100)) < 1e-9,
        `${tier} asked for a depth of ${answer.depth}`);
      assert.ok(answer.depth >= 0.2 && answer.depth <= 0.8, `depth ${answer.depth}`);
      assert.ok(MOD_SPREADS.some((s) => s.id === answer.spread), `spread ${answer.spread}`);
      assert.equal(answer.shape, 'sine', 'the shape is not asked for');
    }
  }

  // Easy offers three effects wired to three different places; the other two
  // offer all six.
  const kinds = (tier) => new Set(roundsOf(tier, 'match').map((p) => p.answer.kind));
  assert.equal(kinds('easy').size, 3);
  assert.equal(new Set([...kinds('easy')].map((id) => modKind(id).family)).size, 3);
  assert.ok(kinds('medium').size >= 5);
});

test('a modulation standing still is never an answer', () => {
  for (const tier of ['easy', 'medium', 'hard']) {
    for (const puzzle of roundsOf(tier, 'match')) {
      const idle = { ...puzzle.answer, depth: 0 };
      const score = modulation.score(idle, puzzle);
      assert.ok(!score.correct, `${tier} accepted a still oscillator`);
      for (const cell of score.cells) {
        assert.equal(cell.state, 'miss',
          `${tier} read a still oscillator as ${cell.state} at ${score.error.toFixed(1)}% out`);
      }
    }
  }
});

test('the answer is accepted, and the wrong effect is refused without a number', () => {
  for (const tier of ['easy', 'medium', 'hard']) {
    for (const puzzle of roundsOf(tier, 'match', 12)) {
      assert.ok(modulation.score(puzzle.answer, puzzle).correct,
        `${tier} refused its own answer`);

      // A different kind is a different quantity, so it is said rather than
      // scored: the comparator would have to refuse the pair.
      const other = MOD_IDS.find((id) => id !== puzzle.answer.kind);
      const score = modulation.score({ ...puzzle.answer, kind: other }, puzzle);
      assert.ok(!score.correct);
      assert.equal(score.error, Infinity);
      assert.match(score.why[0].label, /different effect/);
    }
  }
});

test('the two drills ask about the two halves of reading a modulation', () => {
  for (const tier of ['easy', 'medium', 'hard']) {
    const kinds = modulation.slots(tier, { exercise: 'drill' })[0].options.map((o) => o.id);
    for (const puzzle of roundsOf(tier, 'drill', 20)) {
      assert.ok(kinds.includes(puzzle.answer.kind), 'the answer is one of the chips');
      // Every round is in time at a plain note value, so that nothing about
      // the rate says which effect it is.
      assert.ok([rateFor(1), rateFor(0.5)].some((hz) => Math.abs(puzzle.rate - hz) < 1e-9),
        `the drill ran at ${puzzle.rate} Hz`);
    }

    const divisions = modulation.slots(tier, { exercise: 'rate' })[0].options.map((o) => o.id);
    for (const puzzle of roundsOf(tier, 'rate', 20)) {
      assert.ok(divisions.includes(puzzle.answer.division), 'the answer is one of the chips');
      const settings = modulation.exercises.rate.startOf(puzzle);
      const division = DIVISIONS.find((d) => d.id === puzzle.answer.division);
      assert.ok(Math.abs(settings.rate - rateFor(division.beats)) < 1e-9,
        'the tool has to be set to the note value the chips are about');
      // Easy asks on a tremolo, where the level is the rate.
      if (tier === 'easy') assert.equal(puzzle.kind, 'tremolo');
    }
  }

  // The division list is the delay's own, not a second copy of it.
  const offered = modulation.slots('hard', { exercise: 'rate' })[0].options.map((o) => o.id);
  assert.deepEqual(offered, DIVISIONS.map((d) => d.id));
});
