import { IMAGE_DEFAULTS, runImager } from './field.js';
import { LiveImager } from './node.js';

/**
 * The loop, through two imagers you can flip between.
 *
 *   stereo loop ─┬─ fault ─┬─ yours  ─┐
 *                          └─ theirs ─┴─ split ─ out
 *
 * Both are always running and always fed, so flipping is a pair of gains.
 * The fault, when there is one, is baked into the loop rather than put in the
 * graph: a low end somebody else widened too far is part of the recording you
 * were handed, not something your imager is doing.
 */
export class ImagePlayer {
  constructor(engine, { source = 'mix' } = {}) {
    this.engine = engine;
    this.source = source;
    this.hearing = 'mine';
    this.settings = { ...IMAGE_DEFAULTS };
    this.target = null;
    this.fault = null;
    this.ready = false;
    this.buffer = null;
  }

  async build() {
    if (this.ready) return;
    const ctx = this.engine.ensure();

    // Two analysers off a splitter, because a goniometer is a picture of the
    // two channels against each other and needs them apart.
    this.split = ctx.createChannelSplitter(2);
    this.eyes = [ctx.createAnalyser(), ctx.createAnalyser()];
    for (const [i, eye] of this.eyes.entries()) {
      eye.fftSize = 2048;
      this.split.connect(eye, i);
    }
    this.split.connect(this.engine.out);

    this.mine = await this.side(ctx, 1);
    this.theirs = await this.side(ctx, 0);
    this.ready = true;
  }

  async side(ctx, listening) {
    const imager = await new LiveImager(ctx).start();
    const gain = ctx.createGain();
    gain.gain.value = listening;
    imager.connect(gain).connect(this.split);
    return { imager, gain };
  }

  /* ---------- the material ---------- */

  async prepare() {
    const loop = this.source === 'yours'
      ? this.yours
      : await this.engine.renderLoop(this.source, { spread: true });
    if (!loop) return false;

    this.raw = loop;
    this.buffer = this.fault ? this.bake(loop, this.fault) : loop;
    return true;
  }

  /**
   * The loop with somebody else's mistake already on it.
   *
   * Rendered into the material rather than inserted in the graph, so that it
   * is there on both sides of the A/B and cannot be switched off - which is
   * what makes it a fault to be fixed rather than a setting to be found.
   */
  bake(loop, fault) {
    const ctx = this.engine.ctx;
    const rate = ctx.sampleRate;
    const left = loop.getChannelData(0);
    const right = loop.numberOfChannels > 1 ? loop.getChannelData(1) : left;

    const done = runImager(left, right, rate, { ...IMAGE_DEFAULTS, ...fault });
    const out = ctx.createBuffer(2, loop.length, rate);
    out.copyToChannel(done.left, 0);
    out.copyToChannel(done.right, 1);
    return out;
  }

  async load(file) {
    const ctx = this.engine.ensure();
    this.yours = await ctx.decodeAudioData(await file.arrayBuffer());
    return this.yours;
  }

  /** The material a reading is taken on: one bar of it, which is plenty. */
  sample(seconds = 2.5) {
    if (!this.buffer) return null;
    const rate = this.engine.ctx?.sampleRate ?? 48000;
    const length = Math.min(this.buffer.length, Math.round(rate * seconds));
    const left = this.buffer.getChannelData(0).subarray(0, length);
    const right = (this.buffer.numberOfChannels > 1
      ? this.buffer.getChannelData(1)
      : this.buffer.getChannelData(0)).subarray(0, length);
    return { left, right, rate };
  }

  /* ---------- the settings ---------- */

  setSettings(settings) {
    this.settings = { ...this.settings, ...settings };
    if (this.ready) this.mine.imager.set(this.settings);
  }

  setTarget(settings) {
    this.target = settings ? { ...IMAGE_DEFAULTS, ...settings } : null;
    if (this.ready && this.target) this.theirs.imager.set(this.target);
  }

  setFault(fault) {
    this.fault = fault;
  }

  /* ---------- transport ---------- */

  hear(which) {
    this.hearing = which;
    if (!this.ready) return;
    const at = this.engine.ctx.currentTime;
    this.mine.gain.gain.setTargetAtTime(which === 'mine' ? 1 : 0, at, 0.008);
    this.theirs.gain.gain.setTargetAtTime(which === 'mine' ? 0 : 1, at, 0.008);
  }

  async play() {
    await this.build();
    if (!this.buffer) await this.prepare();
    if (!this.buffer) return false;

    this.setSettings(this.settings);
    if (this.target) this.setTarget(this.target);
    this.stop();

    const ctx = this.engine.ctx;
    const at = ctx.currentTime + 0.08;

    this.node = ctx.createBufferSource();
    this.node.buffer = this.buffer;
    this.node.loop = true;
    this.node.connect(this.mine.imager.input);
    this.node.connect(this.theirs.imager.input);
    this.node.start(at);
    this.startedAt = at;
    return true;
  }

  stop() {
    if (!this.node) return;
    try { this.node.stop(); } catch { /* already stopped */ }
    this.node.disconnect();
    this.node = null;
  }

  get playing() {
    return Boolean(this.node);
  }

  /** What the two channels are doing right now, for the goniometer. */
  frames() {
    if (!this.ready) return null;
    const left = new Float32Array(this.eyes[0].fftSize);
    const right = new Float32Array(this.eyes[1].fftSize);
    this.eyes[0].getFloatTimeDomainData(left);
    this.eyes[1].getFloatTimeDomainData(right);
    return { left, right };
  }

  destroy() {
    this.stop();
    this.mine?.imager.destroy();
    this.theirs?.imager.destroy();
    try { this.split?.disconnect(); } catch { /* already gone */ }
    this.ready = false;
  }
}
