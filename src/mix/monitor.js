// Hearing two mixes at the same loudness, which is the only way to compare
// them.
//
// Louder sounds better. Not as a figure of speech - put the same mix up by a
// decibel and a half and people will tell you it has more punch, a better low
// end and a wider image, and they will tell you that about a difference they
// could not name if you asked them what had changed. So an A/B between two
// mixes at two levels is not a comparison of the mixes. It is a comparison of
// the levels, with the mixes along for the ride.
//
// Which is a real problem for this exercise rather than a general piety,
// because the answer and the mix being worked on are almost never at the same
// loudness. Measured, the answer against the flat mix a round opens on, at
// one seed per tier:
//
//     easy     -26.37 against -24.90      1.47 LU
//     medium   -25.78 against -28.08      2.30 LU
//     hard     -25.09 against -24.90      0.19 LU
//     tone     -25.31 against -24.90      0.41 LU
//
// Up to two and a third decibels, which is well over the threshold where the
// louder one starts to win on everything. `tests/browser/match.mjs` takes the
// same comparison on its own seeds and reads 1.40, 1.98 and 2.12, so it is
// the seed that decides how big the gap is and not the tier.
//
// So the monitor trims the reference to the level of the mix being worked on
// - the reference, because the mix being worked on is the thing whose level
// is being decided and moving it would be moving the work.
//
// The trim is on the monitor and nowhere near the marking. `readMix` renders
// the project, and the project does not know this file exists.

import { STEM_IDS } from './piece.js';
import { dbOf } from './brief.js';

/**
 * How far the monitor may trim, in decibels.
 *
 * A clamp rather than a control. Three faders over a range of -12 to +9 can
 * move a mix's loudness by about nine decibels in either direction, so twelve
 * is past anything a round can ask for and the only thing it can catch is an
 * arithmetic fault - a trim of forty decibels is not a close match, it is a
 * bug, and the sound of it would be the first anybody heard about it.
 */
export const MATCH_LIMIT = 12;

/** The loudness of several parts playing at once, from their own loudnesses. */
export const sumOf = (levels) => 10 * Math.log10(
  levels.reduce((total, lufs) => total + 10 ** (lufs / 10), 0),
);

/**
 * What a mix's loudness is, without rendering it.
 *
 * An anchor - one mix that was rendered and read for real - plus the fader
 * moves since, applied to the parts' own loudnesses and added back up as
 * energy. Exact at the anchor by construction, and an approximation
 * everywhere else, because adding up four parts' energies is only the
 * loudness of their sum if the four are uncorrelated and they are four parts
 * of one piece of music.
 *
 * It is an approximation on purpose. The honest way to know a mix's loudness
 * is to render it, and a render is 886 ms of main thread with the music
 * playing through it - so a monitor that re-rendered on every fader move
 * would stutter the thing it is there to let you hear. Measured, in decibels
 * off a real render, over easy, medium and hard - the table
 * `tests/browser/match.mjs` prints every run:
 *
 *     move                      anchored on the answer   anchored on flat
 *     one fader by 1 dB                      0.00, 0.00       0.01, 0.01
 *     two faders 3 dB apart            0.05, 0.09, 0.12       0.13, 0.13
 *     all three by 4 dB                     -0.25, -0.25     -0.16, -0.16
 *
 * A single fader is exact to a hundredth; it is only moving everything at
 * once that drifts, and then by a quarter of a decibel against the one to two
 * it is there to take out. Pushed past what a round asks for - all three
 * faders eight decibels down, anchored on flat - the same measurement reads
 * 0.72, which is where the 0.8 the check allows comes from.
 *
 * Every submit renders for real and re-anchors, so the estimate is at its
 * best where it matters: once somebody is close enough to be submitting, the
 * anchor is close enough to be nearly exact.
 */
export function mixLoudness(anchor, mix) {
  if (!anchor) return null;

  const ids = STEM_IDS.filter((id) => Number.isFinite(anchor.parts?.[id]));
  if (!ids.length) return anchor.master;

  const was = ids.map((id) => anchor.parts[id]);
  const now = ids.map((id) => anchor.parts[id]
    + (dbOf(mix[id]?.gain ?? 1) - dbOf(anchor.held[id]?.gain ?? 1)));

  return anchor.master + sumOf(now) - sumOf(was);
}

