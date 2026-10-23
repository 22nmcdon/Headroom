import test from 'node:test';
import assert from 'node:assert/strict';

import { stampOf, readingOf, notReady, isCurrent, comparable, gapOf } from '../src/lib/read.js';
import { distance, KINDS } from '../src/lib/gap.js';
import { curveReading, curveGap, JUDGED_HZ } from '../src/plugins/eq/filters.js';
import { reductionReading, reductionGap, FRAME_MS, materialStamp } from '../src/plugins/compressor/reading.js';
import { decayReading, decayTimes, decayProfile, monoOf } from '../src/lib/response.js';
import { stereoReading } from '../src/plugins/stereo/field.js';
import { harmonicsReading, HEAT_DEFAULTS } from '../src/plugins/saturation/shape.js';
import { makeImpulse, VERB_DEFAULTS, roomProfile } from '../src/plugins/reverb/ir.js';
import { COMP_DEFAULTS, analyse, meanFrames } from '../src/plugins/compressor/dsp.js';
import { STEREO_DEFAULTS } from '../src/plugins/stereo/field.js';
import { mulberry32 } from '../src/lib/random.js';

const rate = 48000;

/* --- the stamp ------------------------------------------------------------ */

test('the same settings stamp the same however they were written down', () => {
  // Two objects with the same contents are the same settings, and
  // JSON.stringify says otherwise the moment somebody spreads them in a
  // different order - which is every time `{ ...DEFAULTS, ...guess }` runs.
  assert.equal(stampOf({ a: 1, b: 2 }), stampOf({ b: 2, a: 1 }));
  assert.notEqual(stampOf({ a: 1, b: 2 }), stampOf({ a: 1, b: 3 }));

  // And a slider that reports 0.30000000000000004 has not moved.
  assert.equal(stampOf({ drive: 0.1 + 0.2 }), stampOf({ drive: 0.3 }));
  assert.notEqual(stampOf({ drive: 0.3 }), stampOf({ drive: 0.3001 }));

  // The EQ's settings are a list of band objects, not a flat one.
  const bands = [{ type: 'peaking', frequency: 800, gain: 4, q: 1.2, on: true }];
  assert.equal(stampOf(bands), stampOf(bands.map((b) => ({ ...b }))));
  assert.notEqual(stampOf(bands), stampOf([{ ...bands[0], gain: 4.5 }]));
  assert.notEqual(stampOf(bands), stampOf([]));
});

/* --- the envelope --------------------------------------------------------- */

test('a reading that has not been taken is still a reading', () => {
  // Never null. A caller that has to branch on null before it can ask what
  // tool it is holding will get that branch wrong once, and the branch it
  // gets wrong is the one that runs for the first hundred milliseconds.
  const blank = notReady({ tool: 'panning', kind: 'image', of: { state: 'x', axis: {} } });

  assert.equal(blank.tool, 'panning');
  assert.equal(blank.kind, 'image');
  assert.equal(blank.ready, false);
  assert.equal(blank.values, null);
  assert.ok(blank.of, 'and it still says what it would have been a reading of');
});

test('a reading knows whether it is of what the tool is set to now', () => {
  const settings = { ...HEAT_DEFAULTS, drive: 12 };
  const reading = harmonicsReading(rate, settings);

  assert.ok(isCurrent(reading, settings));
  assert.ok(isCurrent(reading, { ...settings }), 'by value, not by reference');
  assert.ok(!isCurrent(reading, { ...settings, drive: 12.5 }));
  assert.ok(!isCurrent(notReady({ tool: 'x', kind: 'harmonics', of: {} }), settings));
});

