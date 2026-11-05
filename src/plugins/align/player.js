import {
  ALIGN_DEFAULTS, ALIGN_LIMITS, heldIn, farMic, alignPass, crossLag,
} from './pair.js';
import { LoopPlayer, GLIDE } from '../../lib/loop-player.js';

/** The pair a round has when it names none: a few metres, a little quieter. */
const PATH = { ms: 3.5, level: -4, flip: false };

/**
 * Two microphones on one source, through a delay and a polarity switch.
 *
 *   close ─┬─ delay ─┬─ yours:  close ─┐
 *          │         │          far ───┴─ yours ──┐
 *   far ───┼─ flip ──┤                            ├─ out
 *          │         └─ theirs: close ─┐          │
 *          └─────────────────── far ───┴─ theirs ─┘
 *
 * Both sides run from the same two buffer sources, started on the same stamp,
 * so flipping the A/B lands on the same bar and what changes is the
 * alignment and nothing else. That matters more here than anywhere else in
 * this app: the whole subject is a difference of a fraction of a millisecond,
 * and an A/B that restarted the loop would be comparing two different bars.
 *
 * The far microphone is a buffer rather than a graph. It could be built live
 * - a delay, a gain and a one-pole - but then the material would depend on
 * the audio clock, and the reading the face draws is taken over the samples.
 * Rendering it once means the arithmetic and the audio are the same pair.
 *
 * Starting, stopping, swapping the loop and taking it all down are
 * lib/loop-player.js's; what is here is only what is this tool's. This
 * tool's fault is not baked into the loop but is a second loop beside it -
 * the far microphone - so it is `path` rather than `fault`, and `prepare`
 * renders it once the base has fetched the close one.
 */
export class PairPlayer extends LoopPlayer {
  constructor(engine, { source = 'drums', path = null } = {}) {
    // Not spread: one microphone is one channel, and the far one is built
    // from the first of them.
    super(engine, { source, spread: false });
    // What the two microphones are: how far apart, how much quieter, and
    // whether one of them is wired backwards. The exercise sets this; the
    // settings cannot change it, which is the point of a fault.
    this.path = path ?? { ...PATH };
    this.settings = { ...ALIGN_DEFAULTS };
    this.target = null;
    this.close = null;
    this.far = null;
    this.farBuffer = null;
    this.reading = null;
    this.targetReading = null;
    // Where the two microphones line up, which is a property of the pair and
    // not of the settings - so it is measured when the pair is built and not
    // on every move of a knob. The curve on it is what the face draws.
    this.lag = null;
  }

  async raise(ctx) {
    this.meter = this.own(ctx.createAnalyser());
    this.meter.fftSize = 1024;
    this.meter.connect(this.engine.out);

    this.mine = this.side(ctx, 1);
    this.theirs = this.side(ctx, 0);

    // Each side's out is its place in the A/B, so the base's flip is this
    // tool's as it stands.
    this.mineOut = this.mine.out;
    this.theirsOut = this.theirs.out;
  }

  /** One alignment: its own delay, its own polarity, its own place in the A/B. */
  side(ctx, listening) {
    const out = this.own(ctx.createGain());
    out.gain.value = listening;
    out.connect(this.meter);

    // A second of maximum delay, which is forty times what the control can
    // ask for. A DelayNode cannot be lengthened after it is built.
    const delay = this.own(ctx.createDelay(1));
    delay.delayTime.value = 0;

    const closeGain = this.own(ctx.createGain());
    const farGain = this.own(ctx.createGain());
    closeGain.gain.value = 1;
    farGain.gain.value = 1;

    delay.connect(closeGain).connect(out);
    farGain.connect(out);

    return { out, delay, closeGain, farGain };
  }

  /* ---------- the material ---------- */

