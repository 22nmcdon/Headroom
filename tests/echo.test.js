import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ECHO_DEFAULTS, DIVISIONS, SYNC_DIVISIONS, MOST_FEEDBACK, LONGEST_TIME,
  SHORTEST_TIME, MOST_OFFSET, PING_FROM, HEAD_PATTERNS,
  makeEcho, repeatsOf, echoProfile, timeOf, nearestDivision, repeatsReading,
  MACHINES, machineTone, BBD_STAGES, MACHINE_FLOOR, MACHINE_CEILING, echoCore,
  wanderReading, WANDER_BANDS,
} from '../src/plugins/delay/line.js';
import { WOW_RATE, FLUTTER_RATE } from '../src/plugins/delay/dsp.js';
import { echoSource } from '../src/plugins/delay/node.js';
import { distance } from '../src/gap.js';
import { comparable } from '../src/lib/read.js';
import { mulberry32 } from '../src/lib/random.js';
import { NEAR, MISS } from '../src/learn/work/scoring.js';
import {
  monoOf, bandOf, profileDistance, RESPONSE_BANDS, decayProfile, wetDryImpulse,
  decayReading,
} from '../src/lib/response.js';
import { LOOP_BEAT } from '../src/core/audio.js';
import { ECHO_WORK as delay, ECHO_EXERCISES } from '../src/learn/work/delay.js';
import { makePuzzle as gameOf } from '../src/learn/game.js';

const rate = 48000;
const echo = (params) => makeEcho(rate, { ...ECHO_DEFAULTS, ...params });

/** The spikes in a response: where they are and how tall. */
function spikes(samples, least = 0.02) {
  let peak = 0;
  for (const value of samples) peak = Math.max(peak, Math.abs(value));

  const found = [];
  let guard = 0;
  for (let i = 0; i < samples.length; i += 1) {
    if (guard > 0) { guard -= 1; continue; }
    if (Math.abs(samples[i]) > peak * least) {
      found.push({ ms: (i / rate) * 1000, level: Math.abs(samples[i]) / peak });
      guard = Math.round(rate * 0.01);
    }
  }
  return found;
}

/* --- the repeats ---------------------------------------------------------- */

test('the repeats land exactly where the time says', () => {
  for (const time of [125, 250, 375, 625]) {
    const found = spikes(monoOf(echo({ time, feedback: 0.5, tone: 20000, lowCut: 20 }))).slice(0, 4);
    assert.ok(found.length >= 3, `only ${found.length} repeats at ${time} ms`);

    found.forEach((spike, n) => {
      assert.ok(Math.abs(spike.ms - time * (n + 1)) < 1,
        `repeat ${n + 1} of a ${time} ms delay landed at ${spike.ms.toFixed(1)} ms`);
    });
  }
});

test('feedback is the ratio between one repeat and the next', () => {
  for (const feedback of [0.2, 0.45, 0.7]) {
    const found = spikes(monoOf(echo({ time: 250, feedback, tone: 20000, lowCut: 20 })), 0.005);
    assert.ok(found.length >= 3, `${feedback} of feedback gave ${found.length} repeats`);

    for (let i = 1; i < Math.min(4, found.length); i += 1) {
      const ratio = found[i].level / found[i - 1].level;
      assert.ok(Math.abs(ratio - feedback) < 0.02,
        `repeat ${i + 1} was ${ratio.toFixed(3)} of the one before, not ${feedback}`);
    }
  }
});

test('the filters are inside the loop, so each repeat is darker than the last', () => {
  const topOf = (tone) => {
    const high = bandOf(monoOf(echo({ time: 250, feedback: 0.65, tone })), rate, RESPONSE_BANDS[2]);
    const around = (n) => {
      const from = Math.max(0, Math.round(rate * 0.25 * n) - 200);
      let energy = 0;
      for (let i = from; i < Math.min(high.length, from + rate * 0.05); i += 1) energy += high[i] * high[i];
      return energy;
    };
    return 10 * Math.log10(around(4) / around(1));
  };

  // A tone control outside the loop would take the same off every repeat and
  // this would be flat; inside it, it takes a little more off every time.
  const open = topOf(20000);
  const dark = topOf(1200);
  assert.ok(dark < open - 30,
    `rolled right off, the fourth repeat should lose far more top: ${open.toFixed(1)} against ${dark.toFixed(1)} dB`);
});

test('ping-pong walks the repeats from one ear to the other', () => {
  const sideOf = (pingPong) => {
    const ir = echo({ time: 250, feedback: 0.6, pingPong, tone: 20000, lowCut: 20 });
    return [1, 2, 3].map((n) => {
      const from = Math.max(0, Math.round(rate * 0.25 * n) - 200);
      let left = 0;
      let right = 0;
      for (let i = from; i < Math.min(ir.length, from + rate * 0.05); i += 1) {
        left += ir.channels[0][i] ** 2;
        right += ir.channels[1][i] ** 2;
      }
      return 10 * Math.log10((left + 1e-20) / (right + 1e-20));
    });
  };

  for (const side of sideOf(false)) assert.ok(Math.abs(side) < 0.5, 'without it the ears agree');

  const walked = sideOf(true);
  assert.ok(walked[0] > 20, 'the first repeat should be on the left');
  assert.ok(walked[1] < -20, 'and the second on the right');
  assert.ok(walked[2] > 20, 'and the third back on the left');
});

/** The tallest sample anywhere near where the first repeat should land. */
function firstRepeat(ir, time) {
  const at = Math.round((time / 1000) * rate);
  let peak = 0;
  for (const channel of ir.channels) {
    for (let i = Math.max(0, at - 4); i <= at + 4 && i < ir.length; i += 1) {
      peak = Math.max(peak, Math.abs(channel[i]));
    }
  }
  return peak;
}

test('one repeat comes back at the level it went in, whatever the feedback', () => {
  // This was normalised to total energy, and that put the feedback knob on
  // the first repeat's level: measured at 375 ms, the first repeat went from
  // -3.01 dB at no feedback to -7.45 dB at the most on offer. Subtract the
  // constant 3.01 that summing two channels costs and the feedback-dependent
  // part is 4.44 dB, which is exactly the sqrt(1 - g^2) that normalising a
  // comb to its energy predicts.
  //
  // Backwards, in other words: turning the feedback up made the first repeat
  // quieter, so somebody learning to hear how much feedback was on had a
  // level cue pointing the wrong way bundled with the repeat count. Hardware
  // does not do this - a Space Echo's Echo Level and its Intensity are two
  // separate controls - and neither does this any more.
  for (const feedback of [0, 0.2, 0.35, 0.5, 0.65, MOST_FEEDBACK]) {
    const ir = echo({ feedback, time: 375 });
    const peak = firstRepeat(ir, 375);
    assert.ok(Math.abs(peak - 1) < 1e-6,
      `at feedback ${feedback} the first repeat came back at ${peak.toFixed(6)}`);
  }
});

test('and whatever the loop is filtered with', () => {
  // Because the filters are in the feedback path and the output tap is not
  // behind them: the first repeat is the sound that went in, and the second
  // is the first one filtered once. A delay whose first repeat got darker as
  // the tone came down would be a low-pass on the whole wet path wearing a
  // feedback knob.
  for (const tone of [500, 2000, 6000, 20000]) {
    for (const lowCut of [20, 200, 800]) {
      const ir = echo({ tone, lowCut, time: 375, feedback: 0.5 });
      const peak = firstRepeat(ir, 375);
      assert.ok(Math.abs(peak - 1) < 1e-6,
        `tone ${tone}, low cut ${lowCut}: the first repeat came back at ${peak.toFixed(6)}`);
    }
  }
});

test('more feedback is more sound, which is what more feedback is', () => {
  const energyOf = (ir) => {
    let energy = 0;
    for (const channel of ir.channels) {
      for (let i = 0; i < ir.length; i += 1) energy += channel[i] ** 2;
    }
    return energy;
  };

  let last = 0;
  for (const feedback of [0, 0.2, 0.4, 0.6, MOST_FEEDBACK]) {
    const energy = energyOf(echo({ feedback, time: 375 }));
    assert.ok(energy > last, `feedback ${feedback} held no more sound than the step below it`);
    last = energy;
  }
});

test('the decay reading is blind to level, and the wet-dry mix is not', () => {
  // Two halves, and getting them the wrong way round is the mistake this
  // test was written to make. `decayProfile` divides every band by the whole
  // response's energy, so the wet response at any level reads identically -
  // which is why removing the normalisation looked free.
  //
  // It is not quite free, because `wetDryImpulse` puts the dry path in as one
  // unity sample at the front and does not scale it. So the wet's absolute
  // level survives as the wet-dry balance, and the reading does move.
  // Measured, how far apart two settings read before the change and after:
  //
  //     a quarter against a dotted eighth    4.476 -> 4.525
  //     a quarter against an eighth          8.561 -> 8.769
  //     feedback 0.2 against 0.6            10.379 -> 10.733
  //     feedback 0.5 against 0.55            1.619 -> 1.680
  //     tone 2k against 8k                   5.050 -> 5.164
  //     the same setting twice               0.000 -> 0.000
  //
  // Everything moved outward, by about four per cent of itself. Against
  // tolerances of 2.6, 1.9 and 1.2 dB that is a boundary moving by some
  // hundredths where it matters - the 0.354 is on a pair ten decibels apart,
  // which misses either way - and an exact answer still reads exactly zero.
  const settings = { ...ECHO_DEFAULTS, time: 375, feedback: 0.5 };
  const wet = makeEcho(rate, settings);
  const plain = decayProfile(monoOf(wet), rate);

  for (const scale of [0.1, 0.5, 2, 10]) {
    const loud = makeEcho(rate, settings);
    for (const channel of loud.channels) {
      for (let i = 0; i < loud.length; i += 1) channel[i] *= scale;
    }

    const read = decayProfile(monoOf(loud), rate);
    for (const band of RESPONSE_BANDS) {
      for (let i = 0; i < plain[band.id].length; i += 1) {
        assert.ok(Math.abs(plain[band.id][i] - read[band.id][i]) < 1e-6,
          `at ${scale} times the level, ${band.id} read differently`);
      }
    }
  }

  // And the other half, said out loud so nobody concludes from the first one
  // that the wet level is free: with the dry mixed in, it is not.
  const quiet = makeEcho(rate, settings);
  for (const channel of quiet.channels) {
    for (let i = 0; i < quiet.length; i += 1) channel[i] *= 0.1;
  }
  const withDry = decayProfile(wetDryImpulse(quiet, settings.mix), rate);
  const asIs = echoProfile(rate, settings);
  let moved = 0;
  for (const band of RESPONSE_BANDS) {
    for (let i = 0; i < asIs[band.id].length; i += 1) {
      moved = Math.max(moved, Math.abs(asIs[band.id][i] - withDry[band.id][i]));
    }
  }
  assert.ok(moved > 0.1,
    'a tenth of the wet level against a fixed dry should read differently, and it moved '
    + `by ${moved.toFixed(4)} dB`);
});

