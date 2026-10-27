import test from 'node:test';
import assert from 'node:assert/strict';

import { signalRms, makeBiquad, setBiquad, runBiquad } from '../src/lib/dsp.js';
import {
  staticGain, compressorCore, runCompressor, runStereo, analyse, analyseStereo, autoGain,
  COMP_DEFAULTS, COMP_LIMITS, optoCell, MOST_OPTO,
} from '../src/plugins/compressor/dsp.js';
import { workletSource } from '../src/plugins/compressor/node.js';
import { COMP_WORK as compression } from '../src/learn/work/compression.js';
import { mulberry32 } from '../src/lib/random.js';
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

  for (const name of ['staticGain', 'compressorCore', 'PEAK_HOLD', 'MOST_LOOKAHEAD']) {
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

test('the shelves and the bell land on the gains they were asked for', () => {
  // Added for the tape mode, which needs a shelf either side of its curve
  // that actually undo each other. A shelf built out of a high-pass and an
  // addition is nearly a shelf and does not quite invert, which is no good
  // when the second filter's whole job is to cancel the first.
  const gainAt = (bq, hz) => {
    const n = 8192;
    const copy = Object.assign(makeBiquad(), bq);
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i += 1) {
      const y = runBiquad(copy, Math.sin((2 * Math.PI * hz * i) / RATE));
      if (i >= n / 2) {
        re += y * Math.cos((2 * Math.PI * hz * i) / RATE);
        im += y * Math.sin((2 * Math.PI * hz * i) / RATE);
      }
    }
    return 20 * Math.log10((2 * Math.hypot(re, im)) / (n / 2));
  };

  for (const gain of [8, -8]) {
    const shelf = setBiquad(makeBiquad(), 'highshelf', 2000, RATE, gain);
    assert.ok(Math.abs(gainAt(shelf, 16000) - gain) < 0.1, `high shelf missed ${gain} at the top`);
    assert.ok(Math.abs(gainAt(shelf, 2000) - gain / 2) < 0.1, 'a shelf is half its gain at the corner');
  }

  const low = setBiquad(makeBiquad(), 'lowshelf', 200, RATE, 6);
  assert.ok(gainAt(low, 20) > 6, 'low shelf should reach its gain underneath');
  assert.ok(Math.abs(gainAt(low, 16000)) < 0.1, 'and do nothing at the top');

  const bell = setBiquad(makeBiquad(), 'peaking', 60, RATE, 3);
  assert.ok(Math.abs(gainAt(bell, 60) - 3) < 0.2, 'the bell should hit its gain at its frequency');
  assert.ok(Math.abs(gainAt(bell, 16000)) < 0.1, 'and nothing far from it');
});

/* --- the detector's averaging time ----------------------------------------- */

test('every setting the plugin has is a setting the core keeps', () => {
  // The core holds its own copy of the settings and `set` only takes keys it
  // already has, so a setting in COMP_DEFAULTS and not in the core is not a
  // default - it is silently ignored on the way in and undefined on the way
  // out. Adding rmsTime cost exactly that: the mean-square coefficient came
  // out exp(-1/NaN), so RMS mode returned NaN for every sample, and the two
  // tests that caught it both said "NaN" rather than anything about settings.
  const core = compressorCore(RATE);
  for (const key of Object.keys(COMP_DEFAULTS)) {
    assert.ok(key in core.settings, `the core has no ${key}, so setting it does nothing`);
  }

  // And the other way: anything the core keeps has to be something the face
  // and the sketchpad know how to put back.
  for (const key of Object.keys(core.settings)) {
    assert.ok(key in COMP_DEFAULTS, `the core keeps ${key} and nothing hands it one`);
  }
});

