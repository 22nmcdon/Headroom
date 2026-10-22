// A Standard MIDI File, written out.
//
// The sketchpad's job ends when an idea opens cleanly in a DAW, so this is
// the piece everything else is pointed at. It is deliberately the first thing
// built and deliberately pure: no audio context, no DOM, nothing to mock. A
// set of notes in ticks goes in and a byte array comes out, and the tests
// beside it read that array back and compare.
//
// Format 1, which is the one with a tempo map: track 0 carries the tempo and
// the time signature and nothing else, and every track after it is one
// instrument. Format 0 would put everything on one track and arrive in Logic
// as a single region that has to be taken apart by hand.
//
// Everything is in ticks, because that is what a MIDI file is in. Storing
// notes in seconds and converting here would make the export a conversion -
// a lossy one, since a tick grid and a clock do not divide evenly - where
// what it should be is a translation.
//
// The output has been read back by something that did not write it: a
// four-bar sketch on four tracks parses in `mido` as type 1, 480 ticks a
// beat, five tracks, drums on channel 9, 96.000 bpm, 4/4, ten seconds long -
// and every kick lands on the quarter to four decimal places. That is worth
// more than any amount of asserting on hex, and it is the check to repeat
// whenever this file changes.

/** Ticks in a quarter note. 480 divides by 2, 3, 4, 5, 6, 8, 10, 12 and 16. */
export const PPQ = 480;

/** The drum channel, counting from zero. Channel 10 is 9 to a byte. */
export const DRUM_CHANNEL = 9;

/** Which channels an instrument may be given, drums excepted. */
export const PITCHED_CHANNELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];

/**
 * A number in MIDI's variable-length form.
 *
 * Seven bits at a time, most significant first, with the top bit set on every
 * byte but the last. Delta times are written this way, which is why a file
 * with a long gap in it is still only a byte or two longer.
 */
export function writeVarInt(value) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`a variable-length quantity has to be a whole number of ticks, not ${value}`);
  }
  if (value > 0x0fffffff) throw new Error(`${value} ticks is past what a delta time can hold`);

  const out = [value & 0x7f];
  let left = value >>> 7;
  while (left > 0) {
    out.unshift((left & 0x7f) | 0x80);
    left >>>= 7;
  }
  return out;
}

/** And back, for whoever is reading one. Returns the value and its length. */
export function readVarInt(bytes, at) {
  let value = 0;
  let read = 0;

  for (;;) {
    const byte = bytes[at + read];
    if (byte === undefined) throw new Error('the file ends in the middle of a delta time');
    value = (value << 7) | (byte & 0x7f);
    read += 1;
    if ((byte & 0x80) === 0) break;
    if (read > 4) throw new Error('a delta time longer than four bytes is not a delta time');
  }

  return { value, read };
}

const text = (string) => [...new TextEncoder().encode(string)];

