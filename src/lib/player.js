import { signalRms } from './dsp.js';
import { LoopPlayer } from './loop-player.js';

/**
 * The loop, through two of something, with a switch between them.
 *
 *   dry loop ─┬─ yours:  dry ─┐
 *             │         wet ─┴─ yours  ─┐
 *             └─ theirs: dry ─┐         ├─ out
 *                       wet ─┴─ theirs ─┘
 *
 * The something is whatever `impulseOf` builds - a room, anything that can be
 * written down as an impulse response - or, for anything that cannot, a graph
 * handed over by `wetOf`. The reverb is the first; the delay used to be and
 * is now the second, because a transport that wanders is not a response.
 * Neither of them needs a player of its own.
 *
 * The wet side is rendered rather than processed live, which is the decision
 * everything else here follows from. A ConvolverNode handed a new impulse
 * throws away its history, so its tail has to build again from nothing - and
 * with a two second room that is two seconds of it fading up every time a
 * knob moves. Rendering the loop through the impulse offline instead gives a
 * wet loop that is already whole, and changing a setting becomes a crossfade
 * between two of them. For a delay it buys something else as well: the
 * repeats land exactly where the setting says, rather than being retimed
 * under a moving playhead.
 *
 * The render also wraps: what is still sounding when the loop comes round is
 * folded back over the beginning, so the effect joins up instead of being cut
 * off at the splice. That is the same trick the bed itself is built with, and
 * a tail is where you would hear it missing.
 *
 * Starting, stopping, building once and taking it all down are
 * lib/loop-player.js's. What is here is the two sides and the crossfade
 * between wet loops, which the base has no word for: a swap starts a loop
 * while the one it replaces is still fading out, so each wet loop comes in
 * through a fade of its own, and the fade is let go when its loop ends. Those
 * fades were half of a leak: stopping a loop unwired the loop and left its
 * fade wired to the side, one more on every play and every swap. The other
 * half was the sides themselves, which destroy never took down - it
 * unwired the meter and nothing that fed it.
 */
export class ImpulsePlayer extends LoopPlayer {
  constructor(engine, {
    source = 'instrument', impulseOf = null, wetOf = null, tailOf = null, defaults = {},
  } = {}) {
    super(engine, { source, spread: false });
    this.impulseOf = impulseOf;
    // The two halves of the other way of making a wet loop: how long to keep
    // rendering after the loop has ended, and what to put in the middle. Two
    // functions rather than one because the context has to be built before
    // anything can be put in it, and it cannot be built without knowing how
    // long it is.
    this.wetOf = wetOf;
    this.tailOf = tailOf;
    this.defaults = defaults;
    this.settings = { ...defaults };
    this.target = null;
    this.dryRms = 0;
    // The loop the sources now sounding were started from, which a render
    // has to be of to be faded in over them.
    this.looping = null;

    // The sides exist before the graph does, so that a render asked for
    // before anything has played has somewhere to be kept. `raise` gives
    // them their nodes.
    this.mine = this.sideOf();
    this.theirs = this.sideOf();
  }

  /** One room's record: what was rendered for it, and what is playing it. */
  sideOf() {
    return { made: null, pending: null, asked: 0, voices: new Set() };
  }

  async raise(ctx) {
    this.meter = this.own(ctx.createAnalyser());
    this.meter.fftSize = 1024;
    this.meter.connect(this.engine.out);

    this.side(ctx, this.mine, this.hearing === 'mine' ? 1 : 0);
    this.side(ctx, this.theirs, this.hearing === 'mine' ? 0 : 1);
    // Each side's select is its place in the A/B, and so what the base flips.
    this.mineOut = this.mine.select;
    this.theirsOut = this.theirs.select;
  }

  /** One room: its own dry and wet balance, and its own place in the A/B. */
  side(ctx, side, listening) {
    side.select = this.own(ctx.createGain());
    side.select.gain.value = listening;
    side.select.connect(this.meter);

    side.dry = this.own(ctx.createGain());
    side.wet = this.own(ctx.createGain());
    side.dry.connect(side.select);
    side.wet.connect(side.select);
    return side;
  }

  /* ---------- the material ---------- */

  async prepare() {
    const was = this.buffer;
    const ok = await super.prepare();
    if (ok && this.buffer !== was) {
      this.dryRms = signalRms(this.buffer.getChannelData(0));
      // Both rooms were rendered into the old loop, and so is anything still
      // rendering: none of it is any use now.
      for (const side of [this.mine, this.theirs]) {
        side.made = null;
        side.pending = null;
        side.asked += 1;
      }
    }
    return ok;
  }