test('the repeats a setting predicts are the repeats it makes', () => {
  const settings = { ...ECHO_DEFAULTS, time: 300, feedback: 0.5, tone: 20000, lowCut: 20 };
  const said = repeatsOf(settings);
  const found = spikes(monoOf(makeEcho(rate, settings)), 0.005);

  assert.ok(said.length >= 3);
  for (let i = 0; i < Math.min(3, found.length); i += 1) {
    assert.ok(Math.abs(said[i].at * 1000 - found[i].ms) < 1,
      `it said repeat ${i + 1} would be at ${(said[i].at * 1000).toFixed(0)} ms and it was at ${found[i].ms.toFixed(0)}`);
  }
});

/* --- note values ---------------------------------------------------------- */

test('a note value is a length of this track, and can be found again from one', () => {
  for (const division of SYNC_DIVISIONS) {
    if (division.beats === null) continue;
    const ms = timeOf(division.beats);
    assert.ok(Math.abs(ms - division.beats * LOOP_BEAT * 1000) < 1e-6);

    const found = nearestDivision(ms);
    assert.equal(found.division.id, division.id, `${division.label} came back as ${found.division.id}`);
    assert.ok(found.off < 1e-9);
  }
});

test('the note values the ear is asked about are far enough apart to name', () => {
  // Every adjacent pair at least a third apart. A dotted eighth and a quarter
  // triplet are twelve per cent apart, which is a difference you can measure
  // and not one anybody names by ear - so that pair is not asked about.
  const times = DIVISIONS.map((d) => timeOf(d.beats)).sort((a, b) => a - b);
  for (let i = 1; i < times.length; i += 1) {
    assert.ok(times[i] / times[i - 1] >= 1.3,
      `${times[i - 1].toFixed(0)} and ${times[i].toFixed(0)} ms are too close to tell apart`);
  }
});

test('the reading tells one note value from its neighbour', () => {
  const base = { ...ECHO_DEFAULTS, feedback: 0.45 };
  const profiles = DIVISIONS.map((d) => echoProfile(rate, { ...base, time: timeOf(d.beats) }));

  for (let i = 1; i < profiles.length; i += 1) {
    const apart = profileDistance(profiles[i], profiles[i - 1]);
    assert.ok(apart > 3.5,
      `${DIVISIONS[i - 1].label} and ${DIVISIONS[i].label} read only ${apart.toFixed(2)} dB apart`);
  }
});

/* --- the mode ------------------------------------------------------------- */

test('matching is marked on how it dies away, and knows a wrong note when it hears one', () => {
  const answer = { ...ECHO_DEFAULTS, time: timeOf(0.5), feedback: 0.55, mix: 0.3 };
  const puzzle = { settings: { exercise: 'match' }, answer };

  assert.ok(delay.score(answer, { ...puzzle, tier: 'hard' }).correct, 'its own answer passes');
  assert.match(delay.score(answer, { ...puzzle, tier: 'hard' }).cells[1].text, /that is the delay/);

  const long = delay.score({ ...answer, time: answer.time * 1.5 }, { ...puzzle, tier: 'easy' });
  assert.ok(!long.correct, 'a whole note value out is not a match');
  assert.match(long.cells[1].text, /too long$/);

  const short = delay.score({ ...answer, time: answer.time / 1.5 }, { ...puzzle, tier: 'easy' });
  assert.match(short.cells[1].text, /too short$/);
});

test('finding the time lands you on one note value and not its neighbour', () => {
  for (const tier of ['easy', 'medium', 'hard']) {
    for (const target of DIVISIONS) {
      const answer = { ...ECHO_DEFAULTS, time: timeOf(target.beats), division: target.label };
      const puzzle = { settings: { exercise: 'find' }, answer };

      const exact = delay.score({ ...ECHO_DEFAULTS, time: answer.time }, { ...puzzle, tier: tier });
      assert.ok(exact.correct, `${tier} did not accept ${target.label}`);
      assert.match(exact.cells[0].text, /locked to the track/);

      for (const other of DIVISIONS) {
        if (other.id === target.id) continue;
        const wrong = delay.score({ ...ECHO_DEFAULTS, time: timeOf(other.beats) }, { ...puzzle, tier: tier });
        assert.ok(!wrong.correct,
          `${tier} accepted ${other.label} as ${target.label}`);
      }
    }
  }
});

test('finding the time says which way to move, and nothing about the tempo', () => {
  const answer = { ...ECHO_DEFAULTS, time: timeOf(0.5), division: '1/8' };
  const puzzle = { settings: { exercise: 'find' }, answer };

  const long = delay.score({ ...ECHO_DEFAULTS, time: answer.time * 1.5 }, { ...puzzle, tier: 'easy' });
  assert.match(long.cells[0].text, /^50% out$/);
  assert.match(long.cells[1].text, /^too long$/);

  // And it does not name the note value until you have found it, because the
  // note value is the question.
  for (const cell of long.cells) assert.doesNotMatch(cell.text, /1\/8|1\/4|1\/16|triplet|dotted/);
  assert.match(delay.score({ ...ECHO_DEFAULTS, time: answer.time }, { ...puzzle, tier: 'easy' }).cells[1].text, /1\/8/);
});

test('the targets are never the delay the plugin opens on', () => {
  for (const tier of ['easy', 'medium', 'hard']) {
    for (let i = 0; i < 8; i += 1) {
      let a = (i + 1) * 2654435761 + tier.length;
      const rng = () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };

      const { answer } = delay.makePuzzle(rng, tier, { exercise: 'match' });
      const puzzle = { settings: { exercise: 'match' }, answer };
      assert.ok(!delay.score({ ...ECHO_DEFAULTS }, { ...puzzle, tier: tier }).correct,
        `${tier} drew a target the opening settings already match`);
    }
  }
});

/* --- the two sides ---------------------------------------------------------- */

test('an offset puts the right side on its own time', () => {
  const ir = echo({ time: 300, offset: 90, feedback: 0.45, tone: 20000, lowCut: 20 });
  const left = spikes(ir.channels[0], 0.02).map((s) => Math.round(s.ms));
  const right = spikes(ir.channels[1], 0.02).map((s) => Math.round(s.ms));

  assert.deepEqual(left.slice(0, 3), [300, 600, 900], `left landed at ${left.join(', ')}`);
  assert.deepEqual(right.slice(0, 3), [390, 780, 1170], `right landed at ${right.join(', ')}`);
});

test('a negative offset is the right side arriving first', () => {
  const ir = echo({ time: 300, offset: -80, feedback: 0.4, tone: 20000, lowCut: 20 });
  const right = spikes(ir.channels[1], 0.02).map((s) => Math.round(s.ms));
  assert.deepEqual(right.slice(0, 2), [220, 440], `right landed at ${right.join(', ')}`);
});

test('no offset is the two sides on the same time, to the sample', () => {
  const ir = echo({ time: 375, offset: 0, feedback: 0.5 });
  let worst = 0;
  for (let i = 0; i < ir.length; i += 1) {
    worst = Math.max(worst, Math.abs(ir.channels[0][i] - ir.channels[1][i]));
  }
  assert.equal(worst, 0, 'the two sides should be identical with no offset and no ping-pong');
});

test('an offset never asks for a time the knob could not reach', () => {
  // The right side is the time plus the offset, and both ends of that have to
  // stay inside the range a delay is allowed to be - a 1500 ms delay with a
  // positive offset would otherwise want a line longer than anything else in
  // this app will render.
  for (const [time, offset] of [[LONGEST_TIME, 150], [SHORTEST_TIME, -150], [30, -150]]) {
    const ir = echo({ time, offset, feedback: 0.3, tone: 20000, lowCut: 20 });
    const right = spikes(ir.channels[1], 0.02);
    assert.ok(right.length > 0, `time ${time} with offset ${offset} made no repeats at all`);
    const first = right[0].ms;
    assert.ok(first >= SHORTEST_TIME - 1 && first <= LONGEST_TIME + 1,
      `time ${time} with offset ${offset} put the first right repeat at ${first.toFixed(1)} ms`);
  }
});

test('ping-pong can be started from either side', () => {
  for (const [from, first, second] of [['left', 0, 1], ['right', 1, 0]]) {
    const ir = echo({
      time: 250, feedback: 0.5, pingPong: true, pingPongFrom: from, tone: 20000, lowCut: 20,
    });
    const starts = spikes(ir.channels[first], 0.02).map((s) => Math.round(s.ms));
    const answers = spikes(ir.channels[second], 0.02).map((s) => Math.round(s.ms));

    assert.equal(starts[0], 250, `from the ${from}, the first repeat should be on that side`);
    assert.equal(answers[0], 500, `from the ${from}, the second should be on the other`);
  }
});

test('an uneven ping-pong walks on two different legs', () => {
  // Ping-pong with an offset: the signal goes left for one time and right for
  // the other, so the repeats are not evenly spaced - which is what a dotted
  // ping-pong is, and the reason the two are allowed together.
  const ir = echo({
    time: 200, offset: 100, feedback: 0.5, pingPong: true, tone: 20000, lowCut: 20,
  });
  const left = spikes(ir.channels[0], 0.02).map((s) => Math.round(s.ms));
  const right = spikes(ir.channels[1], 0.02).map((s) => Math.round(s.ms));

  // 200 left, then 200+300 right, then 400+300 left, then 400+600 right.
  assert.deepEqual(left.slice(0, 2), [200, 700], `left landed at ${left.join(', ')}`);
  assert.deepEqual(right.slice(0, 2), [500, 1000], `right landed at ${right.join(', ')}`);
});

test('the repeats a two-sided setting predicts are the repeats it makes', () => {
  // The same contract the single-sided version is held to, across the four
  // routings - because `repeatsOf` is what anything drawing a delay reads,
  // and a drawing that disagreed with the sound would be worse than none.
  for (const params of [
    { offset: 0 },
    { offset: 90 },
    { offset: -60 },
    { pingPong: true },
    { pingPong: true, offset: 100 },
    { pingPong: true, pingPongFrom: 'right' },
  ]) {
    const settings = {
      ...ECHO_DEFAULTS, time: 250, feedback: 0.5, tone: 20000, lowCut: 20, ...params,
    };
    // Every spike that arrived has to be one this predicted, which is the
    // claim. Not that the two lists are the same length: `spikes` ignores
    // anything within ten milliseconds of the last thing it found, and two
    // sides sixty milliseconds apart really do put a repeat at 750 and
    // another at 760. Those two are one spike to the helper and, at ten
    // milliseconds, very nearly one sound to anybody - which is the whole
    // reason an offset this small is a width control rather than an echo.
    // The predicted list is not filtered by level, and that is deliberate. A
    // floor on it would be a floor per repeat, where `spikes` puts one on the
    // summed waveform - and repeats coincide: two sides and four heads put a
    // left repeat at 0.0078 and a right one at 0.0156 both at 3000 ms, which
    // sum past a floor that either of them alone sits under. `repeatsOf`
    // stops a thousandth of the way down, far below the half-per-cent
    // `spikes` works at, so the unfiltered list is a safe superset.
    const said = repeatsOf(settings);
    const found = spikes(monoOf(makeEcho(rate, settings)), 0.02);

    assert.ok(found.length >= 3, `${JSON.stringify(params)}: only ${found.length} repeats made`);
    for (const spike of found) {
      const near = said.reduce(
        (best, r) => (Math.abs(r.at * 1000 - spike.ms) < Math.abs(best.at * 1000 - spike.ms)
          ? r : best),
        said[0],
      );
      assert.ok(Math.abs(near.at * 1000 - spike.ms) < 2,
        `${JSON.stringify(params)}: a repeat landed at ${spike.ms.toFixed(0)} ms and the `
        + `nearest one predicted was ${(near.at * 1000).toFixed(0)}`);
    }
  }
});

