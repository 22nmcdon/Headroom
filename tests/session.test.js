import test from 'node:test';
import assert from 'node:assert/strict';

import { attach, bench } from '../src/bench/session.js';
import { readingOf, stampOf, notReady } from '../src/read.js';

/**
 * A tool made of nothing but promises.
 *
 * The plan called this the most valuable new test artefact here, and the
 * reason is the risk it covers. `destroy()` has run before every mount this
 * app has ever done, so no plugin has ever had to survive a state change:
 * `lock()` had no inverse until two stages ago, `showTarget` left a ghost
 * drawn over whatever came next, and `setTarget(null)` had never been called
 * by anybody - the EQ's would have walked null as an array.
 *
 * All of that is lifecycle rather than drawing, and there are 167 tests in
 * this project that touch no DOM. So the decisions moved into `session.js`
 * and this stands in for a plugin: it records every call in order, so what is
 * asserted is not only the end state but the sequence that got there.
 */
function fakeTool({ material = { rate: 48000 }, slow = 0 } = {}) {
  const calls = [];
  const note = (name, ...args) => calls.push([name, ...args]);

  let state = { drive: 0, tone: 'flat' };
  let source = 'mix';
  let label = 'Target';
  let target = null;
  let shown = null;
  let fault = null;
  let locked = false;

  return {
    calls,
    /** What the tool looks like from outside, for the end-state assertions. */
    get now() { return { state: { ...state }, source, label, target, shown, fault, locked }; },

    state: () => ({ ...state }),
    setState(next) { note('setState', next); state = { ...state, ...next }; },

    source: () => source,
    abLabel: () => label,

    async setSource(id, opts) {
      note('setSource', id, opts);
      if (slow) await new Promise((go) => { setTimeout(go, slow); });
      source = id;
    },

    async material() {
      note('material');
      if (slow) await new Promise((go) => { setTimeout(go, slow); });
      return material;
    },

    async setFault(f) { note('setFault', f); fault = f ?? null; },
    async setTarget(t) { note('setTarget', t); target = t ?? null; },
    showTarget(t) { note('showTarget', t); shown = t ?? null; },
    nameAB(l) { note('nameAB', l); label = l; },
    lock() { note('lock'); locked = true; },
    unlock() { note('unlock'); locked = false; },

    read() {
      return readingOf({
        tool: 'fake',
        kind: 'harmonics',
        of: { state: stampOf(state), source, axis: { kind: 'harmonics', ids: [2, 3] } },
        values: { harmonics: { 2: state.drive, 3: 0 }, thd: state.drive },
      });
    },
    async readNow() { return this.read(); },
  };
}

const exerciseOf = (over = {}) => ({
  id: 'match',
  source: 'drums',
  other: 'Bypass',
  start: { drive: 6 },
  faultOf: (puzzle) => puzzle.fault ?? null,
  targetOf: (puzzle) => puzzle.answer ?? null,
  ...over,
});

/* --- putting an exercise on --------------------------------------------- */

test('an exercise arrives in an order, and the order is the point', async () => {
  const tool = fakeTool();
  const puzzle = { fault: { hz: 250 }, answer: { drive: 14 } };

  await attach(tool, exerciseOf(), puzzle);

  const order = tool.calls.map(([name]) => name);
  assert.deepEqual(order, [
    // Whatever the last exercise drew comes off before this one touches
    // anything, and the controls are freed in case it left them locked.
    'showTarget', 'unlock',
    'setSource', 'material',
    'setFault', 'setTarget', 'nameAB',
    // Last, so the one onChange a shell hears is of the finished setup rather
    // than of a tool half way through being handed over.
    'setState',
  ]);

  assert.deepEqual(tool.now.state, { drive: 6, tone: 'flat' });
  assert.equal(tool.now.source, 'drums');
  assert.equal(tool.now.label, 'Bypass');
  assert.deepEqual(tool.now.target, { drive: 14 });
  assert.equal(tool.now.locked, false);
});

test('the material is awaited and pinned, not set and hoped for', async () => {
  // What this replaces: the compression exercise filled `puzzle.material`
  // from an unawaited block, and the scorer substituted a synthetic probe
  // when it had not arrived. In a live workbench that is "marked on drums
  // while hearing noise" - a wrong answer nobody could see coming.
  const bed = { rate: 48000, samples: new Float32Array(8) };
  const tool = fakeTool({ material: bed, slow: 5 });
  const puzzle = {};

  const attaching = attach(tool, exerciseOf(), puzzle);
  assert.equal(puzzle.material, undefined, 'nothing is pinned before it has arrived');

  await attaching;
  assert.equal(puzzle.material, bed, 'and what is pinned is what was rendered');
});