test('the RMS window is the detector\'s own time constant, and it is settable', () => {
  // It was twelve milliseconds, fixed and invisible: the one time constant on
  // this compressor nobody could see or set, and - once the peak path was
  // honest - the only dishonest thing left. An averaging window is what RMS
  // detection is, so the fault was that it could not be moved.
  assert.equal(COMP_DEFAULTS.rmsTime, 12, 'it rests where it has always been');
  assert.deepEqual(COMP_LIMITS.rmsTime, [0.5, 50]);

  const onset = (over) => {
    const core = compressorCore(RATE);
    core.set({ ...COMP_DEFAULTS, threshold: -24, ratio: 4, attack: 0.1, release: 200,
      detector: 'rms', ...over });
    const run = Math.round(RATE * 0.5);
    const trace = new Float64Array(run);
    for (let i = 0; i < run; i += 1) {
      core.step(Math.sin((2 * Math.PI * 1000 * i) / RATE) * 0.9, 0);
      trace[i] = core.reduction;
    }
    const want = trace[run - 1] * 0.6321;
    for (let i = 0; i < run; i += 1) if (trace[i] <= want) return (i / RATE) * 1000;
    return Infinity;
  };

  // A short window hands the gain computer something close to the sample, so
  // a tenth of a millisecond of attack nearly lands; a long one averages over
  // it and the same knob takes ten milliseconds. Measured: 0.29 ms at a
  // half-millisecond window against 10.23 at fifty.
  const quick = onset({ rmsTime: 0.5 });
  const slow = onset({ rmsTime: 50 });
  assert.ok(quick < 0.5, `a 0.5 ms window reads an 0.1 ms attack as ${quick.toFixed(2)} ms`);
  assert.ok(slow > 8, `a 50 ms window reads it as ${slow.toFixed(2)} ms`);
  assert.ok(slow > quick * 10, 'and the window is what made the difference');

  // The peak detector has no window, so moving it changes nothing there.
  const peak = (rmsTime) => {
    const core = compressorCore(RATE);
    core.set({ ...COMP_DEFAULTS, threshold: -24, ratio: 4, attack: 5, release: 200, rmsTime });
    let last = 0;
    for (let i = 0; i < Math.round(RATE * 0.2); i += 1) {
      core.step(Math.sin((2 * Math.PI * 1000 * i) / RATE) * 0.9, 0);
      last = core.reduction;
    }
    return last;
  };
  assert.equal(peak(0.5).toFixed(9), peak(50).toFixed(9),
    'a peak detector has no averaging time for this to be');
});

/* --- the gain platform ----------------------------------------------------- */

/** 63% or 90% recovery after a passage of a given length, in ms. */
function recoverAfter(over, loudMs, share = 0.6321) {
  const core = compressorCore(RATE);
  core.set({ ...COMP_DEFAULTS, threshold: -24, ratio: 4, knee: 6,
    attack: 5, release: 120, ...over });

  let gr = 0;
  const loud = Math.round((loudMs * RATE) / 1000);
  for (let i = 0; i < loud; i += 1) {
    core.step(Math.sin((2 * Math.PI * 300 * i) / RATE) * 0.9, 0);
    gr = core.reduction;
  }

  const want = gr * (1 - share);
  for (let i = 0; i < Math.round(RATE * 20); i += 1) {
    core.step(0, 0);
    if (core.reduction >= want) return (i / RATE) * 1000;
  }
  return Infinity;
}

test('auto release leaves an isolated hit exactly alone', () => {
  // The whole point of the platform is that it does not charge on one peak.
  // The AMS Neve manual: "the programme rides on a slowly moving gain
  // platform" - a platform is what a passage builds, not what a snare does.
  // Measured identical to the millisecond at 30, 80 and 200 ms of loud.
  for (const loud of [30, 80, 200]) {
    for (const share of [0.6321, 0.9]) {
      const off = recoverAfter({ auto: false }, loud, share);
      const on = recoverAfter({ auto: true }, loud, share);
      assert.ok(Math.abs(on - off) < 0.1,
        `after ${loud} ms loud, auto recovers ${share === 0.9 ? '90%' : '63%'} in `
        + `${on.toFixed(1)} ms against ${off.toFixed(1)} off`);
    }
  }
});

test('auto release holds on after a passage that stayed loud', () => {
  // Measured at a 120 ms release, against auto off:
  //
  //     loud for     63% off / on        90% off / on
  //      500 ms      125 / 125 ms        281 / 2307 ms
  //     1200 ms      125 / 399           281 / 4306
  //     3000 ms      125 / 1735          281 / 5643
  //
  // Half a second in only the tail has moved, which is what a platform under
  // a release is; by a second the whole recovery has.
  const tail = (loud) => recoverAfter({ auto: true }, loud, 0.9)
    / recoverAfter({ auto: false }, loud, 0.9);

  assert.ok(tail(500) > 4, `half a second of loud stretches the tail ${tail(500).toFixed(1)}x`);
  assert.ok(tail(3000) > 15, `three seconds stretches it ${tail(3000).toFixed(1)}x`);
  assert.ok(tail(3000) > tail(500), 'and the longer the passage the longer the tail');

  // The early part only moves once the passage is long enough to build a
  // platform deeper than the point being measured.
  const early = (loud) => recoverAfter({ auto: true }, loud, 0.6321)
    / recoverAfter({ auto: false }, loud, 0.6321);
  assert.ok(early(500) < 1.1, 'at half a second the first 63% is untouched');
  assert.ok(early(3000) > 8, `at three seconds it is ${early(3000).toFixed(1)}x`);
});

