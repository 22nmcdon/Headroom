// Every tool at once: what the Progress page shows.
//
// The Stats dialog this replaces showed one tool, one tier and one kind at a
// time, so "how am I doing overall?" took thirty-odd openings of it to
// answer. This is the same buckets read into one table - tools down the side,
// each kind and tier across - and the confusions across all of them.
//
// Pure: the shell hands in how to read a bucket, and the tests hand in
// anything.

import { solvesIn } from './stats.js';

/**
 * One cell: how many rounds, and the rate that counts for that kind.
 *
 * A drill counts right first time; work counts solved without Show me, which
 * is what `won` already is, since a shown round is played and never won.
 * `rate` is null when nothing has been played, which is not the same as 0%.
 */
export function cellOf(stats, kind) {
  const played = stats?.played ?? 0;
  if (!played) return { played: 0, right: 0, rate: null };
  const right = solvesIn(stats, kind);
  return { played, right, rate: right / played };
}

/**
 * Which of the four fills a rate gets.
 *
 * Three steps of lightness as well as colour, so they read apart without
 * telling sage from rose: high from 80%, mid from 50%, low under that, and
 * none for a cell with nothing in it.
 */
export function shadeOf(rate) {
  if (rate === null || rate === undefined) return 'none';
  if (rate >= 0.8) return 'high';
  if (rate >= 0.5) return 'mid';
  return 'low';
}

/** The tiers across the top: every tier any tool has, in the order they come. */
export function tiersOf(tools) {
  const all = [];
  for (const tool of tools) {
    for (const tier of tool.tiers) if (!all.includes(tier)) all.push(tier);
  }
  return all;
}

/**
 * The table: one row per tool, and per kind a cell per tier.
 *
 * `tools` is `[{ id, tiers: [...] }]`; `statsOf(id, tier, kind)` reads a
 * bucket. A tier the tool does not have is `null` rather than an empty cell,
 * because "not tried" and "not there" are different things to show.
 */
export function reportRows({ tools, statsOf, kinds = ['drill', 'work'] }) {
  const tiers = tiersOf(tools);
  return tools.map((tool) => ({
    id: tool.id,
    cells: kinds.flatMap((kind) => tiers.map((tier) => (tool.tiers.includes(tier)
      ? { kind, tier, ...cellOf(statsOf(tool.id, tier, kind), kind) }
      : null))),
  }));
}

/**
 * What keeps being heard as what, across every drill bucket.
 *
 * The first answer of a drill is the one made before any reading came back,
 * so it is the only one that says what the ear did on its own - and the
 * stats keep it, per kind of answer, as `confused`. This is the commonest of
 * them anywhere: more than once, because once is a slip.
 */
export function confusions({ tools, statsOf, limit = 3 }) {
  const found = [];
  for (const tool of tools) {
    for (const tier of tool.tiers) {
      const stats = statsOf(tool.id, tier, 'drill');
      for (const [key, kind] of Object.entries(stats?.byAnswer ?? {})) {
        for (const [heardKey, heard] of Object.entries(kind.confused ?? {})) {
          if (heard.n < 2) continue;
          found.push({
            tool: tool.id, tier, key, label: kind.label ?? key, seen: kind.seen,
            heard: heard.label ?? heardKey, n: heard.n,
          });
        }
      }
    }
  }
  // By how many times first, then by how much of the time: with a handful of
  // rounds behind each, three times out of five is more to go on than two out
  // of three.
  return found
    .sort((a, b) => b.n - a.n || b.n / b.seen - a.n / a.seen)
    .slice(0, limit);
}
