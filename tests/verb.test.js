import test from 'node:test';
import assert from 'node:assert/strict';

import { VERB_DEFAULTS, MOST_DECAY, makeImpulse, roomProfile } from '../src/plugins/reverb/ir.js';
import {
  RESPONSE_BANDS, monoOf, bandOf, rt60, decayTimes, profileDistance, wetDryImpulse,
} from '../src/lib/response.js';
import { VERB_WORK as reverb } from '../src/learn/work/reverb.js';
import { LOOP_BEAT } from '../src/core/audio.js';

const rate = 48000;
const room = (settings) => makeImpulse(rate, { ...VERB_DEFAULTS, ...settings });
const energyOf = (impulse) => impulse.channels.reduce((sum, channel) => {
  let band = 0;
  for (let i = 0; i < channel.length; i += 1) band += channel[i] * channel[i];
  return sum + band;
}, 0);

/* --- the room ------------------------------------------------------------- */

test('a room decays over the time written on it', () => {
  for (const decay of [0.5, 0.8, 1.8, 3.5, 6]) {
    // Measured the way a room is measured: off the response, not off the
    // setting that made it. Damping off, so this is one decay rather than
    // three averaged together.
    const measured = rt60(monoOf(room({ decay, damping: 1, early: 0, preDelay: 0 })), rate);
    assert.ok(Math.abs(measured / decay - 1) < 0.08,
      `${decay} s of decay measured ${measured.toFixed(2)} s`);
  }
});

test('damping shortens the top and leaves the bottom alone', () => {
  const decay = 2.4;
  const measure = (damping) => {
    const mono = monoOf(room({ decay, damping, early: 0, preDelay: 0 }));
    return Object.fromEntries(RESPONSE_BANDS.map((band) =>
      [band.id, rt60(bandOf(mono, rate, band), rate)]));
  };

  const open = measure(1);
  assert.ok(Math.abs(open.high - open.low) < 0.3, 'with damping off the bands should agree');

  let last = Infinity;
  for (const damping of [0.8, 0.6, 0.4]) {
    const got = measure(damping);
    assert.ok(Math.abs(got.low - decay) < 0.3, `the bottom should still be ${decay} s, and was ${got.low.toFixed(2)}`);
    assert.ok(got.high < last, 'less damping ratio has to mean a shorter top');
    assert.ok(Math.abs(got.high - decay * damping) < decay * 0.2,
      `a ratio of ${damping} should give ${(decay * damping).toFixed(2)} s on top, and gave ${got.high.toFixed(2)}`);
    last = got.high;
  }
});

test('pre-delay is silence, and it is the length it says', () => {
  for (const preDelay of [0, 40, 120]) {
    const impulse = room({ preDelay });
    const mono = monoOf(impulse);
    const until = Math.round((preDelay / 1000) * rate);

    for (let i = 0; i < until; i += 1) {
      assert.equal(mono[i], 0, `something arrived ${((i / rate) * 1000).toFixed(1)} ms in`);
    }
    if (until < mono.length - 1) {
      assert.ok(Math.abs(mono[until + 1]) > 0 || Math.abs(mono[until + 40]) > 0,
        'and the room has to answer once the gap is over');
    }
  }
});

test('size is the only thing that moves the walls', () => {
  const firstWall = (size) => {
    // The room with no tail, so what is left is the reflections themselves.
    const mono = monoOf(room({ size, early: 0.8, preDelay: 0, decay: 1.2 }));
    let at = 0;
    let peak = 0;
    for (let i = 1; i < mono.length; i += 1) {
      const value = Math.abs(mono[i]);
      if (value > peak) { peak = value; at = i; }
    }
    return (at / rate) * 1000;
  };

  const small = firstWall(6);
  const big = firstWall(45);
  // Sound crosses a room and comes back; seven times the room, seven times
  // the wait.
  assert.ok(big / small > 5 && big / small < 10,
    `a 45 m room's walls should be far further off than a 6 m room's: ${small.toFixed(1)} vs ${big.toFixed(1)} ms`);
});

test('a room is normalised, so a long one is not simply a loud one', () => {
  for (const settings of [{ decay: 0.4 }, { decay: 6 }, { decay: 2, damping: 0.25 },
    { decay: 2, lowCut: 400, highCut: 4000 }, { decay: 2, early: 0.7 }]) {
    assert.ok(Math.abs(energyOf(room(settings)) - 1) < 1e-4,
      `${JSON.stringify(settings)} came out at ${energyOf(room(settings)).toFixed(4)}`);
  }
});

test('a room is the same room every time it is asked for', () => {
  const a = monoOf(room({ decay: 1.4, size: 22 }));
  const b = monoOf(room({ decay: 1.4, size: 22 }));
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i += 200) assert.equal(a[i], b[i], `they differ at sample ${i}`);
});

/* --- what a reading has to notice ----------------------------------------- */