  /**
   * The close microphone, as the base fetches it, and the far one built
   * from it down the path. Synchronous after the base's wait, so a prepare
   * the base has let write is the one that builds the far mic too.
   */
  async prepare() {
    if (!(await super.prepare())) return false;

    const ctx = this.engine.ensure();
    const loop = this.buffer;
    const rate = loop.sampleRate;
    this.close = loop.getChannelData(0);

    // The second microphone, built from the first one down a path.
    const far = farMic(this.close, rate, this.path);
    this.farBuffer = ctx.createBuffer(1, far.length, rate);
    this.farBuffer.copyToChannel(far, 0);
    this.far = far;

    const pair = this.window();
    this.lag = pair ? crossLag(pair.close, pair.far, pair.rate) : null;

    this.measure();
    return true;
  }

  /**
   * The window a reading is taken over.
   *
   * Three seconds, which at 44.1 kHz is fifteen half-overlapping windows of
   * the spectrum and three times the second the correlation search uses.
   */
  window(seconds = 3) {
    if (!this.close) return null;
    const rate = this.engine.ctx?.sampleRate ?? 48000;
    const length = Math.min(this.close.length, Math.round(rate * seconds));
    return {
      close: this.close.subarray(0, length),
      far: this.far.subarray(0, length),
      rate,
    };
  }

  /* ---------- what the settings do ---------- */

  measure() {
    const pair = this.window();
    if (!pair) return null;

    this.reading = alignPass(pair, pair.rate, this.settings, this.lag).reading;
    this.targetReading = this.target
      ? alignPass(pair, pair.rate, this.target, this.lag).reading
      : null;

    this.push();
    return this.reading;
  }

  apply() {
    this.push();
  }

  /**
   * Both sides of the A/B, pointed at what they are set to.
   *
   * The target is aimed with the listener's own monitoring rather than its
   * own, every time and not only when it is set: an A/B where one side is
   * soloed and the other is summed is an A/B about soloing.
   */
  push() {
    if (!this.ready) return;
    const at = this.engine.ctx.currentTime;
    this.aim(this.mine, this.settings, at);
    if (this.target) this.aim(this.theirs, { ...this.target, hear: this.settings.hear }, at);
  }

  /**
   * One side, set.
   *
   * Everything ramps over eight milliseconds, as everywhere else here - and
   * `delayTime` especially, because a delay that jumps re-reads its line from
   * a different place and that is a click every time a knob moves. Ramped, it
   * is a pitch bend instead, which on a drum loop at a hundredth of a second
   * is inaudible.
   */
  aim(side, settings, at) {
    const delay = heldIn(settings.delay ?? 0, ALIGN_LIMITS.delay) / 1000;
    const blend = 10 ** (heldIn(settings.blend ?? 0, ALIGN_LIMITS.blend) / 20);
    const flip = settings.flip ? -1 : 1;
    const hear = settings.hear ?? 'sum';

    side.delay.delayTime.setTargetAtTime(delay, at, GLIDE);
    side.closeGain.gain.setTargetAtTime(hear === 'far' ? 0 : 1, at, GLIDE);
    side.farGain.gain.setTargetAtTime(hear === 'close' ? 0 : blend * flip, at, GLIDE);
  }

  setSettings(settings) {
    this.settings = { ...this.settings, ...settings };
    return this.measure();
  }

  setTarget(target) {
    this.target = target ? { ...ALIGN_DEFAULTS, ...target } : null;
    this.measure();
  }

  /**
   * A new pair, and heard if the loop is playing - a far mic changed under a
   * playing loop and not restarted is the old pair still sounding.
   */
  setPath(path) {
    this.path = { ...this.path, ...path };
    return this.refresh();
  }

  /** This tool's fault is its path; none is the pair a round has by default. */
  setFault(fault) {
    return this.setPath(fault ?? PATH);
  }

  /* ---------- transport ---------- */

  // Each microphone is one source feeding both sides, so the two sides of
  // the A/B are one pair of sources and cannot drift apart.
  wire(at) {
    this.start(this.buffer, (node) => {
      node.connect(this.mine.delay);
      node.connect(this.theirs.delay);
    }, at);
    this.start(this.farBuffer, (node) => {
      node.connect(this.mine.farGain);
      node.connect(this.theirs.farGain);
    }, at);
  }
}
