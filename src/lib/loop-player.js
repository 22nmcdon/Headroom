// The part of a tool's player that every tool's player is.
//
// Each of the players under src/plugins/ was written by copying the one
// before it, and the copies carried the same three mistakes between them: a
// sample or a fault changed while the loop played and the old one kept
// playing; a tool closed and its nodes stayed wired to the output, its
// worklets running for good; Play pressed twice before the graph was up, and
// two graphs built - or two loops started, one of them held by nothing, so
// that nothing could ever stop it. tests/browser/lifecycle.mjs found every
// tool doing at least one of these.
//
// All three are the same gap: a player starting things it does not keep. So
// this keeps them.
//
//   - every source is started through `start`, and so `stop` reaches all of
//     them - there is no way to start one it does not know about;
//   - every node a player builds goes through `own`, and `destroy` takes all
//     of them down without a list in each subclass to forget a line of;
//   - every call that waits is numbered, and one that has been overtaken by
//     a newer play, a stop or a destroy by the time its wait is over does
//     nothing rather than finish over the top of what came after it;
//   - the graph is built once, however many callers ask at once.
//
// What a subclass says is only what is its own: what its graph is (`raise`),
// what is done to the loop before it plays (`bake`), and where the loop goes
// when it does (`wire`).

/** How far ahead a loop is started, so both sides begin on the same sample. */
export const LEAD = 0.08;

/** The time constant every A/B flip and dragged gain moves with. */
export const GLIDE = 0.008;

export class LoopPlayer {
  constructor(engine, { source = 'mix', spread = true } = {}) {
    this.engine = engine;
    // The sample's id: a loop the engine renders, or 'yours' for a file.
    this.source = source;
    this.spread = spread;
    this.hearing = 'mine';
    this.fault = null;
    this.yours = null;
    // The loop as it is heard, and as it was before the fault went in.
    this.buffer = null;
    this.raw = null;
    this.ready = false;
    this.building = null;
    this.playing = false;
    this.began = null;

    this.sources = new Set();
    this.owned = new Set();
    // Bumped by anything that should cancel a play still waiting: a newer
    // play, a stop, a destroy.
    this.turn = 0;
    // Bumped by every prepare, so only the last one asked writes its loop.
    this.asked = 0;
    // Bumped by destroy, so a build that finishes afterwards takes itself down.
    this.life = 0;
  }

  /* ---------- what a subclass says ---------- */

  /** Build the graph on `ctx`, passing every node through `own`. */
  async raise(ctx) {}

  /** The loop with the fault in it. Nothing, unless a tool has a fault to bake. */
  bake(loop, fault) { return loop; }

  /**
   * Start the loop: one `start` per source, all at `at`. The default is one
   * source into `this.input`, which is what most of the tools have.
   */
  wire(at) {
    this.start(this.buffer, (node) => node.connect(this.input), at);
  }

  /** Whatever has to follow a change of settings onto the graph. */
  apply() {}

  /* ---------- the graph ---------- */

  /**
   * Keep a node, or anything with a `destroy` or a `disconnect`, for
   * `destroy` to take down. Returns it, so it can wrap the line that makes it.
   */
  own(thing) {
    this.owned.add(thing);
    return thing;
  }

  /** The graph, built once however many callers ask at the same moment. */
  build() {
    // Final: a player that has been destroyed stays down, whoever still holds
    // it. Rebuilding on the next call is how a closed tool, still answering
    // clicks, came back to life with a new graph on every one.
    if (this.life) return Promise.resolve();
    this.building ??= this.assemble();
    return this.building;
  }

  async assemble() {
    const life = this.life;
    const ctx = this.engine.ensure();
    try {
      await this.raise(ctx);
    } catch (error) {
      // A failed build is not a built one: take down what it got to, and let
      // the next caller try again rather than inherit the rejection forever.
      this.takeDown();
      this.building = null;
      throw error;
    }
    if (life !== this.life) {
      this.takeDown();
      return;
    }
    this.ready = true;
    this.apply();
    this.flip();
  }

  /* ---------- the material ---------- */

  /** The loop as it arrives, before any fault: a file, or a render. */
  async material() {
    if (this.source === 'yours') return this.yours;
    return this.engine.renderLoop(this.source, { spread: this.spread });
  }

