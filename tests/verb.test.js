import test from 'node:test';
import assert from 'node:assert/strict';

import {
  VERB_DEFAULTS, VERB_LIMITS, MOST_DECAY, makeImpulse, roomProfile,
  SPACES, SPACE_ORDER, verbDeckFor, mixingTime, imageSources, SHIMMER_SPACES,
} from '../src/plugins/reverb/ir.js';
import {
  shiftCore, shimmerRatio, SHIMMER_INTERVALS, SHIMMER_WINDOW, MOST_SHIMMER,
  SHIMMER_FLOOR,
} from '../src/plugins/reverb/shimmer.js';
import {
  freezeCore, FREEZE_SECONDS, FREEZE_FADE,
} from '../src/plugins/reverb/freeze.js';
import { shimmerSource, freezeSource } from '../src/plugins/reverb/node.js';
import { decayReading } from '../src/lib/response.js';
import { distance } from '../src/gap.js';
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

/* --- the walls, by images ------------------------------------------------- */

// The window the room places reflections in: where the reflection rate passes
// one per millisecond, which is 1.404 mixing times. See ECHO_LIMIT.
const ECHO_WINDOW = (size) => mixingTime(size) * 1.4043;

test('no two reflections come back at the same moment', () => {
  // The reason the room is a 2^(1/3) box and not a cube. A cube's walls come
  // in equidistant pairs, so its reflections land on top of one another:
  // measured, a cube eighteen metres on a side has seven arrivals by its
  // mixing time at six distinct times. Coincident arrivals are a comb, and a
  // comb is the one thing a room does not sound like.
  for (const size of [4, 8, 18, 35, 60]) {
    for (const ear of imageSources(size, ECHO_WINDOW(size))) {
      const times = ear.map((r) => r.at.toFixed(7));
      assert.equal(new Set(times).size, times.length,
        `a ${size} m room has two reflections arriving together`);
    }
  }
});

test('the early pattern changes shape with the room, not just speed', () => {
  // What the list of ten fixed fractions could not do. Its taps were
  // fractions of one number, so every room was the same ten reflections in
  // the same order and a four-metre room was a sixty-metre room played
  // fifteen times faster.
  //
  // Measured now, reflections per ear inside the window:
  //
  //    4 m   2      18 m  37      45 m  136
  //    8 m  10      25 m  59      60 m  215
  //
  // Fifteen times the room is a hundred times the reflections, because the
  // count goes as the cube of the time and the window goes as the room.
  const count = (size) => imageSources(size, ECHO_WINDOW(size))[0].length;

  let last = -1;
  for (const size of [4, 6, 8, 12, 18, 25, 35, 45, 60]) {
    const got = count(size);
    assert.ok(got >= last, `a ${size} m room has fewer reflections than a smaller one`);
    last = got;
  }

  assert.ok(count(60) > count(4) * 10,
    `a sixty-metre room has ${count(60)} reflections against a four-metre room's ${count(4)}`);
  assert.ok(count(4) >= 1 && count(4) <= 5,
    `a four-metre room has ${count(4)} reflections - it should have barely any`);

  // And the first one still arrives when sound takes that long to reach a
  // wall and come back, which is linear in the room: 10.2 ms at four metres
  // and 153.5 at sixty, a ratio of 15.05 for a size ratio of 15.
  const first = (size) => imageSources(size, ECHO_WINDOW(size))[0][0].at;
  assert.ok(Math.abs(first(60) / first(4) - 15) < 0.5,
    `the first wall is at ${(first(4) * 1000).toFixed(1)} ms and ${(first(60) * 1000).toFixed(1)} ms`);
});

