// Moving a signal's pitch without moving its length, by the cheap method.
//
// Here rather than in a plugin folder because two of them need it now: the
// reverb's shimmer sends the room back round an octave up, and the imager's
// micro-pitch widener detunes the two sides a few cents apart. They are the
// same arithmetic at very different ratios, and a second copy of a processor
// is the thing this codebase's worklet machinery exists to prevent.
//
// It is a crude shifter and no amount of tuning makes it a good one. Two
// heads read a delay line faster or slower than it is written; each laps the
// write head once per window, and because the two heads are the same signal a
// fixed distance apart they comb with each other. What rescues it in both
// places it is used is that its output is never heard on its own - the reverb
// sends it back into a room, and the imager puts it in the side of a pair
// whose middle is the dry signal.

/**
 * How long the line is, in samples.
 *
 * Four thousand and ninety-six, measured, and the measurement holds at both
 * ends of the range of ratios these two callers use. As how much of the
 * output lands at the pitch asked for, 440 Hz in:
 *
 *     ratio             window 1024   window 4096
 *     +9 cents            -28.07 dB     -2.38 dB
 *     +25 cents           -31.37        -5.64
 *     +100 cents          -51.88       -22.09
 *
 * A short line laps often and sprays wide; a long one laps slowly. The cost
 * of a long line is that a transient is smeared across it, which is 43 ms
 * here, and both callers are effects where 43 ms is nothing.
 *
 * Note which way round that goes: the shifter is BETTER at small ratios than
 * large, because the lap rate is proportional to how far the ratio is from
 * one. Nine cents laps every sixteen seconds and reads 34 dB of suppression
 * of the original; an octave laps at 11.7 Hz and reads 36. The micro-detune
 * case is the easy one for this algorithm, not the hard one.
 */
export const PITCH_WINDOW = 4096;

/**
 * The two heads' weights, and why they are a raised cosine over the whole
 * traverse.
 *
 * Each head is weighted by a raised cosine over its whole traverse, and the
 * two are half a line apart, so the weights sum to exactly one at every
 * position - (0.5 - 0.5cos x) + (0.5 - 0.5cos(x + pi)) is 1 for every x.
 * Unity gain by construction, and no divide.
 *
 * The obvious alternative - full weight through the middle of the traverse,
 * fading only where a head is about to overtake the write head - is wrong in
 * a way that hides. Both heads are in the middle at the same time, so the
 * pair has a gain of two: measured, the summed weight runs between 1.0 and
 * 2.0 and on noise it reads +2.09 dB. That cost a wrong conclusion once,
 * before it was measured: with the six-decibel version inside the reverb's
 * feedback path, a loop gain of 0.85 ran away and the loop was blamed. The
 * loop was fine. The knob was lying by six decibels.
 *
 * On noise the correct version reads -1.26 dB, which is not a gain error -
 * it is the two heads combing, and that is the algorithm.
 */
export const PITCH_SHAPE = 'raised cosine, whole traverse';

/**
 * The shifter: one sample in, one out, two channels.
 *
 * Shaped like the other cores here - `set` then `stereo`, with the answer on
 * `left` and `right` - so the same worklet machinery runs it and the same
 * kind of test can hold the audio thread's copy against this one.
 *
 * The two channels share a read position and a window and keep separate
 * lines, because the two heads have to land in the same place on both or a
 * centred source comes out uncentred.
 *
 * `set({ ratio })` takes a frequency ratio rather than an interval, because
 * its two callers name their intervals very differently - one in octaves and
 * fifths, the other in cents - and a ratio is the thing they agree on.
 */
export function pitchCore(rate, window = PITCH_WINDOW) {
  const size = Math.max(64, Math.round(window));
  const half = size / 2;
  const lines = [new Float32Array(size), new Float32Array(size)];

  let at = 0;          // where the write head is
  let read = 0;        // and where the first read head is, fractionally
  let ratio = 1;

  const core = {
    left: 0,
    right: 0,

    set(next) {
      if (next && Number.isFinite(next.ratio) && next.ratio > 0) ratio = next.ratio;
      return core;
    },

    stereo(inL, inR) {
      lines[0][at] = inL;
      lines[1][at] = inR;

      let sumL = 0;
      let sumR = 0;
      for (let h = 0; h < 2; h += 1) {
        const pos = read + (h === 0 ? 0 : half);
        const whole = Math.floor(pos);
        const i0 = whole >= size ? whole - size : whole;
        const i1 = i0 + 1 >= size ? 0 : i0 + 1;
        const frac = pos - whole;

        // How far this head is behind the write head, which is what the
        // window is a function of: at zero it is about to be overtaken and
        // reads nothing.
        let gap = at - pos;
        if (gap < 0) gap += size;
        if (gap >= size) gap -= size;
        const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * gap) / size);

        sumL += w * (lines[0][i0] * (1 - frac) + lines[0][i1] * frac);
        sumR += w * (lines[1][i0] * (1 - frac) + lines[1][i1] * frac);
      }

      at += 1;
      if (at === size) at = 0;
      read += ratio;
      while (read >= size) read -= size;

      core.left = sumL;
      core.right = sumR;
      return core;
    },
  };

  // `rate` is taken and not used, which is deliberate: every other core in
  // this app is built from one and a shifter that did not take one would be
  // the odd one out for no reason. The window is in samples because what it
  // has to be is a power of two, not a number of milliseconds.
  void rate;
  return core;
}

/** A ratio from an interval in cents, which is how a detune is named. */
export const ratioFromCents = (cents) => 2 ** (cents / 1200);
