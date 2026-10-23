import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STEREO_DEFAULTS, STEREO_BANDS, STEREO_FLOOR, WIDEST,
  imagerCore, runImager, widthOf, stereoOf, stereoDistance,
} from '../src/plugins/stereo/field.js';
import { imagerSource } from '../src/plugins/stereo/node.js';
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