test('every control shows up in the decay, including the two that once did not', () => {
  const answer = { ...VERB_DEFAULTS, decay: 2, preDelay: 30, size: 20, damping: 0.5, early: 0.35, mix: 0.3 };
  const theirs = roomProfile(rate, answer);
  const apart = (change) => profileDistance(roomProfile(rate, { ...answer, ...change }), theirs);

  assert.equal(apart({}), 0, 'a room has to match itself exactly');

  for (const [name, change] of Object.entries({
    decay: { decay: 3 },
    'pre-delay': { preDelay: 90 },
    size: { size: 45 },
    damping: { damping: 1 },
    // Early reflections carry no energy unless they are scaled to carry
    // some; set by amplitude they were a ten-thousandth of the room.
    early: { early: 0 },
    // And the mix is invisible unless the dry sound is in the reading, since
    // the room decays the same way however little of it there is.
    mix: { mix: 0.6 },
    'send filters': { lowCut: 400, highCut: 4000 },
  })) {
    assert.ok(apart(change) > 0.8, `${name} moved the room and the reading did not notice (${apart(change).toFixed(2)} dB)`);
  }
});

test('the decay is read at times spaced the way decay is heard', () => {
  const times = decayTimes();
  assert.equal(times[0], 0);
  assert.ok(times[times.length - 1] >= MOST_DECAY - 0.01);

  // Log-spaced: every gap is bigger than the one before it, so a third of a
  // second and half a second are as far apart as five seconds and eight.
  for (let i = 3; i < times.length; i += 1) {
    assert.ok(times[i] - times[i - 1] > times[i - 1] - times[i - 2],
      `the grid stops spreading at ${times[i].toFixed(3)} s`);
  }
});

test('the dry sound is in the response, as the one sample it is', () => {
  const impulse = room({ decay: 2 });
  for (const mix of [0, 0.25, 0.5, 1]) {
    const both = wetDryImpulse(impulse, mix);
    let energy = 0;
    for (let i = 0; i < both.length; i += 1) energy += both[i] * both[i];
    // Direct energy is (1-mix)^2 and the room, being normalised, is mix^2.
    // The direct sound is (1-mix) squared and the room, normalised and
    // summed across both ears, is about mix squared.
    assert.ok(Math.abs(energy - ((1 - mix) ** 2 + mix ** 2)) < 0.15,
      `at mix ${mix} the pair came to ${energy.toFixed(3)}`);
  }
});

/* --- the mode ------------------------------------------------------------- */

test('matching is marked on the decay, not on the knobs', () => {
  const answer = { ...VERB_DEFAULTS, decay: 2.4, preDelay: 40, damping: 0.5, mix: 0.3 };
  const puzzle = { settings: { exercise: 'match' }, answer };

  assert.ok(reverb.score(answer, { ...puzzle, tier: 'hard' }).correct, 'its own answer passes');
  assert.match(reverb.score(answer, { ...puzzle, tier: 'hard' }).cells[1].text, /that is the room/);

  const longer = reverb.score({ ...answer, decay: 4.5 }, { ...puzzle, tier: 'easy' });
  assert.ok(!longer.correct);
  assert.match(longer.cells[1].text, /too long$/);

  const shorter = reverb.score({ ...answer, decay: 0.9 }, { ...puzzle, tier: 'easy' });
  assert.match(shorter.cells[1].text, /too short$/);
});

test('the targets are never the room the plugin opens on', () => {
  // Otherwise the way to pass is to submit the opening settings untouched.
  for (const tier of ['easy', 'medium', 'hard']) {
    for (let i = 0; i < 6; i += 1) {
      const rng = (() => { let a = (i + 1) * 2654435761 + tier.length; return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      }; })();

      const { answer } = reverb.makePuzzle(rng, tier, { exercise: 'match' });
      const puzzle = { settings: { exercise: 'match' }, answer };
      assert.ok(!reverb.score({ ...VERB_DEFAULTS }, { ...puzzle, tier: tier }).correct,
        `${tier} drew a target the opening settings already match`);
    }
  }
});

test('fitting the tempo wants the room gone by the beat, but not gone long before it', () => {
  const answer = { clearBy: 1, preDelay: Math.round((LOOP_BEAT / 4) * 1000), division: 'a 16th' };
  const puzzle = { settings: { exercise: 'tempo' }, answer };
  const guess = (decay, preDelay = answer.preDelay) => reverb.score(
    { ...VERB_DEFAULTS, decay, preDelay }, { ...puzzle, tier: 'easy' });

  const ringing = guess(6);
  assert.ok(!ringing.correct);
  assert.match(ringing.cells[0].text, /left when it lands$/);

  const dead = guess(0.22);
  assert.ok(!dead.correct);
  assert.match(dead.cells[0].text, /gone long before it/);

  // Somewhere between the two there is a room that fits, and it is findable
  // rather than a needle: a range of decay times works.
  const works = [0.35, 0.5, 0.7, 0.95, 1.3, 1.8].filter((decay) => guess(decay).correct);
  assert.ok(works.length >= 1, 'no decay at all fits the beat');
  assert.match(guess(works[0]).cells[0].text, /gone by the beat/);

  // And the pre-delay has to be on the subdivision, whatever the decay.
  assert.ok(!guess(works[0], answer.preDelay * 2.2).correct, 'answering late should not pass');
});
