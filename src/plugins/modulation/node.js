import * as dsp from './dsp.js';
import { modKind, modHeld, apCoef, lfoAt, modCore } from './dsp.js';
import { workletModule, installWorklet } from '../../lib/worklet.js';

/**
 * The modulation, made audible.
 *
 * A worklet rather than native nodes, and the reason is the one thing a
 * modulation cannot have: a seam. Three of these six could be built out of
 * the graph's own parts - a `DelayNode` with an oscillator on its
 * `delayTime`, a chain of all-pass `BiquadFilterNode`s with one on their
 * frequency, a `GainNode` with one on its gain - and the result would be
 * three different implementations of one idea, two of which would be
 * second-order where the arithmetic here is first, and all of which would
 * interpolate their delay line linearly. A chorus whose line is read linearly
 * has a comb filter in its interpolator whose notch moves with the sweep, so
 * the top end breathes at the rate of the modulation, which is a fault you
 * only hear on the one device it matters for.
 *
 * It cannot be rendered offline either, which is how the reverb and the delay
 * audition themselves. A rendered loop repeats, and an oscillator that is not
 * a whole number of cycles long inside the loop jumps at the splice: a chorus
 * at 0.6 Hz over a five second loop is three cycles and a quarter, so every
 * pass would start a quarter of a cycle on from where the last one ended.
 * The modulation has to run while the audio goes past.
 *
 * A ScriptProcessor stands behind it, as it does for the delay: AudioWorklet
 * needs a module loaded from a URL, and this page is published as a single
 * file that may be served under a policy that will not have one.
 */

/**
 * The functions the audio thread needs, in the order they are defined.
 *
 * By hand, and the delay's version of this list has already cost a silent
 * device once: a function the core calls that is missing here fails inside a
 * blob on the audio thread, where there is no console anybody is listening
 * to, and what you get is a processor that outputs silence - which also
 * measures beautifully. `tests/mod.test.js` runs this source for real and
 * holds its core against the module's, sample for sample.
 *
 * `lfoAt` is not called by the core - the core inlines it, because a function
 * call per sample per channel is a function call per sample per channel - and
 * it goes over anyway, because what it costs is one declaration and what it
 * saves is the next person wondering whether it should have.
 */
const MOD_PARTS = [modKind, modHeld, apCoef, lfoAt, modCore];

/**
 * The module-level values those functions read, taken from the module rather
 * than listed here.
 *
 * Every non-function export goes over, including the tables the audio thread
 * never looks at. Three unused declarations in a prelude are cheaper than a
 * list that has to be remembered.
 */
const MOD_CONSTANTS = Object.fromEntries(
  Object.entries(dsp).filter(([, value]) => typeof value !== 'function'),
);

/**
 * The processor: two in, two out, and no early exit on a missing input.
 *
 * The same decision the delay made and for a weaker version of the same
 * reason. A modulation with nothing going in has nothing to say, so bailing
 * out would be harmless for five of the six - but the delay family has a line
 * with audio still in it, and a flanger that stopped turning its line over
 * the moment the source stopped would hold whatever was in it and play it
 * again on the next note. Cheaper to keep the loop turning.
 */
const MOD_PROCESSOR = `class HeadroomModulation extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.core = modCore(sampleRate);
    // With the node rather than in a message after it: a processor that is
    // built and then told what it is spends its first block being a default.
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
registerProcessor('headroom-modulation', HeadroomModulation);`;

/** The worklet, as source. */
export function modSource() {
  return workletModule({
    constants: MOD_CONSTANTS, parts: MOD_PARTS, processor: MOD_PROCESSOR,
  });
}

/**
 * One modulation in a graph, however it ended up being run.
 *
 * The gain in front is load-bearing, as it is for the compressor and the
 * delay: a mono instrument reaching a two-channel processor has to be
 * up-mixed the way everything else in the graph up-mixes it, or the right
 * side is silent - and on an auto-pan, whose whole job is the difference
 * between the two sides, that is the device not working at all.
 */
export class LiveModulation {
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
    const worklet = await installWorklet(this.ctx, modSource());

    if (worklet) {
      this.node = new AudioWorkletNode(this.ctx, 'headroom-modulation', {
        processorOptions: { ...this.settings },
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
      });
    } else {
      this.core = modCore(this.ctx.sampleRate);
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
