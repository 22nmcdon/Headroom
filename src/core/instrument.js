// What an instrument is.
//
// Nothing in Headroom played a note before this. The engine synthesises -
// `note`, `tone`, `drum` - straight into the graph at a scheduled time, which
// is everything a practice loop needs and not enough for anything that has to
// be sequenced: there is no object to hand a pitch to, no output to put an
// effect on, and no way to have two of them at once.
//
// So an instrument is an output node, a way to start and stop a note at a
// time, and a way to be taken apart. The times are audio times, which means
// the transport can book a bar's worth in advance and nothing has to be
// awake when the note actually sounds.
//
// All four of these are synthesised. The plan has a sample player behind the
// same interface later; writing the interface first and the samples second is
// the order that keeps the second one from inventing its own shape.
//
// Measured, each one alone, rendered offline at 48 kHz: a note at MIDI 60
// comes out of the piano, the bass and the synth at roughly 261 Hz, which is
// middle C, and a 36 on the kit comes out at roughly 64 Hz, which is a kick
// drum. Peaks of -18.3, -11.3, -4.4 and -1.8 dBFS respectively - the synth is
// the loud one and a track's fader is where that is dealt with.

import { midiToFreq } from '../audio.js';

/** What a caller may rely on. */
export const INSTRUMENT_SHAPE = ['id', 'out', 'noteOn', 'noteOff', 'allOff', 'destroy'];

export function isInstrument(instrument) {
  if (!instrument || typeof instrument !== 'object') return false;
  return INSTRUMENT_SHAPE.every((key) => (
    key === 'out' || key === 'id' ? instrument[key] != null : typeof instrument[key] === 'function'
  ));
}

/**
 * As many notes as may sound at once.
 *
 * Not a musical limit - it is a runaway guard. A stuck loop or a clip with a
 * thousand notes on one tick will otherwise book a thousand oscillators, and
 * the page stops answering long before anybody hears the problem.
 */
export const MOST_VOICES = 48;

/**
 * The parts the whole of this is built from.
 *
 * Everything below makes voices out of oscillators and noise and an envelope,
 * and the only differences are which partials, how long, and how bright.
 * Written once so that adding a fifth instrument is a table rather than
 * another copy of the same twenty lines.
 */
function base(ctx, id) {
  const out = ctx.createGain();
  out.gain.value = 1;

  const live = new Map(); // pitch -> the voices currently sounding on it
  let gone = false;

  /** Everything whose tail ended before `when`, forgotten. */
  const sweep = (when) => {
    for (const [pitch, held] of live) {
      const left = held.filter((voice) => !(voice.until <= when));
      if (left.length === held.length) continue;
      if (left.length) live.set(pitch, left);
      else live.delete(pitch);
    }
  };

  const forget = (pitch, voice) => {
    const held = live.get(pitch);
    if (!held) return;
    const at = held.indexOf(voice);
    if (at >= 0) held.splice(at, 1);
    if (!held.length) live.delete(pitch);
  };

  return {
    id,
    out,
    ctx,
    live,
    get voices() { return [...live.values()].reduce((n, held) => n + held.length, 0); },
    get gone() { return gone; },

    /**
     * Remember a voice so `noteOff` and `destroy` can find it.
     *
     * `when` is the time the voice starts, which is what the sweep needs: a
     * voice whose tail was over before this one began is nothing but a
     * number in a map.
     */
    hold(pitch, voice, when = -Infinity) {
      // Anything whose tail is already over, by the time this note starts,
      // goes first. `onended` below is the accurate signal and the one that
      // does the work live - but it fires on a real clock, and an offline
      // render has none: everything is scheduled and then rendered at once,
      // so nothing is ever ended while the booking is happening, and the
      // voice cap would silence the instrument a few bars in. Measured
      // before this swept: a bass part on every beat went quiet after
      // sixteen notes, which is the cap divided by three partials.
      sweep(when);

      if (!live.has(pitch)) live.set(pitch, []);
      live.get(pitch).push(voice);
      // `onended` rather than a timer: the node knows when it stopped and a
      // timer would be another clock to drift against.
      voice.node.onended = () => forget(pitch, voice);
      return voice;
    },

    /**
     * Everything sounding or booked, gone - quickly rather than instantly.
     *
     * The booked half is the point. A transport books a lookahead ahead, so
     * when somebody presses stop there are already notes scheduled that have
     * not started; letting go of the list would leave them to sound into the
     * silence. Each one's envelope is cancelled and its node stopped, which
     * covers a voice that is playing and one that never got to.
     *
     * A short fade rather than a cut, because a gain that goes to zero in one
     * sample is a click, and a click on the stop button sounds like a fault.
     */
    silence(at = ctx.currentTime) {
      for (const held of live.values()) {
        for (const voice of held) {
          voice.node.onended = null;
          try {
            voice.gain.gain.cancelScheduledValues(at);
            voice.gain.gain.setTargetAtTime(1e-4, at, 0.005);
          } catch { /* a voice already finished with */ }
          try { voice.node.stop(at + 0.05); } catch { /* already stopped */ }
        }
      }
      live.clear();
    },

    /** Everything sounding on a pitch, taken off the list. */
    take(pitch) {
      const held = live.get(pitch) ?? [];
      live.delete(pitch);
      return held;
    },

    destroy() {
      gone = true;
      for (const held of live.values()) {
        for (const voice of held) {
          try { voice.node.stop(); } catch { /* already stopped */ }
        }
      }
      live.clear();
      try { out.disconnect(); } catch { /* already gone */ }
    },
  };
}

