import { makeBiquad, setBiquad, runBiquad } from '../compressor/dsp.js';
import { LONGEST_TAIL, decayProfile, decayTimes, wetDryImpulse } from '../../lib/response.js';
import { LOOP_BEAT } from '../../core/audio.js';

// A delay, as an impulse response.
//
// What a delay is, for somebody using one, is in src/learn/notes/echo.js.
//
// The same trick the reverb plays, and for the same reason: a delay is linear,
// so everything it will ever do to anything is in what it does to one click.
// Writing it down that way means the repeats you see are the repeats you
// hear and the repeats a guess is marked against, and it means the tail lands
// exactly where the setting says rather than being retimed under a playhead.

/** Every knob, and where it starts. */
export const ECHO_DEFAULTS = {
  time: 375,         // ms between repeats
  feedback: 0.35,    // how much of each repeat goes round again
  tone: 6000,        // the low-pass inside the loop: repeats get darker
  lowCut: 120,       // the high-pass inside it: repeats get thinner
  pingPong: false,   // repeats alternating ears
  mix: 0.3,
};

/** As long as a repeat may be, and as much of it as may go round again. */
export const LONGEST_TIME = 1500;
export const SHORTEST_TIME = 20;
export const MOST_FEEDBACK = 0.8;

/**
 * How far each of those may be moved, which is where a plugin's knob ends.
 *
 * Here rather than in the plugin because two things now need it: the plugin,
 * to lay out a slider, and the sketchpad, which stores an insert's settings
 * and has to put a loaded file's numbers back inside the range the processor
 * expects. Two tables would be two tables to keep in step, and the day they
 * drift is the day a saved sketch loads as a different sound.
 */
export const ECHO_LIMITS = {
  time: [SHORTEST_TIME, LONGEST_TIME],
  feedback: [0, MOST_FEEDBACK],
  tone: [500, 20000],
  lowCut: [20, 800],
  mix: [0, 1],
};

/**
 * The note values a delay is set to, as fractions of a beat.
 *
 * Spread out on purpose. Every adjacent pair here is at least a third apart,
 * so telling one from the next is a question about the music rather than a
 * question about a stopwatch - a dotted eighth and a quarter triplet are only
 * twelve per cent apart, which is a difference you can measure and not one
 * anybody names by ear.
 */
export const DIVISIONS = [
  { id: 'quarter', label: '1/4', beats: 1 },
  { id: 'dotted8', label: 'dotted 1/8', beats: 0.75 },
  { id: 'eighth', label: '1/8', beats: 0.5 },
  { id: 'triplet8', label: '1/8 triplet', beats: 1 / 3 },
  { id: 'sixteenth', label: '1/16', beats: 0.25 },
];

/** The ones a sync menu offers, which can afford to be finer than the ear. */
export const SYNC_DIVISIONS = [
  { id: 'free', label: 'Free', beats: null },
  { id: 'quarter', label: '1/4', beats: 1 },
  { id: 'dotted8', label: 'dotted 1/8', beats: 0.75 },
  { id: 'quartertrip', label: '1/4 triplet', beats: 2 / 3 },
  { id: 'eighth', label: '1/8', beats: 0.5 },
  { id: 'dotted16', label: 'dotted 1/16', beats: 0.375 },
  { id: 'triplet8', label: '1/8 triplet', beats: 1 / 3 },
  { id: 'sixteenth', label: '1/16', beats: 0.25 },
];

/** A note value, in milliseconds of this track. */
export const timeOf = (beats) => beats * LOOP_BEAT * 1000;

/** The note value nearest a time, and how far off it is. */
export function nearestDivision(ms, among = SYNC_DIVISIONS) {
  let best = null;
  for (const division of among) {
    if (division.beats === null) continue;
    const off = Math.abs(Math.log2(ms / timeOf(division.beats)));
    if (!best || off < best.off) best = { division, off };
  }
  return best;
}

