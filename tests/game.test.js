import test from 'node:test';
import assert from 'node:assert/strict';

import { TOOLS as MODES, toolOf as modeOf } from '../src/learn/bench/registry.js';
import {
  scoreGuess, sameGuess, hintFor, hintsLeft, takeHint, showAnswer,
  createGame, submitGuess, makePuzzle, roundSeed, reveal, settingsFor,
} from '../src/learn/game.js';
import { mulberry32, hashSeed } from '../src/lib/random.js';
import { answerAsGuess, wrongGuess, everyRound } from './helpers.js';


/* --- the round, whichever tool is asking --------------------------------- */

test('a correct guess solves it and stops accepting input', () => {
  const puzzle = makePuzzle({ mode: 'eq', tier: 'easy', seed: 'win' });
  let game = createGame(puzzle);

  game = submitGuess(game, wrongGuess(puzzle));
  assert.equal(game.status, 'playing');
  game = submitGuess(game, answerAsGuess(puzzle));
  assert.equal(game.status, 'solved');

  const after = submitGuess(game, wrongGuess(puzzle, 1));
  assert.equal(after.guesses.length, 2, 'no guesses accepted after the round is solved');
});

test('there is no ceiling, and nothing is ever lost', () => {
  // The whole of the change: a tool you can only touch four times is not a
  // tool. Ten attempts is not a special number - it is past every ceiling
  // this app used to have, which is the point.
  for (const [mode, tier] of everyRound().map(([m, t]) => [m, t])) {
    const puzzle = makePuzzle({ mode, tier, seed: `long-${mode}-${tier}` });
    let game = createGame(puzzle);
    assert.equal(game.allowed, undefined, 'a round no longer carries an allowance');

    for (let i = 0; i < 12; i += 1) game = submitGuess(game, wrongGuess(puzzle, i));

    assert.equal(game.guesses.length, 12, `${mode}/${tier} stopped taking attempts`);
    assert.equal(game.status, 'playing', `${mode}/${tier} ended on its own`);
  }
});

test('submitting without moving anything is refused; going back to an earlier setting is not', () => {
  const puzzle = makePuzzle({ mode: 'compression', tier: 'medium', seed: 'repeat' });
  const first = wrongGuess(puzzle);
  const second = wrongGuess(puzzle, 1);

  let game = submitGuess(createGame(puzzle), first);
  const again = submitGuess(game, { ...first });
  assert.equal(again.guesses.length, 1, 'pressing submit twice is not an attempt');
  assert.match(again.error, /nothing has moved/i);

  // But going back to something you tried three attempts ago, to hear it
  // again against what you have since learnt, is ordinary work at a desk.
  game = submitGuess(game, second);
  game = submitGuess(game, wrongGuess(puzzle, 2));
  game = submitGuess(game, { ...first });
  assert.equal(game.guesses.length, 4, 'an earlier setting may be returned to');
});

test('the EQ\'s array-shaped guess is compared by shape, not by reference', () => {
  // The case the old check silently never caught. An EQ guess is a list of
  // band objects, and comparing them with === compared references: two
  // identical strips were always "different", and the guard did nothing at
  // all for the one tool most likely to be nudged back and forth.
  const bands = [{ type: 'peaking', frequency: 800, gain: 4, q: 1.2, on: true }];
  const copy = bands.map((band) => ({ ...band }));

  assert.ok(sameGuess(bands, copy), 'two identical strips are the same setting');
  assert.ok(!sameGuess(bands, [{ ...bands[0], gain: 4.5 }]), 'half a decibel is a new attempt');
  assert.ok(!sameGuess(bands, []), 'a strip and an empty one are not the same');

  // And it is symmetric, which the old one was not: it walked only one side's
  // keys, so a guess missing half of them matched anything.
  assert.ok(!sameGuess({ a: 1, b: 2 }, { a: 1 }));
  assert.ok(!sameGuess({ a: 1 }, { a: 1, b: 2 }));

  const puzzle = makePuzzle({ mode: 'eq', tier: 'medium', seed: 'eq-repeat' });
  const guess = wrongGuess(puzzle, 1);
  const game = submitGuess(createGame(puzzle), guess);
  const repeat = submitGuess(game, guess.map((band) => ({ ...band })));
  assert.equal(repeat.guesses.length, 1, 'an unchanged strip is refused');
});