test('every routing says which side each repeat is on', () => {
  const plain = repeatsOf({ ...ECHO_DEFAULTS, time: 250, feedback: 0.5 });
  assert.ok(plain.every((r) => r.side === 'both'), 'a plain delay is on both sides at once');

  const ping = repeatsOf({ ...ECHO_DEFAULTS, time: 250, feedback: 0.5, pingPong: true });
  assert.deepEqual(ping.slice(0, 4).map((r) => r.side), ['left', 'right', 'left', 'right']);

  const offset = repeatsOf({ ...ECHO_DEFAULTS, time: 250, offset: 90, feedback: 0.5 });
  assert.ok(offset.some((r) => r.side === 'left'), 'an offset delay has a left of its own');
  assert.ok(offset.some((r) => r.side === 'right'), 'and a right');
});

/* --- heads ------------------------------------------------------------------ */

test('every head pattern ends on the time the knob says', () => {
  // The taps are fractions of the time rather than multiples of it, so the
  // knob always means the longest repeat. Multiples would have put the last
  // head of a four-head pattern four times further out than the number on
  // the control, and off the end of the range at anything over a third of it.
  for (const pattern of HEAD_PATTERNS) {
    assert.equal(pattern.taps[pattern.taps.length - 1], 1,
      `${pattern.id} does not end on the time`);
    for (const tap of pattern.taps) {
      assert.ok(tap > 0 && tap <= 1, `${pattern.id} has a tap at ${tap}`);
    }
    for (let i = 1; i < pattern.taps.length; i += 1) {
      assert.ok(pattern.taps[i] > pattern.taps[i - 1], `${pattern.id} is not in order`);
    }
  }
});

test('one head is the delay that was here before heads existed', () => {
  const was = echo({ time: 375, feedback: 0.5 });
  const now = echo({ time: 375, feedback: 0.5, heads: 'single' });
  let worst = 0;
  for (let i = 0; i < Math.min(was.length, now.length); i += 1) {
    worst = Math.max(worst, Math.abs(was.channels[0][i] - now.channels[0][i]));
  }
  assert.equal(worst, 0, 'a single head should be exactly the old single tap');
});

test('four equal heads are a rhythm, not a wash', () => {
  // Binson's drum: four heads equally spaced round it, so with the longest on
  // a quarter note the others land on a sixteenth, an eighth and a dotted
  // eighth. That is where the dotted-eighth guitar idiom comes from.
  const ir = echo({
    time: 400, feedback: 0.4, heads: 'heads4', tone: 20000, lowCut: 20,
  });
  const at = spikes(ir.channels[0], 0.05).map((s) => Math.round(s.ms));
  assert.deepEqual(at.slice(0, 4), [100, 200, 300, 400], `they landed at ${at.join(', ')}`);
});

test('three heads land where the hardware they come from puts them', () => {
  // UA's model of the RE-201 gives head ranges of 69-177, 131-337 and
  // 189-489 ms, which is 1 : 1.90 : 2.75 at either end of the sweep. Taken as
  // fractions of the longest, that is what these taps are. The folklore
  // ratio is 1 : 2 : 3, and this is not that.
  const ir = echo({
    time: 489, feedback: 0.4, heads: 'heads3', tone: 20000, lowCut: 20,
  });
  const at = spikes(ir.channels[0], 0.05).map((s) => Math.round(s.ms));
  assert.deepEqual(at.slice(0, 3), [178, 338, 489], `they landed at ${at.join(', ')}`);
});

test('a head pattern repeats as a whole', () => {
  // The feedback is taken from the longest head, so what goes round is the
  // pattern rather than one tap of it - which is what a tape loop with three
  // heads on it does.
  const ir = echo({
    time: 400, feedback: 0.5, heads: 'heads4', tone: 20000, lowCut: 20,
  });
  const at = spikes(ir.channels[0], 0.02).map((s) => Math.round(s.ms));
  assert.deepEqual(at.slice(0, 8), [100, 200, 300, 400, 500, 600, 700, 800],
    `they landed at ${at.join(', ')}`);
});

test('more heads is more sound, and each head arrives at full level', () => {
  // Every head is its own read of the same line, so each one comes back at
  // the level that went in - the same contract one head is held to. Nothing
  // is divided by the number of heads, because four heads on a Binson is
  // four heads of sound.
  const one = echo({ time: 400, feedback: 0.4, heads: 'single', tone: 20000, lowCut: 20 });
  const four = echo({ time: 400, feedback: 0.4, heads: 'heads4', tone: 20000, lowCut: 20 });

  const energyOf = (ir) => {
    let energy = 0;
    for (const channel of ir.channels) {
      for (let i = 0; i < ir.length; i += 1) energy += channel[i] ** 2;
    }
    return energy;
  };
  assert.ok(energyOf(four) > energyOf(one) * 2,
    'four heads should hold a good deal more sound than one');

  for (const ir of [one, four]) {
    const tallest = spikes(ir.channels[0], 0.05)[0];
    assert.ok(Math.abs(tallest.level - 1) < 1e-6,
      `the first head came back at ${tallest.level.toFixed(6)} rather than unity`);
  }
});

test('the repeats a head pattern predicts are the repeats it makes', () => {
  for (const params of [
    { heads: 'heads3' },
    { heads: 'heads4' },
    { heads: 'heads4', offset: 80 },
    { heads: 'heads3', pingPong: true },
    { heads: 'heads4', pingPong: true, pingPongFrom: 'right' },
  ]) {
    const settings = {
      ...ECHO_DEFAULTS, time: 400, feedback: 0.5, tone: 20000, lowCut: 20, ...params,
    };
    // The predicted list is not filtered by level, and that is deliberate. A
    // floor on it would be a floor per repeat, where `spikes` puts one on the
    // summed waveform - and repeats coincide: two sides and four heads put a
    // left repeat at 0.0078 and a right one at 0.0156 both at 3000 ms, which
    // sum past a floor that either of them alone sits under. `repeatsOf`
    // stops a thousandth of the way down, far below the half-per-cent
    // `spikes` works at, so the unfiltered list is a safe superset.
    const said = repeatsOf(settings);
    const found = spikes(monoOf(makeEcho(rate, settings)), 0.02);

    assert.ok(found.length >= 4, `${JSON.stringify(params)}: only ${found.length} repeats made`);
    for (const spike of found) {
      const near = said.reduce(
        (best, r) => (Math.abs(r.at * 1000 - spike.ms) < Math.abs(best.at * 1000 - spike.ms)
          ? r : best),
        said[0],
      );
      assert.ok(Math.abs(near.at * 1000 - spike.ms) < 2,
        `${JSON.stringify(params)}: a repeat landed at ${spike.ms.toFixed(0)} ms and the `
        + `nearest predicted was ${(near.at * 1000).toFixed(0)}`);
    }
  }
});

test('an unknown head pattern is one head rather than nothing', () => {
  const ir = echo({ time: 375, feedback: 0.4, heads: 'binson-mk-9' });
  const single = echo({ time: 375, feedback: 0.4, heads: 'single' });
  let worst = 0;
  for (let i = 0; i < ir.length; i += 1) {
    worst = Math.max(worst, Math.abs(ir.channels[0][i] - single.channels[0][i]));
  }
  assert.equal(worst, 0, 'a pattern nobody has heard of should fall back to one head');
});

/* --- the shape of a loop ---------------------------------------------------- */

const shapeOf = (over) => repeatsReading(rate, { ...ECHO_DEFAULTS, time: 400, feedback: 0.5, ...over });
const shapeGap = (a, b) => distance(shapeOf(a), shapeOf(b)).off;

test('the shape of a loop sees the heads and not the time', () => {
  // The whole reason this reading is in fractions of the loop rather than in
  // milliseconds. Framed in milliseconds it saw both at once and could not
  // tell them apart - a one per cent time error read half a wrong pattern and
  // three per cent read a whole one. The figures are in line.js.
  const base = { heads: 'heads4' };

  for (const time of [404, 440, 600]) {
    const off = shapeGap({ ...base, time }, base);
    assert.ok(off < 1, `a delay at ${time} ms read ${off.toFixed(2)} dB from one at 400`);
  }

  for (const heads of ['single', 'heads3']) {
    const off = shapeGap({ ...base, heads }, base);
    assert.ok(off > 15, `${heads} read only ${off.toFixed(2)} dB from four heads`);
  }
});

test('two delays on two different times are comparable as shapes', () => {
  // Which is what the axis having no time in it buys, and the thing that
  // would quietly stop working if somebody put the time back into it: an
  // axis is what refuses a comparison, so a time in it would refuse exactly
  // the comparison this reading exists to make.
  assert.equal(comparable(shapeOf({ time: 200 }), shapeOf({ time: 900 })), null);
});

test('and what time dependence is left is the loop filters ringing', () => {
  // Not quite blind, and worth knowing exactly why. With the loop opened
  // right up the reading is exactly time-invariant; with the filters in it
  // drifts, because their ringing is a fixed number of milliseconds and the
  // frames are a fraction of the loop. Eight milliseconds of a 120 Hz
  // high-pass is two fifths of a twenty millisecond loop and a two-hundredth
  // of a fifteen-hundred one. Measured:
  //
  //     pair            default loop    wide open loop
  //     380 vs 420          0.28 dB          0.00 dB
  //     400 vs 600          0.24 dB          0.00 dB
  //     300 vs 900          0.71 dB          0.00 dB
  //     200 vs 900          1.17 dB          0.00 dB
  //     20 vs 1500          5.97 dB          0.00 dB
  //
  // Against a tolerance of six and pattern differences above twenty, that is
  // nothing anywhere a match is actually played - two delays being compared
  // are on the same material and one is trying to be the other.
  const open = { tone: 20000, lowCut: 20 };
  for (const [a, b] of [[20, 1500], [200, 900], [400, 600]]) {
    assert.equal(distance(shapeOf({ time: a, ...open }), shapeOf({ time: b, ...open })).off, 0,
      `with the loop open, ${a} ms and ${b} ms should read identically`);
  }

  // And with the filters in, still small over any ratio a match sees.
  assert.ok(distance(shapeOf({ time: 300 }), shapeOf({ time: 900 })).off < 1.5);
});

test('the shape of a loop is blind to level, and to a ping-pong', () => {
  // Level, because every reading here is. Ping-pong because this reads the
  // two sides summed, and a ping-pong moves which ear a repeat is in without
  // moving when it arrives - the image reading is what sees that, and it is
  // better at it than this would be.
  assert.equal(shapeGap({ pingPong: true }, {}), 0);
  assert.equal(shapeGap({ mix: 0.9 }, { mix: 0.1 }), 0);
});

test('an offset is a change in the shape of the loop', () => {
  // Because it is: the right side's repeats stop landing on the left's grid.
  assert.ok(shapeGap({ offset: 40 }, {}) > 10);
});