  /** An impulse response, as something Web Audio will convolve with. */
  toBuffer(impulse, into = this.engine.ctx) {
    const buffer = into.createBuffer(impulse.channels.length, impulse.length, impulse.rate);
    impulse.channels.forEach((channel, i) => buffer.copyToChannel(channel, i));
    return buffer;
  }

  /**
   * The loop with the effect on it, rendered whole.
   *
   * In an offline context either way, which is what keeps this off the frame:
   * convolving a quarter of a million samples with a hundred thousand in
   * JavaScript would never fit in one, and running a per-sample loop over the
   * same quarter million would fit but would still be a tenth of a second of
   * the main thread on every knob move. An offline render is neither.
   *
   * `wetOf` is how an effect that is not a response says what to put in the
   * middle. Without one, the response is convolved as it always was.
   */
  async renderWet(settings) {
    const ctx = this.engine.ensure();
    const rate = ctx.sampleRate;
    const loop = this.buffer.length;

    const impulse = this.wetOf ? null : this.impulseOf(rate, settings);
    const tail = impulse ? impulse.length : this.tailOf(rate, settings).length;

    const offline = new OfflineAudioContext(2, loop + tail, rate);
    const source = offline.createBufferSource();
    source.buffer = this.buffer;

    let middle;
    if (impulse) {
      const convolver = offline.createConvolver();
      // Off, because the impulse arrives at the level it means and a second
      // normalisation with a rule of its own would put that back out of
      // anybody's hands.
      convolver.normalize = false;
      convolver.buffer = this.toBuffer(impulse, offline);
      middle = { in: convolver, out: convolver };
    } else {
      middle = await this.wetOf(offline, settings);
    }

    source.connect(middle.in);
    middle.out.connect(offline.destination);
    source.start(0);

    const rendered = await offline.startRendering();
    const wet = ctx.createBuffer(2, loop, rate);

    for (let c = 0; c < 2; c += 1) {
      const from = rendered.getChannelData(c);
      const to = wet.getChannelData(c);
      for (let i = 0; i < loop; i += 1) to[i] = from[i];
      // What was still ringing at the splice comes back round with it - every
      // time round, for a tail longer than the loop.
      for (let i = loop; i < from.length; i += 1) to[i % loop] += from[i];
    }

    const rms = signalRms(wet.getChannelData(0));

    return { wet, impulse, rms };
  }

  /* ---------- the settings ---------- */

  async setSettings(settings) {
    this.settings = { ...this.settings, ...settings };
    return this.make('mine');
  }

  async setTarget(settings) {
    this.target = settings ? { ...this.defaults, ...settings } : null;
    if (!this.target) return null;
    return this.make('theirs');
  }

  /** What a side is set to now: yours, or the target. */
  settingsOf(which) {
    return which === 'mine' ? this.settings : this.target;
  }

  /**
   * Builds a room and, if anything is playing, fades into it.
   *
   * Once per setting: asked again for what is already rendered, or already
   * rendering, into the same loop, it hands back that rather than starting a
   * second. And numbered: a render overtaken by a newer one for the same
   * side, a new loop or a destroy by the time it is done is dropped, rather
   * than faded in over the top of whatever came after it.
   */
  make(which, { swap = true } = {}) {
    const side = this[which];
    const settings = this.settingsOf(which);
    if (!settings || !this.buffer || this.life) return Promise.resolve(null);

    const key = JSON.stringify(settings);
    const loop = this.buffer;
    if (side.made?.key === key && side.made.loop === loop) return Promise.resolve(side.made);
    if (side.pending?.key === key && side.pending.loop === loop) return side.pending.made;

    const asked = (side.asked += 1);
    const kept = { ...settings };
    const made = (async () => {
      try {
        const wet = await this.renderWet(kept);
        if (asked !== side.asked || loop !== this.buffer || this.life) return null;
        side.made = { ...wet, key, loop, settings: kept };
        this.balance(side, kept, side.made);
        if (swap && this.playing && this.looping === loop) this.swap(side, side.made.wet);
        return side.made;
      } finally {
        // Whichever way it went, it is not rendering any more - and a failed
        // render left as the one in flight would be handed to everyone after.
        if (side.pending?.made === made) side.pending = null;
      }
    })();
    side.pending = { key, loop, made };
    return made;
  }

