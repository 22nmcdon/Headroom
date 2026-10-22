// The grid you draw notes on, as numbers.
//
// A piano roll is the obvious editor and the wrong one here: it needs a drag,
// a pointer and a lot of width, and three of those are in short supply on a
// phone. A step grid needs a tap. Rows are pitches, columns are a division of
// the bar, and a cell is on or off - which is less than a DAW gives you and
// exactly enough to get a four-bar idea out of your head.
//
// Rows are a scale rather than every semitone, because a chromatic grid is
// twelve rows an octave of which five are usually wrong, and because picking
// a key is a thing a sketch has anyway. The chromatic scale is in the list
// for when that is not true.
//
// Pure, all of it: a clip in, a clip out, nothing about an element anywhere.

import { PPQ } from './midi.js';

/** How fine the grid is. Thirds are in because swung eighths are not. */
export const STEP_DIVISIONS = [
  { id: 'quarter', label: '1/4', ticks: PPQ },
  { id: 'eighth', label: '1/8', ticks: PPQ / 2 },
  { id: 'sixteenth', label: '1/16', ticks: PPQ / 4 },
  { id: 'triplet', label: '1/8 triplet', ticks: PPQ / 3 },
];

export const DIVISION_IDS = STEP_DIVISIONS.map((division) => division.id);

export const divisionOf = (id) =>
  STEP_DIVISIONS.find((division) => division.id === id) ?? STEP_DIVISIONS[1];

/** The scales the rows can be built from, as semitones above the root. */
export const SCALES = {
  minor: { label: 'Minor', steps: [0, 2, 3, 5, 7, 8, 10] },
  major: { label: 'Major', steps: [0, 2, 4, 5, 7, 9, 11] },
  dorian: { label: 'Dorian', steps: [0, 2, 3, 5, 7, 9, 10] },
  pentatonic: { label: 'Minor pentatonic', steps: [0, 3, 5, 7, 10] },
  chromatic: { label: 'Chromatic', steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
};

export const SCALE_IDS = Object.keys(SCALES);

/** The twelve, spelled flat: a sketch is in a key, and most keys take flats. */
const PITCH_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];

export const ROOT_NAMES = PITCH_NAMES;

/** A MIDI pitch, as a name. 60 is C4, which is what every DAW calls it. */
export const pitchName = (pitch) =>
  `${PITCH_NAMES[((pitch % 12) + 12) % 12]}${Math.floor(pitch / 12) - 1}`;

/**
 * The kit's rows.
 *
 * Three, because the kit synthesises three pieces. A row per General MIDI
 * drum would be a grid of mostly silence, and the pitches here are the ones
 * the exporter writes so what Logic opens is what you heard.
 */
export const KIT_ROWS = [
  { pitch: 42, label: 'Hat' },
  { pitch: 38, label: 'Snare' },
  { pitch: 36, label: 'Kick' },
];

/** Where each instrument's two octaves sit. A bass an octave up is a guitar. */
export const RANGES = { bass: 36, piano: 48, synth: 48, kit: 36 };

export const EDITOR_OCTAVES = 2;

/**
 * The rows for a track, highest pitch first.
 *
 * Top-down because that is how a stave and a piano roll both run, and a grid
 * that climbs downwards reads as an upside-down one even to somebody who
 * could not say why.
 */
export function rowsFor(track, key = {}) {
  // A voice track holds recordings, and a recording has no rows.
  if (track?.instrument === 'voice') return [];
  if (track?.instrument === 'kit') return KIT_ROWS;

  const { root = 0, scale = 'minor' } = key;
  const steps = (SCALES[scale] ?? SCALES.minor).steps;
  const low = (RANGES[track?.instrument] ?? 48) + (((root % 12) + 12) % 12);

  const pitches = [];
  for (let octave = 0; octave <= EDITOR_OCTAVES; octave += 1) {
    for (const step of steps) {
      const pitch = low + octave * 12 + step;
      if (pitch <= low + EDITOR_OCTAVES * 12 && pitch <= 127) pitches.push(pitch);
    }
  }

  return pitches
    .reverse()
    .map((pitch) => ({ pitch, label: pitchName(pitch), root: pitch % 12 === low % 12 }));
}

/* --- cells ------------------------------------------------------------------ */

/** How many columns a clip is, at this division. */
export const columnsOf = (clip, step) =>
  (clip?.length > 0 && step > 0 ? Math.ceil(clip.length / step) : 0);

/** Which column a tick is in. */
export const columnOf = (tick, step) => Math.floor(tick / step);

/**
 * The note in a cell, if there is one.
 *
 * A note counts as being in the cell its start falls in, however long it is.
 * Which is the only rule that makes a tap reversible: whatever a tap put
 * there, the same tap takes away.
 */
export const cellAt = (clip, pitch, column, step) =>
  clip?.notes?.find((note) => note.pitch === pitch && columnOf(note.start, step) === column) ?? null;

/** Every cell that is on, as `pitch:column` strings - what a renderer wants. */
export function filled(clip, step) {
  const on = new Set();
  for (const note of clip?.notes ?? []) on.add(`${note.pitch}:${columnOf(note.start, step)}`);
  return on;
}

/**
 * A tap: the clip's notes with that cell turned on, or off if it was on.
 *
 * Notes only, not a clip, because the caller has the clip and `setNotes` has
 * the rest of it. A note is as long as the cell it is in, which is what makes
 * a step grid legible - and the length can still be anything, since nothing
 * here refuses a clip whose notes came from somewhere else.
 */
export function toggleCell(clip, pitch, column, step, { velocity = 96 } = {}) {
  const notes = clip?.notes ?? [];
  const here = cellAt(clip, pitch, column, step);

  if (here) return notes.filter((note) => note !== here);

  const start = column * step;
  if (clip?.length > 0 && start >= clip.length) return notes;

  return [...notes, {
    pitch,
    start,
    length: Math.min(step, (clip?.length ?? start + step) - start),
    velocity,
  }];
}

/** Everything in a row, gone. The one bulk edit worth having. */
export const clearRow = (clip, pitch) =>
  (clip?.notes ?? []).filter((note) => note.pitch !== pitch);

/**
 * The clip's notes with its length changed, and anything past the end gone.
 *
 * Shortening a clip and keeping notes beyond its end would mean notes that
 * exist, cannot be seen, and come back when it is lengthened again - which is
 * a bug report about notes appearing from nowhere.
 */
export const fit = (clip, length) =>
  (clip?.notes ?? [])
    .filter((note) => note.start < length)
    .map((note) => ({ ...note, length: Math.max(1, Math.min(note.length, length - note.start)) }));
