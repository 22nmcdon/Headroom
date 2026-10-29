import { makeBiquad, setBiquad, runBiquad } from '../../lib/dsp.js';
import { mulberry32 } from '../../lib/random.js';
import {
  RESPONSE_BANDS, LONGEST_TAIL, decayProfile, decayTimes, monoOf, wetDryImpulse,
} from '../../lib/response.js';
import { MOST_SHIMMER } from './shimmer.js';

// A room, as an impulse response.
//
// What a reverb is, for somebody using one, is in src/learn/notes/verb.js.
//
// The reverb here is convolution: the settings make an impulse response and
// the loop is convolved with it. That is more work than an algorithmic reverb
// and it buys the thing this whole app is built on - the picture on screen is
// not a drawing of what the reverb is doing, it is the reverb. The same array
// is convolved, measured, displayed and marked, so there is nothing for the
// three of them to disagree about.
//
// It also means the numbers are real numbers. A decay time is measured off
// the response the way an acoustician measures a hall, rather than being
// whatever the feedback coefficient happened to produce.

/** Every knob, and where it starts. */
export const VERB_DEFAULTS = {
  space: 'room',     // which kind of space this is
  preDelay: 20,      // ms of silence before the room answers
  decay: 1.8,        // RT60 of the mid band, in seconds - the number anyone quotes
  size: 18,          // metres - how far away the first walls are
  bass: 1,           // how much longer the lows ring than the mids: 1 is not at all
  damping: 0.55,     // how much shorter the highs decay: 1 is not at all
  early: 0.35,       // the level of the early reflections against the tail
  lowCut: 20,        // Hz, on the way in
  highCut: 20000,    // Hz, on the way in
  spread: 0.5,       // dispersion: how far ahead of the lows the highs arrive
  tension: 0.5,      // a spring's: how fast the bounces come round
  shimmer: 0,        // how much of the room goes back round through a shifter
  interval: 'octaveUp', // and what happens to its pitch on the way
  mix: 0.3,          // 0 is dry, 1 is nothing but room
};

/**
 * The kinds of space, and which knobs each one has.
 *
 * A space is not a preset. A room has walls, so it has a size in metres and a
 * level for the reflections off them; a plate has neither, because a plate is
 * a sheet of steel and there is nothing in it for sound to bounce off at a
 * distance. Handing a plate a Size knob that quietly does nothing would be a
 * preset wearing a plugin's controls.
 *
 * So each space says what it is called, what to call it on the display, what
 * it is made of and what it answers to - the way the saturator's curve
 * families do - and the deck is rebuilt when it changes.
 * What the two share - pre-delay, decay, damping, the send filters, the mix -
 * keeps its setting across the change: what you had the decay at is still
 * what you want the decay at.
 */
export const SPACES = {
  room: {
    label: 'Room',
    shown: 'the room',
    knobs: ['preDelay', 'decay', 'bass', 'damping', 'size', 'early', 'lowCut', 'highCut', 'shimmer', 'mix'],
  },
  plate: {
    label: 'Plate',
    shown: 'the plate',
    knobs: ['preDelay', 'decay', 'bass', 'damping', 'spread', 'lowCut', 'highCut', 'shimmer', 'mix'],
  },
  gated: {
    label: 'Gated',
    shown: 'the gate',
    // No band multiples: nothing decays for them to be multiples of. The
    // decay knob says how long it holds before the gate shuts.
    knobs: ['preDelay', 'decay', 'size', 'early', 'lowCut', 'highCut', 'mix'],
  },
  reverse: {
    label: 'Reverse',
    shown: 'the room, backwards',
    knobs: ['preDelay', 'decay', 'bass', 'damping', 'size', 'early', 'lowCut', 'highCut', 'mix'],
  },
  spring: {
    label: 'Spring',
    shown: 'the tank',
    // No size, no early, no bass. A tank has no walls to be a distance from
    // and nothing underneath to lift.
    knobs: ['preDelay', 'decay', 'tension', 'spread', 'damping', 'lowCut', 'highCut', 'shimmer', 'mix'],
  },
};

/**
 * Which spaces take a shimmer, and the two that do not.
 *
 * Shimmer is on the room, the plate and the tank, and off the gate and the
 * reverse - the same reasoning that gives a plate no Size knob. Both of those
 * two are the room with something done to its envelope afterwards, and what
 * is done is that it stops: a gate holds and shuts, a reverse swells and
 * ends. A feedback path is a thing that keeps going, so handing either of
 * them one would hand it a control that fights the only thing that makes it
 * what it is.
 *
 * It is not that it cannot be done - the loop is around the convolver and
 * does not care which response is in it. It is that a gated reverb with an
 * endless tail is a gated reverb with the gate taken off.
 */
export const SHIMMER_SPACES = ['room', 'plate', 'spring'];

export const SPACE_ORDER = ['room', 'plate', 'gated', 'reverse', 'spring'];

/** Which knobs a space has, by id, for a deck to be built from. */
export const verbDeckFor = (space) => (SPACES[space] ?? SPACES.room).knobs;

/**
 * Where the tail is split, and why the two edges are not in the same place.
 *
 * It used to split once at 1200 Hz into something that damps and something
 * that does not, while `decayProfile` read three bands at 60-400, 400-3000
 * and 3000-12000 - two band plans with nothing to do with each other. The
 * result was a damping knob that moved one of the three readings. Measured,
 * at decay 1.8 s, across the whole range of the knob:
 *
 *     damping    low(60-400)   mid(400-3k)   high(3k-12k)
 *       0.20       1.80 s        1.83 s        0.41 s
 *       0.55       1.80 s        1.65 s        1.01 s
 *       1.00       1.83 s        1.80 s        1.80 s
 *
 * The low band never moved at all - it sat entirely inside the slow half of a
 * split at 1200 - and the mid band moved ten per cent, which is inside the
 * smallest difference in reverberation time anyone can hear.
 *
 * The obvious fix is to split where the bands are read, so each knob names a
 * reading. Half of it works. The other half does not, and the measurement is
 * worth keeping because the answer is not symmetrical:
 *
 *     split at       damping 0.2 -> 1.0, read 3k-12k      bass 0.5 -> 2.0, read 60-400
 *     400 / 3000     1.19 0.99 1.13 1.40 1.82  <- falls then rises
 *     400 / 2000     0.53 0.69 1.02 1.37 1.82      1.28 1.52 1.91 2.65 3.61
 *     400 / 1500     0.38 0.65 1.01 1.37 1.82      1.28 1.50 1.92 2.67 3.61
 *     300 / 1500     0.38 0.66 1.01 1.37 1.82      1.53 1.61 1.91 2.65 3.52
 *     250 / 1500     0.38 0.66 1.01 1.37 1.82      1.64 1.71 1.91 2.53 3.45
 *
 * Splitting the top at 3000 gives a damping knob that goes down and then back
 * up. At 0.2 the high band dies so fast that what is left in the reading is
 * the mid band's skirt, and the skirt is strongest right at 3000 because that
 * is where the crossover is. A band has to be well clear of the skirt of the
 * one below it by the time the reading that measures it begins - so the top
 * splits an octave early, at 1500, where by 3000 the mid band is 24 dB down
 * and the reading is the high band and nothing else.
 *
 * The bottom has the opposite problem and so takes the opposite answer. The
 * low reading is 60-400, which is narrow and ends where the crossover would
 * be, so putting the split at 400 is what puts the whole of that reading
 * inside the band the knob moves. Moving it down to 250 costs the bass knob
 * most of its downward range: 0.5x reads 1.64 s instead of 1.28.
 *
 * Sharpness is not a taste either. Measured as how much of each band's energy
 * lands in the reading it is meant for, and how flat the three sum back:
 *
 *     stages   low / mid / high purity      summed against white
 *       1      73% / 76% / 95%              -3.61 / -4.81 / -2.01 dB
 *       2      90% / 90% / 98%              -0.05 / -0.18 / -0.02 dB
 *       3      95% / 95% / 99%              -2.14 / -2.41 / -0.89 dB
 *
 * One stage is too shallow to separate and does not sum flat; three separate
 * better and do not sum flat either. Two does both, which is the whole reason
 * Linkwitz-Riley exists, and is what makes a space with no damping and no
 * bass lift the flat noise it always was.
 */
