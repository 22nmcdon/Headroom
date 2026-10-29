import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STEREO_DEFAULTS, STEREO_BANDS, STEREO_FLOOR, WIDEST,
  imagerCore, runImager, widthOf, stereoOf, stereoDistance,
} from '../src/plugins/stereo/field.js';
import { imagerSource } from '../src/plugins/stereo/node.js';
import {
  shuffleCore, MONO_SLOPES, MONO_RANGE, SHUFFLE_RANGE, SHUFFLE_AT, STEEP_STAGES,
} from '../src/plugins/stereo/shuffle.js';
import { makeBiquad, setBiquad, runBiquad } from '../src/lib/dsp.js';
import { mulberry32 } from '../src/lib/random.js';
import { STEREO_WORK as panning } from '../src/learn/work/panning.js';

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