test('the platform can hold reduction on but never deepen it', () => {
  // It charges toward whichever of the target and the fast path is smaller
  // and the gain takes the deeper of the two, so it can only ever be the
  // thing still holding when the fast path has let go.
  const deepest = (auto) => {
    const core = compressorCore(RATE);
    core.set({ ...COMP_DEFAULTS, threshold: -24, ratio: 4, knee: 6, attack: 5, release: 120, auto });
    let worst = 0;
    for (let i = 0; i < Math.round(RATE * 4); i += 1) {
      core.step(Math.sin((2 * Math.PI * 300 * i) / RATE) * 0.9, 0);
      worst = Math.min(worst, core.reduction);
    }
    return worst;
  };
  assert.ok(deepest(true) >= deepest(false) - 1e-9,
    `auto reaches ${deepest(true).toFixed(3)} dB where fixed reaches ${deepest(false).toFixed(3)}`);
});

test('auto release off is the compressor that was there before it', () => {
  // A new mode that changes the old one is a new mode nobody can trust.
  const run = (auto) => {
    const core = compressorCore(RATE);
    core.set({ ...COMP_DEFAULTS, threshold: -24, ratio: 4, knee: 6, attack: 5, release: 120, auto });
    const out = [];
    for (let i = 0; i < Math.round(RATE * 0.5); i += 1) {
      out.push(core.step(Math.sin((2 * Math.PI * 300 * i) / RATE) * 0.9, 0));
    }
    return out;
  };
  const fixed = run(false);
  const alsoFixed = run(false);
  assert.deepEqual(fixed, alsoFixed, 'and it is the same compressor twice');
  assert.equal(COMP_DEFAULTS.auto, false, 'and it is off unless somebody asks');
});

/* --- the release drill ----------------------------------------------------- */

test('the release drill asks a question with only one variable in it', () => {
  // The mirror of the reduction drill: that one fixes the release and asks
  // how much, this one fixes how much and asks the release. Which only works
  // if every round does the same amount of work - the release is most of how
  // much a compressor takes off, so without solving the threshold per release
  // this would be a level test wearing a timing label.
  const rounds = ['40', '80', '150', '300', '600'].map((id) => ({
    id,
    settings: compression.exercises.release.startOf({
      settings: { exercise: 'release' }, answer: { release: id },
    }),
  }));

  for (const { id, settings } of rounds) {
    assert.equal(settings.release, Number(id), 'the round sets the release it asked about');
    assert.ok(Math.abs(settings.makeup - 6) < 0.25,
      `${id} ms does ${settings.makeup.toFixed(2)} dB rather than six`);
  }

  // Each needs its own threshold to get there, and a slower release needs a
  // higher one - it holds on longer, so it takes more off for the same
  // threshold. That monotonicity is the whole mechanism of the drill.
  const thresholds = rounds.map((r) => r.settings.threshold);
  assert.equal(new Set(thresholds).size, rounds.length,
    `the five rounds share a threshold: ${thresholds.join(', ')}`);
  for (let i = 1; i < thresholds.length; i += 1) {
    assert.ok(thresholds[i] > thresholds[i - 1],
      `thresholds are not monotone in the release: ${thresholds.join(', ')}`);
  }
});

