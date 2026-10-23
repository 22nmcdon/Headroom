// A sketch, as data - and the one thing it is all pointed at, which is
// leaving as a file a DAW will open.
//
// All of this is pure, so the export can be checked the way the exporter's
// own tests check it: write the file, read it back with the reader, and
// compare. What is tested here on top of that is the shape of the decision -
// one scene, every clip in it, looped to a length you pick - and the awkward
// cases that shape creates: clips of different lengths under each other, a
// note that would land exactly on the end, and a long note at the edge.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  newProject, clipOf, trackOf, setClip, setTrack, setNotes, setProject,
  clipAt, trackAt, sceneOf, sceneHasAnything, barTicks, repeat,
  sceneToMidi, serialise, parse, PROJECT_FORMAT, SCENES, setLength,
  addScene, dropScene, MOST_SCENES, STARTER, setFollow, followOf, MOST_PASSES, keyRoutes,
} from '../src/sketch/project.js';
import { readMidi, PPQ, DRUM_CHANNEL } from '../src/sketch/midi.js';
import { INSTRUMENT_IDS } from '../src/core/instrument.js';

const BAR = PPQ * 4;

const beats = (pitch, n = 4) => Array.from({ length: n }, (_, i) => ({
  pitch, start: i * PPQ, length: PPQ / 2, velocity: 90,
}));

/* --- the shape -------------------------------------------------------------- */

test('a new sketch is the starter tracks and four scenes, with nothing in them', () => {
  const project = newProject();

  assert.equal(project.format, PROJECT_FORMAT);
  assert.equal(project.scenes.length, SCENES);
  assert.equal(project.tracks.length, STARTER.length);
  assert.deepEqual(project.tracks.map((t) => t.instrument),
    ['piano', 'bass', 'kit', 'synth', 'voice']);

  for (const track of project.tracks) {
    assert.equal(track.slots.length, SCENES, 'one slot per scene');
    assert.ok(track.slots.every((slot) => slot === null), 'and all of them empty');
  }
});

test('a scene is a column read across the tracks, not an object of its own', () => {
  // Which is why there is no `scenes[i].clips`: a track's clips live on the
  // track, and a scene is the index. Stored the other way round, every
  // per-track operation would have to gather them back up.
  let project = newProject();
  project = setNotes(project, 0, 1, beats(60));
  project = setNotes(project, 2, 1, beats(36));

  assert.equal(sceneOf(project, 0).length, 0);
  assert.equal(sceneOf(project, 1).length, 2);
  assert.deepEqual(sceneOf(project, 1).map((row) => row.index), [0, 2]);
  assert.equal(sceneHasAnything(project, 1), true);
  assert.equal(sceneHasAnything(project, 3), false);
});

test('a clip fills in what it is not told', () => {
  const clip = clipOf({ notes: [{ pitch: 60, start: 0 }] });
  assert.ok(clip.id, 'and gets an id of its own');
  assert.equal(clip.length, BAR);
  assert.equal(clip.notes[0].velocity, 96);
  assert.ok(clip.notes[0].length > 0);
});

test('a clip keeps its notes in tick order, whatever order they arrived in', () => {
  const clip = clipOf({
    notes: [
      { pitch: 67, start: PPQ * 2 },
      { pitch: 60, start: 0 },
      { pitch: 64, start: PPQ },
    ],
  });
  assert.deepEqual(clip.notes.map((n) => n.start), [0, PPQ, PPQ * 2]);
});

test('a note outside what MIDI holds is brought back inside it', () => {
  const clip = clipOf({ notes: [{ pitch: 900, start: -40, velocity: 500, length: -3 }] });
  assert.equal(clip.notes[0].pitch, 127);
  assert.equal(clip.notes[0].start, 0);
  assert.equal(clip.notes[0].velocity, 127);
  assert.ok(clip.notes[0].length >= 1);
});

test('an instrument or an effect that does not exist does not get stored', () => {
  const track = trackOf({ id: 't', instrument: 'theremin', inserts: ['eq', 'chorus'] });
  assert.equal(track.instrument, 'synth', 'and falls back to something that does');
  assert.deepEqual(track.inserts, ['eq']);
  assert.ok(INSTRUMENT_IDS.includes(track.instrument));
});

/* --- changing one ----------------------------------------------------------- */

