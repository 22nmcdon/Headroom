// Where a sketch lives when the tab is closed.
//
// The same bargain as the stats: one key, this browser, no account and no
// server. A sketch is a few kilobytes of JSON, so it is saved on every edit
// rather than behind a button - nobody should lose an idea to a reload - and
// the way out is a file, because the only copy of anything here is in one
// browser's storage.
//
// Storage is passed in rather than reached for, so this is testable without a
// browser and survives a browser that refuses it. Private windows and
// storage-full both throw on write, and losing a sketch is bad while a
// sketchpad that will not open at all is worse.

import { PROJECT_FORMAT, parse, serialise } from './project.js';

export const SKETCH_KEY = 'headroom.sketch.v1';

const shelf = () => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // a browser with storage switched off
  }
};

/** The sketch that was open, or nothing. */
export function loadSketch(store = shelf()) {
  try {
    const raw = store?.getItem(SKETCH_KEY);
    return raw ? parse(raw) : null;
  } catch {
    return null;
  }
}

/** Keep it. Returns whether it got there, for anything that wants to say so. */
export function saveSketch(project, store = shelf()) {
  try {
    store?.setItem(SKETCH_KEY, serialise(project));
    return Boolean(store);
  } catch {
    return false;
  }
}

/** Forget it. */
export function forgetSketch(store = shelf()) {
  try {
    store?.removeItem(SKETCH_KEY);
  } catch { /* nothing to forget */ }
}

/**
 * A sketch as a file, and a name for it.
 *
 * The name carries the project's own, cut down to what a filesystem will
 * take: a sketch called "Thing in 7/8?" should not arrive as a download the
 * browser refuses to save.
 */
export const sketchFile = (project) => ({
  name: `${slug(project.name) || 'sketch'}.headroom.json`,
  text: serialise(project),
  format: PROJECT_FORMAT,
});

const slug = (name) => String(name ?? '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 40);

/** And back. Null when the file is not a sketch, which is a sentence to print. */
export const readSketchFile = (text) => parse(text);
