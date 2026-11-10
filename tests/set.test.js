import test from 'node:test';
import assert from 'node:assert/strict';

import { pickSet, setSummary, fairRate, SET_SIZE } from '../src/learn/set.js';
import { TOOLS, drillsOf, TOOL_GROUPS, groupOf, TOOL_IDS } from '../src/learn/bench/registry.js';
import { TEACHING_ORDER } from '../src/learn/bench/path.js';

const nothing = () => ({ played: 0, right: 0 });

test('a set is ten drill questions, each one a real drill at a real tier', () => {
  const { questions } = pickSet({ record: nothing, seed: 'a' });
  assert.equal(questions.length, SET_SIZE);
  for (const q of questions) {
    assert.ok(drillsOf(q.tool).some((drill) => drill.id === q.exercise), `${q.tool}/${q.exercise}`);
    assert.ok(TOOLS[q.tool].tiers[q.tier], `${q.tool} has no tier ${q.tier}`);
  }
});

test('four tools, shared out weakest first, and never the same tool twice running', () => {
  for (const seed of ['a', 'b', 'c', 'd', 'e']) {
    const { questions, tools } = pickSet({ record: nothing, seed });
    assert.deepEqual(tools.map((t) => t.count), [3, 3, 2, 2]);
    for (let i = 1; i < questions.length; i += 1) {
      assert.notEqual(questions[i].tool, questions[i - 1].tool, `${seed}: two in a row at ${i}`);
    }
    for (const { tool, count } of tools) {
      assert.equal(questions.filter((q) => q.tool === tool).length, count);
    }
  }
});

test('a first set follows the teaching order', () => {
  const { tools } = pickSet({ record: nothing, seed: 'new' });
  assert.deepEqual(tools.slice(0, 3).map((t) => t.tool), TEACHING_ORDER.slice(0, 3));
});

test('the weak tools come first, and a strong one has to wait', () => {
  const record = (id) => ({
    reverb: { played: 10, right: 2, tier: 'medium' },
    delay: { played: 8, right: 3 },
    level: { played: 20, right: 20 },
  }[id] ?? { played: 0, right: 0 });

  const { tools, questions } = pickSet({ record, seed: 'weak' });
  assert.equal(tools[0].tool, 'reverb');
  assert.equal(tools[1].tool, 'delay');
  assert.ok(questions.filter((q) => q.tool === 'reverb').every((q) => q.tier === 'medium'),
    'asked at the tier it is being worked at');
  assert.ok(!tools.slice(0, 3).some((t) => t.tool === 'level'), 'twenty out of twenty is not a weak spot');
});

test('the same seed and the same record make the same set', () => {
  assert.deepEqual(pickSet({ record: nothing, seed: 'x' }), pickSet({ record: nothing, seed: 'x' }));
});

test('a rate with nothing behind it is a coin toss, and one round moves it only a little', () => {
  assert.equal(fairRate({}), 0.5);
  assert.ok(fairRate({ played: 1, right: 1 }) < 0.7);
  assert.ok(fairRate({ played: 1, right: 0 }) > 0.3);
  assert.ok(fairRate({ played: 40, right: 38 }) > 0.9);
});

test('a summary counts what was asked, and leaves skips out of it', () => {
  const summary = setSummary([
    { tool: 'eq', outcome: 'right' },
    { tool: 'eq', outcome: 'wrong', answer: '2k', heard: '4k' },
    { tool: 'reverb', outcome: 'skipped' },
    { tool: 'reverb', outcome: 'right' },
    { tool: 'delay', outcome: 'wrong', answer: 'dotted 1/8', heard: null },
  ]);
  assert.equal(summary.asked, 4);
  assert.equal(summary.right, 2);
  assert.equal(summary.skipped, 1);
  assert.deepEqual(summary.byTool, [
    { tool: 'eq', asked: 2, right: 1 },
    { tool: 'reverb', asked: 1, right: 1 },
    { tool: 'delay', asked: 1, right: 0 },
  ]);
  assert.deepEqual(summary.misheard, [{ tool: 'eq', answer: '2k', heard: '4k' }]);
});

test('every tool is in exactly one family', () => {
  const grouped = TOOL_GROUPS.flatMap((group) => group.tools).sort();
  assert.deepEqual(grouped, [...TOOL_IDS].sort());
  for (const id of TOOL_IDS) assert.ok(groupOf(id), id);
});
