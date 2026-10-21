import test from 'node:test';
import assert from 'node:assert/strict';

import { TOOLS as MODES, TOOL_IDS as MODE_IDS, toolOf as modeOf } from '../src/bench/registry.js';
import { HIT, NEAR, MISS } from '../src/work/scoring.js';
import {
  makePuzzle, createGame, submitGuess, reveal, settingsFor, startingGuess,
  scoreGuess,
} from '../src/game.js';
import { answerAsGuess, wrongGuess, everyRound } from './helpers.js';

const ROUNDS = everyRound();

test('every tool is the same shape, so the shell never has to ask which it is', () => {
  for (const [id, tool] of Object.entries(MODES)) {
    assert.equal(tool.id, id, 'a tool knows its own key');
    assert.ok(tool.label && tool.blurb && tool.lede, `${id} has to introduce itself`);

    // What a tool is: something you can open, that explains itself.
    assert.equal(typeof tool.open, 'function', `${id} cannot be opened`);
    assert.ok(Array.isArray(tool.help) && tool.help.length, `${id} has no help`);
    assert.ok(tool.notes, `${id} has no notes`);

    // What the work is: exercises over it, and how to mark one.
    for (const fn of ['slots', 'makePuzzle', 'score', 'hints', 'reveal', 'weak']) {
      assert.equal(typeof tool[fn], 'function', `${id} is missing ${fn}`);
    }
    assert.ok(Object.keys(tool.tiers).length >= 2, `${id} needs tiers to be a tier`);
    assert.ok(Object.keys(tool.exercises).length >= 2, `${id} needs more than one exercise`);
  }
});

test('an exercise says how to set a tool up, as data rather than as a mount', () => {
  // The inversion, asserted. Every one of these used to be spelled out inside
  // a `mount(el, { puzzle })`, which is why a change of exercise meant a
  // teardown: the only way to apply one was to build a new plugin around it.
  for (const [id, tool] of Object.entries(MODES)) {
    for (const [key, exercise] of Object.entries(tool.exercises)) {
      const where = `${id}/${key}`;
      assert.equal(exercise.id, key, `${where} does not know its own key`);
      assert.ok(exercise.label, `${where} has no name to put in the picker`);
      assert.ok(exercise.source, `${where} does not say what it runs on`);
      assert.ok(exercise.other, `${where} does not name the other side of the A/B`);

      // The two that a session calls. Optional, because a reverb has no fault
      // to put in its material and an exercise may have no target to hear -
      // but if they are there they have to be callable with a puzzle.
      for (const fn of ['faultOf', 'targetOf', 'answerOf']) {
        if (exercise[fn]) assert.equal(typeof exercise[fn], 'function', `${where}.${fn}`);
      }
    }

    // And the exercise picker is built from them, rather than listed twice.
    const picker = (tool.settings ?? []).find((s) => s.id === 'exercise');
    assert.ok(picker, `${id} has exercises and no way to choose one`);
    assert.deepEqual(picker.options.map((o) => o.id), Object.keys(tool.exercises));
  }
});

test('a tool exercise is answered on the tool, and only a drill asks with chips', () => {
  // Which is why `slots` takes the settings. A tool that asked for chips
  // whatever it was set to would be drawing a picker under a plugin that
  // already answers the question - and a drill that did not ask for them
  // would have nowhere to put the answer.
  for (const [id, tool] of Object.entries(MODES)) {
    for (const [, tier, settings] of ROUNDS.filter(([which]) => which === id)) {
      const chosen = settingsFor(id, settings);
      const slots = tool.slots(tier, chosen);

      if (tool.exercises[chosen.exercise]?.drill) {
        assert.ok(slots.length, `${id}/${tier} has a drill that asks nothing`);
      } else {
        assert.equal(slots.length, 0, `${id}/${tier}/${chosen.exercise} brings a tool and a picker`);
      }
    }

    // And with nothing said about the settings, a tool is a tool: this is the
    // call the shell makes before a round exists.
    assert.equal(tool.slots('easy').length, 0, `${id} asks for chips with no exercise set`);
  }
});

