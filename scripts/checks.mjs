// The browser checks: which there are, how long each takes, and how they are
// split across machines. Kept apart from browser-check.mjs, which starts a
// browser the moment it is imported, so that tests/checks.test.js can hold
// the list to the files in tests/browser/ and the split to the list.
//
// One machine ran all of them in about nineteen minutes, and four of the
// forty-odd checks are half of that. Split by count, two of those four can
// land on the same machine and that machine is the run; split by time, the
// slowest machine is about a quarter of the whole. So each check carries how
// long it took, and the split balances those.

/** Every check, in the order a plain run takes them. */
export const CHECKS = ['faces', 'inserts', 'chain', 'tracks', 'cells', 'pads', 'keys', 'wide', 'shape',
  'knobs', 'decks', 'eq-curve', 'restate', 'trim', 'stereo', 'tone', 'order', 'sampler', 'sides', 'align',
  'modulation', 'match', 'carve', 'depth', 'arrange', 'listen', 'fix', 'ride', 'damage', 'said', 'root',
  'turned', 'drills', 'work', 'analysis', 'mic', 'wave', 'export', 'journey', 'phone', 'fades',
  'lifecycle', 'arrive', 'nudge'];

/**
 * Runnable by name, and left out of a plain run until they pass: a check
 * written ahead of the fix it is for, which moves into CHECKS once the code
 * meets it. Empty: `lifecycle` was the last, and every player meets it now.
 */
export const PENDING = [];

/**
 * Seconds each check took on a GitHub runner, from the log of a full run
 * (run 191, 6 November 2026). Only the balance is read from these, so they
 * need to be roughly right rather than exactly - a check that gets twice as
 * slow should be updated here, one that drifts by a few seconds need not.
 */
export const SECONDS = {
  faces: 29, inserts: 19, chain: 19, tracks: 21, cells: 18, pads: 36, keys: 7,
  wide: 7, shape: 10, knobs: 7, decks: 93, 'eq-curve': 6, restate: 3, trim: 3,
  stereo: 2, tone: 37, order: 7, sampler: 6, sides: 7, align: 1, modulation: 1,
  match: 55, carve: 38, depth: 27, arrange: 14, listen: 6, fix: 19, ride: 20,
  damage: 6, said: 8, root: 11, turned: 15, drills: 84, work: 55, analysis: 11,
  mic: 50, wave: 7, export: 15, journey: 173, phone: 16, fades: 7,
  lifecycle: 159, arrive: 3, nudge: 20,
};

/** What a check nobody has timed yet is assumed to take: about the median. */
export const UNTIMED = 15;

/**
 * Every check put in exactly one of `count` shards, the slowest first, each
 * onto whichever shard is lightest so far - the usual greedy split, which
 * lands within a few percent of even for a list like this one.
 *
 * Deterministic, because every machine works its own share out separately
 * and they must all agree on it: ties go by name, and nothing depends on
 * the order the list arrives in.
 */
export function shardsOf(checks, count) {
  const n = Math.max(1, Math.floor(count));
  const shards = Array.from({ length: n }, () => ({ checks: [], seconds: 0 }));
  const slowest = [...checks].sort((a, b) =>
    (SECONDS[b] ?? UNTIMED) - (SECONDS[a] ?? UNTIMED) || a.localeCompare(b));
  for (const check of slowest) {
    const lightest = shards.reduce((best, shard, i) =>
      (shard.seconds < shards[best].seconds ? i : best), 0);
    shards[lightest].checks.push(check);
    shards[lightest].seconds += SECONDS[check] ?? UNTIMED;
  }
  return shards;
}

/**
 * `--shard=2/4` as `{ index: 1, count: 4 }`, or null when there is none. One-
 * based on the command line, the way CI matrices count; nought-based here.
 */
export function shardArgument(args) {
  const given = args.find((arg) => arg.startsWith('--shard='));
  if (!given) return null;
  const match = /^--shard=(\d+)\/(\d+)$/.exec(given);
  const index = match ? Number(match[1]) : NaN;
  const count = match ? Number(match[2]) : NaN;
  if (!(count >= 1 && index >= 1 && index <= count)) {
    throw new Error(`--shard wants N/COUNT with 1 <= N <= COUNT, not "${given.slice(8)}"`);
  }
  return { index: index - 1, count };
}
