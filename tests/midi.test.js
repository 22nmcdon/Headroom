// The MIDI exporter, against the format it claims to write.
//
// The sketchpad's whole job is to get an idea out of the browser and into a
// DAW, so this is the piece everything else is pointed at - and it is the one
// place where being nearly right produces a file that opens, looks fine and
// plays back wrong.
//
// Two kinds of check. The bytes a Standard MIDI File has to begin with are
// asserted directly, because those are fixed by the specification and nothing
// else can confirm them. Everything after that goes out through `writeMidi`
// and comes back through `readMidi`, so what is tested is that a part
// survives the round trip rather than that it was encoded the way this
// author happened to imagine.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  writeMidi, readMidi, writeVarInt, readVarInt, microsPerBeat, bpmOf,
  timeSignatureBytes, channelsFor, PPQ, DRUM_CHANNEL,
} from '../src/sketch/midi.js';

/** A bar of four at 480 ticks a quarter. */
const BAR = PPQ * 4;

const four = (pitch, velocity = 100) => Array.from({ length: 4 }, (_, i) => ({
  pitch, start: i * PPQ, length: PPQ / 2, velocity,
}));

/* --- the numbers a file is made of ---------------------------------------- */

test('a variable-length quantity is seven bits at a time, top bit set but the last', () => {
  // The examples from the specification's own table.
  assert.deepEqual(writeVarInt(0), [0x00]);
  assert.deepEqual(writeVarInt(0x40), [0x40]);
  assert.deepEqual(writeVarInt(0x7f), [0x7f]);
  assert.deepEqual(writeVarInt(0x80), [0x81, 0x00]);
  assert.deepEqual(writeVarInt(0x2000), [0xc0, 0x00]);
  assert.deepEqual(writeVarInt(0x3fff), [0xff, 0x7f]);
  assert.deepEqual(writeVarInt(0x4000), [0x81, 0x80, 0x00]);
  assert.deepEqual(writeVarInt(0x0fffffff), [0xff, 0xff, 0xff, 0x7f]);
});

test('and reads back as what went in', () => {
  for (const value of [0, 1, 127, 128, 8191, 8192, 0x3fff, 0x4000, 1234567, 0x0fffffff]) {
    const bytes = writeVarInt(value);
    const back = readVarInt(Uint8Array.from(bytes), 0);
    assert.equal(back.value, value);
    assert.equal(back.read, bytes.length);
  }
});

test('a delta time that is not a whole number of ticks is refused', () => {
  // Rather than silently truncated, which is how a part drifts a tick a bar
  // and nobody can say where it came from.
  assert.throws(() => writeVarInt(1.5), /whole number/);
  assert.throws(() => writeVarInt(-1), /whole number/);
  assert.throws(() => writeVarInt(0x10000000), /past what a delta time can hold/);
});

test('tempo is microseconds in a quarter note, and 120 is exactly half a million', () => {
  assert.equal(microsPerBeat(120), 500000);
  assert.equal(microsPerBeat(60), 1000000);
  assert.equal(microsPerBeat(96), 625000);
  // Rounded, because the file holds a whole number. Half a microsecond in a
  // quarter note is a few hundred nanoseconds over four bars.
  assert.ok(Math.abs(bpmOf(microsPerBeat(97)) - 97) < 0.001);
  assert.ok(Math.abs(bpmOf(microsPerBeat(128.5)) - 128.5) < 0.001);
});

test('a time signature stores its lower number as a power of two', () => {
  // The one part of this format people get wrong: a 4 is stored as a 2.
  assert.deepEqual(timeSignatureBytes(4, 4), [4, 2, 24, 8]);
  assert.deepEqual(timeSignatureBytes(3, 4), [3, 2, 24, 8]);
  assert.deepEqual(timeSignatureBytes(6, 8), [6, 3, 24, 8]);
  assert.deepEqual(timeSignatureBytes(7, 16), [7, 4, 24, 8]);
  assert.throws(() => timeSignatureBytes(4, 5), /power of two/);
});

/* --- the file's own bytes -------------------------------------------------- */

test('a file begins the way a Standard MIDI File has to begin', () => {
  const bytes = writeMidi({ bpm: 120, tracks: [{ name: 'Keys', notes: four(60) }] });

  assert.deepEqual([...bytes.slice(0, 4)], [...Buffer.from('MThd')]);
  assert.deepEqual([...bytes.slice(4, 8)], [0, 0, 0, 6], 'the header is six bytes long');
  assert.deepEqual([...bytes.slice(8, 10)], [0, 1], 'format 1');
  assert.deepEqual([...bytes.slice(10, 12)], [0, 2], 'the tempo track plus one instrument');
  assert.deepEqual([...bytes.slice(12, 14)], [(PPQ >> 8) & 0xff, PPQ & 0xff]);
  assert.deepEqual([...bytes.slice(14, 18)], [...Buffer.from('MTrk')]);
});

