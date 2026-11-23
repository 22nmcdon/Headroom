import test from 'node:test';
import assert from 'node:assert/strict';

import { cellOf, shadeOf, tiersOf, reportRows, confusions } from '../src/learn/report.js';

const bucket = (played, won, first = won, byAnswer = {}) => ({
  played, won, attempts: { 1: first, 2: won - first }, byAnswer,
});

test('a drill cell counts right first time; a work cell counts solved', () => {
  // Nine played, seven solved, four of them on the first answer.
  const stats = bucket(9, 7, 4);
  assert.deepEqual(cellOf(stats, 'drill'), { played: 9, right: 4, rate: 4 / 9 });
  assert.deepEqual(cellOf(stats, 'work'), { played: 9, right: 7, rate: 7 / 9 });
});

test('nothing played is no rate at all, not 0%', () => {
  assert.equal(cellOf(bucket(0, 0), 'drill').rate, null);
  assert.equal(cellOf(undefined, 'work').rate, null);
  assert.equal(shadeOf(null), 'none');
});

test('three shades and an empty one, split at 80% and 50%', () => {
  assert.equal(shadeOf(1), 'high');
  assert.equal(shadeOf(0.8), 'high');
  assert.equal(shadeOf(0.79), 'mid');
  assert.equal(shadeOf(0.5), 'mid');
  assert.equal(shadeOf(0.49), 'low');
  assert.equal(shadeOf(0), 'low');
});

test('every tier any tool has goes across the top, and a tool without one shows a gap', () => {
  const tools = [
    { id: 'eq', tiers: ['easy', 'medium', 'hard'] },
    { id: 'delay', tiers: ['easy', 'medium', 'hard', 'expert'] },
  ];
  assert.deepEqual(tiersOf(tools), ['easy', 'medium', 'hard', 'expert']);

  const rows = reportRows({ tools, statsOf: () => bucket(2, 1) });
  assert.equal(rows[0].cells.length, 8, 'four tiers, two kinds');
  assert.equal(rows[0].cells[3], null, 'the EQ has no expert tier');
  assert.equal(rows[1].cells[3].tier, 'expert');
  assert.deepEqual(rows[0].cells.map((cell) => cell?.kind ?? null),
    ['drill', 'drill', 'drill', null, 'work', 'work', 'work', null]);
});

test('confusions are the ones heard more than once, the most telling first', () => {
  const stats = {
    'eq:easy:drill': bucket(10, 4, 4, {
      'octave-2k': { seen: 5, solved: 2, label: '2k (honk)', confused: {
        'octave-4k': { n: 3, label: '4k (presence)' },
        'octave-1k': { n: 1, label: '1k (nasal)' },
      } },
    }),
    'delay:easy:drill': bucket(6, 3, 3, {
      dotted: { seen: 3, solved: 1, label: 'dotted eighth', confused: {
        eighth: { n: 2, label: 'an eighth' },
      } },
    }),
  };
  const found = confusions({
    tools: [{ id: 'eq', tiers: ['easy'] }, { id: 'delay', tiers: ['easy'] }],
    statsOf: (id, tier, kind) => stats[`${id}:${tier}:${kind}`],
  });

  assert.equal(found.length, 2, 'once is a slip, and is left out');
  assert.equal(found[0].label, '2k (honk)', 'three times beats twice');
  assert.equal(found[0].heard, '4k (presence)');
  assert.equal(found[1].heard, 'an eighth');
});
