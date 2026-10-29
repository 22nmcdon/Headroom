import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STEREO_DEFAULTS, STEREO_BANDS, STEREO_FLOOR, WIDEST,
  imagerCore, runImager, widthOf, stereoOf, stereoDistance,
  stereoReading, coherenceReading,
} from '../src/plugins/stereo/field.js';
import {
  COHERENCE_WINDOW, COHERENCE_FLOOR, COHERENCE_MOVING,
} from '../src/plugins/stereo/coherence.js';
import { distance } from '../src/gap.js';
import { imagerSource } from '../src/plugins/stereo/node.js';
import {
  shuffleCore, MONO_SLOPES, MONO_RANGE, SHUFFLE_RANGE, SHUFFLE_AT, STEEP_STAGES,
} from '../src/plugins/stereo/shuffle.js';
import { makeBiquad, setBiquad, runBiquad } from '../src/lib/dsp.js';
import {
  widenCore, velvetTaps, WIDEN_KINDS, WIDEN_DELAY, WIDEN_AMOUNT,
} from '../src/plugins/stereo/widen.js';
import { pitchCore } from '../src/lib/pitch.js';
import { mulberry32 } from '../src/lib/random.js';
import { STEREO_WORK as panning } from '../src/learn/work/panning.js';
import { PAN_LAWS, panGains, panMatrix, panPair } from '../src/plugins/stereo/pan.js';
import { panDeck } from '../src/plugins/stereo/plugin.js';

const rate = 48000;

/** A stereo pair with a known relationship between the channels. */
function pair(seconds, make) {
  const length = Math.round(rate * seconds);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  const a = mulberry32(0x1234);
  const b = mulberry32(0x9876);
  for (let i = 0; i < length; i += 1) {
    const [l, r] = make(a() * 2 - 1, b() * 2 - 1, i);
    left[i] = l;
    right[i] = r;
  }
  return { left, right };
}

const sameBoth = (x) => [x, x];
const opposite = (x) => [x, -x];
const unrelated = (x, y) => [x, y];
/** Two channels that mostly agree - which is what a mix actually sounds like. */
const mostlyShared = (x, y) => [x + 0.5 * y, x - 0.5 * y];

/* --- what a fold to mono costs -------------------------------------------- */

test('summing two channels costs what it should, and nothing when it should not', () => {
  const cost = (make) => {
    const { left, right } = pair(1, make);
    return widthOf(left, right).mono;
  };

  assert.ok(Math.abs(cost(sameBoth)) < 0.01, 'identical channels lose nothing');
  assert.ok(Math.abs(cost(unrelated) + 3.01) < 0.2, 'unrelated channels lose three decibels');
  assert.ok(cost(opposite) < -50, 'opposite channels lose everything');

  // The one that was wrong first time, and mattered most: a sound panned hard
  // to one side has as much side as middle, and summing it loses nothing at
  // all, because there is nothing on the other side to cancel with.
  assert.ok(Math.abs(cost((x) => [x, 0])) < 0.01, 'a hard-panned signal loses nothing to mono');
});

test('width reads mono as nothing and opposite channels as everything', () => {
  const width = (make) => widthOf(pair(1, make).left, pair(1, make).right).width;
  assert.equal(width(sameBoth), STEREO_FLOOR);
  assert.ok(Math.abs(width(unrelated)) < 0.3, 'unrelated is as much side as middle');
  assert.ok(width(opposite) > 20, 'opposite is all side and no middle');
});

/* --- the control ---------------------------------------------------------- */

test('width does what the number on it says', () => {
  const { left, right } = pair(1.5, unrelated);
  const at = (w) => stereoOf(left, right, rate, { ...STEREO_DEFAULTS, low: w, mid: w, high: w }).whole;

  assert.equal(at(0).width, STEREO_FLOOR, 'no width at all is mono');
  assert.ok(Math.abs(at(0).mono) < 0.05, 'and mono then costs nothing');

  // Doubling the side is six decibels more of it, whatever it started at.
  const one = at(1).width;
  const two = at(2).width;
  assert.ok(Math.abs((two - one) - 6.02) < 0.4, `doubling should add 6 dB, and added ${(two - one).toFixed(2)}`);
  assert.ok(at(WIDEST).width > at(1).width, 'the widest setting is wider than none');
});

test('each band is worked on its own', () => {
  const { left, right } = pair(1.5, unrelated);
  const image = (settings) => stereoOf(left, right, rate, { ...STEREO_DEFAULTS, ...settings });

  const flat = image({});
  const lowsMono = image({ low: 0 });
  const topWide = image({ high: 2.4 });

  // The bands the low control owns move; the ones it does not, do not.
  assert.ok(lowsMono.bands.sub.width < flat.bands.sub.width - 10, 'the bottom should collapse');
  assert.ok(Math.abs(lowsMono.bands.high.width - flat.bands.high.width) < 0.5, 'and the top should not notice');

  assert.ok(topWide.bands.high.width > flat.bands.high.width + 5, 'the top should open up');
  assert.ok(Math.abs(topWide.bands.sub.width - flat.bands.sub.width) < 0.5, 'and the bottom should not notice');
});

