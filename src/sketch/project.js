// A sketch, as data.
//
// Project, tracks, slots, clips - and a row of slots across every track is a
// scene. That is Ableton's session view and it is the right shape for what
// this is for: loop a thing, layer another on it, swap one out, keep the one
// that worked. There is no timeline, on purpose. Arranging is what a DAW is
// for, and the sketchpad's job ends when the idea is out of here.
//
// All of it is plain data - no nodes, no audio context, nothing that needs a
// browser - so a project is JSON, a test needs nothing, and the export is a
// pure function from this to a byte array.
//
// Everything is in ticks. The exporter writes ticks, the transport counts in
// ticks, and a sketch stored in the units it leaves in is a translation away
// from a file rather than a conversion away.

import { PPQ, writeMidi } from './midi.js';
import { ticksPerBar } from './transport.js';
import { INSTRUMENT_IDS, GM_PROGRAM } from '../core/instrument.js';
import { EFFECT_IDS } from '../core/effects.js';
import { DIVISION_IDS, SCALE_IDS, fit } from './steps.js';
import { tidyAll } from './knobs.js';

/** The shape of a stored project. Bumped when a file written today stops loading. */
export const PROJECT_FORMAT = 1;

/** What a new sketch opens with: four tracks, four scenes, nothing in them. */
export const STARTER = [
  { id: 'piano', name: 'Piano', instrument: 'piano', pan: -0.15 },
  { id: 'bass', name: 'Bass', instrument: 'bass', pan: 0 },
  { id: 'kit', name: 'Kit', instrument: 'kit', pan: 0 },
  { id: 'synth', name: 'Synth', instrument: 'synth', pan: 0.2, gain: 0.6 },
  // Somewhere to sing. The whole reason a sketchpad is worth having on a
  // phone is that an idea arrives when the phone is the only thing to hand,
  // and a hummed line is not notes.
  { id: 'voice', name: 'Voice', instrument: 'voice', pan: 0 },
];

/** What a new sketch opens with. */
export const SCENES = 4;

/**
 * And the most it will hold.
 *
 * A cap rather than no cap, because past about this many a row of clips is
 * an arrangement and an arrangement wants a timeline, which is the thing
 * this deliberately does not have. Eight is two screens of scrolling on a
 * phone and enough for an intro, a verse, a chorus and somewhere to put the
 * idea that does not fit yet.
 */
export const MOST_SCENES = 8;

/** A clip, with everything it does not say filled in. */
/** What a clip can do when it has gone round enough times. */
export const THEN = ['next', 'first', 'stop'];

/** The most passes a clip will count before doing it. */
export const MOST_PASSES = 8;

/**
 * A clip's follow action, or null for the thing it does by default.
 *
 * Null is looping until somebody presses something else, which is what a
 * clip grid is *for* - you keep a loop going while you work on the next
 * thing. A follow is the option on top, for when the idea has a shape and
 * you want to hear it go through rather than drive it by hand.
 */
export const followOf = (follow) => {
  if (!follow) return null;
  const after = Math.round(Number(follow.after));
  if (!Number.isFinite(after) || after < 1) return null;
  return {
    after: Math.min(MOST_PASSES, after),
    then: THEN.includes(follow.then) ? follow.then : 'next',
  };
};

