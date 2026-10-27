import { makeBiquad, setBiquad, runBiquad } from '../../lib/dsp.js';
import * as dsp from './dsp.js';
import { compressorCore, staticGain, optoCell } from './dsp.js';
import { workletModule, installWorklet } from '../../lib/worklet.js';

/**
 * The compressor, made audible.
 *
 * The worklet is written out of the DSP's own source - see `fx/worklet.js`
 * for why. What is here is the part that is the compressor's own: three
 * channels in - the signal's two and the key - two out, and the deepest
 * reduction since anybody last looked.
 *
 * It was two in and one out, the signal on channel one and the key on channel
 * two, and that cost more than it looked. A merger's input is one channel
 * wide, so a stereo track arriving at it was down-mixed to (L+R)/2 and the
 * single output was then copied back to both sides. Measured, a 220 Hz tone
 * through an insert at ratio 1 - a wire:
 *
 *     position        in L        in R       out L       out R
 *     hard left     -6.02 dB     silent   -12.04 dB   -12.04 dB
 *     half left     -6.71 dB   -14.36 dB   -9.72 dB    -9.72 dB
 *     centre        -9.03 dB   -9.03 dB    -9.03 dB    -9.03 dB
 *     out of phase  -6.02 dB   -6.02 dB      silent      silent
 *
 * So: the image collapsed to the middle whatever it was; the level depended
 * on where it sat, a hard-panned track losing 6 dB that a centred one did
 * not; and an out-of-phase pair cancelled to nothing. All three at ratio 1,
 * before the compressor had done anything at all. The centre row passing is
 * why it went unseen - a mono source panned middle is the one case that
 * works.
 *
 * A ScriptProcessor stands behind it. AudioWorklet needs a module loaded from
 * a URL, and this page is published as a single file that may be served under
 * a policy that will not have one; the fallback is deprecated and runs on the
 * main thread, and it is still a working compressor where the good path is
 * refused.
 */

/** The functions the audio thread needs, in the order they are defined. */
const COMPRESSOR_PARTS = [staticGain, makeBiquad, setBiquad, runBiquad, optoCell, compressorCore];

/**
 * The module-level values those functions read, taken from the module rather
 * than listed here.
 *
 * It was a list of two, and adding a third constant to `dsp.js` did not fail
 * at the module or in the browser - it failed in the worklet, where what you
 * get is a compressor whose audio thread is running different arithmetic from
 * the one being drawn and marked. A test caught it, which is the only reason
 * it is not still true. The EQ paid for this first and solved it this way;
 * the compressor was still keeping its list by hand.
 *
 * Every non-function export goes over, including the settings tables, which
 * the worklet does not read. Three or four unused declarations in a prelude
 * are cheaper than a list that has to be remembered.
 *
 * Still a table rather than source spelled into the template below, so the
 * declarations never appear as text in this file - which keeps the bundler's
 * duplicate-name check from reading a string as a second declaration of
 * something `dsp.js` already owns.
 */
const CONSTANTS = Object.fromEntries(
  Object.entries(dsp).filter(([, value]) => typeof value !== 'function'),
);

/** How often the audio thread reports what it is doing, in samples. */
const REPORT = 512;

/**
 * Which channel the sidechain key rides on, counted from zero.
 *
 * A name rather than a 2 in four places: it was a 1 until the signal needed
 * two channels of its own, and the thing that makes a move like that safe is
 * that there is one place to change it.
 */