test('an imager set to do nothing does nothing, wherever its corners are', () => {
  // The invariant the split was quietly breaking. Three bands cut apart and
  // added back are only the input again if they are added back in step - and
  // the low band had been through one crossover where the other two had been
  // through two, so it arrived with the wrong phase. The sum of a
  // Linkwitz-Riley pair is an all-pass, not a wire.
  //
  // It hid because it is small at the default corners and large when they
  // close up. Measured with every width at one, as the worst error across
  // eighteen frequencies from 40 Hz to 10 kHz:
  //
  //     corners           before      after
  //     250 / 4000 Hz    -0.04 dB    0.01 dB
  //     800 / 4000       -0.45       0.02
  //     250 / 1500       -0.31      -0.01
  //     800 / 1500       -4.09       0.02
  //
  // Four decibels out of the midrange from a tool asked to do nothing at all.
  const tone = (hz) => {
    const n = Math.round(rate * 0.4);
    const left = new Float32Array(n);
    const right = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      left[i] = Math.sin((2 * Math.PI * hz * i) / rate);
      right[i] = left[i];
    }
    return { left, right };
  };

  const level = (settings, hz) => {
    const { left, right } = tone(hz);
    const out = runImager(left, right, rate, { ...STEREO_DEFAULTS, ...settings });
    let into = 0;
    let outOf = 0;
    for (let i = Math.round(left.length / 2); i < left.length; i += 1) {
      into += left[i] * left[i];
      outOf += out.left[i] * out.left[i];
    }
    return 10 * Math.log10(outOf / into);
  };

  for (const corners of [{}, { lowMid: 800 }, { midHigh: 1500 },
    { lowMid: 800, midHigh: 1500 }]) {
    for (const hz of [40, 125, 400, 800, 1000, 1600, 4000, 10000]) {
      const off = level(corners, hz);
      assert.ok(Math.abs(off) < 0.1,
        `at ${JSON.stringify(corners)} a flat imager moved ${hz} Hz by ${off.toFixed(2)} dB`);
    }
  }

  // And the reading says the same thing: where the corners sit cannot matter
  // to a tool that is not doing anything. Before the fix the whole-band width
  // read -9.14 dB at the default corners and -8.91 at their closest; now both
  // read -9.15.
  const bed = pair(1.5, (a, b) => [a * 0.6 + b * 0.2, a * 0.6 - b * 0.2]);
  const flatDefault = stereoOf(bed.left, bed.right, rate, { ...STEREO_DEFAULTS });
  const flatClosest = stereoOf(bed.left, bed.right, rate,
    { ...STEREO_DEFAULTS, lowMid: 800, midHigh: 1500 });
  assert.ok(Math.abs(flatDefault.whole.width - flatClosest.whole.width) < 0.05,
    `a flat imager read ${flatDefault.whole.width.toFixed(2)} dB wide at one pair of corners `
    + `and ${flatClosest.whole.width.toFixed(2)} at another`);
});

test('the crossovers decide which band a control owns', () => {
  const { left, right } = pair(1.5, unrelated);
  const lowOnly = (lowMid) => stereoOf(left, right, rate, { ...STEREO_DEFAULTS, low: 0, lowMid });

  // With the corner up at 800 the low control reaches the 400 Hz band; down
  // at 80 it does not.
  const high = lowOnly(800).bands.lowmid.width;
  const low = lowOnly(80).bands.lowmid.width;
  assert.ok(high < low - 8, `moving the corner should hand that band over: ${low.toFixed(1)} against ${high.toFixed(1)}`);
});

test('pan moves the field and closes one side at the end of it', () => {
  const { left, right } = pair(1, unrelated);
  const balance = (pan) => stereoOf(left, right, rate, { ...STEREO_DEFAULTS, pan }).whole.balance;

  assert.ok(Math.abs(balance(0)) < 0.3, 'centred is centred');
  assert.ok(balance(-0.5) > 4, 'left of centre leans left');
  assert.ok(balance(0.5) < -4, 'and right of centre leans right');
  assert.ok(balance(1) < -40, 'hard right closes the left side');
  assert.ok(balance(-1) > 40, 'and hard left closes the right');
});

test('listening in mono or in side changes what you hear and not what you have done', () => {
  const { left, right } = pair(0.5, unrelated);
  const heard = (listen) => runImager(left, right, rate, { ...STEREO_DEFAULTS, listen });

  const mono = heard('mono');
  for (let i = 0; i < mono.left.length; i += 40) {
    assert.ok(Math.abs(mono.left[i] - mono.right[i]) < 1e-6, 'mono is the same in both ears');
  }

  const side = heard('side');
  assert.ok(widthOf(side.left, side.right).width === STEREO_FLOOR, 'so is the side, once it is soloed');

  // And neither of them is what a guess is read on: the reading always takes
  // the stereo output, whatever is being monitored.
  const marked = stereoOf(left, right, rate, { ...STEREO_DEFAULTS, listen: 'mono' });
  const straight = stereoOf(left, right, rate, STEREO_DEFAULTS);
  assert.ok(Math.abs(marked.whole.width - straight.whole.width) < 0.01);
});

/* --- the same imager everywhere ------------------------------------------- */

test('the worklet is built from the imager, not a copy of it', () => {
  const source = imagerSource();
  for (const name of ['imagerCore', 'makeBiquad', 'setBiquad', 'runBiquad']) {
    assert.ok(source.includes(name), `the audio thread needs ${name}`);
  }

  const theirs = new Function(`${source.replace(/class HeadroomImager[\s\S]*$/, '')}; return imagerCore;`)();
  const a = theirs(rate);
  const b = imagerCore(rate);
  const settings = { low: 0.3, mid: 1.6, high: 2.2, lowMid: 180, midHigh: 5200, pan: -0.3 };
  a.set(settings);
  b.set(settings);

  let worst = 0;
  const { left, right } = pair(0.4, unrelated);
  for (let i = 0; i < left.length; i += 1) {
    a.step(left[i], right[i]);
    b.step(left[i], right[i]);
    worst = Math.max(worst, Math.abs(a.outL - b.outL), Math.abs(a.outR - b.outR));
  }
  assert.equal(worst, 0, 'what you hear has to be what you are marked on');
});

/* --- the mode ------------------------------------------------------------- */

