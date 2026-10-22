// What a clip plays, and when.
//
// `notesIn` is the arithmetic between a clip and the transport's windows, and
// it is pure, so it is tested here. Everything around it - the instrument,
// the inserts, the fader - needs an audio context and is measured in the
// browser instead, with the numbers written down beside the code.
//
// The case worth most of these tests is the one that is easy to get wrong in
// a way nobody notices until the fourth bar: a note exactly on a loop point.

import test from 'node:test';
import assert from 'node:assert/strict';

import { makeClip, notesIn } from '../src/core/track.js';
import { PPQ } from '../src/sketch/midi.js';
import {
  GM_DRUMS, pieceFor, INSTRUMENT_IDS, GM_PROGRAM, MOST_VOICES, NOTED, isVoice,
} from '../src/core/instrument.js';

const BAR = PPQ * 4;

/** One note a beat, for a bar. */
const beats = (pitch = 60) => Array.from({ length: 4 }, (_, i) => ({
  pitch, start: i * PPQ, length: PPQ / 2, velocity: 90,
}));

test('a clip fills in what a note does not say', () => {
  const clip = makeClip({ id: 'c', length: BAR, notes: [{ pitch: 60, start: 0 }] });
  assert.equal(clip.notes[0].velocity, 96);
  assert.equal(clip.notes[0].length, 1, 'a note with no length is still a note');
  assert.equal(clip.length, BAR);
});

test('a window inside the clip plays what is in it', () => {
  const clip = makeClip({ id: 'c', length: BAR, notes: beats() });

  assert.deepEqual(notesIn(clip, 0, PPQ).map((n) => n.at), [0]);
  assert.deepEqual(notesIn(clip, 0, BAR).map((n) => n.at), [0, PPQ, PPQ * 2, PPQ * 3]);
  assert.deepEqual(notesIn(clip, PPQ, PPQ * 3).map((n) => n.at), [PPQ, PPQ * 2]);
});

test('a window over the loop point plays the end of one pass and the start of the next', () => {
  const clip = makeClip({ id: 'c', length: BAR, notes: beats() });
  const over = notesIn(clip, PPQ * 3, BAR + PPQ);

  assert.deepEqual(over.map((n) => n.at), [PPQ * 3, BAR]);
  assert.equal(over[1].pitch, 60, 'and the second one is the first note of the clip again');
});

test('a note exactly on the loop point plays once a pass, not twice', () => {
  // The one that is easy to get wrong in a way nobody notices until the
  // fourth bar. A note at tick 0 belongs to the pass starting, never to the
  // one ending, or every loop point gets a double.
  const clip = makeClip({ id: 'c', length: BAR, notes: [{ pitch: 36, start: 0, length: 10 }] });

  // Windowed the way the transport windows it - in uneven steps, never
  // landing on the loop point - and stopping exactly on the fourth pass, so
  // the count is four and not four-and-the-start-of-the-fifth.
  const all = [];
  const end = BAR * 4;
  for (let at = 0; at < end; at += 100) all.push(...notesIn(clip, at, Math.min(end, at + 100)));

  assert.deepEqual(all.map((n) => n.at), [0, BAR, BAR * 2, BAR * 3]);

  // And one more window, which picks up the fifth pass and only that.
  assert.deepEqual(notesIn(clip, end, end + 100).map((n) => n.at), [end]);
});

test('a window longer than the clip plays every pass it covers', () => {
  const clip = makeClip({ id: 'c', length: PPQ, notes: [{ pitch: 42, start: 0 }] });
  assert.deepEqual(notesIn(clip, 0, PPQ * 4).map((n) => n.at), [0, PPQ, PPQ * 2, PPQ * 3]);
});

test('an empty window plays nothing, and so does an empty clip', () => {
  const clip = makeClip({ id: 'c', length: BAR, notes: beats() });
  assert.deepEqual(notesIn(clip, PPQ, PPQ), []);
  assert.deepEqual(notesIn(makeClip({ id: 'e', length: BAR }), 0, BAR * 2), []);
});

test('a note that started before the window is not played again inside it', () => {
  // It was booked by the window that contained its start. Playing it again
  // because it is still sounding would be a stutter on every scheduler pass.
  const clip = makeClip({ id: 'c', length: BAR, notes: [{ pitch: 60, start: 0, length: BAR }] });
  assert.deepEqual(notesIn(clip, 0, 100).map((n) => n.at), [0]);
  assert.deepEqual(notesIn(clip, 100, 200), []);
});