const uint16 = (value) => [(value >> 8) & 0xff, value & 0xff];
const uint32 = (value) => [
  (value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff,
];

/** A chunk: four letters, a length, and the bytes. */
const chunk = (id, body) => [...text(id), ...uint32(body.length), ...body];

/**
 * Microseconds in a quarter note, which is how a MIDI file says tempo.
 *
 * Rounded, because the file holds a whole number and 120 bpm is exactly
 * 500000 while 97 bpm is not. The rounding is at most half a microsecond in
 * a quarter note, which over four bars is a few hundred nanoseconds.
 */
export const microsPerBeat = (bpm) => Math.round(60000000 / bpm);

/** And back. */
export const bpmOf = (micros) => 60000000 / micros;

/**
 * A time signature, as the four bytes the file wants.
 *
 * The denominator is written as a power of two - a 4 is stored as 2 - which
 * is the one part of this format people get wrong. The last two bytes are
 * the metronome and the thirty-second notes per beat, and every file in the
 * world uses 24 and 8.
 */
export function timeSignatureBytes(beats, value) {
  const power = Math.log2(value);
  if (!Number.isInteger(power)) {
    throw new Error(`a time signature's lower number has to be a power of two, not ${value}`);
  }
  return [beats, power, 24, 8];
}

/* --- events --------------------------------------------------------------- */

/**
 * Every note turned into the two events it really is, in tick order.
 *
 * Note-offs before note-ons at the same tick, which matters whenever a part
 * repeats a note: written the other way round, the off from the first note
 * arrives after the on of the second and silences it. Some sequencers write
 * a note-on with velocity zero instead of a note-off for this reason; a
 * proper off with the pair sorted is clearer and just as compatible.
 */
function eventsOf(notes, channel) {
  const events = [];

  for (const note of notes) {
    const pitch = Math.max(0, Math.min(127, Math.round(note.pitch)));
    const velocity = Math.max(1, Math.min(127, Math.round(note.velocity ?? 96)));
    const start = Math.max(0, Math.round(note.start));
    // A note has to last at least one tick, or it is not a note. A drum hit
    // written with no length is the usual way this turns up.
    const length = Math.max(1, Math.round(note.length ?? 1));

    events.push({ at: start, order: 1, bytes: [0x90 | channel, pitch, velocity] });
    events.push({ at: start + length, order: 0, bytes: [0x80 | channel, pitch, 64] });
  }

  return events.sort((a, b) => a.at - b.at || a.order - b.order);
}

/** A track chunk: its name, its sound, its notes, and the end marker. */
function trackChunk(track, channel) {
  const body = [];
  let at = 0;

  const push = (tick, bytes) => {
    body.push(...writeVarInt(tick - at), ...bytes);
    at = tick;
  };

  if (track.name) push(0, [0xff, 0x03, ...writeVarInt(text(track.name).length), ...text(track.name)]);
  // A program change, so the track arrives on something other than whatever
  // the DAW happened to have selected. General MIDI numbers these from one
  // and the file counts from zero, which is the other thing people get wrong.
  if (Number.isInteger(track.program)) push(0, [0xc0 | channel, track.program & 0x7f]);

  for (const event of eventsOf(track.notes ?? [], channel)) push(event.at, event.bytes);

  push(at, [0xff, 0x2f, 0x00]);
  return chunk('MTrk', body);
}

/**
 * Which channel each track goes out on.
 *
 * Drums are not a choice: General MIDI puts them on channel 10 and every DAW
 * in existence reads a note on that channel as a drum map rather than as a
 * pitch. Everything else takes the next free channel, and a track may name
 * its own.
 */
export function channelsFor(tracks) {
  const free = [...PITCHED_CHANNELS];
  const taken = new Set(tracks.map((track) => track.channel).filter(Number.isInteger));

  return tracks.map((track) => {
    if (track.drums) return DRUM_CHANNEL;
    if (Number.isInteger(track.channel)) return track.channel;

    while (free.length && taken.has(free[0])) free.shift();
    // Past sixteen tracks there is nowhere left to go, and doubling up is
    // better than refusing: two parts on one channel still arrive, they just
    // arrive sharing a sound.
    const next = free.shift() ?? PITCHED_CHANNELS[0];
    taken.add(next);
    return next;
  });
}

/**
 * A whole file.
 *
 * `tracks` are instruments; the tempo track is added here, because a format 1
 * file has to have one and nothing calling this should have to remember that.
 */
export function writeMidi({
  tracks = [],
  bpm = 96,
  beats = 4,
  value = 4,
  ppq = PPQ,
  name = null,
} = {}) {
  if (!Number.isFinite(bpm) || bpm <= 0) throw new Error(`${bpm} is not a tempo`);

  const tempoBody = [];
  let at = 0;
  const push = (tick, bytes) => {
    tempoBody.push(...writeVarInt(tick - at), ...bytes);
    at = tick;
  };

  if (name) push(0, [0xff, 0x03, ...writeVarInt(text(name).length), ...text(name)]);
  push(0, [0xff, 0x51, 0x03, ...uint32(microsPerBeat(bpm)).slice(1)]);
  push(0, [0xff, 0x58, 0x04, ...timeSignatureBytes(beats, value)]);
  push(0, [0xff, 0x2f, 0x00]);

  const channels = channelsFor(tracks);
  const chunks = [
    chunk('MThd', [...uint16(1), ...uint16(tracks.length + 1), ...uint16(ppq)]),
    chunk('MTrk', tempoBody),
    ...tracks.map((track, i) => trackChunk(track, channels[i])),
  ];

  return Uint8Array.from(chunks.flat());
}

/* --- reading one back ----------------------------------------------------- */

/**
 * A file, parsed.
 *
 * Here rather than in the tests, because a test that asserts on hex is a test
 * that passes when the bytes are wrong in the same way twice. This reads what
 * `writeMidi` wrote the way a DAW would - chunk by chunk, delta by delta -
 * and hands back notes in the shape they went in as, so the two can be
 * compared directly.
 *
 * It handles running status, which this writer never emits but most other
 * writers do, so a file from somewhere else can be read too.
 */
export function readMidi(bytes) {
  const data = Uint8Array.from(bytes);
  const read4 = (at) => (data[at] << 24 | data[at + 1] << 16 | data[at + 2] << 8 | data[at + 3]) >>> 0;
  const read2 = (at) => (data[at] << 8) | data[at + 1];
  const idAt = (at) => String.fromCharCode(data[at], data[at + 1], data[at + 2], data[at + 3]);

  if (idAt(0) !== 'MThd') throw new Error('this does not start with a MIDI header');

  const format = read2(8);
  const count = read2(10);
  const ppq = read2(12);

  const file = { format, ppq, bpm: null, beats: null, value: null, name: null, tracks: [] };
  let at = 8 + read4(4);

  for (let n = 0; n < count; n += 1) {
    if (idAt(at) !== 'MTrk') throw new Error(`chunk ${n} is not a track`);
    const length = read4(at + 4);
    const end = at + 8 + length;
    let here = at + 8;
    let tick = 0;
    let status = 0;

    const track = { name: null, channel: null, program: null, notes: [] };
    const open = new Map(); // pitch -> the note-on waiting for its off

    while (here < end) {
      const delta = readVarInt(data, here);
      tick += delta.value;
      here += delta.read;

      if (data[here] & 0x80) {
        status = data[here];
        here += 1;
      }

      if (status === 0xff) {
        const type = data[here];
        here += 1;
        const size = readVarInt(data, here);
        here += size.read;
        const body = data.subarray(here, here + size.value);
        here += size.value;

        if (type === 0x03) track.name = new TextDecoder().decode(body);
        if (type === 0x51) file.bpm = bpmOf((body[0] << 16) | (body[1] << 8) | body[2]);
        if (type === 0x58) { file.beats = body[0]; file.value = 2 ** body[1]; }
        continue;
      }

      const kind = status & 0xf0;
      const channel = status & 0x0f;

      if (kind === 0xc0) {
        track.channel = channel;
        track.program = data[here];
        here += 1;
        continue;
      }

      const pitch = data[here];
      const velocity = data[here + 1];
      here += 2;

      if (kind === 0x90 && velocity > 0) {
        track.channel = track.channel ?? channel;
        open.set(pitch, { pitch, start: tick, velocity });
        continue;
      }
      if (kind === 0x90 || kind === 0x80) {
        const note = open.get(pitch);
        if (!note) continue;
        open.delete(pitch);
        track.notes.push({ ...note, length: tick - note.start });
      }
      // Anything else - aftertouch, a controller, pitch bend - is two bytes
      // already consumed and nothing this reader has an opinion about.
    }

    // Track zero of a format 1 file is the tempo map and carries no notes;
    // its name is the file's.
    if (n === 0 && format === 1) file.name = track.name;
    else file.tracks.push(track);

    at = end;
  }

  return file;
}