const BAND_EDGES = [RESPONSE_BANDS[0].high, 1500];
const CROSSOVER_POLES = 2;

/** How fast sound travels, in metres a second. */
const SPEED = 343;

/**
 * The shape of the room, as the ratio between its three sides.
 *
 * Each side is the next one times the cube root of two, which is the ratio a
 * studio is built to and for the reason this needs it: no two dimensions are
 * a simple multiple of each other, so no two reflection paths come back at
 * the same moment. Measured against a cube, which is what the obvious reading
 * of a single size knob gives you: a cube eighteen metres on a side has seven
 * reflections arriving by its mixing time at six distinct times, because the
 * walls come in equidistant pairs. This box has every one of its arrivals at
 * a time of its own - ten of ten at eighteen metres, seventy-seven of
 * seventy-seven at sixty.
 *
 * The three multiply to one, so the box holds exactly `size` cubed of air
 * whatever its proportions, which is what keeps `mixingTime` - derived from
 * the volume - exactly the number it already was.
 */
const BOX = [2 ** (1 / 3), 1, 2 ** (-1 / 3)];

/**
 * Where the sound comes from and where it is heard, as fractions of the room.
 *
 * Both off-centre, and off each other, because a source in the middle of a
 * room is the one place where the symmetry it was shaped to avoid comes back:
 * equidistant walls again, on all three axes at once.
 *
 * Two ears rather than one point, a head apart across the width. This is what
 * the stereo of a room actually is - the far wall is further from one ear
 * than the other, by an amount that depends on which wall it is - and it
 * replaces a flat six per cent of arrival time added to one side and taken
 * off the other, which gave every reflection the same displacement whichever
 * direction it came from.
 */
const SOURCE_AT = [0.42, 0.37, 0.55];
const EARS_AT = [[0.63, 0.68, 0.47], [0.63, 0.68, 0.47]];

/** How far apart the ears are, in metres. A head. */
const EAR_GAP = 0.18;

/**
 * Every reflection that reaches each ear within `seconds`, by images.
 *
 * A reflection off a wall arrives from exactly where a copy of the source
 * mirrored through that wall would be, so a rectangular room's reflections
 * are a lattice of mirrored sources and the whole early pattern is a distance
 * sum. That is the textbook method and it is here instead of a list of ten
 * hand-picked fractions of the time it takes sound to cross the room.
 *
 * What the list could not do is change shape. Its taps were fractions of one
 * number, so a four-metre room was a sixty-metre room played fifteen times
 * faster - the same ten reflections in the same order at the same relative
 * levels. A real room's pattern does not scale: the count of reflections
 * arriving by time t grows as t cubed over the volume, so a big room has a
 * long gap and then a thickening, and a small room has almost none of either.
 * Measured on this box, counting to each time against a t-cubed law fitted at
 * 80 ms: 12 images by 80 ms, then 50 by 120 against 41 predicted, 116 by 160
 * against 96, 784 by 300 against 633. The law holds; the fifth or so it runs
 * above is the usual overshoot of an asymptotic count at low order.
 *
 * Levels are one over the distance, which is what spreading does to a
 * spherical wave, and nothing else. The absorption is not here because the
 * room already has one: the caller puts every tap on the same decay the wash
 * is on, so a reflection at 100 ms is as far down as the tail is at 100 ms,
 * which is what a reflection off an absorbing wall is.
 *
 * Deterministic, as the list it replaces was deliberately deterministic: a
 * room of a given size is the same room every time it is built, on every
 * machine, for everybody's daily.
 *
 * Costs about a millisecond at every size, measured, against the sixth of a
 * second the file once spent filtering noise per room.
 */
export function imageSources(size, seconds) {
  const sides = BOX.map((ratio) => size * ratio);
  const reach = seconds * SPEED;
  if (!(reach > 0)) return [[], []];

  const source = sides.map((side, i) => side * SOURCE_AT[i]);
  const ears = EARS_AT.map((at, e) => sides.map((side, i) => {
    const middle = side * at[i];
    // Apart across the width, which is the axis a pair of ears is apart on.
    return i === 1 ? middle + (e === 0 ? -EAR_GAP / 2 : EAR_GAP / 2) : middle;
  }));

  // Far enough out that nothing inside the window is missed: one more cell
  // than the window can reach across the shortest side.
  const order = Math.ceil(reach / (2 * Math.min(...sides))) + 1;
  const found = [[], []];

  for (let a = -order; a <= order; a += 1) {
    for (let b = -order; b <= order; b += 1) {
      for (let c = -order; c <= order; c += 1) {
        for (let p = 0; p < 2; p += 1) {
          for (let q = 0; q < 2; q += 1) {
            for (let r = 0; r < 2; r += 1) {
              // The image of the source in this cell, with each coordinate
              // either the source itself or its mirror in the near wall.
              const walls = Math.abs(2 * a + p) + Math.abs(2 * b + q) + Math.abs(2 * c + r);
              if (walls === 0) continue;  // the direct sound is not a reflection
              const image = [
                (p ? -source[0] : source[0]) + 2 * a * sides[0],
                (q ? -source[1] : source[1]) + 2 * b * sides[1],
                (r ? -source[2] : source[2]) + 2 * c * sides[2],
              ];
              for (let e = 0; e < 2; e += 1) {
                const d = Math.hypot(image[0] - ears[e][0], image[1] - ears[e][1],
                  image[2] - ears[e][2]);
                if (d > reach || d <= 0) continue;
                // An odd number of walls is a mirrored copy, so it arrives
                // the other way up - which is what the alternating sign in
                // the list this replaces was imitating.
                found[e].push({ at: d / SPEED, level: (walls % 2 ? -1 : 1) / d });
              }
            }
          }
        }
      }
    }
  }

  for (const ear of found) ear.sort((x, y) => x.at - y.at);
  return found;
}