test('the hard tier asks for a head pattern and the others do not', () => {
  const heads = (tier) => new Set(Array.from({ length: 40 }, (_, i) =>
    delay.makePuzzle(mulberry32(i * 7717), tier, { exercise: 'match' }).answer.heads ?? 'single'));

  assert.deepEqual([...heads('easy')], ['single'], 'the easy tier moved the heads');
  assert.deepEqual([...heads('medium')], ['single'], 'the medium tier moved the heads');
  assert.ok(heads('hard').size > 1, 'the hard tier never asked for more than one head pattern');
});

test('the right delay with the wrong heads is not the delay', () => {
  // The point of the second reading. The decay curve puts these 1.32 dB
  // apart at most and the tolerance is 1.2, so without this a wrong pattern
  // was a pass at two tiers out of three.
  const puzzle = {
    tier: 'hard',
    spec: { detail: true },
    settings: { exercise: 'match' },
    answer: {
      ...ECHO_DEFAULTS, time: 400, feedback: 0.5, tone: 6000, lowCut: 120, heads: 'heads4',
    },
  };

  const right = delay.score({ ...puzzle.answer }, puzzle);
  assert.equal(right.correct, true, 'the answer itself should be the answer');

  for (const heads of ['single', 'heads3']) {
    const wrong = delay.score({ ...puzzle.answer, heads }, puzzle);
    assert.equal(wrong.correct, false, `${heads} should not pass for four`);
    assert.match(wrong.cells[1].text, /wrong places/);
  }
});

test('a tier that asks for no pattern is marked as it always was', () => {
  // So that adding a second reading could not quietly move the easy and
  // medium tiers, where there is one head and nothing for it to say.
  const puzzle = {
    tier: 'easy',
    spec: { detail: false },
    settings: { exercise: 'match' },
    answer: { ...ECHO_DEFAULTS, time: 400, feedback: 0.5 },
  };
  assert.equal(delay.score({ ...puzzle.answer }, puzzle).correct, true);
  // And a guess that is close on the decay still passes, pattern or not -
  // there is only one pattern at this tier.
  const near = delay.score({ ...puzzle.answer, feedback: 0.52 }, puzzle);
  assert.equal(near.correct, true, 'a small feedback slip should still pass the easy tier');
});

/* --- diffusion -------------------------------------------------------------- */

test('no diffusion is the delay that was here before diffusion', () => {
  // Bit-identical, not nearly. The all-passes are in the loop at every
  // setting and their coefficient is what the knob moves, so at nothing they
  // are pure delays and the line is shortened by exactly as much as they add.
  // An all-pass at a coefficient of zero is `y = x[n-M]` with no arithmetic
  // left in it, so there is not even a rounding error to allow for.
  for (const over of [{}, { heads: 'heads4' }, { pingPong: true }, { offset: 60 }]) {
    const was = echo({ time: 375, feedback: 0.5, ...over });
    const now = echo({ time: 375, feedback: 0.5, diffusion: 0, ...over });
    let worst = 0;
    for (let i = 0; i < Math.min(was.length, now.length); i += 1) {
      worst = Math.max(worst, Math.abs(was.channels[0][i] - now.channels[0][i]));
    }
    assert.equal(worst, 0, `${JSON.stringify(over)}: diffusion at nothing changed the delay`);
  }
});

test('diffusion leaves the repeats where the time says', () => {
  // The whole reason the line is shortened: all-passes in a loop add their
  // own delay to it, and a diffusion knob that dragged the repeats late would
  // be a time knob wearing the wrong label.
  for (const diffusion of [0, 0.4, 1]) {
    const ir = echo({ time: 400, feedback: 0.45, diffusion, tone: 20000, lowCut: 20 });
    const at = spikes(ir.channels[0], 0.3).map((s) => Math.round(s.ms));
    assert.equal(at[0], 400, `at diffusion ${diffusion} the first repeat landed at ${at[0]}`);
  }
});

test('the first repeat is still the sound that went in', () => {
  // Unfiltered and at unity, which is what the output tap being in front of
  // the loop costs an extra buffer to keep. Diffusion smears what goes round
  // again, so the first repeat is clean and each one after it is smeared once
  // more - progressive, which is what moves an echo toward a room.
  for (const diffusion of [0, 0.5, 1]) {
    const ir = echo({ time: 400, feedback: 0.45, diffusion, tone: 2000, lowCut: 200 });
    const first = spikes(ir.channels[0], 0.3)[0];
    assert.ok(Math.abs(first.level - 1) < 1e-6,
      `at diffusion ${diffusion} the first repeat came back at ${first.level.toFixed(6)}`);
  }
});

test('more diffusion is more smear, and the loop reading sees it', () => {
  // The reading built for the head patterns, doing the other job it was built
  // for. A decay curve cannot see this either: diffusion moves energy about
  // inside the loop without changing how fast the loop dies away.
  const base = { ...ECHO_DEFAULTS, time: 400, feedback: 0.5, tone: 20000, lowCut: 20 };
  const shape = (diffusion) => repeatsReading(rate, { ...base, diffusion });

  let last = 0;
  for (const diffusion of [0.2, 0.4, 0.7, 1]) {
    const off = distance(shape(diffusion), shape(0)).off;
    assert.ok(off > last, `diffusion ${diffusion} smeared no more than the step below it`);
    last = off;
  }
  assert.ok(last > 3, `full diffusion only moved the loop reading ${last.toFixed(2)} dB`);
});

/** Where a pass's energy sits and how wide it is, around its nominal slot. */
function passOf(ir, ms, pass) {
  const from = Math.round(rate * ((pass * ms) / 1000 - 0.2));
  const to = Math.round(rate * ((pass * ms) / 1000 + 0.3));
  let energy = 0;
  let moment = 0;
  for (let i = from; i < to && i < ir.length; i += 1) {
    const v = ir.channels[0][i] ** 2;
    energy += v;
    moment += v * i;
  }
  if (energy < 1e-14) return null;

  let run = 0;
  let lo = from;
  let hi = to;
  for (let i = from; i < to && i < ir.length; i += 1) {
    run += ir.channels[0][i] ** 2;
    if (run > energy * 0.05) { lo = i; break; }
  }
  run = 0;
  for (let i = from; i < to && i < ir.length; i += 1) {
    run += ir.channels[0][i] ** 2;
    if (run > energy * 0.95) { hi = i; break; }
  }
  return { at: ((moment / energy) / rate) * 1000, width: ((hi - lo) / rate) * 1000 };
}

test('diffusion widens each pass without moving it', () => {
  // What smearing is, measured as what it does: the energy of a pass spreads
  // either side of its slot and its centre of gravity stays exactly on it.
  // That is the line being shortened by what the all-passes hold - without
  // it the repeats would drag later with every pass, and a diffusion knob
  // that slowed the delay down would be a time knob wearing the wrong label.
  //
  // Measured at 400 ms and 0.6 feedback, the middle ninety per cent of each
  // pass's energy:
  //
  //     diffusion   pass 1   pass 2   pass 3
  //     0             0 ms     0 ms     0 ms
  //     0.5           0 ms    30 ms    68 ms
  //     1             0 ms    80 ms   156 ms
  //
  // Pass one is clean at every setting, because the all-passes are in the
  // feedback path and it has not been through them. After that each pass is
  // smeared once more than the one before, which is the progression that
  // takes an echo toward a room.
  //
  // My first version of this test looked for energy halfway between the first
  // two repeats and found silence at every diffusion, which is correct: the
  // smear broadens each repeat by tens of milliseconds, it does not fill a
  // four-hundred millisecond gap.
  const widths = [];
  for (const diffusion of [0, 0.5, 1]) {
    const ir = echo({ time: 400, feedback: 0.6, diffusion, tone: 20000, lowCut: 20 });
    const row = [];
    for (const pass of [1, 2, 3]) {
      const found = passOf(ir, 400, pass);
      assert.ok(found, `at diffusion ${diffusion} pass ${pass} was silent`);
      assert.ok(Math.abs(found.at - pass * 400) < 2,
        `at diffusion ${diffusion} pass ${pass} sat at ${found.at.toFixed(0)} ms `
        + `rather than ${pass * 400}`);
      row.push(found.width);
    }
    assert.ok(row[0] < 1, `at diffusion ${diffusion} the first pass was ${row[0].toFixed(0)} ms wide`);
    widths.push(row);
  }

  // Clean stays clean, and every other pass widens with the knob and with
  // how many times it has been round.
  assert.deepEqual(widths[0].map((w) => Math.round(w)), [0, 0, 0]);
  for (const pass of [1, 2]) {
    assert.ok(widths[1][pass] > widths[1][pass - 1],
      'half diffusion should widen each pass more than the last');
    assert.ok(widths[2][pass] > widths[1][pass],
      'full diffusion should be wider than half at the same pass');
  }
});

test('a diffused loop at the most feedback still dies away', () => {
  // All-passes are unity gain, so they cannot make a stable loop unstable -
  // but a cascade of them with a coefficient near one is exactly where that
  // claim gets tested in practice, and the tail is truncated rather than
  // faded, so a loop that grew would show as a response that ends loud.
  const ir = echo({
    time: 120, feedback: MOST_FEEDBACK, diffusion: 1, tone: 20000, lowCut: 20,
  });
  let first = 0;
  let last = 0;
  const edge = Math.round(rate * 0.25);
  for (let i = 0; i < edge; i += 1) first = Math.max(first, Math.abs(ir.channels[0][i]));
  for (let i = ir.length - edge; i < ir.length; i += 1) {
    last = Math.max(last, Math.abs(ir.channels[0][i]));
  }
  assert.ok(last < first, `it ended at ${last.toFixed(4)} having started at ${first.toFixed(4)}`);
  assert.ok(Number.isFinite(last) && last < 2, 'and it did not run away');
});

test('the shortest delay can be diffused too', () => {
  // The all-passes are fractions of the loop, so a twenty millisecond delay
  // gets twenty millisecond-sized ones rather than a line of negative length.
  for (const time of [SHORTEST_TIME, 40, LONGEST_TIME]) {
    const ir = echo({ time, feedback: 0.4, diffusion: 1, tone: 20000, lowCut: 20 });
    let peak = 0;
    for (let i = 0; i < ir.length; i += 1) peak = Math.max(peak, Math.abs(ir.channels[0][i]));
    assert.ok(peak > 0.5, `a ${time} ms delay diffused came out at ${peak.toFixed(3)}`);
    assert.ok(Number.isFinite(peak), `a ${time} ms delay diffused came out ${peak}`);
  }
});

/* --- the pattern drill ------------------------------------------------------ */

const patternPuzzle = (tier, seed) =>
  delay.makePuzzle(mulberry32(seed), tier, { exercise: 'pattern' });

test('the pattern drill only ever asks about patterns its tier offers', () => {
  for (const tier of ['easy', 'medium', 'hard']) {
    const offered = new Set(delay.slots(tier, { exercise: 'pattern' })[0].options.map((o) => o.id));
    assert.ok(offered.size >= 2, `the ${tier} tier offers ${offered.size} patterns`);

    const asked = new Set();
    for (let seed = 0; seed < 60; seed += 1) {
      asked.add(patternPuzzle(tier, seed * 3121).answer.heads);
    }
    for (const id of asked) {
      assert.ok(offered.has(id), `the ${tier} tier asked about ${id} without offering it`);
    }
    assert.equal(asked.size, offered.size,
      `the ${tier} tier offers ${offered.size} patterns and asked about ${asked.size}`);
  }
});

