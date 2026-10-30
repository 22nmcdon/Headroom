import {
  CEIL_DEFAULTS, CEIL_DRIVE, CEIL_OUTPUT, CEIL_RANGE, CEIL_RELEASE, heldTo,
} from './ceiling.js';
import { makeLimiterNode } from '../../lib/limiter-node.js';

/**
 * The loop, through a drive, a ceiling and a trim - and the same loop beside
 * it, untouched.
 *
 *   loop ─┬─ fault ─ drive ─ limiter ─ output ─ yours ────┐
 *         └─ fault ───────────────────────────  bypass ───┴─ out
 *
 * The bypass is the whole instrument here, and it is not a convenience. A
 * limiter's output is louder than its input and louder sounds better, so an
 * A/B between limited and not is an A/B about level unless the level is taken
 * out of it. That is what the output trim is for and what the face's Match
 * button sets: the level-matched bypass every mastering engineer works with.
 * Without it the comparison answers "which one is louder", which is a
 * question nobody needed a limiter to settle.
 *
 * Both sides are always fed, so flipping is a pair of gains rather than a
 * rebuild - and both run off the same loop started at the same instant, so
 * the flip lands on the same bar of music rather than at the beginning.
 */
export class CeilingPlayer {
  constructor(engine, { source = 'mix' } = {}) {
    this.engine = engine;
    this.source = source;
    this.hearing = 'mine';
    this.settings = { ...CEIL_DEFAULTS };
    this.fault = null;
    this.ready = false;
    this.buffer = null;
    this.raw = null;
    this.yours = null;
  }

  /**
   * What the limiter node is built with, as it reads it.
   *
   * Clamped with `ceiling.js`'s own clamp rather than a local one, so the
   * audio and the meter cannot disagree about what a setting means.
   */
  limiterOptions() {
    return {
      ceiling: heldTo(this.settings.ceiling ?? CEIL_DEFAULTS.ceiling, CEIL_RANGE),
      release: heldTo(this.settings.release ?? CEIL_DEFAULTS.release, CEIL_RELEASE) / 1000,
      truePeak: (this.settings.peak ?? 'true') === 'true',
    };
  }

  async build() {
    if (this.ready) return;
    const ctx = this.engine.ensure();

    this.drive = ctx.createGain();
    this.trim = ctx.createGain();
    this.bypass = ctx.createGain();
    this.drive.gain.value = 1;
    this.trim.gain.value = 1;
    this.bypass.gain.value = 1;

    // The real thing, off lib/limiter.js, with its knobs reachable while it
    // runs - which is why that file grew a `set`. Rebuilding the node per
    // step of a dragged ceiling would be a new delay line and a click a step.
    this.limiter = await makeLimiterNode(ctx, this.limiterOptions());

    this.mineOut = ctx.createGain();
    this.bypassOut = ctx.createGain();
    this.mineOut.gain.value = 1;
    this.bypassOut.gain.value = 0;

    this.drive.connect(this.limiter.in);
    this.limiter.out.connect(this.trim).connect(this.mineOut).connect(this.engine.out);
    this.bypass.connect(this.bypassOut).connect(this.engine.out);

    this.ready = true;
    this.setSettings(this.settings);
  }

  /* ---------- the material ---------- */

  async prepare() {
    const loop = this.source === 'yours'
      ? this.yours
      : await this.engine.renderLoop(this.source, { spread: true });
    if (!loop) return false;

    this.raw = this.fault ? this.bake(loop, this.fault) : loop;
    this.buffer = this.raw;
    return true;
  }

  /**
   * The loop with somebody else's trim already on it.
   *
   * A limiter's exercises do not generally need one - the drill puts the
   * limiter on the tool rather than into the material, because a limiter
   * doing six decibels is a limiter and not a faulty loop. What a fault is
   * for here is the case where the loop arrives too hot to begin with, which
   * is the ordinary state of a mix handed to a mastering engineer.
   */
  bake(loop, fault) {
    const ctx = this.engine.ctx;
    const g = 10 ** ((fault.trim ?? 0) / 20);
    if (g === 1) return loop;

    const out = ctx.createBuffer(2, loop.length, ctx.sampleRate);
    for (let c = 0; c < 2; c += 1) {
      const from = loop.getChannelData(Math.min(c, loop.numberOfChannels - 1));
      out.copyToChannel(Float32Array.from(from, (v) => v * g), c);
    }
    return out;
  }