/**
 * How long a room of a given size takes to become a wash, in seconds.
 *
 * This used to be the time it takes sound to cross the room and come back,
 * times 1.4 - which is linear in size, and mixing time is not. The number of
 * reflections arriving by time t grows as t cubed over the volume, so the
 * moment the reflections run together goes as the square root of the volume:
 * Griesinger's rule of thumb is sqrt(V) milliseconds, V in cubic metres. The
 * knob names one dimension, so a cube of that side is the fair reading of it,
 * and sqrt(size cubed) is size to the three halves.
 *
 * Measured, against what the old rule gave:
 *
 *     size     was      is    the old rule was
 *      4 m    33 ms    8 ms       4.08x too slow
 *      8 m    65 ms   23 ms       2.89x
 *     18 m   147 ms   76 ms       1.92x
 *     35 m   286 ms  207 ms       1.38x
 *     60 m   490 ms  465 ms       1.05x
 *
 * Right at the top of the range and four times out at the bottom, which is
 * the shape of an error that comes from using a length where a volume
 * belongs. What it sounded like is a small room taking as long to turn to a
 * wash as a hall does - so the size knob changed the delay before the wash
 * and barely the character of it, and small rooms did not sound small.
 *
 * The numbers it gives are the ones the acoustics books give: eight
 * milliseconds for a room four metres across, 76 for a hall of eighteen,
 * 465 for a cathedral of sixty.
 */
export const mixingTime = (size) => size ** 1.5 / 1000;

/**
 * How far past that the reflections are still worth placing one at a time.
 *
 * `mixingTime` is when the wash is fully arrived. It is not when reflections
 * stop: they keep coming forever, and what changes is whether the ear can
 * still tell one from the next. The reflection rate is 4*pi*c^3*t^2/V, so the
 * moment it passes one reflection per millisecond - past which a wash is a
 * fair model of what is arriving - is
 *
 *     t = sqrt(1000 V / 4 pi c^3) = 1.404 sqrt(V) ms
 *
 * which is 1.404 mixing times, whatever the room.
 *
 * It is not a tidier number by accident: stopping at the mixing time itself
 * cut a six-metre room's reflections off before the first one arrived. A
 * small room's first reflection is late compared with its statistical mixing
 * time - at six metres the nearest wall is 5.44 m away round the trip and the
 * mixing time only reaches 5.04 m - so a window that stops there finds
 * nothing at all and the room has no walls. Which is how this was caught: the
 * test that says a big room's walls are further off than a small room's read
 * 30.8 ms against 115.3, and the 30.8 was not a wall, it was the loudest
 * sample of the noise.
 *
 * It is also, within a few per cent, where the wash stops needing to be sparse
 * - which is worth writing down because the obvious next job turns out not to
 * be a job.
 *
 * The wash is dense from its first sample: every sample of it is nonzero,
 * where a real room is still delivering countable reflections. The obvious fix
 * is velvet noise, a sparse impulse train whose density climbs, and the
 * question is how sparse it would have to be to matter. The Aalto listening
 * work puts numbers on it: broadband velvet noise stops sounding grainy at
 * about 1554 pulses a second, but a filtered band needs far less - 668 for a
 * 125 Hz lowpass, 290 for an octave band at 125 Hz, 600 for a 1.5 kHz lowpass.
 * Since the rate a room reaches is 4*pi*c^3*t^2/V, a band needing N pulses a
 * second is smooth after sqrt(N/1000) * 1.4043 mixing times, whatever the
 * room. So:
 *
 *     band              needs       smooth at      against 1.404
 *     low, under 400      ~700     1.20 mixing      -0.21
 *     mid, 400 - 1500     ~600     1.09 mixing      -0.32
 *     high, over 1500     ~1554    1.75 mixing      +0.35
 *
 * Two of the three bands are already covered: the reflections above are still
 * arriving one at a time past the point where those bands would be heard as
 * grainy, because this window was set at a thousand reflections a second and
 * every published figure for a filtered band is under that. The conclusion
 * turns on nothing but whether a band needs more than a thousand.
 *
 * What is left is the high band, for 0.35 mixing times, and it is worth
 * little: 3 ms at four metres, 26 ms at eighteen, 161 at sixty - and the
 * longer it gets the further down it is, from -0.4 dB at four metres to -22 dB
 * at sixty. Turn the damping down and it goes: -17 dB at eighteen metres,
 * -103 at sixty. So the whole of the available improvement is one band, around
 * eighteen to twenty-five metres, with the damping near open, for a couple of
 * dozen milliseconds, four decibels down.
 *
 * It could be had by running the high band's reflections out to 1.75 mixing
 * times while the other two stop at 1.404 - the per-band gains below would
 * carry it. It costs nearly twice the reflections, since the count goes as the
 * cube of the time. It has not been done.
 *
 * The soft part of this is the mapping: those thresholds were measured on
 * lowpass and octave bands at 125 Hz and 1.5 kHz, not on this file's bands at
 * 400 and 1500, and they come from two different listening criteria. The
 * margin is wide enough that the low and mid conclusion survives any threshold
 * under a thousand, which is well above every filtered figure published.
 */
const ECHO_LIMIT = 1.4043;

/** The longest room on offer, plus room for it to finish. */
export const MOST_DECAY = LONGEST_TAIL;

/**
 * How far each of those may be moved, which is where a plugin's knob ends.
 *
 * Here rather than in the plugin because two things now need it: the plugin,
 * to lay out a slider, and the sketchpad, which stores an insert's settings
 * and has to put a loaded file's numbers back inside the range the processor
 * expects. Two tables would be two tables to keep in step, and the day they
 * drift is the day a saved sketch loads as a different sound.
 */
export const VERB_LIMITS = {
  preDelay: [0, 200],
  decay: [0.2, MOST_DECAY],
  size: [4, 60],
  bass: [0.5, 2],
  damping: [0.2, 1],
  early: [0, 0.8],
  lowCut: [20, 800],
  highCut: [1500, 20000],
  spread: [0, 1],
  tension: [0, 1],
  shimmer: [0, MOST_SHIMMER],
  mix: [0, 1],
};
const CACHE_SECONDS = MOST_DECAY * 1.1 + 0.5;

/**
 * The noise every space is made from, split once and kept.
 *
 * Every space is the same noise under three envelopes - the filtering that
 * splits it depends on neither the decay nor the damping, only on where the
 * bands are read. Doing it per room meant biquads a sample a channel, which
 * came to a sixth of a second to build an eight second hall: a knob you could
 * turn and then wait for. Split once, building a space is a multiply and an
 * add.
 *
 * It also means a space is the same space every time it is asked for, on
 * every machine, which is what a shared daily needs.
 *
 * The middle band is a band-pass and not what is left over after the other
 * two. Subtraction looks exact - the three sum back to the original by
 * construction - and is not a split at all: measured, `white - low - high`
 * put 73% of its energy above 3 kHz, because a steep high-pass has phase
 * shift up there and subtracting it does not cancel. A ladder of lowpasses
 * sums exactly too and separates no better: its top band reads 31% in the mid
 * band. See BAND_EDGES for the slope, which is the other half of this.
 */
const splits = new Map();

