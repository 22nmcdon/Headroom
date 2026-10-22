// Keeping a sketch.
//
// Storage is passed in, so all of this runs without a browser - including the
// cases that matter most, which are the ones where storage misbehaves.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SKETCH_KEY, loadSketch, saveSketch, forgetSketch, sketchFile, readSketchFile,
} from '../src/sketch/store.js';
import { newProject, setNotes, clipAt, PROJECT_FORMAT } from '../src/sketch/project.js';

/** A localStorage, as far as any of this is concerned. */
const shelf = (start = {}) => {
  const map = new Map(Object.entries(start));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    get size() { return map.size; },
  };
};

test('a sketch saved is a sketch loaded', () => {
  const store = shelf();
  const project = setNotes(newProject({ name: 'Thing' }), 1, 0, [{ pitch: 40, start: 0 }]);

  assert.equal(saveSketch(project, store), true);
  const back = loadSketch(store);

  assert.equal(back.name, 'Thing');
  assert.deepEqual(clipAt(back, 1, 0).notes, clipAt(project, 1, 0).notes);
});

test('nothing saved is nothing loaded, not a crash', () => {
  assert.equal(loadSketch(shelf()), null);
  assert.equal(loadSketch(null), null);
  assert.equal(loadSketch(undefined), null);
});

test('junk in the key reads as nothing', () => {
  assert.equal(loadSketch(shelf({ [SKETCH_KEY]: 'not json' })), null);
  assert.equal(loadSketch(shelf({ [SKETCH_KEY]: '{"format":99}' })), null);
});

test('storage that refuses to be written to is a false, not a throw', () => {
  const locked = {
    getItem: () => { throw new Error('blocked'); },
    setItem: () => { throw new Error('blocked'); },
    removeItem: () => { throw new Error('blocked'); },
  };

  assert.equal(saveSketch(newProject(), locked), false);
  assert.equal(loadSketch(locked), null);
  assert.doesNotThrow(() => forgetSketch(locked));
});

test('forgetting takes the key out and leaves the rest', () => {
  const store = shelf({ 'headroom.stats.v4': '{}' });
  saveSketch(newProject(), store);
  forgetSketch(store);
  assert.equal(store.getItem(SKETCH_KEY), null);
  assert.equal(store.size, 1);
});

test('a sketch as a file has a name a filesystem will take', () => {
  assert.equal(sketchFile(newProject({ name: 'Thing in 7/8?' })).name, 'thing-in-7-8.headroom.json');
  assert.equal(sketchFile(newProject({ name: '' })).name, 'sketch.headroom.json');
  assert.equal(sketchFile(newProject({ name: '???' })).name, 'sketch.headroom.json');
  assert.equal(sketchFile(newProject()).format, PROJECT_FORMAT);
});

test('a file written out reads back as the same sketch', () => {
  const project = setNotes(newProject({ name: 'Two' }), 2, 1, [{ pitch: 36, start: 0 }]);
  const back = readSketchFile(sketchFile(project).text);
  assert.deepEqual(back, project);
  assert.equal(readSketchFile('nonsense'), null);
});
