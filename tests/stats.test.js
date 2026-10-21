import test from 'node:test';
import assert from 'node:assert/strict';

// stats.js talks to localStorage; give it a minimal in-memory stand-in.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

const { getStats, recordGame, weakestKind, resetStats, ATTEMPT_BANDS, attemptBand } =
  await import('../src/stats.js');
const { createGame, submitGuess, makePuzzle, showAnswer } = await import('../src/game.js');

// These used to be chord puzzles, because a chord quality is the simplest
// thing a mode can call "one kind of answer". The chords are gone, so they are
// EQ puzzles now: a single corrective band, whose frequency the EQ mode sorts
// into a named trouble zone - mud, boxiness, honk, harshness - which is
// exactly the same job the quality was doing and on a subject this app is
// actually about.
const bandAt = (frequency, gain = 6) => [{ type: 'peaking', frequency, gain, q: 1.4, on: true }];

const MUD = 250;
const HONK = 1600;
const HARSH = 4000;

const puzzleFor = (frequency, seed = 's') => (
  { mode: 'eq', tier: 'easy', settings: { exercise: 'match' }, seed, answer: bandAt(frequency) }
);

/**
 * Guesses a long way from the answer, all of them different.
 *
 * There is no number of these that ends a round any more, so what they are
 * for is getting to the point where somebody gives up and asks - which is the
 * only way a round is now recorded without being solved.
 */
const wrongFor = (frequency, tries = 4) => Array.from(
  { length: tries },
  (_, i) => bandAt(frequency > 1000 ? 50 + i * 4 : 8000 + i * 400, -11),
);

function play(puzzle, guesses, { give = false } = {}) {
  let game = createGame(puzzle);
  for (const guess of guesses) game = submitGuess(game, guess);
  if (give) game = showAnswer(game);
  recordGame(game);
  return game;
}

test.beforeEach(() => resetStats());

test('a solve is counted, and lands in the right attempt band', () => {
  play(puzzleFor(MUD), [bandAt(9000, -9), bandAt(MUD)]);

  const stats = getStats('eq', 'easy');
  assert.equal(stats.played, 1);
  assert.equal(stats.won, 1);
  assert.equal(stats.attempts['2'], 1, 'solved on the second attempt');
});

test('a bucket keeps no streak', () => {
  // A streak is a scarcity mechanic, and with the daily gone there is nothing
  // to break one: you can start another round the moment this one ends, so the
  // number measured how recently you played rather than how well you hear.
  play(puzzleFor(MUD), [bandAt(MUD)]);
  const stats = getStats('eq', 'easy');
  assert.ok(!('streak' in stats), 'no streak');
  assert.ok(!('maxStreak' in stats), 'and no best streak');
});

test('the attempt bands are open-ended, and band at the edges', () => {
  // The whole reason they are bands: there is no ceiling to size an array to
  // any more, and eleven attempts against fourteen is not a signal worth
  // keeping apart. Three against four is.
  assert.equal(attemptBand(1).id, '1');
  assert.equal(attemptBand(3).id, '3');
  assert.equal(attemptBand(4).id, '4-5');
  assert.equal(attemptBand(5).id, '4-5');
  assert.equal(attemptBand(6).id, '6-9');
  assert.equal(attemptBand(9).id, '6-9');
  assert.equal(attemptBand(10).id, '10+');
  assert.equal(attemptBand(400).id, '10+', 'the top band has no top');

  const covered = ATTEMPT_BANDS.flatMap((band) =>
    Array.from({ length: Math.min(band.to, 40) - band.from + 1 }, (_, i) => band.from + i));
  assert.deepEqual(covered, Array.from({ length: 40 }, (_, i) => i + 1),
    'the bands tile the counts with no gap and no overlap');
});

test('asking to be shown counts as played, never as solved', () => {
  play(puzzleFor(MUD), [bandAt(MUD)]);
  play(puzzleFor(HARSH, 's2'), wrongFor(HARSH), { give: true });

  const stats = getStats('eq', 'easy');
  assert.equal(stats.played, 2);
  assert.equal(stats.won, 1, 'being shown is not a solve');

  // And it does not land in an attempt band: it did not take four attempts to
  // get there, it took four attempts and then the answer.
  const banded = Object.values(stats.attempts).reduce((a, b) => a + b, 0);
  assert.equal(banded, 1, 'only the solve is counted among the attempts');
});

test('the weak-spot hint waits for enough data, then names the worst kind of answer', () => {
  assert.equal(weakestKind(getStats('eq', 'easy')), null, 'no hint from one game');

  for (let i = 0; i < 3; i += 1) play(puzzleFor(HARSH, `d${i}`), wrongFor(HARSH), { give: true });
  play(puzzleFor(MUD, 'm1'), [bandAt(MUD)]);

  const weak = weakestKind(getStats('eq', 'easy'));
  assert.equal(weak.key, 'harshness');
  assert.equal(weak.label, 'harshness');
  assert.equal(weak.rate, 0);
});

