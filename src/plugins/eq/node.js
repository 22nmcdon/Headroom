import * as svf from './svf.js';
import { svfState, svfTick, svfRack } from './svf.js';
import { workletModule, installWorklet } from '../../lib/worklet.js';

/**
 * The EQ, made audible.
 *
 * Until this existed the EQ was the only one of the six tools whose sound and
 * whose marking were different code: cookbook coefficients to draw and to
 * score, native BiquadFilterNodes to hear. They agreed - measured, to a
 * hundredth of a decibel, because the W3C spec defines Web Audio's biquads
 * with the same formulas - but they agreed by hand, and everything the EQ
 * still wanted was on the other side of that. Shelves with a slope, six and
 * eighteen decibels an octave, a width that moves with the gain, a response
 * that does not squash itself flat at Nyquist, a band that moves at audio
 * rate: a BiquadFilterNode will do none of them.
 *
 * So the sections are run here, out of `svf.js`, stringified - the same
 * `svfTick` the curve is derived from, over the same coefficients
 * `sectionTable` hands the drawing. One description, drawn, scored and heard.
 *
 * Nothing is reported back. An equaliser has nothing to say that is not
 * already in what comes out of it, and the two things its face wants - the
 * curve and the spectrum - are arithmetic on the settings and an analyser on
 * the output, neither of which needs the audio thread's help.
 */

const EQ_PARTS = [svfState, svfTick, svfRack];

/**
 * Every value the stringified functions read, taken from the module rather
 * than listed here - which is the lesson the saturator paid for: a constant
 * missing from a hand-kept list does not fail at the module, it fails inside
 * a worklet, where what you get is a tool that draws one filter and plays
 * another.
 */
const EQ_CONSTANTS = Object.fromEntries(
  Object.entries(svf).filter(([, value]) => typeof value !== 'function'),
);

const EQ_PROCESSOR = `class HeadroomEq extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const asked = (options && options.processorOptions) || {};
    this.rack = svfRack(sampleRate, asked.slots || 0);
    // With the node rather than in a message after it. A message is a round
    // trip, and a chain built with a curve already on it would spend that
    // round trip flat - which an offline render starting at its first sample
    // would print into the measurement.
    if (asked.table) this.rack.tune(asked.table, true);
    this.port.onmessage = (event) => this.rack.tune(event.data.table, event.data.now === true);
  }

  process(inputs, outputs) {
    const ins = inputs[0];
    const outs = outputs[0];
    if (!ins || !ins.length || !ins[0]) {
      for (const channel of outs) channel.fill(0);
      return true;
    }
    this.rack.block(ins, outs);
    return true;
  }
}

registerProcessor('headroom-eq', HeadroomEq);`;

export function eqSource() {
  return workletModule({
    constants: EQ_CONSTANTS,
    parts: EQ_PARTS,
    processor: EQ_PROCESSOR,
  });
}

/**
 * One EQ in a graph, however it ended up being run.
 *
 * `slots` is sections rather than bands, because that is what the rack
 * counts and what the table is laid out by. It is fixed for the life of the
 * node: a graph rebuilt under a running loop clicks, so a band that is off
 * is a table entry and not a missing filter.
 */
export class LiveEq {
  constructor(ctx, slots) {
    this.ctx = ctx;
    this.slots = slots;
    this.table = null;
    this.node = null;
    this.out = ctx.createGain();
  }

  get input() { return this.node; }

  connect(dest) { this.out.connect(dest); return dest; }

  async start() {
    const worklet = await installWorklet(this.ctx, eqSource());

    if (worklet) {
      this.node = new AudioWorkletNode(this.ctx, 'headroom-eq', {
        processorOptions: { slots: this.slots, table: this.table },
        numberOfInputs: 1,
        numberOfOutputs: 1,
        // Deliberately no channel counting of its own. An EQ is the one
        // effect here that is the same thing on one channel as on six, so a
        // mono track stays mono through it rather than being widened into
        // two copies of itself on the way past.
      });
    } else {
      // The old way: the same rack, on the main thread. A
      // ScriptProcessorNode's channel counts are fixed when it is made, so
      // this one is stereo whatever it is handed - the worklet above follows
      // its input and a mono track stays mono through it. Two copies of one
      // channel rather than one is the whole of the difference, and nothing
      // downstream of an insert is mono anyway.
      this.rack = svfRack(this.ctx.sampleRate, this.slots);
      if (this.table) this.rack.tune(this.table, true);
      this.node = this.ctx.createScriptProcessor(1024, 2, 2);
      this.node.onaudioprocess = (event) => this.grind(event);
    }

    this.node.connect(this.out);
    return this;
  }

  grind(event) {
    const ins = [];
    const outs = [];
    for (let c = 0; c < event.outputBuffer.numberOfChannels; c += 1) {
      ins.push(event.inputBuffer.getChannelData(
        Math.min(c, event.inputBuffer.numberOfChannels - 1)));
      outs.push(event.outputBuffer.getChannelData(c));
    }
    this.rack.block(ins, outs);
  }

  /**
   * Where the sections are going.
   *
   * `now` is for a render rather than a performance: ten milliseconds of a
   * filter arriving is ten milliseconds of an offline measurement being of
   * something else.
   */
  tune(table, now = false) {
    this.table = table;
    if (this.node?.port) this.node.port.postMessage({ table, now });
    else this.rack?.tune(table, now);
  }

  destroy() {
    try { this.node?.disconnect(); } catch { /* already gone */ }
    if (this.node) this.node.onaudioprocess = null;
    try { this.out.disconnect(); } catch { /* already gone */ }
  }
}
