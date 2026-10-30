import { TOOLS as MODES, TOOL_IDS as MODE_IDS, toolOf as modeOf } from '../src/learn/bench/registry.js';

/**
 * The answer, as a guess - or nothing, when the round does not have one.
 *
 * A mode with its own interface hands back whatever that interface builds -
 * for the EQ, a set of bands - so the answer is already in that shape and is
 * its own perfect guess.
 *
 * Two of the compressor's exercises are marked on what came out rather than
 * against a stored setting, so there is no answer to hand back: evening out a
 * loop is done when the loop sits still, and there are many compressors that
 * will do it. Those rounds say so by returning null, and the tests that want
 * a winning guess skip them - with their own tests, further down, for the
 * thing those exercises actually promise.
 */
export function answerAsGuess(puzzle) {
  const spec = modeOf(puzzle.mode);

  // Every one of the six is a tool now, and a tool is answered on the tool -
  // which is what having no slots means. There used to be a `surface` flag
  // saying the same thing, back when a mode could be a row of chips instead.
  if (!spec.slots(puzzle.tier, puzzle.settings).length) {
    if (!puzzle.answer) return null;
    if (RESULT_MARKED[puzzle.mode]?.includes(puzzle.settings?.exercise)) return null;
    return puzzle.answer;
  }

  return Object.fromEntries(
    spec.slots(puzzle.tier, puzzle.settings)
      .map((slot) => [slot.id, puzzle.answer[slot.id]]),
  );
}

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/**
 * The exercises that are marked on what came out rather than against a stored
 * setting, and so keep no answer that could be played back.
 *
 * Levelling a loop is done when the loop sits still and there are many
 * compressors that will do it; ducking and fitting a room to a tempo are
 * described by what they achieve. Named here rather than guessed at, because
 * the guess would have to be something like "the answer does not look like a
 * setting", and a reverb asked to answer on a sixteenth has a pre-delay in
 * its answer and looks exactly like one.
 */
const RESULT_MARKED = {
  compression: ['fix', 'duck'],
  reverb: ['tempo'],
  panning: ['mono'],
  saturation: ['even'],
};

/**
 * The nth guess that is not the answer.
 *
 * For a control, far enough outside its own tolerance to be read as a miss,
 * and a different distance each time so no two attempts are the same guess.
 * For chips, every combination in order with the answer taken out - a mode
 * with two slots has more wrong answers than either slot has options, and
 * picking per slot runs out and starts repeating itself, which the game
 * rejects as a guess already tried.
 */
export function wrongGuess(puzzle, nth = 0) {
  const spec = modeOf(puzzle.mode);

  // A tool hands back whatever it is set to, so a wrong guess has to be in
  // that shape. All of these are a long way from any target their work sets.
  if (!spec.slots(puzzle.tier, puzzle.settings).length) {
    if (puzzle.mode === 'compression') {
      // Far lower and far harder than any answer this mode makes, and a
      // different threshold each time so no two attempts are the same guess.
      return { threshold: -55 + nth, ratio: 18, attack: 1, release: 30, sidechain: false };
    }

    if (puzzle.mode === 'panning') {
      // Every band collapsed to mono, which is wrong for a width and wrong
      // for a low end that needs narrowing without the record going with it.
      // The placing has to be answered against the target, because there is
      // no one place in a room that is far from every other place in it.
      const away = (puzzle.answer?.pan ?? 0) > 0 ? -0.9 : 0.9;
      return { pan: away + nth * 0.02 * -Math.sign(away), low: 0.05, mid: 0.05, high: 0.05 };
    }

    if (puzzle.mode === 'delay') {
      // Far longer than any note value at this tempo, and swamped - which is
      // wrong for matching a delay and wrong for finding a time.
      return { time: 1300 + nth * 20, feedback: 0.75, mix: 0.9, tone: 20000, lowCut: 20 };
    }

    if (puzzle.mode === 'reverb') {
      // Longer than any room this mode asks for, answering instantly, and
      // soaked - which is wrong for matching a space and wrong for fitting a
      // tempo, since a seven second tail is never gone by the next beat.
      return { decay: 7 + nth * 0.2, preDelay: 4, mix: 0.9, damping: 1, early: 0 };
    }

    if (puzzle.mode === 'limiter') {
      // The limiter left alone, which is the honest wrong answer and is
      // measured to fail every tier: the targets ask for at least six
      // decibels of reduction and a limiter doing nothing reads 2.5 dB of
      // reduction apart or worse. A different ceiling each time so no two
      // attempts are the same guess, and all of them far too high to reach
      // material that peaks several decibels under it.
      return { drive: 0, ceiling: -1 - nth * 0.1, release: 50, output: 0, peak: 'true' };
    }

    if (puzzle.mode === 'saturation') {
      // Barely touched, and perfectly symmetric. Slamming it was the first
      // version of this and it was not wrong enough: at the top of the drive
      // the series has flattened into a square wave, and the loudest target
      // the "how much" exercise asks for is within a decibel of it. Nearly
      // clean is far from everything - far too little for an amount, nowhere
      // near any colour, and no even harmonics at all.
      return { drive: nth * 0.4, bias: 0, hardness: 5, tone: 9000, mix: 1 };
    }

    // Nothing dialled at all, then a band in the wrong place.
    return nth === 0 ? [] : [{
      type: 'peaking', frequency: 60 * (nth + 1), gain: 12, q: 1 + nth, on: true,
    }];
  }

  const slots = spec.slots(puzzle.tier, puzzle.settings);

  // Both halves, because a drill may ask with both - the reverb's asks how
  // long the tail is on a control and how big the room is with chips. What
  // was here returned the dialled half alone the moment there was one, which
  // left every chip in the guess undefined and handed the scorer a guess with
  // a hole in it.
  const dialled = Object.fromEntries(
    slots.filter((slot) => slot.kind === 'range').map((slot) => {
      const answer = puzzle.answer[slot.id];
      const off = slot.near + 0.5 + nth * 0.25;
      const wrong = slot.unit === 'oct' || slot.unit === 'x'
        ? answer * 2 ** (answer * 2 ** off <= slot.max ? off : -off)
        : answer + (answer + off <= slot.max ? off : -off);
      return [slot.id, clamp(wrong, slot.min, slot.max)];
    }),
  );

  const chips = slots.filter((slot) => slot.kind !== 'range');
  if (!chips.length) return dialled;

  let combinations = [{}];
  for (const slot of chips) {
    combinations = combinations.flatMap((partial) =>
      slot.options.map((option) => ({ ...partial, [slot.id]: option.id })));
  }

  const wrong = combinations.filter((guess) =>
    chips.some((slot) => guess[slot.id] !== puzzle.answer[slot.id]));

  return { ...dialled, ...wrong[nth % wrong.length] };
}

/** Every mode and tier, with every exercise a mode offers. */
export function everyRound() {
  const rounds = [];

  for (const id of MODE_IDS) {
    const exercises = Object.keys(MODES[id].exercises);

    for (const tier of Object.keys(MODES[id].tiers)) {
      for (const which of exercises) {
        rounds.push([id, tier, which ? { exercise: which } : {}]);
      }
    }
  }

  return rounds;
}