test('unfinished games are not recorded', () => {
  const puzzle = makePuzzle({ mode: 'eq', tier: 'easy', seed: 'unfinished' });
  recordGame(submitGuess(createGame(puzzle), bandAt(9000, -9)));
  assert.equal(getStats('eq', 'easy').played, 0);
});

test('a bucket is its own per tool and per tier, so they do not pool', () => {
  play(puzzleFor(MUD), [bandAt(MUD)]);
  assert.equal(getStats('eq', 'easy').played, 1);
  assert.equal(getStats('reverb', 'easy').played, 0, 'the reverb has played nothing');
  assert.equal(getStats('eq', 'hard').played, 0, 'nor has the hard tier');
});

test('a round opens fresh, and nothing is kept per puzzle', () => {
  // The daily used to be locked once it had been played, and the restore that
  // enforced it re-scored stored guesses against audio that loads
  // asynchronously - so it could print different text than had been shown.
  const puzzle = puzzleFor(HONK, 'round:eq:easy');
  play(puzzle, [bandAt(60, -9), bandAt(HONK)]);

  const again = createGame(puzzle);
  assert.equal(again.status, 'playing', 'the same puzzle opens fresh');
  assert.equal(again.guesses.length, 0);

  assert.equal(getStats('eq', 'easy').played, 1);
  assert.deepEqual(Object.keys(JSON.parse(localStorage.getItem('headroom.stats.v4')).buckets),
    ['eq:easy:work'], 'one bucket, keyed by tool, tier and kind and nothing else');
});

test('a v2 store is read as nothing rather than merged', () => {
  // Half of a v2 store's buckets were the daily's, and adding those to
  // practice would be adding up two different measurements.
  localStorage.setItem('headroom.stats.v2', JSON.stringify({
    buckets: { 'daily:eq:easy': { played: 9, won: 9 }, 'practice:eq:easy': { played: 4, won: 1 } },
  }));
  assert.equal(getStats('eq', 'easy').played, 0);
});

test('a stored bucket from an older shape is filled in rather than thrown on', () => {
  // What comes back from a browser was written by whatever version of this
  // file the browser last ran. Reading a field added since should give a zero.
  localStorage.setItem('headroom.stats.v4', JSON.stringify({
    buckets: { 'eq:easy:work': { played: 3, won: 2 } },
  }));

  const stats = getStats('eq', 'easy');
  assert.equal(stats.played, 3);
  assert.equal(stats.won, 2);
  assert.deepEqual(stats.attempts, Object.fromEntries(ATTEMPT_BANDS.map((b) => [b.id, 0])));
  assert.deepEqual(stats.byAnswer, {});
});

test('corrupt storage degrades to empty stats instead of throwing', () => {
  localStorage.setItem('headroom.stats.v4', '{not json');
  const stats = getStats('eq', 'easy');
  assert.equal(stats.played, 0);
  assert.deepEqual(stats.attempts, Object.fromEntries(ATTEMPT_BANDS.map((b) => [b.id, 0])));
});

/* --- carrying progress between browsers ---------------------------------- */

const { exportProgress, importProgress, PROGRESS_FORMAT } = await import('../src/stats.js');

test('an export carries every bucket, and says what it is', () => {
  play(puzzleFor(MUD), [bandAt(MUD)]);

  const file = exportProgress(new Date('2026-10-21T09:00:00Z'));
  assert.equal(file.app, 'headroom');
  assert.equal(file.format, PROGRESS_FORMAT);
  assert.equal(file.exported, '2026-10-21T09:00:00.000Z');
  assert.ok(file.id, 'and carries an id, so the same file is not counted twice');
  assert.equal(file.buckets['eq:easy:work'].played, 1);

  // It is a file, so it has to survive being one.
  assert.deepEqual(JSON.parse(JSON.stringify(file)), file);
});

test('importing into an empty browser is a restore', () => {
  play(puzzleFor(MUD), [bandAt(9000, -9), bandAt(MUD)]);
  const file = exportProgress();

  resetStats();
  assert.equal(getStats('eq', 'easy').played, 0);

  const result = importProgress(file);
  assert.equal(result.ok, true);
  assert.equal(result.buckets, 1);

  const stats = getStats('eq', 'easy');
  assert.equal(stats.played, 1);
  assert.equal(stats.won, 1);
  assert.equal(stats.attempts['2'], 1);
  assert.equal(stats.byAnswer.mud.seen, 1);
});