test('every track ends with an end-of-track, which is not optional', () => {
  // A file without one opens in some DAWs and not others, and the ones it
  // opens in often drop the last note.
  const bytes = writeMidi({ tracks: [{ name: 'A', notes: four(60) }, { name: 'B', notes: four(64) }] });
  const marks = [];
  for (let i = 0; i < bytes.length - 2; i += 1) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0x2f && bytes[i + 2] === 0x00) marks.push(i);
  }
  assert.equal(marks.length, 3, 'the tempo track and both instruments');
});

test('format 1 means a tempo map and then one track per instrument', () => {
  const file = readMidi(writeMidi({
    name: 'A sketch',
    bpm: 96,
    beats: 3,
    value: 4,
    tracks: [{ name: 'Keys', notes: four(60) }, { name: 'Bass', notes: four(36) }],
  }));

  assert.equal(file.format, 1);
  assert.equal(file.ppq, PPQ);
  assert.equal(file.name, 'A sketch', 'the file is named on the tempo track');
  assert.ok(Math.abs(file.bpm - 96) < 0.01);
  assert.equal(file.beats, 3);
  assert.equal(file.value, 4);
  assert.deepEqual(file.tracks.map((t) => t.name), ['Keys', 'Bass']);
});

/* --- what came out is what went in ----------------------------------------- */

test('a part survives the round trip, tick for tick', () => {
  const notes = [
    { pitch: 60, start: 0, length: 240, velocity: 100 },
    { pitch: 64, start: 480, length: 960, velocity: 80 },
    { pitch: 67, start: 1920, length: 1, velocity: 127 },
    { pitch: 48, start: 7680, length: 1920, velocity: 1 },
  ];

  const [track] = readMidi(writeMidi({ tracks: [{ name: 'Keys', notes }] })).tracks;
  assert.deepEqual(
    track.notes.sort((a, b) => a.start - b.start),
    notes.map((n) => ({ pitch: n.pitch, start: n.start, length: n.length, velocity: n.velocity })),
  );
});

test('a chord comes back as a chord, not as one long note', () => {
  const notes = [
    { pitch: 60, start: 0, length: 960, velocity: 90 },
    { pitch: 64, start: 0, length: 960, velocity: 90 },
    { pitch: 67, start: 0, length: 960, velocity: 90 },
  ];

  const [track] = readMidi(writeMidi({ tracks: [{ name: 'Chords', notes }] })).tracks;
  assert.equal(track.notes.length, 3);
  assert.deepEqual(track.notes.map((n) => n.pitch).sort((a, b) => a - b), [60, 64, 67]);
  assert.ok(track.notes.every((n) => n.start === 0 && n.length === 960));
});

test('a repeated note keeps both of them', () => {
  // The case that breaks a writer which puts note-ons before note-offs at the
  // same tick: the off from the first arrives after the on of the second and
  // silences it, and a bar of eighth notes comes back as one note.
  const notes = Array.from({ length: 8 }, (_, i) => ({
    pitch: 38, start: i * 240, length: 240, velocity: 100,
  }));

  const [track] = readMidi(writeMidi({ tracks: [{ name: 'Snare', notes }] })).tracks;
  assert.equal(track.notes.length, 8, 'eight hits went in');
  assert.deepEqual(track.notes.map((n) => n.start), notes.map((n) => n.start));
  assert.ok(track.notes.every((n) => n.length === 240), 'and none of them ran into the next');
});

test('overlapping notes on different pitches keep their own lengths', () => {
  const notes = [
    { pitch: 36, start: 0, length: 1920, velocity: 100 },
    { pitch: 43, start: 240, length: 240, velocity: 70 },
    { pitch: 43, start: 960, length: 480, velocity: 70 },
  ];

  const [track] = readMidi(writeMidi({ tracks: [{ name: 'Bass', notes }] })).tracks;
  assert.equal(track.notes.length, 3);
  assert.equal(track.notes.find((n) => n.pitch === 36).length, 1920);
  assert.deepEqual(track.notes.filter((n) => n.pitch === 43).map((n) => n.length).sort(), [240, 480]);
});

test('a note with no length given is still a note', () => {
  // How a drum hit usually arrives: a moment rather than a duration.
  const [track] = readMidi(writeMidi({
    tracks: [{ name: 'Kick', notes: [{ pitch: 36, start: 0 }] }],
  })).tracks;

  assert.equal(track.notes.length, 1);
  assert.ok(track.notes[0].length >= 1);
  assert.equal(track.notes[0].velocity, 96, 'and a velocity worth hearing');
});

