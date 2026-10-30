// What is on this part, and in what order.
//
// A chain is in series, so its order is audible, and that is not a figure of
// speech: a compressor and a saturator do not commute, because both of them
// are nonlinear. The compressor decides what to do from how loud the signal
// is, and the saturator changes how loud it is; put the saturator first and
// the compressor is reacting to a signal whose peaks have already been
// rounded off, so it hardly works. Put it second and it is shaping whatever
// the compressor has already levelled, so everything gets the same amount of
// colour whether it was loud or quiet.
//
// Measured on the kit, four arrangements of the same two effects, each
// level-matched to the plain part first, as the gap between each pair:
//
//     pair                       crest, both pieces    balance, both pieces
//     compressor / saturator        12.45 and 8.18        9.53 and 9.53
//     compressor / comp then sat     7.85 and 4.03       10.08 and 12.69
//     compressor / sat then comp     6.74 and 3.46        6.84 and 11.57
//     saturator / comp then sat      4.59 and 4.16        6.49 and 6.20
//     saturator / sat then comp      5.71 and 4.73        6.16 and 5.78
//     comp then sat / sat then comp  1.12 and 0.57        4.14 and 4.63
//
// Every pair is further apart than any tolerance in this app. The two that
// are closest are the two orders of the same pair, which is what you would
// expect, and even those are half a decibel to a decibel apart on dynamics
// and four and a half on tone. They are different arrangements, not four
// names for one sound.
//
// ## Why this round is answered by naming it
//
// Every other round here is answered by matching: set the desk, submit, and
// be marked on what came out. An order cannot be asked that way. There are
// four arrangements, so a round that let you submit against it would be a
// round you could finish by pressing submit four times - and a round somebody
// can brute-force in four goes is a round that teaches nothing, which is the
// one thing this app is for.
//
// So it is asked the way the drills ask: hear it, name it, once. The desk is
// not even shown, because there is nothing on it that would help.
//
// ## Why the levels are baked in
//
// Saturation makes things louder and compression makes them quieter, so the
// four arrangements come out at four different levels - measured, 19.6 dB
// apart at their worst with the plugins left at their defaults. A round where
// the loudest answer is the one with the saturator in it is a round answered
// by loudness, which is the cue this whole app is most careful about.
//
// So each arrangement is gain-staged, exactly as an engineer gain-stages a
// chain: the compressor's makeup and the saturator's trim are set per
// arrangement so that all four come back at the level of the plain part. The
// numbers are measured, they are in `CHAIN_ORDERS` beside each arrangement,
// and `tests/browser/arrange.mjs` re-measures the spread every run.

import { COMP_DEFAULTS } from '../plugins/compressor/dsp.js';
import { HEAT_DEFAULTS } from '../plugins/saturation/shape.js';
import { STEM_IDS } from './piece.js';

/**
 * Which part carries the chain.
 *
 * The drums, and that is measured. The four arrangements have to be told
 * apart, and on each part in turn, level-matched, the closest pair of the six
 * reads:
 *
 *     part     closest crest        closest balance
 *     kit      1.52 and 1.36        2.40 and 3.90
 *     bass     0.40 and 0.38        0.44 and 2.30
 *     keys     0.33 and 0.16        4.18 and 4.56
 *     pad      0.02 and 0.25        3.49 and 3.39
 *
 * The kit is the only one where the closest pair is clear on both readings at
 * once, on both pieces. Which is also what anybody would expect: a kit is
 * nothing but transients, and a compressor is a machine for transients.
 *
 * It being the reference everywhere else does not clash. Nothing here is
 * marked on levels - nothing here is marked on a reading at all.
 */
export const CHAIN_ON = 'kit';

/** The compressor, worked hard enough to hear. */
const COMP = {
  ...COMP_DEFAULTS, threshold: -30, ratio: 8, attack: 5, release: 120, knee: 4,
};

/** The saturator, likewise: enough drive to colour, not enough to destroy. */
const HEAT = {
  ...HEAT_DEFAULTS, mode: 'soft', drive: 14, bias: 0.4, mix: 1,
};

/**
 * The four arrangements, with the gain staging that makes them comparable.
 *
 * `makeup` and `trim` are per arrangement and are measured. With the
 * compressor at +9 of makeup and the saturator at -13 of trim, the four came
 * out, against the plain part:
 *
 *     arrangement          short-night    late-room
 *     the compressor              +1.4         -1.9
 *     the saturator               -1.0         -1.4
 *     compressor, saturator       -5.6         -6.5
 *     saturator, compressor       -3.3         -4.3
 *
 * The numbers below are each row's own correction, taken as the mean of the
 * two pieces. With them the same measurement reads:
 *
 *     the compressor              +1.66        -1.60
 *     the saturator               +0.22        -0.19
 *     compressor, saturator       +0.41        -0.48
 *     saturator, compressor       +0.50        -0.54
 *
 * - a spread between arrangements of 1.44 dB and 1.42, down from 19.61 and
 * 22.40 with both plugins left alone. What is left is what one trim cannot
 * fix: the two pieces are different music, and a compressor is not a gain.
 */
export const CHAIN_ORDERS = [
  {
    id: 'comp',
    symbol: 'Compressor',
    name: 'and nothing else',
    inserts: ['compression'],
    settings: { compression: { ...COMP, makeup: 9.25 }, saturation: { ...HEAT } },
  },
  {
    id: 'heat',
    symbol: 'Saturator',
    name: 'and nothing else',
    inserts: ['saturation'],
    settings: { compression: { ...COMP }, saturation: { ...HEAT, trim: -11.8 } },
  },
  {
    id: 'comp-heat',
    symbol: 'Comp → Sat',
    name: 'levelled, then coloured',
    inserts: ['compression', 'saturation'],
    settings: { compression: { ...COMP, makeup: 9 }, saturation: { ...HEAT, trim: -6.95 } },
  },
  {
    id: 'heat-comp',
    symbol: 'Sat → Comp',
    name: 'coloured, then levelled',
    inserts: ['saturation', 'compression'],
    settings: { compression: { ...COMP, makeup: 12.8 }, saturation: { ...HEAT, trim: -13 } },
  },
];

export const CHAIN_IDS = CHAIN_ORDERS.map((one) => one.id);

/** One arrangement, by id. */
export const arrangementOf = (id) => CHAIN_ORDERS.find((one) => one.id === id) ?? CHAIN_ORDERS[0];

/**
 * A mix with one arrangement on the part that carries it.
 *
 * Both effects' settings go on whichever arrangement it is, including the one
 * that is not in the chain. An insert that is not in the list is not built, so
 * what the settings say about it does not matter - and carrying both means the
 * project stamp in `render.js` changes when the order changes, which it would
 * not if the settings were pruned to match.
 */
export function chainMix(mix, id) {
  const how = arrangementOf(id);
  return Object.fromEntries(STEM_IDS.map((stem) => [stem, stem === CHAIN_ON
    ? { ...mix[stem], inserts: [...how.inserts], settings: how.settings }
    : { ...mix[stem] }]));
}

/** The chips a naming round offers, in the order they are shown. */
export const chainChoices = () => CHAIN_ORDERS.map(({ id, symbol, name }) => ({ id, symbol, name }));
