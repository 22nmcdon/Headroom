import { liftFrequencies } from './filters.js';
import { averageSpectrum } from './spectrum.js';
import { eqSections, tuneSections } from './sections.js';

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
 * A chain is a fixed run of sections that are never added or removed, only
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
    this.auto = true;
    this.ready = false;
  }

  /**
   * Builds the graph once the browser will let us make sound.
   *
   * The promise is kept rather than the flag being checked, which matters now
   * that there is an await inside: `if (this.ready) return` was enough while
   * this was synchronous, and the moment it was not, two taps on Play would
   * both get past it and build the whole graph twice - two analysers, four
   * chains, the loop audible through both. The flag is still what every
   * setter reads, because what they want to know is whether there is anything
   * to tune yet.
   */
  build() {
    this.building ??= this.raise();
    return this.building;
  }

  async raise() {
    const ctx = this.engine.ensure();

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = this.ballistics ?? 0.72;
    this.analyser.connect(this.engine.out);

    // What went in, so what comes out can be read against it. The output
    // meter is the analyser itself: a level is taken from the time domain and
    // a spectrum from the frequency domain, and the smoothing that makes the
    // picture readable does not touch the samples.
    //
    // It is the one thing an EQ with auto gain has to show. Auto gain is
    // quietly undoing the level change your curve made, which is what makes
    // an A/B honest, and a face with no meters leaves you to take that on
    // trust.
    this.inMeter = ctx.createAnalyser();
    this.inMeter.fftSize = 2048;

    this.mine = await this.chain(ctx);
    this.theirs = await this.chain(ctx);

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
    this.faultNode.connect(this.inMeter);
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
   * The sections and the tuning both live in `sections.js`, which is the
   * EQ's own. This is the same chain the sketchpad puts on a track - it is
   * only that here it is handed a source and an analyser and there it is
   * handed whatever is upstream of it.
   */
  async chain(ctx) {
    const built = await eqSections(ctx, this.strip.length, { start: this.strip });

    const gain = ctx.createGain();
    gain.gain.value = 0;
    built.trim.connect(gain).connect(this.analyser);

    return { ...built, gain };
  }

  /** The shared tuning, under the name this class has always called it. */
  static tune(chain, bands, at, rate, weights, how) {
    tuneSections(chain, bands, at, rate, weights, how);
  }

  /** The tuning this player does, with its own auto gain switch on it. */
  tune(chain, bands) {
    const ctx = this.engine.ctx;
    EQPlayer.tune(chain, bands, ctx.currentTime, ctx.sampleRate, this.weights,
      { autoGain: this.auto });
  }

  /**
   * Whether the trim takes the curve's level change back off.
   *
   * On, an A/B is a comparison of two curves; off, it is a comparison of two
   * curves and the level each one happens to come with, which is the thing
   * that makes the louder one win every time. Both are worth hearing, which
   * is why the switch is on the face rather than the behaviour being picked
   * once by whoever wrote it.
   */
  setAuto(on) {
    this.auto = on;
    if (!this.ready) return;
    if (this.bands) this.tune(this.mine, this.bands);
    if (this.targetBands) this.tune(this.theirs, this.targetBands);
  }

  setBands(bands) {
    if (!this.ready) return;
    this.bands = bands;
    this.tune(this.mine, bands);
  }

  setTarget(bands) {
    if (!this.ready) return;
    this.targetBands = bands;
    this.tune(this.theirs, bands);
  }

  /** What the source is made of, so auto gain knows what a move is worth. */
  measure(buffer) {
    this.weights = averageSpectrum(buffer, liftFrequencies());
    // `this.strip` when nothing has set bands yet, which is the case the
    // first time Play is pressed. The chain already arrived with the strip on
    // it, so what this is really for is the auto gain: it is built with no
    // weights, and now there is material to weigh it against.
    this.setBands(this.bands ?? this.strip);
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
    await this.build();
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

  /**
   * What is going in and what is coming out, in decibels.
   *
   * Peak rather than average, read off the time domain: a meter on an EQ is
   * there to say whether the curve has pushed the signal somewhere it should
   * not be, and that is a question about the peaks.
   */
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
    return { input: read(this.inMeter), output: read(this.analyser) };
  }

  /** The spectrum, in dB, for drawing behind the curve. */
  spectrum() {
    if (!this.ready) return null;
    const bins = new Float32Array(this.analyser.frequencyBinCount);
    this.analyser.getFloatFrequencyData(bins);
    return bins;
  }
}