test('every tier offers all three patterns, and gets harder by the material', () => {
  // Three patterns is all there are, so a tier offering fewer would be a
  // drill with two answers - and this app holds its drills to at least three,
  // so that no chip is worth always picking. An earlier version of this had
  // easy offering one head against four and tests/drill.test.js refused it,
  // which is the rule working.
  for (const tier of ['easy', 'medium', 'hard']) {
    assert.deepEqual(
      delay.slots(tier, { exercise: 'pattern' })[0].options.map((o) => o.id),
      ['single', 'heads3', 'heads4'],
    );
  }

  // What changes is the material: shorter, louder and smeared as it goes up.
  const times = ['easy', 'medium', 'hard'].map((tier) =>
    delay.exercises.pattern.startOf(patternPuzzle(tier, 11), tier));
  assert.ok(times[0].time > times[1].time && times[1].time > times[2].time,
    'the repeats should crowd as the tier goes up');
  assert.ok(times[2].diffusion > 0, 'and the hard tier should smear them');
});

test('every pattern a tier offers is plainly a different pattern', () => {
  // The fairness check, and the reason it is a test rather than a note: a
  // tier that crowded the repeats until two answers were the same sound
  // would be a question with two right answers. Measured on the loop
  // reading, every pair at every tier:
  //
  //     easy    (625 ms, fb 0.3)                single vs heads3   15.57 dB
  //                                             single vs heads4   19.07
  //                                             heads3 vs heads4   23.72
  //     medium  (469 ms, fb 0.45)               single vs heads3   17.10
  //                                             single vs heads4   20.93
  //                                             heads3 vs heads4   25.99
  //     hard    (313 ms, fb 0.55, diffuse 0.35) single vs heads3   23.05
  //                                             single vs heads4   27.53
  //                                             heads3 vs heads4   22.22
  //
  // Which also says what the tiers are doing. They are not getting closer
  // together - the hard tier is further apart than the medium one - they are
  // getting harder to count, because the repeats crowd and smear. That is a
  // difficulty the reading cannot measure and the ear can.
  for (const tier of ['easy', 'medium', 'hard']) {
    const ids = delay.slots(tier, { exercise: 'pattern' })[0].options.map((o) => o.id);
    const settings = delay.exercises.pattern.startOf(patternPuzzle(tier, 7), tier);

    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const off = distance(
          repeatsReading(rate, { ...settings, heads: ids[i] }),
          repeatsReading(rate, { ...settings, heads: ids[j] }),
        ).off;
        assert.ok(off > 10,
          `at ${tier}, ${ids[i]} and ${ids[j]} read only ${off.toFixed(2)} dB apart`);
      }
    }
  }
});

test('naming the pattern right is a hit, next door is gold, across is a miss', () => {
  // Ordered one, three, four - so mistaking three heads for four is next
  // door and calling four heads one head is not. Hearing that there is a
  // pattern and miscounting it is a different mistake from not hearing one.
  const puzzle = {
    tier: 'medium',
    settings: { exercise: 'pattern' },
    answer: { heads: 'heads4', time: timeOf(1), division: 'quarter' },
  };

  assert.equal(delay.score({ heads: 'heads4' }, puzzle).correct, true);
  assert.equal(delay.score({ heads: 'heads3' }, puzzle).correct, false);
  assert.equal(delay.score({ heads: 'single' }, puzzle).correct, false);

  assert.equal(delay.score({ heads: 'heads3' }, puzzle).cells[0].state, NEAR);
  assert.equal(delay.score({ heads: 'single' }, puzzle).cells[0].state, MISS);
});

test('the pattern drill puts its answer on the delay, on the grid', () => {
  // The repeats have to be in time with the loop or a pattern is not a
  // rhythm, which is the only thing it could be heard as.
  for (const tier of ['easy', 'medium', 'hard']) {
    for (let seed = 0; seed < 12; seed += 1) {
      const puzzle = patternPuzzle(tier, seed * 977);
      const settings = delay.exercises.pattern.startOf(puzzle, tier);

      assert.equal(settings.heads, puzzle.answer.heads, 'the delay is not set to the answer');
      const near = nearestDivision(settings.time);
      assert.ok(near.off < 1e-9,
        `${tier} seed ${seed}: ${settings.time} ms is not a note value`);
      assert.ok(settings.mix > 0.2, 'the repeats have to be audible');
    }
  }
});

test('a pattern puzzle is a function of its seed', () => {
  for (const tier of ['easy', 'medium', 'hard']) {
    assert.deepEqual(patternPuzzle(tier, 4242).answer, patternPuzzle(tier, 4242).answer);
  }
});

test('the pattern drill asks nothing of the knobs', () => {
  // A drill is chips, not controls: there is one slot and it is a choice.
  const slots = delay.slots('medium', { exercise: 'pattern' });
  assert.equal(slots.length, 1);
  assert.equal(slots[0].kind, 'choice');
  assert.ok(slots[0].options.every((o) => o.symbol && o.name), 'every chip needs a face and a name');
});

/* --- the machine ------------------------------------------------------------ */

/** The level of a band of the first repeat, in dB, for reading tone off it. */
function bandAt(ir, ms, band) {
  const from = Math.round(((ms - 5) / 1000) * rate);
  const to = Math.round(((ms + 40) / 1000) * rate);
  const slice = ir.channels[0].slice(Math.max(0, from), to);
  const got = bandOf(slice, rate, band);
  let energy = 0;
  for (let i = 0; i < got.length; i += 1) energy += got[i] * got[i];
  return 10 * Math.log10(Math.max(energy, 1e-20));
}

test('a digital delay is the delay that was here before machines', () => {
  for (const over of [{}, { heads: 'heads4' }, { diffusion: 0.5 }, { offset: 60 }]) {
    const was = echo({ time: 375, feedback: 0.5, ...over });
    const now = echo({ time: 375, feedback: 0.5, machine: 'digital', ...over });
    let worst = 0;
    for (let i = 0; i < Math.min(was.length, now.length); i += 1) {
      worst = Math.max(worst, Math.abs(was.channels[0][i] - now.channels[0][i]));
    }
    assert.equal(worst, 0, `${JSON.stringify(over)}: the digital machine changed the delay`);
  }
});

test('a machine darkens the first repeat, which a tone knob does not', () => {
  // The one place the machine deliberately parts company with the knobs. The
  // tone and low cut are in the feedback path and the output is tapped in
  // front of them, so the first repeat is the sound that went in. A bucket
  // brigade is not an EQ on the feedback - it is the thing the signal travels
  // through, once per repeat - so its filter is on the way in and the first
  // repeat is already dark. That is the tell the whole machine is for.
  const base = { time: 600, feedback: 0.4, tone: 20000, lowCut: 20 };
  const high = RESPONSE_BANDS.find((b) => b.id === 'high');

  const clean = bandAt(echo({ ...base, machine: 'digital' }), 600, high);
  for (const machine of ['tape', 'bbd']) {
    const dark = bandAt(echo({ ...base, machine }), 600, high);
    assert.ok(dark < clean - 6,
      `on ${machine} the first repeat's top read ${dark.toFixed(1)} against ${clean.toFixed(1)}`);
  }
});

test('a bucket brigade gets darker the longer the delay is', () => {
  // The signature of the thing: the clock runs at the number of stages over
  // twice the delay, so a longer delay is a slower clock and a slower clock
  // has to be band-limited further down. It is the opposite of a digital
  // delay, whose bandwidth is the same at every time.
  // Below 546 ms, where the clock's own arithmetic is still inside the range
  // a machine is allowed. Past that the floor holds it, which the test below
  // this one is about - a bucket brigade that long did not exist anyway.
  const times = [60, 150, 300, 500];
  const corners = times.map((ms) => machineTone('bbd', ms).corner);
  for (let i = 1; i < corners.length; i += 1) {
    assert.ok(corners[i] < corners[i - 1],
      `a ${times[i]} ms delay cornered at ${corners[i]} Hz, no lower than the last`);
  }

  // And a digital delay does not move at all.
  for (const ms of [60, 600, 1200]) assert.equal(machineTone('digital', ms), null);
});

test('the clock is the stages over twice the delay, as the chip says', () => {
  // Raffel and Smith: delay = N / (2 * f_clock). A 4096-stage chip at 300 ms
  // wants a 6,826 Hz clock, which band-limits the input to 3,413 Hz - and the
  // filters in a real pedal sit between a third and a half of the clock, so
  // the corner is below that again.
  const clock = BBD_STAGES / (2 * 0.3);
  assert.ok(Math.abs(clock - 6826.67) < 0.1, `the clock came out at ${clock.toFixed(2)} Hz`);
  const { corner } = machineTone('bbd', 300);
  assert.ok(corner < clock / 2, `the corner at ${corner} Hz is not under the clock's Nyquist`);
  assert.ok(corner > clock / 4, `the corner at ${corner} Hz is further down than a third`);
});

test('a machine runs out of range rather than off the end of it', () => {
  // The shortest delay on offer would want a corner above anything audible
  // and the longest one would want it under the bass, so both ends are held.
  for (const machine of ['tape', 'bbd']) {
    const short = machineTone(machine, SHORTEST_TIME).corner;
    const long = machineTone(machine, LONGEST_TIME).corner;
    assert.equal(short, MACHINE_CEILING, `${machine} at the shortest time cornered at ${short}`);
    assert.equal(long, MACHINE_FLOOR, `${machine} at the longest time cornered at ${long}`);
  }
});

test('tape has a lift where its head bump is, and a bucket brigade has none', () => {
  // The head bump: a real head is a loop of wire whose response rises where
  // the wavelength on the tape matches it, and it moves with the speed the
  // way everything else about tape does. It is what makes tape echo warm
  // rather than only dark.
  //
  // Measured in a band around where the bump actually sits, which is the
  // correction this test needed. Over the reading's own low band - sixty to
  // four hundred - a bump at seventy-five hertz is a sliver and the average
  // barely moves; worse, the first version of this read the whole response
  // and found a bucket brigade lifted down low too, because the makeup was
  // referenced to total energy and gave a dark machine its lost top back as
  // bass. Both of those are fixed: the makeup is referenced to a tone at
  // 300 Hz, and this looks where the bump is.
  //
  //     band 50-110 Hz, against digital
  //       200 ms    tape +0.40 dB   bbd +0.00   bump at 160 Hz
  //       600 ms    tape +2.37 dB   bbd +0.01   bump at  75 Hz
  //      1200 ms    tape +1.33 dB   bbd +0.01   bump at  38 Hz
  //
  // Most at 600 ms, because that is where the bump is inside the band being
  // looked at - at 200 ms it is above it and at 1200 below.
  const band = { low: 50, high: 110 };
  const base = { feedback: 0.4, tone: 20000, lowCut: 20 };

  const energy = (machine, ms) => {
    const ir = echo({ ...base, time: ms, machine });
    const got = bandOf(ir.channels[0], rate, band);
    let sum = 0;
    for (let i = 0; i < got.length; i += 1) sum += got[i] * got[i];
    return 10 * Math.log10(Math.max(sum, 1e-20));
  };

  const clean = energy('digital', 600);
  assert.ok(energy('tape', 600) > clean + 1.5,
    `tape read ${energy('tape', 600).toFixed(2)} against ${clean.toFixed(2)} where its bump is`);
  assert.ok(Math.abs(energy('bbd', 600) - clean) < 0.5,
    'a bucket brigade should have no bump to show');

  // And the bump moves with the speed, which is what ties it to the time.
  assert.ok(machineTone('tape', 300).bumpAt > machineTone('tape', 900).bumpAt);
  assert.equal(machineTone('bbd', 600).bump, 0);
  assert.ok(machineTone('tape', 600).bump > 0);
});