/**
 * One reflection, split into the same three bands the wash is split into.
 *
 * A reflection is a copy of the sound, so as a response it is an impulse -
 * and an impulse has every frequency in it at once, which is the problem.
 * Added to the room broadband, a reflection puts energy into all three bands
 * at a level set by the mid band's decay, and then every band's decay reads
 * wrong: measured at an early share of 0.8, a room asked for 1.8 seconds read
 * 1.46 in the low band and 1.49 in the mid, because the Schroeder integration
 * was fitting a line to a tail with a broadband spike sitting on the front of
 * it. That fault is older than the image sources; it is in here because
 * placing the reflections properly means there are more of them, and the
 * spike got bigger.
 *
 * It is also wrong as physics, which is the better reason. A wall absorbs the
 * top before it absorbs the bottom - that is what the damping knob is - so a
 * reflection off one comes back darker than it went out, and the second
 * reflection darker again. Broadband taps cannot do that at all.
 *
 * So each reflection is added as these three kernels, each at its own band's
 * level, and the same crossovers that split the noise split this - the same
 * `stack`, the same edges, the same pole count - so a reflection and the wash
 * are made of the same three bands and not of two different ideas about where
 * the bands are.
 *
 * The kernels are a unit impulse through each crossover, kept until they have
 * run down to a millionth of their peak. The long one is the low band, whose
 * crossover is the lowest and therefore the slowest to settle.
 */
const kernels = new Map();

function bandKernels(rate) {
  const held = kernels.get(rate);
  if (held) return held;

  const stack = (kind, hz) => Array.from({ length: CROSSOVER_POLES },
    () => setBiquad(makeBiquad(), kind, hz, rate));
  const chains = {
    low: [stack('lowpass', BAND_EDGES[0])],
    mid: [stack('highpass', BAND_EDGES[0]), stack('lowpass', BAND_EDGES[1])],
    high: [stack('highpass', BAND_EDGES[1])],
  };

  const most = Math.ceil(rate * 0.05);
  const built = {};
  for (const [band, stages] of Object.entries(chains)) {
    const run = new Float64Array(most);
    for (let i = 0; i < most; i += 1) {
      let x = i === 0 ? 1 : 0;
      for (const chain of stages) for (const stage of chain) x = runBiquad(stage, x);
      run[i] = x;
    }
    let peak = 0;
    for (const v of run) peak = Math.max(peak, Math.abs(v));
    let until = most;
    while (until > 1 && Math.abs(run[until - 1]) < peak * 1e-6) until -= 1;
    built[band] = run.slice(0, until);
  }

  kernels.set(rate, built);
  return built;
}

function noiseBands(rate) {
  const held = splits.get(rate);
  if (held) return held;

  const length = Math.ceil(rate * CACHE_SECONDS);
  const noise = mulberry32(0x5eed1e);
  const bands = { low: [], mid: [], high: [], length };
  const stack = (kind, hz) => Array.from({ length: CROSSOVER_POLES },
    () => setBiquad(makeBiquad(), kind, hz, rate));

  for (let c = 0; c < 2; c += 1) {
    const low = new Float32Array(length);
    const mid = new Float32Array(length);
    const high = new Float32Array(length);

    const lows = stack('lowpass', BAND_EDGES[0]);
    const midLows = stack('highpass', BAND_EDGES[0]);
    const midHighs = stack('lowpass', BAND_EDGES[1]);
    const highs = stack('highpass', BAND_EDGES[1]);

    for (let i = 0; i < length; i += 1) {
      const white = noise() * 2 - 1;
      let l = white;
      let m = white;
      let h = white;
      for (const stage of lows) l = runBiquad(stage, l);
      for (const stage of midLows) m = runBiquad(stage, m);
      for (const stage of midHighs) m = runBiquad(stage, m);
      for (const stage of highs) h = runBiquad(stage, h);
      low[i] = l;
      mid[i] = m;
      high[i] = h;
    }

    bands.low.push(low);
    bands.mid.push(mid);
    bands.high.push(high);
  }

  splits.set(rate, bands);
  return bands;
}

/**
 * How a plate scatters a sound across the audio band, and why that is the
 * whole of what makes it a plate rather than a short bright room.
 *
 * A plate is a steel sheet about half a millimetre thick, and what travels
 * across it is a bending wave rather than a pressure wave. Bending waves are
 * dispersive: group velocity goes as the square root of frequency, so the top
 * of a transient crosses the plate and arrives while the bottom of it is
 * still on the way. That is the "whip" on the front of every plate record
 * ever made, and no amount of filtering a noise tail will produce it.
 *
 * A cascade of first-order allpasses does the same thing to a signal. One
 * stage, y[n] = a·x[n] + x[n-1] - a·y[n-1], has a group delay of (1-a)/(1+a)
 * samples at DC and (1+a)/(1-a) at Nyquist - so at a = -0.6 the bottom is
 * held back four samples and the top a quarter of one, and N of them in
 * series multiply both. Measured, at 48 kHz: see PER_STAGE below.
 */
const DISPERSE_A = -0.6;

/**
 * How much further back one stage holds the bottom than the top, in samples.
 *
 * (1-a)/(1+a) - (1+a)/(1-a) at a = -0.6, which is 4 - 0.25. Measured on the
 * built chirp rather than trusted: at 48 kHz the full 24 ms is 307 stages,
 * and fed a single sample that cascade peaks at 3.94 ms in the high band and
 * 26.38 ms in the low - 22.44 ms apart, against the 23.98 the arithmetic asks
 * for. In the plate itself, which is a tail rather than one sample, the low
 * band's centre of energy goes from 10.6 ms behind the high band's at no
 * spread to 19.0 ms at full spread - the crossfade below gives a little of
 * that back, and the join itself measures 0.71 of the local noise either side
 * of it, which is to say there is no join.
 */
const PER_STAGE = (1 - DISPERSE_A) / (1 + DISPERSE_A) - (1 + DISPERSE_A) / (1 - DISPERSE_A);

/**
 * How long a gate takes to shut, in seconds.
 *
 * Fixed rather than a knob. What a gated reverb is recognised by is the cut,
 * not how the cut is shaped, and the RMX16 - which is the record every gated
 * snare is measured against - has a Decay control for the length and nothing
 * for the shape. Thirty milliseconds is slow enough not to click and fast
 * enough to be the effect.
 */
const GATE_CLOSE = 0.03;

/** The most dispersion the knob can ask for, in milliseconds. */
const MOST_SPREAD = 24;

/**
 * The cascade, over the onset, crossfaded back into the tail behind it.
 *
 * Over the onset and not the whole tail, and the reason is not that the two
 * are the same. Measured, they are not: a plate dispersed end to end reads up
 * to 1.07 dB away from this one in the low band, because the cascade holds
 * low-frequency energy back and over a decaying tail that moves the whole
 * decay curve. What it is, is that there is no "real" plate here being
 * approximated. Both are plates. This one costs 452 thousand multiplies and
 * the other costs 29 million for a two-second tail and four times that for an
 * eight-second one, which is most of a second of arithmetic under a knob
 * somebody is dragging.
 *
 * What the cascade is actually for is the onset. An allpass leaves a
 * magnitude spectrum exactly where it found it and moves only the phase, so
 * over stationary noise it produces noise with the same spectrum; the one
 * place it does something you can point at is where the signal is not
 * stationary, which is the few milliseconds where the tail starts from
 * nothing. That is where the whip is.
 *
 * The crossfade matters and was missing from the first version of this. Past
 * the window the raw tail resumes, and dispersed noise and raw noise are two
 * different realisations of the same statistics - so the join was a step from
 * one to the other. Equal power over the last fifth of the window.
 */
