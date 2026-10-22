// The sketch, making a sound.
//
// Everything above this is data: a project is JSON, a launch is arithmetic, a
// clip is a list of notes. This is the one place that holds nodes, and its
// whole job is to keep the graph agreeing with the project while the clock
// runs.
//
// Built out of the shared core and nothing else - `makeTrack` for the rows,
// `makeEffect` for the send, `Transport` for the clock - so a mix exercise
// standing on the same pieces gets the same behaviour rather than a second
// implementation of it.
//
// One send, one return, one limiter. A send because a reverb per track is
// four convolvers for one room, and because a shared room is what makes four
// parts sound like they are in the same place. A limiter because a sketchpad
// invites you to stack four parts at once and the fourth one should not be
// the one that clips - and it goes here, after the mixer, rather than on the
// engine's master, so that nothing the practice side measures is measured
// through it.

import { transportFor, nextBar } from './transport.js';
import { makeTrack, playPieces } from '../core/track.js';
import { makeEffect } from '../core/effects.js';
import { booking, queue, resting } from './launch.js';
import { clipAt } from './project.js';
import { optionsFor, paramsFor } from './knobs.js';

/** The shared room. Short and bright: a sketch wants space, not a cathedral. */
export const SEND_VERB = { decay: 1.4, size: 14, damping: 0.5, preDelay: 12, mix: 1 };

/**
 * A safety limiter, as a compressor at the end of its range.
 *
 * Not a mastering limiter and not pretending to be one. It is there so that
 * launching a fourth clip cannot make the output louder than the converter
 * can hold, and it sits a decibel under full scale because a sketch that
 * reads exactly 0 dBFS is a sketch somebody will export and wonder about.
 */
function safety(ctx) {
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -1;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.1;
  return limiter;
}

/** What makes a track's audio graph, rather than its mix settings. */
const graphStamp = (track) => `${track.instrument}|${track.inserts.join(',')}`;

/**
 * The whole sketch, live.
 *
 * `out` is where it ends up, so the stage can be rendered offline into a
 * buffer as readily as it can be played - which is what stem export will be,
 * and what the tests of this file are.
 */
