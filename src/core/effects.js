// The six, as things with two ends.
//
// Each of these is the same processing the matching plugin already does -
// in four cases literally the same node, because the compressor, the
// saturator and the imager were already written as live worklets with an
// input and an output, and the EQ's chain of biquads is built by the
// function the EQ player itself now calls.
//
// The reverb and the delay are the exception and worth saying out loud. Their
// players do not convolve live: they render the wet signal offline once per
// setting and play it back as a buffer, which is the right trade for a tool
// where the material is a fixed loop and the control moves rarely. An insert
// on a track cannot do that - the material is whatever arrives - so these two
// get a live `ConvolverNode` fed the same impulse the offline render uses.
// Same impulse, same arithmetic, different place.
//
// Measured, rendering a signal through each of them offline at 48 kHz:
//
//   eq           a +12 dB peak at 1k reads +3.9 dB there and -2.1 at 250,
//                because the auto gain takes the average lift back off - the
//                net is the shape, which is what the tool marks you on
//   compression  -40 threshold at 8:1 takes a noise bed from -18.2 to -42.7
//   saturation   24 dB of drive at half bias puts the second harmonic 56 dB
//                up and the third 41 dB up, which is even-dominant as asked
//   reverb       a tail at -62.5 dB a second after a burst, where dry is -240
//   delay        300 ms of repeats landing at 0, 0.300, 0.600, 0.900, 1.200 s
//   panning      6 dB of width wide against -14 dB narrow
//   a chain      an EQ and a saturator in series do both
//
// And the EQ's refactor was checked where it would show: the graph the player
// now builds, read back through Web Audio's own frequency response, still
// agrees with the curve the app draws and marks guesses against to within
// 0.000001 dB - across a plain peak, two shelves, an off band, and the 48 dB
// an octave cut that is a cascade of four.

import { sectionsOf, averageLift, MOST_SECTIONS } from '../plugins/eq/filters.js';
import { LiveCompressor } from '../plugins/compressor/node.js';
import { LiveSaturator } from '../plugins/saturation/node.js';
import { LiveImager } from '../plugins/stereo/node.js';
import { makeImpulse, VERB_DEFAULTS } from '../plugins/reverb/ir.js';
import { makeEcho, ECHO_DEFAULTS } from '../plugins/delay/line.js';
import { COMP_DEFAULTS } from '../plugins/compressor/dsp.js';
import { HEAT_DEFAULTS } from '../plugins/saturation/shape.js';
import { STEREO_DEFAULTS } from '../plugins/stereo/field.js';
import { newStrip } from '../plugins/eq/filters.js';
import { wetDry } from './effect.js';

/* --- the EQ --------------------------------------------------------------- */

/**
 * A run of biquads, built out of circuit.
 *
 * Lifted out of `EQPlayer.chain` so there is one of these rather than two.
 * Four sections a band whether or not the band needs four: the steepest cut
 * on offer is a cascade of four, and a graph that grew and shrank as the
 * slope changed would be a graph rebuilt under a running loop, which clicks.
 * The unused ones are held transparent instead, at a multiply each.
 */
export function eqSections(ctx, bands) {
  // No bands is a wire, not an error. A track with an EQ slot and nothing in
  // it is the common case, and the alternative is every caller branching.
  if (!(bands > 0)) {
    const through = ctx.createGain();
    return { input: through, sections: [], trim: through, filters: [] };
  }

  const sections = Array.from({ length: bands }, () =>
    Array.from({ length: MOST_SECTIONS }, () => {
      const filter = ctx.createBiquadFilter();
      // A peak with no gain passes everything through.
      filter.type = 'peaking';
      filter.frequency.value = 1000;
      filter.Q.value = 1;
      filter.gain.value = 0;
      return filter;
    }));

  const filters = sections.flat();
  for (let i = 0; i < filters.length - 1; i += 1) filters[i].connect(filters[i + 1]);

  // Auto gain: whatever the curve adds overall, this takes back off.
  const trim = ctx.createGain();
  trim.gain.value = 1;
  filters[filters.length - 1].connect(trim);

  return { input: filters[0], sections, trim, filters };
}

/**
 * Tune a built chain to a set of bands, without interrupting the sound.
 *
 * Also lifted from the player, and the comment it came with is the reason it
 * is worth having in one place: a band that is off becomes a peak with no
 * gain, which is exactly nothing. Parking its corner at the end of the range
 * instead - the obvious thing to do - is not nothing. A low-pass sitting at
 * 18 kHz still takes three quarters of a decibel off 12 kHz and a high-pass
 * at 40 takes a decibel and a half off 60, and the drawn curve leaves an off
 * band out entirely, so the sound has to as well or the two stop agreeing.
 */
