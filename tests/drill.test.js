// The identification drills: the half of this app that asks rather than hands
// you a tool.
//
// A drill is an exercise like any other - same `makePuzzle`, same `score` -
// except that it has slots, so it is answered by naming what you heard rather
// than by building it. What is checked here is the part the shared contract
// tests cannot see: that the answer a drill generates is one a person could
// actually hear, that a near miss is a near miss for a measured reason, and
// that the reading says how far off rather than that you were wrong.

import test from 'node:test';
import assert from 'node:assert/strict';

import { TOOLS, TOOL_IDS } from '../src/learn/bench/registry.js';
import { HIT, NEAR, MISS } from '../src/learn/work/scoring.js';
import { makePuzzle, settingsFor, scoreGuess } from '../src/learn/game.js';

/** Every tool that has a drill, and the tiers it offers one at. */
const DRILLS = TOOL_IDS
  .filter((id) => TOOLS[id].exercises.drill)
  .flatMap((id) => Object.keys(TOOLS[id].tiers).map((tier) => [id, tier]));

const drillPuzzle = (id, tier, seed) => makePuzzle({
  mode: id, tier, settings: settingsFor(id, { exercise: 'drill' }), seed,
});

const slotsOf = (id, tier) => TOOLS[id].slots(tier, { exercise: 'drill' });

/* --- what every drill owes, whichever tool it is on ---------------------- */

test('a drill asks with chips, and an exercise does not', () => {
  for (const [id, tier] of DRILLS) {
    assert.ok(slotsOf(id, tier).length, `${id}/${tier} has a drill that asks nothing`);

    for (const key of Object.keys(TOOLS[id].exercises)) {
      if (key === 'drill') continue;
      assert.equal(TOOLS[id].slots(tier, { exercise: key }).length, 0,
        `${id}/${tier}/${key} is a tool exercise and should be answered on the tool`);
    }
  }
});

test('a drill says it is one, and says what it is asking', () => {
  // The shell reads both: `drill` is why the tool goes away - its display
  // would be showing the answer - and `ask` is the question that replaces it.
  for (const id of TOOL_IDS) {
    const drill = TOOLS[id].exercises.drill;
    if (!drill) continue;
    assert.equal(drill.drill, true, `${id}'s drill does not declare itself`);
    assert.ok(drill.ask && drill.ask.length > 15, `${id}'s drill does not say what it asks`);
    assert.match(drill.ask, /\?$/, `${id}'s drill does not ask a question`);
  }
});

test('every answer a drill generates is on the chips that tier offers', () => {
  for (const [id, tier] of DRILLS) {
    const slots = slotsOf(id, tier);
    for (let i = 0; i < 60; i += 1) {
      const puzzle = drillPuzzle(id, tier, `${id}-${tier}-${i}`);
      for (const slot of slots) {
        if (slot.kind === 'range') {
          assert.ok(puzzle.answer[slot.id] >= slot.min && puzzle.answer[slot.id] <= slot.max,
            `${id}/${tier} answers ${slot.id}=${puzzle.answer[slot.id]}, off its own control`);
        } else {
          assert.ok(slot.options.some((o) => o.id === puzzle.answer[slot.id]),
            `${id}/${tier} answers ${slot.id}=${puzzle.answer[slot.id]}, which is not a chip`);
        }
      }
    }
  }
});

test('a drill is only right when every part of it is right', () => {
  for (const [id, tier] of DRILLS) {
    const puzzle = drillPuzzle(id, tier, `all-${id}-${tier}`);
    const slots = slotsOf(id, tier);
    assert.ok(scoreGuess({ ...puzzle.answer }, puzzle).correct, `${id}/${tier} refuses its own answer`);

    for (const slot of slots.filter((s) => s.kind !== 'range')) {
      const other = slot.options.find((o) => o.id !== puzzle.answer[slot.id]);
      const guess = { ...puzzle.answer, [slot.id]: other.id };
      assert.ok(!scoreGuess(guess, puzzle).correct,
        `${id}/${tier} passes with the wrong ${slot.id}`);
    }
  }
});

