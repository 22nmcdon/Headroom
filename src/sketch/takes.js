// Where a recording lives.
//
// A sketch is a few kilobytes of JSON and goes in localStorage with
// everything else. A take is not: four bars of mono audio is half a megabyte
// before anything else is in there, and localStorage is a handful of
// megabytes for the whole origin. So the takes go in IndexedDB, which is
// meant for this, and the project keeps nothing but the id of each one.
//
// Stored as WAV bytes rather than as raw samples, for two reasons: the
// writer already exists and is tested, and a blob that is a file anybody can
// open is a blob that can be handed straight to a download or to
// `decodeAudioData` without a second format in between.
//
// Everything here resolves rather than throwing. A browser in a private
// window may refuse IndexedDB outright, and a sketchpad that will not open
// because it cannot find a database is worse than one that has forgotten a
// recording.

import { writeWav } from './wav.js';

export const DB_NAME = 'headroom';
export const DB_VERSION = 1;
export const TAKES = 'takes';

let opening = null;

/** The database, opened once and kept. Null when this browser will not. */
function open() {
  if (opening) return opening;

  opening = new Promise((done) => {
    let request;
    try {
      if (typeof indexedDB === 'undefined') { done(null); return; }
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      done(null);
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TAKES)) db.createObjectStore(TAKES, { keyPath: 'id' });
    };
    request.onsuccess = () => done(request.result);
    request.onerror = () => done(null);
    request.onblocked = () => done(null);
  });

  return opening;
}

/** One transaction, as a promise, with every way it can fail ending in null. */
function run(mode, work) {
  return open().then((db) => {
    if (!db) return null;
    return new Promise((done) => {
      let request;
      try {
        request = work(db.transaction(TAKES, mode).objectStore(TAKES));
      } catch {
        done(null);
        return;
      }
      request.onsuccess = () => done(request.result ?? true);
      request.onerror = () => done(null);
    });
  });
}

/** A name for a take, which is also its filename and its key. */
export const takeId = () => `take-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/**
 * Keep a take. `channels` is what an AudioBuffer hands over.
 *
 * Returns the id, or null if this browser would not store it - which the
 * caller needs to know, because a clip pointing at a take that is not there
 * is a clip that plays nothing after a reload.
 */
export async function putTake(id, channels, rate, { name = '' } = {}) {
  const bytes = writeWav(channels, rate);
  const seconds = Math.min(...channels.map((channel) => channel.length)) / rate;

  const ok = await run('readwrite', (store) => store.put({
    id, name, rate, seconds, bytes, made: Date.now(),
  }));

  return ok ? id : null;
}

/** A take, or null. */
export const getTake = (id) => run('readonly', (store) => store.get(id));

/** Every take there is, newest first, for saying what is taking up room. */
export const allTakes = () => run('readonly', (store) => store.getAll())
  .then((takes) => (takes && Array.isArray(takes)
    ? takes.map(({ bytes, ...rest }) => ({ ...rest, size: bytes?.byteLength ?? bytes?.length ?? 0 }))
      .sort((a, b) => b.made - a.made)
    : []));

export const dropTake = (id) => run('readwrite', (store) => store.delete(id));

/**
 * Everything no clip points at any more, gone.
 *
 * Taking a clip out of a slot does not delete its take, because putting it
 * back should find it again. So the tidying happens here, when something
 * asks: a take nothing in the project refers to is a take nothing will ever
 * play.
 */
export async function sweepTakes(project) {
  const wanted = new Set();
  for (const track of project?.tracks ?? []) {
    for (const slot of track.slots ?? []) if (slot?.take) wanted.add(slot.take);
  }

  const takes = await allTakes();
  const gone = [];
  for (const take of takes) {
    if (!wanted.has(take.id)) { await dropTake(take.id); gone.push(take.id); }
  }
  return gone;
}

/**
 * A take, decoded, ready to play.
 *
 * `decodeAudioData` wants its own copy of the bytes: it detaches the buffer
 * it is given, and a take decoded twice from the same stored array would
 * come back empty the second time.
 */
export async function loadTake(ctx, id) {
  const take = await getTake(id);
  if (!take?.bytes) return null;

  const bytes = take.bytes instanceof Uint8Array ? take.bytes : new Uint8Array(take.bytes);
  const copy = bytes.slice().buffer;

  return new Promise((done) => {
    try {
      ctx.decodeAudioData(copy, done, () => done(null));
    } catch {
      done(null);
    }
  });
}