test('a machine takes the top off and leaves the body where it was', () => {
  // What the makeup is for, and the three goes it took to say it properly.
  //
  // Not the peak: a machine's filter spreads the impulse, so a bucket
  // brigade's response peaks 21 dB under a digital one's. That is the medium
  // showing and no makeup should take it out.
  //
  // Not the whole response: the filter is in the loop, so each pass is darker
  // than the last and the tail is shorter for it - measured, tape holds
  // 6.27 dB less energy than digital over the whole thing. Also the medium,
  // and the correct amount of it.
  //
  // Not the first repeat's energy across the spectrum either, which was the
  // third wrong answer. An impulse has energy everywhere and a machine takes
  // the top off, so of course it comes out with less. What a listener hears
  // is music, whose energy is low and mid, and that is what the makeup is
  // referenced to - a tone at 300 Hz.
  //
  // So: the body of the first repeat, which is where the level is. Measured
  // against digital, the first repeat alone, at 400 ms:
  //
  //     machine      low      mid     high
  //     tape        0.71    -0.74    -5.49 dB
  //     bbd        -0.00    -2.76   -25.53
  //
  // The low band level on all three, the top progressively gone. A bucket
  // brigade loses some midrange too, and that is right rather than a slip:
  // at 400 ms its corner is 2048 Hz, which is inside the 400-to-3000 band
  // being measured.
  const firstOf = (machine) => {
    const ir = echo({ time: 400, feedback: 0.4, machine });
    return ir.channels[0].slice(Math.round(0.395 * rate), Math.round(0.46 * rate));
  };
  const energy = (slice, band) => {
    const got = bandOf(slice, rate, band);
    let sum = 0;
    for (let i = 0; i < got.length; i += 1) sum += got[i] * got[i];
    return 10 * Math.log10(Math.max(sum, 1e-20));
  };

  const low = RESPONSE_BANDS.find((b) => b.id === 'low');
  const high = RESPONSE_BANDS.find((b) => b.id === 'high');
  const clean = firstOf('digital');

  for (const machine of ['tape', 'bbd']) {
    const got = firstOf(machine);
    assert.ok(Math.abs(energy(got, low) - energy(clean, low)) < 1,
      `${machine}'s first repeat is ${(energy(got, low) - energy(clean, low)).toFixed(2)} dB `
      + 'from digital\'s down low, which makes the machine a volume control');
    assert.ok(energy(got, high) < energy(clean, high) - 4,
      `${machine} only took ${(energy(clean, high) - energy(got, high)).toFixed(2)} dB off the top`);
  }

  // And more off the top for a bucket brigade than for tape, which is the
  // order of the two as instruments.
  assert.ok(energy(firstOf('bbd'), high) < energy(firstOf('tape'), high) - 10,
    'a bucket brigade should be the darker of the two by a long way');
});

test('a machine nobody has heard of is a digital one', () => {
  const ir = echo({ time: 375, feedback: 0.4, machine: 'memory-man' });
  const digital = echo({ time: 375, feedback: 0.4, machine: 'digital' });
  let worst = 0;
  for (let i = 0; i < ir.length; i += 1) {
    worst = Math.max(worst, Math.abs(ir.channels[0][i] - digital.channels[0][i]));
  }
  assert.equal(worst, 0, 'an unknown machine should fall back to clean digital');
});

/* --- the loop and the response are the same delay ------------------------- */

test('the response is a run of the core over one click', () => {
  // Not a tautology for long: the response is drawn and marked and the core is
  // what the audio thread runs, and the whole point of there being one of them
  // is that nobody can change one without the other. If this ever fails,
  // somebody has given `makeEcho` arithmetic of its own again.
  for (const over of [{}, { heads: 'heads4', diffusion: 0.4 }, { machine: 'bbd', time: 800 },
    { pingPong: true, offset: 40 }]) {
    const settings = { ...ECHO_DEFAULTS, ...over };
    const made = makeEcho(rate, settings);
    const core = echoCore(rate).set(settings);

    let worst = 0;
    for (let i = 0; i < made.length; i += 1) {
      const input = i === 0 ? 1 : 0;
      core.stereo(input, input);
      // Rounded to single precision before comparing, because that is what
      // the response is stored as. A machine with a makeup gain leaves a
      // double on the core and a float32 in the buffer, and the two differ in
      // the last bit for no reason anybody cares about.
      worst = Math.max(worst,
        Math.abs(Math.fround(core.left) - made.channels[0][i]),
        Math.abs(Math.fround(core.right) - made.channels[1][i]));
    }
    assert.equal(worst, 0, `${JSON.stringify(over)} came out differently by hand`);
  }
});

test('running a signal through the core is convolving it with the response', () => {
  // The claim the live path rests on. The delay as it stands is linear, so a
  // signal through the loop and the same signal convolved with the loop's
  // response are the same sound - which is what made a ConvolverNode a fair
  // way to run it, and what makes swapping that convolver for the loop a
  // change of nothing. Measured here rather than asserted, because it stops
  // being true the moment anything in the loop moves while the audio does, and
  // the margin is what will say how much.
  //
  // A short line and a modest feedback, so the response is 16k samples rather
  // than 136k and the convolution is a test rather than an afternoon.
  const settings = { ...ECHO_DEFAULTS, time: 50, feedback: 0.3, diffusion: 0.3 };
  const made = makeEcho(rate, settings);
  const core = echoCore(rate).set(settings);

  // Two seeded noise bursts, one a side, so a routing mistake cannot hide in a
  // mono signal.
  const random = mulberry32(7);
  const n = 2000;
  const inL = new Float32Array(n);
  const inR = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    inL[i] = random() * 2 - 1;
    inR[i] = random() * 2 - 1;
  }

  const span = n + made.length;
  const ran = [new Float32Array(span), new Float32Array(span)];
  for (let i = 0; i < span; i += 1) {
    core.stereo(i < n ? inL[i] : 0, i < n ? inR[i] : 0);
    ran[0][i] = core.left;
    ran[1][i] = core.right;
  }

  // The convolution, by hand, one channel against its own side of the
  // response - which is what a two-channel ConvolverNode does.
  const folded = [new Float32Array(span), new Float32Array(span)];
  for (let c = 0; c < 2; c += 1) {
    const signal = c === 0 ? inL : inR;
    const response = made.channels[c];
    for (let i = 0; i < n; i += 1) {
      const x = signal[i];
      if (x === 0) continue;
      for (let k = 0; k < response.length; k += 1) folded[c][i + k] += x * response[k];
    }
  }

  const level = (a) => {
    let sum = 0;
    for (let i = 0; i < a.length; i += 1) sum += a[i] * a[i];
    return Math.sqrt(sum / a.length);
  };

  // Compared over the first `made.length` samples only, and that window is
  // the point rather than a convenience. The response is truncated where the
  // repeats fall 60 dB below the first one, so a convolution with it loses
  // whatever would have arrived after that - while the loop, having no end,
  // keeps going. Output before the response runs out needs no tap past its
  // end, so inside that window the two are the same sum and the truncation is
  // not being measured. Inside it the two agree to -144.8 dB on the left and
  // -144.6 on the right, which is float32 and nothing else. Over the whole
  // span it is -73.7 and -72.7, which is the size of the tail a convolver was
  // always throwing away.
  const window = made.length;
  for (let c = 0; c < 2; c += 1) {
    const off = new Float32Array(window);
    const want = new Float32Array(window);
    for (let i = 0; i < window; i += 1) {
      off[i] = ran[c][i] - folded[c][i];
      want[i] = folded[c][i];
    }
    const residue = 20 * Math.log10(level(off) / level(want));
    assert.ok(residue < -100,
      `channel ${c} differs by ${residue.toFixed(1)} dB, which is more than rounding`);
  }
});

/* --- the transport wandering ---------------------------------------------- */

/** The pitch of a tone through the loop, frame by frame, off its zero crossings. */
function pitchOf(settings, probe = 1000, seconds = 8) {
  const core = echoCore(rate).set({ ...settings, feedback: 0, tone: 20000, lowCut: 20 });
  const n = Math.ceil(rate * seconds);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const x = Math.sin((2 * Math.PI * probe * i) / rate);
    core.stereo(x, x);
    out[i] = core.left;
  }

  const crossings = [];
  for (let i = Math.round(rate * 0.45); i < n; i += 1) {
    if (out[i - 1] < 0 && out[i] >= 0) {
      crossings.push(i - 1 + out[i - 1] / (out[i - 1] - out[i]));
    }
  }

  const track = [];
  for (let k = 1; k < crossings.length; k += 1) {
    track.push({ at: crossings[k] / rate, hz: rate / (crossings[k] - crossings[k - 1]) });
  }

  const inside = track.filter((point) => point.at > 0.6 && point.at < seconds - 0.2);
  const highest = Math.max(...inside.map((point) => point.hz));
  const lowest = Math.min(...inside.map((point) => point.hz));
  const cents = (hz) => 1200 * Math.log2(hz / probe);

  // The rate, from how often the deviation crosses its own middle - twice a
  // cycle.
  const middle = (highest + lowest) / 2;
  let turns = 0;
  let first = null;
  let last = null;
  for (let k = 1; k < inside.length; k += 1) {
    if ((inside[k - 1].hz - middle) * (inside[k].hz - middle) < 0) {
      turns += 1;
      if (first === null) first = inside[k].at;
      last = inside[k].at;
    }
  }

  return {
    peak: Math.max(cents(highest), -cents(lowest)),
    hz: turns > 2 ? (turns - 1) / (2 * (last - first)) : 0,
  };
}

test('the wander knobs are in the unit they are labelled with', () => {
  // Cents of peak pitch deviation, which is the thing you hear - so the same
  // number means the same depth whichever of the two knobs it is on and
  // whatever the delay is set to. Measured off a 1 kHz tone through the loop:
  //
  //     asked    wow reads    flutter reads
  //        5       5.01 c         5.01 c
  //       15      15.13         15.13
  //       30      30.53           -
  //       50      51.49           -
  //
  // The two agree with each other to the hundredth, which is the claim that
  // matters: a cent of wow and a cent of flutter are the same depth of
  // wobble at two different speeds. Both read a hair over what was asked
  // because the peak of a frequency-modulated tone is not symmetrical in
  // cents, and three per cent at the top of the range is not a calibration
  // anybody can hear.
  for (const [which, hz] of [['wow', WOW_RATE], ['flutter', FLUTTER_RATE]]) {
    for (const cents of [5, 15]) {
      const got = pitchOf({ ...ECHO_DEFAULTS, time: 375, [which]: cents });
      assert.ok(Math.abs(got.peak - cents) < cents * 0.1,
        `${which} at ${cents} cents came out at ${got.peak.toFixed(2)}`);
      assert.ok(Math.abs(got.hz - hz) < hz * 0.1,
        `${which} wandered at ${got.hz.toFixed(2)} Hz rather than ${hz}`);
    }
  }
});

