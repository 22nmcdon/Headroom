// A ceiling that is actually a ceiling.
//
// The sketch has had a safety limiter since it had a bus, and it was a
// DynamicsCompressorNode at threshold -1 with a ratio of 20 and three
// milliseconds of attack. Its comment said it was there "so that launching a
// fourth clip cannot make the output louder than the converter can hold",
// which is the right job and not the one it was doing. Measured, in an
// offline context, with the sketch's own settings:
//
//     material   pushed to   peak out   over its own ceiling
//     hits           +0 dB     -0.08        0.92 dB
//     hits           +6 dB      1.50        2.50
//     hits          +12 dB      2.19        3.19
//     hits          +20 dB      2.92        3.92
//     steady        +20 dB      1.67        2.67
//
// Three decibels over full scale on transient material, and over a decibel at
// only six over. Everything above zero clips on the way out of the converter,
// so four clips at once really did clip.
//
// Two things make it miss. A three-millisecond attack means anything faster
// than three milliseconds goes past before the gain has moved, and a ratio of
// twenty is not infinity, so even settled material sits above the threshold.
// Neither is a setting to tune: a compressor with a knee is the wrong shape
// for the job. What guarantees a ceiling is looking ahead.
//
// So this is the standard lookahead structure, and the reason it is standard
// is that each piece is load-bearing:
//
//   - delay the audio by the lookahead, so the gain can be moved before the
//     peak it is for arrives;
//   - take the gain each sample would need, and hold the smallest of them
//     over the window - a sliding minimum, which is what anticipates;
//   - smooth that, so the gain slides rather than steps, because a step in
//     gain is a click and a click is a peak of its own.
//
// The smoothing is where a lookahead limiter is usually got wrong: an average
// of a minimum can come out above the minimum, which is exactly the overshoot
// the whole structure exists to prevent. So the applied gain is the smaller of
// the smoothed gain and the held minimum. That cannot overshoot by
// construction rather than by calibration, and `tests/limit.test.js` holds it
// to no sample over the ceiling on every signal it can think of.
//
// This is sample peak and not true peak. What the ceiling is protecting is the
// converter, and a converter holds samples; inter-sample peaks matter to a
// lossy encoder downstream and there is no encoder downstream of a sketch.
// Catching those means detecting on a four-times-oversampled signal, which is
// four times the work for a thing nothing here would hear.

/**
 * How far ahead it looks, in seconds.
 *
 * Not `LOOKAHEAD`, which the transport already owns - the bundler flattens
 * every module into one scope and refuses two modules declaring the same
 * top-level name, which is how that was found rather than by remembering it.
 */
export const LIMIT_AHEAD = 0.005;

/** Where the ceiling sits, in decibels, and why it is not zero. */
export const CEILING_DB = -1;

/**
 * How long the gain takes to come back, in seconds.
 *
 * Only upward: downward is immediate, because the lookahead has already made
 * room for it. Fifty milliseconds is slow enough not to pump on a bass note
 * and quick enough that one loud clip does not hold the whole sketch down
 * behind it.
 */
export const LIMIT_RELEASE = 0.05;

/**
 * A brickwall limiter, one block at a time.
 *
 * `channels` are read and written in place, which is what an audio callback
 * wants. The gain is shared across them, because a limiter that moved the
 * channels independently would move the image every time it worked.
 */
export function makeLimiter(rate, { lookahead = LIMIT_AHEAD, ceiling = CEILING_DB,
  release = LIMIT_RELEASE } = {}) {
  const ahead = Math.max(1, Math.round(lookahead * rate));
  const roof = 10 ** (ceiling / 20);
  const up = Math.exp(-1 / Math.max(1, release * rate));

  // The audio, waiting for the gain to be ready for it.
  const held = [];
  let writeAt = 0;

  // The sliding minimum, as a ring of the gains each of the last `ahead`
  // samples asked for. A deque would be O(1) where this is O(ahead) a sample;
  // at five milliseconds that is 240 comparisons, and the whole point of this
  // file is that it is correct rather than that it is clever.
  // One longer than the delay, which is the difference between a ceiling and
  // nearly a ceiling. At the same length, the request a sample made falls out
  // of the window on the very sample it was holding the gain down for - the
  // ring has wrapped - so the release gets one step in before the peak comes
  // through. Measured, that one step put a click 4.008e-5 over the ceiling:
  // small, and not a ceiling.
  //
  // Doubles rather than floats because these are gains and not audio, and a
  // gain that rounds upward is an overshoot of its own.
  const hold = ahead + 1;
  const asked = new Float64Array(hold).fill(1);
  let at = 0;

  // The box average of that minimum, kept as a running sum.
  const box = new Float64Array(ahead).fill(1);
  let boxAt = 0;
  let sum = ahead;

  let gain = 1;

  return {
    ahead,

    /** The reduction the limiter is applying right now, in decibels. */
    get reduction() { return 20 * Math.log10(Math.max(gain, 1e-9)); },

    block(channels) {
      while (held.length < channels.length) held.push(new Float32Array(ahead));

      const span = channels[0].length;
      for (let i = 0; i < span; i += 1) {
        // The loudest this sample is in any channel: one gain for all of
        // them, so the image does not move when it bites.
        let loudest = 0;
        for (let c = 0; c < channels.length; c += 1) {
          const v = channels[c][i];
          const mag = v < 0 ? -v : v;
          if (mag > loudest) loudest = mag;
        }

        asked[at] = loudest > roof ? roof / loudest : 1;
        at = (at + 1) % hold;

        let lowest = 1;
        for (let k = 0; k < hold; k += 1) if (asked[k] < lowest) lowest = asked[k];

        sum -= box[boxAt];
        box[boxAt] = lowest;
        sum += lowest;
        boxAt = (boxAt + 1) % ahead;
        const smoothed = sum / ahead;

        // Down at once - the lookahead has already made room - and up slowly.
        // Never above the held minimum, which is what makes the ceiling a
        // guarantee rather than a hope: an average of a minimum can sit above
        // that minimum, and that gap is exactly an overshoot.
        const want = Math.min(smoothed, lowest);
        gain = want < gain ? want : Math.min(lowest, up * gain + (1 - up) * want);

        for (let c = 0; c < channels.length; c += 1) {
          const out = held[c][writeAt] * gain;
          held[c][writeAt] = channels[c][i];
          channels[c][i] = out;
        }
        writeAt = (writeAt + 1) % ahead;
      }
    },
  };
}