test('a tool with nothing to render is not a tool that failed', async () => {
  // The reverb and the delay are built from numbers: there is no loop to
  // render and no material to pin, and that is a fact about them rather than
  // an error to handle.
  const tool = fakeTool();
  delete tool.material;
  const puzzle = {};

  await attach(tool, exerciseOf(), puzzle);
  assert.equal(puzzle.material, undefined);
  assert.equal(tool.now.state.drive, 6, 'and the exercise still went on');
});

test('an exercise with no starting settings leaves the controls where they were', async () => {
  const tool = fakeTool();
  tool.setState({ drive: 9 });
  tool.calls.length = 0;

  await attach(tool, exerciseOf({ start: null }), {});
  assert.equal(tool.now.state.drive, 9, 'a workbench does not reset your hands');
});

/* --- taking it back off -------------------------------------------------- */

test('detach puts back everything the exercise imposed, and nothing else', async () => {
  const tool = fakeTool();
  tool.setState({ drive: 3 });
  const before = tool.now;

  const detach = await attach(tool, exerciseOf(), { fault: { hz: 250 }, answer: { drive: 14 } });
  tool.lock();
  tool.showTarget({ drive: 14 });

  tool.calls.length = 0;
  await detach();

  assert.deepEqual(tool.calls.map(([name]) => name),
    ['showTarget', 'unlock', 'setTarget', 'setFault', 'nameAB', 'setSource']);

  assert.equal(tool.now.shown, null, 'no drawn answer left over the next exercise');
  assert.equal(tool.now.locked, false, 'and the controls are yours again');
  assert.equal(tool.now.target, null, 'nothing on the other side of the A/B');
  assert.equal(tool.now.fault, null, 'and the material is clean again');
  assert.equal(tool.now.label, before.label, 'the A/B is called what it was called');
  assert.equal(tool.now.source, before.source, 'and the monitor is back where it was');

  // What is NOT undone: where the controls ended up. Somebody may want to
  // keep working from the curve they just built, and a workbench that threw
  // it away the moment the exercise ended would be taking something from them.
  assert.equal(tool.now.state.drive, 6);
});

test('detaching twice is detaching once', async () => {
  const tool = fakeTool();
  const detach = await attach(tool, exerciseOf(), {});

  await detach();
  const after = tool.calls.length;
  await detach();
  assert.equal(tool.calls.length, after, 'the restore does not run again');
});

test('attach, detach, attach leaves no trace of the first', async () => {
  // The specific risk this file was written for. Nothing in this app has ever
  // reused a plugin: a round ended, the answer went up, and the whole thing
  // was destroyed a moment later, so every one of these paths is new.
  const tool = fakeTool();
  const clean = tool.now;

  const first = await attach(tool, exerciseOf({ other: 'Bypass' }),
    { fault: { hz: 250 }, answer: { drive: 14 } });
  tool.lock();
  tool.showTarget({ drive: 14 });
  await first();

  await attach(tool, exerciseOf({ id: 'fix', other: 'Dry', start: { drive: 2 } }), {});

  assert.equal(tool.now.shown, null, 'the first exercise’s answer is not still drawn');
  assert.equal(tool.now.target, null, 'nor is its A/B still loaded');
  assert.equal(tool.now.fault, null, 'nor its fault still in the material');
  assert.equal(tool.now.locked, false, 'and the controls are live');
  assert.equal(tool.now.label, 'Dry');
  assert.equal(tool.now.state.drive, 2);
  assert.equal(tool.now.state.tone, clean.state.tone, 'nothing else was touched');
});

/* --- one tool, one exercise ---------------------------------------------- */

test('the bench detaches what it is holding before it takes the next one', async () => {
  const tool = fakeTool();
  const desk = bench();

  await desk.put(tool, exerciseOf({ id: 'a', other: 'A' }), {});
  assert.equal(desk.on.exercise.id, 'a');

  tool.calls.length = 0;
  await desk.put(tool, exerciseOf({ id: 'b', other: 'B' }), {});

  const names = tool.calls.map(([name]) => name);
  // The first thing that happens is the old one coming off.
  assert.equal(names[0], 'showTarget');
  assert.equal(desk.on.exercise.id, 'b');
  assert.equal(tool.now.label, 'B');
});

test('two exercises asked for at once do not both stay on the bench', async () => {
  // The race that made this serialise. `attach` awaits a render; a dropdown
  // change arriving while the last one is still rendering would otherwise
  // start a second attach, and whichever resolved last would overwrite the
  // other's detach without ever running it - leaving everything the first
  // exercise imposed on the tool for good.
  const tool = fakeTool({ slow: 10 });
  const desk = bench();

  const a = desk.put(tool, exerciseOf({ id: 'a', other: 'A', start: { drive: 1 } }), {});
  const b = desk.put(tool, exerciseOf({ id: 'b', other: 'B', start: { drive: 2 } }), {});
  await Promise.all([a, b]);
  await desk.settled();

  assert.equal(desk.on.exercise.id, 'b');
  assert.equal(tool.now.label, 'B');
  assert.equal(tool.now.state.drive, 2);

  // And the first one really was taken off rather than merely replaced: its
  // detach ran, which the call log shows as a second teardown.
  const teardowns = tool.calls.filter(([name], i) =>
    name === 'showTarget' && tool.calls[i + 1]?.[0] === 'unlock').length;
  assert.ok(teardowns >= 2, `only ${teardowns} teardowns for two exercises`);
});