function disperse(out, from, until, stages) {
  const span = until - from;
  if (span <= 0 || stages <= 0) return;

  const raw = out.slice(from, until);
  const states = new Float64Array(stages * 2);

  for (let i = 0; i < span; i += 1) {
    let x = raw[i];
    for (let s = 0; s < stages; s += 1) {
      const last = s * 2;
      const y = DISPERSE_A * x + states[last] - DISPERSE_A * states[last + 1];
      states[last] = x;
      states[last + 1] = y;
      x = y;
    }
    out[from + i] = x;
  }

  const blend = Math.max(1, Math.round(span * 0.2));
  for (let i = 0; i < blend; i += 1) {
    const t = (i + 1) / (blend + 1);
    const back = Math.cos((t * Math.PI) / 2);
    const forth = Math.sin((t * Math.PI) / 2);
    const at = until - blend + i;
    out[at] = out[at] * back + raw[span - blend + i] * forth;
  }
}

/**
 * The send filters and the level, which every space finishes with.
 *
 * Not `finish`, which main.js already owns: the bundler flattens every module
 * into one scope and will not have two of a name. It caught this one within a
 * minute of the split.
 *
 * In the response rather than in the graph, so that the impulse is the whole
 * of the answer: what is drawn, what is convolved and what a guess is marked
 * against are then one array.
 *
 * Normalised to unit energy, which is what a convolution reverb does with the
 * responses it ships. Without it a long room is a loud room, and the A/B
 * becomes a level test again - the same false positive auto gain exists to
 * kill everywhere else in this app.
 */
function finishImpulse(channels, length, rate, { lowCut, highCut }) {
  for (const out of channels) {
    if (lowCut > 20) {
      const hp = setBiquad(makeBiquad(), 'highpass', lowCut, rate);
      for (let i = 0; i < length; i += 1) out[i] = runBiquad(hp, out[i]);
    }
    if (highCut < 20000) {
      const lp = setBiquad(makeBiquad(), 'lowpass', highCut, rate);
      for (let i = 0; i < length; i += 1) out[i] = runBiquad(lp, out[i]);
    }
  }

  let energy = 0;
  for (const out of channels) for (let i = 0; i < length; i += 1) energy += out[i] * out[i];
  const scale = energy > 0 ? 1 / Math.sqrt(energy) : 0;
  for (const out of channels) for (let i = 0; i < length; i += 1) out[i] *= scale;

  return { channels, rate, length, seconds: length / rate, preDelay: 0 };
}

/**
 * The three decay times, in seconds, as the knobs come to them.
 *
 * Capped at the longest tail the app has, which is not pedantry: the noise is
 * cached to a fixed length, so a low band asked to ring for sixteen seconds
 * did not fade out at all - it stopped dead at the end of the cache, 9.3
 * seconds in, inside a seventeen-second buffer whose last eight seconds were
 * silence being convolved. Decay 8 with a bass lift of two is reachable from
 * the knobs, so it had to be reachable from here.
 */
function decaySeconds({ decay, bass, damping }) {
  const held = (seconds) => Math.min(MOST_DECAY, Math.max(0.05, seconds));
  return {
    low: held(decay * bass),
    mid: held(decay),
    high: held(decay * damping),
  };
}

/**
 * The tail every space is made of: the cached noise, under three envelopes.
 *
 * Two channels, from two uncorrelated noises: a reverb in mono is a filter,
 * and what makes a space sound like a space is that the two ears are not
 * hearing the same thing.
 *
 * One decay time per band, because there is no such thing as one decay time
 * for a room with soft furnishings in it, and because that is how a decay
 * time is actually quoted. The knob names the mid band - which is the number
 * anybody means by "a one-point-eight second hall" - and the other two are
 * multiples of it. A hall rings longer in the bass than the mids, which this
 * could not do at all before: damping only ever shortened the top, so the
 * lows were pinned to the decay knob and every space was a room with its
 * treble turned down.
 *
 * `build` is how long the wash takes to arrive at full level. A room needs
 * one; a plate is handed zero, because being dense from the first sample is
 * most of what a plate is.
 *
 * `seconds` is handed in rather than worked out here, because not every space
 * decays: a gated burst holds at full level until it is cut, which is three
 * decay times of Infinity and an envelope that stays at one.
 */
function tail(channels, length, pre, rate, seconds, build) {
  const bands = noiseBands(rate);

  // The envelopes are exponential, so they are stepped rather than evaluated:
  // one multiply a sample instead of a call to pow. Over eight seconds that
  // is a million and a half of them, and it was most of the time it took to
  // build a hall.
  //
  // 10^(-3t/RT) is -60 dB at t = RT, which is what RT60 means.
  const steps = {
    low: 10 ** (-3 / seconds.low / rate),
    mid: 10 ** (-3 / seconds.mid / rate),
    high: 10 ** (-3 / seconds.high / rate),
  };
  const buildSamples = Math.max(1, build * rate);

  for (let c = 0; c < channels.length; c += 1) {
    const out = channels[c];
    const low = bands.low[c];
    const mid = bands.mid[c];
    const high = bands.high[c];
    const last = Math.min(length, pre + bands.length);

    let lowEnv = 1;
    let midEnv = 1;
    let highEnv = 1;

    for (let i = pre; i < last; i += 1) {
      const j = i - pre;
      const swell = build > 0 && j < buildSamples ? j / buildSamples : 1;
      out[i] = swell * (low[j] * lowEnv + mid[j] * midEnv + high[j] * highEnv);
      lowEnv *= steps.low;
      midEnv *= steps.mid;
      highEnv *= steps.high;
    }
  }

  // The rate the walls fall at. The mid band, because a reflection is a whole
  // copy of the sound rather than a part of its spectrum, and the mid band is
  // the one the decay knob names.
  return -3 / seconds.mid;
}

/** The energy in a set of channels, which is what `early` is a share of. */
function energyOf(channels, length) {
  return channels.reduce((sum, out) => {
    let band = 0;
    for (let i = 0; i < length; i += 1) band += out[i] * out[i];
    return sum + band;
  }, 0);
}

/**
 * The body every room-shaped space is built from: a wash, and walls in front
 * of it.
 *
 * Shared because a gated reverb is a room that is cut off and a reverse one
 * is a room played backwards. Neither is a different generator; they are this
 * one with something done to the envelope afterwards, which is also why both
 * are still a single impulse response and still marked the way everything
 * else here is.
 */
