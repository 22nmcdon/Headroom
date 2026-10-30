import { peakPhases, peakProto } from './loudness.js';

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
// And the other way of holding a ceiling, which is in here too: cutting the
// waveform at it. A clipper has no lookahead, no gain and no state - it is a
// line the signal may not cross - so what it costs is not dynamics but
// harmonics, and the two modes are the two halves of what a master spends.
//
// Three things were measured about it and all three decided the design.
//
// First, a clipper is not a ceiling. Measured, hard clipping at -1 dB and
// then reading what came out:
//
//     material        sample peak over   true peak over
//     steady tone            0.091            0.123
//     clicks                 3.141            3.141
//     hits over a bed        2.735            3.456
//     noise                  3.025            3.586
//
// Three and a half decibels over the line it was told not to cross. This is
// not a bug in the clipping, it is what band-limiting a clipped waveform
// does: the corners are a discontinuity, filtering the content above Nyquist
// back out of them restores the overshoot, and the reconstruction between the
// samples goes higher again. Which is why `mode: 'both'` exists and why a
// mastering chain really is a clipper into a limiter - measured, the same
// four signals through both come out at -0.000 dB over, every time.
//
// Second, the oversampling earns its cost, and how much depends entirely on
// where the music is. Inharmonic energy left behind by a hard clip, against
// the tone, clipping at the signal's own rate against clipping four times
// faster:
//
//     tone        at 1x    oversampled   bought
//      439 Hz     -58.7        -70.5      11.9
//      999 Hz     -48.5        -62.1      13.6
//     1999 Hz     -38.3        -51.2      12.8
//     3999 Hz     -29.5        -48.1      18.6
//     6999 Hz     -28.3        -51.1      22.8
//     9999 Hz     -13.8        -39.1      25.3
//    13999 Hz     -13.8        -40.1      26.2
//
// At ten kilohertz, clipping at the signal's own rate leaves junk fourteen
// decibels under the tone, on frequencies with no musical relationship to
// anything. That is the fizz people mean by digital clipping and it is not
// the clipping, it is the fold-back.
//
// Four times rather than eight or sixteen, and that is a compromise stated
// rather than hidden: it is the interpolator the true-peak detector already
// has, so the thing that clips and the thing that reports cannot disagree
// about where the ceiling is. More would be better at the top of the
// spectrum. The numbers above are what this one gives.
//
// Third, the round trip is transparent to about -78 dB. A sine inside the
// ceiling comes back delayed by exactly twelve samples and within 2.5e-5 of
// where it started, which is two windowed sincs in series and nothing else.
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
 * The other way of holding a ceiling: cut the waveform at it.
 *
 * A clipper is the opposite of everything above. No lookahead, no gain, no
 * release, no state at all - a line the signal is not allowed to cross. What
 * it costs is not dynamics, it is harmonics: the corner it puts on a waveform
 * is a discontinuity in the slope, and a discontinuity in the slope is a
 * series of odd harmonics going up for ever.
 *
 * Which is why it runs at four times the rate. "For ever" means past half the
 * sample rate, and a harmonic past half the sample rate does not disappear -
 * it folds back down to a frequency with no musical relationship to anything
 * in the signal. Clipping at the signal's own rate puts that fold-back in the
 * output; clipping four times faster puts the first fold four times higher up
 * and filters most of what is left away. `tests/limit.test.js` measures how
 * much, at several frequencies, so the claim is checked rather than asserted.
 *
 * Interpolated up with the same phases the true-peak detector looks between
 * samples with, and filtered back down with the same prototype whole. One
 * filter either way, because a round trip through two filters that were
 * designed separately is a round trip that is not transparent, and nothing
 * would say so.
 *
 * The down filter is normalised to unity at DC here rather than in the loop:
 * the prototype's centre tap is exactly 1 so its phases interpolate at unity
 * already, but the sum of all of them is four - it is the same filter run at
 * four times the density - and dividing by that sum is what makes the round
 * trip come back where it started.
 */
export const CLIP_DOWN = (() => {
  const proto = peakProto();
  let sum = 0;
  for (const tap of proto) sum += tap;
  return Array.from(proto, (tap) => tap / sum);
})();

/**
 * What a clipper does to one sample, at the oversampled rate.
 *
 * `soft` is how far below the ceiling the curve starts bending, as a plain
 * gain rather than in decibels. At zero it is a straight cut, which is what
 * "hard clipping" means and is the one that makes the most of the high
 * harmonics. Above zero the corner is rounded off, which trades the top of
 * the series for more of the bottom of it - fewer of the harmonics that sound
 * like breakage, more of the ones that sound like thickness.
 *
 * `tanh` rather than a polynomial knee, for one reason: it approaches the
 * ceiling and never reaches it, so the ceiling is held by the shape of the
 * function rather than by a clamp after it. A polynomial that meets the
 * ceiling with zero slope would do as well and needs its own clamp outside
 * the knee, which is one more place to be wrong.
 *
 * Not `clipAt`, which `sketch/project.js` already owns in the one scope the
 * bundler flattens everything into - and which means a different thing by
 * clip: the thing in a slot of the grid, not the thing done to a waveform.
 */
export function cutTo(x, roof, soft) {
  const mag = x < 0 ? -x : x;
  if (soft <= 0) {
    if (mag <= roof) return x;
    return x < 0 ? -roof : roof;
  }

  const bend = roof - soft;
  if (mag <= bend) return x;
  const shaped = bend + soft * Math.tanh((mag - bend) / soft);
  return x < 0 ? -shaped : shaped;
}

/**
 * A brickwall limiter, one block at a time.
 *
 * `channels` are read and written in place, which is what an audio callback
 * wants. The gain is shared across them, because a limiter that moved the
 * channels independently would move the image every time it worked.
 */
