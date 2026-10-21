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

import { TOOLS, TOOL_IDS } from '../src/bench/registry.js';
import { HIT, NEAR, MISS } from '../src/work/scoring.js';
import { makePuzzle, settingsFor, scoreGuess } from '../src/game.js';

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

test('a drill over several rounds asks more than one thing', () => {
  // A drill whose answer barely moves is a drill you pass by picking the same
  // chip every time.
  for (const [id, tier] of DRILLS) {
    const seen = new Set();
    for (let i = 0; i < 40; i += 1) {
      seen.add(JSON.stringify(drillPuzzle(id, tier, `spread-${id}-${tier}-${i}`).answer));
    }
    assert.ok(seen.size >= 4, `${id}/${tier} only ever asks ${seen.size} different things`);
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