function roomBody(rate, settings, seconds, { tailFor }) {
  const { preDelay, size, early } = settings;

  const pre = Math.round((preDelay / 1000) * rate);
  const length = Math.max(rate * 0.05, Math.ceil(pre + rate * (tailFor * 1.08 + 0.02)));
  const channels = [new Float32Array(length), new Float32Array(length)];

  // How far apart the walls are, in time: the reflection off the far wall and
  // back is the whole of what tells you how big a place is.
  const across = (2 * size) / SPEED;

  // The diffuse tail arrives, it does not begin. In a real room the sound has
  // to bounce a few times before it is a wash, and until then what you hear
  // is the walls one at a time. Starting the tail at full level buried every
  // early reflection underneath it, which meant the size control changed the
  // numbers and nothing anybody could hear.
  //
  // How long that takes is `mixingTime`, which is a property of the room's
  // volume rather than of the distance across it. The cap is still the tail
  // itself: a burst that is over in a fifth of a second cannot spend half of
  // it arriving, whatever the walls are doing.
  const build = Math.max(0.004, Math.min(mixingTime(size), tailFor * 0.35));
  const fall = tail(channels, length, pre, rate, seconds, build);

  // The early reflections: the walls, one at a time, before the room turns to
  // a wash.
  //
  // Set by energy rather than by amplitude, and the difference is the whole
  // control. A reflection is one sample and the tail is a hundred thousand of
  // them, so a tap at the tail's own amplitude is a ten-thousandth of the
  // room and changes neither the sound nor any reading of it - the first
  // version of this had an early-late control that measured as nothing at
  // all. A real reflection towers over the diffuse tail, because it is a
  // whole copy of the sound arriving at once. So `early` is the share of the
  // room's energy that arrives as walls, and the taps are scaled to it.
  const tailEnergy = energyOf(channels, length);

  // Out to where reflections stop being separable, which is past where the
  // wash is fully arrived rather than at it - they overlap the end of the
  // ramp, because in a room they do.
  const seen = imageSources(size, mixingTime(size) * ECHO_LIMIT);

  // Each band on its own decay, which is what makes the walls absorb the way
  // the room does: at a damping of 0.2 the top band is down to a third of a
  // second where the bottom is still on nearly two, so the fourth reflection
  // is a good deal darker than the first. The decay knob sets the walls'
  // absorption and there is no second number for it to disagree with.
  const kernel = bandKernels(rate);
  const walls = [];
  for (let c = 0; c < channels.length && c < seen.length; c += 1) {
    for (const image of seen[c]) {
      const at = pre + Math.round(image.at * rate);
      if (at >= length) continue;
      walls.push({
        c,
        at,
        gains: {
          low: image.level * 10 ** ((-3 * image.at) / seconds.low),
          mid: image.level * 10 ** ((-3 * image.at) / seconds.mid),
          high: image.level * 10 ** ((-3 * image.at) / seconds.high),
        },
      });
    }
  }

  // The energy a reflection carries is the energy of its three kernels, not
  // the square of one number, because that is what is actually being added.
  const kernelEnergy = {};
  for (const [band, run] of Object.entries(kernel)) {
    let sum = 0;
    for (const v of run) sum += v * v;
    kernelEnergy[band] = sum;
  }

  const wallEnergy = walls.reduce((sum, wall) => sum
    + wall.gains.low * wall.gains.low * kernelEnergy.low
    + wall.gains.mid * wall.gains.mid * kernelEnergy.mid
    + wall.gains.high * wall.gains.high * kernelEnergy.high, 0);

  const share = Math.min(0.85, Math.max(0, early));
  if (wallEnergy > 0 && tailEnergy > 0 && share > 0) {
    const scale = Math.sqrt(((share / (1 - share)) * tailEnergy) / wallEnergy);
    for (const wall of walls) {
      const out = channels[wall.c];
      for (const [band, run] of Object.entries(kernel)) {
        const gain = wall.gains[band] * scale;
        const until = Math.min(run.length, length - wall.at);
        for (let i = 0; i < until; i += 1) out[wall.at + i] += run[i] * gain;
      }
    }
  }

  return { channels, length, pre };
}

/**
 * A room: walls at a distance, then a wash that closes over them.
 */
function roomImpulse(rate, settings) {
  const longest = decaySeconds(settings);
  const tailFor = Math.max(longest.low, longest.mid, longest.high,
    (2 * settings.size) / SPEED * 1.6);
  const { channels, length, pre } = roomBody(rate, settings, longest, { tailFor });

  const out = finishImpulse(channels, length, rate, settings);
  out.preDelay = pre / rate;
  return out;
}

/**
 * A gated room: the same walls and the same wash, not decaying, then cut.
 *
 * Not a natural thing and not pretending to be. The AMS RMX16's NonLin2
 * programs hold a reverb pattern at level for a time the Decay control sets
 * and then drop it, and that is the sound on every big snare of the eighties.
 * So the three decay times are Infinity, the envelope stays at one, and the
 * decay knob says how long before the gate shuts rather than how long the
 * room rings. The band multiples are not on its deck, because nothing decays
 * for them to be multiples of.
 *
 * What it keeps is the walls. A gated reverb is a gated *room*, and the
 * reflections arriving one at a time under a burst that does not fade is most
 * of what gives it its size.
 */
function gatedImpulse(rate, settings) {
  const hold = Math.max(0.02, Math.min(MOST_DECAY, settings.decay));
  const held = { low: Infinity, mid: Infinity, high: Infinity };
  const { channels, length, pre } = roomBody(rate, settings, held,
    { tailFor: hold + GATE_CLOSE });

  const shuts = pre + Math.round(hold * rate);
  const closing = Math.round(GATE_CLOSE * rate);
  for (const out of channels) {
    for (let i = shuts; i < length; i += 1) {
      const gone = i - shuts;
      // A raised cosine rather than a straight line, because a gate that
      // shuts on a corner is a click at the corner.
      out[i] *= gone < closing ? 0.5 * (1 + Math.cos((Math.PI * gone) / closing)) : 0;
    }
  }

  const out = finishImpulse(channels, length, rate, settings);
  out.preDelay = pre / rate;
  return out;
}

/**
 * The room, backwards.
 *
 * Which is what a reverse reverb has always literally been - a tape turned
 * over - and is why this is the room's own generator rather than a rising
 * envelope on fresh noise. Everything the room does happens in reverse order:
 * the top end that died first is the last thing to arrive, the wash swells
 * out of nothing, and the reflections off the walls land as a rattle just
 * before the end.
 *
 * It also ends properly by accident. The room begins with its build-up, so
 * reversed it finishes with one - a few milliseconds of fade rather than the
 * hard cut that a rising envelope on its own would leave, and a hard cut is a
 * click.
 *
 * Only the part after the pre-delay is turned over. Reversing the whole
 * buffer would put the silence at the end, which is a reverb that answers
 * before it is asked.
 */
function reverseImpulse(rate, settings) {
  const longest = decaySeconds(settings);
  const tailFor = Math.max(longest.low, longest.mid, longest.high,
    (2 * settings.size) / SPEED * 1.6);
  const { channels, length, pre } = roomBody(rate, settings, longest, { tailFor });

  for (const out of channels) {
    for (let i = pre, j = length - 1; i < j; i += 1, j -= 1) {
      const held = out[i];
      out[i] = out[j];
      out[j] = held;
    }
  }

  const out = finishImpulse(channels, length, rate, settings);
  out.preDelay = pre / rate;
  return out;
}