test('importing onto progress adds to it rather than replacing it', () => {
  // The case this is for: the same person on a phone and on a laptop. Neither
  // half is the real one, so neither half is thrown away.
  play(puzzleFor(MUD), [bandAt(MUD)]);
  play(puzzleFor(HARSH, 'h1'), wrongFor(HARSH), { give: true });
  const phone = exportProgress();

  resetStats();
  play(puzzleFor(HONK, 'k1'), [bandAt(9000, -9), bandAt(HONK)]);

  assert.equal(importProgress(phone).ok, true);

  const stats = getStats('eq', 'easy');
  assert.equal(stats.played, 3, 'two from the file and one from here');
  assert.equal(stats.won, 2);
  assert.equal(stats.attempts['1'], 1);
  assert.equal(stats.attempts['2'], 1);
  assert.equal(stats.byAnswer.harshness.seen, 1, 'and the weak spots come across');
  assert.equal(stats.byAnswer.mud.seen, 1);
});

test('the same file imported twice is counted once', () => {
  // Which is what the id on an export is for. Adding rather than replacing is
  // the right default right up until somebody presses import twice, and a
  // doubled count is worse than no import at all: it is wrong and it looks
  // fine.
  play(puzzleFor(MUD), [bandAt(MUD)]);
  const file = exportProgress();

  resetStats();
  assert.equal(importProgress(file).ok, true);
  const second = importProgress(file);
  assert.equal(second.ok, false);
  assert.match(second.reason, /already/i);
  assert.equal(getStats('eq', 'easy').played, 1);
});

test('a file from somewhere else is refused, and says why', () => {
  play(puzzleFor(MUD), [bandAt(MUD)]);

  for (const [what, file] of [
    ['nothing', null],
    ['a string', 'progress'],
    ['another app', { app: 'wordle', format: PROGRESS_FORMAT, buckets: {} }],
    ['a newer format', { app: 'headroom', format: PROGRESS_FORMAT + 1, buckets: {} }],
    ['no buckets', { app: 'headroom', format: PROGRESS_FORMAT }],
  ]) {
    const result = importProgress(file);
    assert.equal(result.ok, false, `${what} was accepted`);
    assert.ok(result.reason, `${what} was refused without saying why`);
  }

  assert.equal(getStats('eq', 'easy').played, 1, 'and nothing here was touched');
});

test('a bucket full of junk cannot corrupt the store', () => {
  // The file came off somebody's disk. Every number in it is read as a count,
  // and anything that is not one is a zero rather than a NaN that spreads.
  const result = importProgress({
    app: 'headroom',
    format: PROGRESS_FORMAT,
    id: 'junk-1',
    buckets: {
      'eq:easy:work': {
        played: 'lots', won: -4, attempts: { '2': 1.7, nonsense: 9 },
        byAnswer: { mud: { seen: NaN, solved: 'two', label: 'mud' } },
      },
      'not a key': { played: 1 },
    },
  });

  assert.equal(result.ok, true);
  const stats = getStats('eq', 'easy');
  assert.equal(stats.played, 0, 'a count that is not a number is nothing');
  assert.equal(stats.won, 0, 'and nor is a negative one');
  assert.equal(stats.attempts['2'], 1, 'a fractional count is floored');
  assert.ok(!('nonsense' in stats.attempts), 'a band this app does not have is dropped');
  assert.equal(stats.byAnswer.mud.seen, 0);
  assert.equal(stats.byAnswer.mud.solved, 0);
});

test('an import never leaves more solved than played', () => {
  // The one invariant the rest of the app reads off these numbers: `solved %`
  // is won/played, and a file claiming nine wins in one game would print 900%.
  const result = importProgress({
    app: 'headroom',
    format: PROGRESS_FORMAT,
    id: 'junk-2',
    buckets: { 'eq:easy:work': { played: 1, won: 9, byAnswer: { mud: { seen: 1, solved: 5 } } } },
  });

  assert.equal(result.ok, true);
  const stats = getStats('eq', 'easy');
  assert.equal(stats.won, 1);
  assert.equal(stats.byAnswer.mud.solved, 1);
});

test('resetting clears what was imported too, so a file can be imported again', () => {
  play(puzzleFor(MUD), [bandAt(MUD)]);
  const file = exportProgress();

  resetStats();
  assert.equal(importProgress(file).ok, true);
  resetStats();
  assert.equal(importProgress(file).ok, true, 'a reset is a reset');
  assert.equal(getStats('eq', 'easy').played, 1);
});

/* --- drills keep their own book ------------------------------------------ */

const drillPuzzleFor = (band, move = 'boost', seed = 'd') => ({
  mode: 'eq',
  tier: 'medium',
  settings: { exercise: 'drill' },
  seed,
  answer: { band, move },
  fault: { type: 'peaking', frequency: 1000, gain: 6, q: 1.41, on: true },
});

