// What a piece of audio is actually made of, averaged over its whole length.
//
// Auto gain needs this. How much louder a curve makes something depends on
// where that something has its energy: a low shelf on a bass-heavy loop is a
// large move and the same shelf on a hi-hat is nearly nothing. Assuming the
// energy is spread evenly across the octaves - which is the easy thing to do,
// and what this did first - leaves auto gain out by as much as five decibels
// on the material this app actually plays.

import { fft } from '../../lib/fft.js';

const SIZE = 4096;

/**
 * The power in each of `frequencies`, averaged over the whole buffer.
 *
 * Bands rather than bins: each frequency takes everything between it and its
 * neighbours, which is what makes the answer steady on noise-like material
 * instead of swinging ten decibels from one window to the next.
 */
export function averageSpectrum(buffer, frequencies) {
  const rate = buffer.sampleRate;
  const samples = buffer.getChannelData(0);
  const window = new Float64Array(SIZE);
  for (let i = 0; i < SIZE; i += 1) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / SIZE);

  const power = new Float64Array(SIZE / 2);
  let frames = 0;

  for (let at = 0; at + SIZE <= samples.length; at += SIZE / 2) {
    const re = new Float64Array(SIZE);
    const im = new Float64Array(SIZE);
    for (let i = 0; i < SIZE; i += 1) re[i] = samples[at + i] * window[i];

    fft(re, im);
    for (let i = 0; i < SIZE / 2; i += 1) power[i] += re[i] * re[i] + im[i] * im[i];
    frames += 1;
  }

  if (!frames) return frequencies.map(() => 1);
  for (let i = 0; i < power.length; i += 1) power[i] /= frames;

  // Each asked-for frequency takes the bins nearer to it than to its
  // neighbours, on the log scale the whole display works in.
  const edges = frequencies.map((hz, i) => {
    const below = i === 0 ? hz * hz / frequencies[1] : frequencies[i - 1];
    const above = i === frequencies.length - 1 ? hz * hz / frequencies[i - 1] : frequencies[i + 1];
    return [Math.sqrt(hz * below), Math.sqrt(hz * above)];
  });

  const perBin = rate / SIZE;
  return edges.map(([low, high]) => {
    const from = Math.max(0, Math.round(low / perBin));
    const to = Math.min(power.length - 1, Math.round(high / perBin));
    let sum = 0;
    for (let i = from; i <= to; i += 1) sum += power[i];
    // Never zero: a band with nothing in it should count for little, not
    // remove itself from the average and take its frequency with it.
    return Math.max(sum, 1e-12);
  });
}
