// Comparing two readings without knowing what kind they are.
//
// Its own file, and it has to be. The envelope in `src/lib/read.js` is what every
// DSP module imports to wrap its measurement; the comparators live in those
// same DSP modules, beside the maths they compare. So a single file holding
// both the envelope and the dispatch imports the modules that import it - a
// cycle, which the bundler's module order refuses outright and which would
// otherwise have surfaced as a page whose every control came up empty.
//
// Nothing in the app needs this yet: every exercise knows which kind of
// reading it is marking and calls that comparator directly. What needs it is
// anything holding two readings it did not produce - a chain report, a
// comparison against a reference, a drill that asks which of three is closest.

import { curveGap } from './plugins/eq/filters.js';
import { reductionGap } from './plugins/compressor/reading.js';
import { decayGap } from './lib/response.js';
import { repeatGap, wanderGap, duckGap } from './plugins/delay/line.js';
import { stereoGap } from './plugins/stereo/field.js';
import { coherenceGap } from './plugins/stereo/coherence.js';
import { alignGap } from './plugins/align/pair.js';
import { modGap } from './plugins/modulation/trace.js';
import { seriesGap } from './lib/harmonics.js';
import { loudnessGap } from './lib/loudness.js';
import { levelsGap } from './mix/levels.js';
import { shareGap } from './mix/share.js';
import { roomGap } from './mix/room.js';
import { rideGap } from './mix/ride.js';
import { crestGap } from './analysis/dynamics.js';
import { balanceGap } from './analysis/balance.js';
import { widthGap } from './analysis/width.js';
import { placementGap } from './mix/placement.js';
import { comparable, gapOf } from './lib/read.js';

/**
 * How to compare two readings of each kind.
 *
 * Five kinds across six tools, because the reverb and the delay genuinely
 * share one - a room and a repeat are both described by how they decay, and
 * saying so here is what makes "is this delay as long as that room" a question
 * this app can answer.
 *
 * And the analysis readings, which belong to no tool. They are here for the
 * same reason as the rest: so that two of them can be put side by side - your
 * mix against a reference - by something that does not know which kind it is
 * holding.
 */
const GAPS = {
  curve: curveGap,
  reduction: reductionGap,
  decay: decayGap,
  // The delay's own second reading: where the repeats land inside one pass of
  // the loop, which the decay curve is blind to. Measured, a decay curve put
  // three heads 0.45 dB from four against a tolerance of 1.2, because adding
  // earlier heads fills in between the repeats without changing the slope.
  arrivals: repeatGap,
  // And its third: how badly the transport holds time, which both of the
  // others are deliberately blind to. Measured, fifty cents of wow moved the
  // decay curve 0.88 dB against a tolerance of 1.2 - so without this one the
  // wander is a control you could get wrong and still pass.
  wander: wanderGap,
  // And its fourth: how far it gets its repeats out of the way of the dry
  // signal. Measured over a phrase and the gap after it rather than over a
  // response, because a ducker's gain comes from a detector and an impulse has
  // no duration for one to integrate - measured, 24 dB of duck moves the decay
  // curve 0.005 dB, the loop shape 0.003 and the wander 0.0000, against
  // tolerances of 2.6, 1.9 and 1.2.
  ducking: duckGap,
  image: stereoGap,
  // And where that image came from, which the one above cannot say. A Haas
  // delay, a complementary comb, a velvet-noise decorrelator and two
  // microphones two metres apart can read the same width, the same
  // correlation and the same fold-down loss; three of them are one signal
  // filtered twice. Measured, every static widener reads above 0.84 and the
  // only kind that moves reads 0.19 to 0.73, against a floor of 0.03.
  coherence: coherenceGap,
  // Two microphones, added up: the comb their spacing makes, band by band.
  // Not a `curve` and not an `image`, because what is being compared is
  // neither a filter nor a stereo field - it is what two recordings of one
  // event did to each other, and the only readings it can sensibly be put
  // beside are other readings of the same pair.
  align: alignGap,
  // An oscillator's own path, as a fraction of how far it could have gone.
  // The one reading here that is not of any audio: what a modulation does to
  // a signal is different for each of the three families and no single probe
  // sees all of them, so what is compared is the thing they share. See
  // `plugins/modulation/trace.js` for the measurements behind that.
  modulation: modGap,
  harmonics: seriesGap,
  loudness: loudnessGap,
  levels: levelsGap,
  // Which part owns which register, which is the one reading that can say
  // two parts are in the same place. See `mix/share.js` for the measurement
  // that says they are: on the flat mix of short-night the kick and the bass
  // are within half a decibel of each other at 125 Hz.
  share: shareGap,
  // How much room there is and what is in it. One reverb is shared by
  // everything, so this cannot be divided up part by part - what it can do is
  // say what colour the room is, which turns out to be the same question. See
  // `mix/room.js`.
  room: roomGap,
  // Each part's own shape over the four bars, which is the one reading that
  // is about time. See `mix/ride.js`.
  ride: rideGap,
  crest: crestGap,
  balance: balanceGap,
  width: widthGap,
  // Where things sit left to right, which `width` is blind to: a mono part
  // panned anywhere is correlated between the channels, so a width reading
  // sees no side at all and a mirror image of a mix scores as the mix.
  placement: placementGap,
};

/** Which kinds can be compared at all. */
export const KINDS = Object.keys(GAPS);

/**
 * How far apart two readings are.
 *
 * Throws rather than returning a number it does not believe. Every comparator
 * here happily produces a plausible figure from two things that should never
 * have been put side by side - different axes, different material, one of them
 * never measured - and a plausible wrong number is worse than an error,
 * because nothing downstream can tell.
 *
 * **Pairwise only for `harmonics`.** `seriesGap`'s masking floor is derived from
 * both readings at once, so its `off` values are not on a common scale and
 * three of them cannot be ranked against each other. Everything else here is
 * a proper distance.
 */
export function distance(mine, theirs) {
  const why = comparable(mine, theirs);
  if (why) throw new Error(`these readings cannot be compared: ${why}`);

  const gap = GAPS[mine.kind];
  if (!gap) throw new Error(`no way to compare two ${mine.kind} readings`);
  return gapOf(gap(mine, theirs));
}