test('a slot is either options to pick or a control to dial, and says which', () => {
  for (const [id, tier, settings] of ROUNDS) {
    for (const slot of MODES[id].slots(tier, settingsFor(id, settings))) {
      assert.ok(slot.id && slot.label, `${id}/${tier} slot needs an id and a question`);

      if (slot.kind === 'range') {
        assert.ok(slot.max > slot.min, `${id}/${tier}/${slot.id} has no range`);
        assert.ok(slot.log || slot.step > 0, `${id}/${tier}/${slot.id} has no step`);
        assert.equal(typeof slot.format, 'function', `${id}/${tier}/${slot.id} cannot write itself down`);
        assert.ok(slot.hit < slot.near, `${id}/${tier}/${slot.id}: close has to be wider than right`);
        assert.ok(slot.below && slot.above, `${id}/${tier}/${slot.id} cannot say which way to turn`);
        assert.ok(slot.start >= slot.min && slot.start <= slot.max,
          `${id}/${tier}/${slot.id} starts off its own scale`);
        continue;
      }

      const ids = slot.options.map((option) => option.id);
      assert.equal(new Set(ids).size, ids.length, `${id}/${tier}/${slot.id} repeats an option`);
      for (const option of slot.options) {
        assert.ok(option.symbol, `${id}/${tier} option ${option.id} has nothing written on it`);
      }
    }
  }
});

test('generated answers are always reachable from the controls on screen', () => {
  for (const [id, tier, settings] of ROUNDS) {
    const chosen = settingsFor(id, settings);
    for (let i = 0; i < 40; i += 1) {
      const puzzle = makePuzzle({ mode: id, tier, settings: chosen, seed: `${id}-${tier}-${i}` });

  
      for (const slot of MODES[id].slots(tier, chosen)) {
        const answer = puzzle.answer[slot.id];
        if (slot.kind === 'range') {
          assert.ok(answer >= slot.min && answer <= slot.max,
            `${id}/${tier} answers ${slot.id}=${answer}, off its own control`);
        } else {
          assert.ok(slot.options.some((option) => option.id === answer),
            `${id}/${tier} answers ${slot.id}=${answer}, which is not on offer`);
        }
      }
    }
  }
});

test('matching exactly what was played wins, in every mode, tier and exercise', () => {
  for (const [id, tier, settings] of ROUNDS) {
    const chosen = settingsFor(id, settings);
    const puzzle = makePuzzle({ mode: id, tier, settings: chosen, seed: `win-${id}-${tier}` });
    const perfect = answerAsGuess(puzzle);
    // Some exercises are marked on the result and keep no answer to play back.
    if (perfect === null) continue;
    const score = scoreGuess(perfect, puzzle);

    assert.ok(score.correct, `${id}/${tier} does not accept its own answer`);
    for (const cell of score.cells) {
      assert.equal(cell.state, HIT, `${id}/${tier} reads a perfect guess as ${cell.state}`);
    }
  }
});

test('a wrong guess is read as wrong, and says which way to move', () => {
  for (const [id, tier, settings] of ROUNDS) {
    const chosen = settingsFor(id, settings);
    const puzzle = makePuzzle({ mode: id, tier, settings: chosen, seed: `miss-${id}-${tier}` });
    const score = scoreGuess(wrongGuess(puzzle), puzzle);

    assert.ok(!score.correct, `${id}/${tier} accepted a guess outside every tolerance`);


    const dialled = MODES[id].slots(tier, chosen).filter((slot) => slot.kind === 'range');
    if (!dialled.length) continue;

    // A control that is out says how far and which way, or the next attempt is
    // a guess rather than an adjustment.
    for (const [i, slot] of dialled.entries()) {
      const cell = score.cells[i];
      if (cell.state === HIT) continue;
      assert.match(cell.text, new RegExp(`${slot.below}|${slot.above}`),
        `${id}/${tier}/${slot.id} says "${cell.text}", which does not say which way`);
    }
  }
});

