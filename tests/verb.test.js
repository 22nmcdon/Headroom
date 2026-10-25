import test from 'node:test';
import assert from 'node:assert/strict';

import {
  VERB_DEFAULTS, VERB_LIMITS, MOST_DECAY, makeImpulse, roomProfile,
  SPACES, SPACE_ORDER, verbDeckFor,
} from '../src/plugins/reverb/ir.js';
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

/* --- the spaces ----------------------------------------------------------- */

/** How long until the tail is within 6 dB of the loudest thing in it, in ms. */
function arrivesAt(impulse, rate) {
  const mono = monoOf(impulse);
  const look = Math.min(mono.length, Math.round(rate * 0.2));
  let peak = 0;
  for (let i = 0; i < look; i += 1) peak = Math.max(peak, Math.abs(mono[i]));
  for (let i = 0; i < look; i += 1) if (Math.abs(mono[i]) > peak * 0.5) return (i / rate) * 1000;
  return Infinity;
}

/** Where a band's energy sits in time, in ms - its centre of gravity. */
function centreMs(samples, rate) {
  let energy = 0;
  let moment = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const e = samples[i] * samples[i];
    energy += e;
    moment += e * i;
  }
  return energy > 0 ? (moment / energy / rate) * 1000 : 0;
}

test('a plate is a wash from the first sample and a room is not', () => {
  // The most audible of the three things that separate them, and the cheapest
  // to measure. A room has to bounce a few times before it is a wash; a plate
  // is a sheet of steel and the wave crosses it and comes back in a couple of
  // milliseconds. Measured at decay 1.8 s and no pre-delay: the room reaches
  // half level at 20.7 ms and the plate at 1.5 ms.
  const settings = { preDelay: 0, decay: 1.8 };
  const asRoom = arrivesAt(room({ ...settings, space: 'room' }), rate);
  const asPlate = arrivesAt(room({ ...settings, space: 'plate' }), rate);

  assert.ok(asPlate < 4, `the plate takes ${asPlate.toFixed(1)} ms to arrive`);
  assert.ok(asRoom > 12, `the room arrives in ${asRoom.toFixed(1)} ms, which is no build-up at all`);
});

test('a plate puts the highs in front of the lows, and only when asked', () => {
  // Dispersion, which is the one thing here that is new arithmetic rather
  // than an absence. Bending waves in steel travel faster the higher they
  // are, so the top of a transient crosses the plate and arrives while the
  // bottom is still on the way.
  //
  // Measured over the first 150 ms, as the gap between the low band's centre
  // of energy and the high band's: 10.6 ms with no spread, which is what the
  // damping alone comes to, and 19.0 ms at full spread.
  const gapOf = (spread) => {
    const impulse = room({ space: 'plate', preDelay: 0, decay: 1.8, spread });
    const mono = monoOf(impulse).subarray(0, Math.round(rate * 0.15));
    const [low, , high] = RESPONSE_BANDS.map((band) => centreMs(bandOf(mono, rate, band), rate));
    return low - high;
  };

  const none = gapOf(0);
  const most = gapOf(1);
  assert.ok(most - none > 6,
    `full spread only moved the lows ${(most - none).toFixed(1)} ms further back`);
  // And it is monotonic, so the knob means one thing all the way along.
  const half = gapOf(0.5);
  assert.ok(half > none && most > half, `${none.toFixed(1)} / ${half.toFixed(1)} / ${most.toFixed(1)}`);
});

test('a plate has no walls, so the early control is not its to have', () => {
  // Not "ignores it quietly": the control is not on a plate's deck at all,
  // because a sheet of steel has no far wall to come back off. The test is
  // both halves - that the deck leaves it out, and that the generator would
  // not be moved by one if something set it anyway.
  assert.ok(!verbDeckFor('plate').includes('early'));
  assert.ok(!verbDeckFor('plate').includes('size'));
  assert.ok(verbDeckFor('room').includes('early'));
  assert.ok(verbDeckFor('room').includes('size'));

  const quiet = room({ space: 'plate', preDelay: 0, decay: 1.8, early: 0 });
  const loud = room({ space: 'plate', preDelay: 0, decay: 1.8, early: 0.8 });
  for (let i = 0; i < quiet.length; i += 1) {
    assert.equal(quiet.channels[0][i], loud.channels[0][i]);
  }
});

test('every knob a space asks for is a knob the deck can build', () => {
  // A seam, and the kind that breaks in silence: a space naming a control the
  // face has no entry for drops it from the deck and nobody finds out until
  // somebody wonders where the knob went.
  const known = new Set(Object.keys(VERB_LIMITS));
  for (const id of SPACE_ORDER) {
    assert.ok(SPACES[id], `${id} is in the order and not in the table`);
    for (const knob of SPACES[id].knobs) {
      assert.ok(known.has(knob), `${id} asks for a ${knob} knob and there is no such range`);
    }
  }
  // And the other way: every space in the table is offered.
  for (const id of Object.keys(SPACES)) assert.ok(SPACE_ORDER.includes(id), `${id} is not offered`);
});

test('a space nobody has heard of is a room, not a silence', () => {
  // The sketchpad keeps this as a string and a file written by a later
  // version may name a space this one does not have. The right answer to that
  // is a reverb.
  const asked = room({ space: 'cathedral-of-the-future', preDelay: 0, decay: 1.8 });
  const asRoom = room({ space: 'room', preDelay: 0, decay: 1.8 });
  assert.equal(asked.length, asRoom.length);
  assert.ok(energyOf(asked) > 0);
});

