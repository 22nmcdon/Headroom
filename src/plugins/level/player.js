import { LEVEL_DEFAULTS, gainOf, runTrim } from './gain.js';
import { LoopPlayer, GLIDE } from '../../lib/loop-player.js';

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
 *
 * Starting, stopping, swapping the loop and taking it all down are
 * lib/loop-player.js's; what is here is only what is this tool's.
 */
export class LevelPlayer extends LoopPlayer {
  constructor(engine, { source = 'mix' } = {}) {
    super(engine, { source });
    this.settings = { ...LEVEL_DEFAULTS };
  }

  async raise(ctx) {
    this.mine = this.own(ctx.createGain());
    this.theirs = this.own(ctx.createGain());
    this.mine.gain.value = gainOf(this.settings.trim ?? 0);
    this.theirs.gain.value = 1;

    // The flip, as a second pair of gains after the trim. Two stages rather
    // than one, because the trim is what is being set and the flip is what is
    // being monitored, and folding them together would mean the trim knob
    // jumped whenever somebody pressed A/B.
    this.mineOut = this.own(ctx.createGain());
    this.theirsOut = this.own(ctx.createGain());
    this.mineOut.gain.value = 1;
    this.theirsOut.gain.value = 0;

    this.mine.connect(this.mineOut).connect(this.engine.out);
    this.theirs.connect(this.theirsOut).connect(this.engine.out);
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

  /**
   * The material a reading is taken on.
   *
   * Four seconds rather than the two and a half the imager takes, because an
   * integrated loudness is built from 400 ms blocks and a short reading is a
   * handful of them. The gate throws away anything under -70 LUFS, so a
   * passage that happens to be quiet costs blocks rather than just precision.
   */
  sample(seconds = 4) {
    return this.windowOf(this.buffer, seconds);
  }

  /** And the same window of the material before the fault, for the A/B. */
  untreated(seconds = 4) {
    return this.windowOf(this.raw, seconds);
  }

  setSettings(settings) {
    this.settings = { ...this.settings, ...settings };
    this.apply();
  }

  apply() {
    if (!this.ready) return;
    // Ramped rather than set, because a trim is dragged and a gain that jumps
    // between blocks clicks. Eight milliseconds is short enough that the A/B
    // is still a comparison of the same instant.
    this.mine.gain.setTargetAtTime(gainOf(this.settings.trim ?? 0), this.engine.ctx.currentTime, GLIDE);
  }

  // The untreated side runs from the raw loop, in step with the other, so the
  // flip lands on the same bar of music rather than the beginning.
  wire(at) {
    this.start(this.buffer, (node) => node.connect(this.mine), at);
    if (this.raw) this.start(this.raw, (node) => node.connect(this.theirs), at);
  }
}
