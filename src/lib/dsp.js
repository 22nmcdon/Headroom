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
export function setBiquad(bq, kind, hz, rate) {
  const w = (2 * Math.PI * Math.min(hz, rate * 0.49)) / rate;
  const cos = Math.cos(w);
  const sin = Math.sin(w);
  const alpha = sin / (2 * Math.SQRT1_2);
  const a0 = 1 + alpha;

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
