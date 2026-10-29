import { shuffleCore, MONO_RANGE, MONO_SLOPES, SHUFFLE_RANGE, SHUFFLE_AT } from './shuffle.js';
import { makeBiquad, setBiquad, runBiquad } from '../../lib/dsp.js';
import { bandOf } from '../../lib/response.js';
import { readingOf, stampOf } from '../../lib/read.js';

// The stereo field, as arithmetic.
//
// What stereo width is, for somebody using an imager, is in
// src/learn/notes/stereo.js.
//
// Everything an imager does comes down to one identity: a pair of channels is
// the same information as a middle and a side, M = (L+R)/2 and S = (L-R)/2,
// and you can go back the other way whenever you like. Turning S up is what
// "wider" means. Turning it down to nothing is mono.
//
// The interesting part is doing it per band, because the low end and the top
// want opposite things. A bass spread across the field sounds big and then
// disappears the moment anybody sums it to mono, and a top end left in the
// middle sounds like a phone call. So: three bands, two crossovers you can
// move, and a width on each.
//
// Self-contained on purpose - `src/plugins/stereo/node.js` builds the audio thread out
// of this source, so nothing here may close over anything outside its body.

/** Every control, and where it starts. */
export const STEREO_DEFAULTS = {
  low: 1,          // width of each band: 1 is untouched, 0 is mono, 2 is twice
  mid: 1,
  high: 1,
  lowMid: 250,     // where the low band ends
  midHigh: 4000,   // where the top begins
  pan: 0,          // -1 hard left, +1 hard right
  monoBelow: MONO_RANGE[0], // Hz below which the side is taken away; the bottom is off
  monoSlope: 'gentle', // and how steeply it goes
  shuffle: 0,      // dB of side lifted at the bottom, the other way round
  listen: 'stereo',
};

/** How wide the widest setting goes. */
export const WIDEST = 2.5;

/**
 * How far each of those may be moved, which is where a plugin's knob ends.
 *
 * Here rather than in the plugin because two things now need it: the plugin,
 * to lay out a slider, and the sketchpad, which stores an insert's settings
 * and has to put a loaded file's numbers back inside the range the processor
 * expects. Two tables would be two tables to keep in step, and the day they
 * drift is the day a saved sketch loads as a different sound.
 */
export const STEREO_LIMITS = {
  monoBelow: MONO_RANGE,
  shuffle: SHUFFLE_RANGE,
  low: [0, WIDEST],
  mid: [0, WIDEST],
  high: [0, WIDEST],
  lowMid: [80, 800],
  midHigh: [1500, 10000],
  pan: [-1, 1],
};

/** The bands an image is read in - finer than the three it is worked in. */
export const STEREO_BANDS = [
  { id: 'sub', label: '40', low: 30, high: 90 },
  { id: 'low', label: '120', low: 90, high: 250 },
  { id: 'lowmid', label: '400', low: 250, high: 700 },
  { id: 'mid', label: '1k', low: 700, high: 2000 },
  { id: 'himid', label: '4k', low: 2000, high: 6000 },
  { id: 'high', label: '10k', low: 6000, high: 14000 },
];

/** Below this a band is too quiet to have an image at all. */
export const STEREO_FLOOR = -30;

/** And above this there is nothing left in the middle to be wide against. */
export const WIDEST_READING = 30;

/**
 * The imager, one sample at a time.
 *
 * `step(l, r)` leaves what came out on `outL` and `outR`.
 */
