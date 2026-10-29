import { PITCH_WINDOW } from '../../lib/pitch.js';
// The one part of this reverb that is not an impulse response.
//
// Everything else here is convolution: the settings make a response and the
// loop is convolved with it, so the picture on screen is the reverb rather
// than a drawing of it. A shimmer cannot be that. It is the room fed back
// into itself through a pitch shifter, and a thing whose output depends on
// what it has already produced has no single response to be the truth of it.
//
// So this is the reverb's non-linear layer, and it sits outside everything
// that is drawn and marked. At rest it is bypassed entirely and every
// response in the app is what it always was.

/**
 * How long the shifter's line is, in samples.
 *
 * A crossfaded delay line is a crude pitch shifter and no window length makes
 * it a good one. Two heads read the line faster than it is written; each
 * laps the write head once per window, and because the two heads are the same
 * signal a fixed distance apart they comb with each other. Where that comb
 * has a null depends on the input frequency, so the output breathes, and how
 * much it breathes is a different number at every pitch. Measured over eleven
 * input frequencies from 110 Hz to 3.5 kHz, as the high-to-low spread of the
 * output's own level:
 *
 *     window   latency    worst    mean
 *       2048     21 ms   19.59 dB  6.24 dB
 *       4096     43 ms   15.22     4.52
 *       8192     85 ms   15.29     5.08
 *
 * A single-tone measurement of this is worthless and the first one taken here
 * was: at 440 Hz a window of 8192 reads 41 per cent modulation and 16384
 * reads 2 per cent, which is not a property of the window at all. It is that
 * 440 Hz goes half a cycle in 4096 samples and nearly a whole one in 8192, so
 * the two heads cancel at one window and add at the other. The sweep is the
 * measurement; the tone is a coincidence.
 *
 * Four thousand and ninety-six, which is the best of the three on both counts
 * and 43 ms of latency in a path that is already a reverb.
 *
 * One window for every interval, which was also measured rather than assumed.
 * The lap rate is rate * |ratio - 1| / size, so an octave laps at 11.7 Hz and
 * two octaves at 35.2, and the obvious fix is to grow the window with the
 * interval so they all lap at the same rate. It makes things worse. Measured
 * as how much of the output lands within a semitone of the pitch asked for,
 * averaged over inputs at 220, 440 and 880 Hz:
 *
 *     interval          one window     lap matched
 *     octave up           -18.4 dB       -18.4 dB
 *     fifth up            -17.2          -16.3
 *     fourth up           -13.0          -17.2
 *     two octaves up      -17.6          -24.9
 *     octave down          -7.3          -14.8
 *     fifth down           -9.7           -8.4
 *
 * Four of the six get worse and the two that improve do so by a decibel. A
 * longer line is a longer line to smear a transient across, and that costs
 * more than matching the lap rate buys.
 *
 * Those numbers also say plainly what this device is: between two and twenty
 * per cent of its output is at the pitch asked for and the rest is spray.
 *
 * None of that is as bad as it reads, because the shifter's output goes
 * straight back into the room. Convolving a 10-20 Hz wobble with a 1.8 second
 * tail spreads it across the tail. Measured on the shimmer tail itself, as
 * the ripple around its own decay slope over seconds two to five: 1.9 to 2.5
 * dB at every loop gain from 0.5 to 1.2. The room does the smoothing this
 * does not.
 */
export const SHIMMER_WINDOW = PITCH_WINDOW;

/**
 * The two heads' weights, and why they are a raised cosine over the whole
 * traverse rather than a fade at the seams.
 *
 * The obvious construction is to let each head sound at full weight through
 * the middle of its traverse and fade it only where it is about to overtake
 * the write head. That is wrong, and wrong in a way that hides: the two heads
 * are half a line apart, so both of them are in the middle at the same time,
 * and the pair has a gain of two. Measured, the summed weight runs between
 * 1.0 and 2.0 - six decibels at worst - and on noise it reads +2.09 dB.
 *
 * A raised cosine over the whole traverse sums to exactly one everywhere,
 * because (0.5 - 0.5cos x) + (0.5 - 0.5cos(x + pi)) is 1 for every x. So the
 * pair has unity gain by construction and needs no divide, and the knob in
 * front of it means what it says. On noise it reads -1.26 dB, which is not a
 * gain error - it is the two heads combing, and that is the algorithm.
 *
 * This cost a wrong answer before it was measured. With the six-decibel
 * version in the loop, a feedback of 0.85 ran away, and the conclusion drawn
 * was that the loop was unstable above 0.8. It was not: the knob was lying by
 * six decibels.
 */
export const SHIMMER_SHAPE = 'raised cosine, whole traverse';

/**
 * How far round the loop a shimmer may be sent.
 *
 * One, and there is real headroom above it. A feedback path around a
 * convolver is normally a bad idea - see `SHIMMER_SAFE` - but a pitch shift
 * in that path changes the question completely, because energy that comes
 * back at a different frequency cannot resonate with the frequency it came
 * from. Measured, a one-second chord into an 1.8 second room, octave up in
 * the loop, as the peak in each four-second block over twenty seconds:
 *
 *     loop gain    0-4s    4-8s   8-12s  12-16s  16-20s
 *          0.5     -8.9   -92.3  -212.3  -240.0  -240.0
 *          0.8     -6.9   -75.2  -132.6  -184.3  -230.1
 *          1.0     -5.4   -58.5   -88.1  -116.6  -143.3
 *          1.2     -3.6   -37.6   -46.3   -53.4   -60.6
 *          1.5      1.8    13.4    33.8    54.4    75.1
 *
 * Stable at 1.2 and away at 1.5, so the knob stops at one with a third of its
 * own travel in hand. Which is more headroom than it looks: the knob is a
 * gain, and 1.5 against 1.0 is 3.5 dB.
 */
