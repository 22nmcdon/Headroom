import * as shimmer from './shimmer.js';
import { shiftCore, shimmerRatio } from './shimmer.js';
import * as freeze from './freeze.js';
import { freezeCore } from './freeze.js';
import { workletModule, installWorklet } from '../../lib/worklet.js';

/**
 * The shifter, on the audio thread.
 *
 * The reverb is the last plugin here to get one of these, and it only needs
 * it for the one thing convolution cannot do. Everything else in this folder
 * is an impulse response and should stay one: a room does not move, and a
 * response that is built, convolved, drawn and marked from the same array
 * leaves the three of them nothing to disagree about. The shimmer is the
 * exception because it is the room fed back through a pitch shifter, and a
 * thing whose output depends on what it has already produced is not a
 * response at all.
 *
 * So this sits in the feedback path and nowhere else. With the shimmer knob
 * at zero the node is not built and the graph is exactly the graph it has
 * always been, which is what keeps every drawn and marked response what it
 * was.
 *
 * As with the delay, a ScriptProcessor stands behind it: AudioWorklet needs a
 * module from a URL and this page is published as a single file that may be
 * served somewhere that will not have one.
 */

/**
 * The functions the audio thread needs, in the order they are defined.
 *
 * By hand, and the delay's node.js has the long note on why that seam has
 * already cost a silent processor. The test that catches it runs this source
 * for real and holds its core against the module's, sample for sample.
 */
const SHIMMER_PARTS = [shimmerRatio, shiftCore];

/** And the module-level values they read, taken from the module itself. */
const SHIMMER_CONSTANTS = Object.fromEntries(
  Object.entries(shimmer).filter(([, value]) => typeof value !== 'function'),
);

/**
 * Two in, two out, and no early exit - for the delay's reason.
 *
 * A shifter sitting in a feedback loop is handed an empty input array the
 * moment the thing upstream of it goes quiet, which for a reverb is most of
 * the time. Bailing out then would mean the line stops being written, the
 * loop stops turning and the shimmer tail never happens, which is the whole
 * device. An absent input reads as zeros and the heads keep moving.
 */
const SHIMMER_PROCESSOR = `class HeadroomShimmer extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.core = shiftCore(sampleRate);
    if (options?.processorOptions) this.core.set(options.processorOptions);
    this.port.onmessage = (event) => this.core.set(event.data);
  }

  process(inputs, outputs) {
    const outL = outputs[0][0];
    const outR = outputs[0][1] ?? outL;
    const ins = inputs[0];
    const left = ins && ins[0];
    const right = (ins && ins[1]) ?? left;

    for (let i = 0; i < outL.length; i += 1) {
      this.core.stereo(left ? left[i] : 0, right ? right[i] : 0);
      outL[i] = this.core.left;
      outR[i] = this.core.right;
    }

    return true;
  }
}

registerProcessor('headroom-shimmer', HeadroomShimmer);`;

/** The worklet's source, as the audio thread will see it. */
export const shimmerSource = () => workletModule({
  constants: SHIMMER_CONSTANTS,
  parts: SHIMMER_PARTS,
  processor: SHIMMER_PROCESSOR,
});

/**
 * A shifter in a graph, with the main-thread fallback behind it.
 *
 * `start()` is awaited because installing a worklet module is, and the caller
 * has to have a node to connect before it returns - so the fallback is built
 * first and swapped out, rather than the other way round.
 */
export class LiveShimmer {
  constructor(ctx) {
    this.ctx = ctx;
    this.settings = {};
    this.node = null;
    this.core = null;
  }

  async start() {
    const ok = await installWorklet(this.ctx, shimmerSource(), 'headroom-shimmer');
    if (ok) {
      this.node = new AudioWorkletNode(this.ctx, 'headroom-shimmer', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        // With the node rather than in a message after it: a message is
        // delivered on the audio thread's own schedule, so a node built and
        // immediately connected can run a block or two on its defaults.
        processorOptions: { ...this.settings },
      });
      return this;
    }

    // The deprecated path, on the main thread, which is still a working
    // shifter where the good one is refused.
    const size = 1024;
    this.core = shiftCore(this.ctx.sampleRate).set(this.settings);
    const node = this.ctx.createScriptProcessor(size, 2, 2);
    node.onaudioprocess = (event) => {
      const inL = event.inputBuffer.getChannelData(0);
      const inR = event.inputBuffer.numberOfChannels > 1
        ? event.inputBuffer.getChannelData(1) : inL;
      const outL = event.outputBuffer.getChannelData(0);
      const outR = event.outputBuffer.numberOfChannels > 1
        ? event.outputBuffer.getChannelData(1) : null;
      for (let i = 0; i < outL.length; i += 1) {
        this.core.stereo(inL[i], inR[i]);
        outL[i] = this.core.left;
        if (outR) outR[i] = this.core.right;
      }
    };
    this.node = node;
    return this;
  }

  get input() { return this.node; }

  get out() { return this.node; }

  set(settings) {
    this.settings = { ...this.settings, ...settings };
    if (this.node?.port) this.node.port.postMessage(this.settings);
    else this.core?.set(this.settings);
    return this;
  }
}

