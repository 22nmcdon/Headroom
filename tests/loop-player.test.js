// The shared player base, against a fake engine whose renders take as long
// as a test says - which is the only way to make the races it exists to stop
// happen on purpose, rather than one run in five on a busy machine.

import test from 'node:test';
import assert from 'node:assert/strict';
import { LoopPlayer } from '../src/lib/loop-player.js';

/** A node that remembers what was done to it. */
const node = (kind) => ({
  kind, wired: [], started: false, stopped: false, gone: false,
  gain: { value: 1, setTargetAtTime(v) { this.value = v; } },
  connect(to) { this.wired.push(to); return to; },
  disconnect() { this.gone = true; this.wired = []; },
  start() { this.started = true; },
  stop() { if (!this.started) throw new Error('not started'); this.stopped = true; },
});

/** An engine whose renders resolve when the test lets them. */
function fakeEngine() {
  const made = [];
  const pending = [];
  const ctx = {
    currentTime: 0,
    sampleRate: 48000,
    createBufferSource() { const n = node('source'); made.push(n); return n; },
    createGain() { const n = node('gain'); made.push(n); return n; },
  };
  return {
    ctx,
    made,
    ensure: () => ctx,
    renderLoop: (id) => new Promise((resolve) => pending.push({ id, resolve })),
    /** Let the oldest waiting render (or the one for `id`) finish. */
    finish(id) {
      const at = id ? pending.findIndex((p) => p.id === id) : 0;
      const [p] = pending.splice(at, 1);
      p.resolve({ id: p.id, duration: 2, length: 96000, sampleRate: 48000, numberOfChannels: 1 });
    },
    get waiting() { return pending.map((p) => p.id); },
  };
}

class Plain extends LoopPlayer {
  constructor(engine, options) {
    super(engine, options);
    this.raised = 0;
  }

  async raise(ctx) {
    this.raised += 1;
    await Promise.resolve();
    this.input = this.own(ctx.createGain());
  }
}

const tick = () => new Promise((resolve) => setImmediate(resolve));
const sounding = (player) => [...player.sources].filter((s) => s.started && !s.stopped);

test('the graph is built once, however many ask at the same moment', async () => {
  const engine = fakeEngine();
  const player = new Plain(engine);
  await Promise.all([player.build(), player.build(), player.build()]);
  assert.equal(player.raised, 1);
  assert.equal(player.ready, true);
});

test('a double tap on Play leaves one loop sounding, not two', async () => {
  const engine = fakeEngine();
  const player = new Plain(engine, { source: 'drums' });
  const first = player.play();
  const second = player.play();
  await tick();
  engine.finish();
  // A play overtaken by a newer one waits for nothing the newer one does not.
  while (engine.waiting.length) { await tick(); engine.finish(); }
  const results = await Promise.all([first, second]);
  assert.deepEqual(results.filter(Boolean).length, 1, 'exactly one of the two played');
  assert.equal(sounding(player).length, 1);
  assert.equal(engine.made.filter((n) => n.kind === 'source' && n.started && !n.stopped).length, 1,
    'and nothing it started is sounding outside what it knows about');
});

test('stop while a play is still waiting means nothing starts', async () => {
  const engine = fakeEngine();
  const player = new Plain(engine);
  const playing = player.play();
  player.stop();
  await tick();
  // Overtaken before it got as far as asking for the loop, so there is no
  // render to wait for at all.
  assert.deepEqual(engine.waiting, []);
  assert.equal(await playing, false);
  assert.equal(player.playing, false);
  assert.equal(engine.made.filter((n) => n.kind === 'source').length, 0);
});

test('a new sample while playing replaces the old one rather than playing under it', async () => {
  const engine = fakeEngine();
  const player = new Plain(engine, { source: 'drums' });
  const playing = player.play();
  await tick();
  engine.finish('drums');
  await playing;
  const old = sounding(player);
  assert.equal(old.length, 1);

  const swapped = player.setSource('bass');
  await tick();
  engine.finish('bass');
  await swapped;
  assert.equal(old[0].stopped, true, 'the old loop stopped');
  assert.equal(sounding(player).length, 1);
  assert.equal(sounding(player)[0].buffer.id, 'bass');
});