test('matching an image is marked on the worst band, not the average of them', () => {
  const { left, right } = pair(1.2, unrelated);
  const material = { left, right, rate };
  const answer = { ...STEREO_DEFAULTS, low: 0.3 };
  const puzzle = { settings: { exercise: 'match' }, answer, material };

  assert.ok(panning.score(answer, { ...puzzle, tier: 'hard' }).correct, 'its own answer passes');

  // One band in completely the wrong place is a wrong answer, however right
  // the other five are - which is the whole reason for reading the worst.
  const off = panning.score({ ...STEREO_DEFAULTS }, { ...puzzle, tier: 'easy' });
  assert.ok(!off.correct);
  // And it says which band, because that is the band it was read on.
  assert.match(off.cells[1].text, /^too wide at \d/);
});

test('rescuing the low end wants it narrowed, and nothing else thrown away', () => {
  // Channels that mostly agree, as a mix does: a pair that agreed about
  // nothing could never be made mono-safe by narrowing, only by monoing.
  const clean = pair(1.2, mostlyShared);
  const fault = { low: 2.3 };
  const broken = runImager(clean.left, clean.right, rate, { ...STEREO_DEFAULTS, ...fault });
  const material = { left: broken.left, right: broken.right, rate };
  const puzzle = { settings: { exercise: 'mono' }, fault, answer: null, material };
  const try_ = (settings) => panning.score({ ...STEREO_DEFAULTS, ...settings }, { ...puzzle, tier: 'medium' });

  assert.ok(!try_({}).correct, 'leaving it alone is not a fix');
  assert.match(try_({}).cells[0].text, /^mono costs /);

  // Narrowing it is, and there is a range of settings that do it rather than
  // one value to land on.
  const works = [0.5, 0.4, 0.3, 0.2, 0.1].filter((low) => try_({ low }).correct);
  assert.ok(works.length >= 2, `only ${works.length} settings rescued it`);
  assert.match(try_({ low: works[0] }).cells[0].text, /survives mono$/);

  // The two wrong answers that a single reading would have let through.
  const flattened = try_({ low: 0, mid: 0, high: 0 });
  assert.ok(!flattened.correct, 'monoing the record is not a fix');
  assert.match(flattened.cells[1].text, /of the top gone too$/);

  const shoved = try_({ low: 0.4, pan: 0.9 });
  assert.ok(!shoved.correct, 'nor is throwing it all to one side');
  assert.match(shoved.cells[1].text, /one side now$/);
});

test('placing is read off the audio, on both sides', () => {
  const { left, right } = pair(1, unrelated);
  const material = { left, right, rate };
  const answer = { ...STEREO_DEFAULTS, pan: -0.5 };
  const puzzle = { settings: { exercise: 'place' }, answer, material };

  assert.ok(panning.score(answer, { ...puzzle, tier: 'hard' }).correct);
  assert.match(panning.score(answer, { ...puzzle, tier: 'hard' }).cells[1].text, /where it is$/);

  const wrongSide = panning.score({ ...STEREO_DEFAULTS, pan: 0.5 }, { ...puzzle, tier: 'easy' });
  assert.ok(!wrongSide.correct);
  assert.match(wrongSide.cells[1].text, /too far right$/);
});

/* --- width that is not the same at every frequency ------------------------ */

/** How much side survives at one frequency, in dB, through the real core. */
function sideAt(settings, hz) {
  const n = Math.round(rate * 0.5);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    // Opposite polarity, so the pair is all side and no middle: what comes
    // out is exactly what the filter did.
    left[i] = Math.sin((2 * Math.PI * hz * i) / rate);
    right[i] = -left[i];
  }
  const out = runImager(left, right, rate, { ...STEREO_DEFAULTS, ...settings });
  let into = 0;
  let outOf = 0;
  for (let i = Math.round(n / 2); i < n; i += 1) {
    into += left[i] * left[i];
    outOf += out.left[i] * out.left[i];
  }
  return 10 * Math.log10((outOf + 1e-30) / (into + 1e-30));
}

test('the side can be taken out from under a corner, at two slopes', () => {
  // Measured with the corner at 150 Hz, as how much side is left. The gap
  // between the two rows is the thing to be able to hear:
  //
  //        Hz      40     60     75    100    150    200    300
  //     6 dB/oct  -11.9   -8.7   -7.1   -5.2   -3.1   -2.0   -1.1
  //    24 dB/oct  -46.0  -32.1  -24.6  -15.7   -6.0   -2.4   -0.5
  //
  // So "mono below 150" at six decibels an octave leaves seven decibels of
  // side at 75 Hz, which is not mono - and that is the classic cut, not a
  // fault in it.
  const flat = sideAt({}, 75);
  const gentle = sideAt({ monoBelow: 150, monoSlope: 'gentle' }, 75);
  const steep = sideAt({ monoBelow: 150, monoSlope: 'steep' }, 75);

  assert.ok(gentle < flat - 3, `the gentle slope only took ${(flat - gentle).toFixed(1)} dB off at 75 Hz`);
  assert.ok(steep < gentle - 12,
    `the steep slope should be far below the gentle one at 75 Hz: ${steep.toFixed(1)} against ${gentle.toFixed(1)}`);

  // At the corner itself the two are a Butterworth and a Linkwitz-Riley: three
  // decibels down and six. That is what makes them one pole and two biquads.
  assert.ok(Math.abs(sideAt({ monoBelow: 150 }, 150) - flat + 3) < 0.6,
    'one pole should be three decibels down at its own corner');
  assert.ok(Math.abs(sideAt({ monoBelow: 150, monoSlope: 'steep' }, 150) - flat + 6) < 0.6,
    'a Linkwitz-Riley pair should be six decibels down at its own corner');

  // And the labelling, which was wrong first time: four biquads at this Q is
  // eighth order and reads twelve decibels down at the corner, not six.
  assert.equal(STEEP_STAGES, 2, 'twenty-four decibels an octave is two biquads, not four');

  // Above the corner it does nothing, so a width control up there still owns
  // what it owns.
  assert.ok(Math.abs(sideAt({ monoBelow: 150, monoSlope: 'steep' }, 2000) - flat) < 0.2,
    'the mono-maker reached above its own corner');
});

