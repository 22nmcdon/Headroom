import { HEAT_DEFAULTS, heatTrim, runShaper } from './shape.js';
import { damageOf } from '../../lib/damage.js';
import { LiveSaturator } from './node.js';
import { LoopPlayer } from '../../lib/loop-player.js';

/**
 * The loop, through two saturators you can flip between.
 *
 *   loop ─┬─ fault ─┬─ yours  ─┐
 *                   └─ theirs ─┴─ out
 *
 * Both are always running and always fed, so flipping is a pair of gains,
 * and the two are level-matched before you ever hear them.
 *
 * Starting, stopping, swapping the loop and taking it all down are
 * lib/loop-player.js's; what is here is only what is this tool's.
 */
export class HeatPlayer extends LoopPlayer {
  constructor(engine, { source = 'mix' } = {}) {
    super(engine, { source });
    this.auto = true;
    this.settings = { ...HEAT_DEFAULTS };
    this.target = null;
    this.other = null;
    this.samples = null;
  }

  async raise(ctx) {
    [this.mine, this.mineOut] = await this.side(ctx, 1);
    [this.theirs, this.theirsOut] = await this.side(ctx, 0);
  }

  /**
   * One saturator, and the gain that is its half of the flip. The saturator
   * is owned before its worklet is waited for, so a build that fails on the
   * second side still takes the first one down.
   */
  async side(ctx, listening) {
    const heat = this.own(new LiveSaturator(ctx));
    await heat.start();
    const gain = this.own(ctx.createGain());
    gain.gain.value = listening;
    heat.connect(gain).connect(this.engine.out);
    return [heat, gain];
  }

  /* ---------- the material ---------- */

  async prepare() {
    if (!(await super.prepare())) return false;

    // What the far side of the A/B plays. Normally the same thing - a fault
    // is baked in so that it cannot be switched off - but a round about
    // naming damage can ask for the material itself over there, which is a
    // different question from a fault to be fixed: one asks what to do about
    // it and the other asks what it is.
    this.other = this.fault?.against === 'clean' ? this.raw : this.buffer;

    // A second of it, mono, is what every reading is taken on. The shaping
    // runs eight times oversampled, which is the most expensive arithmetic
    // in this app, and a loop that repeats says everything about its level
    // in its first bar.
    const rate = this.engine.ctx?.sampleRate ?? 48000;
    const length = Math.min(this.buffer.length, rate);
    this.samples = this.buffer.getChannelData(0).subarray(0, length);

    // And the trim follows the material it is a trim for. It used to be
    // taken again at every Play, which is when a new loop or fault reached
    // the sound - and now that a new one is heard the moment it is ready,
    // so is its level.
    this.measure();
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
    const spoil = fault.damage ? damageOf(fault.damage) : null;

    for (let c = 0; c < channels; c += 1) {
      const from = loop.getChannelData(c);
      // Two kinds of fault. A shaper setting is somebody else's saturation,
      // already on the material; a `damage` is one of the ways a recording
      // gets spoiled, which is `lib/damage.js` and is mostly not saturation
      // at all - hum, a click, a codec. Both are baked for the same reason.
      out.copyToChannel(spoil
        ? spoil.apply(from, rate, fault)
        : runShaper(from, rate, { ...HEAT_DEFAULTS, ...fault }), c);
    }

    return out;
  }

  /* ---------- what the settings do ---------- */

  /**
   * The trim each side needs to come out as loud as it went in.
   *
   * The harmonic series is not measured here any more. It used to be -
   * twice, once for each side - in the same timeout body that had the
   * plugin measure it again, with no ordering expressed anywhere between
   * them, and with nothing at all reading what this stored. Three passes of
   * the most expensive measurement in the app, two of them for nobody.
   *
   * What is genuinely this player's is the trim: how much gain each side
   * needs to come out as loud as it went in, which is measured over the
   * actual loop rather than off the curve. The plugin owns the reading.
   */
  measure() {
    const rate = this.engine.ctx?.sampleRate ?? 48000;
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
    this.mine.set({ ...this.settings, trim: this.auto ? (this.trim ?? 0) : 0 });
    if (this.target) {
      this.theirs.set({ ...this.target, trim: this.auto ? (this.targetTrim ?? 0) : 0 });
    }
  }

  apply() {
    this.push();
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

  /* ---------- transport ---------- */

  // One source a side, started together, because the two sides are not
  // always playing the same material: see `prepare`. When they are, which
  // is every round but one, the two buffers are the same object and the
  // crossfade between them is a crossfade between a signal and itself.
  wire(at) {
    this.start(this.buffer, (node) => node.connect(this.mine.input), at);
    this.start(this.other ?? this.buffer, (node) => node.connect(this.theirs.input), at);
  }
}