export const clipOf = ({
  id = null, length = PPQ * 4, notes = [], name = '', division = 'eighth', chords = '',
  take = null, follow = null,
} = {}) => ({
  id: id ?? `clip-${Math.random().toString(36).slice(2, 8)}`,
  name,
  length,
  // A recording, by the id it is stored under, or null for a clip of notes.
  // The audio itself is far too big for a project file, so what is kept
  // here is the thread back to it - and a clip whose take has gone is a
  // clip that plays nothing, which is why they are swept together.
  take: take ? String(take) : null,
  follow: followOf(follow),
  // The line of chord symbols this clip was made from, when it was made from
  // one. Kept so that coming back to it shows what was typed rather than
  // only the notes it became - which is the difference between a part you
  // can edit and a part you have to retype.
  chords: String(chords ?? '').slice(0, 200),
  // How it was drawn, kept with it: a drum part in sixteenths and a chord
  // part in quarters are the same clip grid at two settings, and reopening
  // one at the other's is a clip whose notes sit between the lines.
  division: DIVISION_IDS.includes(division) ? division : 'eighth',
  notes: notes
    .map((note) => ({
      pitch: Math.max(0, Math.min(127, Math.round(note.pitch))),
      start: Math.max(0, Math.round(note.start)),
      length: Math.max(1, Math.round(note.length ?? PPQ / 2)),
      velocity: Math.max(1, Math.min(127, Math.round(note.velocity ?? 96))),
    }))
    // In tick order, because every consumer wants them that way and sorting
    // once here is cheaper than sorting in each of them.
    .sort((a, b) => a.start - b.start || a.pitch - b.pitch),
});

/** A track, with its slots. One slot per scene, empty to begin with. */
export const trackOf = ({
  id,
  name = id,
  instrument = 'synth',
  inserts = [],
  settings = {},
  gain = 0.8,
  pan = 0,
  send = 0,
  muted = false,
  slots = [],
} = {}) => ({
  id,
  name,
  instrument: INSTRUMENT_IDS.includes(instrument) ? instrument : 'synth',
  inserts: inserts.filter((effect) => EFFECT_IDS.includes(effect)),
  // What each insert is set to, kept whether or not that insert is on: take
  // a delay off to hear the part dry, put it back, and it is the delay you
  // dialled rather than a new one.
  settings: tidyAll(settings),
  gain,
  pan,
  send,
  muted,
  // As many slots as the track was given, or a new sketch's worth. Sized
  // from what arrives rather than from a constant, so a project saved with
  // six scenes comes back with six.
  slots: Array.from(
    { length: Math.max(1, Math.min(MOST_SCENES, slots.length || SCENES)) },
    (_, i) => (slots[i] ? clipOf(slots[i]) : null),
  ),
});

/** What key a sketch is in, which is what the editor's rows are built from. */
export const sketchKey = ({ root = 0, scale = 'minor' } = {}) => ({
  root: Number.isInteger(root) ? ((root % 12) + 12) % 12 : 0,
  scale: SCALE_IDS.includes(scale) ? scale : 'minor',
});

/** A new sketch. */
export const newProject = ({
  name = 'Untitled', bpm = 96, beats = 4, value = 4, key = {},
} = {}) => ({
  format: PROJECT_FORMAT,
  name,
  bpm,
  beats,
  value,
  key: sketchKey(key),
  scenes: Array.from({ length: SCENES }, (_, i) => ({ id: `scene-${i + 1}`, name: `${i + 1}` })),
  tracks: STARTER.map(trackOf),
});

/** How long a bar is in this project. */
export const barTicks = (project) => ticksPerBar(project.beats, project.value, PPQ);

/* --- getting at things ----------------------------------------------------- */

export const trackAt = (project, track) => project.tracks[track] ?? null;
export const clipAt = (project, track, scene) => project.tracks[track]?.slots[scene] ?? null;

/**
 * Every clip in a scene, with the track it is on.
 *
 * Which is what a scene *is*: not an object of its own but a column read
 * across the tracks. Storing it the other way round - a scene owning its
 * clips - would mean a track's clips living somewhere other than the track,
 * and every per-track operation gathering them back up.
 */
/**
 * Every track's slots made to match the scenes there are.
 *
 * The two can only disagree through a file written by another version, and
 * a track with fewer slots than there are scenes is a column of clips that
 * cannot be put anywhere.
 */
export function sized(project) {
  const count = project.scenes.length;
  return withTracks(project, project.tracks.map((track) => ({
    ...track,
    slots: Array.from({ length: count }, (_, i) => track.slots[i] ?? null),
  })));
}

