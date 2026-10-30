import { peakPhases } from './loudness.js';

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
// Sample peak by default, and true peak when asked. What the sketch's own
// ceiling protects is the converter, and a converter holds samples; that is
// the whole job there and the cheap detector does it exactly.
//
// A master does have an encoder downstream, and for that the sample peak is
// not a ceiling at all. Measured, as how far over a -1 dBFS ceiling the
// waveform those samples describe actually goes:
//
//     material        sample-peak mode   true-peak mode
//     sine 997 Hz           0.002            0.000
//     sine 9250 Hz          0.001            0.000
//     clicks                0.830           -0.000
//     square 997 Hz         1.854           -0.000
//     hits                  3.173            0.000
//     noise                 3.451            0.003
//
// Three and a half decibels over on noise, and nearly two on something as
// ordinary as a square wave. The true-peak mode holds it: 0.003 dB at worst
// there, and 0.000 across a sine sweep from 500 Hz to 20 kHz in 250 Hz steps.
//
// It detects on the four-times-oversampled signal using the same polyphase
// interpolator the loudness meter measures with - shared rather than rebuilt,
// because a limiter calibrated against a different filter than the meter is a
// limiter that misses by however much the two differ.
//
// One trap in measuring any of this, which cost four wrong hypotheses before
// the signals were looked at rather than the code. A true peak read off a
// buffer that stops mid-waveform is measuring the truncation: the
// reconstruction of an abrupt cut rings past the end, and on a 750 Hz tone
// whose last samples were still climbing it read 0.89 dB over a ceiling the
// limiter was holding exactly. The material above fades in and out over 512
// samples for that reason. Real audio ends in silence; test material has to
// be made to.

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
 * The detector's own lag, and why it does not need compensating.
 *
 * The interpolator's phase zero is a single unit tap at its centre, so the
 * reconstruction it reports at step i is of input sample i - PEAK_LAG, six
 * samples back. The gain request therefore arrives six steps late. It does
 * not matter: the audio is held for the whole lookahead, 240 samples at five
 * milliseconds and 48 kHz, so a request made at step i still lands 234 steps
 * before the sample it is for comes out. What it does mean is that the last
 * six samples of a stream never have their reconstruction looked at, which is
 * an eighth of a millisecond at the very end of the audio and is why this is
 * a note rather than a correction.
 */
export const DETECTOR_LAG = 'absorbed by the lookahead';

/**
 * The interpolator, as numbers rather than as the function that builds them.
 *
 * An exported non-function value, which is exactly what `limiter-node.js`
 * sweeps up into the worklet's prelude - so the audio thread gets the same
 * filter the meter uses with no list for anybody to forget. Calling
 * `peakPhases()` from inside the stringified limiter would not work: the
 * worklet has never run the module that builds `PHASES`, and the chain that
 * does - a prototype length, a centre, a window, a sinc - is four more things
 * to carry across and keep in step.
 *
 * Plain arrays rather than the Float64Arrays it hands back, because the
 * prelude writes these as JSON and a typed array serialises as an object with
 * numeric keys rather than as a list.
 */
export const LIMIT_PHASES = peakPhases().map((phase) => Array.from(phase));

/**
 * A brickwall limiter, one block at a time.
 *
 * `channels` are read and written in place, which is what an audio callback
 * wants. The gain is shared across them, because a limiter that moved the
 * channels independently would move the image every time it worked.
 */
export function makeLimiter(rate, { lookahead = LIMIT_AHEAD, ceiling = CEILING_DB,
  release = LIMIT_RELEASE, truePeak = false } = {}) {
  const ahead = Math.max(1, Math.round(lookahead * rate));

  // Let rather than const, because three of the four settings can be moved
  // while this is running and one cannot. The ceiling, the release and which
  // peak is being watched are all read fresh every sample, so `set` can
  // change them without resetting anything - which is what a knob being
  // dragged needs. The lookahead cannot: it is the length of the delay line
  // and of the sliding minimum, and changing it means new buffers and a
  // discontinuity in the audio already held in the old ones. So it stays
  // where it was fixed, at construction.
  let roof = 10 ** (ceiling / 20);
  let up = Math.exp(-1 / Math.max(1, release * rate));

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

  // The true-peak detector: one short history a channel, and the same phases
  // the meter uses. Built only when asked, because the sketch's own limiter
  // runs on every sketch and should pay nothing for a mode it does not use.
  // The ring is as long as the longest phase. The phases are NOT all the same
  // length - a 49-tap prototype splits four ways as 13, 12, 12, 12 - and the
  // first version used phase zero's 13 for all of them, so the last tap of the
  // other three read `undefined`, every sum came out NaN, and `NaN > loudest`
  // is false. The detector contributed exactly nothing and said nothing about
  // it, which is how a silent comparison fails.
  let phases = truePeak ? LIMIT_PHASES : null;
  // The ring's length off the phases themselves rather than off whether the
  // mode is on, so that switching it on mid-flight does not have to resize
  // anything. It is a number; the arrays behind it are still only allocated
  // when something asks for the mode.
  const taps = Math.max(...LIMIT_PHASES.map((phase) => phase.length));
  const recent = [];
  let recentAt = 0;

  // The box average of that minimum, kept as a running sum.
  const box = new Float64Array(ahead).fill(1);
  let boxAt = 0;
  let sum = ahead;

  let gain = 1;

  return {
    ahead,

    /** The reduction the limiter is applying right now, in decibels. */
    get reduction() { return 20 * Math.log10(Math.max(gain, 1e-9)); },

    /**
     * Move the ceiling, the release or the detector, without starting over.
     *
     * The sketch's own limiter never calls this - it is set once and left -
     * but a limiter you can turn the knobs on is a different instrument from
     * one you cannot, and rebuilding it per step of a dragged control would
     * mean a new delay line, an empty one, and a click a step.
     *
     * Nothing here is ramped. A ceiling that slid into place would be a
     * ceiling that was briefly somewhere else, and the one promise this file
     * makes is that no sample comes out above the one it was asked for. The
     * gain itself still moves smoothly, because the smoothing is downstream
     * of all three of these.
     */
    set(next = {}) {
      if (next.ceiling !== undefined) roof = 10 ** (next.ceiling / 20);
      if (next.release !== undefined) {
        up = Math.exp(-1 / Math.max(1, Math.max(0, next.release) * rate));
      }
      if (next.truePeak !== undefined) phases = next.truePeak ? LIMIT_PHASES : null;
    },

    block(channels) {
      while (held.length < channels.length) held.push(new Float32Array(ahead));
      if (phases) while (recent.length < channels.length) recent.push(new Float64Array(taps));

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

        // And, when the ceiling has to hold for an encoder, the loudest the
        // waveform gets BETWEEN the samples as well. Every phase of every
        // channel, because the peak can be in any of them and the gain is
        // shared across all of them anyway.
        if (phases) {
          for (let c = 0; c < channels.length; c += 1) recent[c][recentAt] = channels[c][i];
          for (let c = 0; c < channels.length; c += 1) {
            const history = recent[c];
            for (let p = 0; p < phases.length; p += 1) {
              const tap = phases[p];
              let sum = 0;
              for (let k = 0; k < tap.length; k += 1) {
                let from = recentAt - k;
                if (from < 0) from += taps;
                sum += tap[k] * history[from];
              }
              const mag = sum < 0 ? -sum : sum;
              if (mag > loudest) loudest = mag;
            }
          }
          recentAt = (recentAt + 1) % taps;
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
