import { makeBiquad, setBiquad, runBiquad } from '../../lib/dsp.js';
import * as dsp from './dsp.js';
import {
  machineTone, makeupFor, headsOf, sidesOf, wanderOf, centsOf, echoCore,
} from './dsp.js';
import { workletModule, installWorklet } from '../../lib/worklet.js';

/**
 * The delay, made audible.
 *
 * The worklet is written out of the DSP's own source - see `lib/worklet.js`
 * for why. What is here is the part that is the delay's own: two channels in,
 * two out, and nothing reported back, because a delay has no meter.
 *
 * It was a `ConvolverNode` fed a response built from the same numbers, which
 * is the right way to run anything that stands still and the wrong way to run
 * anything that moves. A response is one answer to "a click in, what comes
 * out", and convolution puts that same answer under every input sample - so a
 * line whose length wanders would come out detuned by a fixed amount instead
 * of wandering. The modulation has to happen while the audio goes past.
 *
 * It is also cheaper, which was the opposite of what was predicted. Rendering
 * four seconds offline, four instances across four chains, fraction of one
 * core:
 *
 *     the convolver, as it was                 0.176
 *     this, one head                           0.071
 *     this, four heads                         0.104
 *     the saturator, for scale                 0.305
 *
 * A convolver with a 1.6 second response is running a partitioned FFT every
 * block whether the tail is loud or silent. A per-sample loop is a few dozen
 * operations a sample and nothing else.
 *
 * A ScriptProcessor stands behind it. AudioWorklet needs a module loaded from
 * a URL, and this page is published as a single file that may be served under
 * a policy that will not have one; the fallback is deprecated and runs on the
 * main thread, and it is still a working delay where the good path is
 * refused.
 */

/**
 * The functions the audio thread needs, in the order they are defined.
 *
 * The list is by hand and the constants below are not, which is a seam worth
 * naming because it has already cost a silent delay. Adding wow and flutter
 * added two functions to `dsp.js` that `echoCore` calls, and leaving them off
 * here broke nothing in Node, nothing in the module, and nothing the page
 * could report: the error happens on the audio thread, inside a blob, where
 * there is no console anybody is listening to. What you get is a delay with
 * no repeats at all - and a processor doing nothing is also a processor that
 * measures beautifully, which is how it nearly got measured as a saving.
 *
 * The test that catches it runs this source for real and holds its core
 * against the module's, sample for sample. See tests/echo.test.js.
 */
const ECHO_PARTS = [
  makeBiquad, setBiquad, runBiquad,
  machineTone, headsOf, sidesOf, wanderOf, centsOf, makeupFor, echoCore,
];

/**
 * The module-level values those functions read, taken from the module rather
 * than listed here.
 *
 * Every non-function export goes over, including the limits tables, which the
 * audio thread does not read. Three or four unused declarations in a prelude
 * are cheaper than a list that has to be remembered - and a list that was
 * remembered wrongly does not fail at the module or in the browser. It fails
 * in the worklet, where what you get is a delay whose audio thread is running
 * different arithmetic from the one being drawn and marked.
 */
const ECHO_CONSTANTS = Object.fromEntries(
  Object.entries(dsp).filter(([, value]) => typeof value !== 'function'),
);

/**
 * The delay's own process(): two in, two out, and no early exit.
 *
 * The missing early exit is the whole of what is interesting here. Every other
 * processor in this app starts by checking whether there is an input and
 * filling the output with silence if there is not, which is right for all of
 * them: a compressor or a shaper with nothing going in has nothing to say. A
 * delay does. Chrome hands an empty input array once whatever was upstream has
 * stopped, and bailing out on it means the line stops being written, stops
 * feeding back, and never produces the tail - which is the entire point of the
 * device. Measured on the prototype this came from: a fifty millisecond burst
 * in, and the output peaked at exactly zero.
 *
 * So an absent input reads as zeros and the loop keeps turning.
 */
const ECHO_PROCESSOR = `class HeadroomEcho extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.core = echoCore(sampleRate);
    // With the node, not in a message after it: see the imager for why.
    if (options?.processorOptions) this.core.set(options.processorOptions);
    this.port.onmessage = (event) => this.core.set(event.data);
  }

  process(inputs, outputs) {
    const outL = outputs[0][0];
    const outR = outputs[0][1] ?? outL;
    const ins = inputs[0];
    const left = ins && ins[0];
    // A mono source up-mixed by the gain in front arrives on both; a channel
    // that is genuinely absent falls back to the left, which is the mono case
    // and not a silent right.
    const right = (ins && ins[1]) ?? left;

    for (let i = 0; i < outL.length; i += 1) {
      this.core.stereo(left ? left[i] : 0, right ? right[i] : 0);
      outL[i] = this.core.left;
      outR[i] = this.core.right;
    }

    return true;
  }
}

registerProcessor('headroom-echo', HeadroomEcho);`;

/** The worklet, as source. */
export function echoSource() {
  return workletModule({ constants: ECHO_CONSTANTS, parts: ECHO_PARTS, processor: ECHO_PROCESSOR });
}

/**
 * One delay in a graph, however it ended up being run.
 *
 * The gain in front is load-bearing, the same way it is for the compressor: a
 * mono instrument reaching a two-channel processor has to be up-mixed the way
 * everything else in the graph up-mixes it, or the right side is silent and
 * the delay comes out hard left.
 */
export class LiveEcho {
  constructor(ctx) {
    this.ctx = ctx;
    this.settings = {};
    this.node = null;
    this.core = null;
    this.gate = ctx.createGain();
    this.gate.channelCount = 2;
    this.gate.channelCountMode = 'explicit';
    this.gate.channelInterpretation = 'speakers';
    this.out = ctx.createGain();
  }

  get input() { return this.gate; }

  connect(dest) { this.out.connect(dest); return dest; }

  async start() {
    const worklet = await installWorklet(this.ctx, echoSource());

    if (worklet) {
      this.node = new AudioWorkletNode(this.ctx, 'headroom-echo', {
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
      this.core = echoCore(this.ctx.sampleRate);
      this.core.set(this.settings);
      this.node = this.ctx.createScriptProcessor(512, 2, 2);
      this.node.onaudioprocess = (event) => this.grind(event);
    }

    this.gate.connect(this.node);
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
      this.core.stereo(left[i], right[i]);
      outL[i] = this.core.left;
      outR[i] = this.core.right;
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
    try { this.gate.disconnect(); } catch { /* already gone */ }
    try { this.out.disconnect(); } catch { /* already gone */ }
  }
}