test('the two ears hear different reflections, a head apart', () => {
  // A room is stereo because the far wall is further from one ear than the
  // other by an amount that depends on which wall it is. What this replaced
  // gave every reflection the same six per cent of displacement whichever
  // direction it came from, which is not a direction at all.
  const [left, right] = imageSources(18, ECHO_WINDOW(18));
  assert.equal(left.length, right.length, 'both ears hear the same walls');

  const together = left.filter((l) => right.some((r) => r.at === l.at));
  assert.equal(together.length, 0,
    `${together.length} reflections arrive at both ears at exactly the same moment`);

  // But never further apart than sound takes to cross a head, because that is
  // the whole of what is between them.
  const head = 0.18 / 343;
  for (const l of left) {
    const nearest = right.reduce((best, r) => (Math.abs(r.at - l.at) < Math.abs(best - l.at) ? r.at : best), Infinity);
    assert.ok(Math.abs(nearest - l.at) < head * 1.2,
      `a reflection at ${(l.at * 1000).toFixed(2)} ms has no partner within a head's width`);
  }
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

test('a room mixes at a rate set by its volume, not by its width', () => {
  // The number of reflections arriving by time t grows as t cubed over the
  // volume, so the moment they run together goes as the square root of the
  // volume - sqrt(V) milliseconds, V in cubic metres. The knob names one
  // dimension, so a cube of that side is the fair reading of it.
  for (const size of [4, 8, 18, 35, 60]) {
    assert.ok(Math.abs(mixingTime(size) - Math.sqrt(size ** 3) / 1000) < 1e-12,
      `a ${size} m room mixes in ${(mixingTime(size) * 1000).toFixed(1)} ms`);
  }

  // The values, because this is the whole of the change and a wrong exponent
  // would still pass the identity above if both sides were wrong together.
  assert.equal((mixingTime(4) * 1000).toFixed(0), '8');
  assert.equal((mixingTime(18) * 1000).toFixed(0), '76');
  assert.equal((mixingTime(60) * 1000).toFixed(0), '465');

  // And that it is a three-halves power rather than a straight line, which is
  // what it used to be: fifteen times the width is fifty-eight times the
  // mixing time, not fifteen.
  assert.ok(Math.abs(mixingTime(60) / mixingTime(4) - 15 ** 1.5) < 1e-9);
});

test('a small room turns to a wash quickly and a large one does not', () => {
  // The arithmetic above, as a thing you can hear. Is the wash still arriving
  // at fifteen milliseconds? Compare the level at thirty with the level at
  // fifteen: a linear ramp doubles, something already settled holds. Read
  // early enough that the decay has not had time to matter, with the walls
  // out so the only thing in the window is the wash.
  //
  // Measured, before this and after:
  //
  //             was    is
  //    4 m     1.67   0.93     settled, like the plate's 0.92
  //    8 m     1.72   1.18
  //   12 m     1.72   1.72     still arriving
  //   60 m     1.72   1.72
  //
  // A four-metre room used to read 1.67 - a cathedral's number. That is the
  // fault this is here to keep out: a size knob that changed when the wash
  // started and not how long it took to get there, so no room ever sounded
  // small.
  const stillArriving = (impulse, atMs = 15) => {
    const channel = impulse.channels[0];
    const pre = Math.round((impulse.preDelay ?? 0) * rate);
    const span = Math.round((6 * rate) / 1000);
    const level = (ms) => {
      const from = pre + Math.round((ms * rate) / 1000);
      let energy = 0;
      for (let i = from; i < Math.min(channel.length, from + span); i += 1) {
        energy += channel[i] * channel[i];
      }
      return Math.sqrt(energy / span);
    };
    return level(2 * atMs) / level(atMs);
  };

  const settings = { preDelay: 0, decay: 1.8, early: 0 };
  const small = stillArriving(room({ ...settings, space: 'room', size: 4 }));
  const large = stillArriving(room({ ...settings, space: 'room', size: 60 }));
  const plate = stillArriving(room({ ...settings, space: 'plate' }));

  assert.ok(small < 1.1, `a four-metre room is still arriving at 15 ms: ${small.toFixed(2)}`);
  assert.ok(large > 1.5, `a sixty-metre room has already arrived at 15 ms: ${large.toFixed(2)}`);
  assert.ok(Math.abs(small - plate) < 0.15,
    `the small room reads ${small.toFixed(2)} where the plate, which is handed no `
    + `build-up at all, reads ${plate.toFixed(2)}`);

  // Monotone in between, which a straight line would also be - the point of
  // the pair above is the two ends, and this is that nothing kinks between.
  let last = 0;
  for (const size of [4, 8, 12, 18, 25, 35, 45, 60]) {
    const got = stillArriving(room({ ...settings, space: 'room', size }));
    assert.ok(got >= last - 0.05, `a ${size} m room arrives sooner than a smaller one`);
    last = Math.max(last, got);
  }
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

test('a gate holds at level and then stops', () => {
  // Not a natural thing and not pretending to be: the RMX16's NonLin2 holds a
  // reverb pattern at level for as long as the Decay control says and then
  // drops it, and that is the sound on every big snare of the eighties.
  //
  // Measured in 50 ms windows at decay 1.2 s, against the loudest window:
  // the burst sits between -10.4 and -10.9 dB from 0.2 s to 1.1 s - flat to
  // half a decibel, which is noise - and is at -60 by 1.3 s.
  const mono = monoOf(room({ space: 'gated', preDelay: 0, decay: 1.2 }));
  const level = (at) => {
    const from = Math.round(at * rate);
    const to = Math.min(mono.length, from + Math.round(0.05 * rate));
    let energy = 0;
    for (let i = from; i < to; i += 1) energy += mono[i] * mono[i];
    return 10 * Math.log10(Math.max(energy / Math.max(1, to - from), 1e-30));
  };

  const held = [0.3, 0.5, 0.7, 0.9, 1.1].map(level);
  const spread = Math.max(...held) - Math.min(...held);
  assert.ok(spread < 1.5, `the burst wanders ${spread.toFixed(2)} dB while it is meant to hold`);
  assert.ok(level(1.35) < Math.max(...held) - 40,
    'and it is still going after the gate should have shut');
});

test('a reverse room is loudest at the end', () => {
  // Because it is the room backwards, which is what a reverse reverb has
  // always literally been. Measured: the loudest moment sits 98% of the way
  // through, against 3% for the room it was built from.
  const where = (space) => {
    const mono = monoOf(room({ space, preDelay: 0, decay: 1.2 }));
    const window = Math.round(rate * 0.02);
    let running = 0;
    let peak = 0;
    let at = 0;
    for (let i = 0; i < mono.length; i += 1) {
      running += mono[i] * mono[i];
      if (i >= window) running -= mono[i - window] * mono[i - window];
      if (running > peak) { peak = running; at = i; }
    }
    return at / mono.length;
  };

  assert.ok(where('reverse') > 0.9, 'a reverse room should peak at the end');
  assert.ok(where('room') < 0.1, 'and the room it is built from at the start');
});

test('a reverse room fades out rather than stopping dead', () => {
  // By accident, and worth keeping: a room begins with its build-up, so
  // turned over it finishes with one. A rising envelope on its own would end
  // on a corner, and a corner is a click.
  const impulse = room({ space: 'reverse', preDelay: 0, decay: 1.2 });
  const channel = impulse.channels[0];
  const end = impulse.length - 1;
  let loudest = 0;
  for (let i = 0; i < impulse.length; i += 1) loudest = Math.max(loudest, Math.abs(channel[i]));
  assert.ok(Math.abs(channel[end]) < loudest * 0.02,
    `it ends at ${(Math.abs(channel[end]) / loudest).toFixed(3)} of its loudest`);
});

test('every space says what it is called and what to call it', () => {
  // The display names what it is showing, and "the gated" is not a thing. A
  // seam, because the caption is built from this table and a space without
  // the field would print "undefined · 2.02 s · dB" and nobody would find out
  // until they switched to it.
  for (const id of SPACE_ORDER) {
    assert.ok(SPACES[id].label, `${id} has no label`);
    assert.ok(SPACES[id].shown, `${id} has nothing to call itself on the display`);
  }
});

/* --- the spring ----------------------------------------------------------- */

/**
 * How much louder a tail's peaks are than its troughs, in dB, over a fixed
 * window rather than a fraction of the tail.
 *
 * Fixed because the obvious measure - loudest against average over the middle
 * of the tail - mostly reports how long the tail is. A loop that dies early
 * has three bounces in that window and reads 23; the same loop ringing twice
 * as long has eight and reads 14, with no change to how distinct any of them
 * is. Fifty to two hundred and fifty milliseconds, for everything.
 */
/**
 * Echo density, after Abel and Huang: the share of samples in a window that
 * exceed the window's own standard deviation, over the share a Gaussian would
 * have outside one sigma. Dense noise reads 1; a handful of discrete arrivals
 * reads near nothing.
 *
 * This replaced a measurement that did not work. The old one took the gap
 * between the loud tenth and the quiet tenth of a four-millisecond running
 * energy, and it separated nothing: measured, the plate - which is this
 * file's own definition of a wash, dense from the first sample - read 9.6 dB,
 * exactly what the spring read, and a four-metre room read 9.6 as well. The
 * test passed because the eighteen-metre room happened to read 5.5, and it
 * read 5.5 because its wash was ramping in over 147 ms inside the window
 * being measured. Correcting the build-up to a real mixing time took the
 * eighteen-metre room to 9.1 and the test went red, which is the only reason
 * anybody looked: for as long as that one number sat low, a metric that
 * cannot tell a plate from a spring looked like it was working.
 *
 * What it was actually reading is the variance of noise energy in a short
 * window. Pure Gaussian noise reads 5.3 dB through it at every window length
 * from one millisecond to thirty-two.
 *
 * The window starts at the onset rather than straddling it, because a window
 * half full of pre-delay silence reads sparse for a reason that has nothing
 * to do with the space.
 */
const GAUSSIAN_OVER_SIGMA = 0.3173105078629141;

function echoDensity(impulse, rate, forMs = 20) {
  const channel = impulse.channels[0];
  const from = Math.round((impulse.preDelay ?? 0) * rate);
  const until = Math.min(channel.length, from + Math.round((forMs * rate) / 1000));

  let sum = 0;
  for (let i = from; i < until; i += 1) sum += channel[i] * channel[i];
  const sigma = Math.sqrt(sum / (until - from));
  if (sigma === 0) return 0;

  let over = 0;
  for (let i = from; i < until; i += 1) if (Math.abs(channel[i]) > sigma) over += 1;
  return over / (until - from) / GAUSSIAN_OVER_SIGMA;
}

test('a spring bounces where a room washes', () => {
  // The whole difference. A room is a wash - noise under an envelope, lumpy
  // the way noise is - and a spring is a train of discrete chirps coming back
  // round a wire, with silence between them.
  //
  // Asked with the walls out of it, because early reflections are a third
  // thing and not a wash: one tap towers over the tail by design, so a room
  // with its walls in reads sparse for the same arithmetic reason a spring
  // does. `early: 0` is the wash on its own, which is what this is about.
  //
  // Measured over the first twenty milliseconds, and the separation holds at
  // every size, every tension and every window length from ten milliseconds
  // to forty: the room reads 0.83 to 1.06, the plate 0.97 to 1.11, and the
  // spring 0.12 to 0.20.
  const settings = { preDelay: 0, decay: 1.8, early: 0 };
  const spring = echoDensity(room({ ...settings, space: 'spring' }), rate);
  const wash = echoDensity(room({ ...settings, space: 'room' }), rate);
  const plate = echoDensity(room({ ...settings, space: 'plate' }), rate);

  assert.ok(wash > 0.6, `the room reads ${wash.toFixed(2)} - that is not a wash`);
  assert.ok(plate > 0.6, `the plate reads ${plate.toFixed(2)} - that is not a wash`);
  assert.ok(spring < 0.35,
    `the spring reads ${spring.toFixed(2)} against the room's ${wash.toFixed(2)} - it is a wash`);

  // And the plate is in here for a reason: it is the densest thing the app
  // builds, so a metric that calls it bouncy is a metric measuring something
  // else. The one this replaced called it exactly as bouncy as the spring.
  assert.ok(plate > spring * 2.5,
    `the plate reads ${plate.toFixed(2)} and the spring ${spring.toFixed(2)}`);
});

test('a spring chirps downwards, and the spread knob says how far', () => {
  // Torsional waves in a wire are dispersive, hard: the top of a transient
  // reaches the far end while the bottom is halfway, so every traverse
  // arrives as a chirp sweeping down.
  //
  // Measured over the first bounce alone - 22 ms, before the next one lands
  // on top of it - as the gap between the low band's centre of energy and the
  // high band's: 3.4 ms at no spread, 5.0 at half, 7.4 at full.
  //
  // Over a longer window it does not read, and that is the measurement and
  // not the sound: three springs of different lengths put a bounce every few
  // milliseconds, and across sixty of them the band centres average out.
  const chirpOf = (spread) => {
    const mono = monoOf(room({ space: 'spring', preDelay: 0, decay: 1.8, spread }));
    const look = mono.subarray(0, Math.round(rate * 0.022));
    const centre = (samples) => {
      let energy = 0;
      let moment = 0;
      for (let i = 0; i < samples.length; i += 1) {
        const v = samples[i] * samples[i];
        energy += v;
        moment += v * i;
      }
      return energy > 0 ? (moment / energy / rate) * 1000 : 0;
    };
    const [low, , high] = RESPONSE_BANDS.map((band) => centre(bandOf(look, rate, band)));
    return low - high;
  };

  const none = chirpOf(0);
  const most = chirpOf(1);
  assert.ok(none > 0, 'even at no spread the lows should trail the highs');
  assert.ok(most > none * 1.5,
    `full spread reads ${most.toFixed(1)} ms against ${none.toFixed(1)} at none`);
});

test('a spring has no bottom end, because a spring never has', () => {
  // There is no air in a tank and no room, only a wire. The high-pass at
  // 110 Hz is baked into the space rather than left to the send filter: what
  // makes a spring recognisable on a guitar is as much what is missing
  // underneath as the boing on top.
  const energyIn = (impulse, band) => {
    const samples = bandOf(monoOf(impulse), rate, band);
    let sum = 0;
    for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
    return sum;
  };
  const settings = { preDelay: 0, decay: 1.8, lowCut: 20 };
  const spring = room({ ...settings, space: 'spring' });
  const wash = room({ ...settings, space: 'room' });

  const low = (impulse) => energyIn(impulse, RESPONSE_BANDS[0])
    / RESPONSE_BANDS.reduce((sum, band) => sum + energyIn(impulse, band), 0);
  // Measured: 3.2% of the tank's energy sits below 400 Hz against the room's
  // 5.7%, with both send filters wide open.
  assert.ok(low(spring) < low(wash) * 0.7,
    `the tank holds ${(low(spring) * 100).toFixed(1)}% of its energy down low against the room's `
    + `${(low(wash) * 100).toFixed(1)}%`);
});

/* --- the shimmer ---------------------------------------------------------- */

test('a reverb with no shimmer is the reverb that was there before', () => {
  // The promise the shimmer makes to everything already built. It is the one
  // thing here that is not an impulse response, so the thing it must not do
  // is change one - every picture drawn and every target marked comes off
  // `makeImpulse`, and the shimmer is not in it.
  for (const space of SPACE_ORDER) {
    const without = room({ space });
    for (const over of [{ shimmer: 0.5 }, { shimmer: 1 }, { interval: 'octaveDown' }]) {
      const with_ = room({ space, ...over });
      assert.equal(with_.length, without.length,
        `${space} changed length for ${JSON.stringify(over)}`);
      for (let c = 0; c < without.channels.length; c += 1) {
        for (let i = 0; i < without.length; i += 1) {
          if (with_.channels[c][i] !== without.channels[c][i]) {
            assert.fail(`${space} with ${JSON.stringify(over)} differs at sample ${i}`);
          }
        }
      }
    }
  }
});

test('the reading that marks a reverb cannot see a shimmer', () => {
  // Which makes it the same category as the delay's time-change modes: a
  // control, not a question. Measured against the same room with none, with
  // the tolerances that decide a pass being 2.6, 1.9 and 1.2 dB - every
  // shimmer setting reads 0.0000, where the controls that are in the response
  // read 1.15 to 2.15:
  //
  //     shimmer 0.3        0.0000 dB      decay 1.8 to 2.1    1.63 dB
  //     shimmer 1          0.0000         damping 0.55 to 0.4 2.15
  //     shimmer 1 down     0.0000         pre-delay 20 to 60  1.15
  const base = { ...VERB_DEFAULTS, decay: 1.8, mix: 0.4 };
  const read = (over) => {
    const state = { ...base, ...over };
    return decayReading('reverb', roomProfile(rate, state), { state });
  };

  for (const over of [{ shimmer: 0.3 }, { shimmer: 0.6 }, { shimmer: MOST_SHIMMER },
    { shimmer: 1, interval: 'octaveDown' }, { shimmer: 1, interval: 'twoOctavesUp' }]) {
    assert.equal(distance(read(over), read({})).off, 0,
      `${JSON.stringify(over)} reached a reading that is not about it`);
  }

  // And it has not gone deaf to what it is for.
  assert.ok(distance(read({ decay: 2.1 }), read({})).off > 1,
    'the decay reading should still see a decay');
});

test('the shifter puts the pitch where it says it will', () => {
  // Measured over inputs at 220, 440 and 880 Hz, two seconds each, reading
  // the second one: how far below the shifted pitch the original is left.
  //
  //     interval          220 Hz    440 Hz    880 Hz
  //     octave up        -19.9 dB  -36.0 dB  -44.3 dB
  //     fifth up         -31.3     -46.0     -42.0
  //     fourth up        -13.9     -44.2     -38.9
  //     two octaves up   -19.9     -55.6     -42.7
  //     octave down      -28.7     -42.1     -51.5
  //     fifth down       -20.1     -44.4     -41.2
  //
  // Thirteen decibels at the worst, which is a fourth up from 220 Hz, and
  // that is the algorithm rather than a fault: the spray is widest where the
  // input is lowest, because the window holds fewer cycles of it. Thirteen is
  // still the shifted pitch winning by a factor of four and a half, and in a
  // shimmer what is left behind is the room it came from anyway. The
  // assertion is set a decibel under the worst of them.
  const mag = (buf, hz) => {
    const w = (2 * Math.PI * hz) / rate;
    const c = 2 * Math.cos(w);
    let s1 = 0;
    let s2 = 0;
    for (let i = 0; i < buf.length; i += 1) {
      const s0 = buf[i] + c * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    return (2 * Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2))) / buf.length;
  };

  for (const interval of SHIMMER_INTERVALS) {
    for (const hz of [220, 440, 880]) {
      const core = shiftCore(rate).set({ interval: interval.id });
      const out = new Float32Array(rate * 2);
      for (let i = 0; i < out.length; i += 1) {
        core.stereo(Math.sin((2 * Math.PI * hz * i) / rate), 0);
        out[i] = core.left;
      }
      const body = out.subarray(rate);
      const behind = 20 * Math.log10(mag(body, hz) / mag(body, hz * interval.ratio));
      assert.ok(behind < -12.9,
        `${interval.label} on ${hz} Hz left the original only ${behind.toFixed(1)} dB behind`);
    }
  }

  // There is deliberately no interval that leaves the pitch alone: that is
  // the one setting a loop around a convolver cannot survive. Measured, a
  // shifter passing its input through takes the same loop to +254 dB in ten
  // seconds where every real interval stays bounded.
  for (const interval of SHIMMER_INTERVALS) {
    assert.notEqual(interval.ratio, 1, `${interval.label} does not shift anything`);
  }
  assert.equal(shimmerRatio('nonsense'), SHIMMER_INTERVALS[0].ratio,
    'an interval nobody has heard of should fall back to the octave');
});

test('the shifter has unity gain, by construction and then measured', () => {
  // The bug this test exists for. Two heads half a line apart, each weighted
  // by a raised cosine over its whole traverse, sum to exactly one at every
  // position - because (0.5 - 0.5cos x) + (0.5 - 0.5cos(x + pi)) is 1. The
  // obvious alternative, full weight through the middle and a fade only at
  // the seams, sums to two in the middle, because both heads are in the
  // middle at once. That is six decibels, and with it in the loop a feedback
  // of 0.85 ran away and the conclusion drawn was that the loop was unstable
  // above 0.8. The loop was fine. The knob was lying.
  const size = SHIMMER_WINDOW;
  for (let gap = 0; gap < size; gap += 1) {
    const a = 0.5 - 0.5 * Math.cos((2 * Math.PI * gap) / size);
    const b = 0.5 - 0.5 * Math.cos((2 * Math.PI * ((gap + size / 2) % size)) / size);
    assert.ok(Math.abs(a + b - 1) < 1e-12,
      `at a gap of ${gap} the two heads sum to ${(a + b).toFixed(6)}`);
  }

  // And on noise, where the two heads comb with each other: -1.28 dB measured,
  // which is the algorithm rather than a gain error.
  const core = shiftCore(rate).set({ interval: 'octaveUp' });
  let seed = 2024;
  let into = 0;
  let outOf = 0;
  let apart = 0;
  for (let i = 0; i < rate * 3; i += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const x = (seed / 0x3fffffff) - 1;
    core.stereo(x, x);
    if (i > rate) {
      into += x * x;
      outOf += core.left * core.left;
      apart = Math.max(apart, Math.abs(core.left - core.right));
    }
  }
  const through = 10 * Math.log10(outOf / into);
  assert.ok(Math.abs(through + 1.28) < 0.2,
    `the shifter put ${through.toFixed(2)} dB through, and -1.28 is the comb`);

  // A centred source stays centred: the two channels share a read position,
  // so they have to come out identical.
  assert.equal(apart, 0, 'a centred source came out of the shifter uncentred');
});

test('the two spaces whose point is that they stop do not get a shimmer', () => {
  // Same reasoning as a plate having no Size knob. A gate holds and shuts and
  // a reverse swells and ends; a feedback path is a thing that keeps going.
  assert.deepEqual(SHIMMER_SPACES, ['room', 'plate', 'spring']);
  for (const space of SHIMMER_SPACES) {
    assert.ok(verbDeckFor(space).includes('shimmer'), `${space} has no shimmer knob`);
  }
  for (const space of ['gated', 'reverse']) {
    assert.ok(!verbDeckFor(space).includes('shimmer'),
      `${space} was handed a control that fights the only thing it is`);
  }
});

test('the shimmer worklet is built from the shifter, not a copy of it', () => {
  // The delay's lesson, which cost a silent processor: the parts list is by
  // hand, and a part left off it fails on the audio thread inside a blob,
  // where no console is listening and every test still passes.
  const source = shimmerSource();
  for (const name of ['shiftCore', 'shimmerRatio', 'SHIMMER_WINDOW',
    'SHIMMER_INTERVALS', 'SHIMMER_FLOOR']) {
    assert.ok(source.includes(name), `the audio thread needs ${name}`);
  }

  // Run what the audio thread is given and hold it against the module.
  const theirs = new Function(
    `${source.replace(/class HeadroomShimmer[\s\S]*$/, '')}; return shiftCore;`,
  )();
  const settings = { interval: 'fifthUp' };
  const mine = shiftCore(rate).set(settings);
  const yours = theirs(rate).set(settings);

  let worst = 0;
  for (let i = 0; i < rate; i += 1) {
    // Bursts, so the line fills and empties, and an interval change partway,
    // because that is arithmetic the audio thread has to get right too.
    if (i === Math.round(rate * 0.5)) {
      mine.set({ interval: 'octaveDown' });
      yours.set({ interval: 'octaveDown' });
    }
    const x = Math.sin((2 * Math.PI * 330 * i) / rate) * (i % 9000 < 3000 ? 0.9 : 0.05);
    mine.stereo(x, x * 0.5);
    yours.stereo(x, x * 0.5);
    worst = Math.max(worst, Math.abs(mine.left - yours.left), Math.abs(mine.right - yours.right));
  }
  assert.equal(worst, 0, 'what you hear has to be what you are marked on');
});

test('the shimmer loop is high-passed, and the corner is in the band it protects', () => {
  // Without one the loop silts up: a downward interval walks towards DC and
  // an upward one leaves the shifter's low spray behind to accumulate.
  // Measured as the centroid of the tail, octave up at a shimmer of 0.9 went
  // 330, 547, 1102, 1241 and then collapsed to 47 Hz and 35; octave down went
  // to 7 Hz by the third second. At 120 Hz the collapse does not happen and a
  // downward shimmer settles at 53 Hz, which is a bass note.
  assert.ok(SHIMMER_FLOOR >= 60 && SHIMMER_FLOOR <= 250,
    `a corner of ${SHIMMER_FLOOR} Hz is outside the range this was swept over`);

  // And the knob stops short of where the loop was measured to run away:
  // stable at 1.2, away at 1.5, so one leaves 3.5 dB in hand.
  assert.ok(MOST_SHIMMER <= 1.2, `a shimmer of ${MOST_SHIMMER} is past what was measured safe`);
});

/* --- the freeze ----------------------------------------------------------- */

/** A decaying noise tail, which is what a wet output is. */
function noiseTail(n) {
  let seed = 7717;
  let lp = 0;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    lp += (((seed / 0x3fffffff) - 1) - lp) * 0.25;
    out[i] = lp * Math.exp(-i / (rate * 1.2)) * 0.5;
  }
  return out;
}

/** The core run over a tail, frozen partway. */
function heldTail(freezeAt, seconds = 6) {
  const core = freezeCore(rate);
  const src = noiseTail(Math.round(rate * seconds));
  const out = new Float32Array(src.length);
  for (let i = 0; i < out.length; i += 1) {
    if (i === Math.round(freezeAt * rate)) core.set({ freeze: true });
    core.stereo(src[i], src[i]);
    out[i] = core.left;
  }
  return out;
}

test('a frozen room holds its level instead of decaying', () => {
  // The whole of what the word means, and the thing the first version did not
  // do. It kept recording while it played, so the write head walked through
  // the ring the loop was reading and every pass played newer material:
  // measured, a tail frozen at three seconds read -44.1, -44.4 and then -51.8
  // dB over the following seconds, still decaying. Recording stops now, and
  // the same measurement reads -37.0, -36.9, -36.9.
  const out = heldTail(1.5);
  const rms = (from, to) => {
    let sum = 0;
    for (let i = Math.round(from * rate); i < Math.round(to * rate); i += 1) sum += out[i] * out[i];
    return 20 * Math.log10(Math.sqrt(sum / ((to - from) * rate)) + 1e-20);
  };

  const held = [rms(3, 4), rms(4, 5), rms(5, 6)];
  for (const level of held) {
    assert.ok(Math.abs(level - held[0]) < 0.2,
      `the held level wandered: ${held.map((l) => l.toFixed(1)).join(', ')} dB`);
  }

  // And it is silent until it is pressed: this is a voice beside the room,
  // not in series with it, so before the button there is nothing of it at all.
  let before = 0;
  for (let i = 0; i < Math.round(1.5 * rate); i += 1) before = Math.max(before, Math.abs(out[i]));
  assert.equal(before, 0, 'the freeze voice made a sound before it was frozen');
});

test('a frozen room really is a loop, to the sample', () => {
  // Not approximately. Two passes have to be the same samples, because they
  // are the same samples - and when they were not, the reason was that
  // something was still writing to them.
  const out = heldTail(1.5);
  const fade = Math.round(FREEZE_FADE * rate);
  const body = Math.round(FREEZE_SECONDS * rate) - fade;
  const from = Math.round(1.5 * rate) + fade;

  let worst = 0;
  for (let i = 0; i < body - fade; i += 1) {
    worst = Math.max(worst, Math.abs(out[from + i] - out[from + body + i]));
  }
  assert.equal(worst, 0, 'two passes of the same loop differed outside the seam');
});

test('the seam does not click, and that is what the crossfade is for', () => {
  // Measured as the biggest sample-to-sample step - which is what an ear
  // hears as a click - at the seam against the biggest step anywhere in the
  // loop's body. With no crossfade the seam is 1.33 times the body's worst
  // step, which is a discontinuity bigger than anything in the material. With
  // one it is under a half.
  const out = heldTail(1.5);
  const fade = Math.round(FREEZE_FADE * rate);
  const body = Math.round(FREEZE_SECONDS * rate) - fade;
  const seam = Math.round(1.5 * rate) + body;

  const step = (from, to) => {
    let worst = 0;
    for (let i = Math.max(1, from); i < to; i += 1) {
      worst = Math.max(worst, Math.abs(out[i] - out[i - 1]));
    }
    return worst;
  };

  const atSeam = step(seam - 8, seam + 8);
  const elsewhere = step(seam + 2000, seam + 20000);
  assert.ok(atSeam < elsewhere,
    `the seam stepped ${atSeam.toExponential(2)} against ${elsewhere.toExponential(2)} in the body`);
});

test('the crossfade is equal power, because the two ends are uncorrelated', () => {
  // The measurement that chose the law, and the reason it is not the same
  // answer as the delay's time-change fade. There the two sides are one sound
  // at two delays, which is correlated and dips whatever you do. Here they
  // are two different parts of a noise tail, so their energies add and
  // weights that sum to one in power hold the level where weights that sum to
  // one in amplitude leave a three-decibel hole:
  //
  //     equal power, 10 ms     -0.01 dB
  //     equal gain, 10 ms      -2.95 dB
  //
  // Asserted on the shape of the weights rather than on a rendered level,
  // because that is the thing that would be wrong if somebody changed it.
  const fade = Math.round(FREEZE_FADE * rate);
  for (const at of [0, fade / 4, fade / 2, (fade * 3) / 4, fade - 1]) {
    const t = at / fade;
    const rising = Math.sin((t * Math.PI) / 2);
    const falling = Math.cos((t * Math.PI) / 2);
    assert.ok(Math.abs(rising * rising + falling * falling - 1) < 1e-12,
      `at ${(100 * t).toFixed(0)} % through the fade the two weights do not sum to one in power`);
  }
});

test('a freeze pressed early holds what there is, not the silence in front of it', () => {
  // The ring takes a second to fill, and a freeze can be pressed before that.
  // What it must not do is loop the zeros the ring still holds - half a second
  // of room and half a second of nothing, once a second, is a very audible
  // fault. Measured: frozen a fifth of a second in, the level holds flat.
  const out = heldTail(0.2);
  const rms = (from, to) => {
    let sum = 0;
    for (let i = Math.round(from * rate); i < Math.round(to * rate); i += 1) sum += out[i] * out[i];
    return 20 * Math.log10(Math.sqrt(sum / ((to - from) * rate)) + 1e-20);
  };
  const held = [rms(1, 2), rms(2, 3), rms(3, 4), rms(4, 5)];
  for (const level of held) {
    assert.ok(Math.abs(level - held[0]) < 0.2,
      `frozen early, the level went ${held.map((l) => l.toFixed(1)).join(', ')} dB`);
  }
  // And there is no silent stretch in it, which is what looping the unwritten
  // part of the ring would sound like.
  const per = Math.round(rate * 0.05);
  for (let f = Math.round(rate * 1.5); f + per < Math.round(rate * 4); f += per) {
    let peak = 0;
    for (let i = f; i < f + per; i += 1) peak = Math.max(peak, Math.abs(out[i]));
    assert.ok(peak > 1e-5, `a silent 50 ms gap at ${(f / rate).toFixed(2)} s`);
  }
});

test('the freeze worklet is built from the core, not a copy of it', () => {
  const source = freezeSource();
  for (const name of ['freezeCore', 'FREEZE_SECONDS', 'FREEZE_FADE']) {
    assert.ok(source.includes(name), `the audio thread needs ${name}`);
  }

  // It is a param and not a message, because a freeze is a moment rather than
  // a mode - and because a message is never delivered inside an offline
  // render, which is where this is tested. Measured before it was a param: a
  // freeze scheduled through the port read identically to one never pressed,
  // at every time it was tried.
  assert.ok(source.includes('parameterDescriptors') && source.includes("name: 'freeze'"),
    'the freeze has to be an AudioParam to be scheduled or rendered');

  const theirs = new Function(
    `${source.replace(/class HeadroomFreeze[\s\S]*$/, '')}; return freezeCore;`,
  )();
  const mine = freezeCore(rate);
  const yours = theirs(rate);
  const src = noiseTail(Math.round(rate * 3));

  let worst = 0;
  for (let i = 0; i < src.length; i += 1) {
    if (i === Math.round(rate * 1.2)) {
      mine.set({ freeze: true });
      yours.set({ freeze: true });
    }
    mine.stereo(src[i], src[i] * 0.5);
    yours.stereo(src[i], src[i] * 0.5);
    worst = Math.max(worst, Math.abs(mine.left - yours.left), Math.abs(mine.right - yours.right));
  }
  assert.equal(worst, 0, 'what you hear has to be what you are marked on');
});

test('a freeze does not change the response either', () => {
  // Same promise the shimmer makes, for the same reason: it is not in the
  // impulse, and the impulse is what is drawn and marked.
  for (const space of SPACE_ORDER) {
    const without = room({ space });
    const with_ = room({ space, freeze: true });
    assert.equal(with_.length, without.length, `${space} changed length`);
    for (let c = 0; c < without.channels.length; c += 1) {
      for (let i = 0; i < without.length; i += 1) {
        if (with_.channels[c][i] !== without.channels[c][i]) {
          assert.fail(`${space} with a freeze differs at sample ${i}`);
        }
      }
    }
  }
});
