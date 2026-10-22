import { imagerCore } from './field.js';
import { makeBiquad, setBiquad, runBiquad } from '../comp/dsp.js';
import { workletModule, installWorklet } from '../fx/worklet.js';

/**
 * The imager, made audible.
 *
 * Two channels in and two out, and nothing reported back: unlike a
 * compressor, an imager has nothing to say that is not already in what comes
 * out of it, and what the display wants - a goniometer and a correlation -
 * is read off the output with an analyser like any other meter.
 *
 * The processing itself comes from `field.js`, stringified, so the imager you
 * hear is the same code that marks the guess.
 */

const IMAGER_PARTS = [makeBiquad, setBiquad, runBiquad, imagerCore];

const IMAGER_PROCESSOR = `class HeadroomImager extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.core = imagerCore(sampleRate);
    // The opening settings arrive with the node rather than in a message
    // after it. A message is delivered when the main thread next gets a
    // turn, and an offline render does not wait for one - so the first
    // audio through here was processed at the defaults, and a render short
    // enough was processed at the defaults all the way through.
    if (options?.processorOptions) this.core.set(options.processorOptions);
    this.port.onmessage = (event) => this.core.set(event.data);
  }

  process(inputs, outputs) {
    const outL = outputs[0][0];
    const outR = outputs[0][1];
    const left = inputs[0][0];
    // A mono source is the same thing in both ears, which is a perfectly
    // good stereo signal with no side in it.
    const right = inputs[0][1] || inputs[0][0];

    if (!left) { outL.fill(0); outR.fill(0); return true; }

    for (let i = 0; i < outL.length; i += 1) {
      this.core.step(left[i], right[i]);
      outL[i] = this.core.outL;
      outR[i] = this.core.outR;
    }

    return true;
  }
}

registerProcessor('headroom-imager', HeadroomImager);`;

export function imagerSource() {
  return workletModule({ parts: IMAGER_PARTS, processor: IMAGER_PROCESSOR });
}

/** One imager in a graph, however it ended up being run. */
export class LiveImager {
  constructor(ctx) {
    this.ctx = ctx;
    this.settings = {};
    this.node = null;
    this.out = ctx.createGain();
  }

  get input() { return this.node; }

  connect(dest) { this.out.connect(dest); return dest; }

  async start() {
    const worklet = await installWorklet(this.ctx, imagerSource());

    if (worklet) {
      this.node = new AudioWorkletNode(this.ctx, 'headroom-imager', {
        processorOptions: { ...this.settings },
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
      });
    } else {
      // The old way: the same arithmetic, on the main thread.
      this.core = imagerCore(this.ctx.sampleRate);
      this.core.set(this.settings);
      this.node = this.ctx.createScriptProcessor(512, 2, 2);
      this.node.onaudioprocess = (event) => this.grind(event);
    }

    this.node.connect(this.out);
    return this;
  }

  grind(event) {
    const left = event.inputBuffer.getChannelData(0);
    const right = event.inputBuffer.numberOfChannels > 1
      ? event.inputBuffer.getChannelData(1)
      : left;
    const outL = event.outputBuffer.getChannelData(0);
    const outR = event.outputBuffer.getChannelData(1);

    for (let i = 0; i < outL.length; i += 1) {
      this.core.step(left[i], right[i]);
      outL[i] = this.core.outL;
      outR[i] = this.core.outR;
    }
  }

  set(settings) {
    this.settings = { ...this.settings, ...settings };
    if (this.node?.port) this.node.port.postMessage(settings);
    else this.core?.set(settings);
  }

  destroy() {
    try { this.node?.disconnect(); } catch { /* already gone */ }
    if (this.node) this.node.onaudioprocess = null;
    try { this.out.disconnect(); } catch { /* already gone */ }
  }
}
