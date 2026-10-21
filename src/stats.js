// Local-only persistence: no accounts, no server (per the MVP plan).
import { toolOf } from './bench/registry.js';

// v3: the daily went, so a bucket is no longer per-daily-or-practice, and the
// streak went with it. Neither an old store's keys nor its streaks could be
// carried over - half of a v2 store's buckets were the daily's, and merging
// them into practice would be adding up two different measurements - so a v2
// store is read as nothing, the way v1 was.
const KEY = 'headroom.stats.v3';

/**
 * How many attempts it took, in bands rather than in rows.
 *
 * What was here was an array as long as the most guesses any tier allowed,
 * indexed by the count. Without a ceiling there is no length to give it - so
 * the top band is open, and the lower ones are narrow where the difference
 * matters. Arriving in two rather than nine is the clearest signal of
 * improvement this app has; arriving in eleven rather than fourteen is not a
 * signal at all.
 */
export const ATTEMPT_BANDS = [
  { id: '1', label: '1', from: 1, to: 1 },
  { id: '2', label: '2', from: 2, to: 2 },
  { id: '3', label: '3', from: 3, to: 3 },
  { id: '4-5', label: '4-5', from: 4, to: 5 },
  { id: '6-9', label: '6-9', from: 6, to: 9 },
  { id: '10+', label: '10+', from: 10, to: Infinity },
];

/** Which band an attempt count falls in. */
export const attemptBand = (attempts) =>
  ATTEMPT_BANDS.find((band) => attempts >= band.from && attempts <= band.to)
  ?? ATTEMPT_BANDS[ATTEMPT_BANDS.length - 1];

/**
 * No streak, and no best streak.
 *
 * A streak is a scarcity mechanic: it means something when there is one puzzle
 * a day and missing it costs you the run. Here you can start another round
 * immediately, so a streak measures nothing but how recently you chose an easy
 * tier - and it punishes the thing this app is for, which is working on the
 * band you keep getting wrong. `byAnswer` is the honest version of the same
 * question.
 */
function emptyBucket() {
  return {
    played: 0,
    won: 0,
    attempts: Object.fromEntries(ATTEMPT_BANDS.map((band) => [band.id, 0])),
    byAnswer: {}, // what the mode counts as one kind of answer -> { seen, solved, label }
  };
}

function emptyStore() {
  // `imported` is the ids of the progress files already taken in, so that
  // pressing import twice on the same file does not count it twice.
  return { buckets: {}, imported: [] };
}

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw);
    return {
      buckets: parsed.buckets ?? {},
      imported: Array.isArray(parsed.imported) ? parsed.imported : [],
    };
  } catch {
    return emptyStore();
  }
}

function write(store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* private mode / quota — stats are a nicety, never block play */
  }
}

/** Two things decide a bucket: which mode, and which tier. */
const bucketKey = (mode, tier) => `${mode}:${tier}`;

/**
 * A stored bucket, with anything it is missing filled in.
 *
 * A bucket comes back from a browser's storage, which is to say from a version
 * of this file that may not be this one. Reading a field that was added since
 * it was written should give a zero, not throw on the way to drawing a chart.
 */
const fill = (stored) => ({
  ...emptyBucket(),
  ...stored,
  attempts: { ...emptyBucket().attempts, ...(stored?.attempts ?? {}) },
  byAnswer: { ...(stored?.byAnswer ?? {}) },
});

export function getStats(mode, tier) {
  const store = read();
  return fill(store.buckets[bucketKey(mode, tier)]);
}

/**
 * Record a finished round.
 *
 * Finished means solved, or given up on and shown. A round being shown counts
 * as played and never as solved, and its attempts are not banded: it did not
 * take five attempts to get there, it took five attempts and then the answer.
 * Keeping that straight here is what lets the mastery table mean something
 * later, without a flag having to be invented for it.
 */
export function recordGame(game) {
  const { puzzle, guesses, status } = game;
  if (status === 'playing') return getStats(puzzle.mode, puzzle.tier);

  const store = read();
  const key = bucketKey(puzzle.mode, puzzle.tier);
  const bucket = fill(store.buckets[key]);

  bucket.played += 1;
  // What counts as "one kind of answer" is the mode's to say: a band of
  // trouble, a kind of room, how hard something is driven.
  const kind = toolOf(puzzle.mode).weak(puzzle);
  const perKind = bucket.byAnswer[kind.key] ?? { seen: 0, solved: 0, label: kind.label };
  perKind.seen += 1;

  if (status === 'solved') {
    bucket.won += 1;
    bucket.attempts[attemptBand(guesses.length).id] += 1;
    perKind.solved += 1;
  }

  bucket.byAnswer[kind.key] = perKind;
  store.buckets[key] = bucket;
  write(store);
  return bucket;
}

/**
 * The "you keep missing the mud band" line, for whichever tool is showing:
 * surface the worst kind of answer once there is enough data for it to mean
 * anything.
 */