test('taking the side away cannot change what mono hears', () => {
  // The claim that makes this control safe, and it is structural rather than
  // lucky: mono is the middle, and both of these filters are on the side. So
  // there is no setting of either that a mono listener can detect at all -
  // which is the whole reason somebody reaches for the first of them.
  const bed = pair(1, (a, b) => [a * 0.5 + b * 0.3, a * 0.5 - b * 0.3]);
  const flat = runImager(bed.left, bed.right, rate, { ...STEREO_DEFAULTS });

  for (const over of [
    { monoBelow: 150 }, { monoBelow: 500, monoSlope: 'steep' },
    { shuffle: 8 }, { monoBelow: 150, shuffle: 4 },
  ]) {
    const got = runImager(bed.left, bed.right, rate, { ...STEREO_DEFAULTS, ...over });
    let worst = 0;
    for (let i = 0; i < bed.left.length; i += 1) {
      const was = (flat.left[i] + flat.right[i]) * 0.5;
      const now = (got.left[i] + got.right[i]) * 0.5;
      worst = Math.max(worst, Math.abs(now - was));
    }
    assert.ok(worst < 1e-6,
      `${JSON.stringify(over)} moved the mono sum by ${worst.toExponential(2)}`);
  }
});

test('the bass width knob lifts the side where the mono-maker takes it away', () => {
  // The two pull in opposite directions in the same part of the spectrum,
  // which is the argument about low-frequency width rather than a mistake.
  // Measured, how much side is left at 100 Hz against flat:
  //
  //     mono below 150, gentle    -5.2 dB
  //     bass width +4             +4.0
  //     bass width +8             +8.0
  const flat = sideAt({}, 100);
  assert.ok(sideAt({ shuffle: 4 }, 100) - flat > 3.5, 'four decibels of lift did not arrive');
  assert.ok(sideAt({ shuffle: 8 }, 100) - flat > 7.5, 'eight decibels of lift did not arrive');

  // It is a shelf, so it is half its gain at its own corner and gone above it.
  const atCorner = sideAt({ shuffle: 8 }, SHUFFLE_AT) - flat;
  assert.ok(Math.abs(atCorner - 4) < 0.6,
    `an eight-decibel shelf read ${atCorner.toFixed(1)} dB at its corner rather than four`);
  assert.ok(Math.abs(sideAt({ shuffle: 8 }, 6000) - flat) < 0.3, 'the shelf reached the top');

  // And the two together are not the same as either alone.
  const both = sideAt({ monoBelow: 150, shuffle: 8 }, 100);
  assert.ok(both > sideAt({ monoBelow: 150 }, 100) && both < sideAt({ shuffle: 8 }, 100),
    'the lift and the cut should fight rather than one of them winning outright');
});

test('the side filters sit out of the way when nothing is asked of them', () => {
  // `resting` is what lets the core skip them entirely, so it has to be right
  // about when they are doing nothing - a filter that is bypassed when it
  // should be running is silent, and one that runs when it should be bypassed
  // costs every sample.
  const core = shuffleCore(rate, makeBiquad, setBiquad, runBiquad);
  assert.equal(core.resting, true, 'a shuffler at rest should say so');
  assert.equal(core.set({ monoBelow: 150 }).resting, false);
  assert.equal(core.set({ monoBelow: 0 }).resting, true);
  assert.equal(core.set({ shuffle: 3 }).resting, false);
  assert.equal(core.set({ shuffle: 0 }).resting, true);

  // And at rest it passes both through untouched, which is what makes
  // skipping it the same as running it.
  for (const [m, s] of [[0.4, -0.2], [-0.9, 0.7], [0, 0.1]]) {
    core.step(m, s);
    assert.equal(core.mid, m);
    assert.equal(core.side, s);
  }

  // Every slope on offer is one somebody can be asked about.
  assert.ok(MONO_SLOPES.length >= 2, 'one slope is not a question');
  assert.ok(MONO_RANGE[0] < MONO_RANGE[1] && SHUFFLE_RANGE[0] === 0,
    'the ranges should start where the control is off');
});

/* --- making side out of middle -------------------------------------------- */

/** A mono source with something in every band, which is what has no side. */
function monoSource(seconds = 2) {
  const n = Math.round(rate * seconds);
  const x = new Float32Array(n);
  const noise = mulberry32(0x5151);
  let lp = 0;
  for (let i = 0; i < n; i += 1) {
    const at = i / rate;
    lp += ((noise() * 2 - 1) - lp) * 0.08;
    x[i] = (Math.sin(2 * Math.PI * 180 * at) * 0.4
      + Math.sin(2 * Math.PI * 700 * at) * 0.25
      + Math.sin(2 * Math.PI * 2600 * at) * 0.15 + lp * 0.8) * 0.35;
  }
  return x;
}

/** Side against middle, in dB, over the second half of a pair. */
function widthOfPair(L, R) {
  let em = 0;
  let es = 0;
  for (let i = Math.round(L.length / 2); i < L.length; i += 1) {
    const m = (L[i] + R[i]) * 0.5;
    const sd = (L[i] - R[i]) * 0.5;
    em += m * m;
    es += sd * sd;
  }
  return 10 * Math.log10((es + 1e-30) / (em + 1e-30));
}

test('no amount of width makes a mono source wide, and that is why this exists', () => {
  // The gap the whole block closes. Every control in field.js is a ratio on
  // side that is already there, and two and a half times nothing is nothing.
  // Measured on a mono source: the three band widths at their maximum produce
  // -333 dB of side, which is the floating-point floor, and the widener
  // produces -1.9.
  const x = monoSource();
  const L = Float32Array.from(x);
  const R = Float32Array.from(x);

  const widest = runImager(L, R, rate, {
    ...STEREO_DEFAULTS, low: WIDEST, mid: WIDEST, high: WIDEST,
  });
  assert.ok(widthOfPair(widest.left, widest.right) < -100,
    'a width control found side in a mono source, which it cannot have');

  const made = runImager(L, R, rate, {
    ...STEREO_DEFAULTS, widen: 'comb', widenAmount: 0.8,
  });
  assert.ok(widthOfPair(made.left, made.right) > -6,
    `the widener only managed ${widthOfPair(made.left, made.right).toFixed(1)} dB of side`);
});

