// Where a track's energy sits, octave by octave.
//
// The long-term average spectrum: everything the track is made of, averaged
// over the whole of it, read on the third-octave grid an engineer works on.
// It is the one picture that tells you a mix is dark, or thin, or has a
// bump at 200 Hz that nothing in it needed - the things a single pass of an
// analyser moving in real time will not sit still long enough to say.
//
// The spectrum itself is `src/eq/spectrum.js`, which already does this for
// the EQ's auto gain: windowed FFT frames, averaged in power, each asked-for
// frequency taking the bins nearer to it than to its neighbours. What is here
// is the axis to read it on, the tilt that makes it legible, and the shape of
// the comparison against a reference.

import { averageSpectrum } from '../eq/spectrum.js';
import { readingOf, stampOf } from '../read.js';

/**
 * The third-octave centres, from where a speaker starts to where hearing
 * stops.
 *
 * Third-octaves rather than octaves because this is a picture rather than a
 * question with chips under it: thirty-one points draw a curve and ten draw a
 * bar chart. The grid is the standard one, built from 1 kHz outwards so that
 * 1k, 2k, 4k and the rest land on round numbers.
 */
export const THIRDS = Array.from({ length: 29 }, (_, i) => {
  // Sixteen thirds below 1 kHz is 24.8 Hz and twelve above it is 16 kHz,
  // which is where a speaker starts and where hearing stops.
  const steps = i - 16;
  return Math.round(1000 * 2 ** (steps / 3) * 10) / 10;
});

/**
 * How much to tilt the picture, in decibels an octave.
 *
 * Music is not flat and a flat reading of it slopes away to nothing, which
 * makes the top half of the chart unreadable and the bottom half look like
 * the whole record. Three decibels an octave is what the EQ's own analyser
 * uses and what most analysers default to: a balanced mix reads roughly level
 * under it, so what stands out on screen is what actually stands out.
 */
export const TILT = 3;

const tiltAt = (hz) => TILT * Math.log2(hz / 1000);

/**
 * The spectrum of a piece of audio, in decibels, tilted and normalised.
 *
 * Normalised to its own average rather than to full scale, because the
 * question this answers is about balance and not about level - a quiet mix
 * and a loud one with the same tonality should draw the same line, and the
 * loudness reading is where level is reported.
 */
export function balanceOf(channels, rate, frequencies = THIRDS) {
  // Both channels together: a spectrum is about what is in the track, and a
  // guitar panned hard right is in the track.
  const mono = { sampleRate: rate, getChannelData: () => summed(channels) };
  const power = averageSpectrum(mono, frequencies);

  const raw = power.map((p, i) => 10 * Math.log10(Math.max(p, 1e-20)) + tiltAt(frequencies[i]));
  const mean = raw.reduce((sum, value) => sum + value, 0) / raw.length;

  return Object.fromEntries(frequencies.map((hz, i) => [hz, raw[i] - mean]));
}

/** Every channel added together, which is what a spectrum is taken of. */
function summed(channels) {
  if (channels.length === 1) return channels[0];

  const length = Math.min(...channels.map((channel) => channel.length));
  const out = new Float32Array(length);
  for (const channel of channels) {
    for (let i = 0; i < length; i += 1) out[i] += channel[i] / channels.length;
  }
  return out;
}

/** The spectrum of a piece of audio, in its envelope. */
export function balanceReading(channels, rate, { source = null, frequencies = THIRDS } = {}) {
  const bands = balanceOf(channels, rate, frequencies);
  const values = Object.values(bands);

  return readingOf({
    tool: 'analysis',
    kind: 'balance',
    of: {
      state: stampOf({ channels: channels.length, rate }),
      source,
      axis: { kind: 'thirds', tilt: TILT, ids: frequencies },
    },
    values: {
      bands,
      // The ends of it, which is the summary anybody reads first: how much
      // more there is below 200 Hz than above 2 kHz.
      low: average(bands, frequencies.filter((hz) => hz < 200)),
      mid: average(bands, frequencies.filter((hz) => hz >= 200 && hz < 2000)),
      high: average(bands, frequencies.filter((hz) => hz >= 2000)),
    },
  });
}

const average = (bands, frequencies) =>
  frequencies.reduce((sum, hz) => sum + bands[hz], 0) / Math.max(1, frequencies.length);

/**
 * How far apart two spectra are: the worst third, in decibels.
 *
 * The worst rather than the average, for the reason the EQ found first.
 * Averaged across thirty-one bands, a mix whose whole low end is four
 * decibels heavy than the reference scores about half a decibel and reads as
 * a match. What anybody means by two mixes having the same balance is that
 * they have it everywhere.
 */
export function balanceGap(mine, theirs) {
  const a = mine.values ?? mine;
  const b = theirs.values ?? theirs;

  let off = 0;
  let where = null;
  let hotter = 0;

  for (const hz of Object.keys(a.bands)) {
    if (b.bands[hz] === undefined) continue;
    const apart = a.bands[hz] - b.bands[hz];
    if (Math.abs(apart) > Math.abs(off)) {
      off = apart;
      where = Number(hz) >= 1000 ? `${(Number(hz) / 1000).toFixed(1)} kHz` : `${Math.round(hz)} Hz`;
      hotter = apart;
    }
  }

  return {
    off,
    where,
    detail: {
      hotter,
      low: a.low - b.low,
      mid: a.mid - b.mid,
      high: a.high - b.high,
    },
  };
}