  /**
   * Fetch the loop and bake the fault into it. Several can be asked at once -
   * a sample picked, then another - and only the last one writes.
   */
  async prepare() {
    if (this.life) return false;
    const asked = (this.asked += 1);
    const loop = await this.material();
    if (asked !== this.asked) return false;
    if (!loop) return false;
    this.raw = loop;
    this.buffer = this.fault ? this.bake(loop, this.fault) : loop;
    return true;
  }

  /** A file somebody brought, decoded and kept for the session. */
  async load(file) {
    const ctx = this.engine.ensure();
    this.yours = await ctx.decodeAudioData(await file.arrayBuffer());
    return this.yours;
  }

  /**
   * The loop again, and heard again if it was playing: the one thing a new
   * sample or a new fault has to do, which four players had not done.
   */
  async refresh() {
    const was = this.playing;
    const ok = await this.prepare();
    if (ok && was && this.playing) await this.play();
    return ok;
  }

  setSource(id) {
    this.source = id;
    return this.refresh();
  }

  setFault(fault) {
    this.fault = fault ?? null;
    return this.refresh();
  }

  /** The first stretch of a buffer, as the two channels the readings take. */
  windowOf(buffer, seconds) {
    if (!buffer) return null;
    const rate = buffer.sampleRate ?? this.engine.ctx?.sampleRate ?? 48000;
    const length = Math.min(buffer.length, Math.round(rate * seconds));
    const left = buffer.getChannelData(0).subarray(0, length);
    const right = (buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : buffer.getChannelData(0))
      .subarray(0, length);
    return { left, right, rate };
  }

  /* ---------- the A/B ---------- */

  hear(which) {
    this.hearing = which;
    this.flip();
  }

  /**
   * Put the A/B where `hearing` says. The default flips `mineOut` and
   * `theirsOut`, which is how most of the tools are wired; one that is not
   * says so here.
   */
  flip() {
    if (!this.ready || !this.mineOut || !this.theirsOut) return;
    const at = this.engine.ctx.currentTime;
    this.mineOut.gain.setTargetAtTime(this.hearing === 'mine' ? 1 : 0, at, GLIDE);
    this.theirsOut.gain.setTargetAtTime(this.hearing === 'mine' ? 0 : 1, at, GLIDE);
  }

  /* ---------- transport ---------- */

  /**
   * One looping source, wired by `connect` and started at `at` - and kept, so
   * that `stop` reaches it. The only way a player here starts anything.
   */
  start(buffer, connect, at, { loop = true, offset = 0 } = {}) {
    const node = this.engine.ctx.createBufferSource();
    node.buffer = buffer;
    node.loop = loop;
    connect(node);
    node.start(at, offset);
    this.sources.add(node);
    node.onended = () => this.sources.delete(node);
    return node;
  }

  async play() {
    if (this.life) return false;
    const turn = (this.turn += 1);
    await this.build();
    if (turn !== this.turn) return false;
    if (!this.buffer) {
      await this.prepare();
      if (turn !== this.turn) return false;
    }
    if (!this.buffer) return false;

    this.silence();
    this.apply();
    const at = this.engine.ctx.currentTime + LEAD;
    this.wire(at);
    this.began = at;
    this.playing = true;
    return true;
  }

  stop() {
    this.turn += 1;
    this.silence();
  }

  /** Every source this has started, stopped and let go. */
  silence() {
    for (const node of this.sources) {
      node.onended = null;
      try { node.stop(); } catch { /* never started, or already stopped */ }
      try { node.disconnect(); } catch { /* already gone */ }
    }
    this.sources.clear();
    this.playing = false;
    this.began = null;
  }

  /** Where the loop has got to, as a fraction of it - for a playhead. */
  get position() {
    if (!this.playing || !this.buffer || this.began === null) return null;
    const on = this.engine.ctx.currentTime - this.began;
    if (on < 0) return 0;
    return (on % this.buffer.duration) / this.buffer.duration;
  }

  /* ---------- the end ---------- */

  takeDown() {
    for (const thing of this.owned) {
      try {
        if (typeof thing.destroy === 'function') thing.destroy();
        else thing.disconnect?.();
      } catch { /* already gone */ }
    }
    this.owned.clear();
    this.ready = false;
  }

  destroy() {
    this.stop();
    this.life += 1;
    this.takeDown();
    this.building = null;
  }
}