test('the kinds differ in where they put the damage', () => {
  // Measured at an amount of 0.8 and a delay of 12 ms, as how uneven the
  // spectrum is - the standard deviation in dB at a twelfth of an octave,
  // which resolves a comb's teeth rather than averaging them away - of the
  // mono sum and of the worse of the two channels, each against the input:
  //
  //     kind           mono   one side    coherence
  //     Haas           2.85     6.01      0.84-1.00
  //     comb           0.00     6.01      0.53-0.99
  //     all-pass       0.00     5.99      1.00
  //     decorrelator   0.00     4.13      0.99-1.00
  //     micro-pitch    5.86     6.45      0.19-0.73
  //
  // The mono column is the one that matters most and the one no width meter
  // can see: sending the delayed copy to one side leaves nearly three
  // decibels of comb in the sum, and putting it in the side leaves exactly
  // none, because L = M + D and R = M - D add back to M whatever D is.
  const x = monoSource(3);
  const uneven = (buf, against) => {
    const binOf = (b, hz) => {
      const w = (2 * Math.PI * hz) / rate;
      const c = 2 * Math.cos(w);
      let s1 = 0;
      let s2 = 0;
      for (let i = 0; i < b.length; i += 1) {
        const s0 = b[i] + c * s1 - s2;
        s2 = s1;
        s1 = s0;
      }
      return s1 * s1 + s2 * s2 - c * s1 * s2;
    };
    const got = [];
    for (let k = 0; k < 72; k += 1) {
      const hz = 100 * 2 ** (k / 12);
      if (hz > 8000) break;
      got.push(10 * Math.log10((binOf(buf, hz) + 1e-20) / (binOf(against, hz) + 1e-20)));
    }
    const mean = got.reduce((a, b) => a + b, 0) / got.length;
    let v = 0;
    for (const g of got) v += (g - mean) ** 2;
    return Math.sqrt(v / got.length);
  };

  // Against the imager's own output with the widener off, rather than against
  // the raw input. The crossover's all-passes shift the output's phase
  // without changing its level, and a Goertzel over a window holding a
  // non-integer number of cycles reads a phase-shifted signal slightly
  // differently at the edges - which showed up as 1.14 dB of "comb" from a
  // kind whose two additions are exact negatives. Measured directly, the mono
  // sum deviates from the input by the same 4.543e-1 at the same sample with
  // the widener on and off, so the widener really does add nothing to mono
  // and the 1.14 was the estimator.
  const summedOf = (over) => {
    const out = runImager(Float32Array.from(x), Float32Array.from(x), rate,
      { ...STEREO_DEFAULTS, ...over });
    const summed = new Float32Array(x.length);
    for (let i = 0; i < x.length; i += 1) summed[i] = (out.left[i] + out.right[i]) * 0.5;
    return summed;
  };
  const bare = summedOf({});
  const monoNotch = (kind) => uneven(
    summedOf({ widen: kind, widenAmount: 0.8, widenDelay: 12 }), bare,
  );

  // The three complementary kinds fold back to the input exactly. Not nearly:
  // the arithmetic is M + D and M - D, so the sum is 2M whatever D is.
  for (const kind of ['comb', 'allpass', 'velvet']) {
    assert.ok(monoNotch(kind) < 0.05,
      `${kind} left ${monoNotch(kind).toFixed(2)} dB of comb in the mono sum`);
  }

  // And the one that sends its copy to one side does not.
  assert.ok(monoNotch('haas') > 1.5,
    `Haas left only ${monoNotch('haas').toFixed(2)} dB of comb in mono, which is its whole signature`);
});

test('every kind is a real option and off really is off', () => {
  const x = monoSource(1);
  const flat = runImager(Float32Array.from(x), Float32Array.from(x), rate, { ...STEREO_DEFAULTS });

  // Off adds nothing at all, whatever the other widener knobs are set to -
  // which is what lets the core skip the whole block.
  const off = runImager(Float32Array.from(x), Float32Array.from(x), rate,
    { ...STEREO_DEFAULTS, widen: 'off', widenAmount: 1, widenDelay: 40, widenCents: 25 });
  for (let i = 0; i < x.length; i += 1) {
    assert.equal(off.left[i], flat.left[i]);
    assert.equal(off.right[i], flat.right[i]);
  }

  // And an amount of zero is off whichever kind is chosen, so the picker can
  // be moved without the sound changing until the knob comes up.
  for (const kind of WIDEN_KINDS) {
    const quiet = runImager(Float32Array.from(x), Float32Array.from(x), rate,
      { ...STEREO_DEFAULTS, widen: kind.id, widenAmount: 0 });
    let worst = 0;
    for (let i = 0; i < x.length; i += 1) worst = Math.max(worst, Math.abs(quiet.left[i] - flat.left[i]));
    assert.equal(worst, 0, `${kind.id} at zero amount was not silent`);
  }

  // Every kind but off actually produces side.
  for (const kind of WIDEN_KINDS) {
    if (kind.id === 'off') continue;
    const out = runImager(Float32Array.from(x), Float32Array.from(x), rate,
      { ...STEREO_DEFAULTS, widen: kind.id, widenAmount: 0.8 });
    assert.ok(widthOfPair(out.left, out.right) > -20,
      `${kind.id} made ${widthOfPair(out.left, out.right).toFixed(1)} dB of side, which is none`);
  }
});

