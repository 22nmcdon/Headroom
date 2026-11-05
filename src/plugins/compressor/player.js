import { COMP_DEFAULTS } from './dsp.js';
import { reductionPass } from './reading.js';
import { LiveCompressor } from './node.js';
import { LoopPlayer } from '../../lib/loop-player.js';

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
 *
 * Starting, stopping, swapping the loop and taking it all down are
 * lib/loop-player.js's; what is here is only what is this tool's. The one
 * place this player's material is more than the base's is that it is three
 * renders rather than one - the signal, the key, and the bed without its
 * fault - which is what `material` and `prepare` below are about.
 *
 * The compressor (and the Gate and De-esser faces in aimed.js, which are
 * this player under other knobs) has no fault to bake: its fault is how
 * uneven the bed was rendered, so `setFault` re-renders rather than bakes.
 */
export class CompPlayer extends LoopPlayer {
  constructor(engine, { source = 'drums', key = null, uneven = 0 } = {}) {
    super(engine, { source, spread: false });
    this.key = key;
    this.uneven = uneven;
    this.settings = { ...COMP_DEFAULTS };
    this.target = null;
    this.auto = true;
    this.samples = null;
    // The material as channels, which is what a reading is taken over. One
    // entry for a bed, two for a stereo file somebody loaded - see
    // `analyseStereo` for why the second one matters.
    this.channels = null;
    this.keyBuffer = null;
    this.keySamples = null;
    this.trace = null;      // reused between passes
    this.reading = null;    // what the last pass found
    this.evenSamples = null; // the bed with the fault taken out, for marking
  }

  async raise(ctx) {
    this.outMeter = this.own(ctx.createAnalyser());
    this.outMeter.fftSize = 1024;
    this.outMeter.connect(this.engine.out);

    this.inMeter = this.own(ctx.createAnalyser());
    this.inMeter.fftSize = 1024;

    this.mine = this.own(await new LiveCompressor(ctx).start());
    this.theirs = this.own(await new LiveCompressor(ctx).start());

    // The A/B, under the base's names for it, so the base's flip is this one.
    this.mineOut = this.own(ctx.createGain());
    this.mineOut.gain.value = 1;
    this.theirsOut = this.own(ctx.createGain());
    this.theirsOut.gain.value = 0;

    this.mine.connect(this.mineOut).connect(this.outMeter);
    this.theirs.connect(this.theirsOut).connect(this.outMeter);

    // The trigger, heard as itself. It is the same on both sides of the A/B,
    // so it sits outside the switch.
    this.keyThrough = this.own(ctx.createGain());
    this.keyThrough.connect(this.outMeter);
  }

  /* ---------- the material ---------- */

  /**
   * The signal, and beside it the key and the even bed, all rendered at once.
   *
   * The base asks for one loop and keeps whichever was asked for last; this
   * one hands it the signal and leaves the other two where `prepare` will
   * find them - but only when it is still the last one asked, so a slow
   * render for a sample somebody has since moved off cannot leave its key
   * beside the newer signal.
   */
  async material() {
    const asked = this.asked;
    const [signal, key, even] = await Promise.all([
      this.source === 'yours'
        ? this.yours
        : this.engine.renderLoop(this.source, { uneven: this.uneven }),
      this.key ? this.engine.renderLoop(this.key) : null,
      // The same bed without the fault in it, and never played: it is what
      // evening the loop out is aiming at, which makes it the answer rather
      // than a clue. Rendered here because the fault is set here - the
      // exercise used to render it itself, in an unawaited block, which is
      // how scoring ended up able to fall back to a synthetic probe.
      this.uneven && this.source !== 'yours' ? this.engine.renderLoop(this.source) : null,
    ]);
    if (asked === this.asked) this.alongside = { key, even };
    return signal;
  }

  /** Renders what this exercise runs on, without needing to play it. */
  async prepare() {
    if (!(await super.prepare())) return false;
    const signal = this.buffer;
    const { key, even } = this.alongside ?? {};

    // Two at most: the compressor's gain is one gain across the channels, so
    // a pair is all the detector can be told apart by, and nothing upstream
    // of here has ever been more than stereo.
    this.channels = [];
    for (let c = 0; c < Math.min(2, signal.numberOfChannels); c += 1) {
      this.channels.push(signal.getChannelData(c));
    }
    // Still here, and still one array, for everything that wants a length or
    // a picture rather than a measurement.
    this.samples = this.channels[0];

    // The two stems are the same loop length, so they line up sample for
    // sample; a key that drifted against the signal would duck the wrong beat.
    this.keyBuffer = key ?? null;
    this.keySamples = key ? key.getChannelData(0) : null;

    this.evenBuffer = even ?? signal;
    this.evenSamples = this.evenBuffer.getChannelData(0);

    this.measure();
    return true;
  }

  /**
   * Whatever was read off the last material, let go of as soon as the
   * material is changing, so nothing is drawn or marked against a loop that
   * is on its way out. The loop itself keeps playing until the new one is
   * ready to take its place.
   */
  forget() {
    this.samples = null;
    this.channels = null;
  }

  setSource(id) {
    this.forget();
    return super.setSource(id);
  }

  /**
   * How uneven the bed is, which is this tool's fault: not a filter in the
   * path but how far apart the hits are before you touch them, so setting it
   * renders the material again and plays the new one if the old was playing.
   */
  setFault(fault) {
    this.fault = fault ?? null;
    this.uneven = typeof fault === 'number' ? fault : (fault?.uneven ?? 0);
    this.forget();
    return this.refresh();
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
    const mine = reductionPass(
      this.channels, rate, this.settings, this.keySamples, this.trace);
    this.reading = mine.reading;
    this.trace = mine.trace;

    if (this.target) {
      const theirs = reductionPass(
        this.channels, rate, this.target, this.keySamples, this.targetTrace);
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

  /**
   * What the base asks for once the graph is up and before every play: the
   * settings onto the audio thread, and the key heard only when there is one.
   * Per play rather than once, because the key travels with the source now
   * and a round can take it away again.
   */
  apply() {
    if (!this.ready) return;
    this.keyThrough.gain.value = this.keyBuffer ? 1 : 0;
    this.push();
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

  /**
   * Both stems start on the same stamp, or the kick lands on the wrong
   * eighth of the bass and the whole exercise is about a different bar. The
   * base hands every `start` here the one `at`, which is what keeps them so.
   */
  wire(at) {
    this.start(this.buffer, (node) => {
      node.connect(this.inMeter);
      node.connect(this.mine.input, 0, 0);
      node.connect(this.theirs.input, 0, 0);
    }, at);

    if (this.keyBuffer) {
      this.start(this.keyBuffer, (node) => {
        node.connect(this.mine.keyIn, 0, this.mine.keyAt);
        node.connect(this.theirs.keyIn, 0, this.theirs.keyAt);
        node.connect(this.keyThrough);
      }, at);
    }
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
}
