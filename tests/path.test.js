// The guided path: an order through what was already there.
//
// All of this is arithmetic over numbers somebody else counted, which is why
// `progress` takes two functions rather than importing the store. The tests
// below hand it made-up numbers and check the order, what counts as done, and
// the one decision worth arguing about: that a step cannot be un-done.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  steps, progress, where, TEACHING_ORDER, ENOUGH, ENOUGH_MIXES, PATH_TIER,
} from '../src/learn/bench/path.js';
import { TOOL_IDS, TOOLS } from '../src/learn/bench/registry.js';

/**
 * The tool the path opens on, taken from the order rather than typed in.
 *
 * These tests are about "the first step" and not about any one tool, and
 * three of them said `eq:read` until the curriculum put level in front of it.
 * A reorder is a decision somebody makes in path.js; it should not read here
 * as a broken path.
 */
const FIRST = TEACHING_ORDER.find((id) => TOOL_IDS.includes(id));

/** Nothing played, nothing read. */
const nobody = { solvesOf: () => 0, hasRead: () => false };

/** Everything played, everything read. */
const everything = { solvesOf: () => ENOUGH, hasRead: () => true };

test('the path is every tool, three steps each, in a teaching order', () => {
  const all = steps();
  const tools = all.filter((step) => step.tool);

  assert.equal(tools.length, TOOL_IDS.length * 3);
  assert.deepEqual([...new Set(tools.map((s) => s.tool))], TEACHING_ORDER);
  assert.deepEqual([...new Set(TEACHING_ORDER)].sort(), [...TOOL_IDS].sort(),
    'the order covers every tool and invents none');

  for (const tool of TEACHING_ORDER) {
    const mine = tools.filter((s) => s.tool === tool);
    assert.deepEqual(mine.map((s) => s.step), ['read', 'drill', 'work'],
      `${tool} is not read, then asked, then built`);
  }
});

test('and then one step that is not about a single tool at all', () => {
  const all = steps();
  const last = all[all.length - 1];

  assert.equal(last.step, 'mix');
  assert.equal(last.tool, null, 'the mix belongs to no tool');
  assert.equal(last.kind, 'mix');
  assert.equal(last.enough, ENOUGH_MIXES);
  // One, not three: a mix round is four parts and several submits, and the
  // point of it here is the moment the six become one job.
  assert.ok(ENOUGH_MIXES < ENOUGH);
  assert.equal(all.filter((step) => step.step === 'mix').length, 1);
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
    assert.ok(step.tool === null || TOOL_IDS.includes(step.tool));

    if (step.step === 'read') {
      assert.equal(step.kind, undefined, 'reading is not a round');
      continue;
    }
    assert.equal(step.tier, PATH_TIER, 'the path starts at the easy tier');
    assert.ok(['work', 'drill', 'mix'].includes(step.kind));
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
  assert.equal(state.next.id, `${FIRST}:read`);
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
  assert.equal(played.steps.find((s) => s.id === `${FIRST}:read`).done, false);
  assert.equal(played.next.id, `${FIRST}:read`, 'and it is still the next thing');

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
  assert.equal(onlyDrills.next.id, `${FIRST}:work`);
});

test('skipping ahead is credited, and still points you back', () => {
  // The decision worth arguing about. Somebody who went and solved the delay
  // first has the delay marked done - the work happened - and is still shown
  // the first step as next, because the order is the only thing the path is
  // for.
  const skipped = progress({
    solvesOf: (tool) => (tool === 'delay' ? 9 : 0),
    hasRead: (tool) => tool === 'delay',
  });

  for (const step of skipped.steps.filter((s) => s.tool === 'delay')) {
    assert.equal(step.done, true, `${step.id} was done and should be marked done`);
  }
  assert.equal(skipped.next.id, `${FIRST}:read`);
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
  const total = steps().length;
  assert.match(where(progress(nobody)), /Start at the top/);
  // Three steps done out of however many the curriculum has, which is three
  // a tool plus the mix - so the number moves whenever a tool is added and is
  // counted here rather than typed in.
  assert.match(where(progress({ solvesOf: (t) => (t === 'eq' ? 9 : 0), hasRead: (t) => t === 'eq' })),
    new RegExp(`3 of ${total} done`));
});

test('the mix step is done after one match, not three', () => {
  const read = { hasRead: () => true };

  // Everything else finished, the mix not started.
  const nearly = progress({ ...read, solvesOf: (tool) => (tool === 'mix' ? 0 : ENOUGH) });
  assert.equal(nearly.finished, false);
  assert.equal(nearly.next.step, 'mix');

  const done = progress({ ...read, solvesOf: () => ENOUGH_MIXES });
  assert.equal(done.steps[done.steps.length - 1].done, true);

  // And one match is enough even though one solve is not enough for a tool.
  const one = progress({ ...read, solvesOf: () => 1 });
  assert.equal(one.steps[one.steps.length - 1].done, true);
  assert.equal(one.steps.find((step) => step.step === 'work').done, false);
});

test('the mix step is looked up under its own name, not a tools', () => {
  // It has no tool, so whatever `solvesOf` is handed has to be something
  // the stats can find - and the mix bucket is keyed by the kind.
  const asked = [];
  progress({
    hasRead: () => true,
    solvesOf: (tool, tier, kind) => { asked.push(`${tool}:${tier}:${kind}`); return 0; },
  });
  assert.ok(asked.includes(`mix:${PATH_TIER}:mix`), asked.join(' '));
});
