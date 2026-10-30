import { LEVEL_DEFAULTS, gainOf, runTrim } from './gain.js';

/**
 * The loop, through two trims you can flip between.
 *
 *   loop ─┬─ fault ─┬─ yours ────┐
 *                   └─ untreated ┴─ out
 *
 * The same shape as every other player here, and simpler than all of them
 * because the processing is a gain: `mine` is a GainNode at whatever the trim
 * says and `theirs` is one at unity. Both are always fed, so flipping is a
 * pair of gains rather than a rebuild.
 *
 * The A/B is the point of this tool rather than a convenience. A level cannot
 * be judged on its own - there is no absolute loudness scale in anybody's head
 * - so every exercise here is two things against each other, and the flip has
 * to be instant and gapless or the comparison is of memory rather than sound.
 */
export class LevelPlayer {
  constructor(engine, { source = 'mix' } = {}) {
    this.engine = engine;
    this.source = source;
    this.hearing = 'mine';
    this.settings = { ...LEVEL_DEFAULTS };
    this.fault = null;
    this.ready = false;
    this.buffer = null;
    this.raw = null;
    this.yours = null;
  }

  async build() {
    if (this.ready) return;
    const ctx = this.engine.ensure();

    this.mine = ctx.createGain();
    this.theirs = ctx.createGain();
    this.mine.gain.value = gainOf(this.settings.trim ?? 0);
    this.theirs.gain.value = 1;

    // The flip, as a second pair of gains after the trim. Two stages rather
    // than one, because the trim is what is being set and the flip is what is
    // being monitored, and folding them together would mean the trim knob
    // jumped whenever somebody pressed A/B.
    this.mineOut = ctx.createGain();
    this.theirsOut = ctx.createGain();
    this.mineOut.gain.value = 1;
    this.theirsOut.gain.value = 0;

    this.mine.connect(this.mineOut).connect(this.engine.out);
    this.theirs.connect(this.theirsOut).connect(this.engine.out);
    this.ready = true;
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
   * The loop with somebody else's level already on it.
   *
   * Baked into the material rather than put in the graph, for the imager's
   * reason: a fault that can be switched off is a setting to be found rather
   * than a mistake to be fixed. Here it matters twice over, because the whole
   * exercise is "put this back where it was" and a bypass button would be the
   * answer.
   */
  bake(loop, fault) {
    const ctx = this.engine.ctx;
    const left = loop.getChannelData(0);
    const right = loop.numberOfChannels > 1 ? loop.getChannelData(1) : left;

    const done = runTrim(left, right, fault);
    const out = ctx.createBuffer(2, loop.length, ctx.sampleRate);
    out.copyToChannel(done.left, 0);
    out.copyToChannel(done.right, 1);
    return out;
  }

  async load(file) {
    const ctx = this.engine.ensure();
    this.yours = await ctx.decodeAudioData(await file.arrayBuffer());
    return this.yours;
  }

  /**
   * The material a reading is taken on.
   *
   * Four seconds rather than the two and a half the imager takes, because an
   * integrated loudness is built from 400 ms blocks and a short reading is a
   * handful of them. The gate throws away anything under -70 LUFS, so a
   * passage that happens to be quiet costs blocks rather than just precision.
   */
  sample(seconds = 4) {
    if (!this.buffer) return null;
    const rate = this.engine.ctx?.sampleRate ?? 48000;
    const length = Math.min(this.buffer.length, Math.round(rate * seconds));
    const left = this.buffer.getChannelData(0).subarray(0, length);
    const right = (this.buffer.numberOfChannels > 1
      ? this.buffer.getChannelData(1)
      : this.buffer.getChannelData(0)).subarray(0, length);
    return { left, right, rate };
  }

  /** And the same window of the material before the fault, for the A/B. */
  untreated(seconds = 4) {
    if (!this.raw) return null;
    const rate = this.engine.ctx?.sampleRate ?? 48000;
    const length = Math.min(this.raw.length, Math.round(rate * seconds));
    const left = this.raw.getChannelData(0).subarray(0, length);
    const right = (this.raw.numberOfChannels > 1
      ? this.raw.getChannelData(1)
      : this.raw.getChannelData(0)).subarray(0, length);
    return { left, right, rate };
  }

  /* ---------- the settings ---------- */

  setSettings(settings) {
    this.settings = { ...this.settings, ...settings };
    if (!this.ready) return;
    // Ramped rather than set, because a trim is dragged and a gain that jumps
    // between blocks clicks. Eight milliseconds is short enough that the A/B
    // is still a comparison of the same instant.
    this.mine.gain.setTargetAtTime(
      gainOf(this.settings.trim ?? 0), this.engine.ctx.currentTime, 0.008,
    );
  }

  setFault(fault) {
    this.fault = fault;
  }

  /* ---------- transport ---------- */

  hear(which) {
    this.hearing = which;
    if (!this.ready) return;
    const at = this.engine.ctx.currentTime;
    this.mineOut.gain.setTargetAtTime(which === 'mine' ? 1 : 0, at, 0.008);
    this.theirsOut.gain.setTargetAtTime(which === 'mine' ? 0 : 1, at, 0.008);
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
    this.node.connect(this.mine);
    this.node.start(at);

    // The untreated side runs from the raw loop, in step with the other, so
    // the flip lands on the same bar of music rather than the beginning.
    if (this.raw) {
      this.dry = ctx.createBufferSource();
      this.dry.buffer = this.raw;
      this.dry.loop = true;
      this.dry.connect(this.theirs);
      this.dry.start(at);
    }

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
