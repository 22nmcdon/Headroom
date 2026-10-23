import test from 'node:test';
import assert from 'node:assert/strict';

import {
  staticGain, compressorCore, runCompressor, analyse, autoGain, signalRms, COMP_DEFAULTS,
} from '../src/plugins/compressor/dsp.js';
import { workletSource } from '../src/plugins/compressor/node.js';
import { COMP_WORK as compression } from '../src/learn/work/compression.js';
import { engraveNote } from '../src/lib/engrave.js';

const RATE = 48000;

/** A burst of a steady tone, for reading the timing knobs off. */
function burst(hz, amp, startMs, lengthMs, totalMs) {
  const samples = new Float32Array(Math.round((RATE * totalMs) / 1000));
  const from = Math.round((RATE * startMs) / 1000);
  const to = Math.round((RATE * (startMs + lengthMs)) / 1000);
  for (let i = from; i < Math.min(samples.length, to); i += 1) {
    samples[i] = amp * Math.sin((2 * Math.PI * hz * i) / RATE);
  }
  return samples;
}

const atMs = (signal, ms) => signal[Math.round((RATE * ms) / 1000)];

/* --- the curve ------------------------------------------------------------ */

test('the static curve leaves quiet signal alone and puts loud signal on the ratio line', () => {
  for (const input of [-60, -40, -21]) {
    assert.equal(staticGain(input, -20, 4, 0), 0, `${input} dB is under the threshold`);
  }

  for (const input of [-10, -5, 0]) {
    const out = input + staticGain(input, -20, 4, 0);
    const want = -20 + (input + 20) / 4;
    assert.ok(Math.abs(out - want) < 1e-9, `${input} dB in should come out at ${want}`);
  }
});

test('a knee bends between the two slopes instead of cornering', () => {
  const slopeAt = (db) => {
    const step = 0.01;
    const above = db + step + staticGain(db + step, -20, 4, 12);
    const below = db - step + staticGain(db - step, -20, 4, 12);
    return (above - below) / (2 * step);
  };

  assert.ok(Math.abs(slopeAt(-27) - 1) < 0.02, 'below the knee it is still 1:1');
  assert.ok(Math.abs(slopeAt(-13) - 0.25) < 0.02, 'above the knee it is on the ratio');
  // Halfway through, halfway between - which is what makes it a knee and not a
  // corner rounded off by eye.
  assert.ok(Math.abs(slopeAt(-20) - 0.625) < 0.02, 'the middle of the knee is the middle of the slopes');
});

/* --- the time it takes ---------------------------------------------------- */

test('the attack knob says how long it takes, and is telling the truth', () => {
  const signal = burst(5000, 10 ** (-6 / 20), 100, 400, 1600);

  for (const attack of [1, 5, 20, 50]) {
    const { gr } = runCompressor(signal, RATE, {
      ...COMP_DEFAULTS, threshold: -20, ratio: 4, knee: 0, attack, release: 400,
    });

    const settled = atMs(gr, 480);
    let reached = null;
    for (let i = Math.round(RATE * 0.1); i < gr.length; i += 1) {
      if (gr[i] <= settled * 0.63) { reached = (i / RATE) * 1000 - 100; break; }
    }

    // Within a tenth of what it says. The reduction covers 63% of the distance
    // in the time on the knob - the time-constant reading, stated in the DSP.
    assert.ok(Math.abs(reached - attack) <= attack * 0.1 + 0.2,
      `${attack} ms of attack took ${reached?.toFixed(1)} ms`);
  }
});

test('a settled compressor sits where the curve says it will', () => {
  const signal = burst(5000, 10 ** (-6 / 20), 100, 400, 1600);
  const { gr } = runCompressor(signal, RATE, {
    ...COMP_DEFAULTS, threshold: -20, ratio: 4, knee: 0, attack: 2, release: 400,
  });

  // 14 dB over the threshold at 4:1 is 10.5 dB of reduction. The display draws
  // the curve; if the sound did something else the display would be a lie.
  assert.ok(Math.abs(atMs(gr, 480) - -10.5) < 0.2, `settled at ${atMs(gr, 480).toFixed(2)} dB`);
});

/* --- what it is listening to ---------------------------------------------- */

test('an RMS detector reads a sine three decibels quieter than a peak detector does', () => {
  const signal = burst(5000, 10 ** (-6 / 20), 100, 400, 1600);
  const grOf = (detector) => atMs(runCompressor(signal, RATE, {
    ...COMP_DEFAULTS, threshold: -20, ratio: 4, knee: 0, attack: 2, release: 400, detector,
  }).gr, 480);

  // Three decibels less level, through a ratio of four, is 3.01 x 3/4.
  const difference = grOf('rms') - grOf('peak');
  assert.ok(Math.abs(difference - 2.26) < 0.25, `the two detectors differ by ${difference.toFixed(2)} dB`);
});

