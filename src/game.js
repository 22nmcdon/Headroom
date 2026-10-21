import { toolOf } from './bench/registry.js';
import { mulberry32, hashSeed } from './random.js';

export { HIT, NEAR, MISS } from './work/scoring.js';

/**
 * Read a guess against the answer, through the mode that asked the question.
 *
 * The whole puzzle goes along with the answer, because a mode may need more
 * than the answer to read a guess: a compressor is not a curve you can work
 * out on paper, so that mode marks by running both settings over the same
 * audio, and the audio is on the puzzle.
 */
export function scoreGuess(guess, puzzle) {
  // Two arguments where there were four. The answer and the tier both live on
  // the puzzle already, and every scorer had grown a defensive
  // `puzzle?.settings?.exercise ?? '…'` to find the third thing it needed -
  // so three of the four were being passed twice, and the fourth was the one
  // that mattered.
  return toolOf(puzzle.mode).score(guess, puzzle);
}

/** Whatever the mode's settings are set to, filled in from their defaults. */
export function settingsFor(mode, chosen = {}) {
  return Object.fromEntries(
    (toolOf(mode).settings ?? []).map((setting) => [
      setting.id,
      setting.options.some((option) => option.id === chosen[setting.id])
        ? chosen[setting.id]
        : setting.options[0].id,
    ]),
  );
}

/**
 * Pick a puzzle deterministically from a seed string.
 *
 * The settings go in, because some of them change the answer rather than only
 * the sound of it: an EQ exercise that hands you a fault to cure is a
 * different puzzle from one that hands you a target to match.
 */
export function makePuzzle({ mode = 'eq', tier = 'easy', settings = {}, seed }) {
  const rng = mulberry32(hashSeed(seed));
  const chosen = settingsFor(mode, settings);

  return { mode, tier, settings: chosen, seed, ...toolOf(mode).makePuzzle(rng, tier, chosen) };
}

/**
 * A seed for one round, different every time.
 *
 * There was a `dailySeed` beside this: one puzzle per mode per tier per
 * exercise per day, the same one for everybody. It went with the guess ceiling
 * and the share grid. A daily is a thing you can run out of and then compare -
 * and with no ceiling there was nothing to run out of, with no grid nothing to
 * compare, and what was left was a pill that pinned you to one puzzle until
 * midnight. A daily drill is worth having and will come back on the drills,
 * where "today's one question, same for everyone" is a shape that fits; it is
 * not this.
 */
export function roundSeed(mode, tier, salt = Math.random()) {
  return `round:${mode}:${tier}:${salt}:${Date.now()}`;
}

/**
 * Fresh state around a puzzle.
 *
 * There is no guess ceiling, and so no `lost`. A tool you can only touch four
 * times is not a tool - the whole of the value is in moving something, hearing
 * what it did to the reading, and moving it again. What used to end the round
 * was running out; what ends it now is getting there, and the way out when you
 * cannot is to ask for it.
 */
export function createGame(puzzle) {
  return {
    puzzle,
    guesses: [],
    hinted: 0, // how far up the hint ladder this round has walked
    status: 'playing', // 'playing' | 'solved' | 'shown'
  };
}

/**
 * Two settings are the same setting, compared by shape rather than by slot.
 *
 * What was here before walked the keys of one side and compared with `===`,
 * which for the EQ - whose guess is an array of band objects - compared object
 * references and so never once caught a repeat. It was also asymmetric: a
 * guess missing half its keys matched anything.
 *
 * And it is now only asked about the attempt immediately before. Going back to
 * a setting you tried earlier to hear it again against what you have since
 * learnt is ordinary work at a desk; refusing it would be Wordle's rule
 * applied where it does not belong. What is still worth catching is pressing
 * submit twice without having moved anything.
 */
export function sameGuess(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;

  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => sameGuess(a[key], b[key]));
}

/**
 * What the controls start on, before anything has been dialled.
 *
 * The settings go in because the slots depend on them: only a drill asks with
 * controls at all, and which controls it asks with is the exercise's to say.
 */
export function startingGuess(mode, tier, settings = {}) {
  return Object.fromEntries(
    toolOf(mode).slots(tier, settings).filter((slot) => slot.kind === 'range')
      .map((slot) => [slot.id, slot.start]),
  );
}

/** Apply a guess; returns a new state (the caller owns rendering). */
export function submitGuess(game, guess) {
  if (game.status === 'solved') return game;

  const last = game.guesses[game.guesses.length - 1];
  if (last && sameGuess(last.guess, guess)) {
    return { ...game, error: 'Nothing has moved since the last one.' };
  }

  const score = scoreGuess(guess, game.puzzle);
  const guesses = [...game.guesses, { guess, score }];

  // Being shown the answer is sticky. You can keep working - that is the
  // point of leaving the controls live - but arriving afterwards is not the
  // same thing as arriving, and the record should not pretend it was.
  const status = score.correct && game.status === 'playing' ? 'solved' : game.status;

  return { ...game, guesses, status, error: null };
}

/**
 * The next rung of the hint ladder, or null at the top of it.
 *
 * Short, ordered, and worked out from the answer rather than from what you
 * have tried: the first says what kind of move it is, the second says roughly
 * where. Anything more specific than that is the reveal, which is its own
 * button and says so.
 */
const ladderFor = (game) => toolOf(game.puzzle.mode).hints?.(game.puzzle) ?? [];

export function hintFor(game) {
  return ladderFor(game)[game.hinted] ?? null;
}

export const hintsLeft = (game) => Math.max(0, ladderFor(game).length - game.hinted);

export const takeHint = (game) => ({ ...game, hinted: game.hinted + 1, error: null });

/** Ask for the answer. The round stops counting; the controls do not stop. */
export function showAnswer(game) {
  if (game.status !== 'playing') return game;
  return { ...game, status: 'shown', error: null };
}

/** What the answer was, for the reveal line. */
export function reveal(puzzle) {
  return toolOf(puzzle.mode).reveal(puzzle);
}
