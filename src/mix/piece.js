// Something to mix.
//
// A mix exercise needs several parts playing at once, and this app has never
// had any: every tool works on one loop with everything already in it. So the
// stems are written here, as notes, and played by the same instruments the
// sketchpad uses - which is the whole reason the core was built before either
// of these two things sat on it.
//
// A piece *is* a project. Same shape, same tracks, same clips, so the mixer
// below is the sketchpad's mixer and a piece can be opened in the sketchpad
// and taken apart. Nothing here knows what a puzzle is.
//
// Written rather than generated. A generated piece would be a different piece
// every round, and a mix exercise is already asking you to hear four things
// at once; changing the material under that as well would mean never learning
// what the material sounds like right.

import { newProject, setTrack, setNotes, barTicks } from '../sketch/project.js';
import { PPQ } from '../sketch/midi.js';

/** Where each part sits before anybody mixes it: flat, centred, no inserts. */
export const STEM_FLAT = { gain: 0.8, pan: 0, send: 0, inserts: [], muted: false };

const E = PPQ / 2;   // an eighth
const Q = PPQ;       // a quarter

/** Four beats of a bar, as ticks. */
const beat = (bar, count) => bar * Q * 4 + count * Q;

/**
 * A kit part, from a line per piece.
 *
 * `x` is a hit and `.` is not, one character a sixteenth, which is the one
 * notation anybody can read and edit in a source file without counting ticks.
 */
function drums(bars, lines) {
  const notes = [];
  for (const [pitch, pattern] of Object.entries(lines)) {
    const run = pattern.replace(/\s+/g, '');
    for (let bar = 0; bar < bars; bar += 1) {
      for (let i = 0; i < run.length; i += 1) {
        if (run[i] === 'x') {
          notes.push({ pitch: Number(pitch), start: bar * Q * 4 + i * (PPQ / 4), length: PPQ / 4 });
        }
      }
    }
  }
  return notes;
}

/** A chord, as notes all starting together. */
const chord = (pitches, start, length, velocity = 72) =>
  pitches.map((pitch) => ({ pitch, start, length, velocity }));

/* --- the pieces ------------------------------------------------------------ */

/**
 * Four bars in C minor: i - VI - III - VII, which is the progression half the
 * records anybody has ever wanted to mix are built on.
 *
 * Deliberately a piece with a problem in each register: a bass with weight
 * down low, keys sitting in the same mid as the snare, and a pad wide enough
 * to swallow the lot if it is not kept in its place.
 */
const SHORT_NIGHT = () => {
  const kit = drums(4, {
    36: 'x... .... x..x .... ',   // kick
    38: '.... x... .... x... ',   // snare
    42: 'x.x. x.x. x.x. x.x. ',   // hats, eighths
  });

  const roots = [36, 32, 39, 34]; // C2, A♭1, E♭2, B♭1
  const bass = roots.flatMap((pitch, bar) => [
    { pitch, start: beat(bar, 0), length: Q, velocity: 100 },
    { pitch, start: beat(bar, 1) + E, length: E, velocity: 78 },
    { pitch, start: beat(bar, 2), length: Q, velocity: 92 },
    { pitch: pitch + 7, start: beat(bar, 3) + E, length: E, velocity: 74 },
  ]);

  const chords = [[60, 63, 67], [56, 60, 63], [63, 67, 70], [58, 62, 65]];
  const keys = chords.flatMap((pitches, bar) => [
    ...chord(pitches, beat(bar, 0), Q * 2),
    ...chord(pitches, beat(bar, 2) + E, Q + E, 60),
  ]);

  const line = [67, 68, 70, 67]; // G4 A♭4 B♭4 G4 - one a bar, held
  const pad = line.map((pitch, bar) => ({
    pitch, start: beat(bar, 0), length: Q * 4, velocity: 70,
  }));

  return { kit, bass, keys, pad };
};

/**
 * Four bars of something slower and sparser, where the problem is the other
 * way round: nothing is fighting, and the mix is about where things sit
 * rather than about getting them out of each other's way.
 */
const LATE_ROOM = () => {
  const kit = drums(4, {
    36: 'x... .... .... x... ',
    38: '.... .... x... .... ',
    42: 'x..x ..x. x..x ..x. ',
  });

  const roots = [41, 41, 36, 39]; // F2, F2, C2, E♭2
  const bass = roots.flatMap((pitch, bar) => [
    { pitch, start: beat(bar, 0), length: Q * 2, velocity: 88 },
    { pitch: pitch + 12, start: beat(bar, 2) + E, length: Q, velocity: 66 },
  ]);

  const chords = [[53, 56, 60], [53, 56, 60], [48, 51, 55], [51, 55, 58]];
  const keys = chords.flatMap((pitches, bar) => chord(pitches, beat(bar, 0), Q * 3 + E, 64));

  const pad = [[72, 0], [70, 2]].map(([pitch, bar]) => ({
    pitch, start: beat(bar, 0), length: Q * 8, velocity: 62,
  }));

  return { kit, bass, keys, pad };
};

/** The pieces, by id. Two, so a run of rounds is not the same four bars. */
export const PIECES = {
  'short-night': { label: 'Short Night', bpm: 96, key: { root: 0, scale: 'minor' }, parts: SHORT_NIGHT },
  'late-room': { label: 'Late Room', bpm: 76, key: { root: 5, scale: 'minor' }, parts: LATE_ROOM },
};

export const PIECE_IDS = Object.keys(PIECES);

/** What each stem is called, and which instrument plays it. */
export const STEMS = [
  { id: 'kit', name: 'Drums', instrument: 'kit' },
  { id: 'bass', name: 'Bass', instrument: 'bass' },
  { id: 'keys', name: 'Keys', instrument: 'piano' },
  { id: 'pad', name: 'Pad', instrument: 'synth' },
];

export const STEM_IDS = STEMS.map((stem) => stem.id);

export const HOW_LONG = 4; // bars

/**
 * A piece, as a project with one scene in it.
 *
 * Every stem flat: this is the material, not a mix of it. What a mix is gets
 * applied on top by `dress`, so the same piece is both the thing you are
 * given and the thing the answer was made from.
 */
export function pieceOf(id) {
  const piece = PIECES[id] ?? PIECES[PIECE_IDS[0]];
  const parts = piece.parts();

  let project = newProject({
    name: piece.label, bpm: piece.bpm, beats: 4, value: 4, key: piece.key,
  });

  const bars = barTicks(project) * HOW_LONG;

  STEMS.forEach((stem, index) => {
    project = setTrack(project, index, { ...STEM_FLAT, name: stem.name, instrument: stem.instrument });
    project = setNotes(project, index, 0, parts[stem.id], bars);
  });

  return project;
}

/**
 * A piece with a mix on it.
 *
 * `mix` is a stem id to settings - `{ gain, pan, send, inserts }` - and what
 * is not said is left flat. Returns a new project, because the target mix and
 * the one being worked on are two renders of the same material and neither
 * may change the other.
 */
export function dress(project, mix = {}) {
  let dressed = project;
  STEM_IDS.forEach((id, index) => {
    dressed = setTrack(dressed, index, { ...STEM_FLAT, ...(mix[id] ?? {}) });
  });
  return dressed;
}