test('the velvet response is the same response every time', () => {
  // A widener that is a different filter each time the tool opens is a
  // widener nobody can be asked to identify, and a daily that is a different
  // sound on two machines is not a daily. So the sparse response comes from a
  // counter rather than from Math.random.
  const a = velvetTaps(rate);
  const b = velvetTaps(rate);
  assert.deepEqual([...a.at], [...b.at]);
  assert.deepEqual([...a.sign], [...b.sign]);

  // And it passes as much energy as it is given, so the amount knob means the
  // same thing across the kinds.
  let energy = 0;
  for (const s of a.sign) energy += s * s;
  assert.ok(Math.abs(energy - 1) < 1e-6,
    `the velvet response has ${energy.toFixed(4)} of energy rather than one`);
});

test('the widener sits out of the way when it is not wanted', () => {
  const core = widenCore(rate, makeBiquad, setBiquad, runBiquad, pitchCore);
  assert.equal(core.resting, true);
  assert.equal(core.set({ widen: 'comb' }).resting, true, 'a kind with no amount is still resting');
  assert.equal(core.set({ widenAmount: 0.5 }).resting, false);
  assert.equal(core.set({ widen: 'off' }).resting, true);

  // A kind nobody has heard of falls back to off rather than throwing on the
  // audio thread.
  assert.equal(core.set({ widen: 'nonsense', widenAmount: 1 }).resting, true);

  // The delay range stays inside where precedence holds: below about two and
  // a half milliseconds a delay stops being a position and becomes a tone,
  // and past about fifty it comes apart into an echo.
  assert.ok(WIDEN_DELAY[0] >= 1 && WIDEN_DELAY[1] <= 50,
    'the widen delay reaches outside where the effect is an effect');
  assert.equal(WIDEN_AMOUNT[0], 0, 'the amount knob should start at off');
});

/* --- where the width came from -------------------------------------------- */

test('coherence tells a widener that moves from four that do not', () => {
  // The one question none of the other readings can answer. A Haas delay, a
  // complementary comb, a velvet-noise decorrelator and two microphones two
  // metres apart can read the same width, the same correlation and the same
  // fold-down loss - and three of them are one signal filtered twice.
  //
  // Measured through the reading, per band, at an amount of 0.8:
  //
  //     kind      sub    low   lowmid   mid   himid   high    gap from off
  //     off      1.000  1.000  1.000   1.000  1.000  1.000       0.000
  //     Haas     0.984  1.000  0.996   0.993  0.990  0.992       0.016
  //     comb     0.963  0.999  0.993   0.982  0.959  0.969       0.041
  //     all-pass 0.916  1.000  1.000   1.000  1.000  1.000       0.084
  //     velvet   0.992  1.000  0.999   0.997  0.988  0.988       0.012
  //     micro    0.531  0.575  0.513   0.624  0.575  0.645       0.487
  //
  // Every static kind stays above 0.91 and the only one that moves reads
  // about 0.57 - six times further from "off" than the worst of the others.
  // So this reading does not separate artificial width from natural; it
  // separates a filter that stands still from one that does not, which is a
  // narrower claim and the one the arithmetic supports.
  const read = (over) => coherenceReading(rate, { ...STEREO_DEFAULTS, ...over });
  const off = read({ widen: 'off' });

  const worst = (kind) => distance(read({ widen: kind, widenAmount: 0.8, widenDelay: 12 }), off).off;

  for (const kind of ['haas', 'comb', 'allpass', 'velvet']) {
    assert.ok(worst(kind) < 0.2,
      `${kind} read ${worst(kind).toFixed(3)} from off, and a static filter is coherent`);
  }
  assert.ok(worst('micro') > 0.3,
    `micro-pitch read only ${worst('micro').toFixed(3)} from off, and it is the one that moves`);
  assert.ok(worst('micro') > 4 * Math.max(...['haas', 'comb', 'allpass', 'velvet'].map(worst)),
    'the kind that moves should be far clear of the ones that do not');
});

test('an imager doing nothing is perfectly coherent', () => {
  // The floor at the other end: two channels that are the same signal read
  // exactly one, so any reading below one is something the tool did.
  const flat = coherenceReading(rate, { ...STEREO_DEFAULTS });
  for (const [id, got] of Object.entries(flat.values.bands)) {
    assert.ok(got > 0.999, `the ${id} band read ${got.toFixed(4)} through an imager at rest`);
  }

  // And there are enough windows in the probe for the estimate to mean
  // something. With F frames the floor for unrelated signals is about 1/F, so
  // a handful of frames would read two unrelated noises as nearly identical -
  // measured at a window of 16384, two unrelated noises read 0.0304 over
  // thirty-four frames and 0.5790 when the noise came from a linear
  // congruential generator, which is a story in coherence.js.
  assert.ok(flat.values.frames >= 30,
    `only ${flat.values.frames} windows fit the probe, which is not enough to settle`);
  assert.ok(COHERENCE_FLOOR < 0.1, 'the floor should be well clear of anything worth reading');
});

test('a coherence reading is not an image reading', () => {
  // Two readings of the same tool, on the same material, measuring different
  // things - so the envelope has to refuse to average them into one number.
  const bed = pair(1, (a, b) => [a * 0.5 + b * 0.3, a * 0.5 - b * 0.3]);
  const image = stereoReading(bed.left, bed.right, rate, { ...STEREO_DEFAULTS });
  const where = coherenceReading(rate, { ...STEREO_DEFAULTS });
  assert.throws(() => distance(image, where), /compare/,
    'an image reading against a coherence reading should be refused');
});