test('a delay with no wander on it is the delay that was there before', () => {
  // The interpolator is exactly the sample it lands on at a whole number, so
  // nothing about the arithmetic changes until something moves. Checked on the
  // repeats themselves rather than on a hash, which a test cannot carry: the
  // first repeat of a 375 ms delay is exactly one, at exactly sample 18000,
  // and the sample either side of it is exactly nothing.
  const settings = { ...ECHO_DEFAULTS, time: 375, feedback: 0.5 };
  const quiet = makeEcho(rate, settings);
  const at = Math.round(0.375 * rate);
  assert.equal(quiet.channels[0][at], 1, 'the first repeat should be the sound that went in');
  assert.equal(quiet.channels[0][at - 1], 0, 'and nothing should arrive before it');
  assert.equal(quiet.channels[0][at + 1], 0, 'or after it');

  // And with the transport wandering, it does move - three samples early at
  // five cents of flutter, which is what makes the reading below necessary.
  const moving = makeEcho(rate, { ...settings, flutter: 5 });
  assert.notEqual(moving.channels[0][at], 1, 'five cents of flutter should move the repeat');
});

test('the line puts a ceiling on the wander, and only where it has to', () => {
  const depth = (over) => echoCore(rate).set({ ...ECHO_DEFAULTS, ...over }).wander();

  // Fifty cents of wow wants ten milliseconds of displacement, so a line
  // shorter than about forty gives what it can and no more. Measured:
  //
  //     time      one head   three heads   four heads
  //      20 ms      27.4 c       27.4 c       20.1 c
  //      40 ms      50.0         50.0         40.4
  //      60 ms      50.0         50.0         50.0
  assert.ok(depth({ time: 20, wow: 50 }).wow < 30, 'a 20 ms line cannot wander 50 cents');
  assert.ok(depth({ time: 20, wow: 50 }).wow > 20, 'but it should manage more than 20');
  for (const heads of ['single', 'heads3', 'heads4']) {
    assert.ok(Math.abs(depth({ time: 60, heads, wow: 50 }).wow - 50) < 0.01,
      `60 ms on ${heads} should give the whole 50 cents`);
    assert.ok(Math.abs(depth({ time: 375, heads, flutter: 25 }).flutter - 25) < 0.01,
      `flutter is fourteen times smaller and should never be held back on ${heads}`);
  }

  // The nearest head is what decides, not the longest - a four-head pattern
  // reads a quarter of the loop back, and a wander deep enough would carry
  // that head past the write head and into whatever was there a loop ago.
  assert.ok(depth({ time: 30, heads: 'heads4', wow: 50 }).wow
    < depth({ time: 30, heads: 'single', wow: 50 }).wow - 5,
    'four heads should be held back further than one at a short time');
});

test('a wandering line never reads past the write head', () => {
  // What the ceiling is for. At the extremes - the shortest delay, the most
  // feedback, four heads reading a quarter of a loop that is already tiny, and
  // both wander knobs at their tops - nothing may come out non-finite or
  // louder than what went in.
  for (const time of [20, 25, 40, 375]) {
    for (const heads of ['single', 'heads3', 'heads4']) {
      const echo = makeEcho(rate, {
        ...ECHO_DEFAULTS,
        time,
        heads,
        feedback: MOST_FEEDBACK,
        diffusion: 1,
        wow: 50,
        flutter: 25,
      });
      let peak = 0;
      let wrong = 0;
      for (const channel of echo.channels) {
        for (const value of channel) {
          if (!Number.isFinite(value)) wrong += 1;
          else peak = Math.max(peak, Math.abs(value));
        }
      }
      assert.equal(wrong, 0, `${time} ms on ${heads} produced ${wrong} non-finite samples`);
      assert.ok(peak <= 1.0001,
        `${time} ms on ${heads} peaked at ${peak.toFixed(4)}, so the loop found gain somewhere`);
    }
  }
});

test('the arrival reading is blind to the wander and still sees the loop', () => {
  // A reading measures one thing. This one says where inside a pass the
  // repeats fall, and a pass is only a length if it is the same length every
  // time round - so it is taken with the transport held still. Three samples
  // of flutter read 7.0 dB through it against a tolerance of 6, which is a
  // frame edge rather than a measurement: see ARRIVAL_SMEAR.
  const base = { ...ECHO_DEFAULTS, time: 375, feedback: 0.5, mix: 0.4 };
  const flat = repeatsReading(rate, base);

  for (const over of [{ wow: 5 }, { wow: 50 }, { flutter: 5 }, { flutter: 25 },
    { wow: 25, flutter: 25 }]) {
    assert.equal(distance(repeatsReading(rate, { ...base, ...over }), flat).off, 0,
      `${JSON.stringify(over)} reached a reading that is not about it`);
  }

  // And it has not gone deaf to what it is for.
  assert.ok(distance(repeatsReading(rate, { ...base, heads: 'heads4' }), flat).off > 15,
    'the arrival reading should still see a head pattern');
});

test('the decay reading cannot mark the wander, which is why there is another', () => {
  // Measured, against no wander at all, with the tolerances that decide a pass
  // being 2.6, 1.9 and 1.2 dB:
  //
  //     wow 5        0.11 dB      flutter 5     0.05 dB
  //     wow 15       0.27         flutter 15    0.11
  //     wow 30       0.88         flutter 25    0.16
  //     wow 50       0.88
  //
  // Under the easiest tolerance at every depth, and not even monotonic - 30
  // and 50 read the same, and 30 against 50 reads 0.04 dB. An energy decay
  // curve says how the repeats fade, and a transport that wanders does not
  // change that. So wow and flutter get a reading of their own.
  const base = { ...ECHO_DEFAULTS, time: 375, feedback: 0.5, mix: 0.4 };
  const read = (over) => decayReading('delay', echoProfile(rate, { ...base, ...over }),
    { state: { ...base, ...over } });
  const flat = read({});

  for (const over of [{ wow: 15 }, { wow: 50 }, { flutter: 15 }, { flutter: 25 }]) {
    const off = distance(read(over), flat).off;
    assert.ok(off < 1.2,
      `${JSON.stringify(over)} read ${off.toFixed(2)} dB, so the decay curve can see it after all `
      + '- which would be good news and this comment would be wrong');
  }
});

/* --- the audio thread ----------------------------------------------------- */

test('the worklet is built from the delay, not a copy of it', () => {
  // The one test that can catch a part left off the list. Everything else
  // passes with an incomplete worklet: the module is fine, Node is fine, and
  // the failure happens on the audio thread inside a blob URL, where a thrown
  // ReferenceError reaches no console and the delay simply has no repeats.
  // That is how adding wow and flutter silently stopped every insert in the
  // app, with 693 green tests.
  const source = echoSource();

  for (const name of ['echoCore', 'wanderOf', 'centsOf', 'machineTone', 'headsOf',
    'sidesOf', 'makeupFor', 'WOW_RATE', 'FLUTTER_RATE', 'DIFFUSE_AT', 'WANDER_EDGE']) {
    assert.ok(source.includes(name), `the audio thread needs ${name}`);
  }

  // Run the string the audio thread is given, and hold it against the module.
  // Settings that reach the wander, the heads, the diffusion and the medium at
  // once, because any one of them could be the thing a missing part breaks.
  const theirs = new Function(
    `${source.replace(/class HeadroomEcho[\s\S]*$/, '')}; return echoCore;`,
  )();
  const settings = {
    ...ECHO_DEFAULTS,
    time: 320,
    feedback: 0.45,
    heads: 'heads3',
    diffusion: 0.4,
    machine: 'tape',
    wow: 18,
    flutter: 9,
  };
  const mine = echoCore(rate).set(settings);
  const yours = theirs(rate).set(settings);

  let worst = 0;
  for (let i = 0; i < rate; i += 1) {
    const x = Math.sin((2 * Math.PI * 220 * i) / rate) * (i % 8000 < 2000 ? 0.9 : 0.1);
    mine.stereo(x, x);
    yours.stereo(x, x);
    worst = Math.max(worst, Math.abs(mine.left - yours.left), Math.abs(mine.right - yours.right));
  }
  assert.equal(worst, 0, 'what you hear has to be what you are marked on');
});

/* --- the wander, as a reading --------------------------------------------- */

test('the wander reading is in cents and says which rate it found', () => {
  // A pure wander of A cents peak should read A over root two - which is what
  // RMS means - in its own band and nothing in the others. Measured:
  //
  //     setting         wow   middle   flutter   scrape      wanted
  //     wow 10         7.06     0.03      0.00     0.00        7.07
  //     wow 25        17.72     0.06      0.00     0.00       17.68
  //     flutter 10     0.05     0.00      6.34     0.01        7.07
  //     flutter 25     0.14     0.00     15.93     0.03       17.68
  //
  // Wow to a per cent. Flutter nine per cent light, which is the frame
  // averaging: sinc(7.9 / 32) is 0.911, and a frame is a tenth of a flutter
  // cycle. Left uncorrected on purpose - see wanderBands.
  const base = { ...ECHO_DEFAULTS, time: 375, feedback: 0.5, mix: 0.4 };
  const bandAt = (id) => WANDER_BANDS.findIndex((band) => band.id === id);

  for (const [which, band, loss] of [['wow', 'wow', 1], ['flutter', 'flutter', 0.911]]) {
    for (const cents of [10, 25]) {
      const values = wanderReading(rate, { ...base, [which]: cents }).values;
      const want = (cents / Math.SQRT2) * loss;
      assert.ok(Math.abs(values[bandAt(band)] - want) < want * 0.03,
        `${which} ${cents} read ${values[bandAt(band)].toFixed(2)} in its band, not ${want.toFixed(2)}`);

      // And nothing in the band the other one lives in.
      const other = which === 'wow' ? 'flutter' : 'wow';
      assert.ok(values[bandAt(other)] < 0.3,
        `${which} ${cents} put ${values[bandAt(other)].toFixed(2)} cents in the ${other} band`);
    }
  }

  // Two wanders at once read as themselves, side by side.
  const both = wanderReading(rate, { ...base, wow: 25, flutter: 25 }).values;
  const alone = wanderReading(rate, { ...base, wow: 25 }).values;
  assert.ok(Math.abs(both[bandAt('wow')] - alone[bandAt('wow')]) < 0.05,
    'flutter should not change what the wow band reads');
});