/**
 * What a part's colour is, as one number, for telling one anchor from another.
 *
 * Only the bands, because the levels are tracked and the colour is not. See
 * `staleFor`.
 */
const colourOf = (set) => ['low', 'mid', 'high']
  .map((band) => set?.settings?.eq?.[band] ?? 0).join(',');

/**
 * Whether an anchor still describes this mix, and if not, why not.
 *
 * Three of the four things a strip does are safe to move, and that is a
 * measurement rather than a convenience:
 *
 *   - a fader is tracked, by the arithmetic above;
 *   - a pan is equal power, so it moves energy between the two sides without
 *     changing how much there is. Measured, two parts panned to 0.7 moved the
 *     master's loudness by 0.03 dB;
 *   - a send is post-fader into a room eight decibels down, and measured, two
 *     sends up to 0.6 and 0.4 moved it by 0.19 dB at the most.
 *
 * A tone control is not safe, because it changes how loud its own part is and
 * the parts are what the arithmetic adds up. Measured on a tone round, the
 * master's loudness against the same round flat:
 *
 *     stem   band   move    master    that part
 *     bass   low      -8    -0.70      -4.41
 *     bass   low       8     1.08       3.26
 *     keys   mid      -8    -0.10      -0.64
 *     keys   mid       8     0.02       0.29
 *     pad    mid      -8    -0.44      -1.81
 *     pad    mid       8     0.55       1.75
 *
 * Up to a decibel on the master, which is the whole of what the match is
 * there to remove - so a colour move does not quietly carry on with an anchor
 * that predates it. It says so, and asks to be measured again.
 */
export function staleFor(anchor, mix) {
  if (!anchor) return 'nothing has been measured yet';
  for (const id of STEM_IDS) {
    if (colourOf(mix[id]) !== anchor.held[id]?.colour) {
      return 'the colour has moved since this was measured';
    }
  }
  return null;
}

/**
 * One mix, measured for real: what an estimate is anchored on.
 *
 * `held` is the two things about the mix this file reads - the fader, and the
 * colour as one string - rather than a copy of the mix. A copy would have to
 * be a deep one or it would share the insert settings with the desk, and a
 * desk goes on moving: an anchor that quietly followed the thing it is
 * anchoring against would describe whatever is current, which is to say
 * nothing. Two numbers a stem cannot be aliased by accident.
 */
export const anchorOf = (mix, readings) => ({
  held: Object.fromEntries(STEM_IDS.map((id) => [id, {
    gain: mix[id]?.gain ?? 1,
    colour: colourOf(mix[id]),
  }])),
  master: readings.loudness.values.integrated,
  parts: { ...readings.levels.values.parts },
});

/**
 * What to put on the reference so it plays at the level of the mix being
 * worked on.
 *
 * Nought when there is nothing to go on, which is the right answer rather
 * than a fallback: an unmeasured match is a match that has not happened, and
 * silently applying a guess would be worse than applying nothing.
 */
export function matchTrim(anchor, mix, reference) {
  if (!anchor || !Number.isFinite(reference)) return 0;
  const mine = mixLoudness(anchor, mix);
  if (!Number.isFinite(mine)) return 0;
  return Math.max(-MATCH_LIMIT, Math.min(MATCH_LIMIT, mine - reference));
}

/** A trim, as a gain. */
export const gainOfTrim = (db) => 10 ** (db / 20);

/* --- listening somewhere else ---------------------------------------------- */

/**
 * The three ways of listening, which are not three ways of mixing.
 *
 * A mix that only works on the thing it was made on is not finished, and the
 * two places it most often falls apart are a mono speaker and a small one.
 * Both are a monitor path and neither touches the project: what is rendered
 * and marked is the same audio whichever of these is on.
 */
export const LISTEN_MODES = [
  { id: 'full', label: 'Full range', tells: 'everything, as it was mixed' },
  { id: 'mono', label: 'Mono', tells: 'what cancels when the two sides are summed' },
  { id: 'phone', label: 'Small speaker', tells: 'what is left with no bottom and no top' },
];

export const LISTEN_IDS = LISTEN_MODES.map((how) => how.id);

