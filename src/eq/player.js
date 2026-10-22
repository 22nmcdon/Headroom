import { liftFrequencies } from './filters.js';
import { averageSpectrum } from './spectrum.js';
import { eqSections, tuneSections } from '../core/effects.js';

/**
 * The loop, running through two EQ chains you can flip between.
 *
 *   loop ─┬─ yours  ─ gain ─┐
 *         └─ theirs ─ gain ─┴─ analyser ─ out
 *
 * Both chains are always built and always fed; switching is a pair of gains,
 * which is how an A/B on a desk works - the two paths stay in step to the
 * sample, so what you hear when you flip is the processing and nothing else.
 *
 * A chain is a fixed run of biquads that are never added or removed, only
 * retuned - four per band, because the steepest cut on offer is a cascade of
 * four. A band that is off, and a section its slope does not need, are left
 * transparent rather than unplugged: rebuilding the graph under a running
 * loop clicks.
 */
export class EQPlayer {
  constructor(engine, strip) {
    this.engine = engine;
    this.strip = strip;
    this.source = null;
    this.hearing = 'mine';
    this.ready = false;
  }

  /** Builds the graph once the browser will let us make sound. */
  build() {
    if (this.ready) return;
    const ctx = this.engine.ensure();

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = this.ballistics ?? 0.72;
    this.analyser.connect(this.engine.out);

    this.mine = this.chain(ctx);
    this.theirs = this.chain(ctx);

    // One band, on its own, for listening to what lives there.
    this.soloFilter = ctx.createBiquadFilter();
    this.soloFilter.type = 'bandpass';
    this.soloFilter.frequency.value = 1000;
    this.soloFilter.Q.value = 2;
    this.soloGain = ctx.createGain();
    this.soloGain.gain.value = 0;
    this.soloFilter.connect(this.soloGain).connect(this.analyser);
    this.soloing = null;
    // The fault, when there is one, is in the sample rather than in the EQ -
    // so it sits ahead of both chains and is heard whichever way you flip.
    this.faultNode = ctx.createBiquadFilter();
    this.faultNode.type = 'peaking';
    this.faultNode.frequency.value = 1000;
    this.faultNode.gain.value = 0;
    this.faultNode.connect(this.mine.input);
    this.faultNode.connect(this.theirs.input);
    // Solo is taken before the EQ: the question it answers is what is in the
    // sample at that frequency, not what your bands have done to it.
    this.faultNode.connect(this.soloFilter);

    // Ready before the first flip, not after: `hear` does nothing until the
    // graph exists, so setting this afterwards left both chains at zero gain
    // and the whole plugin silent.
    this.ready = true;
    this.hear('mine');
  }

  /**
   * One EQ, built out of circuit, ending at a gain of its own.
   *
   * The biquads and the tuning both live in `src/core/effects.js` now, which
   * is where everything that has two ends and can go in series lives. This
   * is the same chain the sketchpad puts on a track - it is only that here
   * it is handed a source and an analyser and there it is handed whatever is
   * upstream of it.
   */
  chain(ctx) {
    const built = eqSections(ctx, this.strip.length);

    const gain = ctx.createGain();
    gain.gain.value = 0;
    built.trim.connect(gain).connect(this.analyser);

    return { ...built, gain };
  }

  /** The shared tuning, under the name this class has always called it. */
  static tune(chain, bands, at, rate, weights) {
    tuneSections(chain, bands, at, rate, weights);
  }

  setBands(bands) {
    if (!this.ready) return;
    this.bands = bands;
    EQPlayer.tune(this.mine, bands, this.engine.ctx.currentTime, this.engine.ctx.sampleRate, this.weights);
  }

  setTarget(bands) {
    if (!this.ready) return;
    this.targetBands = bands;
    EQPlayer.tune(this.theirs, bands, this.engine.ctx.currentTime, this.engine.ctx.sampleRate, this.weights);
  }