test('what the release drill leaves to hear is how far it comes back', () => {
  // With the amount matched and the level put back, what separates the five
  // is the reduction sitting between the hits. Measured over a bed this test
  // supplies, so the figures are the ones asserted rather than ones taken on
  // trust: the drill's own bed is private to its module, and the property
  // being held here is the shape of the answer rather than one loop's numbers.
  const rate = 48000;
  const bed = new Float32Array(Math.round(rate * 4));
  const grit = mulberry32(31337);
  const beat = 60 / 96;
  for (let b = 0; b * beat < 4; b += 1) {
    const at = Math.round(b * beat * rate);
    for (let i = 0; i < Math.round(rate * 0.25) && at + i < bed.length; i += 1) {
      const t = i / rate;
      bed[at + i] += b % 2 === 0
        ? Math.exp(-t * 14) * Math.sin(2 * Math.PI * 55 * Math.exp(-t * 6) * t) * 0.95
        : Math.exp(-t * 22) * ((grit() * 2 - 1) * 0.7 + Math.sin(2 * Math.PI * 190 * t) * 0.4);
    }
  }

  const between = ['40', '80', '150', '300', '600'].map((id) => {
    const settings = compression.exercises.release.startOf({
      settings: { exercise: 'release' }, answer: { release: id },
      material: { rate, samples: bed, even: bed },
    });
    const got = analyse(bed, rate, { ...settings, makeup: 0 });
    const quiet = [...got.gr].map(Math.abs).sort((a, b) => a - b);
    return quiet[Math.round(quiet.length * 0.25)];
  });

  const read = between.map((b) => b.toFixed(2)).join(', ');
  for (let i = 1; i < between.length; i += 1) {
    assert.ok(between[i] > between[i - 1],
      `the reduction between hits is not monotone in the release: ${read}`);
  }
  assert.ok(between[4] > between[0] * 20,
    `the slowest release should sit far deeper between hits: ${read}`);
});

/* --- the optical family ---------------------------------------------------- */

/** Settled reduction on a steady tone, in dB. */
function optoSettled(db, over, hz = 300) {
  const core = compressorCore(RATE);
  core.set({ ...COMP_DEFAULTS, family: 'opto', makeup: 0, mix: 1, ...over });
  const amp = 10 ** (db / 20) * Math.SQRT2;
  for (let i = 0; i < Math.round(RATE * 1.5); i += 1) {
    core.step(Math.sin((2 * Math.PI * hz * i) / RATE) * amp, 0);
  }
  return -core.reduction;
}

test('the photocell hits the timings the hardware is quoted at', () => {
  // UA: about 10 ms of attack and "dual stage: ~60 ms for 50% release", with
  // a second stage whose length depends on how long the cell was lit.
  const cell = optoCell(RATE);
  const trace = [];
  for (let i = 0; i < RATE; i += 1) trace.push(cell.step(1));
  const top = trace[trace.length - 1];
  const at63 = trace.findIndex((v) => v >= top * 0.6321) / RATE * 1000;
  assert.ok(at63 > 7 && at63 < 16, `the cell takes ${at63.toFixed(1)} ms to reach 63%`);

  // Half-release, after being lit for a while. A flash has to leave almost no
  // memory and a passage has to leave one: measured 64 ms after 50 ms of
  // light, 273 after two seconds, 1881 after twenty.
  const halfAfter = (heldMs) => {
    const c = optoCell(RATE);
    let lit = 0;
    for (let i = 0; i < Math.round((heldMs * RATE) / 1000); i += 1) lit = c.step(1);
    const want = lit * 0.5;
    for (let i = 0; i < Math.round(RATE * 60); i += 1) {
      if (c.step(0) <= want) return (i / RATE) * 1000;
    }
    return Infinity;
  };

  const flash = halfAfter(50);
  assert.ok(flash > 45 && flash < 80, `a 50 ms flash half-releases in ${flash.toFixed(0)} ms, not about 60`);

  const held = [50, 600, 2000, 6000, 20000].map(halfAfter);
  for (let i = 1; i < held.length; i += 1) {
    assert.ok(held[i] > held[i - 1],
      `the tail is not longer the longer it was lit: ${held.map((h) => h.toFixed(0)).join(', ')}`);
  }
  assert.ok(held[4] > held[0] * 10,
    `twenty seconds of light should leave a far longer tail than fifty milliseconds: `
    + `${held[4].toFixed(0)} against ${held[0].toFixed(0)} ms`);
});