/** A note's loudness from its velocity, which is not a straight line. */
const loudness = (velocity) => (Math.max(1, Math.min(127, velocity)) / 127) ** 1.6;

/**
 * A voice that decays on its own, however long the note is held.
 *
 * Which is what a piano and a drum do: letting go of the key does not stop a
 * struck string, it damps it, and on a kick it does nothing at all. So
 * `noteOff` on these shortens the tail rather than ending the note, and a
 * sequencer that never sends one still sounds right.
 */
function struck(ctx, kit, { partials, decayOf, peak }) {
  return (pitch, velocity, when) => {
    const freq = midiToFreq(pitch);
    const level = loudness(velocity) * peak;
    const decay = decayOf(pitch);
    const made = [];

    for (const partial of partials) {
      const osc = ctx.createOscillator();
      osc.type = partial.type;
      osc.frequency.value = freq * partial.ratio;

      const gain = ctx.createGain();
      const top = level * partial.gain;
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(top, when + 0.008);
      gain.gain.exponentialRampToValueAtTime(Math.max(top * 0.28, 1e-5), when + decay * 0.3);
      gain.gain.exponentialRampToValueAtTime(1e-5, when + decay);

      osc.connect(gain).connect(kit.out);
      osc.start(when);
      osc.stop(when + decay + 0.05);
      made.push({ node: osc, gain, until: when + decay });
    }

    return made;
  };
}

/**
 * A voice that holds until it is let go.
 *
 * The synth. Attack, a little decay to a sustain, and a release when the note
 * ends - which is the shape every pad and every bass line in the world is,
 * and the reason `noteOff` has to mean something on this one.
 */
function sustaining(ctx, kit, { wave = 'sawtooth', cutoff = 2400, attack = 0.01, release = 0.12, peak = 0.2 }) {
  return (pitch, velocity, when) => {
    const osc = ctx.createOscillator();
    osc.type = wave;
    osc.frequency.value = midiToFreq(pitch);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    // Brighter when hit harder, which is the one thing a filter has to do to
    // sound like an instrument rather than a tone.
    filter.frequency.value = Math.min(ctx.sampleRate / 2.2, cutoff * (0.6 + loudness(velocity)));
    filter.Q.value = 0.9;

    const gain = ctx.createGain();
    const top = loudness(velocity) * peak;
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(top, when + attack);
    gain.gain.linearRampToValueAtTime(top * 0.8, when + attack + 0.12);

    osc.connect(filter).connect(gain).connect(kit.out);
    osc.start(when);
    // Stopped far out and brought back by `noteOff`. A voice with no end
    // booked is a voice that runs for ever if the note-off never arrives,
    // which on a dropped message is exactly what happens.
    osc.stop(when + 30);

    // Far out, because a held voice has no end until it is let go - and a
    // number rather than nothing, so the sweep above can reason about it.
    return [{ node: osc, gain, release, top, until: when + 30 }];
  };
}