  /** What the source is made of, so auto gain knows what a move is worth. */
  measure(buffer) {
    this.weights = averageSpectrum(buffer, liftFrequencies());
    if (this.bands) this.setBands(this.bands);
    if (this.targetBands) this.setTarget(this.targetBands);
  }

  /**
   * Listen to one band on its own - the part of the sample it is working on.
   *
   * What "its part" means depends on the band: a peak is the region around it,
   * a shelf is everything past its corner, and a cut is the thing it is
   * throwing away, which is the most useful of the three to hear.
   */
  setSolo(band) {
    if (!this.ready) return;
    const at = this.engine.ctx.currentTime;
    this.soloing = band ? { ...band } : null;

    if (band) {
      const listen = {
        peaking: 'bandpass',
        lowshelf: 'lowpass',
        highshelf: 'highpass',
        highpass: 'lowpass',
        lowpass: 'highpass',
      }[band.type];

      this.soloFilter.type = listen;
      this.soloFilter.frequency.setTargetAtTime(band.frequency, at, 0.01);
      this.soloFilter.Q.setTargetAtTime(listen === 'bandpass' ? Math.max(0.7, band.q) : 0.7, at, 0.01);
    }

    this.soloGain.gain.setTargetAtTime(band ? 1 : 0, at, 0.01);
    this.mine.gain.gain.setTargetAtTime(band ? 0 : (this.hearing === 'mine' ? 1 : 0), at, 0.01);
    this.theirs.gain.gain.setTargetAtTime(band ? 0 : (this.hearing === 'mine' ? 0 : 1), at, 0.01);
  }

  /** The fault baked into the sample, or nothing. */
  setFault(fault) {
    if (!this.ready) return;
    const at = this.engine.ctx.currentTime;
    this.faultNode.frequency.setTargetAtTime(fault ? fault.frequency : 1000, at, 0.01);
    this.faultNode.Q.setTargetAtTime(fault ? fault.q : 1, at, 0.01);
    this.faultNode.gain.setTargetAtTime(fault ? fault.gain : 0, at, 0.01);
  }

  /** Flip between your EQ and theirs, quickly enough to compare. */
  hear(which) {
    this.hearing = which;
    if (!this.ready || this.soloing) return;
    const at = this.engine.ctx.currentTime;
    this.mine.gain.gain.setTargetAtTime(which === 'mine' ? 1 : 0, at, 0.008);
    this.theirs.gain.gain.setTargetAtTime(which === 'mine' ? 0 : 1, at, 0.008);
  }

  /** Something the player brought themselves, decoded and kept for the session. */
  async load(file) {
    const ctx = this.engine.ensure();
    this.yours = await ctx.decodeAudioData(await file.arrayBuffer());
    return this.yours;
  }

  async play(kind) {
    this.build();
    const buffer = kind === 'yours' ? this.yours : await this.engine.renderLoop(kind);
    if (!buffer) return false;

    this.measure(buffer);
    this.stop();

    const source = this.engine.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(this.faultNode);
    source.start();
    this.source = source;
    return true;
  }

  stop() {
    if (!this.source) return;
    try { this.source.stop(); } catch { /* already stopped */ }
    this.source.disconnect();
    this.source = null;
  }

  get playing() {
    return this.source !== null;
  }

  /**
   * How fast the analyser follows what it is given.
   *
   * Fast catches the transients, slow shows the balance, and they are two
   * different questions about the same sound - which is why every analyser
   * ever built has this switch on it.
   */
  setBallistics(value) {
    this.ballistics = value;
    if (this.analyser) this.analyser.smoothingTimeConstant = value;
  }

  /** The spectrum, in dB, for drawing behind the curve. */
  spectrum() {
    if (!this.ready) return null;
    const bins = new Float32Array(this.analyser.frequencyBinCount);
    this.analyser.getFloatFrequencyData(bins);
    return bins;
  }
}