export async function makeStage(ctx, project, { out = ctx.destination, transport } = {}) {
  const bus = ctx.createGain();
  const limiter = safety(ctx);
  bus.connect(limiter).connect(out);

  const verb = await makeEffect(ctx, 'reverb', { settings: SEND_VERB });
  const returns = ctx.createGain();
  returns.gain.value = 0.9;
  verb.out.connect(returns).connect(bus);

  // The clock is injectable for the same reason the transport's own `now` is:
  // an offline render has no wall clock and no intervals, so a stem export and
  // a measurement of this file both drive it by hand.
  const clock = transport ?? transportFor(ctx, {
    bpm: project.bpm, beats: project.beats, value: project.value,
  });

  let current = project;
  const rows = [];

  /** One row: a live track, where it is in the grid, and its subscription. */
  const build = async (spec, index) => {
    const track = await makeTrack(ctx, {
      id: spec.id,
      name: spec.name,
      instrument: spec.instrument,
      inserts: spec.inserts,
      gain: spec.gain,
      pan: spec.pan,
      send: spec.send,
      options: Object.fromEntries(spec.inserts
        .map((effect) => [effect, optionsFor(effect, spec.settings?.[effect] ?? {})])),
    });
    track.out.connect(bus);
    track.send.connect(verb.in);
    track.set({ muted: spec.muted });

    const row = { track, stamp: graphStamp(spec), launch: resting(), off: null };
    row.off = playPieces(clock, track, (from, to) => {
      const { pieces, state } = booking(from, to, row.launch);
      row.launch = state;
      return pieces.map((piece) => ({ ...piece, clip: clipAt(current, index, piece.scene) }));
    });
    return row;
  };

  rows.push(...await Promise.all(current.tracks.map(build)));

  const tear = (row) => { row.off?.(); row.track.destroy(); };

  /** When a launch lands: the next bar line if running, now if not. */
  const when = () => (clock.playing ? nextBar(clock.scheduled, clock.perBar) : 0);

  return {
    transport: clock,
    get project() { return current; },
    get playing() { return clock.playing; },
    get bar() { return clock.bar; },
    get tick() { return clock.tick; },

    /** Where each row is and what it is waiting for, for the grid to draw. */
    get state() {
      return rows.map(({ launch }) => ({ scene: launch.scene, next: launch.next }));
    },

    /** A row's live track, for anything that wants to meter or re-insert it. */
    rowAt: (index) => rows[index]?.track ?? null,

    /**
     * The two places a stem export has to tap.
     *
     * `mix` is everything, before the limiter, because a stem through a
     * limiter that was reacting to the other three is a stem nobody can put
     * back together. `room` is the shared return, which is a stem of its own
     * for the same reason it is a shared send: the parts are in one room,
     * and splitting that room four ways would be four rooms.
     */
    get taps() { return { mix: bus, room: returns }; },

    /**
     * The project changed.
     *
     * Notes need nothing done: the schedule reads clips out of the project
     * every window, so an edit is heard on the next bar it is in without
     * anything being rebuilt. A fader or a pan is a parameter. Only a change
     * of instrument or of inserts is a new graph, and only that row's.
     */
    async setProject(next) {
      const was = current;
      current = next;

      if (!clock.playing
        && (next.bpm !== was.bpm || next.beats !== was.beats || next.value !== was.value)) {
        clock.setTempo(next.bpm, next.beats, next.value);
      }

      await Promise.all(next.tracks.map(async (spec, index) => {
        const row = rows[index];
        if (!row) {
          rows[index] = await build(spec, index);
          return;
        }
        if (graphStamp(spec) !== row.stamp) {
          const launch = row.launch;
          tear(row);
          rows[index] = await build(spec, index);
          rows[index].launch = launch;
          return;
        }
        row.track.set({
          gain: spec.gain, pan: spec.pan, send: spec.send, muted: spec.muted,
        });
        // An insert's knob is a parameter, not a graph. Rebuilding the chain
        // because somebody moved a threshold would be a gap in the audio on
        // every pixel of the drag.
        for (const effect of spec.inserts) {
          row.track.setInsert(effect, paramsFor(effect, spec.settings?.[effect] ?? {}));
        }
      }));

      // A project with fewer tracks than the stage has rows.
      for (const row of rows.splice(next.tracks.length)) tear(row);
    },

    /** Put a row on a scene, or on nothing. Lands on the next bar line. */
    launch(index, scene) {
      const row = rows[index];
      if (!row) return;
      row.launch = queue(row.launch, scene, when());
    },

    /** A whole scene at once, so the parts arrive together or not at all. */
    launchScene(scene) {
      const at = when();
      rows.forEach((row, index) => {
        const has = clipAt(current, index, scene);
        row.launch = queue(row.launch, has ? scene : null, at);
      });
    },

    /** Everything off, on the next line. */
    stopScene() {
      const at = when();
      for (const row of rows) row.launch = queue(row.launch, null, at);
    },

    /**
     * Start the clock, from the top.
     *
     * Always from the top: there is no timeline to be somewhere in, and a
     * sketchpad that resumed where it stopped would put a clip's phase
     * somewhere nobody chose.
     */
    /**
     * Start the clock, from the top.
     *
     * `at` is when, in audio time, and the default of a breath from now is
     * what a press of Play wants. An offline render passes zero: a stem that
     * began sixty milliseconds in would be sixty milliseconds late against
     * the MIDI file beside it, which is a flam on every downbeat.
     */
    play(at = ctx.currentTime + 0.06) {
      if (clock.playing) return;
      for (const row of rows) row.launch = resting(row.launch.next?.scene ?? row.launch.scene, 0);
      clock.start(at, 0);
    },

    stop() {
      clock.stop();
      for (const row of rows) {
        row.launch = resting(row.launch.scene, 0);
        row.track.instrument.allOff?.(ctx.currentTime);
      }
    },

    destroy() {
      clock.stop();
      for (const row of rows) tear(row);
      rows.length = 0;
      verb.destroy();
      for (const node of [bus, limiter, returns]) {
        try { node.disconnect(); } catch { /* already gone */ }
      }
    },
  };
}