test('each band decays over the time its own knob asks for', () => {
  // The whole point of there being three. The decay knob names the mid band,
  // which is the number anybody means by "a one-point-eight second hall", and
  // the other two are multiples of it.
  //
  // Measured at decay 1.8 s, reading the bands the profile reads:
  //
  //   bass 0.5 / 1 / 1.5 / 2      low reads 1.26 / 1.85 / 2.58 / 3.61 s
  //   damping 0.2 / 0.55 / 1     high reads 0.50 / 1.01 / 1.79 s
  const bandsOf = (settings) => {
    const mono = monoOf(room({ preDelay: 0, decay: 1.8, ...settings }));
    return RESPONSE_BANDS.map((band) => rt60(bandOf(mono, rate, band), rate));
  };

  // A hall: the bass rings longer than the mids and the top is shorter than
  // either, which is what every hall anybody has stood in does and what this
  // could not produce at all when there were two bands and damping could only
  // ever shorten the top.
  const [low, mid, high] = bandsOf({ bass: 1.5, damping: 0.7 });
  assert.ok(low > mid * 1.3, `a hall's bass reads ${low.toFixed(2)} s against ${mid.toFixed(2)} in the mids`);
  assert.ok(high < mid * 0.85, `and its top reads ${high.toFixed(2)} s`);

  // And each knob only moves its own band.
  const flat = bandsOf({ bass: 1, damping: 1 });
  const bassy = bandsOf({ bass: 2, damping: 1 });
  const dark = bandsOf({ bass: 1, damping: 0.2 });
  assert.ok(bassy[0] > flat[0] * 1.6, 'the bass knob moves the low band');
  assert.ok(Math.abs(bassy[2] - flat[2]) < 0.1, 'and leaves the high band alone');
  assert.ok(dark[2] < flat[2] * 0.4, 'the damping knob moves the high band');
  assert.ok(Math.abs(dark[0] - flat[0]) < 0.1, 'and leaves the low band alone');
});

test('a knob that moves a band moves it the same way all the way along', () => {
  // Which the first attempt at this did not. With the top split at 3000 - on
  // the edge of the band it is read in - the damping knob read 1.19, 0.99,
  // 1.13, 1.40, 1.82 across its range: down, then back up, because at the
  // fastest setting the high band was gone and what the reading found was the
  // mid band's skirt, which is strongest exactly at the crossover.
  const highAt = (damping) => {
    const mono = monoOf(room({ preDelay: 0, decay: 1.8, damping }));
    return rt60(bandOf(mono, rate, RESPONSE_BANDS[2]), rate);
  };
  const read = [0.2, 0.35, 0.55, 0.75, 1].map(highAt);
  for (let i = 1; i < read.length; i += 1) {
    assert.ok(read[i] > read[i - 1] - 0.02,
      `damping reads ${read.map((v) => v.toFixed(2)).join(' ')} - it turns back on itself`);
  }
  assert.ok(read[0] < 0.7, `the fastest setting only reaches ${read[0].toFixed(2)} s`);
});

test('three bands at one rate are the flat noise they came from', () => {
  // The Linkwitz-Riley property, and the reason the crossover is two cascaded
  // Butterworths a side rather than one or three. If the bands did not sum
  // flat, a space with no damping and no bass lift would be a coloured one,
  // and every reading taken of it would be of the colour rather than of the
  // space.
  const mono = monoOf(room({
    preDelay: 0, decay: 1.8, bass: 1, damping: 1, early: 0, lowCut: 20, highCut: 20000,
  }));
  const look = mono.subarray(0, Math.round(rate * 0.3));
  const energy = RESPONSE_BANDS.map((band) => {
    const samples = bandOf(look, rate, band);
    let sum = 0;
    for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
    return sum;
  });
  const total = energy.reduce((a, b) => a + b, 0);

  // White noise puts energy in a band in proportion to how wide the band is.
  RESPONSE_BANDS.forEach((band, i) => {
    const wide = band.high - band.low;
    const all = RESPONSE_BANDS.reduce((sum, b) => sum + (b.high - b.low), 0);
    const want = wide / all;
    const got = energy[i] / total;
    assert.ok(Math.abs(got - want) < 0.03,
      `the ${band.label} band holds ${(got * 100).toFixed(1)}% where white noise would put ${(want * 100).toFixed(1)}%`);
  });
});

test('a long decay with a bass lift still fades out', () => {
  // Reachable from the knobs: decay 8 s and a bass lift of two asks the low
  // band for sixteen seconds. The noise it is built from is cached to a fixed
  // length, so what came out was a tail that stopped dead at 9.32 s inside a
  // 17.3 s buffer whose last eight seconds were silence being convolved.
  for (const [decay, bass] of [[MOST_DECAY, 2], [6, 1.5], [MOST_DECAY, 1]]) {
    const impulse = room({ preDelay: 0, decay, bass });
    const channel = impulse.channels[0];
    let last = 0;
    for (let i = 0; i < impulse.length; i += 1) if (Math.abs(channel[i]) > 1e-7) last = i;
    assert.ok(impulse.seconds <= MOST_DECAY * 1.1 + 0.1,
      `decay ${decay} at ${bass}x built a ${impulse.seconds.toFixed(2)} s buffer`);
    assert.ok(last > impulse.length - 2000,
      `decay ${decay} at ${bass}x goes quiet ${((impulse.length - last) / rate).toFixed(2)} s early`);
  }
});