export function imagerCore(rate) {
  const state = {
    low: 1, mid: 1, high: 1, lowMid: 250, midHigh: 4000, pan: 0,
    monoBelow: MONO_RANGE[0], monoSlope: 'gentle', shuffle: 0, listen: 'stereo',
  };

  // The two filters that work on the side across the whole range rather than
  // inside one band - see shuffle.js. They sit after the bands come back
  // together, because that is what they are: a shape on the side signal, not
  // a ratio inside a slice of it.
  const shuffler = shuffleCore(rate, makeBiquad, setBiquad, runBiquad);

  // A Linkwitz-Riley crossover on each channel: two cascaded Butterworths,
  // which is the split that sums flat. One low-pass and one high-pass at each
  // corner, so the three bands add back up to what went in.
  //
  // With one more filter than that needs, and the reason is worth the four
  // lines. The split is a tree: the input is cut at the low corner, and the
  // upper half is cut again at the top corner. So the low band has been
  // through one crossover and the other two have been through two, and the
  // sum of an LR4 pair is not unity - it is an all-pass, which passes every
  // level and moves phase. Adding a band that has not had that phase to two
  // that have is adding things that are no longer lined up.
  //
  // Measured on the real core with every width at one, where the imager
  // should do nothing whatsoever:
  //
  //     corners           worst error
  //     250 / 4000 Hz      -0.04 dB at 400 Hz
  //     800 / 4000         -0.45 dB at 1 kHz
  //     250 / 1500         -0.31 dB at 315 Hz
  //     800 / 1500         -4.09 dB at 1 kHz
  //
  // Four decibels out of the midrange, from a tool set to do nothing. It
  // hid at the defaults, where the corners are far enough apart that the
  // all-pass has barely turned by the time the low band has gone. Anybody
  // closing the corners up to isolate a midrange band got a scoop with it,
  // and every reading taken through the tool inherited it.
  //
  // The fix is the standard one: run the low band through the same all-pass
  // the upper two picked up, so the sum is two all-passes in series on
  // everything - flat, and with the bands back in step. One biquad does it,
  // because an LR4 pair's sum IS a second-order all-pass at that corner;
  // checked against a real LP+HP pair at 1500 Hz and it matches to 0.000 dB
  // and the same phase at every frequency tried.
  const split = [0, 1].map(() => ({
    lowLP: [makeBiquad(), makeBiquad()],
    lowHP: [makeBiquad(), makeBiquad()],
    midLP: [makeBiquad(), makeBiquad()],
    midHP: [makeBiquad(), makeBiquad()],
    lowAP: makeBiquad(),
  }));

  function retune() {
    for (const side of split) {
      for (const stage of side.lowLP) setBiquad(stage, 'lowpass', state.lowMid, rate);
      for (const stage of side.lowHP) setBiquad(stage, 'highpass', state.lowMid, rate);
      for (const stage of side.midLP) setBiquad(stage, 'lowpass', state.midHigh, rate);
      for (const stage of side.midHP) setBiquad(stage, 'highpass', state.midHigh, rate);
      setBiquad(side.lowAP, 'allpass', state.midHigh, rate);
    }
  }

  retune();

  return {
    settings: state,
    outL: 0,
    outR: 0,

    set(next) {
      for (const key in next) if (key in state) state[key] = next[key];
      retune();
      shuffler.set(state);
    },

    step(l, r) {
      const input = [l, r];
      const bands = [0, 0, 0, 0, 0, 0];   // low L, low R, mid L, mid R, high L, high R

      for (let c = 0; c < 2; c += 1) {
        const side = split[c];
        let low = input[c];
        for (const stage of side.lowLP) low = runBiquad(stage, low);
        // The phase the other two bands got from the upper crossover, which
        // this one has to have as well or the three do not add back up.
        low = runBiquad(side.lowAP, low);

        let rest = input[c];
        for (const stage of side.lowHP) rest = runBiquad(stage, rest);

        let mid = rest;
        for (const stage of side.midLP) mid = runBiquad(stage, mid);

        let high = rest;
        for (const stage of side.midHP) high = runBiquad(stage, high);

        bands[c] = low;
        bands[2 + c] = mid;
        bands[4 + c] = high;
      }

      const widths = [state.low, state.mid, state.high];
      let middles = 0;
      let sides = 0;
      for (let b = 0; b < 3; b += 1) {
        const bl = bands[b * 2];
        const br = bands[b * 2 + 1];
        // The whole of it: a pair is a middle and a side, and width is what
        // the side gets multiplied by on the way back.
        middles += (bl + br) * 0.5;
        sides += (bl - br) * 0.5 * widths[b];
      }

      // Then the two filters that shape the side across the whole range. Kept
      // in the middle-and-side form until after them, because that is what
      // they act on - decoding first and re-encoding would be the same
      // arithmetic with two more roundings in it.
      if (!shuffler.resting) {
        shuffler.step(middles, sides);
        middles = shuffler.mid;
        sides = shuffler.side;
      }

      let left = middles + sides;
      let right = middles - sides;

      if (state.listen === 'mono') {
        const summed = (left + right) * 0.5;
        this.outL = summed;
        this.outR = summed;
        return;
      }

      if (state.listen === 'side') {
        const difference = (left - right) * 0.5;
        this.outL = difference;
        this.outR = difference;
        return;
      }

      // Panning a stereo signal moves the field rather than placing a point,
      // which is what Web Audio's own stereo panner does with two channels in:
      // one side is folded towards the other rather than both being turned.
      const pan = state.pan;
      if (pan === 0) {
        this.outL = left;
        this.outR = right;
      } else if (pan < 0) {
        const x = (pan + 1) * Math.PI * 0.5;
        this.outL = left + right * Math.cos(x);
        this.outR = right * Math.sin(x);
      } else {
        const x = pan * Math.PI * 0.5;
        this.outL = left * Math.cos(x);
        this.outR = right + left * Math.sin(x);
      }
    },
  };
}

/* ---------- the same thing over a whole loop ---------- */

/** A stereo pair through the imager. */
export function runImager(left, right, rate, settings) {
  const core = imagerCore(rate);
  core.set(settings);

  const outL = new Float32Array(left.length);
  const outR = new Float32Array(left.length);

  for (let i = 0; i < left.length; i += 1) {
    core.step(left[i], right[i]);
    outL[i] = core.outL;
    outR[i] = core.outR;
  }

  return { left: outL, right: outR };
}