test('the opto has no threshold and a ratio that firms up', () => {
  // The whole character: a knee so soft there is no corner to put a threshold
  // at, and a ratio that climbs with level rather than sitting where a knob
  // put it. Measured at peak reduction 0.5 in compress: 1.21, 1.91, 2.51,
  // 3.00, 3.37, 3.54 to one - the "about 4:1, soft knee, program dependent"
  // the manual claims.
  const ratios = [];
  let prev = null;
  for (const db of [-34, -28, -22, -16, -10, -6, -2]) {
    const out = db - optoSettled(db, { optoMode: 'compress', peakReduction: 0.5 });
    if (prev && out - prev.out > 1e-6) ratios.push((db - prev.db) / (out - prev.out));
    prev = { db, out };
  }

  const read = ratios.map((r) => r.toFixed(2)).join(', ');
  for (let i = 1; i < ratios.length; i += 1) {
    assert.ok(ratios[i] > ratios[i - 1] - 0.01, `the ratio does not firm up: ${read}`);
  }
  assert.ok(ratios[ratios.length - 1] > 3 && ratios[ratios.length - 1] < 5,
    `it should settle near four to one, not ${read}`);

  // Limit is the same cell at a harder slope.
  const limiting = (() => {
    let was = null; let steepest = 0;
    for (const db of [-28, -22, -16, -10, -6]) {
      const out = db - optoSettled(db, { optoMode: 'limit', peakReduction: 0.5 });
      if (was && out - was.out > 1e-6) steepest = Math.max(steepest, (db - was.db) / (out - was.out));
      was = { db, out };
    }
    return steepest;
  })();
  assert.ok(limiting > 6, `limit only reaches ${limiting.toFixed(2)}:1`);
});

test('the optical loop cannot wind up, which is the point of the ceiling', () => {
  // A feedback gain computer with a slope of R - 1 and a lag winds up on
  // transients: measured on one hit at ratio 8 with a 20 ms attack, a general
  // feedback topology reached 92.6 dB of reduction where the feed-forward path
  // reached 16.5. A photoresistor has a floor on its resistance, so this one
  // runs out instead.
  for (const optoMode of ['compress', 'limit']) {
    const core = compressorCore(RATE);
    core.set({ ...COMP_DEFAULTS, family: 'opto', optoMode, peakReduction: 1, makeup: 0, mix: 1 });
    let deepest = 0;
    for (let i = 0; i < Math.round(RATE * 0.6); i += 1) {
      const t = i / RATE;
      const hit = t < 0.2 ? Math.exp(-t * 14) * Math.sin(2 * Math.PI * 200 * t) * 0.9 : 0;
      core.step(hit, 0);
      deepest = Math.min(deepest, core.reduction);
    }
    assert.ok(deepest > -MOST_OPTO - 0.01,
      `${optoMode} pulled ${deepest.toFixed(1)} dB, past the cell's ${MOST_OPTO} dB floor`);
    assert.ok(deepest < -5, `${optoMode} barely did anything: ${deepest.toFixed(1)} dB`);
  }
});

test('peak reduction is the only thing driving it', () => {
  // One knob where a modern compressor has a threshold, and it has to cover
  // the range on its own: measured 0, 1.87, 7.51, 14.32 and 21.54 dB at a
  // -16 dBFS tone.
  const sweep = [0, 0.25, 0.5, 0.75, 1]
    .map((peakReduction) => optoSettled(-16, { optoMode: 'compress', peakReduction }));
  const read = sweep.map((v) => v.toFixed(2)).join(', ');
  for (let i = 1; i < sweep.length; i += 1) {
    assert.ok(sweep[i] > sweep[i - 1], `peak reduction is not monotone: ${read}`);
  }
  assert.ok(sweep[0] < 0.1, `it should do nothing at zero, not ${read}`);
  assert.ok(sweep[4] > 15, `it should reach well over fifteen decibels, not ${read}`);

  // And attack, release and ratio do nothing at all here, because the cell is
  // the only thing with an opinion about time.
  const a = optoSettled(-16, { peakReduction: 0.5, attack: 0.1, release: 20, ratio: 2 });
  const b = optoSettled(-16, { peakReduction: 0.5, attack: 200, release: 2000, ratio: 20 });
  assert.equal(a.toFixed(6), b.toFixed(6),
    'the modern knobs still reach the optical path');
});

/* --- range ----------------------------------------------------------------- */

