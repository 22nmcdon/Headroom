// What "how much is this reducing" is measured in, wherever it is measured.
//
// This was three declarations inside the compressor, which was right while
// the compressor was the only thing that reduced anything. The limiter made
// it wrong: `tests/seams.test.js` refuses a plugin that imports another
// plugin, and it is right to - two plugins reaching into each other is how a
// folder stops being a unit. But the alternative on offer was a second
// `materialStamp` and a second `meanFrames`, which is worse than either: two
// readings would then claim the same axis having computed it two ways, and
// `comparable()` would wave them through.
//
// So the frame and the stamp live here, where anything that reduces can share
// them. What stays in the compressor is the compressor's own: the pass, the
// lean, and what a difference in reduction means.

/** How long a frame is. The number the scoring was already calibrated on. */
export const FRAME_MS = 5;

/**
 * The channels of whatever was handed over, as an array.
 *
 * One buffer or a list of them, because a reading is taken over mono material
 * everywhere except the one path where somebody loads their own stereo file.
 * A list of one is the mono case and is stamped and measured as such, so
 * nothing had to change at the callers that were already right.
 *
 * Not `channelsOf`, which the analysis page owns, and not `channelsIn`, which
 * the mix render owns - the bundler flattens every module into one scope and
 * refuses a duplicate, which is how both of those were found rather than by
 * remembering them.
 */
export const overChannels = (material) => (Array.isArray(material) ? material : [material]);

/**
 * Which audio this is a reading over, cheaply.
 *
 * Two reduction readings can only be compared if they were taken over the same
 * material - the whole measurement is what these settings did to this loop.
 * Nothing carried that before, so a comparison across two different loops
 * returned a number rather than an error, which is the worst way to be wrong.
 *
 * Length and a strided checksum rather than a real hash: this runs on every
 * measurement and it only has to tell two loops apart, not resist anybody.
 *
 * Each channel is weighted by its own position, so a pair is told apart from
 * either side of itself and from the same pair the other way round - which
 * matters, because a stereo reading and a reading of its left channel are
 * genuinely different measurements: one is driven by the louder of the two
 * and the other by the left alone. A pair of identical channels is stamped as
 * the pair it is rather than as the mono signal it contains; what a stamp
 * describes is the material the measurement was taken over, and guessing at
 * equivalence is how the false comparisons this exists to refuse get back in.
 */
export function materialStamp(material) {
  const channels = overChannels(material);
  const first = channels[0];
  if (!first?.length) return 'none';

  const stride = Math.max(1, Math.floor(first.length / 64));
  let sum = 0;
  for (let c = 0; c < channels.length; c += 1) {
    const samples = channels[c];
    if (!samples?.length) continue;
    for (let i = 0; i < samples.length; i += stride) sum += samples[i] * (i + 1) * (c + 1);
  }
  return `${first.length}:${sum.toFixed(3)}`;
}

/** A signal averaged into frames - for reading a gain-reduction trace. */
export function meanFrames(samples, rate, frameMs = FRAME_MS) {
  const span = Math.max(1, Math.round((frameMs / 1000) * rate));
  const out = new Float32Array(Math.ceil(samples.length / span));

  for (let f = 0; f < out.length; f += 1) {
    const end = Math.min(samples.length, (f + 1) * span);
    let sum = 0;
    for (let i = f * span; i < end; i += 1) sum += samples[i];
    out[f] = sum / Math.max(1, end - f * span);
  }

  return out;
}
