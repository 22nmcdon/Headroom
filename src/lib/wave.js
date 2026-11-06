// A recording, as something that can be drawn.
//
// A take is a million samples and a canvas is six hundred pixels, so drawing
// one means deciding what each pixel may leave out. Every column here reports
// the lowest and the highest sample in its slice, which is the one summary
// that cannot hide a transient: a single-sample click comes out as tall as a
// sustained note at the same level. A column that averaged would swallow it,
// and a click is often exactly what somebody is squinting at the waveform to
// find.
//
// Two steps rather than one, because of what a resize costs. Summarising ten
// minutes of audio takes about 45 ms - measured, mono at 48 kHz - which is one
// dropped frame if it happens when the take arrives and a stutter if it
// happens on every frame of a drag. So a take is summarised once, wide, and
// the drawing is cut down from that summary.

/**
 * How many columns a take is summarised into, once.
 *
 * (Named for the wave rather than for peaks because `align/pair.js` already
 * has a `peaksOf`, about where a comb filter adds up - a different thing in
 * a flat namespace. The artifact build refuses two modules declaring the
 * same top-level name, which is how that was found.)
 *
 * Wider than any canvas it will be drawn on, so that cutting down is always
 * cutting down and never inventing. A desktop panel is about 1000 px across
 * and a device with two physical pixels to the CSS pixel wants twice that.
 */
export const WAVE_COLUMNS = 2048;

/**
 * The lowest and highest sample in each of `columns` slices.
 *
 * Returned flat - `[lo, hi, lo, hi, …]` - because this is read in a drawing
 * loop and an array of pairs is an allocation per column.
 *
 * Every channel is folded into one envelope. A take that is loud in one ear
 * only is a loud take, and a picture drawn from channel zero would call it
 * quiet.
 */
export function waveOf(channels, columns) {
  const count = Math.floor(columns);
  if (!Array.isArray(channels) || !channels.length || !(count > 0)) return new Float32Array(0);

  const frames = Math.min(...channels.map((channel) => channel?.length ?? 0));
  if (!(frames > 0)) return new Float32Array(0);

  const out = new Float32Array(count * 2);

  for (let c = 0; c < count; c += 1) {
    // Proportional, and at least one sample wide. A fixed slice width leaves
    // the tail of a short take as empty columns, which is a waveform with
    // gaps in it - the case a half-second recording on a wide canvas hits
    // every time.
    const from = Math.floor((c * frames) / count);
    const to = Math.max(from + 1, Math.floor(((c + 1) * frames) / count));

    let lo = Infinity;
    let hi = -Infinity;
    for (const channel of channels) {
      for (let i = from; i < to && i < channel.length; i += 1) {
        const v = channel[i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }

    out[c * 2] = Number.isFinite(lo) ? lo : 0;
    out[c * 2 + 1] = Number.isFinite(hi) ? hi : 0;
  }

  return out;
}

/**
 * A summary, cut down to fewer columns.
 *
 * The extremes carry: the high of a wide column is the highest of the narrow
 * ones inside it, so the click that survived the first pass survives this one
 * too. Asking for more columns than the summary holds returns what it holds
 * rather than interpolating, because there is no more detail in it and a
 * waveform drawn from invented samples is a drawing of nothing.
 */
export function rescaleWave(peaks, columns) {
  const had = Math.floor(peaks.length / 2);
  const count = Math.min(Math.floor(columns), had);
  if (count > 0 && count === had) return peaks;
  // Never more than it holds, and then the same cut by the extremes.
  return spreadWave(peaks, count);
}

/**
 * A summary across exactly as many columns as are asked for.
 *
 * The counterpart of `rescaleWave`, and deliberately a second function rather
 * than a flag on the first, because the two answer opposite questions about
 * the same data.
 *
 * `rescaleWave` refuses to hand back more columns than it holds. That is
 * right for a stored take: it has all the detail it will ever have, and
 * stretching it would draw samples nobody recorded.
 *
 * A take still being made is the other case. The blocks arrive 375 a second
 * at 48 kHz, so for the first second and a bit there are fewer of them than
 * the canvas has pixels - and drawing those few wide is not invention, it is
 * the correct picture of a take that is one second long. Which is also what
 * makes the live waveform become the stored one without jumping: both draw
 * the whole take across the whole width.
 *
 * Going down it behaves exactly like `rescaleWave`, by the extremes, because
 * a take longer than the canvas is the normal case a second in.
 */
export function spreadWave(peaks, columns) {
  const had = Math.floor(peaks.length / 2);
  const count = Math.floor(columns);
  if (!(count > 0) || !(had > 0)) return new Float32Array(0);

  const out = new Float32Array(count * 2);

  for (let c = 0; c < count; c += 1) {
    const from = Math.floor((c * had) / count);
    const to = Math.max(from + 1, Math.floor(((c + 1) * had) / count));

    let lo = Infinity;
    let hi = -Infinity;
    for (let i = from; i < to && i < had; i += 1) {
      if (peaks[i * 2] < lo) lo = peaks[i * 2];
      if (peaks[i * 2 + 1] > hi) hi = peaks[i * 2 + 1];
    }

    out[c * 2] = Number.isFinite(lo) ? lo : 0;
    out[c * 2 + 1] = Number.isFinite(hi) ? hi : 0;
  }

  return out;
}
