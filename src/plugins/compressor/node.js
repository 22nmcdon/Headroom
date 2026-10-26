import { makeBiquad, setBiquad, runBiquad } from '../../lib/dsp.js';
import { compressorCore, staticGain, MOST_LOOKAHEAD, PEAK_HOLD } from './dsp.js';
import { workletModule, installWorklet } from '../../lib/worklet.js';

/**
 * The compressor, made audible.
 *
 * The worklet is written out of the DSP's own source - see `fx/worklet.js`
 * for why. What is here is the part that is the compressor's own: two
 * channels in, the signal on the left and the key on the right, one out, and
 * the deepest reduction since anybody last looked.
 *
 * A ScriptProcessor stands behind it. AudioWorklet needs a module loaded from
 * a URL, and this page is published as a single file that may be served under
 * a policy that will not have one; the fallback is deprecated and runs on the
 * main thread, and it is still a working compressor where the good path is
 * refused.
 */

/** The functions the audio thread needs, in the order they are defined. */
const COMPRESSOR_PARTS = [staticGain, makeBiquad, setBiquad, runBiquad, compressorCore];

/**
 * The module-level values those functions read.
 *
 * Written out as a table rather than spelled into the template below, for two
 * reasons. The value is taken from the real constant, so the audio thread
 * cannot drift from the module. And the declarations never appear as source in
 * this file, which keeps the bundler's duplicate-name check from reading a
 * string as a second declaration of something `dsp.js` already owns.
 */
const CONSTANTS = { MOST_LOOKAHEAD, PEAK_HOLD };

/** How often the audio thread reports what it is doing, in samples. */
const REPORT = 512;

/** The compressor's own process(): what its inputs mean, and what it reports. */
const COMPRESSOR_PROCESSOR = `class HeadroomCompressor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.core = compressorCore(sampleRate);
    this.deepest = 0;
    this.since = 0;
    // With the node, not in a message after it: see the imager for why.
    if (options?.processorOptions) this.core.set(options.processorOptions);
    this.port.onmessage = (event) => this.core.set(event.data);
  }

  process(inputs, outputs) {
    const out = outputs[0][0];
    const signal = inputs[0][0];
    const key = inputs[0][1];

    if (!signal) { out.fill(0); return true; }

    for (let i = 0; i < out.length; i += 1) {
      out[i] = this.core.step(signal[i], key ? key[i] : 0);
      if (this.core.reduction < this.deepest) this.deepest = this.core.reduction;
    }

    this.since += out.length;
    if (this.since >= ${REPORT}) {
      this.port.postMessage(this.deepest);
      this.deepest = 0;
      this.since = 0;
    }

    return true;
  }
}

registerProcessor('headroom-compressor', HeadroomCompressor);`;

/** The worklet, as source. */
export function workletSource() {
  return workletModule({ constants: CONSTANTS, parts: COMPRESSOR_PARTS, processor: COMPRESSOR_PROCESSOR });
}

/**
 * One compressor in a graph, however it ended up being run.
 *
 * Two channels in - the signal on the left, the key on the right - and one
 * out. The key is a channel rather than a second input because that is the
 * one shape both the worklet and the ScriptProcessor can be given.
 */
export class LiveCompressor {
  constructor(ctx) {
    this.ctx = ctx;
    this.settings = {};
    this.pending = 0;    // the deepest reduction since anyone last looked
    this.node = null;
    this.merge = ctx.createChannelMerger(2);
    this.out = ctx.createGain();
  }

  /** Where the signal goes, and where the sidechain key goes. */
  get input() { return this.merge; }

  connect(dest) { this.out.connect(dest); return dest; }

  async start() {
    const worklet = await installWorklet(this.ctx, workletSource());

    if (worklet) {
      this.node = new AudioWorkletNode(this.ctx, 'headroom-compressor', {
        processorOptions: { ...this.settings },
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'discrete',
      });
      this.node.port.onmessage = (event) => this.report(event.data);
    } else {
      // The old way: the same arithmetic, on the main thread.
      this.core = compressorCore(this.ctx.sampleRate);
      this.core.set(this.settings);
      this.node = this.ctx.createScriptProcessor(512, 2, 1);
      this.node.onaudioprocess = (event) => this.grind(event);
    }

    this.merge.connect(this.node);
    this.node.connect(this.out);
    return this;
  }

  grind(event) {
    const signal = event.inputBuffer.getChannelData(0);
    const key = event.inputBuffer.numberOfChannels > 1
      ? event.inputBuffer.getChannelData(1)
      : null;
    const out = event.outputBuffer.getChannelData(0);

    for (let i = 0; i < out.length; i += 1) {
      out[i] = this.core.step(signal[i], key ? key[i] : 0);
      if (this.core.reduction < this.pending) this.pending = this.core.reduction;
    }
  }

  report(deepest) {
    if (deepest < this.pending) this.pending = deepest;
  }

  /** The deepest reduction since this was last asked, and a fresh start. */
  readReduction() {
    const deepest = this.pending;
    this.pending = 0;
    return deepest;
  }

  set(settings) {
    this.settings = { ...this.settings, ...settings };
    if (this.node?.port) this.node.port.postMessage(settings);
    else this.core?.set(settings);
  }

  destroy() {
    try { this.node?.disconnect(); } catch { /* already gone */ }
    if (this.node) this.node.onaudioprocess = null;
    try { this.merge.disconnect(); } catch { /* already gone */ }
    try { this.out.disconnect(); } catch { /* already gone */ }
  }
}