export function tuneSections(chain, bands, at, rate, weights) {
  const lift = averageLift(bands, rate, weights);
  chain.trim.gain.setTargetAtTime(10 ** (-lift / 20), at, 0.02);

  bands.forEach((band, i) => {
    const sections = band.on === false ? [] : sectionsOf(band);

    chain.sections[i].forEach((filter, s) => {
      const section = sections[s];
      if (!section) {
        filter.type = 'peaking';
        filter.gain.setTargetAtTime(0, at, 0.01);
        return;
      }
      filter.type = section.type;
      filter.frequency.setTargetAtTime(section.frequency, at, 0.01);
      filter.Q.setTargetAtTime(section.q, at, 0.01);
      filter.gain.setTargetAtTime(section.gain ?? 0, at, 0.01);
    });
  });
}

/**
 * An EQ.
 *
 * `slots` is how many bands the chain is built for and it does not change
 * afterwards, because a graph rebuilt under a running loop clicks. Six is
 * what the plugin offers and what `newStrip` hands back; a track that only
 * ever needs one can ask for one and save the multiplies.
 *
 * `set` is given bands and tunes that many of them. More bands than slots is
 * a caller mistake worth hearing about rather than silently dropping half an
 * EQ, which would be audible and inexplicable.
 */
function eqEffect(ctx, { bands = newStrip(), slots = null } = {}) {
  const size = slots ?? bands.length;
  const chain = eqSections(ctx, size);
  const out = ctx.createGain();
  chain.trim.connect(out);
  let current = bands;

  const tune = (at = ctx.currentTime) => tuneSections(chain, current, at, ctx.sampleRate);

  // Applied here, not only on the next `set`. `eqSections` builds the filters
  // transparent and the bands it was handed were never put on them, so an EQ
  // constructed with a curve was a wire until something moved a control.
  // Measured: a track with a +9 dB low shelf insert rendered bit-identical to
  // the same track with no insert at all - the same reading on all five
  // measurements, to the last decimal.
  tune(0);

  return {
    id: 'eq',
    in: chain.input,
    out,
    slots: size,
    params: () => current.map((band) => ({ ...band })),
    set(next, at = ctx.currentTime) {
      current = next ?? current;
      if (current.length > size) {
        throw new Error(`this EQ was built for ${size} bands and was given ${current.length}`);
      }
      tune(at);
      return this;
    },
    destroy() {
      for (const filter of chain.filters) { try { filter.disconnect(); } catch { /* gone */ } }
      try { chain.trim.disconnect(); } catch { /* gone */ }
      try { out.disconnect(); } catch { /* gone */ }
    },
  };
}

/* --- the ones that were already nodes -------------------------------------- */

/**
 * The compressor.
 *
 * Its worklet takes two channels - the signal and the sidechain key - so the
 * input is a merger rather than the node itself. An insert with nothing
 * keyed to it leaves the second channel silent, which the detector reads as
 * "no key" and falls back to the signal, exactly as the plugin does with the
 * key input unplugged.
 */
async function compEffect(ctx, { settings = COMP_DEFAULTS } = {}) {
  const live = new LiveCompressor(ctx);
  live.settings = { ...settings };
  await live.start();

  // Whatever is currently feeding the detector, so it can be let go of when
  // something else is chosen.
  let keyed = null;

  return {
    id: 'compression',
    in: live.input,
    out: live.out,
    /** Where a sidechain goes, for whoever has one to send. */
    key: live.input,

    /**
     * What the detector listens to, when it is not listening to the signal.
     *
     * The merger's second input, which is the only difference between the
     * two: channel one is what is being compressed and channel two is what
     * is deciding. `null` lets go of whatever was there, which matters -
     * a track left connected to a detector it is no longer keying is a
     * graph that gets one edge heavier every time somebody changes their
     * mind.
     */
    keyFrom(node) {
      if (node === keyed) return this;
      if (keyed) { try { keyed.disconnect(live.input); } catch { /* already gone */ } }
      keyed = node ?? null;
      if (keyed) keyed.connect(live.input, 0, 1);
      return this;
    },
    params: () => ({ ...live.settings }),
    // `set` is the Live class's own, which keeps its settings and posts them
    // to the worklet - or runs them into the fallback core on a browser with
    // no worklets. Reaching past it to the port would work on one of those
    // two and not the other.
    set(next) { live.set({ ...live.settings, ...next }); return this; },
    /** The deepest reduction since anyone last looked, which the worklet reports. */
    read: () => live.pending,
    /**
     * The same number, and asking resets it.
     *
     * Which is what a meter needs and `read` deliberately is not: `read` is
     * a measurement anyone may take without changing anything, and a meter
     * that never cleared its counter would sit at the deepest reduction of
     * the session for the rest of it.
     */
    readReduction: () => live.readReduction(),
    destroy() {
      if (keyed) { try { keyed.disconnect(live.input); } catch { /* gone */ } }
      try { live.out.disconnect(); } catch { /* gone */ }
      try { live.node?.disconnect(); } catch { /* gone */ }
    },
  };
}

