import { COMP_DEFAULTS } from './dsp.js';
import { reductionPass } from './reading.js';
import { LiveCompressor } from './node.js';

/**
 * The loop, running through two compressors you can flip between.
 *
 *   signal ─┬─ yours  ─┐
 *           ├─ theirs ─┤
 *   key ────┼──────────┼─ (into each detector, on its own channel)
 *           └──────────┴─ heard straight through ─┬─ out
 *                          yours / theirs, switched ┘
 *
 * Both compressors are always running and always fed, so flipping is a pair
 * of gains rather than a rebuild - the two paths stay in step to the sample,
 * and what you hear when you flip is the compression and nothing else.
 *
 * The key is a stem of its own rather than a filter on the signal. A
 * sidechain is a second recording: the kick that the bass has to get out of
 * the way of. It reaches both detectors, and it is also heard unprocessed,
 * because a duck you cannot hear the trigger for is just a level drop.
 */
export class CompPlayer {
  constructor(engine, { source = 'drums', key = null, uneven = 0 } = {}) {
    this.engine = engine;
    this.source = source;
    this.key = key;
    this.uneven = uneven;
    this.hearing = 'mine';
    this.settings = { ...COMP_DEFAULTS };
    this.target = null;
    this.auto = true;
    this.ready = false;
    this.samples = null;
    this.keySamples = null;
    this.trace = null;      // reused between passes
    this.reading = null;    // what the last pass found
    this.evenSamples = null; // the bed with the fault taken out, for marking
  }

  async build() {
    if (this.ready) return;
    const ctx = this.engine.ensure();

    this.outMeter = ctx.createAnalyser();
    this.outMeter.fftSize = 1024;
    this.outMeter.connect(this.engine.out);

    this.inMeter = ctx.createAnalyser();
    this.inMeter.fftSize = 1024;

    this.mine = await new LiveCompressor(ctx).start();
    this.theirs = await new LiveCompressor(ctx).start();

    this.mineGain = ctx.createGain();
    this.mineGain.gain.value = 1;
    this.theirsGain = ctx.createGain();
    this.theirsGain.gain.value = 0;

    this.mine.connect(this.mineGain).connect(this.outMeter);
    this.theirs.connect(this.theirsGain).connect(this.outMeter);

    // The trigger, heard as itself. It is the same on both sides of the A/B,
    // so it sits outside the switch.
    this.keyThrough = ctx.createGain();
    this.keyThrough.gain.value = this.key ? 1 : 0;
    this.keyThrough.connect(this.outMeter);

    this.ready = true;
    this.push();
  }

  /* ---------- the material ---------- */

  /** Renders what this exercise runs on, without needing to play it. */
  async prepare() {
    const signal = this.source === 'yours'
      ? this.yours
      : await this.engine.renderLoop(this.source, { uneven: this.uneven });
    if (!signal) return false;

    this.buffer = signal;
    this.samples = signal.getChannelData(0);

    if (this.key) {
      const key = await this.engine.renderLoop(this.key);
      this.keyBuffer = key;
      // The two stems are the same loop length, so they line up sample for
      // sample; a key that drifted against the signal would duck the wrong beat.
      this.keySamples = key.getChannelData(0);
    } else {
      this.keyBuffer = null;
      this.keySamples = null;
    }

    // The same bed without the fault in it, and never played: it is what
    // evening the loop out is aiming at, which makes it the answer rather
    // than a clue. Rendered here because the fault is set here - the exercise
    // used to render it itself, in an unawaited block, which is how scoring
    // ended up able to fall back to a synthetic probe.
    this.evenBuffer = this.uneven && this.source !== 'yours'
      ? await this.engine.renderLoop(this.source)
      : signal;
    this.evenSamples = this.evenBuffer.getChannelData(0);

    this.measure();
    return true;
  }

  /** Something the player brought themselves. */
  async load(file) {
    const ctx = this.engine.ensure();
    this.yours = await ctx.decodeAudioData(await file.arrayBuffer());
    return this.yours;
  }

  /* ---------- what the settings do ---------- */