test('no drill can be passed by picking the same chip every time', () => {
  // Not a count of how many answers exist - three well-separated amounts of
  // gain reduction is all this loop supports at the easy tier, and three
  // honest answers beat six somebody has to guess between. What matters is
  // that no one of them comes up often enough to be worth always picking.
  const ROUNDS = 120;

  for (const [id, tier] of DRILLS) {
    const counts = new Map();
    for (let i = 0; i < ROUNDS; i += 1) {
      const key = JSON.stringify(drillPuzzle(id, tier, `spread-${id}-${tier}-${i}`).answer);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    assert.ok(counts.size >= 3, `${id}/${tier} only ever asks ${counts.size} different things`);

    const commonest = Math.max(...counts.values()) / ROUNDS;
    assert.ok(commonest < 0.5,
      `${id}/${tier} answers the same thing ${Math.round(commonest * 100)}% of the time`);
  }
});

/* --- the EQ drill: which octave moved, and which way --------------------- */

const eqDrill = (tier, seed = 'eq-drill') => drillPuzzle('eq', tier, seed);
const eqScore = (guess, puzzle) => scoreGuess(guess, puzzle);

test('the EQ drill offers the octaves a move is audible in, and no others', () => {
  // 31.5 Hz and 16 kHz are not on the chips: the bed holds -20.1 dB and
  // -32.7 dB there against its loudest octave, and the same move lifts them
  // by 6.3 and 4.3 dB against 6.1-7.3 dB everywhere else.
  const octaves = (tier) => slotsOf('eq', tier)[0].options.map((o) => o.id);

  assert.deepEqual(octaves('medium'), ['63', '125', '250', '500', '1k', '2k', '4k', '8k']);
  assert.deepEqual(octaves('hard'), octaves('medium'));

  // Easy offers every other one, so the chip beside the right one is two
  // octaves away rather than one.
  assert.deepEqual(octaves('easy'), ['63', '250', '1k', '4k']);
});

test('the EQ drill bakes the move into the sample, one octave wide', () => {
  for (const [tier, gain] of [['easy', 9], ['medium', 6], ['hard', 4]]) {
    for (let i = 0; i < 20; i += 1) {
      const puzzle = eqDrill(tier, `fault-${tier}-${i}`);
      const { fault, answer } = puzzle;

      assert.equal(fault.type, 'peaking');
      assert.equal(fault.q, 1.41, 'one octave wide, which is what the numbers were measured at');
      assert.equal(Math.abs(fault.gain), gain, `${tier} moves by ${gain} dB`);
      assert.equal(fault.gain > 0, answer.move === 'boost', 'the sign is the direction');

      const slot = slotsOf('eq', tier)[0];
      const chip = slot.options.find((o) => o.id === answer.band);
      assert.equal(fault.frequency, chip.hz, 'the move is at the octave it names');
    }
  }
});

test('the EQ drill reads one octave out as close, and two as a miss', () => {
  // Measured on the bed: a move at one octave shows up in the octave next
  // door at about a third of its size, and two octaves away at a tenth or
  // less. So next door heard it in roughly the right place; two along did not.
  const puzzle = { ...eqDrill('medium', 'near'), answer: { band: '1k', move: 'boost' } };
  puzzle.fault = { type: 'peaking', frequency: 1000, gain: 6, q: 1.41, on: true };

  const at = (band) => eqScore({ band, move: 'boost' }, puzzle).cells[0].state;
  assert.equal(at('1k'), HIT);
  assert.equal(at('500'), NEAR, 'the octave below is a near miss');
  assert.equal(at('2k'), NEAR, 'and so is the one above');
  assert.equal(at('250'), MISS, 'two octaves away is not close');
  assert.equal(at('8k'), MISS);
});

test('the easy tier is right or wrong, with nothing in between', () => {
  // Its chips are two octaves apart, so the one beside the answer is the one
  // that shares a tenth of the move. Calling that "close" would tell somebody
  // they nearly heard it when what they heard was somewhere else.
  const puzzle = { ...eqDrill('easy', 'exact'), answer: { band: '1k', move: 'cut' } };
  puzzle.fault = { type: 'peaking', frequency: 1000, gain: -9, q: 1.41, on: true };

  assert.equal(eqScore({ band: '1k', move: 'cut' }, puzzle).cells[0].state, HIT);
  for (const band of ['63', '250', '4k']) {
    assert.equal(eqScore({ band, move: 'cut' }, puzzle).cells[0].state, MISS,
      `${band} is not a near miss at the easy tier`);
  }
});

test('the EQ drill says how far off in octaves, and which way', () => {
  const puzzle = { ...eqDrill('medium', 'say'), answer: { band: '1k', move: 'boost' } };
  puzzle.fault = { type: 'peaking', frequency: 1000, gain: 6, q: 1.41, on: true };

  const read = (band, move = 'boost') => eqScore({ band, move }, puzzle).cells[2].text;
  assert.equal(read('1k'), 'that is it');
  assert.equal(read('2k'), '1 octave high');
  assert.equal(read('250'), '2 octaves low');
  assert.equal(read('8k'), '3 octaves high');
  assert.equal(read('1k', 'cut'), 'right octave, wrong way');
});

test('the direction is exact or nothing: there is no half a boost', () => {
  const puzzle = { ...eqDrill('medium', 'dir'), answer: { band: '250', move: 'cut' } };
  puzzle.fault = { type: 'peaking', frequency: 250, gain: -6, q: 1.41, on: true };

  assert.equal(eqScore({ band: '250', move: 'cut' }, puzzle).cells[1].state, HIT);
  assert.equal(eqScore({ band: '250', move: 'boost' }, puzzle).cells[1].state, MISS);
  assert.ok(!eqScore({ band: '250', move: 'boost' }, puzzle).correct,
    'the right octave the wrong way is not the answer');
});

test('the EQ drill names a weak spot by octave, so the stats can say which', () => {
  const puzzle = { ...eqDrill('medium', 'weak'), answer: { band: '2k', move: 'boost' } };
  const kind = TOOLS.eq.weak(puzzle);
  assert.equal(kind.key, 'octave-2k');
  assert.match(kind.label, /2k/);
  assert.match(kind.label, /honk/);
});

/* --- the compression drill: how much is it doing ------------------------- */

/** A loop of struck hits, for solving a compressor against. */
function hits(rate = 48000, beats = 8, seconds = 4) {
  const samples = new Float32Array(Math.round(rate * seconds));
  const span = samples.length / beats;
  for (let beat = 0; beat < beats; beat += 1) {
    const from = Math.floor(beat * span);
    for (let i = 0; i < Math.floor(rate * 0.22) && from + i < samples.length; i += 1) {
      const t = i / rate;
      samples[from + i] = 0.62 * (Math.sin(2 * Math.PI * 90 * t) * Math.exp(-t * 22)
        + 0.35 * Math.sin(2 * Math.PI * 1800 * t) * Math.exp(-t * 90));
    }
  }
  return samples;
}

test('the compression drill solves a compressor that does what it says', async () => {
  // The answer is a property of the loop, so the settings are solved against
  // the loop rather than stored - and this is the check that the solving
  // works. Over a loop of hits, which is what a test has instead of a
  // rendered bed.
  const { analyse } = await import('../src/plugins/compressor/dsp.js');
  const drill = TOOLS.compression.exercises.drill;
  const rate = 48000;
  const samples = hits(rate);

  for (const tier of ['easy', 'medium', 'hard']) {
    for (let i = 0; i < 8; i += 1) {
      const puzzle = drillPuzzle('compression', tier, `comp-drill-${tier}-${i}`);
      // What the session does: pin the material, then ask for the settings.
      puzzle.material = { rate, samples, even: samples, key: null };

      const settings = drill.startOf(puzzle);
      const want = Number(puzzle.answer.reduction);
      const got = analyse(samples, rate, { ...settings, makeup: 0 }).makeup;

      assert.ok(Math.abs(got - want) < 0.6,
        `${tier}: asked for ${want} dB, the compressor does ${got.toFixed(2)}`);
      assert.ok(settings.threshold <= 0, 'a threshold above zero compresses nothing');
      if (want === 0) assert.equal(settings.makeup, 0, 'nothing to put back');
      else assert.ok(settings.makeup > 0, 'the level has to be put back, or it is a loudness test');
    }
  }
});

test('the compression drill changes only how much it is doing', () => {
  // Ratio and attack are fixed, so the one thing that moves between rounds is
  // the question. Anything else moving would be a second question nobody was
  // asked.
  const drill = TOOLS.compression.exercises.drill;
  const seen = new Set();
  for (let i = 0; i < 12; i += 1) {
    const s = drill.startOf(drillPuzzle('compression', 'hard', `fixed-${i}`));
    seen.add(`${s.ratio}:${s.attack}:${s.release}:${s.knee}`);
  }
  assert.equal(seen.size, 1, `the shape of the compressor moved: ${[...seen].join(', ')}`);
});

test('the compression drill puts the level back, so it is not a loudness test', () => {
  const drill = TOOLS.compression.exercises.drill;
  for (let i = 0; i < 6; i += 1) {
    const puzzle = drillPuzzle('compression', 'hard', `level-${i}`);
    const settings = drill.startOf(puzzle);
    const want = Number(puzzle.answer.reduction);
    // The makeup is the measured reduction, put back.
    assert.ok(Math.abs(settings.makeup - want) < 0.6 || want === 0,
      `makeup ${settings.makeup.toFixed(2)} does not match ${want} dB of reduction`);
  }
});

test('the compression drill reads a step out as a step out, in decibels', () => {
  const puzzle = { ...drillPuzzle('compression', 'medium', 'read'),
    answer: { reduction: '6' } };
  const read = (reduction) => scoreGuess({ reduction }, puzzle);

  assert.equal(read('6').cells[1].text, 'that is it');
  assert.equal(read('9').cells[1].text, '3 dB too much');
  assert.equal(read('2').cells[1].text, '4 dB too little');
  assert.equal(read('4').cells[0].state, NEAR, 'one step out is close at this tier');
  assert.equal(read('0').cells[0].state, MISS);
});

/* --- the saturation drill: warm against dirty ---------------------------- */

test('the saturation drill makes the colour it claims to', async () => {
  // Measured on the sine probe this tool marks everything with. The odd side
  // is a symmetric curve, which makes no even harmonics at all.
  const { harmonicsOf, HEAT_DEFAULTS } = await import('../src/plugins/saturation/shape.js');
  const drill = TOOLS.saturation.exercises.drill;

  for (const tier of ['easy', 'medium', 'hard']) {
    for (let i = 0; i < 8; i += 1) {
      const puzzle = drillPuzzle('saturation', tier, `heat-${tier}-${i}`);
      const h = harmonicsOf(48000, { ...HEAT_DEFAULTS, ...drill.startOf(puzzle) });
      const lead = h.even - h.odd;

      if (puzzle.answer.colour === 'even') {
        assert.ok(lead >= 8, `an even round leads by only ${lead.toFixed(1)} dB`);
      } else {
        assert.ok(lead <= -100, `an odd round has even harmonics at ${h.even.toFixed(1)} dB`);
      }
    }
  }
});

test('the saturation drill matches its amounts across the two colours', async () => {
  // Or the colour could be read off the volume and nobody would learn
  // anything. Measured: within 1.3 dB, with the bands about 4 dB apart.
  const { harmonicsOf, HEAT_DEFAULTS } = await import('../src/plugins/saturation/shape.js');
  const drill = TOOLS.saturation.exercises.drill;

  const thdOf = (colour, amount) => harmonicsOf(48000, {
    ...HEAT_DEFAULTS,
    ...drill.startOf({ answer: { colour, amount } }),
  }).thd;

  const bands = [];
  for (const amount of ['light', 'pushed', 'heavy']) {
    const even = thdOf('even', amount);
    const odd = thdOf('odd', amount);
    assert.ok(Math.abs(even - odd) <= 1.4,
      `${amount}: warm reads ${even.toFixed(1)} and dirty ${odd.toFixed(1)}`);
    bands.push((even + odd) / 2);
  }

  for (let i = 1; i < bands.length; i += 1) {
    assert.ok(bands[i] - bands[i - 1] >= 3,
      `the amounts are only ${(bands[i] - bands[i - 1]).toFixed(1)} dB apart`);
  }
});

test('the saturation drill scores the colour exact and the amount on a scale', () => {
  const puzzle = { ...drillPuzzle('saturation', 'medium', 'col'),
    answer: { colour: 'even', amount: 'pushed' } };
  const read = (colour, amount) => scoreGuess({ colour, amount }, puzzle);

  assert.ok(read('even', 'pushed').correct);
  assert.equal(read('odd', 'pushed').cells[0].state, MISS, 'there is no nearly warm');
  assert.equal(read('odd', 'pushed').cells[2].text, 'it was octaves');
  assert.equal(read('even', 'light').cells[1].state, NEAR, 'one step of amount is close');
  assert.ok(!read('even', 'light').correct);
});

/* --- the stereo drill: where it sits ------------------------------------- */

test('the stereo drill pans the tool to the place it is asking about', () => {
  const drill = TOOLS.panning.exercises.drill;
  const places = { hardleft: -1, left: -0.66, halfleft: -0.33, centre: 0, halfright: 0.33, right: 0.66, hardright: 1 };

  for (const tier of ['easy', 'medium', 'hard']) {
    for (let i = 0; i < 10; i += 1) {
      const puzzle = drillPuzzle('panning', tier, `pan-${tier}-${i}`);
      assert.equal(drill.startOf(puzzle).pan, places[puzzle.answer.place]);
    }
  }

  // And it is a mono source, because a pan is the only thing that has
  // happened to it - on a stereo one the pan would destroy the width.
  assert.equal(drill.source, 'instrument');
});

test('the stereo drill counts places on the field, not on the chips', () => {
  // The easy tier offers three chips covering seven places, so "one chip out"
  // there would be two thirds of the field.
  const puzzle = { ...drillPuzzle('panning', 'easy', 'count'), answer: { place: 'centre' } };
  assert.equal(scoreGuess({ place: 'hardleft' }, puzzle).cells[1].text, '3 places too far left');
  assert.equal(scoreGuess({ place: 'hardright' }, puzzle).cells[1].text, '3 places too far right');
  assert.equal(scoreGuess({ place: 'hardleft' }, puzzle).cells[0].state, MISS,
    'two thirds of the field is not a near miss');
});

/* --- the delay drill: which note ----------------------------------------- */

test('the delay drill sets the time its division asks for', async () => {
  const { DIVISIONS, timeOf, ECHO_DEFAULTS } = await import('../src/plugins/delay/line.js');
  const drill = TOOLS.delay.exercises.drill;

  for (const tier of ['easy', 'medium', 'hard']) {
    for (let i = 0; i < 10; i += 1) {
      const puzzle = drillPuzzle('delay', tier, `echo-${tier}-${i}`);
      const division = DIVISIONS.find((d) => d.id === puzzle.answer.division);
      assert.ok(division, `${puzzle.answer.division} is not one of the delay's divisions`);
      assert.equal(drill.startOf(puzzle).time, timeOf(division.beats));
      assert.ok(drill.startOf(puzzle).mix > ECHO_DEFAULTS.mix * 0.8,
        'the repeats have to be loud enough to count');
    }
  }
});

test('the delay drill reads a wrong division as a ratio, not a number of ms', () => {
  // A quarter is 625.0 ms and an eighth 312.5, so one is twice the other
  // wherever the tempo sits. Milliseconds would be a number about this track.
  const puzzle = { ...drillPuzzle('delay', 'hard', 'ratio'), answer: { division: 'eighth' } };
  const read = (division) => scoreGuess({ division }, puzzle);

  assert.equal(read('eighth').cells[1].text, 'that is it');
  assert.equal(read('quarter').cells[1].text, '2.00× too slow');
  assert.equal(read('sixteenth').cells[1].text, '2.00× too fast');
  assert.equal(read('dotted8').cells[1].text, '1.50× too slow');
  assert.equal(read('dotted8').cells[0].state, NEAR, 'next door is next door');
});

/* --- the reverb drill: the one that is both picked and dialled ----------- */

test('the reverb drill asks one question on a control and one with chips', () => {
  for (const tier of ['easy', 'medium', 'hard']) {
    const slots = slotsOf('reverb', tier);
    assert.equal(slots.length, 2);

    // The dialled one first, because that is the one that says which way to
    // move and where the shell looks for it.
    assert.equal(slots[0].kind, 'range');
    assert.equal(slots[0].id, 'tail');
    assert.equal(slots[1].kind, 'choice');
    assert.ok(slots[0].hit < slots[0].near, 'close has to be wider than right');
  }

  // And it loosens with the tier, because this is dialled blind.
  assert.ok(slotsOf('reverb', 'easy')[0].hit > slotsOf('reverb', 'hard')[0].hit);
});

test('the reverb drill answers with the tail it measured, not the knob', async () => {
  // The two are not the same: a decay of 1.2 rings for 0.78 to 1.04 s. A
  // drill marked on the control would be teaching that number.
  const { makeImpulse } = await import('../src/plugins/reverb/ir.js');
  const { monoOf, rt60 } = await import('../src/lib/response.js');
  const drill = TOOLS.reverb.exercises.drill;

  for (const tier of ['easy', 'medium', 'hard']) {
    for (let i = 0; i < 4; i += 1) {
      const puzzle = drillPuzzle('reverb', tier, `room-${tier}-${i}`);
      const room = drill.startOf(puzzle);
      const measured = rt60(monoOf(makeImpulse(48000, { ...room, mix: 1 })), 48000);

      assert.ok(Math.abs(measured - puzzle.answer.tail) < 0.01,
        `${tier}: answers ${puzzle.answer.tail} s for a room that rings ${measured.toFixed(3)}`);
      assert.ok(puzzle.answer.tail < room.decay,
        'the room rings for less time than its decay control says');
      assert.equal(room.preDelay, 0,
        'a pre-delay would be a second answer to the how-big question');
    }
  }
});

test('the reverb drill tells a wrong length from a wrong space', () => {
  const puzzle = {
    ...drillPuzzle('reverb', 'hard', 'room-read'),
    answer: { tail: 1.2, size: 'medium' },
  };
  const read = (tail, size) => scoreGuess({ tail, size }, puzzle);

  assert.ok(read(1.2, 'medium').correct);
  assert.equal(read(1.2, 'small').cells[2].text, 'right length, wrong space');
  assert.equal(read(3.0, 'medium').cells[2].text, 'right space, wrong length');
  assert.equal(read(3.0, 'small').cells[2].text, 'neither yet');
  assert.match(read(3.0, 'medium').cells[0].text, /long$/, 'and says which way');
  assert.match(read(0.5, 'medium').cells[0].text, /short$/);
});