async function heatEffect(ctx, { settings = HEAT_DEFAULTS } = {}) {
  const live = new LiveSaturator(ctx);
  live.settings = { ...settings };
  await live.start();

  return {
    id: 'saturation',
    in: live.input,
    out: live.out,
    params: () => ({ ...live.settings }),
    set(next) { live.set({ ...live.settings, ...next }); return this; },
    destroy() {
      try { live.out.disconnect(); } catch { /* gone */ }
      try { live.node?.disconnect(); } catch { /* gone */ }
    },
  };
}

async function stereoEffect(ctx, { settings = STEREO_DEFAULTS } = {}) {
  const live = new LiveImager(ctx);
  live.settings = { ...settings };
  await live.start();

  return {
    id: 'panning',
    in: live.input,
    out: live.out,
    params: () => ({ ...live.settings }),
    set(next) { live.set({ ...live.settings, ...next }); return this; },
    destroy() {
      try { live.out.disconnect(); } catch { /* gone */ }
      try { live.node?.disconnect(); } catch { /* gone */ }
    },
  };
}

/* --- the two that convolve ------------------------------------------------- */

/**
 * A convolver with a dry path around it, fed an impulse built from numbers.
 *
 * `impulseOf(rate, settings)` is the same function the plugin hands its
 * player - `makeImpulse` for a room, `makeEcho` for a set of repeats - so
 * what an insert does to a signal is what the exercise marks you on, built
 * by the same code.
 *
 * Rebuilding the buffer is not free and the control that changes it moves
 * continuously, so a set that does not change the impulse only moves the
 * mix. Which settings matter is the impulse builder's business, so the whole
 * settings object is stamped and compared.
 */
function convolverEffect(ctx, id, impulseOf, defaults, settings) {
  const convolver = ctx.createConvolver();
  convolver.normalize = false;
  const pair = wetDry(ctx, convolver);

  let current = { ...defaults, ...settings };
  let stamp = null;

  const build = () => {
    const impulse = impulseOf(ctx.sampleRate, current);
    const buffer = ctx.createBuffer(impulse.channels.length, impulse.length, impulse.rate);
    impulse.channels.forEach((channel, i) => buffer.copyToChannel(channel, i));
    convolver.buffer = buffer;
  };

  const apply = (at = ctx.currentTime) => {
    const next = JSON.stringify({ ...current, mix: 0 });
    if (next !== stamp) { stamp = next; build(); }
    pair.setMix(current.mix ?? 0.3, at);
  };

  apply();

  return {
    id,
    in: pair.in,
    out: pair.out,
    params: () => ({ ...current }),
    set(next, at = ctx.currentTime) {
      current = { ...current, ...next };
      apply(at);
      return this;
    },
    destroy() {
      try { convolver.disconnect(); } catch { /* gone */ }
      pair.destroy();
    },
  };
}

const verbEffect = (ctx, { settings = {} } = {}) =>
  convolverEffect(ctx, 'reverb', makeImpulse, VERB_DEFAULTS, settings);

const echoEffect = (ctx, { settings = {} } = {}) =>
  convolverEffect(ctx, 'delay', makeEcho, ECHO_DEFAULTS, settings);

/* --- the six -------------------------------------------------------------- */

/**
 * By the same ids the tools use, so a chain can be described by a list of
 * them and nothing has to translate between two sets of names.
 *
 * Every one of these is async, including the three that need not be: a caller
 * that had to know which ones to await would get it wrong the first time
 * somebody moved a worklet.
 */
export const EFFECTS = {
  eq: async (ctx, options) => eqEffect(ctx, options),
  compression: compEffect,
  panning: stereoEffect,
  reverb: async (ctx, options) => verbEffect(ctx, options),
  delay: async (ctx, options) => echoEffect(ctx, options),
  saturation: heatEffect,
};

export const EFFECT_IDS = Object.keys(EFFECTS);

/** One, by id. */
export function makeEffect(ctx, id, options = {}) {
  const make = EFFECTS[id];
  if (!make) throw new Error(`there is no effect called ${id}`);
  return make(ctx, options);
}