test('two guesses differing in one control are two different guesses', () => {
  const puzzle = makePuzzle({ mode: 'compression', tier: 'medium', seed: 'slots' });
  const first = wrongGuess(puzzle);
  const second = { ...first, ratio: first.ratio * 1.2 };

  let game = submitGuess(createGame(puzzle), first);
  game = submitGuess(game, second);
  assert.equal(game.guesses.length, 2, 'a hair of movement on one control is a new attempt');
});

/* --- the way out --------------------------------------------------------- */

test('every tool has a hint ladder, and every rung says something', () => {
  for (const [id, tier, settings] of everyRound()) {
    const chosen = settingsFor(id, settings);
    const puzzle = makePuzzle({ mode: id, tier, settings: chosen, seed: `hint-${id}-${tier}` });
    const ladder = modeOf(id).hints(puzzle);
    const where = `${id}/${tier}/${chosen.exercise ?? '-'}`;

    assert.ok(Array.isArray(ladder) && ladder.length >= 2, `${where} has no ladder`);
    for (const rung of ladder) {
      assert.equal(typeof rung, 'string', `${where} has a rung that is not a line`);
      assert.ok(rung.trim().length > 20, `${where} has a rung that says nothing: "${rung}"`);
      assert.ok(!/undefined|NaN|\[object/.test(rung), `${where} has a broken rung: "${rung}"`);
    }
  }
});

test('the ladder is walked one rung at a time, and stops at the top', () => {
  const puzzle = makePuzzle({ mode: 'eq', tier: 'easy', seed: 'ladder' });
  let game = createGame(puzzle);
  const rungs = modeOf('eq').hints(puzzle);

  assert.equal(hintsLeft(game), rungs.length);
  for (const rung of rungs) {
    assert.equal(hintFor(game), rung);
    game = takeHint(game);
  }

  assert.equal(hintFor(game), null, 'the top of the ladder is the top');
  assert.equal(hintsLeft(game), 0);
});

test('being shown the answer is played, never solved, and does not stop the round', () => {
  const puzzle = makePuzzle({ mode: 'eq', tier: 'easy', seed: 'shown' });
  let game = submitGuess(createGame(puzzle), wrongGuess(puzzle));

  game = showAnswer(game);
  assert.equal(game.status, 'shown');

  // The controls stay live, so attempts keep landing - and arriving after
  // being shown is still not arriving.
  game = submitGuess(game, answerAsGuess(puzzle));
  assert.equal(game.guesses.length, 2, 'a shown round keeps taking attempts');
  assert.ok(game.guesses[1].score.correct, 'and still reads them honestly');
  assert.equal(game.status, 'shown', 'but it was shown, and stays shown');

  // And it cannot be un-shown by solving first.
  let solved = submitGuess(createGame(puzzle), answerAsGuess(puzzle));
  assert.equal(solved.status, 'solved');
  assert.equal(showAnswer(solved).status, 'solved');
});

/* --- the working --------------------------------------------------------- */

test('every reading that shows its working shows all of it', () => {
  for (const [id, tier, settings] of everyRound()) {
    const chosen = settingsFor(id, settings);
    const puzzle = makePuzzle({ mode: id, tier, settings: chosen, seed: `why-${id}-${tier}` });
    const score = scoreGuess(wrongGuess(puzzle), puzzle);
    const where = `${id}/${tier}/${chosen.exercise ?? '-'}`;

    assert.ok(Array.isArray(score.why) && score.why.length >= 2, `${where} shows no working`);
    for (const row of score.why) {
      assert.ok(row.label?.trim(), `${where} has a row with no label`);
      assert.ok(row.value?.trim(), `${where} / ${row.label} has no value`);
      // `how` is the measured justification, not a restatement of the label.
      assert.ok(row.how?.trim().split(/\s+/).length >= 12,
        `${where} / ${row.label} does not say how it was arrived at`);
      assert.ok(!/undefined|NaN|\[object/.test(`${row.value} ${row.how}`),
        `${where} / ${row.label} reads "${row.value}"`);
    }
  }
});

test('scoring goes through the mode that asked the question', () => {
  const puzzle = makePuzzle({ mode: 'reverb', tier: 'easy', seed: 'route' });
  const score = scoreGuess(answerAsGuess(puzzle), puzzle);
  assert.ok(score.correct);
  assert.equal(score.cells.length,
    MODES.reverb.score(answerAsGuess(puzzle), { ...puzzle, tier: 'easy' }).cells.length);
});

test('a mode\'s settings fill themselves in, and refuse what it does not offer', () => {
  assert.deepEqual(settingsFor('eq', {}), { exercise: 'match' });
  assert.deepEqual(settingsFor('eq', { exercise: 'fix' }), { exercise: 'fix' });
  assert.deepEqual(settingsFor('eq', { exercise: 'nonsense' }), { exercise: 'match' });
  assert.deepEqual(settingsFor('compression', {}), { exercise: 'match' });
  assert.deepEqual(settingsFor('saturation', {}), { exercise: 'amount' });
});

/* --- seeds --------------------------------------------------------------- */

test('a round is a different puzzle every time you ask for one', () => {
  // There was a `dailySeed` here, and a test that it was stable per UTC day.
  // Both went with the daily: a seed pinned to the date is only worth having
  // when the point is that everybody gets the same one.
  const seeds = new Set();
  for (let i = 0; i < 50; i += 1) seeds.add(roundSeed('eq', 'easy', i));
  assert.equal(seeds.size, 50);
});

test('the same salt is the same round, so coming back finds what you left', () => {
  // What the salt is for: `startGame()` passes the tier and `startGame({fresh})`
  // passes a random number, which is the difference between switching exercise
  // and back, and pressing "another one".
  const same = (salt) => makePuzzle({
    mode: 'eq', tier: 'easy', settings: { exercise: 'match' },
    seed: `round:eq:easy:${salt}`,
  }).answer;

  assert.deepEqual(same('easy'), same('easy'));
  assert.notDeepEqual(same('easy'), same('0.418'));
});

test('a seed carries the exercise, because an exercise is its own puzzle', () => {
  // Matching a target and curing a fault are not two views of one puzzle, so
  // the settings go into `makePuzzle` rather than only into the sound.
  const made = (exercise) => makePuzzle({
    mode: 'eq', tier: 'easy', settings: { exercise }, seed: 'round:eq:easy:7',
  });
  assert.notDeepEqual(made('match').settings, made('fix').settings);
});

test('a tier is its own puzzle', () => {
  const made = (tier) => makePuzzle({
    mode: 'eq', tier, settings: { exercise: 'match' }, seed: 'round:eq:x:7',
  }).answer;
  assert.notDeepEqual(made('easy'), made('medium'));
});

test('the seeded PRNG is deterministic and stays in range', () => {
  const a = mulberry32(hashSeed('abc'));
  const b = mulberry32(hashSeed('abc'));
  for (let i = 0; i < 50; i += 1) {
    const value = a();
    assert.equal(value, b());
    assert.ok(value >= 0 && value < 1);
  }
});

test('puzzles spread across everything a tier offers', () => {
  for (const [mode, spec] of Object.entries(MODES)) {
    for (const tier of Object.keys(spec.tiers)) {
      const rounds = 500;
      const seen = new Map();
      for (let i = 0; i < rounds; i += 1) {
        const { answer } = makePuzzle({ mode, tier, seed: `spread-${mode}-${tier}-${i}` });
        for (const slot of spec.slots(tier)) {
          if (!seen.has(slot.id)) seen.set(slot.id, new Map());
          const counts = seen.get(slot.id);
          counts.set(answer[slot.id], (counts.get(answer[slot.id]) ?? 0) + 1);
        }
      }

      for (const slot of spec.slots(tier)) {
        const counts = seen.get(slot.id);

        if (slot.kind === 'range') {
          // A control is not a list to get through, and some exercises use a
          // narrow part of it on purpose - a corrective cut lives where the
          // fault lives. What has to be true is that it moves, and that no one
          // answer comes up so often that the daily is the same every day.
          assert.ok(counts.size > 1, `${mode}/${tier}/${slot.id} never moves`);
          assert.ok(Math.max(...counts.values()) < rounds * 0.6,
            `${mode}/${tier}/${slot.id} keeps landing on the same value`);
          continue;
        }

        assert.equal(counts.size, slot.options.length,
          `${mode}/${tier}/${slot.id} never offers some of its answers`);
      }
    }
  }
});
