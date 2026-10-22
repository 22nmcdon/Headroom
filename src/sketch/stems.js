// A scene, as audio, one track at a time.
//
// The MIDI export is the right way out for parts somebody is going to
// re-voice. It is the wrong way out for everything that is not notes: the
// room, the saturator, the compressor, the particular synth this app made.
// Those only arrive sounding the way they did here if they arrive as
// recordings.
//
// All of it in one render, not one render a track. Every stem is a tap on
// the same graph at the same moment, so they line up by construction rather
// than by arithmetic - and a scene that takes a second and a half to render
// takes a second and a half rather than six.
//
// The taps are after each track's fader and pan and before the master
// limiter. A stem through a limiter that was reacting to the other three is
// a stem nobody can put back together.

import { makeStage } from './stage.js';
import { Transport } from './transport.js';
import { barTicks, sceneOf, sceneToMidi } from './project.js';
import { PPQ } from './midi.js';
import { writeWav } from './wav.js';
import { writeZip } from './zip.js';
import { slug } from './store.js';

/** Long enough for a four-second room to finish. */
export const STEM_TAIL = 4;

export const STEM_RATE = 48000;

/** A track's name, as a filename, with something to fall back on. */
const fileName = (name) => slug(name, 32) || 'track';

/**
 * Every track in a scene, plus the room and the mix, as buffers.
 *
 * Returned as channel arrays rather than as files, so the same render can be
 * read by the analysis side as readily as it can be written to disk.
 */
export async function renderStems(project, scene, {
  bars = 4, rate = STEM_RATE, tail = STEM_TAIL, takes = new Map(),
} = {}) {
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;

  const rows = sceneOf(project, scene);
  if (!rows.length) return [];

  const perTick = 60 / project.bpm / PPQ;
  const ticks = barTicks(project) * bars;
  const seconds = ticks * perTick + tail;

  // One stereo pair a track, then the room, then the mix.
  const pairs = project.tracks.length + 2;
  const ctx = new Offline(pairs * 2, Math.ceil(rate * seconds), rate);

  let clock = 0;
  const transport = new Transport({
    now: () => clock,
    every: () => null,
    clear: () => {},
    lookahead: 0,
    bpm: project.bpm,
    beats: project.beats,
    value: project.value,
  });

  // The stage's own output goes nowhere: every pair below is a tap, and the
  // mix is one of them. Connecting the master as well would put it in the
  // first two channels on top of the first track.
  const sink = ctx.createGain();
  sink.gain.value = 0;
  sink.connect(ctx.destination);

  // The recordings have to come with the project. A take lives in a buffer
  // the page is holding, not in the project, so a render that did not take
  // the map would quietly produce a silent stem for every recorded track.
  const takeBuffers = new Map();
  for (const [id, buffer] of takes) takeBuffers.set(id, await atRate(ctx, buffer, rate));

  const stage = await makeStage(ctx, project, { out: sink, transport, takes: takeBuffers });
  const merger = ctx.createChannelMerger(pairs * 2);
  merger.connect(ctx.destination);

  /** One stereo node, into its own two channels of the render. */
  const tap = (node, pair) => {
    const split = ctx.createChannelSplitter(2);
    // Explicit, because a mono node connected to a splitter otherwise feeds
    // the same signal to both outputs on some browsers and silence on
    // others. Every tap here is already stereo; saying so costs nothing.
    const stereo = ctx.createGain();
    stereo.channelCount = 2;
    stereo.channelCountMode = 'explicit';
    stereo.channelInterpretation = 'speakers';

    node.connect(stereo).connect(split);
    split.connect(merger, 0, pair * 2);
    split.connect(merger, 1, pair * 2 + 1);
  };

  project.tracks.forEach((_, index) => {
    const track = stage.rowAt(index);
    if (track) tap(track.out, index);
  });

  const roomPair = project.tracks.length;
  tap(stage.taps.room, roomPair);
  tap(stage.taps.mix, roomPair + 1);

  stage.launchScene(scene);
  stage.play(0);

  for (clock = 0; clock < ticks * perTick; clock = Math.min(ticks * perTick, clock + 0.05)) {
    transport.pass();
    if (clock === ticks * perTick) break;
  }

  const rendered = await ctx.startRendering();
  stage.destroy();

  const pairAt = (index) => [
    rendered.getChannelData(index * 2),
    rendered.getChannelData(index * 2 + 1),
  ];

  const stems = project.tracks
    .map((track, index) => ({
      id: track.id,
      name: track.name,
      kind: 'track',
      empty: !rows.some((row) => row.index === index),
      channels: pairAt(index),
    }))
    // A stem of silence is a file somebody has to notice and delete.
    .filter((stem) => !stem.empty);

  return [
    ...stems,
    { id: 'room', name: 'Room', kind: 'room', channels: pairAt(roomPair) },
    { id: 'mix', name: 'Mix', kind: 'mix', channels: pairAt(roomPair + 1) },
    ].map((stem) => ({ ...stem, rate, seconds: rendered.duration }));
}

/**
 * A buffer belonging to one context, as a buffer belonging to another.
 *
 * An AudioBuffer is not tied to a context, but its sample rate is: handing
 * a 44.1 kHz recording to a 48 kHz render plays it fast and sharp. Resampled
 * here, linearly, which is enough for a sketch and is the only resampler
 * this app has any need of.
 */
async function atRate(ctx, buffer, rate) {
  if (buffer.sampleRate === rate) return buffer;

  const ratio = rate / buffer.sampleRate;
  const frames = Math.max(1, Math.round(buffer.length * ratio));
  const out = ctx.createBuffer(buffer.numberOfChannels, frames, rate);

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const from = buffer.getChannelData(channel);
    const to = out.getChannelData(channel);
    for (let i = 0; i < frames; i += 1) {
      const at = i / ratio;
      const left = Math.floor(at);
      const part = at - left;
      const a = from[Math.min(left, from.length - 1)];
      const b = from[Math.min(left + 1, from.length - 1)];
      to[i] = a + (b - a) * part;
    }
  }

  return out;
}

/** The loudest sample in a stem, in decibels, for saying what came out. */
export function peakOf(channels) {
  let peak = 0;
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i += 1) peak = Math.max(peak, Math.abs(channel[i]));
  }
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}

/**
 * A scene as an archive: a wav a track, the room, the mix, and the MIDI.
 *
 * The MIDI goes in with them because the two are the same idea in two
 * shapes, and because the stems are what it sounded like while the MIDI is
 * what it was - whoever opens this will want both, and will want them lined
 * up. They are: every stem starts at tick zero of the scene, and so does the
 * file.
 */
export async function zipStems(project, scene, { bars = 4, rate = STEM_RATE, takes } = {}) {
  const stems = await renderStems(project, scene, { bars, rate, takes });
  if (!stems.length) return null;

  const folder = `${fileName(project.name)}-scene-${scene + 1}`;

  const files = stems.map((stem) => ({
    name: `${folder}/${fileName(stem.name)}.wav`,
    bytes: writeWav(stem.channels, stem.rate),
  }));

  files.push({
    name: `${folder}/${folder}.mid`,
    bytes: sceneToMidi(project, scene, { bars }),
  });

  return {
    name: `${folder}.zip`,
    bytes: writeZip(files),
    stems: stems.map((stem) => ({
      name: stem.name,
      kind: stem.kind,
      peak: Number(peakOf(stem.channels).toFixed(2)),
      seconds: Number(stem.seconds.toFixed(2)),
    })),
  };
}
