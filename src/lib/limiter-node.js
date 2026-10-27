// The safety limiter, in a graph.
//
// Separate from limiter.js for the reason every node.js in this project is
// separate from its dsp: that file is arithmetic over arrays and this one
// makes Web Audio nodes, and the line between them is the whole of what makes
// the arithmetic testable without a browser. tests/seams.test.js holds it.
//
// The processor is written out of limiter.js's own source - see lib/worklet.js
// for why - so the thing on the audio thread is the thing the tests measured
// rather than a second copy of it.

import * as limiter from './limiter.js';
import { makeLimiter } from './limiter.js';
import { workletModule, installWorklet } from './worklet.js';

const LIMITER_PARTS = [makeLimiter];

/**
 * Every value `makeLimiter` reads, taken from the module rather than listed.
 *
 * The compressor kept a list of two by hand and the third constant added to
 * it did not fail at the module or in the browser - it failed inside the
 * worklet, where what you get is an audio thread running different arithmetic
 * from the one being tested. There is no list here to forget.
 */
const LIMITER_CONSTANTS = Object.fromEntries(
  Object.entries(limiter).filter(([, value]) => typeof value !== 'function'),
);

const LIMITER_PROCESSOR = `class HeadroomLimiter extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const asked = (options && options.processorOptions) || {};
    this.limiter = makeLimiter(sampleRate, asked);
  }

  process(inputs, outputs) {
    const ins = inputs[0];
    const outs = outputs[0];
    if (!ins || !ins.length || !ins[0]) {
      for (const channel of outs) channel.fill(0);
      return true;
    }

    // Copied in, then limited in place: the limiter works on the arrays it is
    // handed, and an input buffer is not ours to write on.
    for (let c = 0; c < outs.length; c += 1) {
      outs[c].set(ins[Math.min(c, ins.length - 1)]);
    }
    this.limiter.block(outs);
    return true;
  }
}

registerProcessor('headroom-limiter', HeadroomLimiter);`;

export function limiterSource() {
  return workletModule({
    constants: LIMITER_CONSTANTS,
    parts: LIMITER_PARTS,
    processor: LIMITER_PROCESSOR,
  });
}

/**
 * A limiter on the end of a bus.
 *
 * Returns something with `in` and `out`, so a caller can put it between two
 * things without caring which of the two paths it got. The fallback is the
 * same code on the main thread rather than a DynamicsCompressorNode, because
 * the node is what this replaced: measured, it let transient material out at
 * 2.92 dB over its own ceiling, and a safety limiter that is only sometimes a
 * ceiling is the thing being fixed.
 */
export async function makeLimiterNode(ctx, options = {}) {
  const worklet = await installWorklet(ctx, limiterSource());

  if (worklet) {
    const node = new AudioWorkletNode(ctx, 'headroom-limiter', {
      processorOptions: options,
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    return { in: node, out: node, node };
  }

  // A ScriptProcessorNode's channel counts are fixed when it is made, so this
  // one is stereo whatever it is handed. Nothing upstream of the sketch bus is
  // mono anyway.
  const node = ctx.createScriptProcessor(512, 2, 2);
  const engine = makeLimiter(ctx.sampleRate, options);
  node.onaudioprocess = (event) => {
    const outs = [];
    for (let c = 0; c < event.outputBuffer.numberOfChannels; c += 1) {
      const to = event.outputBuffer.getChannelData(c);
      to.set(event.inputBuffer.getChannelData(
        Math.min(c, event.inputBuffer.numberOfChannels - 1)));
      outs.push(to);
    }
    engine.block(outs);
  };
  return { in: node, out: node, node };
}