export const MOST_SHIMMER = 1;

/**
 * What a bare feedback path around the convolver does, which is why there is
 * a shifter in it and not just a gain.
 *
 * Measured and declined, and the measurement is worth keeping because "put a
 * gain in a loop around the reverb" is the first thing anybody tries.
 *
 * Every response this reverb builds is energy-normalised to -3.01 dB, which
 * looks like it should make a loop gain of one marginally stable. Energy says
 * nothing about it. What decides whether a feedback loop runs away is the
 * worst single frequency in the response, and a noise-like tail of a hundred
 * thousand taps with unit energy has a response that is nowhere near flat:
 *
 *     space / decay     |H| worst   |H| median   stable below
 *     room      1.8s        2.28       0.69          0.439
 *     plate     1.8s        2.38       0.60          0.421
 *     gated     1.8s        1.64       0.56          0.609
 *     spring      5s        4.77       0.44          0.210
 *
 * So the gain that is safe is somewhere between 0.21 and 0.64 depending on
 * which space and which decay, which is not a knob anybody can be handed. And
 * below that it does not do the job either: at a gain of 0.5 a chord through
 * a room came back as the room's own worst frequency and nothing else -
 * measured, the energy still at the chord's three partials fell from -4.6 dB
 * to -64 dB over six seconds. A gain in a loop around a reverb is not a
 * shimmer and not a freeze. It is a resonator tuned to whichever frequency
 * the noise happened to favour.
 *
 * With a shift in the loop, none of that applies, and the proof is the
 * control case: a shifter set to leave the pitch alone takes the same loop to
 * +254 dB in ten seconds, where every interval up or down stays bounded. It
 * is the shift doing the work, not the windowing.
 */
export const SHIMMER_SAFE = 'the shift, not the gain';

/**
 * Where the loop is high-passed, in Hz.
 *
 * Without one the loop silts up at the bottom. Every pass shifts again, so a
 * downward interval walks the energy towards DC - 220 Hz becomes 110, then
 * 55, then 27 - and an upward one leaves behind whatever the shifter sprays
 * near zero, which the feedback then accumulates. Measured as the spectral
 * centroid of each second of the tail, at a shimmer of 0.9:
 *
 *     octave up        1s     2s     3s     4s     5s     6s
 *       no filter    330Hz  547Hz 1102Hz 1241Hz  311Hz   47Hz
 *       60 Hz        334    554   1099   1193    581    295
 *       120 Hz       346    577   1099   1179    555    287
 *       250 Hz       341    626   1147   1233    462    332
 *
 *     octave down
 *       no filter    216Hz   62Hz    9Hz    7Hz    8Hz    8Hz
 *       60 Hz        212    120     33     31     26     24
 *       120 Hz       208    159     63     55     53      -
 *       250 Hz       221    204    105    114     85      -
 *
 * The climb is the device working - an octave up really does rise, 330 Hz to
 * 1241 over four seconds - and the collapse to 47 Hz and then 35 is the loop
 * filling with rumble nobody asked for. Any corner stops it. The choice
 * between them is the downward intervals, which at 60 Hz still end up at 24
 * Hz and at 120 sit at 53, which is a bass note rather than a thump in a
 * cone.
 *
 * A hundred and twenty, and it costs nothing at the top: the room's own low
 * end reaches the output through the direct path, which is not filtered. Only
 * what goes round again is.
 */
export const SHIMMER_FLOOR = 120;

/**
 * The intervals on offer, as frequency ratios.
 *
 * All of them measured stable at a loop gain of one, downward ones included -
 * which was worth checking rather than assuming, because a downward shift
 * moves energy towards where a room has more gain and less of it leaves the
 * band. The level each second over ten seconds bore that out: down an octave
 * is the slowest of them to fade and still fades.
 *
 * An octave up is first because it is the sound the control is named after.
 * There is deliberately no "unchanged": that is the one setting that is not
 * stable, and a picker that can be set to it is a picker that can be set to
 * a runaway.
 */
export const SHIMMER_INTERVALS = [
  { id: 'octaveUp', label: 'Octave up', ratio: 2, said: 'an octave up' },
  { id: 'fifthUp', label: 'Fifth up', ratio: 1.498307, said: 'a fifth up' },
  { id: 'fourthUp', label: 'Fourth up', ratio: 1.334840, said: 'a fourth up' },
  { id: 'twoOctavesUp', label: 'Two octaves up', ratio: 4, said: 'two octaves up' },
  { id: 'octaveDown', label: 'Octave down', ratio: 0.5, said: 'an octave down' },
  { id: 'fifthDown', label: 'Fifth down', ratio: 0.667420, said: 'a fifth down' },
];

/** One interval's ratio, by id, falling back to the octave. */
export function shimmerRatio(id) {
  const found = SHIMMER_INTERVALS.find((interval) => interval.id === id);
  return found ? found.ratio : SHIMMER_INTERVALS[0].ratio;
}

/**
 * The shifter has moved to lib/pitch.js, because the imager's micro-pitch
 * widener wants the same arithmetic at a ratio a hundred times smaller. The
 * window length and the unity-gain window shape are measured there, including
 * the +6 dB version of the window that once made this loop look unstable.
 *
 * What stays here is what is the reverb's: which intervals are offered, how
 * far round the loop a shimmer may be sent, and why a bare gain in that loop
 * does not work.
 */
