// Chord symbols, as notes.
//
// Two jobs and two sets of tests: reading a symbol, which has one right
// answer, and voicing it, which has one stated rule - move as little as
// possible from the chord before.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseChord, parseProgression, voice, chordNotes, QUALITIES, MIDDLE,
} from '../src/sketch/chords.js';
import { pitchName } from '../src/sketch/steps.js';

const named = (pitches) => pitches.map(pitchName);

test('a plain triad is a plain triad', () => {
  const c = parseChord('C');
  assert.equal(c.root, 0);
  assert.equal(c.quality, '');
  assert.deepEqual(c.steps, [0, 4, 7]);
  assert.equal(c.bass, null);
});

test('every accidental anybody types is read', () => {
  assert.equal(parseChord('F#').root, 6);
  assert.equal(parseChord('F♯').root, 6);
  assert.equal(parseChord('Gb').root, 6);
  assert.equal(parseChord('G♭').root, 6);
  assert.equal(parseChord('Cb').root, 11, 'C flat is B');
  assert.equal(parseChord('B#').root, 0, 'B sharp is C');
  assert.equal(parseChord('c').root, 0, 'a lower-case letter is still a note');
});

test('the spellings people actually use all land on the same chord', () => {
  const minorSeventh = [0, 3, 7, 10];
  for (const text of ['Am7', 'Amin7', 'A-7']) {
    assert.deepEqual(parseChord(text).steps, minorSeventh, text);
  }
  for (const text of ['Cmaj7', 'CM7', 'Cma7', 'CΔ']) {
    assert.deepEqual(parseChord(text).steps, [0, 4, 7, 11], text);
  }
  assert.deepEqual(parseChord('C+').steps, parseChord('Caug').steps);
  assert.deepEqual(parseChord('E°').steps, parseChord('Edim').steps);
  assert.deepEqual(parseChord('Bø').steps, parseChord('Bm7b5').steps);
  assert.deepEqual(parseChord('Gsus').steps, parseChord('Gsus4').steps);
});

test('the longest quality wins, so maj7 is not a major triad with a 7 after it', () => {
  assert.equal(parseChord('Cmaj7').quality, 'maj7');
  assert.equal(parseChord('C7').quality, '7');
  assert.equal(parseChord('Cm11').quality, 'm11');
  assert.equal(parseChord('Cm7b5').quality, 'm7b5');
  assert.equal(parseChord('Cdim7').quality, 'dim7');
});

test('a slash bass is the note underneath and nothing else', () => {
  const chord = parseChord('G/B');
  assert.deepEqual(chord.steps, [0, 4, 7]);
  assert.equal(chord.root, 7);
  assert.equal(chord.bass, 11);
  assert.equal(parseChord('Dm7/G').bass, 7);
});

test('what is not a chord reads as nothing, rather than throwing', () => {
  for (const text of ['', '  ', 'xyz', 'H', 'C#maj77', 'G/H', 'C/E/G', '7']) {
    assert.equal(parseChord(text), null, `"${text}" parsed as something`);
  }
  assert.doesNotThrow(() => parseChord(undefined));
});

test('a chord halfway through being typed is the chord so far', () => {
  // This runs on every keystroke. "C/" is somebody reaching for "C/E", and
  // a C until they get there is better than nothing until they get there.
  assert.equal(parseChord('C/').root, 0);
  assert.equal(parseChord('C/').bass, null);
});

test('every quality in the table is a set of semitones in order', () => {
  for (const [name, steps] of QUALITIES) {
    assert.equal(steps[0], 0, `${name} does not start on its root`);
    for (let i = 1; i < steps.length; i += 1) {
      assert.ok(steps[i] > steps[i - 1], `${name} is out of order`);
    }
    assert.ok(new Set(steps).size === steps.length, `${name} has a note twice`);
  }
});

test('a progression splits on bars, commas or spaces alike', () => {
  for (const line of ['Cm7 | Ab | Eb | Bb', 'Cm7,Ab,Eb,Bb', 'Cm7 Ab Eb Bb']) {
    const read = parseProgression(line);
    assert.equal(read.length, 4, line);
    assert.deepEqual(read.map((piece) => piece.chord.root), [0, 8, 3, 10], line);
  }
});

test('a progression keeps what it could not read, so it can be said out loud', () => {
  const read = parseProgression('Cm7 | wat | Eb');
  assert.equal(read.length, 3);
  assert.equal(read[1].text, 'wat');
  assert.equal(read[1].chord, null);
});

/* --- voicing --------------------------------------------------------------- */

test('a chord on its own sits around the middle', () => {
  const notes = voice(parseChord('C'));
  assert.equal(notes.length, 3);
  for (const pitch of notes) assert.ok(Math.abs(pitch - MIDDLE) <= 14, `${pitch}`);
  // And it is a C major triad, whatever octaves it chose.
  assert.deepEqual([...new Set(notes.map((p) => p % 12))].sort((a, b) => a - b), [0, 4, 7]);
});

