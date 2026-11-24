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

/** How far a gain match will go, either way, in decibels. */
export const GAIN_MATCH_LIMIT = 24;

/** How often the loudness is read while the loop plays, in milliseconds. */
const MATCH_EVERY = 100;

/**
 * Loudness as it is read live: K-weighting - BS.1770's high-pass at 38 Hz and
 * its +4 dB shelf above 1.5 kHz - into an analyser. Not a gated LUFS figure,
 * which needs the whole programme; a running mean square of the same weighted
 * signal, which is what a comparison second to second needs.
 */
function loudnessTap(ctx, own) {
  const high = own(ctx.createBiquadFilter());
  high.type = 'highpass';
  high.frequency.value = 38;
  high.Q.value = 0.5;
  const shelf = own(ctx.createBiquadFilter());
  shelf.type = 'highshelf';
  shelf.frequency.value = 1500;
  shelf.gain.value = 4;
  const eye = own(ctx.createAnalyser());
  eye.fftSize = 2048;
  high.connect(shelf).connect(eye);
  return { input: high, eye, data: new Float32Array(eye.fftSize), power: 0, reads: 0 };
}

/**
 * Fold the latest window into a tap's running mean square: an even average
 * for the first three seconds, then one that forgets over about three.
 */
function readTap(tap) {
  tap.eye.getFloatTimeDomainData(tap.data);
  let sum = 0;
  for (const value of tap.data) sum += value * value;
  const now = sum / tap.data.length;
  tap.reads += 1;
  const weight = Math.max(1 / tap.reads, MATCH_EVERY / 3000);
  tap.power += (now - tap.power) * weight;
}

/** How many decibels take `power` to `reference`, within the limit. */
export function matchDb(reference, power) {
  if (!(reference > 1e-10) || !(power > 1e-10)) return 0;
  const db = 10 * Math.log10(reference / power);
  return Math.max(-GAIN_MATCH_LIMIT, Math.min(GAIN_MATCH_LIMIT, db));
}