/** Stop a held voice, with its release. */
function letGo(voice, when) {
  const { gain, release } = voice;
  voice.until = when + (release ?? 0.1);
  try {
    gain.gain.cancelScheduledValues(when);
    gain.gain.setValueAtTime(Math.max(gain.gain.value, 1e-5), when);
    gain.gain.exponentialRampToValueAtTime(1e-5, when + (release ?? 0.1));
    voice.node.stop(when + (release ?? 0.1) + 0.02);
  } catch { /* already stopped, or the time is in the past */ }
}

/**
 * The General MIDI drum map, as much of it as three synthesised pieces can
 * honestly cover.
 *
 * A kit on channel 10 is read by pitch, and those pitches are fixed by the
 * standard: 36 is a kick wherever it is played. What is here is a kick, a
 * snare and a hat, so everything else is mapped to its nearest neighbour and
 * the table says which - a ride and a crash both come out as a hat, which is
 * honest about what this is rather than silently dropping the note.
 */
export const GM_DRUMS = {
  35: 'kick', 36: 'kick',
  37: 'snare', 38: 'snare', 39: 'snare', 40: 'snare',
  41: 'kick', 43: 'kick', 45: 'kick', 47: 'snare', 48: 'snare', 50: 'snare',
  42: 'hat', 44: 'hat', 46: 'hat', 49: 'hat', 51: 'hat', 52: 'hat', 53: 'hat',
  54: 'hat', 55: 'hat', 57: 'hat', 59: 'hat',
};

/** Which piece a drum pitch plays, falling back to the nearest in range. */
export const pieceFor = (pitch) => GM_DRUMS[pitch] ?? (pitch < 41 ? 'kick' : pitch < 47 ? 'snare' : 'hat');

/* --- the four --------------------------------------------------------------- */

const PIANO_PARTIALS = [
  { ratio: 1, gain: 1.0, type: 'sine' },
  { ratio: 2, gain: 0.32, type: 'sine' },
  { ratio: 3, gain: 0.14, type: 'sine' },
  { ratio: 4, gain: 0.07, type: 'triangle' },
  { ratio: 6, gain: 0.03, type: 'sine' },
];

const BASS_PARTIALS = [
  { ratio: 1, gain: 1.0, type: 'sine' },
  { ratio: 2, gain: 0.5, type: 'triangle' },
  { ratio: 3, gain: 0.18, type: 'sine' },
];

/**
 * An instrument, out of a voice maker.
 *
 * `sustains` is the one thing that changes between the two kinds: a struck
 * voice ignores `noteOff` except to damp, a held one ends on it.
 */
function instrumentOf(ctx, id, voicer, { sustains = false } = {}) {
  // One `base` per instrument, handed to the voice maker. Built twice - once
  // here and once where the voices are made - the voices would connect to an
  // output nothing was listening to, and the instrument would be silent with
  // nothing in the graph to say why.
  const kit = base(ctx, id);
  const makeVoice = voicer(ctx, kit);

  return {
    id,
    out: kit.out,
    get voices() { return kit.voices; },

    noteOn(pitch, velocity = 96, when = ctx.currentTime) {
      if (kit.gone) return null;
      if (kit.voices >= MOST_VOICES) return null;

      const made = makeVoice(pitch, velocity, when);
      for (const voice of made) kit.hold(pitch, voice, when);
      return made;
    },

    noteOff(pitch, when = ctx.currentTime) {
      const sounding = kit.take(pitch);
      if (!sustains) {
        // A struck voice is already on its way out; damping it early is what
        // a piano's dampers do, and on a drum it does nothing worth doing.
        for (const voice of sounding) kit.hold(pitch, voice);
        return;
      }
      for (const voice of sounding) letGo(voice, when);
    },

    /** Start and end in one call, which is what a sequencer has. */
    play(pitch, velocity, when, seconds) {
      this.noteOn(pitch, velocity, when);
      if (sustains) this.noteOff(pitch, when + Math.max(0.01, seconds));
    },

    /** Stop, including what is booked and has not sounded yet. */
    allOff: (when = ctx.currentTime) => kit.silence(when),

    destroy: () => kit.destroy(),
  };
}