test('the sidechain listens to the key, and the key alone', () => {
  const quiet = burst(3000, 0.05, 0, 1000, 1000);
  const key = burst(60, 0.8, 500, 500, 1000);

  const deaf = runCompressor(quiet, RATE, { ...COMP_DEFAULTS, threshold: -20, ratio: 8 }, key);
  const keyed = runCompressor(quiet, RATE, { ...COMP_DEFAULTS, threshold: -20, ratio: 8, sidechain: true }, key);

  assert.ok(atMs(deaf.gr, 900) > -0.1, 'a quiet signal does not trigger a compressor pointed at itself');
  assert.ok(atMs(keyed.gr, 900) < -10, 'the same compressor keyed off the loud track ducks hard');
});

test('the sidechain high-pass takes the bass out of the detector', () => {
  // A thump under a steady tone: the kind of signal that pulls a whole mix
  // down once a bar until somebody rolls the detector off.
  const samples = new Float32Array(RATE);
  for (let i = 0; i < RATE; i += 1) {
    const thump = i % (RATE / 2) < RATE / 20 ? 0.9 * Math.sin((2 * Math.PI * 60 * i) / RATE) : 0;
    samples[i] = thump + 0.1 * Math.sin((2 * Math.PI * 3000 * i) / RATE);
  }

  const deepest = (scHigh) => {
    const { gr } = runCompressor(samples, RATE, {
      ...COMP_DEFAULTS, threshold: -24, ratio: 8, attack: 2, release: 100, scHigh,
    });
    let low = 0;
    for (const value of gr) if (value < low) low = value;
    return low;
  };

  const open = deepest(20);
  const rolled = deepest(400);
  assert.ok(open < -15, `wide open the thump takes ${open.toFixed(1)} dB off`);
  assert.ok(rolled > open + 8, `rolled off it should take far less, and took ${rolled.toFixed(1)} dB`);
});

/* --- the rest of the controls --------------------------------------------- */

test('lookahead has the reduction in place before the transient arrives', () => {
  const signal = burst(5000, 10 ** (-6 / 20), 500, 400, 1000);

  const lead = (lookahead) => {
    const { gr, out } = runCompressor(signal, RATE, {
      ...COMP_DEFAULTS, threshold: -20, ratio: 8, knee: 0, attack: 1, release: 200, lookahead,
    });
    const first = (list, hit) => {
      for (let i = 0; i < list.length; i += 1) if (hit(list[i])) return (i / RATE) * 1000;
      return null;
    };
    return first(out, (v) => Math.abs(v) > 0.01) - first(gr, (v) => v < -1);
  };

  assert.ok(lead(0) < 1, 'with no lookahead the reduction chases the transient');
  assert.ok(lead(5) > 4, 'with five milliseconds of it the reduction is waiting');
});

test('a mix of nothing is a bypass, to the sample', () => {
  const signal = burst(220, 0.7, 0, 500, 500);
  const { out } = runCompressor(signal, RATE, {
    ...COMP_DEFAULTS, threshold: -50, ratio: 20, mix: 0, attack: 1, release: 10,
  });

  let worst = 0;
  for (let i = 0; i < signal.length; i += 1) worst = Math.max(worst, Math.abs(out[i] - signal[i]));
  assert.equal(worst, 0, 'the dry path is the signal, untouched');
});

test('auto gain puts the loudness back, however hard it was worked', () => {
  const signal = burst(220, 0.7, 0, 900, 1000);

  for (const params of [{ threshold: -30, ratio: 8 }, { threshold: -12, ratio: 2 }, { threshold: -45, ratio: 20 }]) {
    const settings = { ...COMP_DEFAULTS, ...params, attack: 5, release: 80 };
    const makeup = autoGain(signal, RATE, settings);
    const { out } = runCompressor(signal, RATE, { ...settings, makeup });
    const off = 20 * Math.log10(signalRms(out) / signalRms(signal));
    assert.ok(Math.abs(off) < 0.05, `${JSON.stringify(params)} came back ${off.toFixed(3)} dB out`);
  }
});

test('auto gain never pays you for compressing harder', () => {
  const signal = burst(220, 0.7, 0, 900, 1000);
  const loud = analyse(signal, RATE, { ...COMP_DEFAULTS, threshold: -40, ratio: 20 });
  const gentle = analyse(signal, RATE, { ...COMP_DEFAULTS, threshold: -10, ratio: 2 });
  assert.ok(loud.makeup > gentle.makeup, 'the harder setting needs more put back, not less');
});

/* --- the same compressor everywhere --------------------------------------- */

test('the worklet is built from the compressor, not a copy of it', () => {
  const source = workletSource();

  for (const name of ['staticGain', 'compressorCore', 'PEAK_DECAY', 'MOST_LOOKAHEAD']) {
    assert.ok(source.includes(name), `the audio thread needs ${name}`);
  }

  // Run the string the audio thread is given, and hold it against the module.
  const theirs = new Function(`${source.replace(/class HeadroomCompressor[\s\S]*$/, '')}; return compressorCore;`)();
  const a = theirs(RATE);
  const b = compressorCore(RATE);
  const settings = { threshold: -22, ratio: 6, attack: 7, release: 90, knee: 4, scHigh: 120, detector: 'rms' };
  a.set(settings);
  b.set(settings);

  let worst = 0;
  for (let i = 0; i < RATE; i += 1) {
    const x = Math.sin((2 * Math.PI * 220 * i) / RATE) * (i % 8000 < 2000 ? 0.9 : 0.1);
    worst = Math.max(worst, Math.abs(a.step(x, 0) - b.step(x, 0)));
  }
  assert.equal(worst, 0, 'what you hear has to be what you are marked on');
});

