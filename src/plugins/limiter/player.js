import {
  CEIL_DEFAULTS, CEIL_DRIVE, CEIL_OUTPUT, ceilingOptions, heldTo,
} from './ceiling.js';
import { makeLimiterNode } from '../../lib/limiter-node.js';
import { LoopPlayer, GLIDE } from '../../lib/loop-player.js';

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
 * rebuild - and both run off the one source, so the flip lands on the same
 * bar of music rather than at the beginning.
 *
 * Starting, stopping, swapping the loop and taking it all down are
 * lib/loop-player.js's; what is here is only what is this tool's.
 */
export class CeilingPlayer extends LoopPlayer {
  constructor(engine, { source = 'mix' } = {}) {
    super(engine, { source });
    this.settings = { ...CEIL_DEFAULTS };
  }

  /** What the limiter node is built with, from the same function as the reading. */
  limiterOptions() {
    return ceilingOptions(this.settings);
  }

  async raise(ctx) {
    this.drive = this.own(ctx.createGain());
    this.trim = this.own(ctx.createGain());
    this.bypass = this.own(ctx.createGain());
    this.drive.gain.value = 1;
    this.trim.gain.value = 1;
    this.bypass.gain.value = 1;

    // The real thing, off lib/limiter.js, with its knobs reachable while it
    // runs - which is why that file grew a `set`. Rebuilding the node per
    // step of a dragged ceiling would be a new delay line and a click a step.
    // Its `destroy` stops the processor for good as well as unplugging it,
    // and that is what `own` has called on it when the tool closes.
    this.limiter = this.own(await makeLimiterNode(ctx, this.limiterOptions()));

    // The bypass side's out is `theirsOut`, so the base's flip is this
    // tool's A/B as it stands.
    this.mineOut = this.own(ctx.createGain());
    this.theirsOut = this.own(ctx.createGain());
    this.mineOut.gain.value = 1;
    this.theirsOut.gain.value = 0;

    this.drive.connect(this.limiter.in);
    this.limiter.out.connect(this.trim).connect(this.mineOut).connect(this.engine.out);
    this.bypass.connect(this.theirsOut).connect(this.engine.out);
  }

  /* ---------- the material ---------- */

  /**
   * The loop with somebody else's trim already on it.
   *
   * A limiter's exercises do not generally need one - the drill puts the
   * limiter on the tool rather than into the material, because a limiter
   * doing six decibels is a limiter and not a faulty loop. What a fault is
   * for here is the case where the loop arrives too hot to begin with, which
   * is the ordinary state of a mix handed to a mastering engineer.
   *
   * Which is also why the bypass is fed the loop with the fault in it and
   * not `raw`: the fault is the mix as it was handed over, and what the
   * bypass is the other side of is the limiter, not the trim.
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

  /**
   * And the same window of the loop as the bypass hears it: as it arrived at
   * the limiter, fault and all - which is the same window as `sample`.
   */
  untreated(seconds = 3) {
    return this.windowOf(this.buffer, seconds);
  }

  /* ---------- the settings ---------- */

  setSettings(settings) {
    this.settings = { ...this.settings, ...settings };
    this.apply();
  }

  apply() {
    if (!this.ready) return;

    const at = this.engine.ctx.currentTime;
    const drive = 10 ** (heldTo(this.settings.drive ?? 0, CEIL_DRIVE) / 20);
    const trim = 10 ** (heldTo(this.settings.output ?? 0, CEIL_OUTPUT) / 20);

    // Ramped, because both of these are dragged and a gain that jumps between
    // blocks clicks. Eight milliseconds, as everywhere else here.
    this.drive.gain.setTargetAtTime(drive, at, GLIDE);
    this.trim.gain.setTargetAtTime(trim, at, GLIDE);
    this.limiter.set?.(this.limiterOptions());
  }

  /** The deepest reduction the audio thread has seen since this was asked. */
  reduction() {
    return this.limiter?.readReduction?.() ?? 0;
  }

  /* ---------- transport ---------- */

  // One source into both sides, so the two cannot be so much as a sample
  // apart and the A/B is the limiter and nothing else.
  wire(at) {
    this.start(this.buffer, (node) => {
      node.connect(this.drive);
      node.connect(this.bypass);
    }, at);
  }
}