  /**
   * One pass of the compressor over the whole loop, so the display can show
   * what these settings do to this material and the level can be matched.
   *
   * Coalesced by the plugin rather than run per frame: it is a real pass over
   * five seconds of audio, which is tens of milliseconds. The meter on the
   * screen comes from the audio thread and is live; this is the scope.
   */
  measure() {
    if (!this.samples) return null;

    const rate = this.engine.ctx?.sampleRate ?? 48000;

    // The reading is the framed form and the trace is the per-sample one.
    // Both come out of the same pass, and they were both called "the
    // reading" until the contract made it necessary to say which was which:
    // the display draws a quarter of a million points, the scoring compares
    // frames of five milliseconds, and they are not the same type.
    const mine = reductionPass(this.samples, rate, this.settings, this.keySamples, this.trace);
    this.reading = mine.reading;
    this.trace = mine.trace;

    if (this.target) {
      const theirs = reductionPass(
        this.samples, rate, this.target, this.keySamples, this.targetTrace);
      this.targetReading = theirs.reading;
      this.targetTrace = theirs.trace;
    }

    this.push();
    return this.reading;
  }

  /** Hands the current settings, and the level they need, to the audio thread. */
  push() {
    if (!this.ready) return;

    const makeup = (fitted, reading) => (this.auto
      ? (reading?.values?.makeup ?? 0)
      : (fitted.makeup ?? 0));

    this.mine.set({ ...this.settings, makeup: makeup(this.settings, this.reading) });
    if (this.target) {
      this.theirs.set({ ...this.target, makeup: makeup(this.target, this.targetReading) });
    }
  }

  setSettings(settings) {
    this.settings = { ...this.settings, ...settings };
    return this.measure();
  }

  setTarget(target) {
    this.target = target ? { ...COMP_DEFAULTS, ...target } : null;
    this.measure();
  }

  setAuto(on) {
    this.auto = on;
    this.push();
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
    // Both stems start on the same stamp, or the kick lands on the wrong
    // eighth of the bass and the whole exercise is about a different bar.
    const at = ctx.currentTime + 0.08;

    this.signalNode = ctx.createBufferSource();
    this.signalNode.buffer = this.buffer;
    this.signalNode.loop = true;
    this.signalNode.connect(this.inMeter);
    this.signalNode.connect(this.mine.input, 0, 0);
    this.signalNode.connect(this.theirs.input, 0, 0);

    if (this.keyBuffer) {
      this.keyNode = ctx.createBufferSource();
      this.keyNode.buffer = this.keyBuffer;
      this.keyNode.loop = true;
      this.keyNode.connect(this.mine.input, 0, 1);
      this.keyNode.connect(this.theirs.input, 0, 1);
      this.keyNode.connect(this.keyThrough);
      this.keyNode.start(at);
    }

    this.signalNode.start(at);
    this.startedAt = at;
    return true;
  }

  stop() {
    for (const node of [this.signalNode, this.keyNode]) {
      if (!node) continue;
      try { node.stop(); } catch { /* already stopped */ }
      node.disconnect();
    }
    this.signalNode = null;
    this.keyNode = null;
  }

  get playing() {
    return Boolean(this.signalNode);
  }

  /** Where the loop has got to, as a fraction of it - for the playhead. */
  get position() {
    if (!this.playing || !this.buffer) return null;
    const on = this.engine.ctx.currentTime - this.startedAt;
    if (on < 0) return 0;
    return (on % this.buffer.duration) / this.buffer.duration;
  }

  /** The deepest reduction the audio thread has applied since last asked. */
  reduction() {
    if (!this.ready) return 0;
    const side = this.hearing === 'mine' ? this.mine : this.theirs;
    return side.readReduction();
  }

  /** Peak level either side of the compressor, in dB. */
  levels() {
    if (!this.ready) return { input: -60, output: -60 };
    const read = (analyser) => {
      const frame = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(frame);
      let peak = 0;
      for (const sample of frame) {
        const level = sample < 0 ? -sample : sample;
        if (level > peak) peak = level;
      }
      return 20 * Math.log10(peak + 1e-6);
    };
    return { input: read(this.inMeter), output: read(this.outMeter) };
  }

  destroy() {
    this.stop();
    this.mine?.destroy();
    this.theirs?.destroy();
    try { this.keyThrough?.disconnect(); } catch { /* already gone */ }
    try { this.outMeter?.disconnect(); } catch { /* already gone */ }
    this.ready = false;
  }
}