/* --- the mode ------------------------------------------------------------- */

test('matching is marked on what the compressor did, not on where the knobs are', () => {
  const answer = { ...COMP_DEFAULTS, threshold: -24, ratio: 4, attack: 10, release: 150 };
  const puzzle = { settings: { exercise: 'match' }, answer };

  assert.ok(compression.score(answer, { ...puzzle, tier: 'hard' }).correct, 'its own answer passes');

  // Half the threshold's distance from the same curve, arrived at through the
  // knee instead: a different set of numbers doing a very similar thing.
  const elsewhere = { ...answer, knee: 18, threshold: -25.5 };
  const score = compression.score(elsewhere, { ...puzzle, tier: 'easy' });
  assert.ok(score.error < 1.2, `a near-identical response read ${score.error.toFixed(2)} dB out`);
});

test('a compressor doing nothing does not pass for one that is working', () => {
  const answer = { ...COMP_DEFAULTS, threshold: -30, ratio: 8, attack: 5, release: 120 };
  const puzzle = { settings: { exercise: 'match' }, answer };
  const idle = compression.score({ ...COMP_DEFAULTS, ratio: 1 }, { ...puzzle, tier: 'easy' });

  assert.ok(!idle.correct, 'leaving it alone is not a match for eight to one');
  assert.match(idle.cells[1].text, /too gentle$/);
});

test('the sidechain exercise knows an un-keyed compressor when it sees one', () => {
  const answer = { depth: 8, recovery: 250 };
  const puzzle = { settings: { exercise: 'duck' }, answer };
  const score = compression.score({ ...COMP_DEFAULTS, threshold: -20, ratio: 4 }, { ...puzzle, tier: 'medium' });
  assert.ok(!score.correct, 'a compressor listening to itself is not a duck');
});

/* --- what the readings say ------------------------------------------------ */

test('a b in a word is a letter, and a b on a note is a flat', () => {
  // Against the engraver itself rather than a restatement of its rule: the
  // board is the only place these strings are ever seen, and it puts them
  // through this. A stub document, because the rule is about text.
  class Node {
    constructor(text = '') { this.parts = text ? [text] : []; this.className = ''; }
    set textContent(value) { this.parts = value === '' ? [] : [value]; }
    get textContent() { return this.parts.map((p) => (typeof p === 'string' ? p : p.textContent)).join(''); }
    appendChild(child) { this.parts.push(child); return child; }
  }

  globalThis.document = {
    createElement: () => new Node(),
    createTextNode: (text) => new Node(text),
  };

  const engraved = (text) => engraveNote(new Node(), text).textContent;

  for (const prose of ['never comes back up', 'barely touched', '2 beats', 'sits still',
    '8.0 dB of duck', 'back in 287 ms', '1.4 dB out of line', 'right depth, wrong timing',
    'not ducking', 'key it off the kick', 'squashed', 'closer']) {
    assert.equal(engraved(prose), prose, `"${prose}" came out engraved`);
  }

  // And the thing accidentals are actually for still works. These used to go
  // through a chord engraver that no longer exists; the logic they cover is
  // the same one, and it is the half worth keeping.
  assert.equal(engraved('Bb'), 'B♭');
  assert.equal(engraved('m7b5'), 'm7♭5');
  assert.equal(engraved('7#9'), '7♯9');
});

test('nothing a compressor reading says gets read as a chord symbol', () => {
  const answer = { ...COMP_DEFAULTS, threshold: -30, ratio: 6, attack: 5, release: 120 };
  const said = [];

  for (const [exercise, puzzle] of [
    ['match', { settings: { exercise: 'match' }, answer }],
    ['fix', { settings: { exercise: 'fix' }, uneven: 12, answer: null }],
    ['duck', { settings: { exercise: 'duck' }, answer: { depth: 8, recovery: 250 } }],
  ]) {
    for (const guess of [{ ...COMP_DEFAULTS }, { ...COMP_DEFAULTS, ratio: 1 },
      { ...COMP_DEFAULTS, threshold: -55, ratio: 20, attack: 0.5, release: 40 },
      { ...COMP_DEFAULTS, sidechain: true, threshold: -24, ratio: 6, release: 600 }]) {
      for (const tier of ['easy', 'medium', 'hard']) {
        for (const cell of compression.score(guess, { ...puzzle, tier: tier }).cells) {
          said.push([exercise, cell.text]);
        }
      }
    }
  }

  for (const [exercise, text] of said) {
    // An ASCII b or # only ever follows a note letter or a figure in a chord
    // symbol; in a reading it is always part of a word.
    assert.doesNotMatch(text, /(^|[A-G0-9])[b#](?![A-Za-z])/,
      `the ${exercise} reading "${text}" would be engraved with an accidental in it`);
  }

  assert.ok(said.length > 20, 'the readings were actually collected');
});