export class LoopPlayer {
  constructor(engine, { source = 'mix', spread = true } = {}) {
    this.engine = engine;
    // The sample's id: a loop the engine renders, or 'yours' for a file.
    this.source = source;
    this.spread = spread;
    this.hearing = 'mine';
    // Out of circuit: yours is heard as the loop it is given, with nothing
    // done to it. The device's own switch, and nothing to do with the A/B,
    // which compares yours with somebody else's.
    this.bypassed = false;
    this.dry = null;
    // Gain match: both sides brought to the loudness of the loop as it comes
    // in, so a comparison is about what the device does rather than about
    // which side is louder. Off until asked for, and only on a player that
    // can be matched at all - see `matchable`.
    this.matching = false;
    this.taps = null;
    this.match = { mine: 0, theirs: 0 };
    this.timer = null;
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

  /**
   * Where the dry loop goes when the device is bypassed: wherever yours goes,
   * so the meters and pictures downstream show the bypass too. The engine's
   * output, unless a subclass has something in between.
   */
  dryTo() { return this.engine.out; }

  /** Whether a buffer being started is the loop as it comes in. */
  isDry(buffer) { return buffer === this.buffer; }

  /** Anything else that should feed the dry path, for a graph that has it. */
  feedDry(dry) {}

  /**
   * Whether a gain match makes sense here. A tool whose question is loudness
   * - the level, the limiter - answers no: matching would hide the answer.
   */
  get matchable() { return true; }

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
    // The bypass: the loop as it comes in, straight to where yours goes,
    // silent until the device is switched out.
    this.dry = this.own(ctx.createGain());
    this.dry.gain.value = 0;
    this.dry.connect(this.dryTo());
    this.feedDry(this.dry);
    this.meterSides(ctx);
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
   * Read each side before the A/B rather than after it, so both are measured
   * all the time - a side that is faded out cannot be heard to be measured.
   *
   * Every player sends both sides to the same place, which is `dryTo`, so the
   * sides' own gains are held at one and the crossfade moves to a pair of
   * gains after them: side -> trim -> fade -> where it went before, with the
   * side also feeding a loudness tap. The loop itself is tapped where the dry
   * path is fed. A player whose A/B is not that pair - the EQ, which fades
   * its chains - is left as it was, and has its own auto gain.
   */
  meterSides(ctx) {
    if (!this.matchable || !this.mineOut || !this.theirsOut) return;
    if (typeof ctx.createAnalyser !== 'function' || typeof ctx.createBiquadFilter !== 'function') return;
    const to = this.dryTo();
    const side = (out) => {
      out.disconnect();
      out.gain.cancelScheduledValues?.(0);
      out.gain.value = 1;
      const tap = loudnessTap(ctx, (node) => this.own(node));
      out.connect(tap.input);
      const trim = this.own(ctx.createGain());
      const fade = this.own(ctx.createGain());
      out.connect(trim).connect(fade).connect(to);
      return { tap, trim, fade };
    };
    this.taps = {
      mine: side(this.mineOut),
      theirs: side(this.theirsOut),
      loop: loudnessTap(ctx, (node) => this.own(node)),
    };
  }

  /** Bring both sides to the loudness of the loop, or let them be. */
  setGainMatch(on) {
    this.matching = !!on && !!this.taps;
    this.applyMatch();
  }

  /** The trim a gain match is putting on a side, in dB - 0 while it is off. */
  matchOn(side = 'mine') {
    return this.matching ? this.match[side] : 0;
  }

  /** One reading of all three taps, and the trims that follow from it. */
  readMatch() {
    if (!this.taps) return;
    for (const tap of [this.taps.mine.tap, this.taps.theirs.tap, this.taps.loop]) readTap(tap);
    const loop = this.taps.loop.power;
    this.match.mine = matchDb(loop, this.taps.mine.tap.power);
    this.match.theirs = matchDb(loop, this.taps.theirs.tap.power);
    this.applyMatch();
  }

  applyMatch() {
    if (!this.taps || !this.ready) return;
    const at = this.engine.ctx.currentTime;
    for (const side of ['mine', 'theirs']) {
      const gain = this.matching ? 10 ** (this.match[side] / 20) : 1;
      // Slow, so the match settles rather than pumps with the music.
      this.taps[side].trim.gain.setTargetAtTime(gain, at, 0.3);
    }
  }

  /** Take the device out of circuit, or put it back. */
  setBypass(on) {
    this.bypassed = !!on;
    this.flip();
  }

  /**
   * How loud each of the three should be: yours, the dry loop, theirs.
   * Not `levels`, which two players already use for their meters.
   */
  sides() {
    const mine = this.hearing === 'mine';
    return {
      mine: mine && !this.bypassed ? 1 : 0,
      dry: mine && this.bypassed ? 1 : 0,
      theirs: mine ? 0 : 1,
    };
  }

  /**
   * Put the A/B where `hearing` says. The default flips `mineOut` and
   * `theirsOut`, which is how most of the tools are wired; one that is not
   * says so here.
   */
  flip() {
    if (!this.ready || !this.mineOut || !this.theirsOut) return;
    const at = this.engine.ctx.currentTime;
    const level = this.sides();
    // Measured sides fade after their taps; the rest fade where they stand.
    const mine = this.taps?.mine.fade ?? this.mineOut;
    const theirs = this.taps?.theirs.fade ?? this.theirsOut;
    mine.gain.setTargetAtTime(level.mine, at, GLIDE);
    theirs.gain.setTargetAtTime(level.theirs, at, GLIDE);
    this.dry?.gain.setTargetAtTime(level.dry, at, GLIDE);
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
    if (this.dry && this.isDry(buffer)) {
      node.connect(this.dry);
      if (this.taps) node.connect(this.taps.loop.input);
    }
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
    // The loudness is read only while there is something to read.
    if (this.taps && !this.timer) this.timer = setInterval(() => this.readMatch(), MATCH_EVERY);
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
    clearInterval(this.timer);
    this.timer = null;
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