test('the wander reading sees nothing but the transport', () => {
  // The half of a reading that is usually the hard half. The probe runs with
  // the feedback shut and on one head, so there is nothing in it but the
  // transport. Nine of these eleven read exactly zero, and the two that do
  // not are the two media:
  //
  //     tape               2.11e-6 cents
  //     bucket brigade     1.23e-4
  //
  // Which is rounding and not a signal. A medium puts a filter in front of
  // the line, and a filter's phase at a steady tone is a constant, so the
  // derivative of that phase - which is all this reading is - is unchanged.
  // What does change is the amplitude, because the makeup gain divides the
  // insertion loss back out, and a different amplitude rounds differently in
  // the last bits. A ten-thousandth of a cent is twelve thousand times under
  // the smallest step either knob can be moved by.
  const base = { ...ECHO_DEFAULTS, time: 375, feedback: 0.5, mix: 0.4 };
  const read = (over) => wanderReading(rate, { ...base, ...over });
  const still = read({});

  for (const over of [{ time: 900 }, { feedback: 0.65 }, { tone: 3000 }, { lowCut: 400 },
    { heads: 'heads4' }, { diffusion: 0.7 }, { machine: 'tape' }, { machine: 'bbd' },
    { pingPong: true }, { offset: 60 }, { mix: 0.8 }]) {
    const off = distance(read(over), still).off;
    assert.ok(off < 0.001,
      `${JSON.stringify(over)} put ${off.toExponential(2)} cents into a reading not about it`);
  }

  // And the same wander at five different times reads the same, which is what
  // the bands were chosen for: measured, within an eighth of a cent.
  for (const time of [100, 200, 700, 1200]) {
    const off = distance(read({ time, wow: 25 }), read({ time: 375, wow: 25 })).off;
    assert.ok(off < 0.2,
      `wow at ${time} ms read ${off.toFixed(3)} cents from the same wow at 375`);
  }
});

test('the wander reading resolves the depth and tells the two rates apart', () => {
  // Measured, at 375 ms and half feedback:
  //
  //     wow 0 vs 10          3.53 cents       flutter 0 vs 10     3.17
  //     wow 10 vs 20         3.55             flutter 10 vs 25    4.79
  //     wow 20 vs 30         3.57             wow 25 vs flutter 25   11.86
  //     wow 30 vs 50         7.20
  //
  // Linear in the depth at about 3.5 cents for every ten on the knob, so a
  // tolerance resolves the wander to a fixed number of cents rather than to a
  // fraction of wherever it happens to be.
  const base = { ...ECHO_DEFAULTS, time: 375, feedback: 0.5, mix: 0.4 };
  const read = (over) => wanderReading(rate, { ...base, ...over });

  let last = 0;
  for (const [a, b] of [[0, 10], [10, 20], [20, 30]]) {
    const off = distance(read({ wow: a }), read({ wow: b })).off;
    assert.ok(off > 3 && off < 4, `wow ${a} against ${b} read ${off.toFixed(2)} cents`);
    if (last) assert.ok(Math.abs(off - last) < 0.2, 'ten cents should cost the same everywhere');
    last = off;
  }

  // Three times the gap between adjacent depths, which is what makes "which
  // of the two is it" a question and not a coin toss.
  const apart = distance(read({ wow: 25 }), read({ flutter: 25 })).off;
  assert.ok(apart > 3 * last,
    `wow against flutter at the same depth read ${apart.toFixed(2)}, only ${(apart / last).toFixed(1)} `
    + 'times the gap between adjacent depths');

  // And the comparator says which band to go and listen to.
  assert.equal(distance(read({ wow: 25 }), read({})).where, 'wow');
  assert.equal(distance(read({ flutter: 25 }), read({})).where, 'flutter');
});

test('a wander reading cannot be compared with anything else', () => {
  // The envelope's job. Two readings of different kinds, or of the same kind
  // on different axes, are refused rather than averaged into a number nothing
  // downstream could tell was wrong.
  const base = { ...ECHO_DEFAULTS, time: 375, feedback: 0.5, mix: 0.4 };
  assert.throws(() => distance(wanderReading(rate, base), repeatsReading(rate, base)),
    /compare/, 'a wander reading against an arrival reading should be refused');
});

/* --- the expert tier ------------------------------------------------------ */

test('the expert tier asks what the transport is doing', () => {
  // Three characters rather than two independent depths, because two
  // independent draws would mostly make targets with a little of each and "a
  // little of each" is the one answer nobody can name. Over twenty-four
  // targets: twelve flutter, seven wow, five both - and never none.
  const kinds = {};
  for (let n = 1; n <= 24; n += 1) {
    const puzzle = gameOf({ mode: 'delay', tier: 'expert', settings: { exercise: 'match' }, seed: `round-${n}` });
    const { wow, flutter } = puzzle.answer;
    const kind = wow > 0 && flutter > 0 ? 'both' : wow > 0 ? 'wow' : flutter > 0 ? 'flutter' : 'none';
    kinds[kind] = (kinds[kind] ?? 0) + 1;

    // The floors matter more than the spread: under about sixteen cents a
    // wander is not far enough from steady for the reading to refuse somebody
    // who left the transport alone.
    if (wow > 0) assert.ok(wow >= 14, `a target asked for only ${wow} cents of wow`);
    if (flutter > 0) assert.ok(flutter >= 14, `a target asked for only ${flutter} cents of flutter`);
  }
  assert.equal(kinds.none, undefined, 'an expert target should always be doing something');
  for (const kind of ['wow', 'flutter', 'both']) {
    assert.ok(kinds[kind] > 0, `twenty-four targets and not one was ${kind}`);
  }
});

test('an expert answer cannot be matched with the transport left alone', () => {
  // The whole reason the tier exists. Measured over twenty-four targets:
  //
  //     the exact answer        0.00 cents        passes 24 of 24
  //     five cents out         0.32 to 2.41      passes 24 of 24
  //     ten cents out          0.32 to 4.83      passes 20 of 24
  //     left steady            5.08 to 14.41     passes  0 of 24
  //
  // So five cents always passes, ten is the boundary, and steady never does.
  let exact = 0;
  let five = 0;
  let steady = 0;
  for (let n = 1; n <= 12; n += 1) {
    const puzzle = gameOf({ mode: 'delay', tier: 'expert', settings: { exercise: 'match' }, seed: `round-${n}` });
    const right = { ...ECHO_DEFAULTS, ...puzzle.answer };
    const near = {
      ...right,
      wow: right.wow > 0 ? Math.min(50, right.wow + 5) : right.wow,
      flutter: right.flutter > 0 ? Math.min(25, right.flutter + 5) : right.flutter,
    };
    if (delay.score(right, puzzle).correct) exact += 1;
    if (delay.score(near, puzzle).correct) five += 1;
    if (delay.score({ ...right, wow: 0, flutter: 0 }, puzzle).correct) steady += 1;
  }
  assert.equal(exact, 12, 'the exact answer has to pass');
  assert.equal(five, 12, 'five cents out is a match by ear and has to pass');
  assert.equal(steady, 0, 'leaving the transport alone is not a match for one that wanders');
});

test('the expert tier says which way the transport is wrong', () => {
  // Not just that it is. "Wow" and "flutter" are two different things to go
  // and listen for, and the comparator names the band the two disagree about
  // most.
  const puzzle = gameOf({ mode: 'delay', tier: 'expert', settings: { exercise: 'match' }, seed: 'round-1' });
  const right = { ...ECHO_DEFAULTS, ...puzzle.answer };
  const got = delay.score({ ...right, wow: 0, flutter: 0 }, puzzle);
  assert.ok(!got.correct);
  assert.match(got.cells[1].text, /transport|wow|flutter/,
    `the note said "${got.cells[1].text}", which does not send anybody anywhere`);

  // And the hint names which of the two it is without giving the depth away.
  const hints = delay.hints(puzzle);
  assert.equal(hints.length, 3, 'the expert tier should have a hint about the transport');
  assert.match(hints[2], /drift|rough|both|holds time/);
  assert.ok(!/\d/.test(hints[2]), `the hint "${hints[2]}" gives a number away`);
});

test('the other three exercises get an expert tier that is not a duplicate', () => {
  // Tiers belong to the tool and the blurbs to the exercise, so a fourth tier
  // appears in all four exercises whether or not it means anything to them. It
  // has to mean something. The division drill stops giving credit for nearly,
  // the pattern drill smears further, and finding the time gets a tighter
  // window - and each says so in its own words.
  for (const exercise of ['drill', 'pattern', 'find']) {
    const blurbs = ECHO_EXERCISES[exercise].tierBlurbs;
    assert.ok(blurbs?.expert, `the ${exercise} exercise has nothing to say about the expert tier`);
    assert.notEqual(blurbs.expert, blurbs.hard,
      `the ${exercise} exercise's expert tier reads the same as its hard one`);
  }

  // And the pattern drill is still a fair question there: measured, every pair
  // of answers is 25.77, 29.59 and 20.47 dB apart against a tolerance of 6.
  const base = {
    ...ECHO_DEFAULTS, time: timeOf(0.5), feedback: 0.65, diffusion: 0.5, mix: 0.4,
  };
  const ids = ['single', 'heads3', 'heads4'];
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const off = distance(
        repeatsReading(rate, { ...base, heads: ids[i] }),
        repeatsReading(rate, { ...base, heads: ids[j] }),
      ).off;
      assert.ok(off > 12,
        `${ids[i]} against ${ids[j]} is only ${off.toFixed(2)} dB apart at the expert tier`);
    }
  }
});

test('a wrong head pattern is refused at every tier', () => {
  // The hole this closes, and the measurement that found it had to be taken
  // twice. `makePuzzle` hashes its seed, so the numbers 1 to 60 handed to it
  // the first time hashed to one puzzle sixty times - and one puzzle is not a
  // measurement. With seeds that differ, the decay curve on its own lets a
  // wrong head pattern through 20 of 20 times at the easy tier, 17 of 20 at
  // medium, 9 of 20 at hard and 10 of 20 at expert, while the loop reading
  // puts the same answers 12.9 to 29.6 dB apart against a tolerance of 6.
  //
  // Seeds are strings here for that reason. A numeric seed is not wrong, it
  // is just not a different seed.
  for (const tier of ['easy', 'medium', 'hard', 'expert']) {
    for (let n = 1; n <= 4; n += 1) {
      const puzzle = gameOf({ mode: 'delay', tier, settings: { exercise: 'match' }, seed: `round-${n}` });
      const right = { ...ECHO_DEFAULTS, ...puzzle.answer };
      assert.ok(delay.score(right, puzzle).correct,
        `${tier}: its own answer should pass`);

      for (const heads of HEAD_PATTERNS.map((pattern) => pattern.id)) {
        if (heads === right.heads) continue;
        const got = delay.score({ ...right, heads }, puzzle);
        assert.ok(!got.correct,
          `${tier}: ${right.heads} answered as ${heads} passed, ${got.error.toFixed(2)} dB out`);
      }
    }
  }
});

test('the shape reading refuses nothing but the shape', () => {
  // The other half. A three per cent error on the time is a near miss on the
  // question the easy tier is actually asking, and it must not be refused by
  // a reading that is not about the time: measured, 0.00 to 0.20 dB through
  // this reading at every tier, against the 6 it allows.
  for (const tier of ['easy', 'medium', 'hard', 'expert']) {
    for (let n = 1; n <= 4; n += 1) {
      const puzzle = gameOf({ mode: 'delay', tier, settings: { exercise: 'match' }, seed: `round-${n}` });
      const right = { ...ECHO_DEFAULTS, ...puzzle.answer };
      const slow = { ...right, time: right.time * 1.03 };
      const off = distance(repeatsReading(rate, slow), repeatsReading(rate, right)).off;
      assert.ok(off < 1,
        `${tier}: three per cent on the time moved the loop reading ${off.toFixed(2)} dB`);
    }
  }
});