test('the coherence window is long against the longest delay on offer', () => {
  // The trap this constant sits between. Too short and a delay reads as
  // decorrelated, because the two channels' windows hold different material;
  // too few frames and everything reads coherent, because the floor is about
  // one over the frame count. Measured over six seconds, 300 Hz to 5 kHz:
  //
  //     window    ms   frames    1 ms   12 ms   40 ms   unrelated
  //       2048    43     280    0.993   0.349   0.004     0.0040
  //       4096    85     139    0.998   0.772   0.052     0.0077
  //       8192   171      69    1.000   0.938   0.489     0.0152
  //      16384   341      34    1.000   0.984   0.839     0.0304
  //
  // At 8192 the longest delay the widener offers reads 0.489, which is
  // indistinguishable from half decorrelated and is exactly the wrong answer -
  // that delay is a filter, and a filter is coherent.
  const longest = (WIDEN_DELAY[1] / 1000) * rate;
  assert.ok(COHERENCE_WINDOW > longest * 8,
    `a window of ${COHERENCE_WINDOW} is not long against a delay of ${Math.round(longest)} samples`);

  // And the longest delay really does still read as the filter it is - but
  // only just, which is the thing to know. Swept across the controls rather
  // than measured at one setting:
  //
  //     delay      Haas    comb   all-pass   velvet
  //      1 ms     0.000   0.001    0.084     0.012
  //     12 ms     0.016   0.041    0.084     0.012
  //     40 ms     0.081   0.327    0.084     0.012
  //
  // against micro-pitch at 0.487 to 0.635 across its own range. Every static
  // kind under 0.33, the moving one over 0.48, and COHERENCE_MOVING is the
  // only number between them. The margin is twelve times at twelve
  // milliseconds and one and a half times at forty.
  const off = coherenceReading(rate, { ...STEREO_DEFAULTS, widen: 'off' });
  const far = coherenceReading(rate,
    { ...STEREO_DEFAULTS, widen: 'comb', widenAmount: 0.8, widenDelay: WIDEN_DELAY[1] });
  assert.ok(distance(far, off).off < COHERENCE_MOVING,
    `a ${WIDEN_DELAY[1]} ms comb read ${distance(far, off).off.toFixed(3)} from off, `
    + `which is past the ${COHERENCE_MOVING} that is supposed to mean "it moves"`);

  // And the moving one is on the other side of that line at both ends of its
  // own range, which is the half that would break first if the probe changed.
  for (const cents of [2, 25]) {
    const moving = coherenceReading(rate,
      { ...STEREO_DEFAULTS, widen: 'micro', widenAmount: 0.8, widenCents: cents });
    assert.ok(distance(moving, off).off > COHERENCE_MOVING,
      `micro-pitch at ${cents} cents read ${distance(moving, off).off.toFixed(3)}, `
      + 'which is on the filter side of the line');
  }
});

/* --- placing, and the two things that word means ------------------------- */

/** How loud a pair is once it is folded to mono, in dB. */
function monoLevel(L, R) {
  let sum = 0;
  for (let i = Math.round(L.length / 4); i < L.length; i += 1) {
    const m = (L[i] + R[i]) * 0.5;
    sum += m * m;
  }
  return 10 * Math.log10(sum / (L.length - Math.round(L.length / 4)) + 1e-30);
}

test('each pan law costs at the centre what its name says', () => {
  for (const law of PAN_LAWS) {
    const centre = panGains(law.id, 0);
    const hard = panGains(law.id, 1);
    const cost = 20 * Math.log10(centre.right / hard.right);
    const said = Number(law.label.replace('−', '-').replace(' dB', ''));
    assert.ok(Math.abs(cost - said) < 0.05,
      `the ${law.id} law is called ${law.label} and measures ${cost.toFixed(2)}`);
  }

  // Measured: -3.01, -4.52 and -6.02, which is where the labels come from.
  assert.ok(Math.abs(20 * Math.log10(panGains('power', 0).left) + 3.01) < 0.01);
  assert.ok(Math.abs(20 * Math.log10(panGains('split', 0).left) + 4.52) < 0.01);
  assert.ok(Math.abs(20 * Math.log10(panGains('linear', 0).left) + 6.02) < 0.01);
});

test('the law is the difference between a centred part and a side one in mono', () => {
  // The whole reason the choice is on the face. A part placed centre and the
  // same part placed hard left do not come out level when the two are summed,
  // and how far apart they are is exactly the law. Measured as the mono
  // level of a mono source placed each way, through the imager:
  //
  //     law        centre - hard left
  //     -3 dB            3.01 dB
  //     -4.5 dB          1.51
  //     -6 dB            0.00
  //
  // So under -6 a pan move costs nothing in mono and under -3 it costs three
  // decibels, which is the thing a mix engineer gets bitten by.
  const x = monoSource(1);
  const place = (panLaw, at) => {
    const out = runImager(x, x, rate,
      { ...STEREO_DEFAULTS, panMode: 'dual', panLaw, panL: at, panR: at });
    return monoLevel(out.left, out.right);
  };

  const said = { power: 3.01, split: 1.51, linear: 0.00 };
  for (const [law, expected] of Object.entries(said)) {
    const off = place(law, 0) - place(law, -1);
    assert.ok(Math.abs(off - expected) < 0.05,
      `under ${law} a centred part should be ${expected} dB over a hard-panned one `
      + `in mono, and read ${off.toFixed(2)}`);
  }
});

test('dual pan can narrow a stereo source, which balance cannot', () => {
  // The operation balance does not have. Balance has one number, so the most
  // it can do to a wide source is fold one side into the other; it cannot
  // bring the two sides together without closing one of them. Dual pan can,
  // because it has a position for each.
  const { left, right } = pair(1, unrelated);

  const wide = widthOfPair(left, right);
  const narrowed = runImager(left, right, rate,
    { ...STEREO_DEFAULTS, panMode: 'dual', panL: -0.25, panR: 0.25 });
  const got = widthOfPair(narrowed.left, narrowed.right);
  assert.ok(got < wide - 5,
    `bringing the two sides in should narrow it: ${wide.toFixed(1)} to ${got.toFixed(1)}`);

  // And it is still a stereo signal rather than a fold to mono - the two
  // positions are still apart, so there is side left.
  assert.ok(got > STEREO_FLOOR + 10, `and not collapse it: ${got.toFixed(1)} dB`);

  // Both sides to the same place is the collapse, and that is dual pan's
  // other end rather than a bug. Measured, as width in dB: an unrelated pair
  // reads 0.03 untouched, -14.00 with the two positions a quarter of the way
  // in, and -339 with them on top of each other - which is mono to the last
  // bit the arithmetic has.
  const together = runImager(left, right, rate,
    { ...STEREO_DEFAULTS, panMode: 'dual', panL: 0, panR: 0 });
  assert.ok(widthOfPair(together.left, together.right) < -100,
    `both sides in one place is mono, and read ${widthOfPair(together.left, together.right).toFixed(1)}`);
});

