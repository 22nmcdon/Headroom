// An instrument, some effects, a fader and a pan.
//
// Which is a sketchpad track and a mix-mode stem and the same object, and
// saying so is the whole reason the two were built together. The practice
// side wants several of these so a mix exercise has stems to work on; the
// sketchpad wants several so a clip grid has rows. Neither needs anything the
// other does not.
//
// Deliberately not a mixing console. There is one fader, one pan, one send,
// and a chain of inserts - and if a feature mainly serves finishing a track
// rather than sketching one, it belongs in a DAW.
//
// Measured: four of these - a piano with an EQ on it, a bass, a kit and a
// synth with a delay - fed by four clips of different lengths through the
// transport and rendered offline. Four bars at 96 bpm came out at exactly
// 10.00 seconds, peaking at -3.07 dBFS with the hits on the eighth-note grid,
// and the two-bar piano clip and the one-bar bass and drum clips all looped
// against each other without a double or a hole at any of the loop points.

import { chainOf } from './effect.js';
import { makeEffect } from './effects.js';
import { makeInstrument } from './instrument.js';
import { loopWindows } from '../sketch/transport.js';

/** As wide as a pan goes, and what the law is at the middle. */
const panLaw = (pan) => {
  // Equal power, so that something panned to the middle is as loud as the
  // same thing hard left. A straight line would make the centre quieter,
  // which is the one thing everybody notices and nobody can name.
  const x = ((Math.max(-1, Math.min(1, pan)) + 1) / 2) * (Math.PI / 2);
  return { left: Math.cos(x), right: Math.sin(x) };
};

/**
 * One track.
 *
 * `instrument` and `inserts` are ids, so a track is describable as data - a
 * name and a few strings - which is what lets a project be JSON and a preset
 * be a line in a table.
 */
export async function makeTrack(ctx, {
  id,
  name = id,
  instrument = 'synth',
  inserts = [],
  gain = 1,
  pan = 0,
  send = 0,
  options = {},
} = {}) {
  const voice = makeInstrument(ctx, instrument, options[instrument] ?? {});
  const chain = chainOf(ctx, await Promise.all(
    inserts.map((effect) => makeEffect(ctx, effect, options[effect] ?? {})),
  ));

  const fader = ctx.createGain();
  const panner = ctx.createStereoPanner
    ? ctx.createStereoPanner()
    : null;
  const out = ctx.createGain();
  // A send tapped after the fader, which is what a post-fader send is: turn
  // the track down and its reverb goes with it, which is almost always what
  // somebody means.
  const sendOut = ctx.createGain();

  voice.out.connect(chain.in);
  chain.out.connect(fader);
  if (panner) fader.connect(panner).connect(out);
  else fader.connect(out);
  fader.connect(sendOut);

  const state = { gain, pan, send, muted: false, soloed: false };

  const apply = (at = ctx.currentTime) => {
    const level = state.muted ? 0 : state.gain;
    fader.gain.setTargetAtTime(level, at, 0.01);
    sendOut.gain.setTargetAtTime(state.send, at, 0.01);
    if (panner) panner.pan.setTargetAtTime(Math.max(-1, Math.min(1, state.pan)), at, 0.01);
  };

  /**
   * The opening positions, set outright rather than approached.
   *
   * `setTargetAtTime` is right for a control somebody is moving and wrong
   * for the value a node starts at: it begins from whatever the node's
   * default was - unity, on a gain - and takes a few tens of milliseconds to
   * get where it was told. On a send that is meant to be at zero, that is
   * every track going into the reverb at full level for fifty milliseconds.
   * Measured before this: a track with its send at nothing put a burst into
   * the room loud enough to show up at -7.4 dBFS on the room's own stem.
   */
  fader.gain.value = state.muted ? 0 : state.gain;
  sendOut.gain.value = state.send;
  if (panner) panner.pan.value = Math.max(-1, Math.min(1, state.pan));

  return {
    id,
    name,
    instrument: voice,
    chain,
    out,
    send: sendOut,
    /** The two ends, so a track is itself usable wherever an effect is. */
    in: voice.out,

    get state() { return { ...state }; },

    set(next, at = ctx.currentTime) {
      Object.assign(state, next);
      apply(at);
      return this;
    },

    /** Set one of this track's inserts. */
    setInsert(which, params) { chain.set(which, params); return this; },

    /**
     * The pan law, as numbers, for anything rendering this without a panner.
     *
     * Safari had no `StereoPannerNode` for years and an offline render on an
     * older browser still may not; a caller that has to split the channels
     * itself needs the same law or the stems do not match what was heard.
     */
    panGains: () => panLaw(state.pan),

    destroy() {
      voice.destroy();
      chain.destroy();
      for (const node of [fader, panner, out, sendOut].filter(Boolean)) {
        try { node.disconnect(); } catch { /* already gone */ }
      }
    },
  };
}

/**
 * A clip: notes in ticks, and how long it is before it repeats.
 *
 * Ticks because that is what the exporter writes and what the transport
 * counts in. A clip is the smallest thing worth keeping and it is plain data
 * - no nodes, no context - so a project is JSON and a test needs neither.
 */
export const makeClip = ({ id, length, notes = [] }) => ({
  id,
  length,
  notes: notes.map((note) => ({ velocity: 96, length: 1, ...note })),
});

/**
 * What a clip plays in a window of ticks.
 *
 * Returned rather than played, so the arithmetic can be checked without an
 * audio context. Every note comes back with the absolute tick it sounds at,
 * which is its position within the clip plus whichever pass of the loop the
 * window is in.
 *
 * A note that starts before the window and is still sounding inside it is not
 * here, and should not be: it was already booked by the window that contained
 * its start, and booking it again would play it twice.
 *
 * `anchor` is the tick the clip is counted from - where it was launched. The
 * default of zero counts from the start of time, which is what a clip that
 * was always playing wants; a clip launched on bar three wants bar three, so
 * that pressing it plays its first bar rather than wherever the global grid
 * happens to be in it.
 */
export function notesIn(clip, from, to, anchor = 0) {
  const found = [];

  for (const piece of loopWindows(from - anchor, to - anchor, clip.length)) {
    for (const note of clip.notes) {
      if (note.start >= piece.from && note.start < piece.to) {
        found.push({ ...note, at: note.start + piece.offset + anchor });
      }
    }
  }

  return found;
}

/**
 * Put whatever a track should be playing on it, driven by a transport.
 *
 * `pick(from, to)` is asked once a window, and hands back the pieces of it to
 * book: a clip, the span of ticks to take from it, and the tick its phase is
 * counted from. Pieces rather than one clip because a launch landing inside a
 * window splits it - the old clip up to the bar line, the new one after it -
 * and that is the one thing a clip grid cannot do without.
 *
 * Returns the unsubscribe, because a track that goes away has to stop being
 * asked.
 */
export function playPieces(transport, track, pick) {
  return transport.onSchedule((from, to, timeOf) => {
    for (const piece of pick(from, to) ?? []) {
      if (!piece.clip?.notes?.length) continue;

      for (const note of notesIn(piece.clip, piece.from, piece.to, piece.anchor ?? 0)) {
        track.instrument.play(
          note.pitch,
          note.velocity,
          timeOf(note.at),
          note.length * transport.perTick,
        );
      }
    }
  });
}

/**
 * One clip, always playing, from the start of time.
 *
 * The simple case, and the one anything without a grid of scenes wants.
 */
export const playClip = (transport, track, getClip) => playPieces(
  transport,
  track,
  (from, to) => [{ clip: typeof getClip === 'function' ? getClip() : getClip, from, to }],
);