test('a drill does not pool with the work on the same tool', () => {
  // Working at a tool and being asked about one are different activities.
  // Pooled, an EQ drill's accuracy would be averaged with the match
  // exercise's and the dialog would report neither.
  play(puzzleFor(MUD), [bandAt(MUD)]);
  play(drillPuzzleFor('1k'), [{ band: '1k', move: 'boost' }]);

  assert.equal(getStats('eq', 'easy', 'work').played, 1);
  assert.equal(getStats('eq', 'medium', 'drill').played, 1);
  assert.equal(getStats('eq', 'medium', 'work').played, 0, 'a tier of its own too');
  assert.equal(getStats('eq', 'easy').played, 1, 'work is what you get if you do not say');
});

test('a drill records what was heard instead, once it is more than a slip', () => {
  // The first guess rather than the last: it is the one made before any
  // reading came back, so it is the only one that says what the ear did on
  // its own.
  for (let i = 0; i < 3; i += 1) {
    play(drillPuzzleFor('2k', 'boost', `c${i}`), [
      { band: '4k', move: 'boost' },
      { band: '2k', move: 'boost' },
    ]);
  }

  const stats = getStats('eq', 'medium', 'drill');
  assert.equal(stats.byAnswer['octave-2k'].seen, 3);
  assert.equal(stats.byAnswer['octave-2k'].confused['octave-4k'].n, 3);
  assert.match(stats.byAnswer['octave-2k'].confused['octave-4k'].label, /4k/);
});

test('getting it right first time is not a confusion', () => {
  play(drillPuzzleFor('2k', 'boost', 'right'), [{ band: '2k', move: 'boost' }]);
  const kind = getStats('eq', 'medium', 'drill').byAnswer['octave-2k'];
  assert.equal(kind.solved, 1);
  assert.equal(kind.confused, undefined);
});

test('the weak spot says what it keeps being heard as', () => {
  // Twice, not once: once is a slip, twice is the thing worth telling
  // somebody.
  play(drillPuzzleFor('2k', 'boost', 'w0'), [{ band: '8k', move: 'boost' }], { give: true });
  assert.equal(weakestKind(getStats('eq', 'medium', 'drill'), 1).confusedWith, null,
    'one wrong answer is a slip');

  for (const seed of ['w1', 'w2']) {
    play(drillPuzzleFor('2k', 'boost', seed), [{ band: '4k', move: 'boost' }], { give: true });
  }
  play(drillPuzzleFor('2k', 'boost', 'w3'), [{ band: '1k', move: 'boost' }], { give: true });

  const weak = weakestKind(getStats('eq', 'medium', 'drill'));
  assert.equal(weak.key, 'octave-2k');
  assert.equal(weak.confusedWith.key, 'octave-4k', 'the commonest of them');
  assert.equal(weak.confusedWith.n, 2);
});

test('a v3 store is carried across, because none of it could have been a drill', () => {
  // Unlike v2, which was half the daily's and could not be. There were no
  // drills when a v3 store was written, so every bucket in one is work.
  resetStats();
  localStorage.removeItem('headroom.stats.v4');
  localStorage.setItem('headroom.stats.v3', JSON.stringify({
    buckets: { 'eq:easy': { played: 7, won: 5 }, 'reverb:hard': { played: 2, won: 0 } },
    imported: ['abc'],
  }));

  assert.equal(getStats('eq', 'easy', 'work').played, 7);
  assert.equal(getStats('reverb', 'hard', 'work').won, 0);
  assert.equal(getStats('reverb', 'hard', 'work').played, 2);
  assert.equal(getStats('eq', 'easy', 'drill').played, 0, 'and nothing lands in the drill book');

  // Written back under the new key, and the old one left alone.
  const now = JSON.parse(localStorage.getItem('headroom.stats.v4'));
  assert.deepEqual(Object.keys(now.buckets).sort(), ['eq:easy:work', 'reverb:hard:work']);
  assert.deepEqual(now.imported, ['abc'], 'and it still knows what it has imported');
  assert.ok(localStorage.getItem('headroom.stats.v3'), 'the old store is left where it is');
});

test('an import carries the confusions across, and refuses a bucket of an unknown kind', () => {
  resetStats();
  const result = importProgress({
    app: 'headroom',
    format: PROGRESS_FORMAT,
    id: 'kinds-1',
    buckets: {
      'eq:medium:drill': {
        played: 4, won: 1,
        byAnswer: { 'octave-2k': { seen: 4, solved: 1, label: '2k (honk)', confused: { 'octave-4k': { n: 3, label: '4k (presence)' } } } },
      },
      'eq:easy:nonsense': { played: 9, won: 9 },
      'eq:easy': { played: 9, won: 9 },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.buckets, 1, 'only the one this app could have written');

  const stats = getStats('eq', 'medium', 'drill');
  assert.equal(stats.byAnswer['octave-2k'].confused['octave-4k'].n, 3);
  assert.equal(getStats('eq', 'easy', 'work').played, 0, 'a two-part key is not a v4 bucket');
});