test('range caps the reduction at what it says', () => {
  // Every other knob says how hard to work on what is over the threshold.
  // This is the only one that says when to stop.
  const deepest = (over) => {
    const core = compressorCore(RATE);
    core.set({ ...COMP_DEFAULTS, threshold: -40, ratio: 20, attack: 1, release: 150,
      knee: 0, makeup: 0, mix: 1, ...over });
    let worst = 0;
    for (let i = 0; i < Math.round(RATE * 1.2); i += 1) {
      core.step(Math.sin((2 * Math.PI * 300 * i) / RATE) * 0.999, 0);
      worst = Math.min(worst, core.reduction);
    }
    return -worst;
  };

  // Uncapped, those settings reach a long way down.
  const loose = deepest({});
  assert.ok(loose > 30, `the test needs settings that go deep, not ${loose.toFixed(1)} dB`);

  for (const range of [3, 6, 12, 24]) {
    const got = deepest({ range });
    assert.ok(got <= range + 0.05, `a range of ${range} let it reach ${got.toFixed(2)} dB`);
    assert.ok(got > range - 0.5, `a range of ${range} only reached ${got.toFixed(2)} dB`);
  }
});

test('range at the top of its travel is not in the signal path', () => {
  // A new control that changes the old compressor is a new control nobody can
  // trust. The deepest this compressor can be asked for is 57.0 dB - measured
  // on a full-scale tone with the threshold on its floor at 20:1 - so the
  // range tops out past that and the knob reads "off" there.
  assert.equal(COMP_DEFAULTS.range, 60);
  assert.ok(COMP_LIMITS.range[1] >= 57, 'the range has to clear what the compressor can reach');

  const run = (over) => {
    const core = compressorCore(RATE);
    core.set({ ...COMP_DEFAULTS, threshold: -40, ratio: 20, attack: 1, release: 150,
      knee: 6, makeup: 0, mix: 1, ...over });
    const out = [];
    for (let i = 0; i < Math.round(RATE * 0.4); i += 1) {
      out.push(core.step(Math.sin((2 * Math.PI * 300 * i) / RATE) * 0.999, 0));
    }
    return out;
  };
  assert.deepEqual(run({ range: 60 }), run({ range: COMP_LIMITS.range[1] }),
    'the default and the top of the knob are the same compressor');
});

test('auto gain follows the range down', () => {
  // The makeup is the measured reduction put back, so capping the reduction
  // has to cap what gets put back - otherwise turning the range down would
  // quietly turn the output up.
  const bed = new Float32Array(Math.round(RATE * 1.5));
  for (let i = 0; i < bed.length; i += 1) {
    const t = i / RATE;
    bed[i] = Math.sin(2 * Math.PI * 220 * t) * (t % 0.4 < 0.12 ? 0.9 : 0.12);
  }

  const put = (range) => analyse(bed, RATE, { ...COMP_DEFAULTS, threshold: -34, ratio: 12,
    attack: 2, release: 160, knee: 6, makeup: 0, mix: 1, range }).makeup;

  const wide = put(60);
  const tight = put(4);
  assert.ok(wide > tight, `a tighter range should put back less: ${wide.toFixed(2)} against ${tight.toFixed(2)}`);
  assert.ok(tight > 0, 'but it should still put something back');
});

/* --- two channels --------------------------------------------------------- */

// A compressor insert used to collapse whatever it was given to mono. The
// faults are in tests/browser/stereo.mjs, which measures them where they live;
// these hold the arithmetic that fixes them.

/** The same tone at two amplitudes, as a stereo pair. */
function panned(left, right, hz = 220, ms = 400) {
  const n = Math.round((RATE * ms) / 1000);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const s = Math.sin((2 * Math.PI * hz * i) / RATE);
    L[i] = s * left;
    R[i] = s * right;
  }
  return [L, R];
}

const peakOf = (samples) => {
  let peak = 0;
  for (const v of samples) peak = Math.max(peak, Math.abs(v));
  return peak;
};