/**
 * A plate: no walls, no distance, dense from the first sample, and dispersive.
 *
 * Three of the four things that separate it from a room are what it does not
 * have. There are no early reflections, because a sheet of steel has no far
 * wall to come back off. There is no build-up, because the wave crosses the
 * plate and comes back in a couple of milliseconds and is a wash immediately -
 * Dattorro's word for the class is "instantaneous high-density reflections
 * with smooth exponential decay". And there is no size in metres, because the
 * dimension that matters is how much the plate scatters rather than how far
 * away anything is.
 *
 * The fourth is the one it does have, and the only one that is new DSP: the
 * highs arrive before the lows. See `disperse`.
 */
function plateImpulse(rate, settings) {
  const { preDelay, spread } = settings;

  const pre = Math.round((preDelay / 1000) * rate);
  const longest = decaySeconds(settings);
  const tailFor = Math.max(longest.low, longest.mid, longest.high);
  const length = Math.max(rate * 0.05, Math.ceil(pre + rate * (tailFor * 1.08 + 0.02)));
  const channels = [new Float32Array(length), new Float32Array(length)];

  // Nothing for the wash to wait for.
  tail(channels, length, pre, rate, longest, 0);

  const stages = Math.round((Math.min(1, Math.max(0, spread)) * MOST_SPREAD / 1000) * rate / PER_STAGE);
  if (stages > 0) {
    // Far enough past the onset to hold the whole chirp - the bottom of it is
    // held back four samples a stage - and a fifth of that again for the
    // crossfade back into the tail to happen in.
    const until = Math.min(length, pre + Math.ceil(stages * 4 * 1.25) + 64);
    for (const out of channels) disperse(out, pre, until, stages);
  }

  const out = finishImpulse(channels, length, rate, settings);
  out.preDelay = pre / rate;
  return out;
}

/**
 * A spring, and why it is the only space here that is a loop rather than a
 * shaped noise.
 *
 * A reverb tank is a helical spring with a transducer at each end, and what
 * travels along it is a torsional wave - which is dispersive, hard. The top
 * of a transient reaches the far end while the bottom is still halfway, so
 * every single traverse arrives as a chirp sweeping downwards, and then it
 * reflects and does it again. What you hear is not a wash at all: it is a
 * train of chirps, which is the "boing", and the metallic ring on top of them
 * is the dispersion rippling across the band rather than sliding smoothly.
 *
 * None of that can be done by putting an envelope on noise, which is why the
 * other four spaces could share a generator and this one cannot.
 *
 * After Valimaki, Parker and Abel: a cascade of identical *stretched*
 * allpasses, H(z) = (a + z^-K)/(1 + a z^-K), inside a feedback loop. The
 * stretch is what makes it a spring rather than a plate. An ordinary
 * first-order allpass slides its group delay once from top to bottom; a
 * stretched one wraps that K times across the band, so the chirp ripples
 * instead of sweeping, and the ripple is the metal.
 *
 * It also sets the two round trips a spring has, which is the whole of the
 * sound. At a = -0.6 a stretched stage holds the bottom back 4K samples and
 * the top 0.25K, so with a plain 20 ms line the lows come round every 40 ms
 * and the highs every 21. Measured on the built response: the bounces land
 * 17.4 ms apart at a 16 ms line, and across the first 120 ms the low band's
 * energy sits 31 ms behind the high band's.
 *
 * The stretch is 20 and that is a measured trade rather than a number from
 * the paper. A chirp of a given length can be built from many weak stages or
 * few strong ones, and the cost is all in the stages - for a 20 ms chirp:
 *
 *     K x stages    low behind high    bounces      to build
 *      5 x 48          37.3 ms         17.4 ms       21 ms
 *     10 x 24          35.0 ms         17.4 ms        9 ms
 *     20 x 12          31.1 ms         17.4 ms        5 ms
 *     40 x  6          26.7 ms         17.5 ms        4 ms
 *     80 x  3          24.2 ms         17.7 ms        3 ms
 *
 * The bounce never moves, because the chirp length is what sets it. What a
 * coarser chain costs is a few milliseconds of the sweep. Twenty is where
 * that stops being a good trade: half the work of ten for four milliseconds.
 *
 * It is still the expensive one. Three springs in two channels is six passes
 * with the chain inside each of them, which comes to 29 ms a knob move
 * against 11 to 15 for the other four spaces. Worth knowing and not worth
 * fixing: it is twice the worst of the rest, not ten times it, and the
 * picture is built on the main thread for all five of them.
 */
const SPRING_STRETCH = 20;

/**
 * The springs in the tank, as ratios of the shortest.
 *
 * Real tanks have two or three of slightly different lengths, which is what
 * stops the bounces landing on top of each other and turning into a pitch.
 * Nothing harmonic: 1.00, 1.14 and 1.29 share no small ratio.
 */
const SPRING_RATIOS = [1, 1.14, 1.29];

/** How long the plain part of the loop is, at most and least tension, in ms. */
const SPRING_BOUNCE = [26, 7];

/** The longest a tank rings. Eight seconds is not a spring, it is a hall. */
const SPRING_LONGEST = 4;

/**
 * Where a tank stops having any bottom at all.
 *
 * A spring is thin and that is not a flaw to be corrected: there is no air in
 * it and no room, only a wire, and what makes a spring recognisable on a
 * guitar is as much what is missing underneath as the boing on top.
 */
const SPRING_FLOOR = 110;

/**
 * One spring: the chain and the line, round and round.
 *
 * Stable by construction - the cascade is allpass, so unity gain at every
 * frequency, the one-pole can only lose, and the feedback is under one.
 */
function springLoop(out, from, until, { stages, delay, feedback, damp }) {
  const K = SPRING_STRETCH;
  // The rings are stored by position and then by stage, which reads better
  // and is worth nothing at all. It looked like it should be worth a lot:
  // every sample touches one slot in each stage, and stage-major those slots
  // sit K doubles apart so the chain walks a fresh cache line for each one,
  // where position-major they are side by side. Measured at fourteen stages
  // over two seconds, twenty runs each: 8.63 ms stage-major against 8.50
  // position-major. The rings are two kilobytes and they were in L1 either
  // way. Recorded so nobody spends the afternoon on it twice.
  const xs = new Float64Array(K * stages);
  const ys = new Float64Array(K * stages);
  const line = new Float64Array(delay);
  let at = 0;
  let head = 0;
  let lost = 0;

  for (let i = from; i < until; i += 1) {
    let v = out[i] + feedback * line[head];

    const ring = at * stages;
    for (let s = 0; s < stages; s += 1) {
      const slot = ring + s;
      const y = DISPERSE_A * v + xs[slot] - DISPERSE_A * ys[slot];
      xs[slot] = v;
      ys[slot] = y;
      v = y;
    }
    at += 1;
    if (at === K) at = 0;

    // What the wire loses on the way round, which takes the top off first.
    lost += (v - lost) * damp;
    line[head] = lost;
    head += 1;
    if (head === delay) head = 0;

    out[i] = v;
  }
}