/**
 * What a small speaker is, as two corners.
 *
 * A caricature rather than a model of any particular phone, and said so
 * rather than dressed up: real laptop and handset speakers roll off somewhere
 * between 300 and 700 Hz and run out of top somewhere past 8 kHz, with a
 * response in between that is nobody's idea of flat. Four hundred and eight
 * thousand, two poles each, is the shape of that without pretending to be a
 * measurement of a device.
 *
 * What it is for is a question about this material, and that part is
 * measured: on the flat mix of short-night the kit and the bass have all
 * their weight below 310 Hz - shares of 9.61 and 9.24 against the pad's
 * -17.27 - so a mix balanced on the low end is a mix that loses both its
 * anchors here. That is the thing to hear.
 */
export const SMALL_SPEAKER = {
  from: 400,
  to: 8000,
  poles: 2,
  // In decibels, which is the part worth saying out loud. A
  // BiquadFilterNode's Q is a plain quality factor for a bandpass or a notch
  // and a figure in DECIBELS for a lowpass or a highpass: it is how far up
  // the corner sits. So the default of 1 is a one-decibel bump at the corner,
  // and the Butterworth corner everybody means by "two poles" is -3.01.
  //
  // Measured, because this was got wrong twice on the way here. Left at the
  // default the corner read +1.0 dB against the passband; set to 0.7071 - the
  // Butterworth Q, in the units the other kind of filter uses - it read +0.7,
  // which is 0.7071 dB and is the giveaway; at -3.01 it reads -3.0.
  q: -3.0103,
};

/** A mono fold is the two sides summed and halved, which is what a speaker does. */
export const monoChannels = 1;

/**
 * The monitor: a trim, a fold, and a small speaker, between the desk and the
 * output.
 *
 * All three live here rather than in the page for the reason the arithmetic
 * above does: what they are and why they are allowed is one subject, and the
 * page's job is to say which of them is on.
 *
 * The filters are a second path rather than a setting on one, because "off"
 * has to mean off. A highpass parked at 20 Hz is nearly transparent and
 * nearly is not a word this should be using about the path everything is
 * heard through - measured on a 2-pole highpass at 20 Hz, 50 Hz still comes
 * back 0.65 dB down.
 */
export function makeMonitor(ctx, out) {
  const trim = ctx.createGain();

  // The fold. A gain told to take one channel down-mixes whatever arrives at
  // it the way the specification says a speaker does: (L+R)/2.
  const fold = ctx.createGain();
  fold.channelCountMode = 'explicit';
  fold.channelInterpretation = 'speakers';
  fold.channelCount = 2;

  const wide = ctx.createGain();
  const small = ctx.createGain();
  small.gain.value = 0;

  // Q set rather than left alone. A real small speaker does have a bump at
  // its own corner, but it should be a thing somebody chose. See
  // SMALL_SPEAKER for the units, which are not the ones anybody expects.
  const high = ctx.createBiquadFilter();
  high.type = 'highpass';
  high.frequency.value = SMALL_SPEAKER.from;
  high.Q.value = SMALL_SPEAKER.q;
  const low = ctx.createBiquadFilter();
  low.type = 'lowpass';
  low.frequency.value = SMALL_SPEAKER.to;
  low.Q.value = SMALL_SPEAKER.q;

  trim.connect(fold);
  fold.connect(wide).connect(out);
  fold.connect(high).connect(low).connect(small).connect(out);

  let listening = 'full';

  return {
    input: trim,
    get listening() { return listening; },

    /** How far the reference is being brought to meet the mix, in decibels. */
    setTrim(db, at = ctx.currentTime) {
      trim.gain.setTargetAtTime(gainOfTrim(db), at, 0.008);
    },

    /**
     * Which speaker this is pretending to be.
     *
     * The crossfade is twenty milliseconds, which is long enough not to click
     * and short enough to feel like a switch. The two paths are not in phase
     * with each other - one of them has four poles of filter on it - so a
     * slower fade would comb audibly in the middle of it.
     */
    setListen(id, at = ctx.currentTime) {
      listening = LISTEN_IDS.includes(id) ? id : 'full';
      fold.channelCount = listening === 'full' ? 2 : monoChannels;
      wide.gain.setTargetAtTime(listening === 'phone' ? 0 : 1, at, 0.02);
      small.gain.setTargetAtTime(listening === 'phone' ? 1 : 0, at, 0.02);
    },

    destroy() {
      for (const node of [trim, fold, wide, small, high, low]) {
        try { node.disconnect(); } catch { /* already gone */ }
      }
    },
  };
}