export function makeLimiter(rate, { lookahead = LIMIT_AHEAD, ceiling = CEILING_DB,
  release = LIMIT_RELEASE, truePeak = false, mode = 'limit', knee = 0 } = {}) {
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

  // How the ceiling is held: by looking ahead and moving a gain, by cutting
  // the waveform at it, or by both in that order - which is what a mastering
  // chain does and is not a compromise between the two. The clipper takes the
  // tips off, so the limiter has less to do and moves its gain less; and the
  // limiter catches whatever the clipper's own filters let back past.
  let clipping = mode !== 'limit';
  let limiting = mode !== 'clip';
  // The knee as a plain gain under the ceiling rather than in decibels, so
  // the per-sample loop has no logarithms in it.
  let soft = knee > 0 ? roof * (1 - 10 ** (-knee / 20)) : 0;

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
  // The clipper's two rings a channel: the input it interpolates from, and
  // the oversampled signal it filters back down. Built only when something
  // asks for the mode, because the sketch's own safety limiter runs on every
  // sketch and should pay nothing for a mode it does not use.
  //
  // The fast ring is a multiple of the oversampling and at least as long as
  // the filter, so that advancing it four at a time never straddles the end.
  const clipUp = [];
  const clipFast = [];
  const clipTaps = Math.max(...LIMIT_PHASES.map((phase) => phase.length));
  const clipSpan = CLIP_DOWN.length + (LIMIT_PHASES.length
    - (CLIP_DOWN.length % LIMIT_PHASES.length));
  let clipAtUp = 0;
  let clipAtFast = 0;

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
      // The mode is the one setting here that is not seamless, and it cannot
      // be: clipping holds the signal up by twelve samples and limiting by
      // the whole lookahead, so changing between them changes the latency and
      // there is a short discontinuity whichever way it goes. It is a button
      // rather than a knob, so it is paid for once rather than per step of a
      // drag. Running the limiter always with its gain pinned at one would
      // keep the latency fixed, at the cost of five milliseconds of delay in
      // a mode that does not need any.
      if (next.mode !== undefined) {
        clipping = next.mode !== 'limit';
        limiting = next.mode !== 'clip';
      }
      // After the ceiling, because the knee is measured from it. Re-derived
      // whenever either moves, or a ceiling change would leave the bend where
      // the old ceiling put it.
      if (next.ceiling !== undefined || next.knee !== undefined) {
        const asked = next.knee !== undefined ? next.knee : knee;
        knee = asked;
        soft = asked > 0 ? roof * (1 - 10 ** (-asked / 20)) : 0;
      }
      if (next.release !== undefined) {
        up = Math.exp(-1 / Math.max(1, Math.max(0, next.release) * rate));
      }
      if (next.truePeak !== undefined) phases = next.truePeak ? LIMIT_PHASES : null;
    },

    /**
     * The clipper, over a block, in place.
     *
     * One output a sample, from four clipped sub-samples. The signal is
     * interpolated up a phase at a time, cut at the ceiling four times as
     * often as it was sampled, and filtered back down - so the harmonics the
     * corner makes have four times as much room before the first of them
     * folds back, and most of what does fold is in the filter's stopband.
     */
    clipBlock(channels) {
      while (clipUp.length < channels.length) {
        clipUp.push(new Float64Array(clipTaps));
        clipFast.push(new Float64Array(clipSpan));
      }

      const over = LIMIT_PHASES.length;
      const span = channels[0].length;

      for (let i = 0; i < span; i += 1) {
        for (let c = 0; c < channels.length; c += 1) {
          const slow = clipUp[c];
          const fast = clipFast[c];
          slow[clipAtUp] = channels[c][i];

          // Phase p is the sub-sample at 4n + p, which is the same identity
          // the true-peak detector reads these phases by - so the four come
          // out in the order the waveform is actually in.
          for (let p = 0; p < over; p += 1) {
            const tap = LIMIT_PHASES[p];
            let sum = 0;
            for (let k = 0; k < tap.length; k += 1) {
              let from = clipAtUp - k;
              if (from < 0) from += clipTaps;
              sum += tap[k] * slow[from];
            }
            let at = clipAtFast + p;
            if (at >= clipSpan) at -= clipSpan;
            fast[at] = cutTo(sum, roof, soft);
          }

          // And back down: one filter over the oversampled signal, read once
          // per input sample, which is the decimation.
          //
          // Read at phase zero of this input, not at the newest sub-sample.
          // Both are already written, so either runs - but the filters' delays
          // only add up to a whole number of input samples on phase zero. Read
          // three sub-samples later the round trip comes out 11.25 samples
          // late, which is a quarter of a sample of fractional delay, and a
          // fractional delay on a signal is a quarter-cycle phase error at the
          // top of the spectrum. Measured, that read 2.9e-3 of error on a
          // 440 Hz sine the round trip should have returned untouched. On
          // phase zero the delay is exactly twelve samples and the same sine
          // comes back within 2.5e-5 - the filter pair's own passband ripple,
          // about 78 dB down, which is what two windowed sincs in series cost
          // and is the price of the mode rather than a fault in it.
          let out = 0;
          for (let k = 0; k < CLIP_DOWN.length; k += 1) {
            let from = clipAtFast - k;
            if (from < 0) from += clipSpan;
            out += CLIP_DOWN[k] * fast[from];
          }
          channels[c][i] = out;
        }

        clipAtUp = (clipAtUp + 1) % clipTaps;
        clipAtFast = (clipAtFast + over) % clipSpan;
      }
    },

    block(channels) {
      if (clipping) this.clipBlock(channels);
      if (!limiting) return;

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
