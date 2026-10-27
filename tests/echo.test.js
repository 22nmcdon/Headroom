import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ECHO_DEFAULTS, DIVISIONS, SYNC_DIVISIONS, MOST_FEEDBACK, LONGEST_TIME,
  SHORTEST_TIME, MOST_OFFSET, PING_FROM, HEAD_PATTERNS,
  makeEcho, repeatsOf, echoProfile, timeOf, nearestDivision,
} from '../src/plugins/delay/line.js';
import {
  monoOf, bandOf, profileDistance, RESPONSE_BANDS, decayProfile, wetDryImpulse,
} from '../src/lib/response.js';
import { LOOP_BEAT } from '../src/core/audio.js';
import { ECHO_WORK as delay } from '../src/learn/work/delay.js';

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