/**
 * Where a spring's decay is reckoned, in Hz.
 *
 * A choice, and not a detail. A stretched allpass does not delay the whole
 * band by one amount - at a = -0.6 and K = 20 it holds a frequency back
 * anywhere between 5 and 80 samples a stage depending where it falls in the
 * ripple - so there is no such thing as *the* round trip, and the loop's
 * one-pole takes a different amount out at every frequency on top of that.
 * Which means there is no such thing as *the* decay time either. That is
 * what dispersion is; it is not a flaw in the model.
 *
 * So the knob is a request and the reading on the face is the truth, and this
 * is the frequency that gets them closest. Swept, as the worst ratio between
 * the decay asked for and the mid band's measured RT60 over twenty-four
 * settings - every damping against every decay, and the ends of tension and
 * spread:
 *
 *      500 Hz   worst 1.75x    0.91 - 1.75
 *      700 Hz   worst 1.85x    0.54 - 1.39
 *      900 Hz   worst 2.45x    0.41 - 1.15
 *     1095 Hz   worst 2.77x    0.36 - 1.04   <- the mid band's own centre
 *     1800 Hz   worst 3.06x    0.33 - 0.98
 *
 * Five hundred is both the closest and the right kind of wrong: every ratio
 * is at or above one, so a spring asked for two seconds never rings for three
 * and a half. The centre of the band it is read in reads best on average and
 * overshoots worst, which on a knob is the trade nobody wants.
 */
const QUOTED_AT = 500;

/**
 * How long one stretched stage holds a frequency back, in samples.
 *
 * The group delay of (a + z^-K)/(1 + a z^-K), which is K(1-a^2) over
 * (1 + 2a cos Kw + a^2). It is the cos Kw that makes a spring a spring: K
 * times across the band the delay swings between its longest and its
 * shortest, and that ripple is the metal.
 */
function stageDelay(hz, rate) {
  const w = SPRING_STRETCH * ((2 * Math.PI * hz) / rate);
  const a = DISPERSE_A;
  return (SPRING_STRETCH * (1 - a * a)) / (1 + 2 * a * Math.cos(w) + a * a);
}

/**
 * The feedback a spring needs to ring for as long as the knob says.
 *
 * Not simply 10^(-3t/RT), which is what every other space here uses, because
 * the loop has a filter in it. The one-pole that takes the top off on each
 * pass takes some of the middle off too, so the loss per round trip is the
 * feedback and the filter together - and the knob was out by anywhere from
 * 1.41x to 3.85x depending on where the other three knobs were:
 *
 *     ratio asked / got     decay 0.5   1.2   1.8   3.0
 *       damping 0.20          3.33    3.33  3.53  3.85
 *       damping 0.55          1.96    1.90  2.00  2.13
 *       damping 1.00          1.75    1.60  1.54  1.54
 *
 * No constant fixes that. What does is dividing the filter back out: a
 * one-pole y += (x - y)a has magnitude a / |1 - (1-a)e^-jw|, so asking for
 * the feedback that lands the *pair* on 60 dB over the decay is a matter of
 * evaluating it at the frequency the decay is quoted at. The mid band is
 * 400 to 3000, so that is 1095 Hz, its geometric centre.
 *
 * Held under one, because a loop at unity gain is a space that never stops.
 */
function springFeedback(trip, rings, rate, damp) {
  const w = (2 * Math.PI * QUOTED_AT) / rate;
  const pole = 1 - damp;
  const loss = damp / Math.hypot(1 - pole * Math.cos(w), pole * Math.sin(w));
  const wanted = 10 ** ((-3 * trip) / (rings * rate));
  return Math.min(0.9995, wanted / Math.max(1e-6, loss));
}

function springImpulse(rate, settings) {
  const { preDelay, decay, tension, spread, damping } = settings;

  const pre = Math.round((preDelay / 1000) * rate);
  const rings = Math.min(SPRING_LONGEST, Math.max(0.05, decay));
  const length = Math.max(rate * 0.05, Math.ceil(pre + rate * (rings * 1.08 + 0.02)));
  const channels = [new Float32Array(length), new Float32Array(length)];

  // How far the chirp smears, which is the same knob the plate dispersion
  // sits on, and for the same reason - it is the same thing happening.
  const held = Math.min(1, Math.max(0, spread));
  const chirp = Math.round(((4 + held * 26) / 1000) * rate);
  const stages = Math.max(1, Math.round(chirp / (4 * SPRING_STRETCH)));

  const tight = Math.min(1, Math.max(0, tension));
  const bounce = SPRING_BOUNCE[0] + tight * (SPRING_BOUNCE[1] - SPRING_BOUNCE[0]);

  // A one-pole, so the coefficient is the knob: at 1 nothing is lost on the
  // way round and at 0.2 the loop is down 3 dB by about 1.5 kHz.
  const damp = Math.min(1, Math.max(0.2, damping));
  const voice = new Float64Array(length);

  for (let c = 0; c < channels.length; c += 1) {
    const out = channels[c];
    for (const ratio of SPRING_RATIOS) {
      // A hair apart in the two ears. A real tank is one mono box; two of
      // them an inch different is what a stereo send to one sounds like, and
      // identical in both ears is a sound inside your head.
      const skew = ratio * (1 + (c === 0 ? -0.018 : 0.018));
      const delay = Math.max(1, Math.round(((bounce * skew) / 1000) * rate));
      // One round trip at the frequency the decay is quoted at - not at DC,
      // which is a different trip entirely. See `springTrip`.
      const trip = delay + stages * stageDelay(QUOTED_AT, rate);

      voice.fill(0);
      voice[pre] = 1 / SPRING_RATIOS.length;
      springLoop(voice, pre, length, {
        stages,
        delay,
        feedback: springFeedback(trip, rings, rate, damp),
        damp,
      });
      for (let i = pre; i < length; i += 1) out[i] += voice[i];
    }

    // The tank's own bottom end, which it has never had.
    const floor = Array.from({ length: 2 },
      () => setBiquad(makeBiquad(), 'highpass', SPRING_FLOOR, rate));
    for (let i = 0; i < length; i += 1) {
      let v = out[i];
      for (const stage of floor) v = runBiquad(stage, v);
      out[i] = v;
    }
  }

  const out = finishImpulse(channels, length, rate, settings);
  out.preDelay = pre / rate;
  return out;
}

/**
 * The space, as samples.
 *
 * An unknown space is a room rather than a throw: the sketchpad keeps a
 * string here and a file written by a later version may name a space this
 * one does not have, and the right answer to that is a reverb rather than
 * silence.
 */
export function makeImpulse(rate, params = {}) {
  const settings = { ...VERB_DEFAULTS, ...params };
  return (BUILDERS[settings.space] ?? roomImpulse)(rate, settings);
}

const BUILDERS = {
  room: roomImpulse,
  plate: plateImpulse,
  gated: gatedImpulse,
  reverse: reverseImpulse,
  spring: springImpulse,
};

/** A room, built and read in the terms a guess is marked in. */
export function roomProfile(rate, settings, times = decayTimes()) {
  const impulse = makeImpulse(rate, settings);
  return decayProfile(wetDryImpulse(impulse, settings.mix ?? VERB_DEFAULTS.mix), rate, times);
}