export function weakestKind(stats, minSeen = 3) {
  let worst = null;
  for (const [key, { seen, solved, label }] of Object.entries(stats.byAnswer)) {
    if (seen < minSeen) continue;
    const rate = solved / seen;
    if (!worst || rate < worst.rate) worst = { key, rate, seen, label };
  }
  if (!worst || worst.rate >= 0.9) return null;
  return worst;
}

export function resetStats() {
  write(emptyStore());
}

/* --- carrying progress between browsers ---------------------------------- */

// The whole of this app's memory is one key in one browser's localStorage,
// which is a copy of a kind that clearing site data takes with it. There is no
// account to sync to and there is not going to be one, so what there is
// instead is a file: write it out, keep it where you keep things, read it back
// into whatever browser you are in next.
//
// The number is this file's store shape, and it is the same number as the `v3`
// in KEY. A file says which shape it is in so that a future version can refuse
// one it does not understand rather than reading halfway down it.
export const PROGRESS_FORMAT = 3;

/** An id for one export, so that importing it twice is caught. */
const newId = () => (globalThis.crypto?.randomUUID?.()
  ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

/** Everything this browser knows, as a plain object ready to be a file. */
export function exportProgress(now = new Date()) {
  return {
    app: 'headroom',
    format: PROGRESS_FORMAT,
    id: newId(),
    exported: new Date(now).toISOString(),
    buckets: read().buckets,
  };
}

/**
 * A count, out of a file somebody chose off their disk.
 *
 * Everything in an import is read through this. A progress file is not hostile
 * input in the usual sense - there is no server and nothing to escalate to -
 * but it is a file, and a `NaN` that gets into a bucket spreads to every sum
 * the bucket is ever in and prints as `NaN%` with no clue where it came from.
 */
const count = (value) => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

/** Add one stored bucket into another, count by count. */
function mergeBucket(into, from) {
  const bucket = fill(into);

  bucket.played += count(from?.played);
  // Never more wins than games: `solved %` is won/played and the dialog prints
  // it as a percentage, so a file claiming nine wins in one game would read
  // 900%. The same holds per kind of answer.
  bucket.won = Math.min(bucket.played, bucket.won + count(from?.won));

  for (const band of ATTEMPT_BANDS) {
    bucket.attempts[band.id] += count(from?.attempts?.[band.id]);
  }

  for (const [key, kind] of Object.entries(from?.byAnswer ?? {})) {
    const mine = bucket.byAnswer[key] ?? { seen: 0, solved: 0, label: key };
    mine.seen += count(kind?.seen);
    mine.solved = Math.min(mine.seen, mine.solved + count(kind?.solved));
    // The label is the tool's own word for this kind of answer - 'mud',
    // 'harshness'. Keep the one already here; take the file's only if there
    // was none, because this browser's is the one its tool wrote.
    mine.label = bucket.byAnswer[key]?.label ?? (typeof kind?.label === 'string' ? kind.label : key);
    bucket.byAnswer[key] = mine;
  }

  return bucket;
}

/**
 * Read a progress file into this browser, adding to what is here.
 *
 * Adding rather than replacing, because the case this is for is the same
 * person on a phone and on a laptop: neither half is the real one. Into an
 * empty browser - a restore, the other case - adding and replacing are the
 * same thing, so one button does both and neither can lose anything.
 *
 * Returns `{ok, reason}` rather than throwing. Every way this fails is
 * somebody having picked the wrong file, which is a sentence to print under
 * the button and not an exception.
 */
export function importProgress(file) {
  if (!file || typeof file !== 'object') {
    return { ok: false, reason: 'That is not a progress file.' };
  }
  if (file.app !== 'headroom') {
    return { ok: false, reason: 'That file is not from Headroom.' };
  }
  if (file.format !== PROGRESS_FORMAT) {
    return {
      ok: false,
      reason: `That file is in format ${file.format ?? '?'}; this version reads ${PROGRESS_FORMAT}.`,
    };
  }
  if (!file.buckets || typeof file.buckets !== 'object') {
    return { ok: false, reason: 'That file has no progress in it.' };
  }

  const store = read();
  if (file.id && store.imported.includes(file.id)) {
    return { ok: false, reason: 'That file has already been imported into this browser.' };
  }

  // Only buckets this app could have written. A key of any other shape is a
  // bucket for a tool or tier that does not exist, and keeping it would mean
  // carrying it forward for ever in every later export.
  let buckets = 0;
  for (const [key, bucket] of Object.entries(file.buckets)) {
    const [mode, tier] = key.split(':');
    if (!mode || !tier || key.split(':').length !== 2) continue;
    store.buckets[key] = mergeBucket(store.buckets[key], bucket);
    buckets += 1;
  }

  if (file.id) store.imported = [...store.imported, file.id].slice(-50);
  write(store);
  return { ok: true, buckets };
}