test('of two samples picked in quick succession, the later is the one heard', async () => {
  const engine = fakeEngine();
  const player = new Plain(engine, { source: 'drums' });
  const playing = player.play();
  await tick();
  engine.finish('drums');
  await playing;

  const a = player.setSource('bass');
  const b = player.setSource('keys');
  // The later render lands first, and the earlier one after it - which must
  // not put the earlier sample back.
  engine.finish('keys');
  await b;
  engine.finish('bass');
  await a;
  assert.equal(player.buffer.id, 'keys');
  assert.equal(sounding(player).length, 1);
  assert.equal(sounding(player)[0].buffer.id, 'keys');
});

test('a fault changed while playing is heard at once', async () => {
  const engine = fakeEngine();
  class Faulty extends Plain {
    bake(loop, fault) { return { ...loop, id: `${loop.id}+${fault.name}` }; }
  }
  const player = new Faulty(engine, { source: 'drums' });
  const playing = player.play();
  await tick();
  engine.finish();
  await playing;
  const faulted = player.setFault({ name: 'hot' });
  await tick();
  engine.finish();
  await faulted;
  assert.equal(sounding(player)[0].buffer.id, 'drums+hot');
});

test('destroy takes down every node it was given and every source it started', async () => {
  const engine = fakeEngine();
  const player = new Plain(engine);
  const playing = player.play();
  await tick();
  engine.finish();
  await playing;
  const kept = [...player.owned];
  const started = [...player.sources];
  player.destroy();
  assert.ok(kept.every((n) => n.gone), 'every owned node disconnected');
  assert.ok(started.every((n) => n.stopped && n.gone), 'every source stopped and let go');
  assert.equal(player.ready, false);
  assert.equal(player.sources.size, 0);
});

test('a build still running when the tool is closed takes itself down when it lands', async () => {
  const engine = fakeEngine();
  let release;
  class Slow extends LoopPlayer {
    async raise(ctx) {
      await new Promise((resolve) => { release = resolve; });
      this.input = this.own(ctx.createGain());
    }
  }
  const player = new Slow(engine);
  const building = player.build();
  await tick();
  player.destroy();
  release();
  await building;
  assert.equal(player.ready, false);
  assert.equal(player.owned.size, 0);
  assert.ok(engine.made.every((n) => n.gone), 'nothing it built is still wired');
});

test('a build that fails can be tried again, and leaves nothing behind', async () => {
  const engine = fakeEngine();
  let fail = true;
  class Flaky extends LoopPlayer {
    async raise(ctx) {
      this.own(ctx.createGain());
      if (fail) throw new Error('no worklet');
      this.input = this.own(ctx.createGain());
    }
  }
  const player = new Flaky(engine);
  await assert.rejects(player.build(), /no worklet/);
  assert.ok(engine.made.every((n) => n.gone));
  fail = false;
  await player.build();
  assert.equal(player.ready, true);
});

test('own takes anything with a destroy, as well as a node', async () => {
  const engine = fakeEngine();
  const destroyed = [];
  class Worklets extends LoopPlayer {
    async raise() { this.own({ destroy: () => destroyed.push('imager') }); }
  }
  const player = new Worklets(engine);
  await player.build();
  player.destroy();
  assert.deepEqual(destroyed, ['imager']);
});

test('a destroyed player stays destroyed, whoever still holds it', async () => {
  const engine = fakeEngine();
  const player = new Plain(engine);
  const playing = player.play();
  await tick();
  engine.finish();
  await playing;
  player.destroy();
  const before = engine.made.length;
  assert.equal(await player.play(), false);
  await player.build();
  assert.equal(await player.setSource('bass'), false);
  assert.equal(engine.made.length, before, 'nothing was built or started after the end');
  assert.equal(player.ready, false);
});