  async load(file) {
    const ctx = this.engine.ensure();
    this.yours = await ctx.decodeAudioData(await file.arrayBuffer());
    return this.yours;
  }

  /**
   * The window a reading is taken over.
   *
   * Three seconds rather than the level tool's four, and the reason is cost.
   * The expense is the true-peak detector - every phase of every sample - and
   * measured on this machine a pass over four seconds of stereo takes about
   * 135 ms against about 100 for three, with the loudness and peak figures
   * another 25 on top. Three keeps a dragged knob answering inside a
   * debounce, and still gives an integrated loudness some twenty-six 400 ms
   * blocks to gate and average.
   */
  sample(seconds = 3) {
    return this.windowOf(this.buffer, seconds);
  }

  /** And the same window of the loop as it arrived, for the bypass. */
  untreated(seconds = 3) {
    return this.windowOf(this.raw, seconds);
  }

  windowOf(buffer, seconds) {
    if (!buffer) return null;
    const rate = this.engine.ctx?.sampleRate ?? 48000;
    const length = Math.min(buffer.length, Math.round(rate * seconds));
    const left = buffer.getChannelData(0).subarray(0, length);
    const right = (buffer.numberOfChannels > 1
      ? buffer.getChannelData(1)
      : buffer.getChannelData(0)).subarray(0, length);
    return { left, right, rate };
  }

  /* ---------- the settings ---------- */

  setSettings(settings) {
    this.settings = { ...this.settings, ...settings };
    if (!this.ready) return;

    const at = this.engine.ctx.currentTime;
    const drive = 10 ** (heldTo(this.settings.drive ?? 0, CEIL_DRIVE) / 20);
    const trim = 10 ** (heldTo(this.settings.output ?? 0, CEIL_OUTPUT) / 20);

    // Ramped, because both of these are dragged and a gain that jumps between
    // blocks clicks. Eight milliseconds, as everywhere else here.
    this.drive.gain.setTargetAtTime(drive, at, 0.008);
    this.trim.gain.setTargetAtTime(trim, at, 0.008);
    this.limiter.set?.(this.limiterOptions());
  }

  setFault(fault) {
    this.fault = fault;
  }

  /** The deepest reduction the audio thread has seen since this was asked. */
  reduction() {
    return this.limiter?.readReduction?.() ?? 0;
  }

  /* ---------- transport ---------- */

  hear(which) {
    this.hearing = which;
    if (!this.ready) return;
    const at = this.engine.ctx.currentTime;
    this.mineOut.gain.setTargetAtTime(which === 'mine' ? 1 : 0, at, 0.008);
    this.bypassOut.gain.setTargetAtTime(which === 'mine' ? 0 : 1, at, 0.008);
  }

  async play() {
    await this.build();
    if (!this.buffer) await this.prepare();
    if (!this.buffer) return false;

    this.setSettings(this.settings);
    this.stop();

    const ctx = this.engine.ctx;
    const at = ctx.currentTime + 0.08;

    this.node = ctx.createBufferSource();
    this.node.buffer = this.buffer;
    this.node.loop = true;
    this.node.connect(this.drive);
    this.node.start(at);

    this.dry = ctx.createBufferSource();
    this.dry.buffer = this.raw;
    this.dry.loop = true;
    this.dry.connect(this.bypass);
    this.dry.start(at);

    this.playing = true;
    return true;
  }

  stop() {
    for (const node of [this.node, this.dry]) {
      if (!node) continue;
      try { node.stop(); } catch { /* already stopped, which is fine */ }
      node.disconnect();
    }
    this.node = null;
    this.dry = null;
    this.playing = false;
  }
}
