// Whether width was made or recorded.
//
// Every other reading in this folder measures how much side there is. None of
// them can say where it came from, and that turns out to be the more
// interesting question: a Haas delay, a complementary comb, a velvet-noise
// decorrelator and a pair of microphones two metres apart can all read the
// same width, the same correlation and the same fold-down loss, and three of
// them are one signal filtered twice.
//
// Coherence is the thing that tells them apart, and not in the way it is
// usually described. It is invariant to any linear time-invariant filtering -
// if one channel is any filter of the other, however wild, coherence is one at
// every frequency. So it does not separate "artificial" width from "natural";
// it separates width made by a filter that stands still from width made by
// two signals or by something that moves. Measured on this folder's own
// wideners, every static kind reads near one, the velvet-noise decorrelator
// included, and only the micro-pitch kind reads low.
//
// That is a narrower claim than the textbooks make and it is the one the
// arithmetic supports.

/**
 * How long a window the cross-spectrum is taken over, in samples.
 *
 * This number has a trap at each end and the usable range between them is
 * narrow, which is why it is measured rather than chosen.
 *
 * Too short and a delay reads as decorrelated: the two channels' windows hold
 * different material, so the estimate collapses even though the two signals
 * are perfectly predictable from each other. Too few frames and everything
 * reads as coherent: the estimate's floor for genuinely unrelated signals is
 * about one over the frame count, so a handful of frames reads two unrelated
 * noises as nearly identical.
 *
 * Measured over six seconds of material, band 300 Hz to 5 kHz, against delays
 * of one, twelve and forty milliseconds - forty being the longest the widener
 * offers - and against two unrelated noises:
 *
 *     window    ms   frames    1 ms   12 ms   40 ms   unrelated
 *       2048    43     280    0.993   0.349   0.004     0.0040
 *       4096    85     139    0.998   0.772   0.052     0.0077
 *       8192   171      69    1.000   0.938   0.489     0.0152
 *      16384   341      34    1.000   0.984   0.839     0.0304
 *
 * Sixteen thousand, because it is the only one of the four that keeps the
 * longest delay on offer up at 0.84 while the floor is still 0.03. At 8192 a
 * forty-millisecond delay reads 0.489, which is indistinguishable from half
 * decorrelated and is exactly wrong: that delay is a filter, and a filter is
 * coherent.
 *
 * The research this came from suggests frames of twenty to fifty milliseconds
 * alongside Haas delays of one to forty. Those two recommendations contradict
 * each other - at 43 ms a twelve-millisecond delay reads 0.349, which would
 * have the reading calling the most common widener setting "decorrelated".
 */
export const COHERENCE_WINDOW = 16384;

/**
 * How long the probe is, in seconds, and what it is made of.
 *
 * Long enough for the window above to fit thirty-odd times, which puts the
 * floor at about 0.03. Mono, because what is being asked is what the imager
 * did - a probe with width already in it would answer a different question -
 * and with content across the band, because coherence is read per band and a
 * band with nothing in it has no opinion.
 */
export const COHERENCE_SECONDS = 6;

/**
 * Which generator the probe's noise comes from, and why it is named.
 *
 * `mulberry32`, and this is not a detail. The first version of this used the
 * classic linear congruential generator - multiplier 1103515245, modulus two
 * to the thirty-first, the one in every C textbook - and it put the floor
 * thirteen times where it belonged. Measured, the median per-bin coherence of
 * two supposedly unrelated streams:
 *
 *     generator   window   frames   median   should be
 *     LCG           1024      375   0.0213      0.0027
 *     LCG          16384       23   0.5790      0.0435
 *     mulberry      1024      375   0.0013      0.0027
 *     mulberry     16384       23   0.0338      0.0435
 *
 * An LCG of that form has lattice structure, and a sixteen-thousand-point
 * transform is long enough to resolve it: two streams from it are not
 * unrelated at all, they are related in a way only a long window can see. The
 * reading was reporting the generator rather than the signal, and it looked
 * like a bias in the estimator - the estimator is fine, checked against a
 * known transform and against theory at 0.0024 where 1/200 was expected.
 */
export const COHERENCE_NOISE = 'mulberry32';

/** Where the floor sits, given the probe and the window above. */
export const COHERENCE_FLOOR = 0.035;

/**
 * Where the line between "a filter" and "something that moves" has to be
 * drawn, and how much room there is either side of it.
 *
 * Measured as how far each widener kind reads from the same imager with the
 * widener off, swept across the controls rather than at one setting - which
 * matters, because at one setting the separation looks far better than it is:
 *
 *     delay      Haas    comb   all-pass   velvet
 *      1 ms     0.000   0.001    0.084     0.012
 *     12 ms     0.016   0.041    0.084     0.012
 *     20 ms     0.035   0.135    0.084     0.012
 *     40 ms     0.081   0.327    0.084     0.012
 *
 *     micro-pitch, by detune:  2 cents 0.635   9 cents 0.487
 *                             15 cents 0.511  25 cents 0.543
 *
 * So every static kind stays under 0.33 everywhere and the one that moves
 * stays over 0.48 everywhere, and 0.4 is the only number between them. The
 * margin is twelve times at the delay anybody actually uses and one and a half
 * times at the comb's longest, which is worth knowing before anybody sets a
 * tolerance from the twelve.
 *
 * The micro-pitch column has no trend worth reading into: two cents reads
 * further from off than twenty-five does. Whatever is behind that, the useful
 * fact is that the whole range sits well clear of the static kinds.
 */
export const COHERENCE_MOVING = 0.4;