test('values past what MIDI holds are brought back inside it rather than written out', () => {
  const [track] = readMidi(writeMidi({
    tracks: [{
      name: 'Out of range',
      notes: [
        { pitch: 200, start: 0, length: 240, velocity: 400 },
        { pitch: -5, start: 240, length: 240, velocity: 0 },
      ],
    }],
  })).tracks;

  assert.deepEqual(track.notes.map((n) => n.pitch).sort((a, b) => a - b), [0, 127]);
  assert.ok(track.notes.every((n) => n.velocity >= 1 && n.velocity <= 127));
});

/* --- channels, and the drum map -------------------------------------------- */

test('drums go out on channel 10, which is 9 to a byte', () => {
  // Not a preference. Every DAW reads a note on that channel as a drum map
  // rather than as a pitch, so a kit on any other channel arrives as a
  // melody played very low.
  const channels = channelsFor([
    { name: 'Keys' }, { name: 'Kit', drums: true }, { name: 'Bass' },
  ]);
  assert.equal(channels[1], DRUM_CHANNEL);
  assert.equal(DRUM_CHANNEL, 9);
  assert.ok(!channels.filter((_, i) => i !== 1).includes(DRUM_CHANNEL),
    'and nothing else is given it');
});

test('every other track gets a channel of its own', () => {
  const channels = channelsFor(Array.from({ length: 8 }, (_, i) => ({ name: `T${i}` })));
  assert.equal(new Set(channels).size, 8);
  assert.ok(!channels.includes(DRUM_CHANNEL));
});

test('a track may name its own channel, and nothing else takes it', () => {
  const channels = channelsFor([{ name: 'A' }, { name: 'B', channel: 3 }, { name: 'C' }]);
  assert.equal(channels[1], 3);
  assert.equal(new Set(channels).size, 3);
});

test('the drum channel and the program survive the round trip', () => {
  const file = readMidi(writeMidi({
    tracks: [
      { name: 'Keys', program: 0, notes: four(60) },
      { name: 'Kit', drums: true, notes: four(36) },
    ],
  }));

  assert.equal(file.tracks[0].channel, 0);
  assert.equal(file.tracks[0].program, 0);
  assert.equal(file.tracks[1].channel, DRUM_CHANNEL);
});

/* --- the thing the gate actually asks for ---------------------------------- */

test('a four-bar sketch across four tracks comes out whole', () => {
  // The Phase 0 gate, as a test: a hard-coded pattern on the four starter
  // instruments, exported as one file, read back with everything in place.
  const kick = [0, 2].flatMap((beat) => [{ pitch: 36, start: beat * PPQ, length: 120, velocity: 110 }]);
  const snare = [{ pitch: 38, start: PPQ, length: 120, velocity: 100 }];
  const hats = Array.from({ length: 8 }, (_, i) => ({
    pitch: 42, start: i * (PPQ / 2), length: 60, velocity: i % 2 ? 70 : 95,
  }));

  const bars = (notes) => Array.from({ length: 4 }, (_, bar) =>
    notes.map((n) => ({ ...n, start: n.start + bar * BAR }))).flat();

  const file = readMidi(writeMidi({
    name: 'Sketch',
    bpm: 96,
    tracks: [
      { name: 'Piano', program: 0, notes: bars([{ pitch: 60, start: 0, length: BAR, velocity: 80 }]) },
      { name: 'Bass', program: 33, notes: bars([{ pitch: 36, start: 0, length: PPQ, velocity: 95 }]) },
      { name: 'Kit', drums: true, notes: bars([...kick, ...snare, ...hats]) },
      { name: 'Synth', program: 81, notes: bars([{ pitch: 72, start: PPQ * 2, length: PPQ * 2, velocity: 70 }]) },
    ],
  }));

  assert.equal(file.tracks.length, 4);
  assert.deepEqual(file.tracks.map((t) => t.name), ['Piano', 'Bass', 'Kit', 'Synth']);
  assert.equal(file.tracks[2].channel, DRUM_CHANNEL);
  assert.equal(file.tracks[2].notes.length, 44, 'eleven hits a bar, four bars');

  // Four bars long, and the last note ends exactly on the bar line.
  const end = Math.max(...file.tracks.flatMap((t) => t.notes.map((n) => n.start + n.length)));
  assert.equal(end, BAR * 4);
});

test('an empty sketch is still a file a DAW will open', () => {
  const file = readMidi(writeMidi({ tracks: [] }));
  assert.equal(file.format, 1);
  assert.equal(file.tracks.length, 0);
  assert.ok(file.bpm > 0, 'with a tempo on it');
});

test('a tempo that is not a tempo is refused', () => {
  assert.throws(() => writeMidi({ bpm: 0 }), /not a tempo/);
  assert.throws(() => writeMidi({ bpm: -96 }), /not a tempo/);
  assert.throws(() => writeMidi({ bpm: NaN }), /not a tempo/);
});
