/**
 * The loop, through two of something, with a switch between them.
 *
 *   dry loop ─┬─ yours:  dry ─┐
 *             │         wet ─┴─ yours  ─┐
 *             └─ theirs: dry ─┐         ├─ out
 *                       wet ─┴─ theirs ─┘
 *
 * The something is whatever `impulseOf` builds - a room, a set of repeats,
 * anything that can be written down as an impulse response. Both the reverb
 * and the delay are that, and neither of them needs a player of its own.
 *
 * The wet side is rendered rather than processed live, which is the decision
 * everything else here follows from. A ConvolverNode handed a new impulse
 * throws away its history, so its tail has to build again from nothing - and
 * with a two second room that is two seconds of it fading up every time a
 * knob moves. Rendering the loop through the impulse offline instead gives a
 * wet loop that is already whole, and changing a setting becomes a crossfade
 * between two of them. For a delay it buys something else as well: the
 * repeats land exactly where the setting says, rather than being retimed
 * under a moving playhead.
 *
 * The render also wraps: what is still sounding when the loop comes round is
 * folded back over the beginning, so the effect joins up instead of being cut
 * off at the splice. That is the same trick the bed itself is built with, and
 * a tail is where you would hear it missing.
 */
export class ImpulsePlayer {
  constructor(engine, { source = 'instrument', impulseOf, defaults = {} } = {}) {
    this.engine = engine;
    this.source = source;
    this.impulseOf = impulseOf;
    this.defaults = defaults;
    this.hearing = 'mine';
    this.settings = { ...defaults };
    this.target = null;
    this.ready = false;
    this.buffer = null;
    this.dryRms = 0;
  }

  async build() {
    if (this.ready) return;
    const ctx = this.engine.ensure();

    this.meter = ctx.createAnalyser();
    this.meter.fftSize = 1024;
    this.meter.connect(this.engine.out);

    this.mine = this.side(ctx, 1);
    this.theirs = this.side(ctx, 0);
    this.ready = true;
  }

  /** One room: its own dry and wet balance, and its own place in the A/B. */
  side(ctx, listening) {
    const select = ctx.createGain();
    select.gain.value = listening;
    select.connect(this.meter);

    const dry = ctx.createGain();
    const wet = ctx.createGain();
    dry.connect(select);
    wet.connect(select);

    return { select, dry, wet, sources: [] };
  }

  /* ---------- the material ---------- */

