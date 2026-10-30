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
import { loudnessReading } from '../lib/loudness.js';
import { crestReading } from '../analysis/dynamics.js';
import { balanceReading } from '../analysis/balance.js';
import { widthReading } from '../analysis/width.js';
import { placementReading } from './placement.js';
import { levelsReading } from './levels.js';
import { shareReading } from './share.js';
import { renderStems } from '../sketch/stems.js';
import { stampOf } from '../lib/read.js';

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

/**
 * The readings a mix is marked on, in the order they are shown.
 *
 * `levels` is last and is the only one not taken on the master, because it is
 * the only one that can name a fader. The other five read the sum, which is
 * right - two sets of moves that come out sounding the same are the same
 * answer - and leaves the advice unable to say which part the energy belongs
 * to. "There is too much around 120 Hz" is true and is not an instruction.
 */
/**
 * Every reading a mix can be marked on, in the order they are shown.
 *
 * Not every tier is marked on all of them: `markMix` takes the list from the
 * tier's own tolerances, so a reading a tier has no tolerance for is not
 * reported. That is how `share` arrived without re-marking the four tiers
 * that came before it - a carve is the only round that asks about which part
 * owns which register, and on a round of faders and pans the same reading
 * says what `levels` already said.
 */
export const MARKED = ['loudness', 'balance', 'placement', 'width', 'crest', 'levels', 'share'];

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
/**
 * Everything a mix is marked on: the five off the master, and the parts.
 *
 * Two renders, and the cost is real - measured, 1947 ms one after the other
 * against 886 for the master alone, and running them together saves nothing
 * because two offline renders of the same project contend completely (1934 ms
 * together). So a submit roughly doubles.
 *
 * It could be one render. The stems pass taps every track in one go, and
 * tapping the limiter's output alongside them would give all six readings for
 * the price of one. That was built and then taken out again, because the two
 * renders do not produce the same master and the difference is not small:
 *
 *     renderMix     632023 samples, first sound at 2867, energy -30.168
 *     stems tap     627613 samples, first sound at  221, energy -29.512
 *
 * Both causes are in this file and in `sketch/stems.js` rather than in the
 * graph - `renderMix` adds a tenth of a second to the context and calls
 * `stage.play()`, which starts a breath after zero, where the stems pass
 * calls `play(0)` and does not. Alignable, almost certainly. Not aligned
 * here, because the five master readings carry tolerances in `score.js` that
 * were measured on this exact signal, and a near-miss at aligning them would
 * silently re-mark every tier rather than fail.
 *
 * Neither reading needs the other's render to be valid: each side of a
 * comparison goes through the same path as the other, which is what a
 * comparison needs.
 */
export async function readMix(project, source, { bars = 4, rate = RATE, tail = TAIL } = {}) {
  const master = await renderMix(project, { bars, rate, tail });
  const stems = await renderStems(project, 0, { bars, rate, tail });

  return {
    ...readMaster(master, source),
    levels: levelsReading(stems, rate, { source }),
    // Off the same render as the levels, so the seventh reading costs
    // nothing: the stems pass taps every track in one go and both of these
    // are arithmetic over what it hands back.
    share: shareReading(stems, rate, { source }),
  };
}

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

/**
 * What makes a render a different render: the material and the mix on it.
 *
 * `settings` as well as `inserts`, which is the difference between a stamp
 * and a bug. An insert's id says it is there and nothing about what it is
 * doing, so a desk with a +3 dB shelf on the bass and the same desk with a
 * -3 dB one stamped identically - and the second would have come back from
 * the cache as the first, which on a tone round is the answer being marked
 * against a render of something else.
 */
export const mixStamp = (project) => stampOf({
  bpm: project.bpm,
  tracks: project.tracks.map((track) => ({
    gain: track.gain,
    pan: track.pan,
    send: track.send,
    muted: track.muted,
    inserts: track.inserts,
    settings: track.settings,
    notes: track.slots[0]?.notes.length ?? 0,
  })),
});
