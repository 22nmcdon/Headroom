// What a mix exercise asks for.
//
// A target mix over the four stems, made from a seed, so a round is a
// function of its seed the way every other round in this app is. The answer
// is a set of fader positions; what you are marked on is the master they
// make, which is not the same thing and is the whole point - two different
// sets of moves that end up sounding the same are the same answer.
//
// Every number is on a grid the controls are also on. A target of +4.37 dB
// on a fader that moves in half-decibels is a round nobody can win, and a
// tolerance wide enough to forgive it is a tolerance wide enough to forgive
// everything.

import { mulberry32 } from '../lib/random.js';
import { toStep } from '../learn/work/scoring.js';
import { STEM_FLAT, STEMS, STEM_IDS, PIECE_IDS } from './piece.js';

/** What a fader, a pan and a send move in. The target sits on these too. */
export const STEPS = { gain: 0.5, pan: 0.05, send: 0.05 };

/** How far a fader goes, in decibels against where the stem arrives. */
export const TRIM = { low: -12, high: 9 };

/**
 * The three tiers, as what gets moved rather than as how hard it is.
 *
 * Difficulty here is not a smaller tolerance over the same exercise: it is
 * more things to hear at once. Levels alone is a different job from levels
 * and placement, and both are a different job from levels, placement and a
 * room. The tolerances tighten as well, because somebody doing the hard one
 * has heard the easy one.
 */
export const MIX_TIERS = {
  easy: {
    label: 'Levels',
    blurb: 'Two parts are in the wrong place. Put them where they belong.',
    moves: 2,
    pans: 0,
    sends: 0,
    gain: [-6, 6],
  },
  medium: {
    label: 'Levels and placement',
    blurb: 'All four levels, and two of them are off to one side.',
    moves: 4,
    pans: 2,
    sends: 0,
    gain: [-7, 7],
    pan: [0.2, 0.55],
  },
  hard: {
    label: 'The whole desk',
    blurb: 'Every level, where things sit, and how much room they are in.',
    moves: 4,
    pans: 3,
    sends: 2,
    gain: [-8, 8],
    pan: [0.15, 0.7],
    send: [0.15, 0.6],
  },
};

export const MIX_TIER_IDS = Object.keys(MIX_TIERS);

/** A stem's gain, from decibels against the flat position. */
export const gainFor = (db) => STEM_FLAT.gain * 10 ** (db / 20);

/** And back, which is what a fader shows. */
export const dbOf = (gain) => 20 * Math.log10(Math.max(gain, 1e-6) / STEM_FLAT.gain);

/** Some of a list, shuffled, so the same two are not always the ones. */
function some(rng, list, count) {
  const ids = [...list];
  for (let i = ids.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids.slice(0, Math.min(count, ids.length));
}

const between = (rng, [low, high]) => low + rng() * (high - low);

/** The smallest level move a round is allowed to ask for. */
export const LEAST = 3;

/**
 * A number somewhere in a range but never near nothing.
 *
 * A "move" of 0.3 dB is not a move: it is inside everybody's tolerance and
 * inside the answer's own, so the round would be asking for something that
 * is already true. Three decibels is the floor, and it is a floor rather
 * than a taste: measured, a stem two decibels out of place reads inside the
 * easy tier's tolerance on four of the five readings, so a round built on
 * smaller moves than that would arrive already solved.
 */
function worthIt(rng, range, least, step) {
  const raw = between(rng, range);
  const away = Math.abs(raw) < least ? Math.sign(raw || 1) * least : raw;
  return toStep(away, step);
}

/**
 * Which stems a round is allowed to move.
 *
 * Not the drums, and not only because a hard-panned kit is a strange mix.
 * Something has to be the thing everything else is set against, and on every
 * desk in the world that is the drums - a round where all four parts float
 * is a round with no reference level in it at all, and what comes back is
 * the right mix at the wrong loudness, every time.
 */
export const ANCHOR = 'kit';
export const MOVABLE = STEM_IDS.filter((id) => id !== ANCHOR);

/**
 * How far each stem is allowed off centre, and into the room.
 *
 * A level is a level and any stem can be at any of them. Where a thing sits
 * is not like that: a bass hard right is a mix nobody has ever made, and a
 * round that asked for one would be teaching an ear to expect something it
 * will never meet again. So the bass gets a quarter of the field and a
 * quarter of the room, and the parts that really do move get all of it.
 */
export const ROOM_FOR = { bass: 0.25, keys: 1, pad: 1, kit: 0 };

/** One round: a piece, and the mix it is supposed to end up as. */
export function mixBrief(tier, seed) {
  const spec = MIX_TIERS[tier] ?? MIX_TIERS.easy;
  const rng = mulberry32(seed);

  const piece = PIECE_IDS[Math.floor(rng() * PIECE_IDS.length)];
  const target = Object.fromEntries(STEM_IDS.map((id) => [id, { ...STEM_FLAT }]));

  for (const id of some(rng, MOVABLE, spec.moves)) {
    target[id].gain = gainFor(worthIt(rng, spec.gain, LEAST, STEPS.gain));
  }

  for (const id of some(rng, MOVABLE, spec.pans)) {
    const side = rng() < 0.5 ? -1 : 1;
    target[id].pan = toStep(side * between(rng, spec.pan) * ROOM_FOR[id], STEPS.pan);
  }

  for (const id of some(rng, MOVABLE, spec.sends)) {
    target[id].send = toStep(between(rng, spec.send) * ROOM_FOR[id], STEPS.send);
  }

  return { tier, piece, target, spec };
}

/** The mix a round starts from: the stems as they arrive, flat and centred. */
export const flatMix = () => Object.fromEntries(STEM_IDS.map((id) => [id, { ...STEM_FLAT }]));

/** What the answer actually moved, for the reveal. */
export const movesIn = (mix) => STEMS
  .map((stem) => ({
    id: stem.id,
    name: stem.name,
    db: toStep(dbOf(mix[stem.id]?.gain ?? STEM_FLAT.gain), 0.1),
    pan: mix[stem.id]?.pan ?? 0,
    send: mix[stem.id]?.send ?? 0,
  }));