test('every kind of reading arrives in the same envelope', () => {
  const impulse = makeImpulse(rate, VERB_DEFAULTS);
  const material = new Float32Array(rate);
  const rng = mulberry32(0x5a7);
  for (let i = 0; i < material.length; i += 1) material[i] = (rng() * 2 - 1) * 0.4;

  const readings = [
    curveReading([{ type: 'peaking', frequency: 800, gain: 4, q: 1, on: true }], rate),
    reductionReading(material, rate, COMP_DEFAULTS),
    decayReading('reverb', roomProfile(rate, VERB_DEFAULTS), { state: VERB_DEFAULTS }),
    stereoReading(stereoPair().left, stereoPair().right, rate, STEREO_DEFAULTS),
    harmonicsReading(rate, { ...HEAT_DEFAULTS, drive: 10 }),
  ];

  const kinds = new Set();
  for (const reading of readings) {
    assert.ok(reading.tool, 'a reading says which tool took it');
    assert.ok(KINDS.includes(reading.kind), `${reading.kind} is not a kind that can be compared`);
    assert.equal(reading.ready, true);
    assert.ok(reading.values !== null && reading.values !== undefined);

    // The part that did not exist before, and the part three shipping bugs
    // were waiting on: what this is a reading OF.
    assert.ok(reading.of.state, `${reading.kind} does not say what settings it is of`);
    assert.ok(reading.of.axis, `${reading.kind} does not say what its values are indexed by`);
    assert.ok('source' in reading.of, `${reading.kind} does not say what it was taken over`);

    kinds.add(reading.kind);
  }

  assert.equal(kinds.size, 5, 'five kinds across six tools');
});

test('the reverb and the delay declare the same kind, on purpose', () => {
  // Not a coincidence to be tidied away later. A room and a repeat are both
  // completely described by what they do to one click, they are read by the
  // same function into the same shape, and saying so is what makes "is this
  // delay as long as that room" a question this app can answer.
  const room = decayReading('reverb', roomProfile(rate, VERB_DEFAULTS), { state: VERB_DEFAULTS });
  const echo = decayReading('delay', roomProfile(rate, VERB_DEFAULTS), { state: VERB_DEFAULTS });

  assert.equal(room.kind, echo.kind);
  assert.notEqual(room.tool, echo.tool);
  assert.equal(comparable(room, echo), null, 'and they really are comparable');
});

/* --- comparing ------------------------------------------------------------ */

test('two readings of different kinds are refused, not averaged', () => {
  const curve = curveReading([{ type: 'peaking', frequency: 800, gain: 4, q: 1, on: true }], rate);
  const heat = harmonicsReading(rate, HEAT_DEFAULTS);

  assert.match(comparable(curve, heat), /cannot be compared/);
  assert.throws(() => distance(curve, heat), /cannot be compared/);
});

test('a reading that has not been taken cannot be compared with one that has', () => {
  const curve = curveReading([{ type: 'peaking', frequency: 800, gain: 4, q: 1, on: true }], rate);
  const blank = notReady({ tool: 'eq', kind: 'curve', of: curve.of });

  assert.match(comparable(curve, blank), /not been measured/);
  assert.throws(() => distance(curve, blank), /cannot be compared/);
});

test('two decay profiles on different time axes are refused', () => {
  // The latent one. `profileDistance` walks a.length and has never looked at
  // b.length, so two profiles on different axes were silently assumed to line
  // up and comparing them produced a plausible number out of points that are
  // not the same points. Nothing carried an axis, so nothing could catch it.
  const profile = roomProfile(rate, VERB_DEFAULTS);
  const wide = decayReading('reverb', profile, { state: VERB_DEFAULTS, times: decayTimes() });
  const narrow = decayReading('reverb', profile, { state: VERB_DEFAULTS, times: decayTimes(30) });

  assert.match(comparable(wide, narrow), /different axes/);
  assert.throws(() => distance(wide, narrow), /different axes/);
  // And the same axis compares fine.
  assert.equal(distance(wide, wide).off, 0);
});

test('two compressors over different material are refused', () => {
  const rng = mulberry32(0x5a7);
  const one = new Float32Array(rate);
  const two = new Float32Array(rate);
  for (let i = 0; i < rate; i += 1) {
    one[i] = (rng() * 2 - 1) * 0.4;
    two[i] = (rng() * 2 - 1) * 0.4;
  }

  assert.notEqual(materialStamp(one), materialStamp(two));

  const a = reductionReading(one, rate, COMP_DEFAULTS);
  const b = reductionReading(two, rate, COMP_DEFAULTS);
  assert.match(comparable(a, b), /different axes/);

  // The whole measurement is what these settings did to this loop, so a
  // comparison across two loops is not a smaller number, it is not a number.
  assert.throws(() => distance(a, b), /cannot be compared/);
});

