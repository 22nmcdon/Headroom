import { MOD_DEFAULTS } from './dsp.js';
import { modReading } from './trace.js';
import { LiveModulation } from './node.js';
import { LoopPlayer } from '../../lib/loop-player.js';

/**
 * The loop, running through two modulations you can flip between.
 *
 *   loop ─┬─ yours  ─┐
 *         └─ theirs ─┴─ meter ─ out
 *
 * Both are always running and always fed, so flipping is a pair of gains
 * rather than a rebuild. That matters more here than for most of the others:
 * these are the devices whose whole subject is something slow going round,
 * and an A/B that rebuilt a node would restart the sweep from the top every
 * time you pressed it - so you would be comparing two modulations at two
 * different moments of their own cycle, which is the one thing about a
 * modulation nobody is being asked to hear.
 *
 * There is no rendered-wet path and no impulse response. A modulation is not
 * a response - the whole device is the fact that it changes while the audio
 * goes past - and a loop rendered through one would start its sweep over at
 * every splice. See `node.js`.
 *
 * Starting, stopping, swapping the loop and taking it all down are
 * lib/loop-player.js's; what is here is only what is this tool's. That
 * includes the two flip gains, which this used to leave wired to the meter
 * on every close - one more node each visit that nothing would ever free.
 */
export class ModPlayer extends LoopPlayer {
  constructor(engine, { source = 'instrument' } = {}) {
    // The loop rendered in mono, as this has always asked for it: the two
    // channels that come out are the modulation's, not the render's.
    super(engine, { source, spread: false });
    this.settings = { ...MOD_DEFAULTS };
    this.target = null;
    this.samples = null;
    this.reading = null;
    this.targetReading = null;
  }

  async raise(ctx) {
    this.meter = this.own(ctx.createAnalyser());
    this.meter.fftSize = 1024;
    this.meter.connect(this.engine.out);

    // Each owned before its worklet is waited for, so a build that fails on
    // the second still takes the first one down.
    this.mine = this.own(new LiveModulation(ctx));
    await this.mine.start();
    this.theirs = this.own(new LiveModulation(ctx));
    await this.theirs.start();

    this.mineOut = this.own(ctx.createGain());
    this.theirsOut = this.own(ctx.createGain());
    this.mineOut.gain.value = 1;
    this.theirsOut.gain.value = 0;

    this.mine.connect(this.mineOut).connect(this.meter);
    this.theirs.connect(this.theirsOut).connect(this.meter);
  }

  /* ---------- the material ---------- */

  async prepare() {
    if (!(await super.prepare())) return false;
    this.samples = this.buffer.getChannelData(0);
    // The reading names the material it was taken on; see `measure`.
    this.measure();
    return true;
  }

  /* ---------- what the settings do ---------- */

  /**
   * What the oscillator is doing, which is not a measurement of the loop.
   *
   * The reading is the modulator's own path and needs no material at all -
   * see `trace.js` - so this is cheap and is taken whether or not anything is
   * playing. Which is also why the material is not pinned to it: a chorus
   * sweeps the same way over a drum loop and over a piano, and saying so is
   * what lets the exercise mark one against the other.
   */
  measure() {
    this.reading = modReading(this.settings, { source: this.source });
    this.targetReading = this.target
      ? modReading(this.target, { source: this.source })
      : null;
    this.push();
    return this.reading;
  }

  push() {
    if (!this.ready) return;
    this.mine.set(this.settings);
    if (this.target) this.theirs.set(this.target);
  }

  apply() {
    this.push();
  }

  setSettings(settings) {
    this.settings = { ...this.settings, ...settings };
    return this.measure();
  }

  setTarget(target) {
    this.target = target ? { ...MOD_DEFAULTS, ...target } : null;
    this.measure();
  }

  /* ---------- transport ---------- */

  // One source into both, so the two sweeps run over the same samples and
  // the flip lands on the same moment of the loop.
  wire(at) {
    this.start(this.buffer, (node) => {
      node.connect(this.mine.input);
      node.connect(this.theirs.input);
    }, at);
  }
}