test('a reading comes back for every slot, and never fewer than two', () => {
  for (const [id, tier, settings] of ROUNDS) {
    const chosen = settingsFor(id, settings);
    const puzzle = makePuzzle({ mode: id, tier, settings: chosen, seed: `cells-${id}-${tier}` });
    const slots = MODES[id].slots(tier, chosen);
    // Through the real path, which hands the mode its puzzle: some of them
    // need it to know which exercise they are being asked about.
    const perfect = answerAsGuess(puzzle) ?? wrongGuess(puzzle);
    const cells = scoreGuess(perfect, puzzle).cells;

    assert.ok(cells.length >= slots.length, `${id}/${tier} drops a slot from the board`);
    assert.ok(cells.length >= 2, `${id}/${tier} has nothing to make a row out of`);

    // Picking from chips: the cell is the pick, so a mode that only does that
    // owes the player a reading of its own beyond it.
    if (slots.every((slot) => slot.kind !== 'range')) {
      assert.ok(cells.length > slots.length,
        `${id}/${tier} says nothing beyond repeating the guess back`);
    }

    for (const cell of cells) {
      assert.ok([HIT, NEAR, MISS].includes(cell.state), `${id}/${tier} invented a state`);
      assert.ok(String(cell.text).length > 0, `${id}/${tier} has an empty cell`);
    }
  }
});

test('every mode can say what the answer was, and what kind of answer it is', () => {
  for (const [id, tier, settings] of ROUNDS) {
    const puzzle = makePuzzle({ mode: id, tier, settings: settingsFor(id, settings), seed: `reveal-${id}-${tier}` });
    assert.ok(reveal(puzzle).symbol, `${id}/${tier} reveals nothing`);

    const kind = MODES[id].weak(puzzle);
    assert.ok(kind.key !== undefined && kind.label, `${id}/${tier} cannot name a weak spot`);
  }
});

test('the EQ fix exercise hands you a fault, and the answer cures it', () => {
  for (const tier of Object.keys(MODES.eq.tiers)) {
    const puzzle = makePuzzle({ mode: 'eq', tier, settings: { exercise: 'fix' }, seed: `fix-${tier}` });

    assert.ok(puzzle.fault, 'the sample has to be faulty for there to be anything to fix');
    assert.equal(puzzle.answer.length, 1, 'one fault, one cure');
    assert.equal(puzzle.answer[0].frequency, puzzle.fault.frequency, 'cure it where it is');
    assert.equal(puzzle.answer[0].gain, -puzzle.fault.gain, 'the cure is the inverse of the fault');
    assert.equal(puzzle.answer[0].q, puzzle.fault.q, 'and as wide as the fault is');
    assert.ok(puzzle.answer[0].gain < 0, 'a resonance is cut, not boosted');
  }

  const match = makePuzzle({ mode: 'eq', tier: 'easy', settings: { exercise: 'match' }, seed: 'm' });
  assert.equal(match.fault, undefined, 'matching hands you a clean sample');
});

test('the EQ is judged on the curve, so a different route to the same shape counts', () => {
  // One wide cut, against the two narrower ones that add up to it. Nobody who
  // arrived at the same shape should be marked down for how they got there.
  const target = [{ type: 'peaking', frequency: 1000, gain: -6, q: 1, on: true }];
  const sameShape = [
    { type: 'peaking', frequency: 1000, gain: -3, q: 1, on: true },
    { type: 'peaking', frequency: 1000, gain: -3, q: 1, on: true },
  ];

  const score = MODES.eq.score(sameShape, { answer: target, tier: 'easy' });
  assert.ok(score.error < 1, `two halves of a cut should be the cut: ${score.error.toFixed(2)} dB out`);
  assert.ok(score.correct);
});

test('the EQ bar is set where doing nothing fails and a decibel out passes', () => {
  for (const tier of ['easy', 'medium', 'hard']) {
    const puzzle = makePuzzle({ mode: 'eq', tier, settings: { exercise: 'match' }, seed: `bar-${tier}` });
    const score = (bands) => MODES.eq.score(bands, { ...puzzle, tier });

    assert.equal(score(puzzle.answer).error, 0, `${tier}: the target is its own answer`);
    assert.ok(score(puzzle.answer).correct);

    // Leaving the EQ flat must never be a pass - it was, when the error was
    // averaged across the spectrum instead of taken at its worst point.
    assert.ok(!score([]).correct, `${tier}: doing nothing passed`);
    assert.ok(score([]).error > 3, `${tier}: doing nothing scored ${score([]).error.toFixed(1)} dB`);

    // A decibel of gain out is close enough to count; a third of an octave of
    // frequency out is not, because it is audible.
    const shy = puzzle.answer.map((band) => ({ ...band, gain: band.gain - Math.sign(band.gain) }));
    assert.ok(score(shy).correct, `${tier}: a decibel out should still pass`);

    const shifted = puzzle.answer.map((band) => ({ ...band, frequency: band.frequency * 1.26 }));
    assert.ok(!score(shifted).correct, `${tier}: a third-octave out should not pass`);
  }
});