/**
 * A genuinely stereo pair.
 *
 * Two channels of the same samples is a mono signal, and a mono signal has no
 * side content for a width control to act on - so an imager reads every width
 * setting as identical and every comparison as zero. Worth saying out loud:
 * it is the fixture that is wrong in that case, not the measurement.
 */
function stereoPair(seconds = 1, seed = 0x5a7) {
  const rng = mulberry32(seed);
  const length = Math.round(rate * seconds);
  const left = new Float32Array(length);
  const right = new Float32Array(length);

  for (let i = 0; i < length; i += 1) {
    const mid = Math.sin((2 * Math.PI * 180 * i) / rate) * 0.35;
    const side = (rng() * 2 - 1) * 0.3;
    left[i] = mid + side;
    right[i] = mid - side;
  }
  return { left, right };
}

test('every gap comes back in the same shape', () => {
  const material = new Float32Array(rate);
  const rng = mulberry32(0x5a7);
  for (let i = 0; i < material.length; i += 1) material[i] = (rng() * 2 - 1) * 0.4;
  const pair = stereoPair();

  const pairs = [
    [curveReading([{ type: 'peaking', frequency: 800, gain: 6, q: 1, on: true }], rate),
     curveReading([{ type: 'peaking', frequency: 800, gain: 0, q: 1, on: true }], rate)],
    [reductionReading(material, rate, { ...COMP_DEFAULTS, threshold: -30, ratio: 8 }),
     reductionReading(material, rate, { ...COMP_DEFAULTS, threshold: -10, ratio: 2 })],
    [decayReading('reverb', roomProfile(rate, { ...VERB_DEFAULTS, decay: 2.5 }), { state: 1 }),
     decayReading('reverb', roomProfile(rate, { ...VERB_DEFAULTS, decay: 0.5 }), { state: 2 })],
    [stereoReading(pair.left, pair.right, rate, { ...STEREO_DEFAULTS, low: 2, mid: 2 }),
     stereoReading(pair.left, pair.right, rate, { ...STEREO_DEFAULTS, low: 0.2, mid: 0.2 })],
    [harmonicsReading(rate, { ...HEAT_DEFAULTS, drive: 18, bias: 0.6 }),
     harmonicsReading(rate, { ...HEAT_DEFAULTS, drive: 4, bias: 0 })],
  ];

  for (const [mine, theirs] of pairs) {
    const gap = distance(mine, theirs);

    assert.equal(typeof gap.off, 'number', `${mine.kind} gap has no size`);
    assert.ok(gap.off >= 0, `${mine.kind} gap is negative`);
    assert.ok(Number.isFinite(gap.off), `${mine.kind} gap is ${gap.off}`);
    // Always a label, never an index. The saturator's used to hand back the
    // number 3 and leave every caller to phrase it.
    assert.ok(gap.where === null || typeof gap.where === 'string',
      `${mine.kind} gap addresses itself as ${JSON.stringify(gap.where)}`);
    assert.equal(typeof gap.detail, 'object', `${mine.kind} gap has no detail`);

    // And nothing is out by nothing: these pairs are a long way apart.
    assert.ok(gap.off > 0.5, `${mine.kind} read two very different things as the same`);
  }
});

test('a reading against itself is no distance at all', () => {
  const curve = curveReading([{ type: 'peaking', frequency: 800, gain: 4, q: 1, on: true }], rate);
  assert.equal(distance(curve, curve).off, 0);

  const heat = harmonicsReading(rate, { ...HEAT_DEFAULTS, drive: 14, bias: 0.4 });
  assert.equal(distance(heat, heat).off, 0);
});

/* --- the split that started this ------------------------------------------ */