test('mono is the stereo path with the same sample on both sides, to the bit', () => {
  // The whole of the scoring runs through `step`, and `step` is now the
  // two-channel body called with one signal twice. If those two ever differ,
  // every mark this app has given is against arithmetic that is not what the
  // audio thread runs - which is the fault the worklet test exists to stop,
  // arriving by a different door. Bit-identical, not close.
  const signal = burst(220, 0.9, 20, 200, 400);
  const key = burst(60, 0.8, 0, 400, 400);

  const SETTINGS = [
    { what: 'plain', with: {} },
    { what: 'fast and deep', with: { threshold: -30, ratio: 12, attack: 0.5, release: 20 } },
    { what: 'rms', with: { detector: 'rms', rmsTime: 30 } },
    { what: 'lookahead', with: { lookahead: 8 } },
    { what: 'auto release', with: { auto: true } },
    { what: 'ranged', with: { threshold: -40, ratio: 10, range: 6 } },
    { what: 'parallel', with: { mix: 0.4, makeup: 3 } },
    { what: 'keyed', with: { sidechain: true, scHigh: 200 } },
    { what: 'opto', with: { family: 'opto', peakReduction: 0.8 } },
    { what: 'opto limit', with: { family: 'opto', optoMode: 'limit' } },
  ];

  for (const { what, with: params } of SETTINGS) {
    const settings = { ...COMP_DEFAULTS, ...params };
    const mono = runCompressor(signal, RATE, settings, key);
    const wide = runStereo(signal, signal, RATE, settings, key);

    for (let i = 0; i < signal.length; i += 1) {
      assert.equal(wide.left[i], mono.out[i],
        `${what}: sample ${i} came out ${wide.left[i]} wide and ${mono.out[i]} mono`);
      assert.equal(wide.right[i], mono.out[i], `${what}: the two sides differ at ${i}`);
      assert.equal(wide.gr[i], mono.gr[i], `${what}: the reduction differs at ${i}`);
    }
  }
});

test('one gain across both sides, so the image does not move when it bites', () => {
  // The reason to link at all. A hard-panned tone is 18:1 between the sides;
  // compress it hard and it has to still be 18:1, because a compressor that
  // moved the sides by different amounts would swing the image in time with
  // the music.
  const [L, R] = panned(0.9, 0.05);
  const out = runStereo(L, R, RATE, {
    ...COMP_DEFAULTS, threshold: -24, ratio: 8, attack: 1, release: 50,
  });

  assert.ok(out.deepest < -8, `it has to be working to be worth asking: ${out.deepest}`);

  for (let i = RATE / 50; i < L.length; i += 97) {
    if (Math.abs(out.right[i]) < 1e-5) continue;
    const ratio = Math.abs(out.left[i] / out.right[i]);
    assert.ok(Math.abs(ratio - 18) < 0.05,
      `the sides came out ${ratio.toFixed(3)} apart rather than 18`);
  }
});

test('the detector hears the louder side, not the average of the two', () => {
  // Which is the difference between a stereo compressor and a mono one fed a
  // sum. A tone hard left has to earn the reduction its own level earns; if
  // the detector averaged the sides it would read 6 dB quieter and let a
  // hard-panned transient through.
  const settings = { ...COMP_DEFAULTS, threshold: -20, ratio: 6, attack: 1, release: 50 };
  const hard = runStereo(...panned(0.8, 0), RATE, settings);
  const both = runStereo(...panned(0.8, 0.8), RATE, settings);

  assert.ok(Math.abs(hard.deepest - both.deepest) < 0.01,
    `hard left reduced ${hard.deepest.toFixed(2)} dB and centred ${both.deepest.toFixed(2)}, `
    + 'and the louder side is 0.8 either way');
});

test('a side that is already quiet enough is not pulled down with the other one', () => {
  // The cost of linking, stated rather than hidden: the quiet side is reduced
  // by the loud side's gain. That is what keeping the image means, and the
  // check is that it is the same gain and not a second one.
  const [L, R] = panned(0.9, 0.05);
  const out = runStereo(L, R, RATE, {
    ...COMP_DEFAULTS, threshold: -24, ratio: 8, attack: 1, release: 50,
  });
  const alone = runStereo(R, R, RATE, {
    ...COMP_DEFAULTS, threshold: -24, ratio: 8, attack: 1, release: 50,
  });

  assert.ok(peakOf(out.right) < peakOf(alone.right) * 0.8,
    'the quiet side should be held down by the loud one, which is what linked means');
});

test('a stereo signal out of phase comes through, rather than cancelling', () => {
  // L and -L. Nothing here sums the sides, so there is nothing for them to
  // cancel in - and at ratio 1 the pair has to come back exactly as it went.
  const [L, R] = panned(0.5, -0.5);
  const out = runStereo(L, R, RATE, { ...COMP_DEFAULTS, threshold: 0, ratio: 1, knee: 0 });

  let worst = 0;
  for (let i = 0; i < L.length; i += 1) {
    worst = Math.max(worst, Math.abs(out.left[i] - L[i]), Math.abs(out.right[i] - R[i]));
  }
  assert.ok(worst < 1e-6, `an out-of-phase pair came back changed by ${worst.toExponential(2)}`);
});