/**
 * The repeats, as samples.
 *
 * Simulated rather than worked out in closed form, because the filters in the
 * feedback path mean each repeat is a filtered copy of the last one and not a
 * scaled copy of the first. Running the loop for real is both shorter to
 * write and exactly right.
 */
export function makeEcho(rate, params = {}) {
  const settings = { ...ECHO_DEFAULTS, ...params };
  const time = Math.min(LONGEST_TIME, Math.max(SHORTEST_TIME, settings.time));
  const feedback = Math.min(MOST_FEEDBACK, Math.max(0, settings.feedback));
  const step = Math.max(1, Math.round((time / 1000) * rate));

  // Long enough for the repeats to die, and never longer than anything else
  // in this app measures. At the most feedback on offer that is a truncation
  // rather than a fade-out, which is honest: the display shows where it was
  // cut and both sides of a comparison are cut in the same place.
  const fading = feedback > 0.001
    ? (step / rate) * (Math.log(1e-3) / Math.log(feedback))
    : step / rate;
  const seconds = Math.min(LONGEST_TAIL, Math.max(step / rate + 0.05, fading + step / rate));
  const length = Math.ceil(seconds * rate);

  const channels = [new Float32Array(length), new Float32Array(length)];
  const lines = channels.map(() => new Float32Array(step));
  const tone = channels.map(() => setBiquad(makeBiquad(), 'lowpass', settings.tone, rate));
  const cut = channels.map(() => setBiquad(makeBiquad(), 'highpass', settings.lowCut, rate));

  let at = 0;
  for (let i = 0; i < length; i += 1) {
    // An impulse in, once.
    const input = i === 0 ? 1 : 0;

    const taken = [lines[0][at], lines[1][at]];
    channels[0][i] = taken[0];
    channels[1][i] = taken[1];

    // Each side is filtered once a sample, and then routed. Filtering it
    // again on the way past the other channel would be running one filter's
    // state forward twice in a sample, which is a different filter.
    const rounded = [0, 0];
    for (let c = 0; c < 2; c += 1) {
      let value = taken[c];
      if (settings.tone < 20000) value = runBiquad(tone[c], value);
      if (settings.lowCut > 20) value = runBiquad(cut[c], value);
      rounded[c] = value;
    }

    for (let c = 0; c < 2; c += 1) {
      // Ping-pong sends what came out of one ear into the other, so the
      // repeats walk across rather than sitting on top of each other - and
      // the input lands in the left line alone, because that is what starts
      // them alternating.
      const from = settings.pingPong ? 1 - c : c;
      const feed = settings.pingPong ? (c === 0 ? input : 0) : input;
      lines[c][at] = feed + rounded[from] * feedback;
    }

    at = (at + 1) % step;
  }

  // Normalised, so that more feedback is more repeats rather than more level
  // - the same decision the rooms are built with, and the same false positive
  // it exists to kill.
  let energy = 0;
  for (const out of channels) for (let i = 0; i < length; i += 1) energy += out[i] * out[i];
  const scale = energy > 0 ? 1 / Math.sqrt(energy) : 0;
  for (const out of channels) for (let i = 0; i < length; i += 1) out[i] *= scale;

  return { channels, rate, length, seconds: length / rate, step: step / rate };
}

/** Where the repeats land, in seconds, while they are still worth hearing. */
export function repeatsOf(settings) {
  const time = Math.min(LONGEST_TIME, Math.max(SHORTEST_TIME, settings.time)) / 1000;
  const feedback = Math.min(MOST_FEEDBACK, Math.max(0, settings.feedback));

  const at = [];
  let level = 1;
  for (let n = 1; n * time <= LONGEST_TAIL && level > 1e-3; n += 1) {
    at.push({ at: n * time, level });
    level *= feedback;
    if (feedback <= 0.001) break;
  }
  return at;
}

/** A delay, built and read in the terms a guess is marked in. */
export function echoProfile(rate, settings, times = decayTimes()) {
  const echo = makeEcho(rate, settings);
  return decayProfile(wetDryImpulse(echo, settings.mix ?? ECHO_DEFAULTS.mix), rate, times);
}