test('switching to dual pan at its rest moves nothing', () => {
  // A mode that jumped when it was selected would be a mode nobody would
  // select twice. Dual pan rests with the left input hard left and the right
  // one hard right, which is the identity - measured, the matrix is exactly
  // {1, 0, 0, 1} under the -4.5 and -6 laws and 6.1e-17 off under -3, which
  // is cos(pi/2) in binary rather than an error.
  const { left, right } = pair(0.25, mostlyShared);
  const base = runImager(left, right, rate, STEREO_DEFAULTS);
  for (const law of PAN_LAWS) {
    const dual = runImager(left, right, rate,
      { ...STEREO_DEFAULTS, panMode: 'dual', panLaw: law.id });
    for (let i = 0; i < base.left.length; i += 1) {
      assert.ok(Math.abs(dual.left[i] - base.left[i]) < 1e-12, `${law.id} moved the left`);
      assert.ok(Math.abs(dual.right[i] - base.right[i]) < 1e-12, `${law.id} moved the right`);
    }
  }
});

test('the law has no say over balance, which is not placing anything', () => {
  // Balance is a crossfade between two channels that are already placed, so
  // the pan law has nothing to decide. The first version of the matrix had a
  // branch per mode that computed the same expression either way; this is the
  // test that would have caught it had it gone the other way, and it holds
  // the balance path to the sample against every law.
  const { left, right } = pair(0.25, mostlyShared);
  const base = runImager(left, right, rate, { ...STEREO_DEFAULTS, pan: -0.4 });

  for (const law of PAN_LAWS) {
    const same = runImager(left, right, rate,
      { ...STEREO_DEFAULTS, pan: -0.4, panLaw: law.id });
    for (let i = 0; i < base.left.length; i += 1) {
      assert.equal(same.left[i], base.left[i], `the ${law.id} law changed balance`);
      assert.equal(same.right[i], base.right[i], `the ${law.id} law changed balance`);
    }
  }
});

test('what balance costs at its extreme is six decibels, and where it is not', () => {
  // The number everybody quotes, and the two ways it goes wrong. At hard
  // right the output is L + R, so what the surviving channel gains over the
  // input it came from is 6.02 dB when the two channels are the same signal -
  // by peak and by energy alike. For unrelated channels the two measures part
  // company, and only the energy one is a property of the pan. Measured over
  // four seconds:
  //
  //     pair                           by peak    by energy
  //     correlated                      6.02 dB    6.02 dB
  //     unrelated, white noise          6.01       3.01
  //     unrelated, two sines            5.60       3.01
  //     unrelated, low-passed noise     3.41       3.00
  const hardRight = panMatrix('balance', 'power', { pan: 1 });
  const fold = (L, R) => {
    const out = new Float32Array(L.length);
    for (let i = 0; i < L.length; i += 1) out[i] = panPair(hardRight, L[i], R[i]).right;
    return out;
  };
  const peak = (x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const energy = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
  const over = (how, out, R) => 20 * Math.log10(how(out) / how(R));

  const both = pair(4, sameBoth);
  const folded = fold(both.left, both.right);
  for (const how of [peak, energy]) {
    assert.ok(Math.abs(over(how, folded, both.right) - 6.02) < 0.02,
      `correlated content should gain 6.02 dB, and read ${over(how, folded, both.right).toFixed(2)}`);
  }

  const apart = pair(4, unrelated);
  const mixed = fold(apart.left, apart.right);
  assert.ok(Math.abs(over(energy, mixed, apart.right) - 3.01) < 0.02,
    'unrelated content gains 3 dB by energy, whatever it is made of');

  // And the trap, which is not about correlation: balance folds the channel
  // being turned away into the one being kept, so the louder that channel,
  // the further past six decibels the survivor goes. Measured, 6.01, 9.53 and
  // 13.97 dB by peak as the left is made one, two and four times the right.
  const louder = (times) => {
    const L = Float32Array.from(apart.left, (v) => v * times);
    return over(peak, fold(L, apart.right), apart.right);
  };
  assert.ok(Math.abs(louder(1) - 6.01) < 0.05, `even levels read ${louder(1).toFixed(2)}`);
  assert.ok(Math.abs(louder(2) - 9.53) < 0.05, `twice as loud reads ${louder(2).toFixed(2)}`);
  assert.ok(Math.abs(louder(4) - 13.97) < 0.05, `four times reads ${louder(4).toFixed(2)}`);
});

test('a mode shows its own pan knobs and not the other mode\'s', () => {
  // A face that showed all three at once would be showing a control that
  // does nothing, which is the thing the reverb's spaces call a preset
  // wearing a plugin's face.
  const ids = (mode) => panDeck(mode).map((knob) => knob.id);

  assert.ok(ids('balance').includes('pan'), 'balance has its one number');
  assert.ok(!ids('balance').includes('panL'), 'and not the pair');
  assert.ok(ids('dual').includes('panL') && ids('dual').includes('panR'), 'dual has the pair');
  assert.ok(!ids('dual').includes('pan'), 'and not the one number');

  // Everything that is not a pan knob is on both.
  const common = ids('balance').filter((id) => !['pan', 'panL', 'panR'].includes(id));
  for (const id of common) assert.ok(ids('dual').includes(id), `${id} belongs to neither mode`);
});