test('every change hands back a new project and leaves the old one alone', () => {
  // Not for its own sake: a grid that re-renders from the project has to be
  // able to tell that something moved, and an undo later needs the one
  // before.
  const before = newProject();
  const after = setNotes(before, 0, 0, beats(60));

  assert.equal(clipAt(before, 0, 0), null, 'the one it was given is untouched');
  assert.ok(clipAt(after, 0, 0));
  assert.notEqual(before.tracks, after.tracks);
  assert.equal(before.tracks[1], after.tracks[1], 'and the tracks that did not change are shared');
});

test('a slot can be emptied as well as filled', () => {
  let project = setNotes(newProject(), 1, 2, beats(48));
  assert.ok(clipAt(project, 1, 2));

  project = setClip(project, 1, 2, null);
  assert.equal(clipAt(project, 1, 2), null);
  assert.equal(sceneHasAnything(project, 2), false);
});

test('a track keeps its clips when its settings change', () => {
  // The obvious way to write `setTrack` rebuilds the track from the settings
  // and loses the slots with it.
  let project = setNotes(newProject(), 3, 0, beats(72));
  project = setTrack(project, 3, { name: 'Lead', gain: 0.4, inserts: ['delay'] });

  assert.equal(trackAt(project, 3).name, 'Lead');
  assert.equal(trackAt(project, 3).gain, 0.4);
  assert.deepEqual(trackAt(project, 3).inserts, ['delay']);
  assert.equal(clipAt(project, 3, 0).notes.length, 4, 'and the clip is still there');
});

test('the project carries its own tempo and signature', () => {
  const project = setProject(newProject(), { bpm: 128, beats: 6, value: 8 });
  assert.equal(project.bpm, 128);
  assert.equal(barTicks(project), PPQ * 3, 'six eighths is three quarters');
});

/* --- looping a clip to fill -------------------------------------------------- */

test('a clip repeats to fill the length asked for', () => {
  const clip = clipOf({ length: BAR, notes: beats(36) });
  const notes = repeat(clip, BAR * 4);

  assert.equal(notes.length, 16, 'four beats, four bars');
  assert.deepEqual(notes.slice(0, 5).map((n) => n.start), [0, PPQ, PPQ * 2, PPQ * 3, BAR]);
  assert.equal(notes[notes.length - 1].start, BAR * 4 - PPQ);
});

test('a note that would land exactly on the end is not included', () => {
  // The span is half-open, the same rule the transport's windows follow. A
  // note starting where the export stops has nowhere to go.
  const clip = clipOf({ length: BAR, notes: [{ pitch: 60, start: 0, length: 10 }] });
  assert.deepEqual(repeat(clip, BAR * 2).map((n) => n.start), [0, BAR]);
  assert.deepEqual(repeat(clip, BAR).map((n) => n.start), [0]);
});

test('a note running past the end is trimmed to it', () => {
  // A four-bar export of a part with a long last note should be four bars
  // long, not four bars and a bit.
  const clip = clipOf({ length: BAR, notes: [{ pitch: 60, start: PPQ * 3, length: BAR }] });
  const notes = repeat(clip, BAR * 2);

  assert.equal(notes.length, 2);
  assert.equal(notes[1].start + notes[1].length, BAR * 2, 'the last one ends on the line');
  assert.ok(notes.every((n) => n.start + n.length <= BAR * 2));
});

test('an empty clip repeats to nothing rather than to an error', () => {
  assert.deepEqual(repeat(clipOf({ length: BAR }), BAR * 4), []);
  assert.deepEqual(repeat(null, BAR * 4), []);
  assert.deepEqual(repeat(clipOf({ length: 0, notes: beats(60) }), BAR), []);
});

/* --- out of here ------------------------------------------------------------- */

test('a scene exports as a Type 1 file with one track per part', () => {
  let project = setProject(newProject({ name: 'A sketch' }), { bpm: 120 });
  project = setNotes(project, 0, 0, beats(60));
  project = setNotes(project, 2, 0, beats(36));

  const file = readMidi(sceneToMidi(project, 0, { bars: 2 }));

  assert.equal(file.format, 1);
  assert.equal(file.tracks.length, 2, 'the two that have something in them');
  assert.deepEqual(file.tracks.map((t) => t.name), ['Piano', 'Kit']);
  assert.ok(Math.abs(file.bpm - 120) < 0.01);
  assert.match(file.name, /A sketch/);
});

