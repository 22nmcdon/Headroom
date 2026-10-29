// Where a thing sits, and the two different questions that hides.
//
// Panning a mono source is placing a point: one signal, two gains, and the
// only decision is how those two gains add up in the middle. Panning a stereo
// source is not that at all - there are two signals already in two places,
// and "pan" can mean either moving the whole field or placing each side
// somewhere new. Those are different operations with different sounds and
// most desks only offer one of them.
//
// Both are here, because the difference between them is a thing to be able to
// hear and nothing else in the app teaches it.

/**
 * How the two gains add up in the middle, which is the whole of what a pan law
 * is.
 *
 * A source panned hard left goes out at full level in one channel. The same
 * source panned centre goes out at some lower level in both - and how much
 * lower is a choice, because it depends on whether the two speakers add in
 * power at your ears (in which case -3 dB keeps the loudness constant) or
 * coherently (in which case -6 does). Rooms do a bit of each, which is why
 * desks settled on -4.5 as a compromise and broadcast settled on -6.
 *
 * The number in each name is how far down the centre is. Measured below, what
 * matters for this app is that the choice shows up in mono: with a fold-down
 * of (L+R)/2, the centre and the sides do not come out level under every law.
 */
export const PAN_LAWS = [
  {
    id: 'power',
    label: '−3 dB',
    said: 'three decibels down in the middle',
    gains: (p) => [Math.cos((p * Math.PI) / 2), Math.sin((p * Math.PI) / 2)],
  },
  {
    id: 'split',
    label: '−4.5 dB',
    said: 'four and a half decibels down',
    // The geometric mean of the two either side of it, which is what makes it
    // the compromise rather than a third opinion.
    gains: (p) => [
      Math.sqrt((1 - p) * Math.cos((p * Math.PI) / 2)),
      Math.sqrt(p * Math.sin((p * Math.PI) / 2)),
    ],
  },
  {
    id: 'linear',
    label: '−6 dB',
    said: 'six decibels down',
    gains: (p) => [1 - p, p],
  },
];

/**
 * The square-root law, considered and left out.
 *
 * It is the fourth law the textbooks list, and it is three decibels down in
 * the middle like the first one above - gL = sqrt(1 - p) is 0.707 at the
 * centre exactly as cos(p pi / 2) is. What differs is the shape between the
 * ends. Measured, the two laws' left-channel gain across the field:
 *
 *     position     0     0.25    0.5    0.75     1
 *     -3 dB      1.000   0.924  0.707  0.383  0.000
 *     sqrt       1.000   0.866  0.707  0.500  0.000
 *
 * They agree at both ends and in the middle and differ in between, by 0.56 dB
 * a quarter of the way across and 2.32 the other side of centre - not the 1.3
 * I first wrote down, and not symmetric either, because the square root puts
 * more in the far channel than the cosine does and so reads wider.
 *
 * It is a real difference and it is not the one this app is trying to teach.
 * What is worth hearing here is what the centre costs, and these two cost the
 * same thing. Three laws with three different centres is a question; four
 * laws where two share an answer is a trick.
 *
 * The three that are here measure -3.01, -4.52 and -6.02 dB at the centre,
 * which is what they are called.
 */
export const SQRT_LAW_LEFT_OUT = true;

