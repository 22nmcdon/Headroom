// Where things sit, left to right.
//
// This exists because of a measurement. Panning the keys to the wrong side
// of a mix - 0.35 left where the answer wanted 0.35 right - read 0.61 dB
// apart on the width reading and 0.00 on everything else. A mirror image of
// the right answer was scoring as the right answer.
//
// It is not a fault in the width reading. `widthOf` splits a pair into what
// is only on the left, only on the right, and in both, and a mono part panned
// anywhere is *correlated* between the two channels - so it is entirely in
// "both", and its position is not something that reading is looking at. The
// one thing a pan control does is the one thing a width reading is blind to.
//
// So: a plain reading of how much energy is on each side, band by band, over
// the same seven bands the imager uses. A pan shows up in exactly the band the
// panned thing lives in, which is also what makes it useful to say out loud -
// "the 400 is 4 dB further left than it should be" is an instruction.

import { STEREO_BANDS } from '../plugins/stereo/field.js';
import { bandOf } from '../lib/response.js';
import { readingOf, stampOf, gapOf } from '../lib/read.js';

/** Energy, in decibels, with a floor so silence is a number. */
const energyDb = (samples) => {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return 10 * Math.log10(Math.max(sum / Math.max(1, samples.length), 1e-12));
};

/**
 * How far left or right a band sits: left minus right, in decibels.
 *
 * Positive is left, which is the convention every meter with an L on the left
 * of it uses. Clamped, because a band with nothing in it on one side reads
 * minus infinity and the number is meant to be read rather than solved.
 */
export const MOST_OFF_CENTRE = 24;

const sideOf = (left, right) => Math.max(-MOST_OFF_CENTRE, Math.min(MOST_OFF_CENTRE,
  energyDb(left) - energyDb(right)));

/** Where each band sits, and where the whole thing does. */
export function placementOf(left, right, rate) {
  const bands = {};
  for (const band of STEREO_BANDS) {
    bands[band.id] = sideOf(bandOf(left, rate, band), bandOf(right, rate, band));
  }
  return { whole: sideOf(left, right), bands };
}

export const PLACEMENT_AXIS = { kind: 'bands', ids: STEREO_BANDS.map((band) => band.id) };

/** A placement, in an envelope. */
export const placementReading = (channels, rate, { source = null } = {}) => readingOf({
  tool: null,
  kind: 'placement',
  of: { state: stampOf(null), source, axis: PLACEMENT_AXIS },
  values: placementOf(channels[0], channels[1] ?? channels[0], rate),
});

/**
 * How differently two mixes are laid out.
 *
 * The worst band, because an average would forgive one thing being on the
 * wrong side entirely as long as everything else was right - and one thing on
 * the wrong side is the thing anybody notices.
 */
export function placementGap(mine, theirs) {
  const a = mine.values ?? mine;
  const b = theirs.values ?? theirs;

  let off = 0;
  let where = null;
  let moved = 0;

  for (const band of STEREO_BANDS) {
    const shift = a.bands[band.id] - b.bands[band.id];
    if (Math.abs(shift) > off) {
      off = Math.abs(shift);
      where = `${band.label} Hz`;
      moved = shift;
    }
  }

  return gapOf({
    off,
    where,
    // Which way, so the advice can say "further left" rather than "different".
    detail: { moved, side: moved > 0 ? 'left' : 'right', whole: a.whole - b.whole },
  });
}
