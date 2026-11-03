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
// its stop is on any clock this app has: a take meant for a loop has to begin
// on a bar line, and a bar line is an audio time. A worklet handing blocks
// back with the audio time of each one can be cut exactly.
//
// That last sentence was a lie for as long as this file existed. The worklet
// did stamp every block; the handler threw the stamp away, and `startedAt`
// was recorded and read by nobody - so the justification for the whole
// architecture was a benefit nothing ever collected, and a take began
// wherever a finger landed. `headFrom` is the cut it describes, and `start`
// takes the time to make it at.
//
// A take still begins at the press when the transport is stopped. There is no
// bar line to begin on then, and a sketchpad on a phone exists because an
// idea arrives when the phone is the only thing to hand: making somebody
// press play first would cost the idea.

import { workletModule, installWorklet } from '../lib/worklet.js';
import { PPQ } from './midi.js';
import { ticksPerBar } from './transport.js';

const CAPTURE_PROCESSOR = `class HeadroomCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.on = false;
    this.port.onmessage = (event) => { this.on = Boolean(event.data?.on); };
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input.length || !input[0]) return true;

    // Both edges of this block, worked out here rather than on the other
    // side, so that a meter and a waveform can run without the blocks
    // themselves being shipped and kept. Posted whether or not a take is
    // being kept: a level is most use BEFORE somebody commits to a take, and
    // a meter that only appears once recording has started is a meter that
    // tells you what you have already lost.
    //
    // Low and high rather than one magnitude, because a waveform is drawn
    // about a centre line and a signal is not symmetric. A bar drawn from one
    // number would be a picture of the loudest half of each block, mirrored.
    let lo = 0;
    let hi = 0;
    for (const channel of input) {
      for (let i = 0; i < channel.length; i += 1) {
        const v = channel[i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }

    this.port.postMessage({
      at: currentTime,
      lo,
      hi,
      // A copy, because the block is reused the moment this returns - and
      // only while it is wanted, because copying 375 blocks a second into a
      // message nobody keeps is the one part of this that is not free.
      block: this.on ? input.map((channel) => channel.slice()) : null,
    });
    return true;
  }
}

registerProcessor('headroom-capture', HeadroomCapture);`;

export const captureSource = () => workletModule({ processor: CAPTURE_PROCESSOR });

/* --- what is asked for, and what comes back ------------------------------ */

/**
 * The processing this app asks a browser to switch off.
 *
 * Stated once so that the request and the check can read the same list.
 * A sketch wants what was played, not what a phone thinks a voice on a call
 * sounds like - and of the three, gain control is the one that does real
 * damage: riding up during the quiet parts is what lifts a microphone's own
 * noise floor into audibility, which is the hiss anybody hears on a phone
 * recording of something with dynamics in it.
 */
export const WANTED = {
  // In the order they are worth complaining about, because `overriddenIn`
  // reports them in this order and the first one named is the one somebody
  // reads. Gain control first: it is the one that does real damage.
  autoGainControl: false,
  noiseSuppression: false,
  echoCancellation: false,
};

/**
 * Which of those the browser overrode, if it says.
 *
 * The distinction this rests on: a setting absent from `getSettings` is one
 * the browser does not report, which is NOT the same as one it ignored.
 * Safari has historically reported less than Chromium, and treating silence
 * as refusal would put a warning on every take made there - which teaches
 * people to ignore the warning, and then it is worth nothing on the browser
 * that did override something.
 */
export function overriddenIn(settings) {
  const got = settings ?? {};
  return Object.entries(WANTED)
    .filter(([name, want]) => name in got && got[name] !== want)
    .map(([name]) => name);
}

/**
 * How many channels a take is actually kept in.
 *
 * One. The capture node is built `channelCount: 1, channelCountMode:
 * 'explicit'`, so whatever the device offers is folded down before it is
 * kept - which is right for one microphone and wrong for a stereo interface,
 * and is a thing to fix rather than a thing to hide. Until it is fixed, the
 * panel says so: a device offering two channels and a row reading "2
 * channels" would have somebody expect a stereo take and get a mono one.
 */
export const CAPTURE_CHANNELS = 1;