/** One more scene, up to the cap. Returns the project unchanged at it. */
export function addScene(project) {
  if (project.scenes.length >= MOST_SCENES) return project;
  const at = project.scenes.length;
  return sized({
    ...project,
    scenes: [...project.scenes, { id: `scene-${at + 1}`, name: `${at + 1}` }],
  });
}

/**
 * The last scene, gone - but only when there is nothing in it.
 *
 * Nothing here deletes anybody's work by accident. A scene with a clip in
 * it has to be emptied first, which is a thing you can see yourself doing.
 */
export function dropScene(project) {
  const at = project.scenes.length - 1;
  if (at < 1 || sceneHasAnything(project, at)) return project;
  return sized({ ...project, scenes: project.scenes.slice(0, at) });
}

export const sceneOf = (project, scene) => project.tracks
  .map((track, index) => ({ track, index, clip: track.slots[scene] ?? null }))
  .filter((row) => row.clip);

/** A clip of a recording rather than of notes. */
export const isTake = (clip) => Boolean(clip?.take);

/** Is there anything in this scene at all? */
export const sceneHasAnything = (project, scene) => sceneOf(project, scene).length > 0;

/* --- changing things -------------------------------------------------------- */
//
// Every one of these returns a new project rather than changing the one it
// was given. Not for its own sake: a grid that re-renders from the project
// needs to be able to tell that something moved, and an undo later needs the
// one before. The objects are small - a project with sixteen clips of a bar
// each is a few kilobytes - so copying one is nothing.

const withTracks = (project, tracks) => ({ ...project, tracks });

const replace = (list, at, value) => list.map((item, i) => (i === at ? value : item));

/** Put a clip in a slot, or clear it with null. */
export const setClip = (project, track, scene, clip) => withTracks(project, replace(
  project.tracks,
  track,
  { ...project.tracks[track], slots: replace(project.tracks[track].slots, scene, clip ? clipOf(clip) : null) },
));

/** Change a track's settings - its name, its instrument, its fader. */
export const setTrack = (project, track, next) => withTracks(project, replace(
  project.tracks,
  track,
  trackOf({ ...project.tracks[track], ...next, slots: project.tracks[track].slots }),
));

/** Change the project's own settings. */
export const setProject = (project, next) => ({
  ...project,
  ...next,
  key: sketchKey({ ...project.key, ...(next.key ?? {}) }),
});

/** Put notes in a clip, making the clip if the slot was empty. */
export function setNotes(project, track, scene, notes, length = null) {
  const here = clipAt(project, track, scene);
  return setClip(project, track, scene, clipOf({
    ...(here ?? {}),
    length: length ?? here?.length ?? barTicks(project),
    notes,
  }));
}

/**
 * Change how long a clip is, dropping anything that no longer fits.
 *
 * Notes kept past a shortened end are notes that exist, cannot be seen, and
 * reappear when it is lengthened again - which arrives as a bug report about
 * notes coming from nowhere.
 */
export function setLength(project, track, scene, length) {
  const here = clipAt(project, track, scene);
  if (!here) return project;
  return setClip(project, track, scene, { ...here, length, notes: fit(here, length) });
}

/** What this clip does when it has been round enough times. Null keeps it looping. */
export function setFollow(project, track, scene, follow) {
  const here = clipAt(project, track, scene);
  if (!here) return project;
  return setClip(project, track, scene, { ...here, follow });
}

/* --- out of here ------------------------------------------------------------ */

/**
 * One scene, as a Type 1 MIDI file.
 *
 * A clip grid has no timeline, so an export has to be given a shape, and this
 * is the one chosen: the scene you are on, every clip in it, looped to a
 * length you pick. It is the simplest thing that is useful, it matches what
 * the sketchpad is for - a four-bar idea, not an arrangement - and it leaves
 * the other two shapes (every scene as sections, or a recorded performance of
 * launches) addable later without the file writer changing at all.
 *
 * Clips of different lengths each repeat to fill. A one-bar drum part under a
 * four-bar chord part is the commonest thing anybody sketches, and it has to
 * arrive in the DAW as four bars of both rather than one bar of one.
 *
 * Empty tracks are left out. A file full of silent tracks is a file somebody
 * has to tidy up before they can work, and tidying up is the thing this is
 * supposed to save.
 */
