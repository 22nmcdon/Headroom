// A set: ten drill questions, mixed across tools, then a line on how it went.
//
// Drills used to run on for as long as you kept pressing "another one", on
// one tool at a time. That is a good way to work at one thing and a poor way
// to find out what you can hear: a run of the same question tells you about
// the last minute rather than about your ear, and with nothing to finish
// there is nothing to say at the end. A set is short, it mixes tools, and it
// stops.
//
// Which tools is weighted toward the weak ones, read off the same buckets the
// stats keep. Not a streak and not a daily: nothing here counts days, and a
// set can be started as often as anybody likes.
//
// Pure, like the path: the shell hands in what has been played, and the
// tests can hand in anything.

import { TOOL_IDS, drillsOf } from './bench/registry.js';
import { TEACHING_ORDER } from './bench/path.js';
import { mulberry32, hashSeed } from '../lib/random.js';

/** How many questions a set asks. */
export const SET_SIZE = 10;

/** How many tools a set draws on: the weakest few, and one other. */
export const SET_WEAKEST = 3;

/**
 * How well a tool's drills are going, as a rate that is fair to a tool with
 * few rounds behind it.
 *
 * One right out of one is not 100%, and one wrong out of one is not 0%: the
 * count is pulled toward a coin toss by one of each, so a tool never played
 * reads 50%, a tool tried once sits either side of it, and a long record
 * reads as what it is. Which is what puts a new user's first set in teaching
 * order, and an experienced one's on what they keep getting wrong.
 */
export const fairRate = ({ played = 0, right = 0 } = {}) => (right + 1) / (played + 2);

/** The tools that have drills, in teaching order. */
const DRILLED = TEACHING_ORDER.filter((id) => TOOL_IDS.includes(id) && drillsOf(id).length);

/**
 * Pick a set.
 *
 * `record(tool)` says what has been played on that tool's drills, across every
 * tier: `{ played, right, tier }`, where `tier` is the one to ask at. `seed`
 * makes the set; the same seed and the same record is the same set.
 *
 * Returns the questions in the order they are asked, and the tools behind
 * them with how many each - which is what the page says before it starts.
 */
export function pickSet({ record, seed, size = SET_SIZE }) {
  const rng = mulberry32(hashSeed(String(seed)));
  const pick = (list) => list[Math.floor(rng() * list.length)];

  const ranked = DRILLED
    .map((id, order) => ({ id, order, rate: fairRate(record(id)), tier: record(id).tier ?? 'easy' }))
    .sort((a, b) => a.rate - b.rate || a.order - b.order);

  const chosen = ranked.slice(0, SET_WEAKEST);
  const rest = ranked.slice(SET_WEAKEST);
  if (rest.length) chosen.push(pick(rest));

  // Shared out, weakest first: ten over four is 3, 3, 2, 2.
  const each = Math.floor(size / chosen.length);
  const over = size - each * chosen.length;
  const tools = chosen.map((tool, i) => ({ tool: tool.id, tier: tool.tier, count: each + (i < over ? 1 : 0) }));

  // Interleaved rather than in blocks: the next question is from whichever
  // tool has most left, never the one just asked if anything else is left.
  // Switching is the point - it is how a set measures the ear rather than
  // the last thirty seconds.
  const left = tools.map((tool) => ({ ...tool, left: tool.count }));
  const questions = [];
  let last = null;
  while (questions.length < size && left.some((tool) => tool.left > 0)) {
    const open = left.filter((tool) => tool.left > 0);
    const fresh = open.filter((tool) => tool.tool !== last);
    const from = fresh.length ? fresh : open;
    const most = Math.max(...from.map((tool) => tool.left));
    const next = pick(from.filter((tool) => tool.left === most));
    next.left -= 1;
    last = next.tool;
    questions.push({ tool: next.tool, tier: next.tier, exercise: pick(drillsOf(next.tool)).id });
  }

  return { questions, tools: tools.map(({ tool, count }) => ({ tool, count })) };
}

/**
 * How a finished set went.
 *
 * `results` is one entry per question: `{ tool, outcome, answer, heard }`,
 * where the outcome is 'right' (first time, no hint), 'wrong' (anything
 * else that was answered) or 'skipped'. A skip is not a wrong answer: it was
 * not asked, and it is left out of the count rather than held against you.
 */
export function setSummary(results) {
  const asked = results.filter((result) => result.outcome !== 'skipped');
  const byTool = [];
  for (const result of asked) {
    let entry = byTool.find((one) => one.tool === result.tool);
    if (!entry) byTool.push(entry = { tool: result.tool, asked: 0, right: 0 });
    entry.asked += 1;
    if (result.outcome === 'right') entry.right += 1;
  }

  return {
    asked: asked.length,
    right: asked.filter((result) => result.outcome === 'right').length,
    skipped: results.length - asked.length,
    byTool,
    // What was heard instead, where the drill can say: the thing worth
    // listening for next time.
    misheard: asked
      .filter((result) => result.outcome === 'wrong' && result.heard)
      .map(({ tool, answer, heard }) => ({ tool, answer, heard })),
  };
}
