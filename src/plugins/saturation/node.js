import { shape, shaperCore, overKernel, MOST_BIAS, MOST_TONE, DC_CORNER } from './shape.js';
import { makeBiquad, setBiquad, runBiquad } from '../compressor/dsp.js';
import { workletModule, installWorklet } from '../../lib/worklet.js';

/**
 * The saturator, made audible.
 *
 * One channel of processing per channel of signal, and nothing reported back:
 * a saturator has nothing to say that is not already in what comes out of it,
 * and the two things the display wants - the transfer curve and the harmonic
 * series - are both arithmetic on the settings rather than measurements of
 * the sound, so neither of them needs the audio thread's help.
 *
 * The processing comes from `shape.js`, stringified, so the saturator you
 * hear is the same code that marks the guess.
 */

const HEAT_PARTS = [makeBiquad, setBiquad, runBiquad, shape, overKernel, shaperCore];

const HEAT_CONSTANTS = {
  OVERSAMPLE: 8,
  OVER_TAPS: 257,
  HEAT_LATENCY: 32,
  MOST_BIAS,
  MOST_TONE,
  DC_CORNER,
};

const HEAT_PROCESSOR = `class HeadroomSaturator extends AudioWorkletProcessor {
  constructor(options) {
    super();
    // One curve per channel. They share settings and nothing else - a
    // saturator that summed its channels to decide anything would be a
    // stereo effect, and this one is deliberately not.
    this.cores = [shaperCore(sampleRate), shaperCore(sampleRate)];
    // With the node, not in a message after it: see the imager for why.
    if (options && options.processorOptions) {
      for (const core of this.cores) core.set(options.processorOptions);
    }
    this.port.onmessage = (event) => {
      for (const core of this.cores) core.set(event.data);
    };
  }

  process(inputs, outputs) {
    const ins = inputs[0];
    const outs = outputs[0];
    if (!ins || !ins.length || !ins[0]) {
      for (const channel of outs) channel.fill(0);
      return true;
    }

    for (let c = 0; c < outs.length; c += 1) {
      const from = ins[c] || ins[0];
      const to = outs[c];
      const core = this.cores[c];
      for (let i = 0; i < to.length; i += 1) {
        core.step(from[i]);
        to[i] = core.out;
      }
    }

    return true;
  }
}

registerProcessor('headroom-saturator', HeadroomSaturator);`;

export function saturatorSource() {
  return workletModule({
    constants: HEAT_CONSTANTS,
    parts: HEAT_PARTS,
    processor: HEAT_PROCESSOR,
  });
}

/** One saturator in a graph, however it ended up being run. */
export class LiveSaturator {
  constructor(ctx) {
    this.ctx = ctx;
    this.settings = {};
    this.node = null;
    this.out = ctx.createGain();
  }

  get input() { return this.node; }

  connect(dest) { this.out.connect(dest); return dest; }

  async start() {
    const worklet = await installWorklet(this.ctx, saturatorSource());

    if (worklet) {
      this.node = new AudioWorkletNode(this.ctx, 'headroom-saturator', {
        processorOptions: { ...this.settings },
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
      });
    } else {
      // The old way: the same arithmetic, on the main thread. Eight times
      // oversampled shaping is the most expensive thing in this app, so a
      // browser that ends up here gets a larger block to work in.
      this.cores = [shaperCore(this.ctx.sampleRate), shaperCore(this.ctx.sampleRate)];
      for (const core of this.cores) core.set(this.settings);
      this.node = this.ctx.createScriptProcessor(2048, 2, 2);
      this.node.onaudioprocess = (event) => this.grind(event);
    }

    this.node.connect(this.out);
    return this;
  }

  grind(event) {
    for (let c = 0; c < event.outputBuffer.numberOfChannels; c += 1) {
      const from = event.inputBuffer.getChannelData(
        Math.min(c, event.inputBuffer.numberOfChannels - 1));
      const to = event.outputBuffer.getChannelData(c);
      const core = this.cores[c];
      for (let i = 0; i < to.length; i += 1) {
        core.step(from[i]);
        to[i] = core.out;
      }
    }
  }

  set(settings) {
    this.settings = { ...this.settings, ...settings };
    if (this.node?.port) this.node.port.postMessage(settings);
    else for (const core of this.cores ?? []) core.set(settings);
  }

  destroy() {
    try { this.node?.disconnect(); } catch { /* already gone */ }
    if (this.node) this.node.onaudioprocess = null;
    try { this.out.disconnect(); } catch { /* already gone */ }
  }
}
