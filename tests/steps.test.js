// The step grid's arithmetic.
//
// A tap has to be reversible, a row has to run the right way up, and a clip
// that gets shorter must not keep notes nobody can see.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STEP_DIVISIONS, divisionOf, SCALES, pitchName, KIT_ROWS, rowsFor, EDITOR_OCTAVES,
  columnsOf, columnOf, cellAt, filled, toggleCell, clearRow, fit,
} from '../src/sketch/steps.js';
import { PPQ } from '../src/sketch/midi.js';
import { clipOf } from '../src/sketch/project.js';

const BAR = PPQ * 4;
const EIGHTH = PPQ / 2;

test('a division is in ticks, and the eighth is the default', () => {
  assert.equal(divisionOf('sixteenth').ticks, PPQ / 4);
  assert.equal(divisionOf('nonsense').id, 'eighth');
  // Every division divides a beat into a whole number of steps, or the grid
  // and the bar line disagree.
  for (const division of STEP_DIVISIONS) assert.equal(PPQ % division.ticks, 0);
});

test('pitches are named the way a DAW names them', () => {
  assert.equal(pitchName(60), 'C4');
  assert.equal(pitchName(61), 'D♭4');
  assert.equal(pitchName(36), 'C2');
  assert.equal(pitchName(0), 'C-1');
});

test('a scale row set runs high to low and spans two octaves', () => {
  const rows = rowsFor({ instrument: 'synth' }, { root: 0, scale: 'minor' });

  assert.equal(rows[0].pitch, 48 + EDITOR_OCTAVES * 12);
  assert.equal(rows[rows.length - 1].pitch, 48);
  // Downwards, every step of the way.
  for (let i = 1; i < rows.length; i += 1) assert.ok(rows[i].pitch < rows[i - 1].pitch);
  // Seven to an octave, plus the octave itself on top.
  assert.equal(rows.length, SCALES.minor.steps.length * EDITOR_OCTAVES + 1);
});

test('the root is marked, so a scale has a ladder you can count on', () => {
  const rows = rowsFor({ instrument: 'synth' }, { root: 2, scale: 'minor' });
  const roots = rows.filter((row) => row.root).map((row) => row.pitch);
  assert.deepEqual(roots, [74, 62, 50]);
  assert.equal(pitchName(50), 'D3');
});

test('the bass sits an octave below the keys', () => {
  const bass = rowsFor({ instrument: 'bass' }, {});
  const synth = rowsFor({ instrument: 'synth' }, {});
  assert.equal(synth[synth.length - 1].pitch - bass[bass.length - 1].pitch, 12);
});

test('the kit gets the three pieces it can actually make', () => {
  assert.deepEqual(rowsFor({ instrument: 'kit' }, { scale: 'chromatic' }), KIT_ROWS);
});

test('a bar of eighths is eight columns', () => {
  const clip = clipOf({ length: BAR });
  assert.equal(columnsOf(clip, EIGHTH), 8);
  assert.equal(columnsOf(clip, PPQ / 4), 16);
  assert.equal(columnsOf(clipOf({ length: BAR * 2 }), PPQ), 8);
  assert.equal(columnOf(PPQ * 3, EIGHTH), 6);
});

test('a tap puts a note in a cell, and the same tap takes it out', () => {
  const clip = clipOf({ length: BAR });

  const on = clipOf({ ...clip, notes: toggleCell(clip, 60, 2, EIGHTH) });
  assert.deepEqual(on.notes, [{ pitch: 60, start: PPQ, length: EIGHTH, velocity: 96 }]);

  const off = toggleCell(on, 60, 2, EIGHTH);
  assert.deepEqual(off, []);
});

test('a note counts as being in the cell its start is in, however long it is', () => {
  // Which is what makes the tap reversible: a two-bar note drawn by hand is
  // still turned off by tapping where it starts, not where it ends.
  const clip = clipOf({ length: BAR, notes: [{ pitch: 60, start: 0, length: BAR }] });
  assert.ok(cellAt(clip, 60, 0, EIGHTH));
  assert.equal(cellAt(clip, 60, 1, EIGHTH), null);
  assert.deepEqual(toggleCell(clip, 60, 0, EIGHTH), []);
});

test('a tap past the end of the clip does nothing', () => {
  const clip = clipOf({ length: BAR });
  assert.deepEqual(toggleCell(clip, 60, 8, EIGHTH), []);
});

test('a note drawn at the last cell is trimmed to the clip', () => {
  const clip = clipOf({ length: BAR });
  const [note] = toggleCell(clip, 60, 7, EIGHTH);
  assert.equal(note.start + note.length, BAR);
});

test('what is on comes back as cells a renderer can look up', () => {
  const clip = clipOf({
    length: BAR,
    notes: [{ pitch: 60, start: 0 }, { pitch: 63, start: PPQ * 2 }],
  });
  assert.deepEqual([...filled(clip, EIGHTH)].sort(), ['60:0', '63:4']);
});

test('a row can be emptied without touching the others', () => {
  const clip = clipOf({
    length: BAR,
    notes: [{ pitch: 60, start: 0 }, { pitch: 60, start: PPQ }, { pitch: 63, start: 0 }],
  });
  assert.deepEqual(clearRow(clip, 60).map((note) => note.pitch), [63]);
});

test('shortening a clip drops what is past the end and trims what straddles it', () => {
  const clip = clipOf({
    length: BAR * 2,
    notes: [
      { pitch: 60, start: 0, length: PPQ },
      { pitch: 62, start: BAR - PPQ / 2, length: PPQ * 2 },
      { pitch: 64, start: BAR, length: PPQ },
    ],
  });

  const notes = fit(clip, BAR);
  assert.deepEqual(notes.map((note) => note.pitch), [60, 62]);
  assert.equal(notes[1].start + notes[1].length, BAR);
});
