// The arithmetic more than one tool needs.
//
// All of this lived in the compressor, because the compressor was the first
// thing that wanted a biquad. Thirteen modules ended up importing it from
// there - five of the six plugins among them, and lib/response.js, which is
// the bottom of the tree reaching up into the middle of it for a filter.
// None of it is a compressor's. The seam is held by tests/seams.test.js.

/** A biquad's coefficients and its two samples of memory. */
export function makeBiquad() {
  return { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0, x1: 0, x2: 0, y1: 0, y2: 0 };
}

/**
 * A Butterworth high- or low-pass, for the detector path.
 *
 * These are the sidechain filters, and they are the most useful control on a
 * compressor that nobody touches: rolling the bass off the detector stops the
 * kick from pulling the whole mix down every bar, and it is the same filter
 * every engineer reaches for.
 */
/**
 * Design one, by the usual cookbook.
 *
 * `gainDb` is only read by the three kinds that have a gain - the shelves and
 * the bell - and is ignored by the passes, which is why it is last and
 * optional. The tape mode wanted a shelf either side of its curve, and
 * building one out of a high-pass and an addition gets you something that is
 * nearly a shelf and does not quite invert, which is no good when the whole
 * point is that the second filter undoes the first.
 */
export function setBiquad(bq, kind, hz, rate, gainDb = 0) {
  const w = (2 * Math.PI * Math.min(hz, rate * 0.49)) / rate;
  const cos = Math.cos(w);
  const sin = Math.sin(w);
  const alpha = sin / (2 * Math.SQRT1_2);

  if (kind === 'highshelf' || kind === 'lowshelf' || kind === 'peaking') {
    const A = Math.pow(10, gainDb / 40);
    const root = 2 * Math.sqrt(A) * alpha;
    let b0; let b1; let b2; let a0; let a1; let a2;

    if (kind === 'peaking') {
      b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A;
      a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A;
    } else if (kind === 'highshelf') {
      b0 = A * ((A + 1) + (A - 1) * cos + root);
      b1 = -2 * A * ((A - 1) + (A + 1) * cos);
      b2 = A * ((A + 1) + (A - 1) * cos - root);
      a0 = (A + 1) - (A - 1) * cos + root;
      a1 = 2 * ((A - 1) - (A + 1) * cos);
      a2 = (A + 1) - (A - 1) * cos - root;
    } else {
      b0 = A * ((A + 1) - (A - 1) * cos + root);
      b1 = 2 * A * ((A - 1) - (A + 1) * cos);
      b2 = A * ((A + 1) - (A - 1) * cos - root);
      a0 = (A + 1) + (A - 1) * cos + root;
      a1 = -2 * ((A - 1) + (A + 1) * cos);
      a2 = (A + 1) + (A - 1) * cos - root;
    }

    bq.b0 = b0 / a0; bq.b1 = b1 / a0; bq.b2 = b2 / a0;
    bq.a1 = a1 / a0; bq.a2 = a2 / a0;
    return bq;
  }

  const a0 = 1 + alpha;

  // The all-pass, which passes every frequency at the same level and only
  // moves their phase. It is here for one job: the sum of a Linkwitz-Riley
  // pair at a corner IS a second-order all-pass at that corner, so a band
  // that has to stay in step with a crossover it does not go through can be
  // run through this instead. See the imager's split for the four decibels
  // that cost before it existed.
  //
  // At the Q this file uses throughout - one over root two - it is exactly
  // the Butterworth-Q all-pass, which is what an LR4 pair sums to.
  if (kind === 'allpass') {
    bq.b0 = (1 - alpha) / a0;
    bq.b1 = (-2 * cos) / a0;
    bq.b2 = 1;
    bq.a1 = (-2 * cos) / a0;
    bq.a2 = (1 - alpha) / a0;
    return bq;
  }

  if (kind === 'highpass') {
    bq.b0 = ((1 + cos) / 2) / a0;
    bq.b1 = -(1 + cos) / a0;
    bq.b2 = bq.b0;
  } else {
    bq.b0 = ((1 - cos) / 2) / a0;
    bq.b1 = (1 - cos) / a0;
    bq.b2 = bq.b0;
  }

  bq.a1 = (-2 * cos) / a0;
  bq.a2 = (1 - alpha) / a0;
  return bq;
}

/** One sample through a biquad, direct form I. */
export function runBiquad(bq, x) {
  const y = bq.b0 * x + bq.b1 * bq.x1 + bq.b2 * bq.x2 - bq.a1 * bq.y1 - bq.a2 * bq.y2;
  bq.x2 = bq.x1;
  bq.x1 = x;
  bq.y2 = bq.y1;
  bq.y1 = y;
  return y;
}

/** How loud a buffer is, overall. */
export function signalRms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, samples.length));
}
