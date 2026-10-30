import { MOD_DEFAULTS } from './dsp.js';
import { modReading } from './trace.js';
import { LiveModulation } from './node.js';

/**
 * The loop, running through two modulations you can flip between.
 *
 *   loop ─┬─ yours  ─┐
 *         └─ theirs ─┴─ out
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
 */
export class ModPlayer {
  constructor(engine, { source = 'instrument' } = {}) {
    this.engine = engine;
    this.source = source;
    this.hearing = 'mine';
    this.settings = { ...MOD_DEFAULTS };
    this.target = null;
    this.ready = false;
    this.buffer = null;
    this.samples = null;
    this.reading = null;
    this.targetReading = null;
  }

  async build() {
    if (this.ready) return;
    const ctx = this.engine.ensure();

    this.meter = ctx.createAnalyser();
    this.meter.fftSize = 1024;
    this.meter.connect(this.engine.out);

    this.mine = await new LiveModulation(ctx).start();
    this.theirs = await new LiveModulation(ctx).start();

    this.mineGain = ctx.createGain();
    this.theirsGain = ctx.createGain();
    this.mineGain.gain.value = 1;
    this.theirsGain.gain.value = 0;

    this.mine.connect(this.mineGain).connect(this.meter);
    this.theirs.connect(this.theirsGain).connect(this.meter);

    this.ready = true;
    this.push();
  }

  /* ---------- the material ---------- */

  async prepare() {
    const loop = this.source === 'yours'
      ? this.yours
      : await this.engine.renderLoop(this.source);
    if (!loop) return false;

    this.buffer = loop;
    this.samples = loop.getChannelData(0);
    this.measure();
    return true;
  }

  async load(file) {
    const ctx = this.engine.ensure();
    this.yours = await ctx.decodeAudioData(await file.arrayBuffer());
    return this.yours;
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

  setSettings(settings) {
    this.settings = { ...this.settings, ...settings };
    return this.measure();
  }

  setTarget(target) {
    this.target = target ? { ...MOD_DEFAULTS, ...target } : null;
    this.measure();
  }

  /* ---------- transport ---------- */

  hear(which) {
    this.hearing = which;
    if (!this.ready) return;
    const at = this.engine.ctx.currentTime;
    this.mineGain.gain.setTargetAtTime(which === 'mine' ? 1 : 0, at, 0.008);
    this.theirsGain.gain.setTargetAtTime(which === 'mine' ? 0 : 1, at, 0.008);
  }

  async play() {
    await this.build();
    if (!this.samples) await this.prepare();
    if (!this.samples) return false;

    this.stop();
    const ctx = this.engine.ctx;
    const at = ctx.currentTime + 0.08;

    this.node = ctx.createBufferSource();
    this.node.buffer = this.buffer;
    this.node.loop = true;
    this.node.connect(this.mine.input);
    this.node.connect(this.theirs.input);
    this.node.start(at);

    this.playing = true;
    return true;
  }

  stop() {
    if (this.node) {
      try { this.node.stop(); } catch { /* already stopped, which is fine */ }
      this.node.disconnect();
    }
    this.node = null;
    this.playing = false;
  }

  destroy() {
    this.stop();
    this.mine?.destroy();
    this.theirs?.destroy();
  }
}