test('an exercise that cannot be set up leaves the bench empty, not half-attached', async () => {
  const tool = fakeTool();
  tool.setSource = async () => { throw new Error('no such loop'); };

  const desk = bench();
  await desk.put(tool, exerciseOf(), {});

  assert.equal(desk.on, null, 'nothing is on the bench');

  // And the next one still works: a thrown attach must not wedge the queue.
  const good = fakeTool();
  await desk.put(good, exerciseOf({ id: 'next' }), {});
  assert.equal(desk.on.exercise.id, 'next');
});

test('clearing the bench takes the exercise off', async () => {
  const tool = fakeTool();
  const desk = bench();

  await desk.put(tool, exerciseOf(), { answer: { drive: 14 } });
  tool.lock();

  await desk.clear();
  assert.equal(desk.on, null);
  assert.equal(tool.now.locked, false);
  assert.equal(tool.now.target, null);
});

/* --- a drill drives the tool's own controls ------------------------------ */

test('startOf is asked of the puzzle, and asked after the material has arrived', async () => {
  // The order is the point. A drill that asks how much a compressor is doing
  // has to set a compressor that does that much to THIS loop, and until the
  // loop exists there is nothing to work it out against.
  const tool = fakeTool({ material: { rate: 48000, samples: 'the loop' } });
  const puzzle = {};

  let sawMaterial = null;
  await attach(tool, {
    source: 'drums',
    other: 'Untreated',
    startOf: (p) => {
      sawMaterial = p.material;
      return { drive: 7, tone: 'warm' };
    },
  }, puzzle);

  assert.deepEqual(sawMaterial, { rate: 48000, samples: 'the loop' },
    'startOf was asked before the material was pinned');
  assert.deepEqual(tool.now.state, { drive: 7, tone: 'warm' });

  const order = tool.calls.map(([name]) => name);
  assert.ok(order.indexOf('material') < order.lastIndexOf('setState'),
    'the settings have to land after the material');
});

test('startOf wins over a fixed start, and a fixed start over what was there', async () => {
  const both = fakeTool();
  await attach(both, { source: 'mix', other: 'Target', start: { drive: 1 }, startOf: () => ({ drive: 9 }) });
  assert.equal(both.now.state.drive, 9);

  const fixed = fakeTool();
  await attach(fixed, { source: 'mix', other: 'Target', start: { drive: 1 } });
  assert.equal(fixed.now.state.drive, 1);

  // And an exercise that sets nothing leaves the controls where they were,
  // which is what lets somebody keep working from the curve they just built.
  const neither = fakeTool();
  neither.setState({ drive: 4 });
  await attach(neither, { source: 'mix', other: 'Target' });
  assert.equal(neither.now.state.drive, 4);
});

test('an exercise that set the controls puts them back, and one that did not does not', async () => {
  // Otherwise the next exercise opens with the last drill's answer sitting on
  // the knobs, which is the answer to a round that has just been played.
  const tool = fakeTool();
  tool.setState({ drive: 3, tone: 'flat' });

  const detach = await attach(tool, {
    source: 'mix',
    other: 'Clean',
    startOf: () => ({ drive: 11, tone: 'hot' }),
    restores: true,
  });
  assert.deepEqual(tool.now.state, { drive: 11, tone: 'hot' });

  await detach();
  assert.deepEqual(tool.now.state, { drive: 3, tone: 'flat' }, 'put back as it was found');

  // Without `restores`, somebody may want to keep working from where the
  // exercise left them, and the settings stay.
  const kept = fakeTool();
  kept.setState({ drive: 3 });
  const release = await attach(kept, { source: 'mix', other: 'Target', start: { drive: 8 } });
  await release();
  assert.equal(kept.now.state.drive, 8);
});

test('a drill still undoes everything else an exercise imposes', async () => {
  const tool = fakeTool();
  const detach = await attach(tool, {
    source: 'drums',
    other: 'Clean',
    faultOf: () => ({ uneven: 9 }),
    targetOf: () => ({ drive: 2 }),
    startOf: () => ({ drive: 11 }),
    restores: true,
  });
  tool.lock();

  await detach();
  const after = tool.now;
  assert.equal(after.fault, null);
  assert.equal(after.target, null);
  assert.equal(after.shown, null);
  assert.equal(after.locked, false);
  assert.equal(after.label, 'Target', 'the A/B gets its old name back');
  assert.equal(after.source, 'mix');
});