/**
 * How wide a pair of channels is, and how much of it survives a fold to mono.
 *
 * Width is the side against the middle, in decibels: nothing at all is mono,
 * zero is as much side as middle, and anything above that is a signal whose
 * two channels disagree more than they agree - which is where mono starts
 * taking things away.
 */
export function widthOf(left, right) {
  let middle = 0;
  let sides = 0;
  let both = 0;
  let onlyL = 0;
  let onlyR = 0;

  for (let i = 0; i < left.length; i += 1) {
    const m = (left[i] + right[i]) * 0.5;
    const s = (left[i] - right[i]) * 0.5;
    middle += m * m;
    sides += s * s;
    both += left[i] * right[i];
    onlyL += left[i] * left[i];
    onlyR += right[i] * right[i];
  }

  const energy = (onlyL + onlyR) / Math.max(1, left.length);
  // Clamped at both ends rather than at one. All middle and no side is mono,
  // which is the floor; all side and no middle is two channels that are
  // nothing but each other's opposite, which is as wide as wide gets - and
  // read with only a floor it came back reading as mono, which is the one
  // thing it is not.
  const width = Math.max(STEREO_FLOOR, Math.min(WIDEST_READING,
    10 * Math.log10(Math.max(sides, 1e-12) / Math.max(middle, 1e-12))));

  // What summing the two channels costs, against the most it could possibly
  // have given at these levels.
  //
  // The obvious reading - the middle against the middle and the side
  // together - is wrong, and wrong in a way that matters: a sound panned hard
  // to one side has as much side as middle, and summing it loses nothing at
  // all, because there is nothing on the other side to cancel with. Measured
  // that way, moving the pan looked like a mono problem and monoing
  // everything looked like a fix. Against the best the same two levels could
  // do, a hard pan costs nothing, identical channels cost nothing, opposite
  // ones cost everything, and unrelated ones cost three decibels - which is
  // what all four of those actually do.
  const sum = onlyL + onlyR + 2 * both;
  const most = onlyL + onlyR + 2 * Math.sqrt(Math.max(0, onlyL * onlyR));

  return {
    width,
    mono: most > 1e-12 ? 10 * Math.log10(Math.max(sum, 1e-12) / most) : 0,
    correlation: onlyL > 1e-12 && onlyR > 1e-12 ? both / Math.sqrt(onlyL * onlyR) : 1,
    energy: 10 * Math.log10(Math.max(energy, 1e-12)),
    balance: 10 * Math.log10(Math.max(onlyL, 1e-12) / Math.max(onlyR, 1e-12)),
  };
}

/** The image band by band - the reading a guess is marked against. */
export function stereoProfile(left, right, rate) {
  const whole = widthOf(left, right);
  const bands = {};

  for (const band of STEREO_BANDS) {
    bands[band.id] = widthOf(bandOf(left, rate, band), bandOf(right, rate, band));
  }

  return { whole, bands };
}

/** A pair through the imager, read in the terms it is judged in. */
export function stereoOf(left, right, rate, settings) {
  const out = runImager(left, right, rate, { ...settings, listen: 'stereo' });
  return stereoProfile(out.left, out.right, rate);
}

/**
 * How far apart two images are: the worst band, in decibels of width.
 *
 * The worst rather than the average, for the reason the EQ found first. An
 * imager works three bands out of six the reading covers, so averaging a
 * whole band's worth of error across all of them divides it by six and a mix
 * with its low end in completely the wrong place scores well. What anybody
 * means by two images matching is that they match everywhere.
 *
 * Placing counts alongside the bands, because being on the wrong side of the
 * room is not a detail either.
 */
export function stereoGap(mine, theirs) {
  const a = mine.values ?? mine;
  const b = theirs.values ?? theirs;

  let off = 0;
  let where = null;
  let detail = { wider: 0, placed: 0 };

  for (const band of STEREO_BANDS) {
    const wider = a.bands[band.id].width - b.bands[band.id].width;
    if (Math.abs(wider) > off) {
      off = Math.abs(wider);
      where = `${band.label} Hz`;
      detail = { wider, placed: 0 };
    }
  }

  const placed = a.whole.balance - b.whole.balance;
  if (Math.abs(placed) > off) {
    off = Math.abs(placed);
    // Null, and it means something: the whole image is in the wrong place
    // rather than one band being the wrong width. Every other kind of reading
    // here uses null for "no single address", and this is that.
    where = null;
    detail = { wider: 0, placed };
  }

  return { off, where, detail };
}

export const stereoDistance = (mine, theirs) => stereoGap(mine, theirs).off;

/** What a stereo image is indexed by: the six bands, in order. */
export const STEREO_AXIS = { kind: 'bands', ids: STEREO_BANDS.map((band) => band.id) };

/** An image, in an envelope. */
export function stereoReading(left, right, rate, settings, { source = null } = {}) {
  return readingOf({
    tool: 'panning',
    kind: 'image',
    of: { state: stampOf(settings), source, axis: STEREO_AXIS },
    values: stereoOf(left, right, rate, settings),
  });
}
