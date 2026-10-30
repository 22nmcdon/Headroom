// How far back each part is, read off the room rather than off the sends.
//
// There is one reverb and everything shares it, which is what makes four
// parts sound like they are in the same place - see `sketch/stage.js`. It is
// also why a direct-to-reverberant ratio cannot be taken part by part: by the
// time the return comes back it is one signal with everybody's sends in it,
// and no reading of it can be divided up again.
//
// What a reading of it CAN do is say how much room there is and what is in it,
// and the second one is the surprise. Measured, the room's own spread across
// the three registers of `share.js`, with one part sent to it at a time:
//
//     what is in it        low     mid    high
//     the keys           12.89   14.26  -27.15
//     the pad            -8.88   13.73   -4.85
//     the bass           28.42    2.12  -30.55
//
// Three completely different rooms. A room with the keys in it reads 22.30 dB
// away from a room with the pad in it, and mixtures land in between in
// proportion: the keys at 0.5 and the pad at 0.15 reads (7.37, 9.59, -16.96)
// where the same two the other way round reads (-3.53, 11.17, -7.64), which
// is 10.90 apart. So the room says which parts are in it after all, by its
// colour rather than by any separation of it.
//
// What `width` sees instead, for comparison: the same two mixes read 9.94
// apart on it, which is a real difference and says nothing about which part
// moved. That is the whole argument for this file, and it is the same
// argument `levels.js` makes against reading only the master.

import { registersOf, REGISTER_IDS, REGISTERS } from './share.js';
import { integrated, kWeight } from '../lib/loudness.js';
import { readingOf, stampOf, gapOf } from '../lib/read.js';

/**
 * How far below the mix a room can be and still count as a room.
 *
 * Nothing sent anywhere is a silent return, and a silent return's spectrum is
 * not quiet - it is nothing, and its shape is whatever the arithmetic does
 * with a floor of 1e-20. So below this the room is reported as absent and its
 * colour is not compared at all: there is no colour. Sixty decibels down is
 * far enough away from anything a round asks for: measured, the quietest send
 * a distance round sets is 0.20, and that puts the return 18.3 dB under the
 * mix.
 */
export const ROOM_FLOOR = -60;

/** Whether there is a room to read. */
export const inARoom = (howMuch) => Number.isFinite(howMuch) && howMuch > ROOM_FLOOR;

/**
 * The room, as two facts: how much of it there is, and what colour it is.
 *
 * `howMuch` is the return's loudness against the whole mix's, so it is a
 * proportion rather than a level - a mix and the same mix two decibels down
 * are in the same amount of room, and `loudness` next door is where the two
 * decibels get reported.
 *
 * `shape` is the return's spread across the three registers with its own mean
 * taken out, for the same reason: how much room there is is already the other
 * number, and what is left here is what is in it.
 */
export function roomOf(stems, rate) {
  const room = stems.find((stem) => stem.kind === 'room');
  const whole = stems.find((stem) => stem.kind === 'mix');
  if (!room || !whole) return { howMuch: -Infinity, bands: {}, shape: {} };

  const lufs = (channels, at) => integrated(
    channels.map((channel) => kWeight(channel, at)), at,
  ).lufs;

  const howMuch = lufs(room.channels, room.rate ?? rate) - lufs(whole.channels, whole.rate ?? rate);
  if (!inARoom(howMuch)) return { howMuch, bands: {}, shape: {} };

  const bands = registersOf(room.channels, room.rate ?? rate);
  const mean = REGISTER_IDS.reduce((sum, id) => sum + bands[id], 0) / REGISTER_IDS.length;

  return {
    howMuch,
    bands,
    shape: Object.fromEntries(REGISTER_IDS.map((id) => [id, bands[id] - mean])),
  };
}

/** What a room reading is indexed by. */
export const ROOM_AXIS = { kind: 'room-registers', bands: REGISTER_IDS };

/** The room, in an envelope. */
export function roomReading(stems, rate, { source = null } = {}) {
  const values = roomOf(stems, rate);
  return readingOf({
    tool: null,
    kind: 'room',
    of: { state: stampOf({ rate }), source, axis: ROOM_AXIS },
    values,
  });
}

/** What each register is called where somebody has to read it. */
const ROOM_SAID = Object.fromEntries(REGISTERS.map((band) => [band.id, band.label]));

/**
 * How far apart two rooms are: the worse of how much, and of what is in it.
 *
 * The worse rather than a sum, for the reason every other reading here gives.
 * The two say different things - a mix with the right amount of room and the
 * wrong things in it is a mix where something is at the wrong distance, and
 * averaging the two would call it half right.
 *
 * A room nobody is in is compared on how much only. There is no colour to a
 * silent return, and a comparison of its three registers would be a comparison
 * of three floors.
 */
export function roomGap(mine, theirs) {
  const a = mine.values ?? mine;
  const b = theirs.values ?? theirs;

  const mineAt = inARoom(a.howMuch) ? a.howMuch : ROOM_FLOOR;
  const theirsAt = inARoom(b.howMuch) ? b.howMuch : ROOM_FLOOR;

  let off = mineAt - theirsAt;
  let where = 'how much room there is';
  const detail = { wetter: off, each: {} };

  if (inARoom(a.howMuch) && inARoom(b.howMuch)) {
    for (const band of REGISTER_IDS) {
      const by = (a.shape[band] ?? 0) - (b.shape[band] ?? 0);
      detail.each[band] = by;
      if (Math.abs(by) > Math.abs(off)) {
        off = by;
        where = ROOM_SAID[band];
        detail.colour = by;
      }
    }
  }

  return gapOf({ off, where, detail });
}
