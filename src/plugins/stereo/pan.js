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
 * Three answers to "where does it sit", which are not the same operation.
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
  { id: 'rotate', label: 'Rotate', said: 'the whole field turned' },
];

/**
 * The third one, which is the only one of the three that is a turn.
 *
 * Rotation multiplies the pair by an orthonormal matrix, so it cannot change
 * how much total energy there is - it can only move it around. That makes it
 * a genuinely different operation from the other two rather than a third
 * flavour of the same one, and the measurement says so plainly.
 *
 * On a mono source, rotation and balance place it identically and differ only
 * in level:
 *
 *     mono source        width    balance   energy
 *     untouched         -345 dB    0.00     -1.76
 *     balance 0.5         -7.66   -7.66     +0.56
 *     rotate 22.5 deg     -7.66   -7.66     -1.76
 *
 * Same place, same width, 2.3 dB apart. Balance gets louder as it folds one
 * channel into the other; rotation cannot, by construction.
 *
 * On a stereo source they part company completely, and in opposite
 * directions:
 *
 *     stereo source      width    balance   energy   correlation
 *     untouched          -4.42     0.06     -0.42       0.47
 *     balance 0.5        -6.40    -6.33     +0.82       0.80
 *     rotate 22.5 deg    -3.04    -2.95     -0.42       0.36
 *
 * Balance narrows the field and makes the two channels more alike, because
 * folding one into the other is a move towards mono. Rotation widens it and
 * makes them less alike, because it turns mid into side as it goes.
 *
 * That is the whole of what rotation is, and it is clearest at the end of its
 * travel. At 45 degrees the matrix sends the side to one speaker and the mid
 * to the other - L = sqrt(2) S and R = sqrt(2) M exactly - so the output's
 * balance is the input's width and the output's width is the input's balance.
 * Measured on a stereo source reading -4.42 width and 0.06 balance, a 45
 * degree rotation reads -0.06 width and -4.42 balance. The two readings have
 * swapped, which is a thing to be able to hear once and never forget.
 */
export const ROTATE_RANGE = [-45, 45];

/**
 * How lopsided the width is, which is the one thing a pan cannot express.
 *
 * Every placement here moves the centre. Asymmetry moves the sides and leaves
 * the centre exactly where it was: L = M + aS and R = M - bS with a and b
 * pulled apart, so a mono source, which has no S, does not move at all.
 * Measured, which is the point:
 *
 *     mono source       width    balance
 *     untouched        -345 dB    0.00
 *     asymmetry 0.5    -345       0.00
 *     asymmetry 1.0    -345       0.00
 *
 * Nothing, to the last bit. Where a pan at either extreme would have shut one
 * channel, this does not know the source is there. On a stereo source it does
 * the thing it is for:
 *
 *     stereo source     width    balance   energy
 *     untouched         -4.42     0.06     -0.42
 *     asymmetry 0.5     -4.81     2.26     -0.13
 *     asymmetry 1.0     -5.79     3.92     +0.63
 *
 * At the end of its travel one channel is pure middle and the other carries
 * all the side, which is a field whose left half is wide and whose right half
 * is a point.
 *
 * This is what a stereo recording arrives with when the two microphones were
 * not matched or not placed evenly, and there is nothing else in this folder
 * that can either make it or take it away.
 *
 * Neither this nor the turn is an exercise, and that was measured rather than
 * decided. The question is whether a balance pan can reach the same reading,
 * because if it can then the three are one control wearing three names. Swept
 * over the whole of every other control's travel, how close the wrong control
 * gets:
 *
 *     source width   lean target: pan / turn   turn target: pan / lean
 *        -14.0 dB        0.40 / 0.25              1.07 / 9.73
 *         -9.1           0.84 / 0.72              2.14 / 5.86
 *         -6.0           1.32 / 1.41              3.30 / 3.59
 *         -4.4           1.52 / 1.96              3.32 / 2.54
 *         -1.9           1.62 / 3.67              1.58 / 1.07
 *          0.0           1.52 / 6.96              0.33 / 0.42
 *
 * The right control nulls its own target exactly, at every width. The wrong
 * one never does - but against the match tolerances, which are 2.4 decibels
 * easy, 1.6 medium and 1.0 hard, a balance pan lands inside the medium one
 * everywhere in that table. So the reading does see these controls, and a
 * round asking for a lean could still be solved with the pan knob. They go on
 * the face and not in the exercise generator.
 *
 * The trend is the explanation rather than a nuisance: a lean only moves
 * side, so a source with little side gives it little to move, and on
 * nearly-mono material a lean is a pan as far as the output is concerned.
 * Nothing read off the output can say otherwise, because at the output the
 * two really are the same thing - the field is lopsided either way, and which
 * knob made it lopsided is not a property of the sound. A mid-against-side
 * correlation was tried as the reading that would name it and does not
 * separate them either: a lean of 1.0 reads -0.51 where a balance pan of 0.3
 * reads -0.47.
 */
export const ASYMMETRY_RANGE = [-1, 1];

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
export function panMatrix(mode, law, { pan = 0, panL = -1, panR = 1, rotate = 0 } = {}) {
  if (mode === 'rotate') {
    // An orthonormal turn of the pair, which is why it has no law: a law is a
    // choice about what the centre costs, and this one costs nothing at any
    // angle because the matrix cannot change the total.
    const turn = (Math.max(ROTATE_RANGE[0], Math.min(ROTATE_RANGE[1], rotate)) * Math.PI) / 180;
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    return { ll: cos, lr: sin, rl: -sin, rr: cos };
  }

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

/**
 * The asymmetry matrix: unequal side gains, with the middle left alone.
 *
 * L = M + aS and R = M - bS, written out in terms of L and R so it is the
 * same four numbers as everything else here. Positive leans the width right,
 * which is the direction every other control on this face calls positive -
 * the arithmetic underneath falls out the other way round, and the sign is
 * flipped here rather than on the knob so that the face and the matrix agree
 * about which way is which.
 */
export function skewMatrix(amount = 0) {
  const k = Math.max(ASYMMETRY_RANGE[0], Math.min(ASYMMETRY_RANGE[1], amount));
  const a = 1 - k;
  const b = 1 + k;
  return {
    ll: (1 + a) / 2,
    lr: (1 - b) / 2,
    rl: (1 - a) / 2,
    rr: (1 + b) / 2,
  };
}

/**
 * Two of these matrices, as one.
 *
 * `after` is applied to what `first` produced. Matrices do not commute, so
 * the order is a decision rather than a detail: asymmetry first, then the
 * placement. Asymmetry is a property of the field - how evenly the two sides
 * of it are spread - and a placement is where that field is put. Doing it the
 * other way round would place a field and then make the placement lopsided,
 * which is not a thing anybody means.
 */
export function timesMatrix(after, first) {
  return {
    ll: after.ll * first.ll + after.rl * first.lr,
    rl: after.ll * first.rl + after.rl * first.rr,
    lr: after.lr * first.ll + after.rr * first.lr,
    rr: after.lr * first.rl + after.rr * first.rr,
  };
}

/**
 * Everything the decode does, in one table.
 *
 * The per-sample path stays a single matrix multiply however many of these
 * are turned on, which is the reason they are matrices at all rather than
 * three passes over the audio.
 */
export function placeMatrix(state) {
  // A declaration rather than an arrow on a const, because this one runs on
  // the audio thread too and `toString` of an arrow carries no name with it -
  // see the note in lib/worklet.js. The imager's worklet test caught it.
  return timesMatrix(
    panMatrix(state.panMode, state.panLaw, state),
    skewMatrix(state.asymmetry),
  );
}
