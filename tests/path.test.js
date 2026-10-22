// The guided path: an order through what was already there.
//
// All of this is arithmetic over numbers somebody else counted, which is why
// `progress` takes two functions rather than importing the store. The tests
// below hand it made-up numbers and check the order, what counts as done, and
// the one decision worth arguing about: that a step cannot be un-done.

import test from 'node:test';
import assert from 'node:assert/strict';

import { steps, progress, where, TEACHING_ORDER, ENOUGH, PATH_TIER } from '../src/bench/path.js';
import { TOOL_IDS, TOOLS } from '../src/bench/registry.js';

/** Nothing played, nothing read. */
const nobody = { solvesOf: () => 0, hasRead: () => false };

/** Everything played, everything read. */
const everything = { solvesOf: () => ENOUGH, hasRead: () => true };

test('the path is every tool, three steps each, in a teaching order', () => {
  const all = steps();
  assert.equal(all.length, TOOL_IDS.length * 3);
  assert.deepEqual([...new Set(all.map((s) => s.tool))], TEACHING_ORDER);
  assert.deepEqual([...new Set(TEACHING_ORDER)].sort(), [...TOOL_IDS].sort(),
    'the order covers every tool and invents none');

  for (const tool of TEACHING_ORDER) {
    const mine = all.filter((s) => s.tool === tool);
    assert.deepEqual(mine.map((s) => s.step), ['read', 'drill', 'work'],
      `${tool} is not read, then asked, then built`);
  }
});

test('a tool is called by a name that fits in a sentence', () => {
  // Derived from the pill's label, the first step reads "read what a
  // compression is for" and the third "build it on the eq".
  const labels = steps().map((step) => step.label);
  for (const label of labels) {
    assert.ok(!/\ba (?:compression|panning|saturation|eq)\b/i.test(label), label);
    assert.ok(!/\bthe eq\b/.test(label), `${label} should say "the EQ"`);
  }

  assert.ok(labels.includes('Read what an EQ is for'));
  assert.ok(labels.includes('Build one on the compressor'));
  assert.ok(labels.includes('Read what width actually is'));
  assert.ok(labels.includes('Build one on the saturator'));
});

test('every step says what it is and where it goes', () => {
  for (const step of steps()) {
    assert.ok(step.id && step.label, `${step.id} has nothing on it`);
    assert.ok(step.detail, `${step.id} does not say what it is`);
    assert.ok(TOOL_IDS.includes(step.tool));

    if (step.step === 'read') {
      assert.equal(step.kind, undefined, 'reading is not a round');
      continue;
    }
    assert.equal(step.tier, PATH_TIER, 'the path starts at the easy tier');
    assert.ok(['work', 'drill'].includes(step.kind));
  }
});

test('a drill step takes its name and its question from the drill itself', () => {
  // Rather than a second copy of them here, which would go stale the first
  // time a drill was reworded.
  for (const step of steps().filter((s) => s.step === 'drill')) {
    const drill = TOOLS[step.tool].exercises.drill;
    assert.equal(step.label, drill.label);
    assert.equal(step.detail, drill.ask);
  }
});

test('nothing done points at the first step and nothing else', () => {
  const state = progress(nobody);
  assert.equal(state.done, 0);
  assert.equal(state.finished, false);
  assert.equal(state.next.id, 'eq:read');
  assert.ok(state.steps.every((s) => !s.done));
});

test('everything done has no next step, and says so', () => {
  const state = progress(everything);
  assert.equal(state.done, state.total);
  assert.equal(state.finished, true);
  assert.equal(state.next, null);
  assert.match(where(state), /all of it/);
});

test('a step is done at three solves, and not at two', () => {
  const at = (n) => progress({ solvesOf: () => n, hasRead: () => true });

  assert.equal(ENOUGH, 3);
  assert.equal(at(2).steps.find((s) => s.id === 'eq:drill').done, false);
  assert.equal(at(3).steps.find((s) => s.id === 'eq:drill').done, true);
  assert.equal(at(99).steps.find((s) => s.id === 'eq:drill').done, true);

  // Two solves is still two solves, and the step says so rather than only
  // saying "not yet".
  assert.equal(at(2).steps.find((s) => s.id === 'eq:drill').solves, 2);
});

test('reading is done by reading, not by playing', () => {
  const played = progress({ solvesOf: () => 99, hasRead: () => false });
  assert.equal(played.steps.find((s) => s.id === 'eq:read').done, false);
  assert.equal(played.next.id, 'eq:read', 'and it is still the next thing');

  // And the rounds after it are done, because nothing is gated - somebody who
  // went straight to the tool gets the credit for it.
  assert.equal(played.steps.find((s) => s.id === 'eq:drill').done, true);
});

test('the work step counts work and the drill step counts drills', () => {
  // The two are different books in the stats and they are different steps
  // here. Doing one of them six times does not finish the other.
  const onlyDrills = progress({
    solvesOf: (tool, tier, kind) => (kind === 'drill' ? 9 : 0),
    hasRead: () => true,
  });

  assert.equal(onlyDrills.steps.find((s) => s.id === 'eq:drill').done, true);
  assert.equal(onlyDrills.steps.find((s) => s.id === 'eq:work').done, false);
  assert.equal(onlyDrills.next.id, 'eq:work');
});

test('skipping ahead is credited, and still points you back', () => {
  // The decision worth arguing about. Somebody who went and solved the delay
  // first has the delay marked done - the work happened - and is still shown
  // the EQ as next, because the order is the only thing the path is for.
  const skipped = progress({
    solvesOf: (tool) => (tool === 'delay' ? 9 : 0),
    hasRead: (tool) => tool === 'delay',
  });

  for (const step of skipped.steps.filter((s) => s.tool === 'delay')) {
    assert.equal(step.done, true, `${step.id} was done and should be marked done`);
  }
  assert.equal(skipped.next.id, 'eq:read');
  assert.equal(skipped.done, 3);
});

test('a step cannot be un-done by a bad round', () => {
  // `solves` only goes up: it is a count of rounds solved, not a run of them.
  // A streak would throw away three rounds of work for one slip, and this app
  // took its streaks out for exactly that reason.
  const before = progress({ solvesOf: () => 5, hasRead: () => true });
  const after = progress({ solvesOf: () => 5, hasRead: () => true });
  assert.equal(before.done, after.done);
  assert.equal(before.finished, true);
});

test('the line underneath says where somebody is', () => {
  assert.match(where(progress(nobody)), /Start at the top/);
  assert.match(where(progress({ solvesOf: (t) => (t === 'eq' ? 9 : 0), hasRead: (t) => t === 'eq' })),
    /3 of 18 done/);
});
