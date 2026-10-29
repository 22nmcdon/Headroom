// Holding a room, which convolution cannot do either.
//
// The shimmer next door is the room fed back through a pitch shifter. This is
// the other thing the README said was ruled out: a loop gain of one. It is
// ruled out for a reason that the shimmer work measured - a gain of one in a
// loop around a convolver is not a sustain, it is a resonator that finds the
// response's loudest frequency and rings on it, and at half that gain a chord
// came back as one note within six seconds. See `SHIMMER_SAFE`.
//
// So a freeze does not recirculate. It keeps the last second of what the room
// produced and plays it round, which holds the sound that was actually there
// rather than a filtered version of it. That is a sampler sitting on the wet
// output, and calling it that is more honest than calling it a reverb
// control - what makes it a reverb control is that what it captures is a
// reverb tail, which is noise, and noise is the one thing a short loop can
// repeat without anybody hearing the repeat.

/**
 * How much of the room is kept, in seconds.
 *
 * Two things pull against each other. A short loop repeats often enough to be
 * heard as a flutter rather than a wash; a long one means a freeze pressed
 * soon after the plugin opened has not got a full loop to play, because the
 * ring has to fill first. A second is one repeat per second, which is below
 * where periodicity reads as a rate, and a second of history is something any
 * plugin has by the time anybody has found the button.
 *
 * Measured against the alternative design - feeding a captured slice of the
 * input back into the room rather than holding the room's output, which
 * should smear the seam across the whole tail and was the one I expected to
 * win. It loses, and the reason is instructive. As the modulation of the
 * output at the loop's own rate, a chord into an 1.8 second room:
 *
 *     loop     holding the output   feeding the room
 *     0.25 s          0.5 %                -
 *     0.5 s           1.6                12.7 %
 *     1 s             3.9                 9.1
 *
 * Feeding the room loops the input, and the input is a chord: a seam in a
 * tonal signal is a discontinuity in something an ear tracks, and 1.8 seconds
 * of tail smears it without removing it. Holding the output loops noise,
 * where a seam has nothing to be discontinuous against.
 */
export const FREEZE_SECONDS = 1;

/**
 * How long the seam takes to cross, in seconds.
 *
 * A crossfade is not optional and two milliseconds of it is enough. Measured
 * on a decaying noise tail, as the biggest sample-to-sample step at the seam
 * against the biggest step anywhere in the loop's body - which is what an ear
 * hears as a click:
 *
 *     fade      at the seam   elsewhere    ratio
 *     none          4.81e-1    3.63e-1     1.33x
 *     2 ms          1.65e-1    3.63e-1     0.45x
 *     10 ms         2.05e-1    3.63e-1     0.56x
 *     50 ms         1.54e-1    3.63e-1     0.42x
 *
 * With no fade the seam is a bigger step than anything in the material, which
 * is the definition of something to hear. With any fade at all it is smaller
 * than the material's own steps, so there is nothing left to find. Everything
 * above two milliseconds is margin, and twenty-five is a comfortable amount
 * of it without eating much of a one-second loop.
 */
export const FREEZE_FADE = 0.025;

/**
 * Why the crossfade is equal-power and not equal-gain.
 *
 * The two ends of a seam are uncorrelated - they are different parts of a
 * noise tail - so their energies add rather than their amplitudes. Weights
 * that sum to one in amplitude therefore leave a hole in the middle of the
 * fade, and weights that sum to one in power do not. That is the textbook
 * reason, and it is worth a number rather than a citation. Measured as the
 * level through the middle of the fade against the level beside it:
 *
 *     equal power, 10 ms     -0.01 dB
 *     equal gain, 10 ms      -2.95 dB
 *
 * Three decibels, which is exactly what two uncorrelated halves each at half
 * amplitude come to. The same measurement on the seam itself found the two
 * laws identical to three digits, so this is the only thing that chooses
 * between them - and it chooses clearly.
 *
 * Worth saying because the delay's time-change fade went the other way: there
 * the two sides are the same sound at two delays, which is correlated, and
 * no fade law avoids the dip. Correlated or not is the whole question, and it
 * has a different answer in the two places.
 */
export const FREEZE_LAW = 'equal power';

/**
 * The frozen loop, one sample in and one out, two channels.
 *
 * Shaped like the other cores here - `set` then `stereo`, answer on `left`
 * and `right` - so the same worklet machinery runs it and the same kind of
 * test can hold the audio thread's copy against this one.
 *
 * It records always and plays only when frozen, which is what makes the
 * button instant: there is already a second of room in the ring when it is
 * pressed. Recording costs one store a sample a channel.
 */
export function freezeCore(rate) {
  const size = Math.max(2, Math.round(FREEZE_SECONDS * rate));
  const fade = Math.max(1, Math.round(FREEZE_FADE * rate));
  const lines = [new Float32Array(size), new Float32Array(size)];

  let write = 0;
  let filled = 0;      // how much has ever been written, for a freeze pressed early
  let frozen = false;
  let from = 0;        // where in the ring the loop starts
  let body = size - fade;  // and how long it repeats - shorter than the ring by the seam
  let at = 0;

  const core = {
    left: 0,
    right: 0,

    set(next) {
      if (!next || next.freeze === undefined) return core;
      const want = !!next.freeze;
      if (want === frozen) return core;
      frozen = want;
      if (frozen) {
        // Only as much as has actually been written. A freeze pressed before
        // the ring has filled loops what there is rather than the silence in
        // front of it, which is the difference between holding half a second
        // of room and holding half a second of room and half a second of
        // nothing.
        const have = Math.min(filled, size);
        body = Math.max(fade * 2, have - fade);
        from = (write - have + size) % size;
        at = 0;
      }
      return core;
    },

    stereo(inL, inR) {
      // Recording until it is frozen and not after, which is the whole of
      // what "frozen" means. Writing while playing was the first version and
      // it did not hold anything: the write head walks through the ring the
      // loop is reading, so every pass plays newer material than the one
      // before. Measured, a tail frozen at three seconds read -44.1, -44.4
      // and then -51.8 dB over the next three seconds - still decaying, which
      // is a freeze that is not freezing - and two passes differed by 9.88e-2
      // where they have to be identical.
      if (!frozen) {
        lines[0][write] = inL;
        lines[1][write] = inR;
        write += 1;
        if (write === size) write = 0;
        if (filled < size) filled += 1;
      }

      if (!frozen) {
        core.left = 0;
        core.right = 0;
        return core;
      }

      const head = (from + at) % size;
      let w = 1;
      let tailWeight = 0;
      let tailAt = -1;
      if (at < fade) {
        // The first samples of every pass cross with the last of the ring, so
        // the join is between two ends that were a whole loop apart.
        const t = at / fade;
        w = Math.sin((t * Math.PI) / 2);
        tailWeight = Math.cos((t * Math.PI) / 2);
        tailAt = (from + at + body) % size;
      }

      core.left = w * lines[0][head] + (tailAt >= 0 ? tailWeight * lines[0][tailAt] : 0);
      core.right = w * lines[1][head] + (tailAt >= 0 ? tailWeight * lines[1][tailAt] : 0);

      at += 1;
      if (at >= body) at = 0;
      return core;
    },
  };

  return core;
}