export function sceneToMidi(project, scene, { bars = 4 } = {}) {
  const perBar = barTicks(project);
  const total = perBar * Math.max(1, Math.round(bars));

  const tracks = sceneOf(project, scene)
    // A recording has no notes in it, and a MIDI track with nothing on it is
    // a track somebody has to delete before they can work.
    .filter(({ clip }) => !isTake(clip) && clip.notes.length)
    .map(({ track, clip }) => ({
    name: track.name,
    drums: track.instrument === 'kit',
    program: GM_PROGRAM[track.instrument] ?? undefined,
    notes: repeat(clip, total),
  }));

  return writeMidi({
    name: `${project.name}${project.scenes[scene] ? ` — scene ${project.scenes[scene].name}` : ''}`,
    bpm: project.bpm,
    beats: project.beats,
    value: project.value,
    tracks,
  });
}

/**
 * A clip's notes, repeated to fill `total` ticks.
 *
 * A note whose start falls inside the span is kept, at the tick it sounds
 * at. A note that would start exactly on the end is not: the span is
 * half-open, the same rule the transport's windows follow, and an export
 * that included it would end with a note that has nowhere to go.
 */
export function repeat(clip, total) {
  if (!clip?.notes?.length || !(clip.length > 0)) return [];

  const notes = [];
  for (let offset = 0; offset < total; offset += clip.length) {
    for (const note of clip.notes) {
      const at = offset + note.start;
      if (at >= total) continue;
      notes.push({
        pitch: note.pitch,
        start: at,
        // Trimmed at the end, so nothing hangs past the loop somebody asked
        // for. A four-bar export of a part with a long last note should be
        // four bars long.
        length: Math.max(1, Math.min(note.length, total - at)),
        velocity: note.velocity,
      });
    }
  }

  return notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}

/* --- keeping one ------------------------------------------------------------ */

/** A project, as the JSON that goes in a file or in storage. */
export const serialise = (project) => JSON.stringify(project);

/**
 * And back, from something that may be anything at all.
 *
 * A project comes off a disk or out of storage written by a version of this
 * file that may not be this one, so every field is put back through the
 * builders rather than trusted: an instrument that no longer exists becomes
 * the synth, an effect that does not becomes nothing, and a note at pitch 900
 * becomes a note at 127. Returns null rather than throwing when it is not a
 * project at all, because "that is not a sketch" is a sentence to print and
 * not an exception to catch.
 */
export function parse(text) {
  let raw;
  try {
    raw = typeof text === 'string' ? JSON.parse(text) : text;
  } catch {
    return null;
  }

  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.tracks)) return null;
  if (raw.format !== PROJECT_FORMAT) return null;

  const bpm = Number(raw.bpm);
  const scenes = Array.isArray(raw.scenes) && raw.scenes.length
    ? raw.scenes.slice(0, MOST_SCENES).map((scene, i) => ({
      id: String(scene?.id ?? `scene-${i + 1}`),
      name: String(scene?.name ?? i + 1),
    }))
    : newProject().scenes;

  return sized({
    format: PROJECT_FORMAT,
    name: String(raw.name ?? 'Untitled'),
    bpm: Number.isFinite(bpm) && bpm > 0 ? bpm : 96,
    key: sketchKey(raw.key ?? {}),
    beats: Number.isInteger(raw.beats) && raw.beats > 0 ? raw.beats : 4,
    value: [1, 2, 4, 8, 16, 32].includes(raw.value) ? raw.value : 4,
    scenes,
    tracks: raw.tracks
      .filter((track) => track && typeof track === 'object')
      .map((track, i) => trackOf({ ...track, id: String(track.id ?? `track-${i + 1}`) })),
  });
}