test('the next chord moves as little as it can from the one before', () => {
  // C to F in root position is a jump of five semitones in every voice. Led
  // properly, C and F share nothing but should still barely move.
  const first = voice(parseChord('C'));
  const second = voice(parseChord('F'), first);

  const moved = second.map((pitch, i) => Math.abs(pitch - first[Math.min(i, first.length - 1)]));
  assert.ok(Math.max(...moved) <= 5, `moved ${moved}`);
  assert.deepEqual([...new Set(second.map((p) => p % 12))].sort((a, b) => a - b), [0, 5, 9]);
});

test('a progression stays in one place rather than climbing', () => {
  const line = 'Cm7 | Abmaj7 | Ebmaj7 | Bb7 | Cm7 | Abmaj7';
  const notes = chordNotes(line, 1920 * 6);

  const low = Math.min(...notes.map((note) => note.pitch));
  const high = Math.max(...notes.map((note) => note.pitch));
  assert.ok(high - low <= 24, `the progression spans ${high - low} semitones`);
  assert.ok(low >= 36 && high <= 96, `${pitchName(low)} to ${pitchName(high)}`);
});

test('no chord has the same note in it twice', () => {
  let was = null;
  for (const text of ['C', 'Cmaj9', 'Cm11', 'C13', 'Cdim7', 'Faug']) {
    const notes = voice(parseChord(text), was);
    assert.equal(new Set(notes).size, notes.length, `${text}: ${named(notes)}`);
    was = notes;
  }
});

test('a slash bass goes underneath and the chord above it does not move', () => {
  const plain = voice(parseChord('G'));
  const slashed = voice(parseChord('G/B'), null);

  assert.equal(slashed.length, plain.length + 1);
  assert.equal(slashed[0] % 12, 11, 'the bass is not a B');
  assert.ok(slashed[0] < slashed[1], 'the bass is not underneath');
  assert.ok(slashed[1] - slashed[0] <= 12, `the bass is ${slashed[1] - slashed[0]} below`);
});

test('a line of chords fills the clip it was typed into', () => {
  const bar = 1920;
  const notes = chordNotes('Cm | Ab | Eb | Bb', bar * 4);

  const starts = [...new Set(notes.map((note) => note.start))].sort((a, b) => a - b);
  assert.deepEqual(starts, [0, bar, bar * 2, bar * 3]);

  // And the last chord reaches the end, whatever the division left over.
  const last = notes.filter((note) => note.start === bar * 3);
  assert.ok(Math.max(...last.map((note) => note.start + note.length)) > bar * 4 - bar * 0.1);
});

test('three chords in a four-bar clip still reach the end', () => {
  const bar = 1920;
  const notes = chordNotes('C | F | G', bar * 4);
  const ends = notes.map((note) => note.start + note.length);
  assert.ok(Math.max(...ends) > bar * 4 - 100, `ends at ${Math.max(...ends)}`);
  assert.ok(Math.max(...ends) <= bar * 4);
});

test('a line with nothing readable in it puts nothing in the clip', () => {
  assert.deepEqual(chordNotes('', 1920), []);
  assert.deepEqual(chordNotes('wat | nope', 1920), []);
  assert.deepEqual(chordNotes('C', 0), []);
});

test('every note a progression makes is a note the exporter will take', () => {
  for (const note of chordNotes('Cm9 | F13 | Bbmaj7/D | Ebm6', 1920 * 4)) {
    assert.ok(Number.isInteger(note.pitch) && note.pitch >= 0 && note.pitch <= 127);
    assert.ok(Number.isInteger(note.start) && note.start >= 0);
    assert.ok(note.length >= 1);
    assert.ok(note.velocity >= 1 && note.velocity <= 127);
  }
});

test('a ii-V-I does not climb, which is what note-by-note leading does', () => {
  // The case that drove the voicer to score whole voicings rather than
  // leading each note to its nearest octave: every tie resolves the same
  // way, and three chords of this end an octave above where they started.
  const notes = chordNotes('Dm7 | G7 | Cmaj7', 1920 * 3);
  const bars = [0, 1920, 3840].map((start) =>
    notes.filter((note) => note.start === start).map((note) => note.pitch));

  const middles = bars.map((bar) => bar.reduce((a, b) => a + b, 0) / bar.length);
  assert.ok(Math.max(...middles) - Math.min(...middles) < 6,
    `the middle moved from ${middles[0].toFixed(1)} to ${middles[2].toFixed(1)}`);
});

test('a progression that repeats voices the repeat the same way', () => {
  // Nothing in the voicer carries state between passes, so a loop that came
  // back round an octave higher would be drift rather than a decision.
  const notes = chordNotes('Am | F | C | G | Am | F | C | G', 1920 * 8);
  const at = (bar) => notes.filter((note) => note.start === bar * 1920).map((note) => note.pitch);

  for (let bar = 0; bar < 4; bar += 1) {
    assert.deepEqual(at(bar + 4), at(bar), `bar ${bar + 1} and bar ${bar + 5} differ`);
  }
});

test('every voicing is close position, not spread across the keyboard', () => {
  let was = null;
  for (const text of ['Cm7', 'Abmaj7', 'Ebmaj9', 'Bb13', 'F#m11']) {
    const notes = voice(parseChord(text), was);
    const spread = notes[notes.length - 1] - notes[0];
    assert.ok(spread <= 24, `${text} spans ${spread} semitones: ${named(notes)}`);
    was = notes;
  }
});
