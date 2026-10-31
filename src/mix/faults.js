// What somebody did to this mix before you got to it.
//
// Every other round here starts from flat and asks you to build something.
// This one starts from a mix that was right and has had one to three things
// done to it, and asks two questions in order: what is wrong, and then put it
// back. Which is the job, rather than an exercise about the job - nobody is
// ever handed four flat faders and told to make a record; they are handed
// something that nearly works and asked why it does not.
//
// ## Why the mix underneath is not flat
//
// Because a round whose answer is flat is a round you win by zeroing
// everything. The mix under the faults is a whole mix - levels, places,
// room - so the only way to the answer is to hear what moved, which is what
// the A/B is for.
//
// ## Which faults are in the library
//
// One per control the desk has, and no two of a kind in a round. A fault
// that cannot be undone with the controls in front of you is not a fault, it
// is a trap: the kit's fader does not move, so nothing in here moves it, and
// the tone controls only reach the band each part lives in, so nothing in
// here colours a part anywhere else.

import { STEPS, ROOM_FOR, TONE_BANDS, gainFor, dbOf } from './desk.js';
import { toStep } from '../learn/work/scoring.js';

/**
 * The four things that get done to a mix, with what each one costs.
 *
 * `hurts` is the reading that moves furthest when the fault is in, and it is
 * measured rather than reasoned about - the table is in `tests/browser/fix.mjs`
 * and is printed every run. It is not a claim that nothing else moves: a part
 * that is too loud is also a part whose share of every register is too big,
 * and both of those readings fire. What it is for is the advice, which names
 * the one that moved most.
 *
 * `size` is how far the fault goes, and every one of them is set so that the
 * reading it hurts lands well outside the tolerance while the controls can
 * still put it back in one move.
 */
export const MIX_FAULTS = [
  {
    id: 'hot',
    symbol: 'Too loud',
    name: 'one part over the rest',
    // `share` and not `levels`, which the capstone leaves out as a duplicate
    // - a broadband move shifts all three of a part's registers equally, so
    // the two read the same number. Measured, four to six decibels on one
    // part reads 3.00 on share against a tolerance of 0.5.
    hurts: 'share',
    size: [4, 6],
    /** Needs a part whose fader moves, which is anything but the anchor. */
    can: (id, set) => dbOf(set.gain) < 4,
    apply: (set, amount) => ({ ...set, gain: gainFor(toStep(dbOf(set.gain) + amount, STEPS.gain)) }),
  },
  {
    id: 'side',
    symbol: 'Off centre',
    name: 'one part pushed to one side',
    hurts: 'placement',
    size: [0.35, 0.6],
    // Only on a part with the whole field to move in, which was a
    // measurement rather than a nicety: the bass gets a quarter of the field,
    // so the same fault on it is a pan move of 0.09 to 0.15 and reads 0.41 on
    // placement against a tolerance of 0.6. A fault nobody can mark is not a
    // fault, and one nobody can hear is worse.
    can: (id) => ROOM_FOR[id] === 1,
    apply: (set, amount, id) => ({
      ...set,
      // Away from wherever it already is, so a part that was already out to
      // one side goes further out rather than through the middle - a fault
      // that moved something back to the centre would be a fault nobody could
      // name as "off centre".
      pan: toStep(Math.max(-1, Math.min(1,
        set.pan + (set.pan >= 0 ? amount : -amount) * ROOM_FOR[id])), STEPS.pan),
    }),
  },
  {
    id: 'wet',
    symbol: 'Too much room',
    name: 'one part sent too far back',
    hurts: 'room',
    size: [0.3, 0.5],
    can: (id, set) => ROOM_FOR[id] === 1 && set.send < 0.5,
    apply: (set, amount, id) => ({
      ...set,
      send: toStep(Math.min(1, set.send + amount * ROOM_FOR[id]), STEPS.send),
    }),
  },
  {
    id: 'colour',
    symbol: 'Wrong colour',
    name: 'one part boosted in its own band',
    hurts: 'share',
    size: [5, 8],
    can: (id) => id in TONE_BANDS,
    apply: (set, amount, id) => ({
      ...set,
      inserts: ['eq'],
      settings: {
        ...set.settings,
        eq: { ...set.settings.eq, [TONE_BANDS[id]]: toStep(amount, STEPS.tone) },
      },
    }),
  },
];

export const MIX_FAULT_IDS = MIX_FAULTS.map((one) => one.id);

/** One fault, by id. */
export const mixFaultOf = (id) => MIX_FAULTS.find((one) => one.id === id) ?? MIX_FAULTS[0];

/** The chips a round offers, which are the four kinds and not the parts. */
export const faultChoices = () => MIX_FAULTS.map(({ id, symbol, name }) => ({ id, symbol, name }));

/**
 * How many things are wrong, which is between one and three and is not said.
 *
 * Three is the ceiling and it is not arbitrary: with four kinds in the
 * library, a round with four faults in it has one answer and naming it is
 * not a question. Three leaves something to be wrong about.
 *
 * One is the floor for the opposite reason. A round that always had the same
 * number of things wrong with it would be a round you could count rather than
 * hear - find two and stop looking - and the number not being said is half of
 * what makes the naming half a question at all.
 */
export const HOW_MANY = { least: 1, most: 3 };

/** How many this round has, which the round does not say. */
export const howManyIn = (rng) =>
  HOW_MANY.least + Math.floor(rng() * (HOW_MANY.most - HOW_MANY.least + 1));

/**
 * A mix with things done to it, and the list of what they were.
 *
 * Never two of a kind, and never two on one part. Two faults of one kind
 * cannot both be named, because the chips are kinds; two on one part would
 * hide each other, which is a fair thing for a mix to do and an unfair thing
 * for a round that asks you to name them.
 */
export function injure(mix, ids, rng, stems) {
  const hurt = Object.fromEntries(Object.entries(mix).map(([id, set]) => [id, { ...set }]));
  const done = [];
  const used = new Set();

  for (const id of ids) {
    const fault = mixFaultOf(id);
    const open = stems.filter((stem) => !used.has(stem) && fault.can(stem, hurt[stem]));
    if (!open.length) continue;

    const on = open[Math.floor(rng() * open.length)];
    const [low, high] = fault.size;
    const amount = low + rng() * (high - low);
    const side = fault.id === 'colour' && rng() < 0.4 ? -1 : 1;

    hurt[on] = fault.apply(hurt[on], amount * side, on);
    used.add(on);
    done.push({ fault: fault.id, on });
  }

  return { mix: hurt, done };
}