/**
 * Balance or dual pan, which are not the same operation.
 *
 * Balance is what a stereo channel on a desk does and what Web Audio's own
 * stereo panner does with two channels in: turn one side down and fold it
 * towards the other. It moves the field and, at the end of its travel, folds
 * one channel into the other entirely.
 *
 * Dual pan gives each input channel its own position. That is the only way to
 * narrow a stereo source to one part of the field - a piano across the left
 * third, say - which balance cannot express at all, because balance only ever
 * has one number.
 *
 * Measured on what balance does at its extreme, as what the surviving channel
 * gains over the input it came from, over four seconds at hard right:
 *
 *     pair                            by peak    by energy
 *     correlated                       6.02 dB    6.02 dB
 *     unrelated, white noise           6.01       3.01
 *     unrelated, two sines             5.60       3.01
 *     unrelated, low-passed noise      3.41       3.00
 *
 * Six decibels for correlated content is the figure usually quoted and it is
 * right, and it is the same by both measures. The interesting part is that for
 * unrelated content the two measures disagree and only one of them is a
 * property of the pan: the energy answer is 3.01 whatever the material, and
 * the peak answer is anywhere between 2 and 6 depending on how often the two
 * channels' peaks happen to coincide. So an engineer reading an energy meter
 * is told uncorrelated content is three decibels safer here, and the peak may
 * not agree.
 *
 * At hard right the output is L + R, so its peak cannot exceed twice the
 * louder channel's - which is 6.02 dB over that channel and more than that
 * over the other one. Measured against the surviving channel on an unrelated
 * pair, with the folded channel made louder:
 *
 *     left at the right's level   6.01 dB by peak
 *     left twice the right        9.53
 *     left four times the right  13.97
 *
 * Which is the real headroom trap, and it is not about correlation at all: it
 * is that balance folds the channel you are turning away into the one you are
 * keeping, so the louder the side being folded, the further past six decibels
 * the survivor goes. A first attempt at this table read 9.41 dB for
 * "uncorrelated" and that was this effect measured on an unequal pair and
 * labelled as correlation. The numbers above are the two things kept apart.
 */
export const PAN_MODES = [
  { id: 'balance', label: 'Balance', said: 'the field moved and folded' },
  { id: 'dual', label: 'Dual', said: 'each side placed on its own' },
];

/** One law's pair of gains, at a position from -1 (left) to +1 (right). */
export function panGains(law, position) {
  const found = PAN_LAWS.find((l) => l.id === law) ?? PAN_LAWS[0];
  const p = Math.max(0, Math.min(1, (Math.max(-1, Math.min(1, position)) + 1) / 2));
  const [left, right] = found.gains(p);
  return { left, right };
}

/**
 * The pan itself: a pair in, a pair out.
 *
 * Four multiplies and two adds, and the same four whichever mode is on - the
 * difference between balance and dual pan lives entirely in how the table of
 * gains was filled, not in what is done with it. The first version of this
 * had a branch for each mode and the two branches computed the same
 * expression with the operands written in a different order, which is a branch
 * that only looks like it is doing something.
 *
 * No state, because a pan has none: the gains change when a knob does, and
 * the imager's core works them out in its own `retune`.
 */
export function panPair(gains, l, r) {
  return {
    left: gains.ll * l + gains.rl * r,
    right: gains.lr * l + gains.rr * r,
  };
}

/**
 * The four gains a mode and its positions come to.
 *
 * One table for both modes, so the per-sample path is the same arithmetic
 * either way and the difference lives entirely in how the table is filled.
 */
export function panMatrix(mode, law, { pan = 0, panL = -1, panR = 1 } = {}) {
  if (mode === 'dual') {
    const left = panGains(law, panL);
    const right = panGains(law, panR);
    return { ll: left.left, lr: left.right, rl: right.left, rr: right.right };
  }

  // Balance, as Web Audio defines it: below centre the right channel is
  // turned down and what is taken off is added to the left, and above centre
  // the mirror of that. The law has no say here, because balance is not
  // placing a source - it is a crossfade between two channels that are
  // already placed.
  if (pan === 0) return { ll: 1, lr: 0, rl: 0, rr: 1 };
  if (pan < 0) {
    const x = (pan + 1) * Math.PI * 0.5;
    return { ll: 1, lr: 0, rl: Math.cos(x), rr: Math.sin(x) };
  }
  const x = pan * Math.PI * 0.5;
  return { ll: Math.cos(x), lr: Math.sin(x), rl: 0, rr: 1 };
}