test('an empty track is left out, because tidying up is what this is meant to save', () => {
  const project = setNotes(newProject(), 1, 0, beats(40));
  const file = readMidi(sceneToMidi(project, 0));

  assert.equal(file.tracks.length, 1);
  assert.equal(file.tracks[0].name, 'Bass');
});

test('the kit goes out on channel 10 and everything else gets its own', () => {
  let project = setNotes(newProject(), 0, 0, beats(60));
  project = setNotes(project, 2, 0, beats(36));
  project = setNotes(project, 3, 0, beats(72));

  const file = readMidi(sceneToMidi(project, 0));
  const kit = file.tracks.find((t) => t.name === 'Kit');

  assert.equal(kit.channel, DRUM_CHANNEL);
  const others = file.tracks.filter((t) => t.name !== 'Kit').map((t) => t.channel);
  assert.equal(new Set(others).size, others.length, 'and no two share one');
  assert.ok(!others.includes(DRUM_CHANNEL));
});

test('clips of different lengths each loop to fill, which is the whole point', () => {
  // A one-bar drum part under a four-bar chord part is the commonest thing
  // anybody sketches, and it has to arrive as four bars of both.
  let project = newProject();
  project = setNotes(project, 0, 0, [{ pitch: 60, start: 0, length: BAR * 4 }], BAR * 4);
  project = setNotes(project, 2, 0, [{ pitch: 36, start: 0, length: 20 }], BAR);

  const file = readMidi(sceneToMidi(project, 0, { bars: 4 }));
  const piano = file.tracks.find((t) => t.name === 'Piano');
  const kit = file.tracks.find((t) => t.name === 'Kit');

  assert.equal(piano.notes.length, 1, 'the four-bar part plays once');
  assert.equal(kit.notes.length, 4, 'and the one-bar part four times');
  assert.deepEqual(kit.notes.map((n) => n.start).sort((a, b) => a - b),
    [0, BAR, BAR * 2, BAR * 3]);
});

test('exporting a scene with nothing in it is a file, not a crash', () => {
  const file = readMidi(sceneToMidi(newProject(), 2));
  assert.equal(file.format, 1);
  assert.equal(file.tracks.length, 0);
  assert.ok(file.bpm > 0);
});

/* --- keeping one -------------------------------------------------------------- */

test('a project survives being written out and read back', () => {
  let project = newProject({ name: 'Keep me', bpm: 112 });
  project = setNotes(project, 0, 1, beats(64));
  project = setTrack(project, 0, { name: 'Keys', gain: 0.55, pan: -0.4, inserts: ['eq', 'reverb'] });

  const back = parse(serialise(project));

  assert.equal(back.name, 'Keep me');
  assert.equal(back.bpm, 112);
  assert.equal(back.tracks[0].name, 'Keys');
  assert.equal(back.tracks[0].gain, 0.55);
  assert.deepEqual(back.tracks[0].inserts, ['eq', 'reverb']);
  assert.deepEqual(back.tracks[0].slots[1].notes, project.tracks[0].slots[1].notes);
  assert.equal(back.tracks[0].slots[0], null);
});

test('something that is not a project reads as nothing rather than throwing', () => {
  // It came off somebody's disk. "That is not a sketch" is a sentence to
  // print, not an exception to catch.
  for (const junk of [null, '', 'not json', '{}', '[]', '{"tracks":3}', JSON.stringify({ tracks: [] })]) {
    assert.equal(parse(junk), null, `${junk} was accepted`);
  }
});

test('a project from a format this version does not know is refused', () => {
  const future = { ...newProject(), format: PROJECT_FORMAT + 1 };
  assert.equal(parse(JSON.stringify(future)), null);
});

test('a project with nonsense in it loads with the nonsense taken out', () => {
  const loaded = parse(JSON.stringify({
    format: PROJECT_FORMAT,
    name: 42,
    bpm: -5,
    beats: 0,
    value: 7,
    scenes: null,
    tracks: [
      { id: 'a', instrument: 'didgeridoo', inserts: ['eq', 'phaser'], slots: [{ notes: [{ pitch: 'x', start: 0 }] }] },
      'not a track',
      null,
    ],
  }));

  assert.equal(loaded.name, '42');
  assert.equal(loaded.bpm, 96, 'a tempo that is not a tempo becomes one');
  assert.equal(loaded.beats, 4);
  assert.equal(loaded.value, 4);
  assert.equal(loaded.scenes.length, SCENES);
  assert.equal(loaded.tracks.length, 1, 'and the things that are not tracks are dropped');
  assert.equal(loaded.tracks[0].instrument, 'synth');
  assert.deepEqual(loaded.tracks[0].inserts, ['eq']);
});

