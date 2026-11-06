// The list of browser checks, and the split CI runs them in.
//
// A check left off the list never runs, and nothing says so: it is a file
// in tests/browser/ that looks exactly like one that is covered. Split
// across machines it gets worse, because a check the split drops is missing
// from every machine at once and each of them is green. So the list is held
// to the files, and the split to the list.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import {
  CHECKS, PENDING, SECONDS, UNTIMED, shardsOf, shardArgument,
} from '../scripts/checks.mjs';

const BROWSER = new URL('./browser/', import.meta.url);

test('every check in tests/browser/ is on the list, and nothing on the list is missing', async () => {
  const files = (await readdir(BROWSER))
    .filter((file) => file.endsWith('.mjs') && file !== 'harness.mjs')
    .map((file) => file.slice(0, -'.mjs'.length))
    .sort();
  assert.deepEqual([...CHECKS, ...PENDING].sort(), files);
});

test('no check is listed twice', () => {
  const all = [...CHECKS, ...PENDING];
  assert.equal(new Set(all).size, all.length);
});

test('every check has a time, and every time has a check', () => {
  // A check without one is split as if it took UNTIMED seconds, which is
  // fine for a quick one and throws the balance for a slow one - so a new
  // check gets its time written down the first time CI runs it.
  assert.deepEqual(CHECKS.filter((check) => !(check in SECONDS)), []);
  assert.deepEqual(Object.keys(SECONDS).filter((check) => !CHECKS.includes(check)), []);
});

test('however many machines, every check runs on exactly one of them', () => {
  for (let count = 1; count <= 8; count += 1) {
    const shards = shardsOf(CHECKS, count);
    assert.equal(shards.length, count);
    const ran = shards.flatMap((shard) => shard.checks);
    assert.deepEqual([...ran].sort(), [...CHECKS].sort(), `${count} shards`);
  }
});

test('the split is the same whatever order the list arrives in', () => {
  const reversed = shardsOf([...CHECKS].reverse(), 4).map((shard) => [...shard.checks].sort());
  const forwards = shardsOf(CHECKS, 4).map((shard) => [...shard.checks].sort());
  assert.deepEqual(reversed, forwards);
});

test('four shards come out within a tenth of an even split', () => {
  const shards = shardsOf(CHECKS, 4);
  const total = CHECKS.reduce((sum, check) => sum + (SECONDS[check] ?? UNTIMED), 0);
  const slowest = Math.max(...shards.map((shard) => shard.seconds));
  assert.ok(slowest <= (total / 4) * 1.1, `slowest shard ${slowest} s of ${total} s`);
});

test('--shard is read one-based and refused when it makes no sense', () => {
  assert.deepEqual(shardArgument(['--shard=1/4']), { index: 0, count: 4 });
  assert.deepEqual(shardArgument(['faces', '--shard=4/4']), { index: 3, count: 4 });
  assert.equal(shardArgument(['faces']), null);
  for (const bad of ['--shard=0/4', '--shard=5/4', '--shard=2', '--shard=a/b', '--shard=1/0']) {
    assert.throws(() => shardArgument([bad]), /--shard/, bad);
  }
});
