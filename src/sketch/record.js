// Recording something into a slot.
//
// The one thing a sketchpad on a phone is for that a DAW on a desk is not:
// an idea arrives, you sing it or play it at the nearest microphone, and it
// is kept. Everything else here is notes, which are editable and exportable
// and wrong for a hummed line or a guitar part - those only survive as
// audio.
//
// Captured on the audio thread rather than with MediaRecorder. MediaRecorder
// gives a compressed blob that has to be decoded, and neither its start nor
// its stop is on any clock this app has: a take has to begin on a bar line
// to be any use in a loop, and a bar line is an audio time. A worklet
// handing blocks back with the audio time of each one can be cut exactly.

import { workletModule, installWorklet } from '../fx/worklet.js';

const CAPTURE_PROCESSOR = `class HeadroomCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.on = false;
    this.port.onmessage = (event) => { this.on = Boolean(event.data?.on); };
  }

  process(inputs) {
    const input = inputs[0];
    if (!this.on || !input || !input.length || !input[0]) return true;
    // A copy, because the block is reused the moment this returns.
    this.port.postMessage({
      at: currentTime,
      block: input.map((channel) => channel.slice()),
    });
    return true;
  }
}

registerProcessor('headroom-capture', HeadroomCapture);`;

export const captureSource = () => workletModule({ processor: CAPTURE_PROCESSOR });

/** Whether this browser will let anything be recorded at all. */
export const canRecord = () => Boolean(
  typeof navigator !== 'undefined'
  && navigator.mediaDevices?.getUserMedia
  && typeof AudioWorkletNode !== 'undefined',
);

/* --- the arithmetic, which is the part worth testing -------------------- */

export const MOST_BARS = 8;

/** How long a bar is, in seconds. */
export const barSeconds = (bpm, beats = 4, value = 4) => (60 / bpm) * beats * (4 / value);

/**
 * How many bars a take of this length is.
 *
 * Rounded to the nearest whole bar, never nothing and never more than eight.
 * A take is going to loop, and a loop that is three and a bit bars long is a
 * loop that falls over on its second pass - so the length is decided here
 * and the audio is cut to it, rather than the other way round.
 */
export function barsFor(seconds, bpm, beats = 4, value = 4) {
  const per = barSeconds(bpm, beats, value);
  if (!(per > 0) || !(seconds > 0)) return 1;
  return Math.max(1, Math.min(MOST_BARS, Math.round(seconds / per)));
}

/**
 * Channels cut to a length, padded with silence if they fall short.
 *
 * Padded rather than shortened: a take that was meant to be two bars and
 * came back a hair under is two bars with a moment of silence on the end,
 * which is what was played. Cutting it to what arrived would make the loop
 * a hair fast, and a hair fast is a loop that drifts away from the others.
 */
export function fitTo(channels, rate, seconds) {
  const frames = Math.max(1, Math.round(rate * seconds));
  return channels.map((channel) => {
    const out = new Float32Array(frames);
    out.set(channel.subarray(0, Math.min(channel.length, frames)));
    return out;
  });
}

/** Blocks as they arrived, as one run of samples a channel. */
export function joinBlocks(blocks) {
  if (!blocks.length) return [];

  const channels = blocks[0].length;
  const frames = blocks.reduce((sum, block) => sum + block[0].length, 0);
  const out = Array.from({ length: channels }, () => new Float32Array(frames));

  let at = 0;
  for (const block of blocks) {
    for (let channel = 0; channel < channels; channel += 1) {
      out[channel].set(block[Math.min(channel, block.length - 1)], at);
    }
    at += block[0].length;
  }

  return out;
}

/** The loudest sample in a take, for saying whether anything arrived. */
export function loudestIn(channels) {
  let peak = 0;
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i += 1) peak = Math.max(peak, Math.abs(channel[i]));
  }
  return peak;
}

/** Under this and nothing was plugged in, or nothing was played. */
export const SILENCE = 0.002;

/* --- the live part ------------------------------------------------------- */

/**
 * A microphone, open and feeding a capture node.
 *
 * Opened once and kept while the sketchpad is open, because asking for the
 * microphone is a permission prompt and a prompt in the middle of an idea is
 * the end of the idea.
 */
export class Recorder {
  constructor(ctx) {
    this.ctx = ctx;
    this.stream = null;
    this.node = null;
    this.source = null;
    this.blocks = [];
    this.taking = false;
  }

  get open() { return Boolean(this.node); }

  /** Ask for the microphone. Returns null when it is refused or absent. */
  async ask() {
    if (this.node) return this;
    if (!canRecord()) return null;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // A sketch wants what was played, not what a phone thinks a voice
          // on a call sounds like.
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
    } catch {
      return null;
    }

    const worklet = await installWorklet(this.ctx, captureSource());
    if (!worklet) { this.close(); return null; }

    this.node = new AudioWorkletNode(this.ctx, 'headroom-capture', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: 'explicit',
    });
    this.node.port.onmessage = (event) => {
      if (this.taking) this.blocks.push(event.data.block);
    };

    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.source.connect(this.node);

    // A worklet with nothing listening to it is not guaranteed to be pulled.
    // Into a gain at zero, so it runs and nothing is heard - a microphone
    // feeding the speakers is feedback, every time.
    const quiet = this.ctx.createGain();
    quiet.gain.value = 0;
    this.node.connect(quiet).connect(this.ctx.destination);
    this.quiet = quiet;

    return this;
  }

  /** Begin keeping what arrives. */
  start() {
    if (!this.node) return false;
    this.blocks = [];
    this.taking = true;
    this.node.port.postMessage({ on: true });
    this.startedAt = this.ctx.currentTime;
    return true;
  }

  /** Stop, and hand back what was kept. */
  stop() {
    if (!this.node) return null;
    this.taking = false;
    this.node.port.postMessage({ on: false });

    const channels = joinBlocks(this.blocks);
    this.blocks = [];
    if (!channels.length) return null;

    return {
      channels,
      rate: this.ctx.sampleRate,
      seconds: channels[0].length / this.ctx.sampleRate,
      startedAt: this.startedAt,
    };
  }

  close() {
    this.taking = false;
    try { this.node?.port.postMessage({ on: false }); } catch { /* gone */ }
    for (const node of [this.source, this.node, this.quiet]) {
      try { node?.disconnect(); } catch { /* already gone */ }
    }
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.node = null;
    this.source = null;
  }
}