test('a sketch is in a key, and nonsense in it reads as the default', () => {
  assert.deepEqual(newProject().key, { root: 0, scale: 'minor' });
  assert.deepEqual(newProject({ key: { root: 14, scale: 'major' } }).key, { root: 2, scale: 'major' });
  assert.deepEqual(newProject({ key: { scale: 'lydian-ish' } }).key, { root: 0, scale: 'minor' });

  // And setting half of it leaves the other half alone.
  const moved = setProject(newProject({ key: { root: 7, scale: 'dorian' } }), { key: { root: 5 } });
  assert.deepEqual(moved.key, { root: 5, scale: 'dorian' });
});

test('a clip remembers the grid it was drawn on', () => {
  assert.equal(clipOf().division, 'eighth');
  assert.equal(clipOf({ division: 'sixteenth' }).division, 'sixteenth');
  assert.equal(clipOf({ division: 'quavers please' }).division, 'eighth');
});

test('a key survives being written out and read back', () => {
  const key = { root: 3, scale: 'pentatonic' };
  assert.deepEqual(parse(serialise(newProject({ key }))).key, key);
  // And a project written before keys existed gets the default rather than
  // nothing, so the editor always has rows to draw.
  const old = JSON.parse(serialise(newProject()));
  delete old.key;
  assert.deepEqual(parse(old).key, { root: 0, scale: 'minor' });
});

test('shortening a clip through the project drops what no longer fits', () => {
  const bar = barTicks(newProject());
  let project = setNotes(newProject(), 0, 0, [
    { pitch: 60, start: 0, length: PPQ },
    { pitch: 62, start: bar, length: PPQ },
  ], bar * 2);

  project = setLength(project, 0, 0, bar);
  assert.equal(clipAt(project, 0, 0).length, bar);
  assert.deepEqual(clipAt(project, 0, 0).notes.map((note) => note.pitch), [60]);

  // An empty slot is left as it is rather than given a clip.
  assert.equal(clipAt(setLength(project, 1, 3, bar), 1, 3), null);
});

test('a sketch can hold more scenes than it opens with, up to a cap', () => {
  let project = newProject();
  assert.equal(project.scenes.length, SCENES);

  project = addScene(addScene(project));
  assert.equal(project.scenes.length, SCENES + 2);
  assert.deepEqual(project.scenes.map((scene) => scene.name), ['1', '2', '3', '4', '5', '6']);

  // Every track grows with it, or a column of clips has nowhere to go.
  for (const track of project.tracks) assert.equal(track.slots.length, SCENES + 2);

  let big = newProject();
  for (let i = 0; i < 40; i += 1) big = addScene(big);
  assert.equal(big.scenes.length, MOST_SCENES);
  assert.equal(addScene(big), big, 'at the cap it hands back the same project');
});

test('the last scene can go, but not while there is anything in it', () => {
  let project = addScene(newProject());
  project = setNotes(project, 0, 4, [{ pitch: 60, start: 0 }]);

  assert.equal(dropScene(project), project, 'a scene with a clip in it is kept');

  project = setClip(project, 0, 4, null);
  const gone = dropScene(project);
  assert.equal(gone.scenes.length, SCENES);
  for (const track of gone.tracks) assert.equal(track.slots.length, SCENES);

  // And the first one is never taken away, however empty it is.
  let bare = newProject();
  for (let i = 0; i < 10; i += 1) bare = dropScene(bare);
  assert.equal(bare.scenes.length, 1);
});

test('more scenes than it opens with survive being written out and read back', () => {
  let project = addScene(addScene(addScene(newProject())));
  project = setNotes(project, 2, 6, [{ pitch: 36, start: 0 }]);

  const back = parse(serialise(project));
  assert.equal(back.scenes.length, 7);
  assert.equal(back.tracks[2].slots.length, 7);
  assert.equal(clipAt(back, 2, 6).notes.length, 1);
});