test('the compressor reading is the framed one, and the scorer agrees with it', () => {
  // The assertion that would have caught it. The compressor's display reading
  // and its scoring reading were different types - per-sample gain reduction
  // against the same thing framed at five milliseconds - and both were called
  // "the reading". Composing a chain report out of these would have inherited
  // a quarter of a million floats and a shape nothing else in the app has.
  const rng = mulberry32(0x5a7);
  const material = new Float32Array(rate * 2);
  for (let i = 0; i < material.length; i += 1) {
    material[i] = (rng() * 2 - 1) * 0.45 * (1 + Math.sin((2 * Math.PI * 4 * i) / rate));
  }

  const frames = Math.ceil(material.length / Math.round((FRAME_MS / 1000) * rate));

  for (let n = 0; n < 40; n += 1) {
    const mine = {
      ...COMP_DEFAULTS,
      threshold: -40 + rng() * 34,
      ratio: 1.2 + rng() * 16,
      attack: 0.5 + rng() * 60,
      release: 40 + rng() * 400,
    };
    const theirs = {
      ...COMP_DEFAULTS,
      threshold: -40 + rng() * 34,
      ratio: 1.2 + rng() * 16,
      attack: 0.5 + rng() * 60,
      release: 40 + rng() * 400,
    };

    const a = reductionReading(material, rate, mine);
    const b = reductionReading(material, rate, theirs);

    assert.equal(a.values.gr.length, frames, 'the reading is framed, not per-sample');

    // What the exercise used to compute by hand, before the reading had a
    // shape: two passes, framed, compared frame by frame.
    const mineFrames = meanFrames(analyse(material, rate, mine).gr, rate, FRAME_MS);
    const theirsFrames = meanFrames(analyse(material, rate, theirs).gr, rate, FRAME_MS);
    let sum = 0;
    for (let i = 0; i < mineFrames.length; i += 1) {
      sum += (mineFrames[i] - theirsFrames[i]) ** 2;
    }
    const byHand = Math.sqrt(sum / mineFrames.length);

    assert.ok(Math.abs(distance(a, b).off - byHand) < 1e-9,
      `pair ${n}: the contract says ${distance(a, b).off}, the old arithmetic says ${byHand}`);
  }
});

test('the compressor gap says whether it is amount or timing that is out', () => {
  const rng = mulberry32(0xbeef);
  const material = new Float32Array(rate);
  for (let i = 0; i < material.length; i += 1) {
    material[i] = (rng() * 2 - 1) * 0.45 * (1 + Math.sin((2 * Math.PI * 4 * i) / rate));
  }

  const base = { ...COMP_DEFAULTS, threshold: -22, ratio: 4, attack: 10, release: 200 };
  const read = (over) => reductionReading(material, rate, { ...base, ...over });

  // A much lower threshold does more reduction everywhere: that is amount.
  const harder = distance(read({ threshold: -38 }), read({}));
  assert.equal(harder.where, 'amount');
  assert.ok(harder.detail.depth < 0, 'and yours works harder, so the depth is negative');

  // The same threshold and ratio with a very different release moves when the
  // reduction arrives and leaves, not how much of it there is.
  const slower = distance(read({ release: 900 }), read({ release: 45 }));
  assert.equal(slower.where, 'timing');
  assert.ok(slower.detail.shape > Math.abs(slower.detail.depth));
});

/* --- what the gaps address ------------------------------------------------ */

test('a curve gap names the frequency the two part company at', () => {
  const flat = curveReading([], rate);
  const bumped = curveReading(
    [{ type: 'peaking', frequency: 1000, gain: 8, q: 4, on: true }], rate);

  const gap = distance(bumped, flat);
  assert.ok(Math.abs(gap.off - 8) < 0.3, `the worst point read ${gap.off.toFixed(2)} dB`);
  assert.ok(gap.detail.hz > 850 && gap.detail.hz < 1200, `it was found at ${gap.detail.hz}`);
  assert.match(gap.where, /^1\.?0?k?|^9[0-9][0-9] Hz/);
  assert.ok(gap.detail.louder > 0, 'and yours is the louder of the two there');

  // Read at the same 96 points the scoring has always used, on the axis the
  // reading carries.
  assert.equal(bumped.values.length, JUDGED_HZ.length);
  assert.equal(bumped.of.axis.n, 96);
});

/* --- the window between asking and knowing -------------------------------- */

