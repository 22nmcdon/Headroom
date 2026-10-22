// Audio, as a file.
//
// A sketch leaves here as MIDI, which is the right shape for parts somebody
// is going to re-voice in a DAW - and the wrong shape for anything that is
// not notes. A sound you made with the room and the saturator on it is not
// notes; it is a recording, and the only way it arrives sounding the way it
// did here is as audio.
//
// So: RIFF/WAVE, linear PCM, which every program made since 1991 can open.
// No compression and no metadata beyond the sample rate - a stem is a thing
// you drop onto a track, not a thing you archive.
//
// Twenty-four bit by default. Sixteen is what a CD is, and a stem is not a
// CD: it is an intermediate, it will be summed with others and processed
// again, and the fourteen decibels of extra floor cost nothing but a third
// more disk for something that is about to be deleted.

/** What the format field says for plain PCM. */
const PCM = 1;

export const BITS = 24;

/** A header is 44 bytes and the data begins immediately after it. */
export const HEADER = 44;

const writeAscii = (view, at, text) => {
  for (let i = 0; i < text.length; i += 1) view.setUint8(at + i, text.charCodeAt(i));
};

/**
 * One sample, clipped and rounded, as an integer of `bits` bits.
 *
 * Clipped rather than wrapped. A sample over one that wraps goes from the
 * top of the scale to the bottom, which is the loudest sound a converter can
 * make; clipping it is merely distortion.
 *
 * The scale is asymmetric on purpose: two's complement holds one more
 * negative value than positive, and scaling by the positive maximum is what
 * keeps a full-scale sine from clipping on the way down.
 */
export function quantise(value, bits = BITS) {
  const most = 2 ** (bits - 1) - 1;
  const clipped = Math.max(-1, Math.min(1, value));
  return Math.max(-most - 1, Math.min(most, Math.round(clipped * most)));
}

/**
 * Channels of floats, as a WAV file.
 *
 * `channels` is an array of equal-length Float32Arrays - the shape every
 * reading in this app already takes, and what an AudioBuffer hands over.
 * Interleaved on the way out, because that is what the format is.
 */
export function writeWav(channels, rate, { bits = BITS } = {}) {
  if (!channels?.length) throw new Error('a wav needs at least one channel');
  if (![8, 16, 24, 32].includes(bits)) throw new Error(`${bits} is not a bit depth this writes`);

  const count = channels.length;
  const frames = Math.min(...channels.map((channel) => channel.length));
  const bytes = bits / 8;
  const data = frames * count * bytes;

  const out = new ArrayBuffer(HEADER + data);
  const view = new DataView(out);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + data, true);
  writeAscii(view, 8, 'WAVE');

  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);          // the size of this chunk
  view.setUint16(20, PCM, true);
  view.setUint16(22, count, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * count * bytes, true); // bytes a second
  view.setUint16(32, count * bytes, true);        // bytes a frame
  view.setUint16(34, bits, true);

  writeAscii(view, 36, 'data');
  view.setUint32(40, data, true);

  let at = HEADER;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < count; channel += 1) {
      const sample = quantise(channels[channel][frame], bits);
      if (bits === 8) {
        view.setUint8(at, sample + 128);
      } else if (bits === 16) {
        view.setInt16(at, sample, true);
      } else if (bits === 24) {
        // No setInt24, so three bytes little-endian by hand. The sign is
        // already in the integer; masking takes the low three bytes of its
        // two's complement, which is what a 24-bit sample is.
        view.setUint8(at, sample & 0xff);
        view.setUint8(at + 1, (sample >> 8) & 0xff);
        view.setUint8(at + 2, (sample >> 16) & 0xff);
      } else {
        view.setInt32(at, sample, true);
      }
      at += bytes;
    }
  }

  return new Uint8Array(out);
}

/**
 * And back, for the tests and for anything that wants to read one.
 *
 * Deliberately only reads what this writes: a canonical 44-byte header with
 * the data immediately after it. A wav from elsewhere may carry a dozen
 * other chunks, and parsing those is a job for whatever is opening it.
 */
export function readWav(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at) => String.fromCharCode(...bytes.slice(at, at + 4));

  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  if (tag(12) !== 'fmt ' || tag(36) !== 'data') return null;

  const count = view.getUint16(22, true);
  const rate = view.getUint32(24, true);
  const bits = view.getUint16(34, true);
  const data = view.getUint32(40, true);
  const bytesPer = bits / 8;
  const frames = data / (count * bytesPer);
  const most = 2 ** (bits - 1) - 1;

  const channels = Array.from({ length: count }, () => new Float32Array(frames));

  let at = HEADER;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < count; channel += 1) {
      let sample;
      if (bits === 8) sample = view.getUint8(at) - 128;
      else if (bits === 16) sample = view.getInt16(at, true);
      else if (bits === 24) {
        const raw = view.getUint8(at) | (view.getUint8(at + 1) << 8) | (view.getUint8(at + 2) << 16);
        // Sign-extend the top bit back out of three bytes.
        sample = raw & 0x800000 ? raw - 0x1000000 : raw;
      } else sample = view.getInt32(at, true);

      channels[channel][frame] = sample / most;
      at += bytesPer;
    }
  }

  return { channels, rate, bits, frames };
}