/**
 * And the freeze, which is the reverb's other non-response.
 *
 * A separate processor rather than a second job for the shifter, because the
 * two sit in different places: the shifter is inside a feedback path around
 * the convolver and this is a parallel voice beside it. One node doing both
 * would have to be in two places at once.
 */
const FREEZE_PARTS = [freezeCore];

const FREEZE_CONSTANTS = Object.fromEntries(
  Object.entries(freeze).filter(([, value]) => typeof value !== 'function'),
);

/**
 * Two in, two out, silent until it is frozen - and no early exit, for the
 * same reason as the others.
 *
 * This one needs it most. A freeze is pressed after something has stopped as
 * often as during it, and by then the convolver upstream may be handing this
 * an empty input array. Bailing out on that would mean the ring stops being
 * written in exactly the moment somebody is about to ask it to hold what is
 * in it.
 *
 * The button is an AudioParam and not a message, which every other processor
 * here uses. A message is delivered on the audio thread's own schedule, which
 * is fine for a mode and wrong for a moment: a freeze is pressed at a time,
 * and what it holds is whatever was sounding then. It also cannot be tested
 * offline, because an offline render finishes before any message is delivered
 * - measured, a freeze scheduled through the port read identically to one
 * never pressed at every time it was tried, while the shimmer beside it
 * worked. A param is sample-accurate and renders.
 */
const FREEZE_PROCESSOR = `class HeadroomFreeze extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'freeze', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' }];
  }

  constructor(options) {
    super();
    this.core = freezeCore(sampleRate);
    if (options?.processorOptions) this.core.set(options.processorOptions);
    this.held = false;
    this.port.onmessage = (event) => this.core.set(event.data);
  }

  process(inputs, outputs, params) {
    const outL = outputs[0][0];
    const outR = outputs[0][1] ?? outL;
    const ins = inputs[0];
    const left = ins && ins[0];
    const right = (ins && ins[1]) ?? left;

    // Per block, which is 2.7 ms - finer than anybody presses a button, and
    // the core only cares when the answer changes.
    const want = params.freeze[0] >= 0.5;
    if (want !== this.held) {
      this.held = want;
      this.core.set({ freeze: want });
    }

    for (let i = 0; i < outL.length; i += 1) {
      this.core.stereo(left ? left[i] : 0, right ? right[i] : 0);
      outL[i] = this.core.left;
      outR[i] = this.core.right;
    }

    return true;
  }
}

registerProcessor('headroom-freeze', HeadroomFreeze);`;

/** The freeze worklet's source, as the audio thread will see it. */
export const freezeSource = () => workletModule({
  constants: FREEZE_CONSTANTS,
  parts: FREEZE_PARTS,
  processor: FREEZE_PROCESSOR,
});

/** A held room in a graph, with the main-thread fallback behind it. */
export class LiveFreeze {
  constructor(ctx) {
    this.ctx = ctx;
    this.settings = {};
    this.node = null;
    this.core = null;
  }

  async start() {
    const ok = await installWorklet(this.ctx, freezeSource(), 'headroom-freeze');
    if (ok) {
      this.node = new AudioWorkletNode(this.ctx, 'headroom-freeze', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: { ...this.settings },
      });
      return this;
    }

    const size = 1024;
    this.core = freezeCore(this.ctx.sampleRate).set(this.settings);
    const node = this.ctx.createScriptProcessor(size, 2, 2);
    node.onaudioprocess = (event) => {
      const inL = event.inputBuffer.getChannelData(0);
      const inR = event.inputBuffer.numberOfChannels > 1
        ? event.inputBuffer.getChannelData(1) : inL;
      const outL = event.outputBuffer.getChannelData(0);
      const outR = event.outputBuffer.numberOfChannels > 1
        ? event.outputBuffer.getChannelData(1) : null;
      for (let i = 0; i < outL.length; i += 1) {
        this.core.stereo(inL[i], inR[i]);
        outL[i] = this.core.left;
        if (outR) outR[i] = this.core.right;
      }
    };
    this.node = node;
    return this;
  }

  get input() { return this.node; }

  get out() { return this.node; }

  /**
   * `at` is honoured, because for this one it is the point.
   *
   * The worklet path sets the param at that time, which is sample-accurate.
   * The fallback has no param to set, so it changes when it is told and the
   * time is dropped - a ScriptProcessor is already a compromise and this is
   * the smaller half of it.
   */
  set(settings, at = this.ctx.currentTime) {
    this.settings = { ...this.settings, ...settings };
    const param = this.node?.parameters?.get('freeze');
    if (param) param.setValueAtTime(this.settings.freeze ? 1 : 0, at);
    else this.core?.set(this.settings);
    return this;
  }
}