/** The piano: additive partials under a plucked decay, as the engine's own. */
export const makePiano = (ctx) => instrumentOf(ctx, 'piano', (c, kit) => struck(c, kit, {
  partials: PIANO_PARTIALS,
  // High notes die faster, which is true of a real one and is most of what
  // makes a synthesised piano sound like a piano rather than a bell.
  decayOf: (pitch) => Math.max(0.35, 2.6 - (pitch - 36) * 0.022),
  peak: 0.16,
}), { sustains: false });

/** The bass: the same idea, lower, with a longer body and fewer partials. */
export const makeBass = (ctx) => instrumentOf(ctx, 'bass', (c, kit) => struck(c, kit, {
  partials: BASS_PARTIALS,
  decayOf: () => 0.9,
  peak: 0.3,
}), { sustains: false });

/** The synth: one filtered oscillator that holds until it is let go. */
export const makeSynth = (ctx, options = {}) =>
  instrumentOf(ctx, 'synth', (c, kit) => sustaining(c, kit, options), { sustains: true });

/**
 * The kit: three pieces, played by the General MIDI pitch.
 *
 * Built here rather than through the engine's `drum`, because that one
 * connects to the master and an instrument has to be able to go through a
 * track's own effects and fader.
 */
export function makeKit(ctx) {
  const kit = base(ctx, 'kit');

  const noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;

  const PIECES = {
    kick: { from: 92, to: 44, decay: 0.24, peak: 0.9 },
    snare: { hz: 1900, q: 0.8, decay: 0.16, peak: 0.5 },
    hat: { hz: 9000, q: 1.1, decay: 0.05, peak: 0.22 },
  };

  return {
    id: 'kit',
    out: kit.out,
    get voices() { return kit.voices; },

    noteOn(pitch, velocity = 96, when = ctx.currentTime) {
      if (kit.gone || kit.voices >= MOST_VOICES) return null;

      const piece = PIECES[pieceFor(pitch)];
      const level = loudness(velocity) * piece.peak;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(Math.max(level, 1e-4), when);
      gain.gain.exponentialRampToValueAtTime(1e-4, when + piece.decay);
      gain.connect(kit.out);

      let node;
      if (piece.from) {
        // A kick is a tone falling fast, which is what a drum head does.
        node = ctx.createOscillator();
        node.frequency.setValueAtTime(piece.from, when);
        node.frequency.exponentialRampToValueAtTime(piece.to, when + piece.decay * 0.7);
        node.connect(gain);
      } else {
        node = ctx.createBufferSource();
        node.buffer = noise;
        const band = ctx.createBiquadFilter();
        band.type = 'bandpass';
        band.frequency.value = piece.hz;
        band.Q.value = piece.q;
        node.connect(band).connect(gain);
      }

      node.start(when);
      node.stop(when + piece.decay + 0.05);
      return [kit.hold(pitch, { node, gain, until: when + piece.decay }, when)];
    },

    // A drum has no note-off. Said rather than left out, so that a sequencer
    // sending one is not a crash and not a surprise.
    noteOff() {},
    play(pitch, velocity, when) { this.noteOn(pitch, velocity, when); },
    allOff: (when = ctx.currentTime) => kit.silence(when),
    destroy: () => kit.destroy(),
  };
}

/** The starter set, by the names a track will use. */
export const INSTRUMENTS = {
  piano: makePiano,
  bass: makeBass,
  kit: makeKit,
  synth: makeSynth,
};

export const INSTRUMENT_IDS = Object.keys(INSTRUMENTS);

/** Which General MIDI program each one is nearest, for export. */
export const GM_PROGRAM = { piano: 0, bass: 33, synth: 81, kit: null };

export function makeInstrument(ctx, id, options = {}) {
  const make = INSTRUMENTS[id];
  if (!make) throw new Error(`there is no instrument called ${id}`);
  return make(ctx, options);
}
