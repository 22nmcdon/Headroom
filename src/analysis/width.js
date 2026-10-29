// How wide a track is, band by band, and whether it survives being summed.
//
// This one is almost entirely reuse. `src/plugins/stereo/field.js` already reads an
// image - correlation, width and balance in seven bands - because the imager is
// marked on exactly that measurement. The imager reads it through its own
// processing; here it is read off the audio as it arrived, with nothing in
// the way.
//
// Which leaves two things for this file: the envelope, so an analysis reading
// can be compared with another one, and the question the imager's exercise
// asks that a track wants answered without being asked - what happens to the
// low end when something sums it.

import { stereoProfile, STEREO_BANDS } from '../plugins/stereo/field.js';
import { readingOf, stampOf } from '../lib/read.js';

// The bands a low end has to survive a fold to mono in. The imager's own
// exercise has a list of the same two under its own name; both stay, because
// the bundle flattens every module into one scope and will not have two
// things called the same.
const BOTTOM_BANDS = ['sub', 'low'];

/**
 * The image of a piece of audio, as it arrived.
 *
 * A mono file has no image, and says so rather than reporting a correlation
 * of 1 and a width of nothing - which is true and is also exactly what a
 * stereo file collapsed by accident looks like, and the two should not print
 * the same.
 */
export function widthReading(channels, rate, { source = null } = {}) {
  const [left, right] = channels.length > 1 ? channels : [channels[0], channels[0]];
  const profile = stereoProfile(left, right, rate);

  // What a fold to mono costs down low: the bands where it matters, each the
  // difference between what is there in stereo and what is left in the middle.
  const cost = BOTTOM_BANDS
    .map((id) => profile.bands[id]?.mono ?? 0)
    .reduce((worst, value) => Math.min(worst, value), 0);

  return readingOf({
    tool: 'analysis',
    kind: 'width',
    of: {
      state: stampOf({ channels: channels.length, rate }),
      source,
      axis: { kind: 'bands', ids: STEREO_BANDS.map((band) => band.id) },
    },
    values: {
      ...profile,
      mono: channels.length === 1,
      lowCost: cost,
    },
  });
}

/**
 * How far apart two images are.
 *
 * The imager's own comparator, which takes the worst band rather than the
 * average - a mix with its low end in completely the wrong place should not
 * score well because the other five agree. Imported rather than reimplemented
 * so that an analysis reading and a round of the imager's match exercise are
 * marked by the same arithmetic.
 */
export { stereoGap as widthGap } from '../plugins/stereo/field.js';