/**
 * A tool that behaves the way the expensive ones do.
 *
 * Three of the six cannot measure themselves in a frame - reading a stereo
 * bar in six bands, or a harmonic series off a curve, is tens of milliseconds
 * - so they sit behind a debounce and there is always a window where the
 * controls have moved and the measurement has not caught up. That window is
 * where all three of the shipping stale-reading bugs lived.
 *
 * This is that window, made explicit and testable without a browser.
 */
function slowTool() {
  let settings = { drive: 0 };
  let reading = null;
  // A tool that has just been built owes a measurement, the same as one whose
  // controls have just moved. The real ones all measure once in their
  // constructor for exactly this reason.
  let pending = true;
  let passes = 0;

  const state = () => ({ ...settings });

  const measure = () => {
    passes += 1;
    reading = readingOf({
      tool: 'fake',
      kind: 'harmonics',
      of: { state: stampOf(state()), source: 'loop', axis: { kind: 'harmonics', ids: [2, 3] } },
      values: { harmonics: { 2: settings.drive, 3: settings.drive / 2 }, thd: settings.drive },
    });
    pending = false;
  };

  return {
    state,
    passes: () => passes,
    set(next) { settings = { ...settings, ...next }; pending = true; },
    /** The debounce firing. */
    settle() { if (pending) measure(); },

    read() {
      const of = {
        state: stampOf(state()),
        source: 'loop',
        axis: { kind: 'harmonics', ids: [2, 3] },
      };
      if (!reading) return notReady({ tool: 'fake', kind: 'harmonics', of });
      if (reading.of.state !== of.state) return { ...reading, of, ready: false };
      return reading;
    },

    async readNow() {
      measure();
      return this.read();
    },
  };
}

test('read() never returns null, and never calls a stale value current', () => {
  const tool = slowTool();

  // Before anything has been measured at all.
  const first = tool.read();
  assert.notEqual(first, null);
  assert.equal(first.ready, false);
  assert.equal(first.values, null);
  assert.equal(first.kind, 'harmonics', 'and it still knows what it is');

  tool.settle();
  assert.equal(tool.read().ready, true);
  assert.equal(tool.read().values.thd, 0);

  // Now the window: the control has moved and the measurement has not.
  tool.set({ drive: 12 });
  const during = tool.read();
  assert.equal(during.ready, false, 'a reading of settings that have moved is not ready');
  assert.equal(during.values.thd, 0, 'and it hands back what it has, not nothing');
  assert.equal(during.of.state, stampOf(tool.state()),
    'the envelope says what it is a reading of now, so a poller can tell');

  tool.settle();
  assert.equal(tool.read().ready, true);
  assert.equal(tool.read().values.thd, 12);
});

test('readNow() is always current, whatever the window was doing', async () => {
  const tool = slowTool();

  tool.set({ drive: 7 });
  assert.equal(tool.read().ready, false);

  const now = await tool.readNow();
  assert.equal(now.ready, true);
  assert.equal(now.values.thd, 7);
  assert.ok(isCurrent(now, tool.state()));

  // This is the rule that keeps "the panel showed a stale number for a frame"
  // from becoming "you were marked on a stale number". A UI may poll `read()`
  // and render "measuring…"; nothing that produces a score may.
  tool.set({ drive: 3 });
  const marked = await tool.readNow();
  assert.equal(marked.values.thd, 3);
  assert.equal(marked.of.state, stampOf(tool.state()));
});

test('a not-ready reading is refused by the comparator rather than compared', () => {
  const tool = slowTool();
  tool.settle();
  const settled = tool.read();

  tool.set({ drive: 20 });
  const stale = tool.read();

  assert.equal(stale.ready, false);
  assert.match(comparable(settled, stale), /not been measured/);
  assert.throws(() => distance(settled, stale), /cannot be compared/);
});

test('a gap is normalised however its comparator phrased it', () => {
  // `gapOf` is the one place the shape is enforced, so the five comparators
  // can each return what is natural to them.
  assert.deepEqual(gapOf({ off: -4 }), { off: 4, where: null, detail: {} });
  assert.deepEqual(gapOf({ off: 2, where: '3rd harmonic', detail: { louder: -2 } }),
    { off: 2, where: '3rd harmonic', detail: { louder: -2 } });
});