  /**
   * How loud each half of this is.
   *
   * The wet path is trimmed to the level of the dry one first, so that `mix`
   * is a balance rather than a number whose meaning depends on how long the
   * tail is. Then the pair is trimmed together, so that moving the mix does
   * not change how loud the whole thing is - the same reason every other
   * plugin in this app has an auto gain, and the same false positive it
   * exists to kill.
   */
  balance(side, settings, made) {
    if (!this.ready) return;
    const at = this.engine.ctx.currentTime;
    const mix = Math.min(1, Math.max(0, settings.mix));

    const match = made.rms > 1e-9 ? this.dryRms / made.rms : 0;
    const trim = 1 / Math.sqrt((1 - mix) ** 2 + mix ** 2);

    side.dry.gain.setTargetAtTime((1 - mix) * trim, at, 0.02);
    side.wet.gain.setTargetAtTime(mix * match * trim, at, 0.02);
    side.trim = trim;
  }

  /** Each side at the balance of the room it has, once there is a graph to set. */
  apply() {
    for (const side of [this.mine, this.theirs]) {
      if (side.made) this.balance(side, side.made.settings, side.made);
    }
  }

  /* ---------- transport ---------- */

  /**
   * The base's play, with the rooms rendered first - numbered the same way,
   * so a play overtaken while it waits on a render does nothing.
   */
  async play() {
    if (this.life) return false;
    const turn = (this.turn += 1);
    await this.build();
    if (turn !== this.turn) return false;
    if (!this.buffer) await this.prepare();
    if (turn !== this.turn || !this.buffer) return false;

    await this.rendered('mine');
    if (this.target) await this.rendered('theirs');
    if (turn !== this.turn) return false;
    return super.play();
  }

  /**
   * One side's room, rendered into the current loop if it is not already.
   * Not faded in as it lands: the play waiting on it starts everything.
   */
  async rendered(which) {
    const side = this[which];
    // Round again while what came back was dropped - for a loop since
    // replaced, or overtaken by newer settings, whose render is then the one
    // joined.
    while (this.buffer && !this.life && this.settingsOf(which) && side.made?.loop !== this.buffer) {
      await this.make(which, { swap: false });
    }
    return side.made;
  }

  // One dry loop feeding both sides, so flipping between them is the effect
  // changing and not the take changing.
  wire(at) {
    this.looping = this.buffer;
    this.start(this.buffer, (node) => {
      node.connect(this.mine.dry);
      node.connect(this.theirs.dry);
    }, at);
    for (const side of [this.mine, this.theirs]) {
      if (side.made?.loop === this.buffer) this.enter(side, side.made.wet, at, 0);
    }
  }

  /**
   * Starts one wet loop into a side at a given point of the loop, through a
   * fade of its own - let go when the loop ends, which for one swapped out is
   * once its fade is over.
   */
  enter(side, wet, at, offset) {
    const gain = this.engine.ctx.createGain();
    gain.gain.value = 0;
    const node = this.start(wet, (source) => source.connect(gain).connect(side.wet), at, { offset });
    gain.gain.setTargetAtTime(1, at, 0.02);

    const voice = { node, gain };
    side.voices.add(voice);
    node.addEventListener('ended', () => this.release(side, voice));
    return voice;
  }

  /**
   * One wet loop and its fade, unwired. The loop as well, because one that
   * ends on its own - swapped out - is let go of by the base but not
   * disconnected, and would stay wired to its fade.
   */
  release(side, voice) {
    try { voice.node.disconnect(); } catch { /* already gone */ }
    try { voice.gain.disconnect(); } catch { /* already gone */ }
    side.voices.delete(voice);
  }

  /**
   * Fades from what is playing into what was just built.
   *
   * Started at the point of the loop the old one has reached, so the two are
   * the same bar and the crossfade is between two settings rather than
   * between two places in the music.
   */
  swap(side, wet) {
    const ctx = this.engine.ctx;
    const at = ctx.currentTime + 0.02;
    const length = this.buffer.duration;
    const offset = (((at - this.began) % length) + length) % length;

    for (const old of side.voices) {
      old.gain.gain.cancelScheduledValues(at);
      old.gain.gain.setTargetAtTime(0, at, 0.02);
      try { old.node.stop(at + 0.25); } catch { /* already stopped */ }
    }

    this.enter(side, wet, at, offset);
  }

  /** Every source stopped as the base stops them, and their fades let go. */
  silence() {
    super.silence();
    this.looping = null;
    for (const side of [this.mine, this.theirs]) {
      for (const voice of side.voices) this.release(side, voice);
    }
  }

  /** What is coming out, in dB, for a meter. */
  level() {
    if (!this.ready) return -60;
    const frame = new Float32Array(this.meter.fftSize);
    this.meter.getFloatTimeDomainData(frame);
    let peak = 0;
    for (const sample of frame) {
      const value = sample < 0 ? -sample : sample;
      if (value > peak) peak = value;
    }
    return 20 * Math.log10(peak + 1e-6);
  }
}
