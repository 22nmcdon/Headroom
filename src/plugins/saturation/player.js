import { HEAT_DEFAULTS, heatTrim, runShaper } from './shape.js';
import { LiveSaturator } from './node.js';

/**
 * The loop, through two saturators you can flip between.
 *
 *   loop ─┬─ fault ─┬─ yours  ─┐
 *                   └─ theirs ─┴─ out
 *
 * Both are always running and always fed, so flipping is a pair of gains,
 * and the two are level-matched before you ever hear them.
 */
export class HeatPlayer {
  constructor(engine, { source = 'mix' } = {}) {
    this.engine = engine;
    this.source = source;
    this.hearing = 'mine';
    this.auto = true;
    this.settings = { ...HEAT_DEFAULTS };
    this.target = null;
    this.fault = null;
    this.ready = false;
    this.buffer = null;
  }

  async build() {
    if (this.ready) return;
    const ctx = this.engine.ensure();

    this.mine = await this.side(ctx, 1);
    this.theirs = await this.side(ctx, 0);
    this.ready = true;
  }

  async side(ctx, listening) {
    const heat = await new LiveSaturator(ctx).start();
    const gain = ctx.createGain();
    gain.gain.value = listening;
    heat.connect(gain).connect(this.engine.out);
    return { heat, gain };
  }

  /* ---------- the material ---------- */

  async prepare() {
    const loop = this.source === 'yours'
      ? this.yours
      : await this.engine.renderLoop(this.source, { spread: true });
    if (!loop) return false;

    this.raw = loop;
    this.buffer = this.fault ? this.bake(loop, this.fault) : loop;

    // A second of it, mono, is what every reading is taken on. The shaping
    // runs eight times oversampled, which is the most expensive arithmetic
    // in this app, and a loop that repeats says everything about its level
    // in its first bar.
    const rate = this.engine.ctx?.sampleRate ?? 48000;
    const length = Math.min(this.buffer.length, rate);
    const left = this.buffer.getChannelData(0);
    this.samples = left.subarray(0, length);
    return true;
  }

  /**
   * The loop with somebody else's saturation already on it.
   *
   * Rendered into the material rather than inserted in the graph, so that it
   * is there on both sides of the A/B and cannot be switched off - which is
   * what makes it a fault to be fixed rather than a setting to be found.
   */
  bake(loop, fault) {
    const ctx = this.engine.ctx;
    const rate = ctx.sampleRate;
    const channels = loop.numberOfChannels;
    const out = ctx.createBuffer(channels, loop.length, rate);

    for (let c = 0; c < channels; c += 1) {
      const from = loop.getChannelData(c);
      out.copyToChannel(runShaper(from, rate, { ...HEAT_DEFAULTS, ...fault }), c);
    }

    return out;
  }

  async load(file) {
    const ctx = this.engine.ensure();
    this.yours = await ctx.decodeAudioData(await file.arrayBuffer());
    return this.yours;
  }

  /* ---------- what the settings do ---------- */

  /**
   * The harmonic series both sides make, and the trim each needs to come out
   * as loud as it went in.
   *
   * The series comes off a sine rather than off the loop, which is the only
   * way to get a clean one: harmonics are only harmonics of something, and a
   * drum loop has no single fundamental for them to be harmonics of. What
   * the curve does to a sine is a complete description of what it does to
   * anything, so nothing is lost by asking it that way.
   */
  measure() {
    const rate = this.engine.ctx?.sampleRate ?? 48000;

    // The harmonic series is not measured here any more. It used to be -
    // twice, once for each side - in the same timeout body that had the
    // plugin measure it again, with no ordering expressed anywhere between
    // them, and with nothing at all reading what this stored. Three passes of
    // the most expensive measurement in the app, two of them for nobody.
    //
    // What is genuinely this player's is the trim: how much gain each side
    // needs to come out as loud as it went in, which is measured over the
    // actual loop rather than off the curve. The plugin owns the reading.
    if (this.samples) {
      this.trim = heatTrim(this.samples, rate, this.settings);
      this.targetTrim = this.target ? heatTrim(this.samples, rate, this.target) : 0;
    }

    this.push();
    return this.trim;
  }

  /** Hands the current settings, and the level they need, to the audio thread. */
  push() {
    if (!this.ready) return;
    this.mine.heat.set({ ...this.settings, trim: this.auto ? (this.trim ?? 0) : 0 });
    if (this.target) {
      this.theirs.heat.set({ ...this.target, trim: this.auto ? (this.targetTrim ?? 0) : 0 });
    }
  }

  setSettings(settings) {
    this.settings = { ...this.settings, ...settings };
    return this.measure();
  }

  setTarget(target) {
    this.target = target ? { ...HEAT_DEFAULTS, ...target } : null;
    this.measure();
  }

  setAuto(on) {
    this.auto = on;
    this.push();
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

    this.measure();
    this.stop();

    const ctx = this.engine.ctx;
    const at = ctx.currentTime + 0.08;

    this.node = ctx.createBufferSource();
    this.node.buffer = this.buffer;
    this.node.loop = true;
    this.node.connect(this.mine.heat.input);
    this.node.connect(this.theirs.heat.input);
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

  destroy() {
    this.stop();
    this.mine?.heat.destroy();
    this.theirs?.heat.destroy();
    this.ready = false;
  }
}
