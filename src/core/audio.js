import { LOOP_BPM, LOOP_BARS, LOOP_BEAT } from '../lib/tempo.js';

// Re-exported because this is where the rest of the app has always asked
// for them, and the engine is the thing that cuts the loops they describe.
export { LOOP_BPM, LOOP_BARS, LOOP_BEAT };

// The sound of the whole suite, synthesised live. No samples to host, and no
// mode has to know how another one makes its noise: a mode builds whatever
// processing it wants out of `ctx`, connects it to `out`, and asks the engine
// for a source through it.

const PARTIALS = [
  { ratio: 1, gain: 1.0, type: 'sine' },
  { ratio: 2, gain: 0.32, type: 'sine' },
  { ratio: 3, gain: 0.14, type: 'sine' },
  { ratio: 4, gain: 0.07, type: 'triangle' },
  { ratio: 6, gain: 0.03, type: 'sine' },
];

export function midiToFreq(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

export const dbToGain = (db) => 10 ** (db / 20);

/**
 * The kit, as recipes: where the noise is filtered and how long it rings.
 *
 * `level` is set so that one hit at level 1 comes out where a record would
 * put it - kick loudest, snare a couple of decibels under it, hats well
 * down. It has to be set rather than guessed,
 * because these pieces are made in completely different ways: the kick is an
 * oscillator and comes out at whatever it is told, while the others are a
 * burst of noise through a narrow band, where nearly all of what goes in is
 * thrown away. At the same nominal level the snare landed almost eighteen
 * decibels under the kick, which is not a drum loop, and every part of the
 * app that wanted an audible snare had been correcting for it by hand at the
 * call site with numbers like `level: 5`.
 *
 * Measured, one hit at a time, rendered offline: kick -6.2 dBFS peak,
 * snare -8, hat -24. The two noise pieces wander by a decibel or so from
 * render to render, because the burst is taken from a random point of the
 * noise buffer at a random speed - which is what stops eight hats in a row
 * sounding like one hat eight times.
 */
/**
 * The vowel, as three resonances.
 *
 * Roughly an "ah": a first formant around 700 Hz, a second around 1200 and a
 * third near 2600. The exact numbers are a vowel chart's and the point of
 * having three rather than two is that two sounds like a filter sweep and
 * three sounds like a mouth.
 */
const FORMANTS = [
  { hz: 700, q: 6, gain: 1.0 },
  { hz: 1220, q: 8, gain: 0.5 },
  { hz: 2600, q: 9, gain: 0.22 },
];

/** And the sibilant: where an S lives, how wide it is, and how long. */
const ESS_HZ = 7000;
const ESS_Q = 0.9;
const ESS_LENGTH = 0.085;

/**
 * What a close mic hears between the hits: the room, the bleed and the hum.
 *
 * Built for the gate, and it had to be. Measured, the `drums` bed is digital
 * silence for more than half of its length - in ten millisecond frames its
 * median level reads -180 dBFS - so a gate over it is deciding how much
 * quieter to make nothing. The threshold, which is the control a gate is
 * about, read 4.34 dB of reduction away from an open gate at -44 and 4.68 at
 * -20: a quarter of a decibel of marking over twenty-four decibels of knob.
 *
 * So there is a second drum bed with a floor under it. Noise rolled off at
 * four kilohertz is the room; a tone at the snare's shell pitch is the bleed
 * that never quite stops ringing; and the ghost notes are what makes the
 * threshold a decision rather than a formality - set it above them and the
 * gate takes them out with the room.
 *
 * Measured on the rendered loop: the hits peak at -10.3 dBFS, the ghosts at
 * -27.6, and the floor between them sits at -43.9. Which is the band the
 * gate's rounds place a threshold in.
 */
const ROOM_NOISE = 0.014;
const ROOM_TONE_HZ = 180;
const ROOM_TONE = 0.0045;
const ROOM_ROLLOFF = 4000;
const GHOST_LEVEL = 0.13;

const KIT = {
  kick: { thump: 92, to: 44, decay: 0.24, level: 1.0 },
  snare: { hz: 1900, q: 0.8, decay: 0.16, level: 2.9 },
  hat: { hz: 9000, q: 1.1, decay: 0.05, level: 0.55 },
};

export class Engine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.voices = [];
    this.noise = null;
    this.loops = new Map();
  }

  /** Browsers only allow audio after a gesture, so this runs on first play. */
  ensure() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.7;
      this.master.connect(this.ctx.destination);
    }
    // Only a live context is resumed. An offline one is suspended until it is
    // rendered, and asking it to resume rejects a promise rather than throwing
    // - so a try/catch does not catch it, and it surfaces as an unhandled
    // rejection in the console on every render.
    const offline = typeof this.ctx.startRendering === 'function';
    if (!offline && this.ctx.state === 'suspended') {
      this.ctx.resume()?.catch?.(() => { /* the gesture will come */ });
    }
    return this.ctx;
  }

  /** Where a mode's processing chain ends up. */
  get out() {
    return this.master;
  }

  /** Now, plus a beat to get the first sound out cleanly. */
  get start() {
    return this.ctx.currentTime + 0.06;
  }

  /**
   * Everything sounding, stopped - including what is only scheduled.
   *
   * A clue is a bar or two of audio handed to Web Audio in one go, so by the
   * time someone presses play again most of the last one exists as nodes with
   * their start times booked. Stopping only what is audible would leave the
   * rest to arrive on top of the new clue.
   */
  stop() {
    if (!this.ctx) return;
    const at = this.ctx.currentTime;

    for (const voice of this.voices) {
      try {
        voice.gain.gain.cancelScheduledValues(at);
        voice.gain.gain.setTargetAtTime(0.0001, at, 0.015);
        voice.stop(at + 0.12);
      } catch {
        // Already stopped, or a ramp with nothing to cancel. Either way it is
        // not going to sound, which is all this wanted.
      }
    }
    this.voices = [];
  }

  /** Keeps a scheduled voice where `stop` can find it, pruning what has ended. */
  keep(voice) {
    const now = this.ctx.currentTime;
    this.voices = this.voices.filter((booked) => booked.endsAt > now);
    this.voices.push(voice);
    return voice;
  }

  noiseBuffer() {
    if (this.noise) return this.noise;
    const buffer = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * 2), this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    // Pink-ish: white noise rolled off, which sits better under music than white.
    let last = 0;
    for (let i = 0; i < data.length; i += 1) {
      const white = Math.random() * 2 - 1;
      last = 0.97 * last + 0.03 * white;
      data[i] = (white * 0.3) + (last * 3);
    }
    this.noise = buffer;
    return buffer;
  }

  /* ---------- voices ---------- */

  /** One piano-ish note: additive partials under a plucked decay. */
  note(midi, at, duration, { velocity = 1, dest = null } = {}) {
    const freq = midiToFreq(midi);
    const decay = Math.max(0.5, duration * (midi > 72 ? 0.8 : 1.15));
    const target = dest || this.master;

    for (const partial of PARTIALS) {
      const osc = this.ctx.createOscillator();
      osc.type = partial.type;
      osc.frequency.value = freq * partial.ratio;

      const gain = this.ctx.createGain();
      const peak = 0.16 * partial.gain * velocity;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(peak, at + 0.008);
      gain.gain.exponentialRampToValueAtTime(peak * 0.28, at + 0.28);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + decay);

      osc.connect(gain).connect(target);
      osc.start(at);
      osc.stop(at + decay + 0.05);
      this.keep({ gain, endsAt: at + decay, stop: (when) => osc.stop(when) });
    }
  }

  /** A plain tone - a sine with a little body. For a reference pitch. */
  tone(midi, at, duration, { dest = null, level = 0.22 } = {}) {
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = midiToFreq(midi);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(level, at + 0.02);
    gain.gain.setValueAtTime(level, at + duration - 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);

    osc.connect(gain).connect(dest || this.master);
    osc.start(at);
    osc.stop(at + duration + 0.05);
    this.keep({ gain, endsAt: at + duration, stop: (when) => osc.stop(when) });
  }

  /**
   * One syllable of a voice that does not exist: an ess, then a vowel.
   *
   * There was no sibilant material in this app and a de-esser cannot be heard
   * on material that has none. Everything else here is tones and drums - the
   * hats are the only thing with any energy above five kilohertz, and ducking
   * a hi-hat is a different thing from ducking an S both musically and in
   * what it teaches.
   *
   * So: a vowel is a sawtooth through three parallel bandpass formants, which
   * is the oldest way of faking one and is enough to sound like a voice at
   * the wrong end of a telephone. An ess is a short band of noise at seven
   * kilohertz in front of it. Nobody will mistake it for singing; what it has
   * to be is a signal whose sibilance sits where sibilance sits, and that it
   * is.
   *
   * `ess` is how loud the sibilant is against the vowel, and it is what makes
   * the material a problem worth solving: at 1 it peaks about where the vowel
   * does while carrying almost all of its energy above five kilohertz, which
   * is exactly the thing a de-esser is for and exactly the thing a broadband
   * compressor handles by ducking the whole voice.
   */
  syllable(at, { midi = 52, ess = 1, duration = 0.34, dest = null, level = 1 } = {}) {
    const target = dest || this.master;

    if (ess > 0) {
      const source = this.ctx.createBufferSource();
      source.buffer = this.noiseBuffer();
      source.playbackRate.value = 1 + Math.random() * 0.06;

      const band = this.ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = ESS_HZ;
      band.Q.value = ESS_Q;

      // Up, held, and away. The hold is what makes it a fricative rather
      // than a click, and it is what a de-esser needs: measured, with the
      // ess decaying from its peak the moment it reached it, a detector
      // listening above six kilohertz was over its threshold for long enough
      // to ask for a third of a decibel on average - so a de-esser taking
      // four decibels off read 0.83 dB away from one switched off, and every
      // tolerance the exercise could have had would have accepted the bypass.
      const gain = this.ctx.createGain();
      const peak = Math.max(0.001, 0.42 * ess * level);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(peak, at + 0.012);
      gain.gain.setValueAtTime(peak, at + ESS_LENGTH * 0.7);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + ESS_LENGTH);

      source.connect(band).connect(gain).connect(target);
      source.start(at, Math.random());
      const endsAt = at + ESS_LENGTH + 0.05;
      source.stop(endsAt);
      this.keep({ gain, endsAt, stop: (when) => source.stop(when) });
    }

    // The vowel starts while the ess is still going, which is what a
    // consonant into a vowel does - they overlap rather than queue.
    const from = at + (ess > 0 ? ESS_LENGTH * 0.7 : 0);
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = midiToFreq(midi);

    const body = this.ctx.createGain();
    const peak = 0.5 * level;
    body.gain.setValueAtTime(0.0001, from);
    body.gain.linearRampToValueAtTime(peak, from + 0.03);
    body.gain.setValueAtTime(peak, from + duration * 0.6);
    body.gain.exponentialRampToValueAtTime(0.0001, from + duration);
    osc.connect(body);

    for (const formant of FORMANTS) {
      const band = this.ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = formant.hz;
      band.Q.value = formant.q;
      const gain = this.ctx.createGain();
      gain.gain.value = formant.gain;
      body.connect(band).connect(gain).connect(target);
    }

    const endsAt = from + duration + 0.05;
    osc.start(from);
    osc.stop(endsAt);
    this.keep({ gain: body, endsAt, stop: (when) => osc.stop(when) });
  }

  /** One piece of the kit. */
  drum(piece, at, { level = 1, dest = null } = {}) {
    const recipe = KIT[piece];
    const target = dest || this.master;

    const gain = this.ctx.createGain();
    const peak = recipe.level * level * 0.5;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.001), at + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + recipe.decay);
    gain.connect(target);

    const endsAt = at + recipe.decay + 0.05;

    if (recipe.thump) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = recipe.thump;
      osc.frequency.setValueAtTime(recipe.thump, at);
      osc.frequency.exponentialRampToValueAtTime(recipe.to, at + recipe.decay * 0.7);
      osc.connect(gain);
      osc.start(at);
      osc.stop(endsAt);
      this.keep({ gain, endsAt, stop: (when) => osc.stop(when) });
      return;
    }

    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer();
    source.playbackRate.value = 1 + Math.random() * 0.1;

    const band = this.ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = recipe.hz;
    band.Q.value = recipe.q;

    source.connect(band).connect(gain);
    source.start(at, Math.random());
    source.stop(endsAt);
    this.keep({ gain, endsAt, stop: (when) => source.stop(when) });
  }

  /* ---------- clues ---------- */

  /**
   * Somewhere to send a sound so that it lands in a particular place.
   *
   * Equal power, which is what a pan control on a desk is: a gain difference
   * would be a balance control and would read as a level change rather than
   * as a placing. Kept in @p places so that a bed with a thousand notes in it
   * builds five panners rather than a thousand.
   */
  at(places, pan, dest) {
    const key = pan.toFixed(3);
    if (!places.has(key)) {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      panner.connect(dest || this.master);
      places.set(key, panner);
    }
    return places.get(key);
  }

  /** Play notes together, or one after another. */
  playNotes(notes, { arpeggio = false, duration = 2.4, dest = null, at = null, velocity = 1, fan = null } = {}) {
    this.ensure();
    const start = at ?? this.start;
    const step = arpeggio ? 0.34 : 0.012; // a tiny spread keeps a block chord human

    notes.forEach((midi, i) => {
      // Fanned across the field, low notes to the left, which is how a chord
      // is voiced across a keyboard and how it ends up sitting in a mix.
      const to = fan
        ? this.at(fan.places, -fan.width + (2 * fan.width * i) / Math.max(1, notes.length - 1), dest)
        : dest;

      this.note(midi, start + i * step, arpeggio ? duration * 0.7 : duration,
                { dest: to, velocity: velocity * (i === 0 ? 1 : 0.85) });
    });
    return start;
  }

  /**
   * A few bars of material to judge something against.
   *
   * `mix` is a whole band - kick, bass, chord, hats - which is broadband enough
   * that a move anywhere in the spectrum has something to act on. `instrument`
   * is the piano alone, which is the easier source to hear a move in because
   * there is less going on and nothing masking it. `drums` is transients only,
   * for anything being judged on how it handles them, and `room` is the same
   * kit with ghost notes and a floor under it, for anything being judged on
   * what it does to the quiet - see `ROOM_NOISE`.
   */
  playBed(kind, { seconds = 4, dest = null, at = null, bpm = 96, uneven = 0, spread = false } = {}) {
    this.ensure();
    const start = at ?? this.start;
    const beat = 60 / bpm;
    const bars = Math.ceil(seconds / (beat * 4));
    const chord = [48, 55, 60, 64, 67]; // Cm-ish spread: root, fifth, octave, third
    const bass = [36, 36, 43, 41];
    // What the voice sings: four notes of the same scale, in a speaking range.
    const SUNG = [55, 57, 55, 50];

    // Where each part sits, when the bed is being laid out across a field
    // rather than stacked in the middle. The bass is the interesting one: a
    // detuned pair hard left and right is a thing people really do to make a
    // low end sound big, and it is also how a low end stops surviving a fold
    // to mono - which is the fault the imaging exercise asks you to undo.
    const places = new Map();
    const to = (pan) => (spread ? this.at(places, pan, dest) : dest);
    const FIELD = { kick: 0, snare: 0.22, hat: -0.6, chord: 0.7, bass: 0.8 };

    // `uneven` is how many decibels the quiet beats sit below the loud ones -
    // the fault a compressor is asked to even out. Beat by beat rather than bar
    // by bar, so the unevenness is inside the phrase where it is obvious.
    const quiet = 10 ** (-uneven / 20);

    for (let bar = 0; bar < bars; bar += 1) {
      const barAt = start + bar * beat * 4;

      for (let step = 0; step < 8; step += 1) {
        const when = barAt + step * beat * 0.5;
        const swing = uneven && Math.floor(step / 2) % 2 === 1 ? quiet : 1;

        // Two stems that only exist to be sidechained together: a kick on
        // every beat, and a bass playing straight through it. Ducking one
        // under the other is the thing the technique was invented for, and it
        // cannot be shown on a bed where they are already mixed.
        if (kind === 'kick') {
          if (step % 2 === 0) this.drum('kick', when, { dest, level: swing });
          continue;
        }
        if (kind === 'bass') {
          this.note(bass[(bar * 8 + step) % bass.length] - 12, when, beat * 0.62,
                    { dest: to(0), velocity: 0.95 * swing });
          continue;
        }

        // A phrase of eight syllables a bar, three in four with an ess on the
        // front. The ones without are there so that a de-esser can be heard
        // leaving something alone as well as taking something down - a loop
        // where every syllable hisses is a loop where a broadband compressor
        // looks as good as a de-esser.
        //
        // Eight rather than four, which is three and a bit syllables a second
        // and is how fast people actually talk. At four a bar the sibilance
        // was sparse enough that what a de-esser did to the loop as a whole
        // was down in the noise of the reading that marks it.
        if (kind === 'voice') {
          const say = (bar * 8 + step) % 4;
          this.syllable(when, {
            midi: SUNG[say],
            ess: say === 2 ? 0 : 1,
            duration: beat * 0.42,
            dest: to(0),
            level: swing,
          });
          continue;
        }

        if (kind !== 'instrument') {
          if (step === 0 || step === 5) this.drum('kick', when, { dest: to(FIELD.kick), level: swing });
          if (step === 2 || step === 6) this.drum('snare', when, { dest: to(FIELD.snare), level: swing });
          if (kind !== 'drums' && kind !== 'room') {
            this.drum('hat', when, { dest: to(step % 2 ? FIELD.hat : -FIELD.hat * 0.7), level: swing * (step % 2 ? 0.5 : 0.8) });
          }
        }

        // Ghost notes, on the steps the backbeat leaves empty. A drummer's
        // left hand, and the thing a threshold set by eye takes out without
        // anybody noticing until the part sounds square.
        if (kind === 'room' && step !== 0 && step !== 2 && step !== 5 && step !== 6) {
          this.drum('snare', when, { dest: to(FIELD.snare), level: swing * GHOST_LEVEL });
        }

        if (kind === 'drums' || kind === 'room') continue;

        // The piano lands on the beat; the bass walks under it.
        if (step % 4 === 0) {
          this.playNotes(chord, {
            duration: beat * 1.6, dest, at: when, velocity: swing,
            fan: spread ? { places, width: FIELD.chord } : null,
          });
        }
        if (kind === 'mix' && step % 2 === 0) {
          const note = bass[(bar * 4 + step / 2) % bass.length];
          if (spread) {
            // The same note twice, a quarter of a semitone apart, hard left
            // and hard right. Detuning is what decorrelates it, and
            // decorrelated is what makes it wide - and what makes it vanish
            // in mono once somebody widens it further. A quarter of a
            // semitone reads as thickness rather than as wrongness on a note
            // this short, and it is what takes the low band's correlation
            // down to about a half, which is where the fault has something
            // to work on.
            this.note(note * 1, when, beat * 0.9, { dest: this.at(places, -FIELD.bass, dest), velocity: 0.64 * swing });
            this.note(note + 0.25, when, beat * 0.9, { dest: this.at(places, FIELD.bass, dest), velocity: 0.64 * swing });
          } else {
            this.note(note, when, beat * 0.9, { dest, velocity: 0.9 * swing });
          }
        }
      }
    }

    if (kind === 'room') this.bleed(start, seconds, dest);

    return { start, seconds: bars * beat * 4 };
  }

  /**
   * The floor under the `room` bed: the room itself, and the bleed.
   *
   * It stops exactly where the loop does rather than running into the tail,
   * and that is deliberate. `renderLoop` folds whatever is still ringing past
   * the splice back over the beginning, which is right for a decaying chord
   * and wrong for a continuous floor - two independent passes of noise laid
   * over each other is three decibels more floor for the first second and a
   * half of every pass, and a gate's threshold sitting in that step would
   * behave differently at the top of the loop than at the bottom.
   */
  bleed(at, seconds, dest = null) {
    const target = dest || this.master;
    const endsAt = at + seconds;

    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer();
    source.loop = true;

    const roll = this.ctx.createBiquadFilter();
    roll.type = 'lowpass';
    roll.frequency.value = ROOM_ROLLOFF;

    const gain = this.ctx.createGain();
    gain.gain.value = ROOM_NOISE;
    source.connect(roll).connect(gain).connect(target);
    source.start(at);
    source.stop(endsAt);
    this.keep({ gain, endsAt, stop: (when) => source.stop(when) });

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = ROOM_TONE_HZ;
    const hum = this.ctx.createGain();
    hum.gain.value = ROOM_TONE;
    osc.connect(hum).connect(target);
    osc.start(at);
    osc.stop(endsAt);
    this.keep({ gain: hum, endsAt, stop: (when) => osc.stop(when) });
  }

  /**
   * A few bars rendered into a buffer, so they can be looped seamlessly under
   * something you are adjusting while it plays.
   *
   * Scheduling the bed live would work for a clue that starts and finishes,
   * and not for a tool: an EQ is judged by moving a band and hearing the same
   * material change under your hands, which needs a loop that never stops and
   * never restarts.
   *
   * The tail is folded back over the beginning rather than cut off. A loop of
   * a decaying pattern has a chord still ringing when the splice comes round,
   * and chopping it there is an audible click on every pass.
   */
  async renderLoop(kind, { bars = LOOP_BARS, bpm = LOOP_BPM, uneven = 0, spread = false } = {}) {
    this.ensure();
    // `uneven` and `spread` are part of what the loop is, not ways of playing
    // it - a bed whose hits are all over the place is a different recording,
    // and so is one laid out across a field - so both are part of the key
    // this is remembered under.
    const held = `${kind}:${bars}:${bpm}:${uneven}:${spread}`;
    if (this.loops.has(held)) return this.loops.get(held);

    const rate = this.ctx.sampleRate;
    const beat = 60 / bpm;
    const length = bars * 4 * beat;
    const tail = 1.6;

    const channels = spread ? 2 : 1;
    const offline = new OfflineAudioContext(channels, Math.ceil(rate * (length + tail)), rate);
    const scratch = new Engine();
    scratch.ctx = offline;
    scratch.master = offline.createGain();
    scratch.master.gain.value = 1;
    scratch.master.connect(offline.destination);

    if (kind === 'noise') scratch.playNoiseBed(length + tail, bpm);
    else scratch.playBed(kind, { seconds: length, at: 0, bpm, uneven, spread });

    const rendered = await offline.startRendering();
    const samples = Math.floor(rate * length);
    const loop = this.ctx.createBuffer(channels, samples, rate);

    for (let c = 0; c < channels; c += 1) {
      const source = rendered.getChannelData(c);
      const data = loop.getChannelData(c);
      for (let i = 0; i < samples; i += 1) data[i] = source[i];
      // What was still ringing at the splice comes back round with it.
      for (let i = 0; i + samples < source.length; i += 1) data[i] += source[i + samples];
    }

    this.loops.set(held, loop);
    return loop;
  }

  /**
   * Pink noise, which is the oldest EQ training source there is: every band
   * has something in it, so a move anywhere is a move you can hear.
   */
  playNoiseBed(seconds, bpm) {
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer();
    source.loop = true;

    const gain = this.ctx.createGain();
    gain.gain.value = 0.09;
    source.connect(gain).connect(this.master);
    source.start(0);
    source.stop(seconds);
    this.keep({ gain, endsAt: seconds, stop: (when) => source.stop(when) });
  }
}