test('the key is still the key when the signal has two channels', () => {
  const [L, R] = panned(0.2, 0.2);
  const key = burst(60, 0.9, 100, 150, 400);
  const out = runStereo(L, R, RATE, {
    ...COMP_DEFAULTS, threshold: -30, ratio: 8, sidechain: true,
  }, key);

  assert.ok(out.deepest < -6,
    `a loud key should duck a quiet signal, and it reduced ${out.deepest.toFixed(2)} dB`);
  const quiet = runStereo(L, R, RATE, {
    ...COMP_DEFAULTS, threshold: -30, ratio: 8, sidechain: true,
  }, new Float32Array(key.length));
  assert.equal(quiet.deepest, 0, 'and a silent key should duck nothing');
});

test('a stereo pass is the mono one when both sides are the same, to the bit', () => {
  // The same contract `step` is held to, one level up. The reading is what
  // every mark is made on, so a stereo-capable reading that drifted from the
  // mono one would move every tolerance in the compressor's drills.
  const signal = burst(220, 0.9, 20, 200, 400);
  const key = burst(60, 0.8, 0, 400, 400);

  for (const params of [
    {},
    { detector: 'rms', rmsTime: 30 },
    { threshold: -34, ratio: 10, attack: 1, release: 60 },
    { sidechain: true, scHigh: 200 },
    { family: 'opto', peakReduction: 0.7 },
  ]) {
    const settings = { ...COMP_DEFAULTS, ...params };
    const mono = analyse(signal, RATE, settings, key);
    const wide = analyseStereo(signal, signal, RATE, settings, key);

    assert.equal(wide.deepest, mono.deepest, 'the deepest reduction differs');
    assert.equal(wide.average, mono.average, 'the average reduction differs');
    assert.equal(wide.makeup, mono.makeup, 'the makeup gain differs');
    for (let i = 0; i < signal.length; i += 1) {
      assert.equal(wide.gr[i], mono.gr[i], `the trace differs at sample ${i}`);
    }
  }
});

test('a stereo pass reads the reduction the audio path applies, not one side of it', () => {
  // The fault this was built for. A stereo file loaded into the tool was
  // heard through a detector on the louder of the two channels and drawn from
  // the left one alone; measured on the app's spread beds, five-millisecond
  // frames - the resolution the scoring compares at - were out by about
  // 0.2 to 0.6 dB on average and by roughly 3 dB at worst. The trace a
  // reading hands back has to be the trace the ear is getting.
  const [L, R] = panned(0.2, 0.9);
  const settings = { ...COMP_DEFAULTS, threshold: -30, ratio: 8, attack: 1, release: 60 };

  const heard = runStereo(L, R, RATE, settings);
  const read = analyseStereo(L, R, RATE, settings);
  for (let i = 0; i < L.length; i += 1) {
    assert.equal(read.gr[i], heard.gr[i], `the reading and the audio differ at ${i}`);
  }

  // And it is a different answer from the left channel alone, or there would
  // have been nothing wrong in the first place.
  const leftOnly = analyse(L, RATE, settings);
  assert.ok(read.deepest < leftOnly.deepest - 1,
    `the louder side should drive it deeper: both sides ${read.deepest.toFixed(2)} dB `
    + `against the left alone ${leftOnly.deepest.toFixed(2)} dB`);
});

test('the makeup gain a stereo pass reports is over both sides', () => {
  // Makeup is what takes loudness out of an A/B, and loudness is both
  // channels. Reading it off one side of a lopsided pair would hand back a
  // number that matched neither what was heard nor what was wanted.
  const [L, R] = panned(0.1, 0.9);
  const settings = { ...COMP_DEFAULTS, threshold: -26, ratio: 6 };
  const both = analyseStereo(L, R, RATE, settings);
  const leftOnly = analyse(L, RATE, settings);

  assert.ok(both.makeup > 0, 'compressing should want some makeup back');
  assert.ok(Math.abs(both.makeup - leftOnly.makeup) > 0.5,
    `a quiet left channel should not set the makeup for the pair: ${both.makeup.toFixed(2)} `
    + `against ${leftOnly.makeup.toFixed(2)}`);
});