/**
 * What it costs, because it is not free and the number decides where it may
 * be called from.
 *
 * Measured: 229 ms a reading, against 49 for the image reading beside it -
 * six seconds of audio rendered through the imager and sixty-eight transforms
 * of sixteen thousand points over it. That is fine once, when a guess is
 * submitted and marked, and far too slow to run while somebody is turning a
 * knob. Anything that wants it live would have to read it on release rather
 * than on move.
 *
 * Both re-measured when the image reading grew a seventh band: 187 and 53 on
 * that run. The 53 against 49 is the band; the 187 against 229 is the machine,
 * which is the reminder that the number worth keeping here is the ratio. Three
 * to four times the image reading, either way round.
 */
export const COHERENCE_COST_MS = 229;

/**
 * The probe: mono, with something everywhere.
 *
 * A tone stack so there is a reason for each band to have energy, plus
 * filtered noise so the bands between the tones are not empty, plus a slow
 * swell so a frame is not identical to the frame before it.
 */
export function coherenceProbe(rate, random) {
  const n = Math.round(COHERENCE_SECONDS * rate);
  const x = new Float32Array(n);
  let lp = 0;
  for (let i = 0; i < n; i += 1) {
    const at = i / rate;
    lp += ((random() * 2 - 1) - lp) * 0.3;
    const swell = 0.7 + 0.3 * Math.sin(2 * Math.PI * 0.37 * at);
    x[i] = (Math.sin(2 * Math.PI * 110 * at) * 0.35
      + Math.sin(2 * Math.PI * 440 * at) * 0.25
      + Math.sin(2 * Math.PI * 1800 * at) * 0.18
      + Math.sin(2 * Math.PI * 6000 * at) * 0.1
      + lp * 0.7) * swell * 0.3;
  }
  return x;
}

/**
 * Coherence per band, from a pair.
 *
 * Averaged over the bins inside each band as well as over time, weighted by
 * how much energy each bin holds. One bin on its own is hopeless however many
 * frames it is averaged over - its cross-spectrum is a sum of random phasors
 * and the variance does not come down - which is what a first attempt using
 * one Goertzel per band found out the hard way: two unrelated noises read
 * 0.02, then 0.46, then 0.07 as the frame count went 5, 12, 25.
 */
export function coherenceOf(left, right, rate, bands, fft) {
  const size = COHERENCE_WINDOW;
  const hop = size / 2;

  const edges = bands.map((band) => ({
    id: band.id,
    from: Math.max(1, Math.floor((band.low / rate) * size)),
    to: Math.min(size / 2 - 1, Math.ceil((band.high / rate) * size)),
  }));

  const cross = edges.map((band) => ({
    re: new Float64Array(band.to - band.from + 1),
    im: new Float64Array(band.to - band.from + 1),
    ll: new Float64Array(band.to - band.from + 1),
    rr: new Float64Array(band.to - band.from + 1),
  }));

  let frames = 0;
  for (let f = 0; f + size <= left.length; f += hop) {
    const lr = new Float64Array(size);
    const li = new Float64Array(size);
    const rr = new Float64Array(size);
    const ri = new Float64Array(size);
    for (let i = 0; i < size; i += 1) {
      const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
      lr[i] = win * left[f + i];
      rr[i] = win * right[f + i];
    }
    fft(lr, li);
    fft(rr, ri);

    for (let b = 0; b < edges.length; b += 1) {
      const band = edges[b];
      const got = cross[b];
      for (let k = band.from; k <= band.to; k += 1) {
        const j = k - band.from;
        got.re[j] += lr[k] * rr[k] + li[k] * ri[k];
        got.im[j] += li[k] * rr[k] - lr[k] * ri[k];
        got.ll[j] += lr[k] * lr[k] + li[k] * li[k];
        got.rr[j] += rr[k] * rr[k] + ri[k] * ri[k];
      }
    }
    frames += 1;
  }

  const out = {};
  for (let b = 0; b < edges.length; b += 1) {
    const got = cross[b];
    let sum = 0;
    let weight = 0;
    for (let j = 0; j < got.re.length; j += 1) {
      const y2 = (got.re[j] * got.re[j] + got.im[j] * got.im[j])
        / (got.ll[j] * got.rr[j] + 1e-30);
      // A bin with nothing in it has no opinion about how coherent it is.
      const w = got.ll[j] + got.rr[j];
      sum += y2 * w;
      weight += w;
    }
    out[edges[b].id] = weight > 0 ? sum / weight : 1;
  }
  return { bands: out, frames };
}

/**
 * How far apart two imagers are in where their width came from.
 *
 * The worst band rather than the average of them, as the image reading does,
 * because one band made the wrong way is the thing to go and listen to.
 *
 * In coherence rather than in decibels, which means the numbers are small and
 * the tolerance has to be too - and the ear agrees with that at one end only.
 * Listeners hear a small loss of coherence from perfectly coherent very
 * easily and can barely tell one already-wide thing from another, so a
 * difference near one matters far more than the same difference near zero.
 * `where` names the band, and `detail.mine` says which way round it is.
 */
export function coherenceGap(mine, theirs) {
  const a = mine.values.bands;
  const b = theirs.values.bands;

  let worst = 0;
  let at = null;
  let sum = 0;
  let count = 0;
  for (const id of Object.keys(a)) {
    if (b[id] === undefined) continue;
    const off = Math.abs(a[id] - b[id]);
    sum += off * off;
    count += 1;
    if (off > worst) { worst = off; at = id; }
  }

  return {
    off: worst,
    where: at ? `the ${at} band` : 'nowhere',
    detail: {
      rms: Math.sqrt(sum / Math.max(1, count)),
      mine: at ? a[at] : null,
      theirs: at ? b[at] : null,
    },
  };
}