const KEY_CHANNEL = 2;

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
    const outL = outputs[0][0];
    const outR = outputs[0][1] ?? outL;
    const left = inputs[0][0];
    // A mono source up-mixed by the gain in front of the splitter arrives on
    // both; a channel that is genuinely absent falls back to the left, which
    // is the mono case and not a silent right.
    const right = inputs[0][1] ?? left;
    const key = inputs[0][2];

    if (!left) { for (const channel of outputs[0]) channel.fill(0); return true; }

    for (let i = 0; i < outL.length; i += 1) {
      this.core.stereo(left[i], right[i], key ? key[i] : 0);
      outL[i] = this.core.left;
      outR[i] = this.core.right;
      if (this.core.reduction < this.deepest) this.deepest = this.core.reduction;
    }

    this.since += outL.length;
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
 * Three channels in - the signal's two, then the key - and two out. The key
 * is a channel rather than a second input because that is the one shape both
 * the worklet and the ScriptProcessor can be given.
 *
 * The front end is a gain, a splitter and a merger, and each of the three is
 * load-bearing. A merger's inputs are one channel wide, so the signal cannot
 * be handed to one directly without being summed; the splitter takes the two
 * sides apart so they can be merged as themselves. The gain in front of it is
 * what makes a mono source work: a splitter interprets its input as discrete
 * and would leave channel two silent, so a mono synth would come out hard
 * left. An explicit two-channel gain on speaker interpretation up-mixes it
 * the way everything else in the graph does first.
 */
export class LiveCompressor {
  constructor(ctx) {
    this.ctx = ctx;
    this.settings = {};
    this.pending = 0;    // the deepest reduction since anyone last looked
    this.node = null;
    this.gate = ctx.createGain();
    this.gate.channelCount = 2;
    this.gate.channelCountMode = 'explicit';
    this.gate.channelInterpretation = 'speakers';
    this.split = ctx.createChannelSplitter(2);
    this.merge = ctx.createChannelMerger(3);
    this.gate.connect(this.split);
    this.split.connect(this.merge, 0, 0);
    this.split.connect(this.merge, 1, 1);
    this.out = ctx.createGain();
  }

  /** Where the signal goes. The key goes to the merger's third input. */
  get input() { return this.gate; }

  /**
   * Where a sidechain key goes, and which of its inputs.
   *
   * The merger rather than `input`, which is now the signal's own way in.
   * Plugging a key into the signal path would compress the track against
   * itself plus the key, which is audible and would look like a detector
   * fault rather than a wiring one.
   */
  get keyIn() { return this.merge; }

  /** Which input of the merger a sidechain key is plugged into. */
  get keyAt() { return KEY_CHANNEL; }

  connect(dest) { this.out.connect(dest); return dest; }

  async start() {
    const worklet = await installWorklet(this.ctx, workletSource());

    if (worklet) {
      this.node = new AudioWorkletNode(this.ctx, 'headroom-compressor', {
        processorOptions: { ...this.settings },
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 3,
        channelCountMode: 'explicit',
        channelInterpretation: 'discrete',
      });
      this.node.port.onmessage = (event) => this.report(event.data);
    } else {
      // The old way: the same arithmetic, on the main thread.
      this.core = compressorCore(this.ctx.sampleRate);
      this.core.set(this.settings);
      this.node = this.ctx.createScriptProcessor(512, 3, 2);
      this.node.onaudioprocess = (event) => this.grind(event);
    }

    this.merge.connect(this.node);
    this.node.connect(this.out);
    return this;
  }

  grind(event) {
    const ins = event.inputBuffer;
    const left = ins.getChannelData(0);
    const right = ins.numberOfChannels > 1 ? ins.getChannelData(1) : left;
    const key = ins.numberOfChannels > KEY_CHANNEL
      ? ins.getChannelData(KEY_CHANNEL)
      : null;
    const outL = event.outputBuffer.getChannelData(0);
    const outR = event.outputBuffer.numberOfChannels > 1
      ? event.outputBuffer.getChannelData(1)
      : outL;

    for (let i = 0; i < outL.length; i += 1) {
      this.core.stereo(left[i], right[i], key ? key[i] : 0);
      outL[i] = this.core.left;
      outR[i] = this.core.right;
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
    for (const node of [this.gate, this.split, this.merge, this.out]) {
      try { node.disconnect(); } catch { /* already gone */ }
    }
  }
}
