// The EQ's filters, as a live chain.
//
// These were in core/effects.js, which is the sketchpad's effect factory, so
// an EQ could not build its own filters without importing the sketchpad.
// They are the EQ's. They are not in filters.js beside the arithmetic they
// are built from, because that file is maths over arrays and this one makes
// Web Audio nodes - and the line between those two is the whole of what
// makes the maths portable. tests/seams.test.js holds it.
//
// What used to be here was a run of BiquadFilterNodes, four per band, retuned
// through their AudioParams. It is now one worklet running the sections out
// of svf.js, which is the same code the curve is drawn and scored from. The
// chain either side of it has not changed shape: something to plug into, and
// a gain at the end holding the auto gain.
//
//     in ─ the rack ─ trim ─ out
//
// Building it is now asynchronous, because installing a worklet is. Every
// caller of this was already inside something asynchronous; the one that was
// not is EQPlayer.build, which is only ever reached from its own `play`.
//
// It also takes the curve it should arrive with, rather than being built flat
// and told afterwards. See below for why that is not a convenience.

import { MOST_SECTIONS, averageLift, sectionTable } from './filters.js';
import { LiveEq } from './node.js';

export async function eqSections(ctx, bands, { start = null } = {}) {
  // No bands is a wire, not an error. A track with an EQ slot and nothing in
  // it is the common case, and the alternative is every caller branching.
  if (!(bands > 0)) {
    const through = ctx.createGain();
    return {
      input: through,
      trim: through,
      engine: null,
      bands: 0,
      destroy() { try { through.disconnect(); } catch { /* already gone */ } },
    };
  }

  const engine = new LiveEq(ctx, bands * MOST_SECTIONS);

  // The curve it is to arrive with, handed over with the node rather than
  // posted to it afterwards - which is the same lesson the imager and the
  // saturator each learned and is worth stating a third time, because this
  // is the only one of the three where it was not audible.
  //
  // A port message is a round trip, and an OfflineAudioContext renders
  // faster than one: the first measurement of this chain found a wire where
  // the EQ should have been on ten of thirteen cases, and the three that
  // passed passed because the message happened to land in time. A render is
  // where that shows; a performance is where it does not, and a bug that is
  // only visible in the measurement is the kind that stays.
  if (start) engine.table = sectionTable(start, bands, ctx.sampleRate);
  await engine.start();

  // Auto gain: whatever the curve adds overall, this takes back off.
  const trim = ctx.createGain();
  trim.gain.value = start ? 10 ** (-averageLift(start, ctx.sampleRate, null) / 20) : 1;
  engine.connect(trim);

  return {
    input: engine.input,
    trim,
    engine,
    bands,
    destroy() {
      engine.destroy();
      try { trim.disconnect(); } catch { /* already gone */ }
    },
  };
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
 *
 * `glide` false puts the whole chain where it was sent on the spot, trim and
 * all. That is what a render wants and what a performance does not: ten
 * milliseconds of a filter arriving is a knob not clicking when somebody
 * turns it, and it is also the first ten milliseconds of an offline render
 * measuring something other than the EQ it was asked for.
 */
export function tuneSections(chain, bands, at, rate, weights, { glide = true } = {}) {
  const lift = averageLift(bands, rate, weights);
  const gain = 10 ** (-lift / 20);
  if (glide) chain.trim.gain.setTargetAtTime(gain, at, 0.02);
  else chain.trim.gain.value = gain;

  if (!chain.engine) return;
  chain.engine.tune(sectionTable(bands, chain.bands, rate), !glide);
}
