// The desk itself: what its controls move in, how far they go, and where
// each part is allowed to be.
//
// Split out of `brief.js`, which is what a round ASKS FOR, when `faults.js`
// turned up needing the same facts and the two ended up importing each other
// in a circle. The line between them is worth keeping: this file is true of
// the desk whether or not anybody is being asked anything, and nothing in it
// mentions a tier, a seed or an answer.

import { STEM_IDS, STEM_FLAT } from './piece.js';

/** What a fader, a pan, a send and a tone control move in. Targets sit on these too. */
export const STEPS = { gain: 0.5, pan: 0.05, send: 0.05, tone: 0.5 };


/** How far a fader goes, in decibels against where the stem arrives. */
export const TRIM = { low: -12, high: 9 };


/** A stem's gain, from decibels against the flat position. */
export const gainFor = (db) => STEM_FLAT.gain * 10 ** (db / 20);

/** And back, which is what a fader shows. */
export const dbOf = (gain) => 20 * Math.log10(Math.max(gain, 1e-6) / STEM_FLAT.gain);


/**
 * Which band each stem is moved in, and why it is only one.
 *
 * An EQ insert is markable where a compressor insert is not, and this is the
 * table that says where. Measured on both pieces, a single band moved on one
 * stem, read as the gap it opens on the master's `balance` reading against
 * the same mix flat:
 *
 *     piece         stem    band     +2     +3     +4     +5     +6
 *     short-night   bass    low    1.14   1.67   2.17   2.64   3.07
 *     short-night   bass    mid    0.29   0.46   0.65   0.86   1.09
 *     short-night   bass    high   0.29   0.47   0.67   0.91   1.17
 *     short-night   keys    low    0.38   0.61   0.87   1.16   1.48
 *     short-night   keys    mid    0.75   1.13   1.51   1.88   2.24
 *     short-night   keys    high   0.30   0.49   0.70   0.94   1.21
 *     short-night   pad     low    0.35   0.56   0.80   1.06   1.36
 *     short-night   pad     mid    1.38   2.06   2.74   3.40   4.05
 *     short-night   pad     high   0.28   0.45   0.64   0.86   1.10
 *     late-room     bass    low    0.50   0.76   1.03   1.29   1.54
 *     late-room     bass    mid    0.14   0.22   0.30   0.40   0.51
 *     late-room     bass    high   0.15   0.24   0.35   0.46   0.59
 *     late-room     keys    low    0.27   0.44   0.63   0.84   1.08
 *     late-room     keys    mid    0.36   0.57   0.81   1.06   1.33
 *     late-room     keys    high   0.21   0.34   0.48   0.64   0.82
 *     late-room     pad     low    0.35   0.57   0.81   1.08   1.39
 *     late-room     pad     mid    1.13   1.68   2.20   2.70   3.17
 *     late-room     pad     high   0.29   0.46   0.66   0.89   1.14
 *
 * Every row rises with the move, which is the first thing a control has to
 * do and the thing a compressor insert could not: measured the same way, a
 * loudness-matched compressor's effect on the master's `crest` reading was
 * not monotonic in its own threshold, and sixteen decibels of reduction on
 * the bass moved it 0.49 dB against a tolerance of 0.45.
 *
 * What the table decides is the band. A high-shelf move never reaches 1.21 on
 * any stem of either piece, and a low-shelf move only does on the bass -
 * because that is where the energy is, and a band with nothing in it cannot
 * be heard to change. So each stem is moved in the one band it lives in, and
 * the round is never asked to hear something that is not there.
 */
export const TONE_BANDS = { bass: 'low', keys: 'mid', pad: 'mid' };


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
