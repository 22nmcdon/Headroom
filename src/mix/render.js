// A mix, rendered and read.
//
// The thing a mix exercise is marked on is the master, so there has to be a
// master to read - and the only honest way to get one is to render the piece
// through the same graph that plays it. Which the stage already is: it takes
// its transport as an option for exactly this, so the clock can be driven by
// hand in an OfflineAudioContext where there is no wall clock and no
// intervals.
//
// Two renders a round, one of the mix being worked on and one of the mix it
// is being compared against, and the answer's render is cached by what made
// it - the stems do not change within a round, and neither does the answer.

import { makeStage } from '../sketch/stage.js';
import { Transport } from '../sketch/transport.js';
import { barTicks } from '../sketch/project.js';
import { PPQ } from '../sketch/midi.js';
import { loudnessReading } from '../analysis/loudness.js';
import { crestReading } from '../analysis/dynamics.js';
import { balanceReading } from '../analysis/balance.js';
import { widthReading } from '../analysis/width.js';
import { placementReading } from './placement.js';
import { stampOf } from '../read.js';

/** Long enough for the tails, short enough that a round is not a wait. */
export const TAIL = 1.6;

/** 44.1 is what a record is at, and it renders a third faster than 48. */
export const RATE = 44100;

/**
 * One mix, as audio.
 *
 * The lookahead goes to zero for the render, which is the one place it should
 * be: a lookahead exists to beat a deadline, and an offline render has none.
 * At zero the last window ends exactly on the last tick of the piece, so the
 * loop's second pass does not get a bar's worth of itself booked into the
 * tail.
 */
export async function renderMix(project, { bars = 4, rate = RATE, tail = TAIL } = {}) {
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;

  const perBar = barTicks(project);
  const ticks = perBar * bars;
  const perTick = 60 / project.bpm / PPQ;
  const seconds = ticks * perTick + tail;

  const ctx = new Offline(2, Math.ceil(rate * (seconds + 0.1)), rate);

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

  const stage = await makeStage(ctx, project, { out: ctx.destination, transport });
  stage.launchScene(0);
  stage.play();

  // `play` starts the clock a breath after zero, so the piece ends a breath
  // after its own length. The last step lands on it exactly.
  const ends = transport.startedAt + ticks * perTick;
  for (clock = 0; clock < ends; clock = Math.min(ends, clock + 0.05)) {
    transport.pass();
    if (clock === ends) break;
  }

  const buffer = await ctx.startRendering();
  stage.destroy();
  return buffer;
}

/** An AudioBuffer as the plain arrays the readings take. */
export const channelsIn = (buffer) =>
  Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));

/** The readings a mix is marked on, in the order they are shown. */
export const MARKED = ['loudness', 'balance', 'placement', 'width', 'crest'];

/**
 * Everything worth saying about a master, in five readings.
 *
 * The four the analysis view takes - how loud, how dynamic, where the weight
 * is, how wide - and where things sit left to right, which is the one a pan
 * control moves and the one the other four are blind to.
 *
 * `source` goes into every reading's envelope, so two readings of two
 * different renders can never be compared by accident - `comparable` refuses
 * them on the axis, and the source says which is which when it does.
 */
export function readMaster(buffer, source) {
  const channels = channelsIn(buffer);
  const { sampleRate } = buffer;

  return {
    loudness: loudnessReading(channels, sampleRate, { source }),
    crest: crestReading(channels, sampleRate, { source }),
    balance: balanceReading(channels, sampleRate, { source }),
    width: widthReading(channels, sampleRate, { source }),
    placement: placementReading(channels, sampleRate, { source }),
    seconds: buffer.duration,
  };
}

/** What makes a render a different render: the material and the mix on it. */
export const mixStamp = (project) => stampOf({
  bpm: project.bpm,
  tracks: project.tracks.map((track) => ({
    gain: track.gain,
    pan: track.pan,
    send: track.send,
    muted: track.muted,
    inserts: track.inserts,
    notes: track.slots[0]?.notes.length ?? 0,
  })),
});