test('a clip keeps the note as it was written, plus where it sounds', () => {
  const clip = makeClip({
    id: 'c', length: BAR, notes: [{ pitch: 64, start: PPQ, length: 240, velocity: 70 }],
  });
  const [note] = notesIn(clip, 0, BAR * 2 + 1);
  assert.equal(note.pitch, 64);
  assert.equal(note.velocity, 70);
  assert.equal(note.length, 240);
  assert.equal(note.start, PPQ, 'where it is in the clip');
  assert.equal(note.at, PPQ, 'and where it sounds on the timeline');

  const [second] = notesIn(clip, BAR, BAR * 2);
  assert.equal(second.start, PPQ, 'still where it is in the clip');
  assert.equal(second.at, BAR + PPQ, 'one pass further along');
});

/* --- the drum map ---------------------------------------------------------- */

test('the General MIDI drum pitches land on the pieces they name', () => {
  // These are fixed by the standard: 36 is a kick wherever it is played, and
  // a kit on channel 10 is read by pitch rather than as a melody.
  assert.equal(pieceFor(36), 'kick');
  assert.equal(pieceFor(35), 'kick');
  assert.equal(pieceFor(38), 'snare');
  assert.equal(pieceFor(40), 'snare');
  assert.equal(pieceFor(42), 'hat');
  assert.equal(pieceFor(46), 'hat');
  assert.equal(pieceFor(51), 'hat', 'a ride comes out as a hat, which is what three pieces can do');
});

test('a pitch the map does not name still plays something', () => {
  // Honest about being three pieces rather than silently dropping the note.
  for (const pitch of [27, 33, 60, 81, 100]) {
    assert.ok(['kick', 'snare', 'hat'].includes(pieceFor(pitch)), `${pitch} plays nothing`);
  }
  assert.ok(Object.keys(GM_DRUMS).length > 20, 'and most of the map is named rather than guessed');
});

/* --- the starter set ------------------------------------------------------- */

test('every starter instrument says which General MIDI sound it is', () => {
  for (const id of INSTRUMENT_IDS) {
    assert.ok(id in GM_PROGRAM, `${id} has no General MIDI program`);
  }

  // The kit is null because it goes on channel 10, where the channel is the
  // instrument; the voice is null because it has no notes to export at all.
  assert.equal(GM_PROGRAM.kit, null);
  assert.equal(GM_PROGRAM.voice, null);

  // The pitched ones - everything that plays notes and is not the kit.
  for (const id of NOTED.filter((each) => each !== 'kit')) {
    assert.ok(Number.isInteger(GM_PROGRAM[id]) && GM_PROGRAM[id] >= 0 && GM_PROGRAM[id] <= 127,
      `${id} is program ${GM_PROGRAM[id]}`);
  }
});

test('there is a ceiling on how many notes can sound at once', () => {
  // Not a musical limit - a runaway guard. A clip with a thousand notes on
  // one tick would otherwise book a thousand oscillators and the page would
  // stop answering before anybody heard the problem.
  assert.ok(MOST_VOICES > 16 && MOST_VOICES <= 128);
});

test('an anchored clip plays from its own beginning, not the one on the wall', () => {
  // Press a two-bar clip on bar three and you should hear its first bar. The
  // unanchored reading of the same window is its third bar, which is the clip
  // somebody wrote minus the part they wrote first.
  const clip = makeClip({
    id: 'two',
    length: BAR * 2,
    notes: [{ pitch: 60, start: 0 }, { pitch: 72, start: BAR }],
  });

  assert.deepEqual(notesIn(clip, BAR * 2, BAR * 3).map((n) => n.pitch), [60]);
  assert.deepEqual(notesIn(clip, BAR * 2, BAR * 3, BAR * 2).map((n) => n.pitch), [60]);
  assert.deepEqual(notesIn(clip, BAR * 3, BAR * 4, BAR * 2).map((n) => n.pitch), [72]);
  // And an anchor an odd number of bars in moves the whole thing with it.
  assert.deepEqual(notesIn(clip, BAR * 3, BAR * 4, BAR * 3).map((n) => n.pitch), [60]);
});

test('an anchored clip comes back with the tick it really sounds at', () => {
  const clip = makeClip({ id: 'one', length: BAR, notes: [{ pitch: 60, start: PPQ }] });
  const [note] = notesIn(clip, BAR * 5, BAR * 6, BAR * 5);
  assert.equal(note.at, BAR * 5 + PPQ);
});

test('the voice is an instrument that plays nothing', () => {
  // A track with no instrument would be a branch in the chain, the fader,
  // the pan, the send and the stem. An instrument that makes no sound is a
  // branch in none of them.
  assert.ok(INSTRUMENT_IDS.includes('voice'));
  assert.ok(isVoice('voice'));
  assert.ok(!isVoice('piano'));
  assert.ok(!NOTED.includes('voice'), 'a step grid on a voice track means nothing');
  assert.deepEqual(NOTED, ['piano', 'bass', 'kit', 'synth']);
});