/** What those are called out loud, rather than in the API's words. */
export const PROCESSING_SAYS = {
  echoCancellation: 'echo cancellation',
  noiseSuppression: 'noise suppression',
  autoGainControl: 'gain control',
};

/**
 * What the browser actually handed over.
 *
 * Said as a sentence rather than as fields, and saying so plainly when it
 * reports nothing - "undefined Hz" is worse than an admission.
 */
export function saidInput(settings) {
  const rate = Number(settings?.sampleRate);
  const channels = Number(settings?.channelCount);
  if (!Number.isFinite(rate) && !Number.isFinite(channels)) {
    return 'this browser does not say what it gave';
  }

  const parts = [];
  if (Number.isFinite(rate)) {
    // 48 kHz rather than 48.0, and 44.1 rather than 44 - the two rates
    // anybody actually sees, written the way they are written.
    const k = rate / 1000;
    parts.push(`${Number.isInteger(k) ? k : k.toFixed(1)} kHz`);
  }
  if (Number.isFinite(channels)) {
    parts.push(`${channels} channel${channels === 1 ? '' : 's'}`);
    // Said rather than quietly done. The fold is real and the row would
    // otherwise promise a stereo take that never arrives.
    if (channels > CAPTURE_CHANNELS) parts.push('kept as mono');
  }
  return parts.join(' · ');
}

/**
 * The inputs this browser will offer, newest API first.
 *
 * Labels are empty until the microphone has been allowed once - a browser
 * will not tell a page what hardware is attached before that, which is the
 * right call and means the picker is worth showing only after a first take.
 * An input with no label still has an id, so it is offered with a number
 * rather than hidden.
 */
export async function inputsOf() {
  if (!navigator?.mediaDevices?.enumerateDevices) return [];
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all
      .filter((one) => one.kind === 'audioinput')
      .map((one, i) => ({
        id: one.deviceId,
        label: one.label || `Input ${i + 1}`,
        named: Boolean(one.label),
      }));
  } catch {
    return [];
  }
}

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

/* --- and takes that are not loops --------------------------------------- */

/**
 * The longest a free take may run, in seconds.
 *
 * A cap on storage rather than on music, which is why it is minutes and not
 * bars. `wav.js` writes 24-bit, so a mono take at 48 kHz costs 141 KB a
 * second and ten minutes of it is 82 MB sitting in IndexedDB - measured,
 * from the format the writer actually emits rather than from the 16-bit
 * guess it would be easy to make.
 *
 * The recorder stops itself when it gets here, and says so. That is the
 * whole difference from the cap this replaces: eight bars was enforced by
 * CUTTING the audio after the fact, and the cut happened before `putTake`,
 * so a minute of singing became twenty seconds with nothing left to
 * recover and a message that said it had been kept.
 */
export const MOST_SECONDS = 600;

/**
 * How long a free take is allowed to be: its own length, up to the cap.
 *
 * The counterpart of `barsFor`, and deliberately not it. `barsFor` decides
 * what a loop should be and the audio is then made to fit; this reports what
 * was played and nothing is made to fit anything.
 */
export function freeSeconds(seconds) {
  if (!(seconds > 0)) return 1 / PPQ;
  return Math.min(MOST_SECONDS, seconds);
}

/**
 * A length said out loud, for a take that is no longer a number of bars.
 *
 * "Eight bars" was always the right way to say a loop and is the wrong way to
 * say a sung idea - a person who has just sung for ninety seconds wants to be
 * told ninety seconds, not "36 bars". Seconds under a minute, minutes and
 * seconds above it, and the seconds dropped when they are nothing, because
 * "2 minutes 0 seconds" is not how anybody says two minutes.
 */
export function saidLength(seconds) {
  const whole = Math.max(0, Math.round(seconds));
  if (whole < 60) return `${whole} second${whole === 1 ? '' : 's'}`;

  const mins = Math.floor(whole / 60);
  const rest = whole % 60;
  const said = `${mins} minute${mins === 1 ? '' : 's'}`;
  return rest ? `${said} ${rest}` : said;
}