test('the EQ says where the two curves part company, and which way', () => {
  const target = [{ type: 'peaking', frequency: 2000, gain: 8, q: 1.5, on: true }];

  const shy = MODES.eq.score([], { answer: target, tier: 'easy' });
  assert.match(shy.cells[1].text, /too shy$/, 'no boost where one was wanted');
  assert.match(shy.cells[1].text, /kHz|Hz/);

  const hot = MODES.eq.score(
    [{ type: 'peaking', frequency: 2000, gain: 16, q: 1.5, on: true }],
    { answer: target, tier: 'easy' });
  assert.match(hot.cells[1].text, /too hot$/);
  assert.equal(MODES.eq.score(target, { answer: target, tier: 'easy' }).cells[1].text, 'sits on it');
});

test('evening out a loop hands you an uneven loop and no answer to copy', () => {
  for (const seed of ['even', 'even-2', 'even-3']) {
    const puzzle = makePuzzle({ mode: 'compression', tier: 'medium', settings: { exercise: 'fix' }, seed });

    assert.ok(puzzle.uneven >= 9 && puzzle.uneven <= 15, 'the loop has to be uneven to need evening');
    assert.equal(puzzle.answer, null, 'there is no one setting that levels a loop');
  }
});

test('compression: too gentle and too hard are told apart', () => {
  const answer = { threshold: -20, ratio: 8, attack: 10, release: 120 };
  const soft = MODES.compression.score({ ...answer, ratio: 1.5 },
    { answer, tier: 'medium', settings: { exercise: 'match' } });
  assert.equal(soft.cells[0].state, MISS);
  assert.match(soft.cells[1].text, /too gentle$/);

  const hard = MODES.compression.score({ ...answer, threshold: -40, ratio: 20 },
    { answer, tier: 'medium', settings: { exercise: 'match' } });
  assert.match(hard.cells[1].text, /too hard$/);
});

test('panning: the reading says how far off and on which side', () => {
  const puzzle = { settings: { exercise: 'place' }, answer: { pan: 0 } };
  const off = MODES.panning.score({ pan: -0.5 }, { ...puzzle, tier: 'hard' });
  assert.equal(off.cells[0].state, MISS);
  assert.match(off.cells[1].text, /left$/);

  // And a placing that is where it should be reads as one.
  const there = MODES.panning.score({ pan: 0 }, { ...puzzle, tier: 'hard' });
  assert.equal(there.cells[0].state, HIT);
  assert.equal(there.cells[0].text, 'Centre');
});

test('a whole round can be played out in every mode, tier and exercise', () => {
  for (const [id, tier, settings] of ROUNDS) {
    const chosen = settingsFor(id, settings);
    const puzzle = makePuzzle({ mode: id, tier, settings: chosen, seed: `round-${id}-${tier}` });
    let game = createGame(puzzle);

    // Six attempts, which used to be past two of the three tiers' ceilings.
    for (let i = 0; i < 6; i += 1) game = submitGuess(game, wrongGuess(puzzle, i));
    assert.equal(game.status, 'playing', `${id}/${tier} ended on its own`);

    const perfect = answerAsGuess(puzzle);
    if (perfect === null) {
      // An exercise marked on the result has no answer to play back, so what
      // is checked is that it keeps taking attempts rather than closing.
      game = submitGuess(game, wrongGuess(puzzle, 6));
      assert.equal(game.guesses.length, 7, `${id}/${tier} stopped taking attempts`);
      assert.equal(game.status, 'playing', `${id}/${tier} ended on its own`);
      continue;
    }

    game = submitGuess(game, perfect);
    assert.equal(game.status, 'solved', `${id}/${tier} did not accept the answer`);
  }
});