test('a file whose tracks and scenes disagree is made to agree', () => {
  // Which can only come from another version, and leaves a column of clips
  // that nothing can put anywhere.
  const project = addScene(addScene(newProject()));
  const raw = JSON.parse(serialise(project));
  raw.tracks[1].slots = raw.tracks[1].slots.slice(0, 2);
  raw.tracks[3].slots.push(null, null, null);

  const back = parse(raw);
  for (const track of back.tracks) assert.equal(track.slots.length, back.scenes.length);
});

test('a clip loops for ever unless it is told not to', () => {
  // The default is the thing a clip grid is for: keep a loop going while
  // you work on the next thing.
  assert.equal(clipOf().follow, null);
  assert.equal(followOf(null), null);
  assert.equal(followOf({ after: 0 }), null);
  assert.equal(followOf({ after: -2, then: 'next' }), null);
  assert.equal(followOf({ after: 'soon' }), null);
});

test('a follow is clamped to something the grid can actually do', () => {
  assert.deepEqual(followOf({ after: 3, then: 'first' }), { after: 3, then: 'first' });
  assert.deepEqual(followOf({ after: 500, then: 'stop' }), { after: MOST_PASSES, then: 'stop' });
  assert.deepEqual(followOf({ after: 2.4, then: 'next' }), { after: 2, then: 'next' });
  // Something a later version added, read by this one.
  assert.deepEqual(followOf({ after: 2, then: 'somewhere else' }), { after: 2, then: 'next' });
});

test('a follow goes on a clip and survives being written out', () => {
  let project = setNotes(newProject(), 1, 0, [{ pitch: 40, start: 0 }]);
  project = setFollow(project, 1, 0, { after: 4, then: 'first' });

  assert.deepEqual(clipAt(project, 1, 0).follow, { after: 4, then: 'first' });
  assert.deepEqual(parse(serialise(project)).tracks[1].slots[0].follow,
    { after: 4, then: 'first' });

  // And it comes off again.
  assert.equal(clipAt(setFollow(project, 1, 0, null), 1, 0).follow, null);
  // An empty slot has nothing to put one on.
  assert.equal(setFollow(project, 3, 2, { after: 1, then: 'next' }), project);
});


/** A sketch with a compressor on every track, keyed as the table says. */
const keyed = (links) => ({
  tracks: Object.entries(links).map(([id, keyFrom]) => ({
    id, inserts: ['compression'], settings: { compression: { keyFrom } },
  })),
});

test('a side chain is wired where it can be, and refused where it would loop', () => {
  // The ordinary case: the bass ducks under the kit.
  const plain = keyRoutes(keyed({ kit: null, bass: 'kit' }));
  assert.deepEqual(plain.kept, [{ track: 1, from: 0 }]);
  assert.deepEqual(plain.dropped, []);

  // Each keyed from the other is a cycle in the audio graph, which Web
  // Audio does not refuse - it quietly produces nothing - so it is refused
  // here. The first one written keeps its key.
  const loop = keyRoutes(keyed({ kit: 'bass', bass: 'kit' }));
  assert.deepEqual(loop.kept, [{ track: 0, from: 1 }]);
  assert.equal(loop.dropped.length, 1);
  assert.equal(loop.dropped[0].why, 'a loop');

  // A longer one, which is the case a per-track check would miss.
  const round = keyRoutes(keyed({ a: 'c', b: 'a', c: 'b' }));
  assert.equal(round.kept.length, 2);
  assert.equal(round.dropped.length, 1);
  assert.equal(round.dropped[0].why, 'a loop');

  // Keyed from itself, and keyed from a track that is not there.
  const silly = keyRoutes(keyed({ kit: 'kit', bass: 'tuba' }));
  assert.deepEqual(silly.kept, []);
  assert.deepEqual(silly.dropped.map((each) => each.why), ['itself', 'gone']);
});

test('a key with no compressor to feed is not a route', () => {
  const none = {
    tracks: [
      { id: 'kit', inserts: [], settings: {} },
      { id: 'bass', inserts: [], settings: { compression: { keyFrom: 'kit' } } },
    ],
  };
  assert.deepEqual(keyRoutes(none).kept, []);
  assert.deepEqual(keyRoutes({}).kept, []);
});