/**
 * A length in ticks, for a take that is keeping its own length.
 *
 * The grid needs a number to say how long the clip is and a follow action
 * needs one to know when it ends. Both of those are ticks, and neither is
 * allowed to be used to cut the audio - which is the trap the bars path fell
 * into, where the number that described the take became the number the take
 * was trimmed to.
 *
 * Not rounded to a bar. Three and a half bars of singing is three and a half
 * bars long here, where `barsFor` would call it four and `fitTo` would then
 * add half a bar of silence to make it true.
 */
export function ticksFor(seconds, bpm, beats = 4, value = 4) {
  const per = barSeconds(bpm, beats, value);
  const bar = ticksPerBar(beats, value, PPQ);
  if (!(per > 0) || !(seconds > 0)) return 1;
  return Math.max(1, Math.round((seconds / per) * bar));
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

/**
 * The count-ins on offer, in bars.
 *
 * Nought included and first, because an idea arriving on a phone does not
 * always want counting in - half the point of a sketchpad is that the gap
 * between having the idea and keeping it is short.
 */
export const COUNT_INS = [0, 1, 2];

/**
 * A take cut back to the moment it was meant to begin.
 *
 * This is the cut the top of this file has always claimed to make. The
 * worklet stamps every block with the audio time it covers, and the point of
 * capturing on the audio thread rather than with MediaRecorder was that those
 * stamps make a take cuttable against a bar line - which is also an audio
 * time. The stamps were thrown away and `startedAt` was read by nobody, so a
 * take began wherever a finger landed.
 *
 * `at0` is the audio time of the first block kept and `from` is the time the
 * take was meant to start. Everything between them is lead-in: the gap
 * between pressing record and the bar line coming round, plus any count-in.
 *
 * Never cut to nothing. `createBuffer` throws on a buffer of no frames, and
 * the honest answer to "the take was meant to begin after it ended" is the
 * last thing that arrived rather than an exception.
 */
export function headFrom(channels, rate, at0, from) {
  if (!Array.isArray(channels) || !channels.length) return [];

  const drop = Math.round((from - at0) * rate);
  if (!(drop > 0)) return channels;

  const have = Math.min(...channels.map((channel) => channel.length));
  const cut = Math.min(drop, Math.max(0, have - 1));
  return channels.map((channel) => channel.subarray(cut));
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

/**
 * How many samples a take put at or over the ceiling.
 *
 * The number nobody could see. `autoGainControl` is asked for and switched
 * off on purpose - a sketch wants what was played, not what a phone thinks a
 * voice on a call sounds like - so the level is entirely whatever the
 * hardware hands over, and nothing reported it either during a take or after.
 *
 * Measured, on the writer this app actually has: `wav.js` writes 24-bit and
 * `quantise` clamps to plus or minus one, while Web Audio's Float32 exceeds
 * it freely. An input peaking at 1.13 - which is exactly what Chromium's own
 * fake microphone hands back - loses 31% of its samples to that clamp, each
 * one flattened, with nothing said about it.
 *
 * At or over, not merely over: a real signal essentially never lands on 1.0
 * by accident, so a sample sitting precisely there is one that something
 * upstream has already clipped.
 */
export function oversIn(channels, ceiling = 1) {
  if (!Array.isArray(channels)) return 0;
  let over = 0;
  for (const channel of channels) {
    for (let i = 0; i < (channel?.length ?? 0); i += 1) {
      if (Math.abs(channel[i]) >= ceiling) over += 1;
    }
  }
  return over;
}

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
    // What the input is doing right now, what the loudest thing it has done
    // was, and how many blocks of it came back at or over the ceiling. The
    // hold is what a peak meter is for: a transient is one block long and a
    // bar that followed it exactly would flash past too fast to read.
    this.peak = 0;
    this.held = 0;
    this.overs = 0;
    /** The take's shape so far, as `[lo, hi]` a block, for drawing it live. */
    this.live = [];
    /** The audio time of the first block kept, and the one to begin at. */
    this.firstAt = null;
    this.beginAt = 0;
    /** What `getSettings` said, once there is a stream to ask. */
    this.settings = {};
    this.deviceId = null;
    /** Called on every block, so a face can draw what is arriving. */
    this.onLevel = null;
  }

  get open() { return Boolean(this.node); }

  /** Forget the hold and the count, for a fresh take or a fresh look. */
  resetPeak() {
    this.held = 0;
    this.overs = 0;
  }

  /**
   * Ask for the microphone. Returns null when it is refused or absent.
   *
   * `deviceId` names which input, for the browsers that offer a choice. Left
   * out, the browser picks - which until now was the only thing that could
   * happen, so a better microphone plugged in was not necessarily the one
   * being recorded from.
   */
  async ask({ deviceId = null } = {}) {
    if (this.node) return this;
    if (!canRecord()) return null;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...WANTED,
          // Asked for rather than demanded: `exact` would fail outright when
          // a device has been unplugged between being listed and being
          // chosen, and the useful behaviour there is to record from
          // something rather than from nothing.
          ...(deviceId ? { deviceId } : {}),
        },
      });
    } catch {
      return null;
    }

    // What the browser actually gave, which nothing used to ask. A request
    // for no gain control is a request, and a browser is free to ignore it -
    // so the only honest way to show the setting is to read it back.
    const [track] = this.stream.getAudioTracks();
    this.settings = track?.getSettings?.() ?? {};
    this.deviceId = this.settings.deviceId ?? deviceId ?? null;

    const worklet = await installWorklet(this.ctx, captureSource());
    if (!worklet) { this.close(); return null; }

    this.node = new AudioWorkletNode(this.ctx, 'headroom-capture', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: 'explicit',
    });
    this.node.port.onmessage = (event) => {
      const { lo = 0, hi = 0, block = null } = event.data ?? {};
      const peak = Math.max(hi, -lo);

      // What the meter reads, kept whether or not a take is running.
      this.peak = peak;
      if (peak > this.held) this.held = peak;
      if (peak >= 1) this.overs += 1;

      // And the shape so far, one pair a block, while a take is running. Kept
      // as pairs rather than re-summarised from the blocks each frame: a
      // ten-minute take is 225,000 blocks, and walking all of them sixty
      // times a second is the one way to make a waveform cost something.
      if (this.taking) {
        // The audio time of the first block kept. This is the stamp the whole
        // architecture was chosen for and which used to be discarded: without
        // it there is nothing to measure a bar line against, and a take
        // begins wherever a finger landed.
        if (this.firstAt === null) this.firstAt = event.data?.at ?? null;
        this.live.push(lo, hi);
        if (block) this.blocks.push(block);
      }

      this.onLevel?.(this);
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
  /**
   * Begin keeping what arrives.
   *
   * `from` is an audio time to begin the take AT, which may be later than the
   * press: the next bar line, plus any count-in. Everything before it is
   * still captured - a take is kept from the moment of pressing so that
   * nothing played early is lost - and cut off in `stop`.
   */
  start({ from = 0 } = {}) {
    if (!this.node) return false;
    this.blocks = [];
    this.live = [];
    this.firstAt = null;
    this.beginAt = from;
    this.resetPeak();
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

    const joined = joinBlocks(this.blocks);
    this.blocks = [];
    if (!joined.length) return null;

    const rate = this.ctx.sampleRate;
    // Cut to the bar line, which is what the stamps were kept for. With no
    // bar line asked for - the transport stopped, an idea that wants keeping
    // now - `beginAt` is nought and nothing is dropped.
    const channels = this.beginAt > 0 && this.firstAt !== null
      ? headFrom(joined, rate, this.firstAt, this.beginAt)
      : joined;

    return {
      channels,
      rate,
      seconds: channels[0].length / rate,
      startedAt: this.startedAt,
      // What was cut off the front, so a caller can say so rather than
      // leaving somebody wondering where their count-in went.
      leadIn: (joined[0].length - channels[0].length) / rate,
    };
  }

  /** Which of the three the browser overrode, if it says anything at all. */
  get overridden() { return overriddenIn(this.settings); }

  /**
   * Open a different input.
   *
   * Torn down and asked again rather than swapped on the live graph, because
   * a MediaStreamSource belongs to the stream it was made from and the
   * capture node's channel count is fixed at construction.
   */
  async use(deviceId) {
    const level = this.onLevel;
    this.close();
    this.onLevel = level;
    return this.ask({ deviceId });
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
    this.settings = {};
  }
}
