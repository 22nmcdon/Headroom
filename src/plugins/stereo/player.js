import { STEREO_DEFAULTS, runImager } from './field.js';
import { LiveImager } from './node.js';
import { LoopPlayer } from '../../lib/loop-player.js';

/**
 * The loop, through two imagers you can flip between.
 *
 *   stereo loop ─┬─ fault ─┬─ yours  ─┐
 *                          └─ theirs ─┴─ bus ─┬─ out
 *                                             └─ split ─ eyes
 *
 * Both are always running and always fed, so flipping is a pair of gains.
 * The fault, when there is one, is baked into the loop rather than put in the
 * graph: a low end somebody else widened too far is part of the recording you
 * were handed, not something your imager is doing.
 *
 * Starting, stopping, swapping the loop and taking it all down are
 * lib/loop-player.js's; what is here is only what is this tool's.
 */
export class StereoPlayer extends LoopPlayer {
  constructor(engine, { source = 'mix' } = {}) {
    super(engine, { source });
    this.settings = { ...STEREO_DEFAULTS };
    this.target = null;
  }

  async raise(ctx) {
    // Both sides meet on a stereo bus, which is what is heard. Two analysers
    // hang off a splitter beside it, because a goniometer is a picture of the
    // two channels against each other and needs them apart. The splitter is
    // for the eyes only: connected onwards, it passes one output, which is
    // the left channel alone.
    this.bus = this.own(ctx.createGain());
    this.bus.connect(this.engine.out);
    this.split = this.own(ctx.createChannelSplitter(2));
    this.bus.connect(this.split);
    this.eyes = [this.own(ctx.createAnalyser()), this.own(ctx.createAnalyser())];
    for (const [i, eye] of this.eyes.entries()) {
      eye.fftSize = 2048;
      this.split.connect(eye, i);
    }

    [this.mine, this.mineOut] = await this.side(ctx, 1);
    [this.theirs, this.theirsOut] = await this.side(ctx, 0);
  }

  /**
   * One imager, and the gain that is its half of the flip. The imager is
   * owned before its worklet is waited for, so a build that fails on the
   * second side still takes the first one down.
   */
  async side(ctx, listening) {
    const imager = this.own(new LiveImager(ctx));
    await imager.start();
    const gain = this.own(ctx.createGain());
    gain.gain.value = listening;
    imager.connect(gain).connect(this.bus);
    return [imager, gain];
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

    const done = runImager(left, right, rate, { ...STEREO_DEFAULTS, ...fault });
    const out = ctx.createBuffer(2, loop.length, rate);
    out.copyToChannel(done.left, 0);
    out.copyToChannel(done.right, 1);
    return out;
  }

  /** The material a reading is taken on: one bar of it, which is plenty. */
  sample(seconds = 2.5) {
    return this.windowOf(this.buffer, seconds);
  }

  /* ---------- the settings ---------- */

  setSettings(settings) {
    this.settings = { ...this.settings, ...settings };
    if (this.ready) this.mine.set(this.settings);
  }

  setTarget(settings) {
    this.target = settings ? { ...STEREO_DEFAULTS, ...settings } : null;
    if (this.ready && this.target) this.theirs.set(this.target);
  }

  /** Both sides at once: once the graph is up, and again at every play. */
  apply() {
    if (!this.ready) return;
    this.mine.set(this.settings);
    if (this.target) this.theirs.set(this.target);
  }

  // One source into both imagers, so the two sides are the same samples at
  // the same instant and the flip compares nothing but the two imagers.
  wire(at) {
    this.start(this.buffer, (node) => {
      node.connect(this.mine.input);
      node.connect(this.theirs.input);
    }, at);
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
}
