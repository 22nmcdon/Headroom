import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ECHO_DEFAULTS, DIVISIONS, SYNC_DIVISIONS, MOST_FEEDBACK, LONGEST_TIME,
  makeEcho, repeatsOf, echoProfile, timeOf, nearestDivision,
} from '../src/plugins/delay/line.js';
import { monoOf, bandOf, profileDistance, RESPONSE_BANDS } from '../src/lib/response.js';
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

test('a delay is normalised, so more feedback is more repeats and not more level', () => {
  for (const params of [{ feedback: 0 }, { feedback: 0.4 }, { feedback: MOST_FEEDBACK },
    { time: 40 }, { time: LONGEST_TIME }, { pingPong: true }]) {
    const ir = echo(params);
    let energy = 0;
    for (const channel of ir.channels) for (let i = 0; i < ir.length; i += 1) energy += channel[i] ** 2;
    assert.ok(Math.abs(energy - 1) < 1e-4, `${JSON.stringify(params)} came out at ${energy.toFixed(4)}`);
  }
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