  async prepare() {
    const signal = this.source === 'yours'
      ? this.yours
      : await this.engine.renderLoop(this.source);
    if (!signal) return false;

    this.buffer = signal;
    const data = signal.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < data.length; i += 1) sum += data[i] * data[i];
    this.dryRms = Math.sqrt(sum / Math.max(1, data.length));
    return true;
  }

  async load(file) {
    const ctx = this.engine.ensure();
    this.yours = await ctx.decodeAudioData(await file.arrayBuffer());
    return this.yours;
  }

  /** An impulse response, as something Web Audio will convolve with. */
  toBuffer(impulse) {
    const ctx = this.engine.ctx;
    const buffer = ctx.createBuffer(impulse.channels.length, impulse.length, impulse.rate);
    impulse.channels.forEach((channel, i) => buffer.copyToChannel(channel, i));
    return buffer;
  }

  /**
   * The loop with the room on it, rendered whole.
   *
   * Native convolution in an offline context, because doing it in JavaScript
   * would be a quarter of a million samples against a hundred thousand and
   * there is no time in a frame for that.
   */
  async renderWet(settings) {
    const ctx = this.engine.ensure();
    const rate = ctx.sampleRate;
    const impulse = this.impulseOf(rate, settings);
    const loop = this.buffer.length;

    const offline = new OfflineAudioContext(2, loop + impulse.length, rate);
    const source = offline.createBufferSource();
    source.buffer = this.buffer;

    const convolver = offline.createConvolver();
    // Off, because the impulse arrives at the level it means and a second
    // normalisation with a rule of its own would put that back out of
    // anybody's hands.
    convolver.normalize = false;
    convolver.buffer = this.toBuffer(impulse);

    source.connect(convolver).connect(offline.destination);
    source.start(0);

    const rendered = await offline.startRendering();
    const wet = ctx.createBuffer(2, loop, rate);

    for (let c = 0; c < 2; c += 1) {
      const from = rendered.getChannelData(c);
      const to = wet.getChannelData(c);
      for (let i = 0; i < loop; i += 1) to[i] = from[i];
      // What was still ringing at the splice comes back round with it.
      for (let i = 0; i + loop < from.length; i += 1) to[i] += from[i + loop];
    }

    let sum = 0;
    const left = wet.getChannelData(0);
    for (let i = 0; i < loop; i += 1) sum += left[i] * left[i];
    const rms = Math.sqrt(sum / Math.max(1, loop));

    return { wet, impulse, rms };
  }

  /* ---------- the settings ---------- */

  async setSettings(settings) {
    this.settings = { ...this.settings, ...settings };
    return this.refresh('mine', this.settings);
  }

  async setTarget(settings) {
    this.target = settings ? { ...this.defaults, ...settings } : null;
    if (!this.target) return null;
    return this.refresh('theirs', this.target);
  }

  /** Builds a room and, if anything is playing, fades into it. */
  async refresh(which, settings) {
    if (!this.buffer) return null;

    const made = await this.renderWet(settings);
    const side = which === 'mine' ? this.mine : this.theirs;
    if (!side) return made;

    side.made = made;
    this.balance(side, settings, made);
    if (this.playing) this.swap(side, made.wet);
    return made;
  }

  /**
   * How loud each half of this is.
   *
   * The wet path is trimmed to the level of the dry one first, so that `mix`
   * is a balance rather than a number whose meaning depends on how long the
   * tail is. Then the pair is trimmed together, so that moving the mix does
   * not change how loud the whole thing is - the same reason every other
   * plugin in this app has an auto gain, and the same false positive it
   * exists to kill.
   */
  balance(side, settings, made) {
    if (!this.ready) return;
    const at = this.engine.ctx.currentTime;
    const mix = Math.min(1, Math.max(0, settings.mix));

    const match = made.rms > 1e-9 ? this.dryRms / made.rms : 0;
    const trim = 1 / Math.sqrt((1 - mix) ** 2 + mix ** 2);

    side.dry.gain.setTargetAtTime((1 - mix) * trim, at, 0.02);
    side.wet.gain.setTargetAtTime(mix * match * trim, at, 0.02);
    side.trim = trim;
  }

  /* ---------- transport ---------- */

  hear(which) {
    this.hearing = which;
    if (!this.ready) return;
    const at = this.engine.ctx.currentTime;
    this.mine.select.gain.setTargetAtTime(which === 'mine' ? 1 : 0, at, 0.008);
    this.theirs.select.gain.setTargetAtTime(which === 'mine' ? 0 : 1, at, 0.008);
  }

  async play() {
    await this.build();
    if (!this.buffer) await this.prepare();
    if (!this.buffer) return false;

    if (!this.mine.made) await this.refresh('mine', this.settings);
    if (this.target && !this.theirs.made) await this.refresh('theirs', this.target);

    this.stop();
    const ctx = this.engine.ctx;
    const at = ctx.currentTime + 0.08;
    this.startedAt = at;

    // One dry loop feeding both sides, so flipping between them is the
    // effect changing and not the take changing.
    this.dryNode = ctx.createBufferSource();
    this.dryNode.buffer = this.buffer;
    this.dryNode.loop = true;
    this.dryNode.connect(this.mine.dry);
    this.dryNode.connect(this.theirs.dry);
    this.dryNode.start(at);

    for (const side of [this.mine, this.theirs]) {
      if (side.made) this.start(side, side.made.wet, at, 0);
    }

    this.running = true;
    return true;
  }

  /** Starts one wet loop into a side, at a given point of the loop. */
  start(side, wet, at, offset) {
    const ctx = this.engine.ctx;
    const node = ctx.createBufferSource();
    node.buffer = wet;
    node.loop = true;

    const gain = ctx.createGain();
    gain.gain.value = 0;
    node.connect(gain).connect(side.wet);
    node.start(at, offset);
    gain.gain.setTargetAtTime(1, at, 0.02);

    side.sources.push({ node, gain });
    return { node, gain };
  }

  /**
   * Fades from what is playing into what was just built.
   *
   * Started at the point of the loop the old one has reached, so the two are
   * the same bar and the crossfade is between two settings rather than
   * between two places in the music.
   */
  swap(side, wet) {
    const ctx = this.engine.ctx;
    const at = ctx.currentTime + 0.02;
    const length = this.buffer.duration;
    const offset = (((at - this.startedAt) % length) + length) % length;

    for (const old of side.sources) {
      old.gain.gain.cancelScheduledValues(at);
      old.gain.gain.setTargetAtTime(0, at, 0.02);
      try { old.node.stop(at + 0.25); } catch { /* already stopped */ }
    }
    side.sources = [];

    this.start(side, wet, at, offset);
  }

  stop() {
    for (const side of [this.mine, this.theirs]) {
      if (!side) continue;
      for (const { node } of side.sources) {
        try { node.stop(); } catch { /* already stopped */ }
        node.disconnect();
      }
      side.sources = [];
    }

    if (this.dryNode) {
      try { this.dryNode.stop(); } catch { /* already stopped */ }
      this.dryNode.disconnect();
      this.dryNode = null;
    }
    this.running = false;
  }

  get playing() {
    return Boolean(this.running && this.dryNode);
  }

  /** Where the loop has got to, as a fraction of it. */
  get position() {
    if (!this.playing || !this.buffer) return null;
    const on = this.engine.ctx.currentTime - this.startedAt;
    if (on < 0) return 0;
    return (on % this.buffer.duration) / this.buffer.duration;
  }

  /** What is coming out, in dB, for a meter. */
  level() {
    if (!this.ready) return -60;
    const frame = new Float32Array(this.meter.fftSize);
    this.meter.getFloatTimeDomainData(frame);
    let peak = 0;
    for (const sample of frame) {
      const value = sample < 0 ? -sample : sample;
      if (value > peak) peak = value;
    }
    return 20 * Math.log10(peak + 1e-6);
  }

  destroy() {
    this.stop();
    try { this.meter?.disconnect(); } catch { /* already gone */ }
    this.ready = false;
  }
}
