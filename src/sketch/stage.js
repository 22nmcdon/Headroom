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
import { booking, following, queue, resting } from './launch.js';
import {
  clipAt, isTake, keyRoutes, takeWindow, fadeFor, heardFor, MOST_NUDGE,
} from './project.js';
import { optionsFor, paramsFor } from './knobs.js';
import { makeLimiterNode } from '../lib/limiter-node.js';
import { RIDE_STEPS } from '../lib/tempo.js';

/** The shared room. Short and bright: a sketch wants space, not a cathedral. */
export const SEND_VERB = { decay: 1.4, size: 14, damping: 0.5, preDelay: 12, mix: 1 };

/**
 * What makes a track's audio graph, rather than its mix settings.
 *
 * The sample is in here because a sampler is built around its buffer - the
 * instrument holds it, not a parameter on it - so choosing a different
 * recording is a new instrument and therefore a new graph, exactly as
 * changing from a piano to a bass is. Without it, picking another take
 * redrew the panel and went on playing the old recording.
 */
const graphStamp = (track) => `${track.instrument}|${track.inserts.join(',')}`
  + `|${track.sample?.take ?? ''}:${track.sample?.root ?? ''}:${track.sample?.hold ? 'held' : 'free'}`;

/**
 * What to hand each of a track's makers.
 *
 * The inserts' options came from here already. The instrument's did not, and
 * nothing noticed because the four synthesised ones take none - a sampler is
 * the first instrument that needs to be told anything, and what it needs is
 * the audio itself, which cannot live in a project file. So the project keeps
 * the take's id and this is where that id becomes a buffer.
 */
const optionsOf = (track, takes) => ({
  ...Object.fromEntries(track.inserts
    .map((effect) => [effect, optionsFor(effect, track.settings?.[effect] ?? {})])),
  [track.instrument]: {
    buffer: track.sample?.take ? takes.get(track.sample.take) ?? null : null,
    root: track.sample?.root,
    hold: Boolean(track.sample?.hold),
  },
});

/**
 * The whole sketch, live.
 *
 * `out` is where it ends up, so the stage can be rendered offline into a
 * buffer as readily as it can be played - which is what stem export will be,
 * and what the tests of this file are.
 */
/**
 * The shape of a fade, which is not one shape.
 *
 * A short fade and a long one are different jobs and want opposite curves,
 * and the measurements say so plainly.
 *
 * A fade under about 50 ms exists to stop a cut being a click. What it is
 * judged on is splatter, and there a raised cosine wins: its slope is zero
 * where it meets full gain, so there is no corner, and the energy a cut puts
 * above 5 kHz falls away faster than from any curve with one. Against a
 * straight line, same cut through the same tone: 18.8 dB quieter at 1 ms,
 * 33.1 at 5 ms, 38.8 at 10 ms.
 *
 * A fade of a second is a musical gesture and splatter is irrelevant - there
 * is no discontinuity at that timescale to make any. What it is judged on is
 * whether it falls EVENLY, and there the raised cosine is the worst of them,
 * for exactly the property that makes it good at 5 ms. Flat where it meets
 * full gain means a two-second fade-out moves 3 dB in its first 0.73 s -
 * about a decibel a second, which is the edge of noticing anything at all -
 * and then covers 32 dB in its last 0.2 s. It hangs, then vanishes.
 *
 *     a fade-out has got to    -6 dB   -20 dB   -40 dB   rate varies by
 *     raised cosine            49.9%    79.5%    93.6%        >1000x
 *     linear in dB             10.0%    33.3%    66.7%            1x
 *
 * So the curve follows the length. Cosine at or under 50 ms, even above 200,
 * mixed between - and the even one is linear in dB down to a floor and then
 * taken to silence by a short cosine tail, so it ends on nothing rather than
 * on the step at its floor, which is what used to limit it. Measured, the
 * blend gives up nothing at the short end and is better at the long one:
 *
 *     length    mix   -40 dB   rate varies by   splatter
 *       5 ms   0.00    93.6%          >1000x      -125.9
 *      50 ms   0.00    93.6%          >1000x      -164.5
 *     100 ms   0.33    92.4%             14x      -173.6
 *     200 ms   1.00    66.7%              1x      -181.8
 *       2 s    1.00    66.7%              1x      -220.6
 *
 * Nothing new to set. A control whose correct position can be worked out
 * from a number already on the clip is a control that should not exist.
 */
const FADE_SHORT = 0.05;
const FADE_LONG = 0.2;
const FADE_FLOOR_DB = 60;
const FADE_TAIL = 0.02;

/**
 * Sixty-five points a curve, and nine curves.
 *
 * Sixty-five so the midpoint is a point rather than between two, and because
 * `setValueCurveAtTime` interpolates linearly between them: at the shortest
 * fade this app allows - a millisecond, 48 samples - that is more points than
 * samples, and at the longest the error from straight lines between adjacent
 * points is far below anything audible.
 *
 * Nine because the mix has to be chosen per clip, and a curve built per clip
 * per pass would be sixty-five floats allocated several times a bar on the
 * path that feeds the audio thread. Nine steps quantises the mix by about an
 * eighth, which between two curves that are themselves close is nothing.
 */
const COSINE = 65;
const MIXES = 9;

const cosineAt = (t) => 0.5 + 0.5 * Math.cos(Math.PI * t);
const evenAt = (t) => {
  const fall = 10 ** ((-FADE_FLOOR_DB * t) / 20);
  if (t <= 1 - FADE_TAIL) return fall;
  return fall * cosineAt(Math.min(1, (t - (1 - FADE_TAIL)) / FADE_TAIL));
};

const RISES = [];
const FALLS = [];
for (let m = 0; m < MIXES; m += 1) {
  const mix = m / (MIXES - 1);
  const rise = new Float32Array(COSINE);
  const fall = new Float32Array(COSINE);
  for (let i = 0; i < COSINE; i += 1) {
    const t = i / (COSINE - 1);
    fall[i] = (1 - mix) * cosineAt(t) + mix * evenAt(t);
    // The rise is the fall read backwards, so a fade-in climbs the way its
    // matching fade-out descends.
    rise[i] = (1 - mix) * cosineAt(1 - t) + mix * evenAt(1 - t);
  }
  RISES.push(rise);
  FALLS.push(fall);
}

/**
 * The gain a fade of this length is at, a fraction of the way through it.
 *
 * The same arithmetic the curve table is built from, for anything that has
 * to DRAW a fade rather than apply one. Read off the same shape on purpose:
 * a panel that draws a cosine over a fade that is falling evenly is a picture
 * of a fade nobody is hearing.
 */
export function fadeGainAt(through, seconds, rising = false) {
  const mix = fadeShapeAt(seconds) / (MIXES - 1);
  const t = rising ? 1 - Math.max(0, Math.min(1, through)) : Math.max(0, Math.min(1, through));
  return (1 - mix) * cosineAt(t) + mix * evenAt(t);
}

/**
 * Where a pass's fade-out starts, and for how long it runs.
 *
 * Never before the fade-in has finished. When the two are shared out to fit,
 * the fall starts where the rise ends in exact arithmetic and can come out a
 * rounding step before it in floats - and a value curve with another event
 * inside it is a NotSupportedError, thrown out of the transport's pass, which
 * then never advances and books the same window again on every tick.
 */
export function fallOf(began, heard, fade) {
  const at = Math.max(began + fade.in, began + heard - fade.out);
  return { at, seconds: began + heard - at };
}

/** Which of the nine a fade of this length gets. */
export function fadeShapeAt(seconds) {
  const held = Math.max(0, Number(seconds) || 0);
  const mix = held <= FADE_SHORT ? 0
    : held >= FADE_LONG ? 1
      : (held - FADE_SHORT) / (FADE_LONG - FADE_SHORT);
  return Math.round(mix * (MIXES - 1));
}

export async function makeStage(ctx, project, {
  out = ctx.destination, transport, takes = new Map(), rides = {},
} = {}) {
  // A safety limiter, so that launching a fourth clip cannot make the output
  // louder than the converter can hold, sitting a decibel under full scale
  // because a sketch that reads exactly 0 dBFS is a sketch somebody will
  // export and wonder about.
  //
  // It was a DynamicsCompressorNode at threshold -1 with a ratio of twenty and
  // three milliseconds of attack, and it did not do that job. Measured in an
  // offline context with those exact settings, transient material pushed
  // twenty decibels over came out at +2.92 dBFS - 3.92 dB above the ceiling it
  // was set to - and even six decibels over got +1.50. Three milliseconds of
  // attack means anything faster than three milliseconds is past before the
  // gain has moved, and a ratio of twenty is not infinity. Neither is a
  // setting to tune: a compressor with a knee is the wrong shape for a
  // ceiling. See lib/limiter.js.
  const bus = ctx.createGain();
  const limiter = await makeLimiterNode(ctx);
  bus.connect(limiter.in);
  limiter.out.connect(out);

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
  // Which edit each row's slot last answered, so that a build overtaken by a
  // later one is torn down when it lands rather than left subscribed.
  const asked = [];
  let gone = false;

  /** How long a pass that is taken back takes to go, so it does not click off. */
  const LET_GO = 0.01;

  /**
   * The bar lines a take's passes begin on, inside one piece of the grid.
   *
   * A take kept free is a one-shot: it plays once, from the launch, at its
   * own length. A take kept as a loop plays from the top of every pass of
   * the clip, which is what all of them used to do whether it suited them
   * or not.
   *
   * Pass zero is the launch, and only a piece the launch falls in has a pass
   * zero in it - every later piece starts at pass one or beyond, because
   * `first` is measured from the anchor. So "once" is exactly "pass zero",
   * with no extra state to keep.
   */
  const passesIn = (piece, clip) => {
    const bars = clip.length;
    const anchor = piece.anchor ?? 0;
    const once = clip.fit === 'free';
    const first = Math.ceil((piece.from - anchor) / bars);
    const last = Math.ceil((piece.to - anchor) / bars);
    const found = [];
    for (let pass = first; pass < last; pass += 1) {
      if (once && pass !== 0) break;
      const at = anchor + pass * bars;
      if (at >= piece.from && at < piece.to) found.push(at);
    }
    return found;
  };

  /** Which pass this is: the scene, where it was launched from, and its bar line. */
  const passKey = (scene, anchor, at) => `${scene}:${anchor ?? 0}:${at}`;

  /**
   * Everything about a take's clip that decides what one of its passes
   * sounds like and when. A pass booked ahead of its bar line under one of
   * these and found under another by the time the bar line comes round was
   * booked for a clip somebody has since edited.
   */
  const soundOf = (clip) => JSON.stringify([
    clip.take, clip.nudge ?? 0, clip.fit, clip.length, clip.trim ?? null, clip.fade ?? null,
  ]);

  /**
   * One pass of a recording, started: at its bar line plus its nudge.
   *
   * `early` gives it a gain of its own after the fades, which nothing else
   * ever moves. That is what `letGo` ramps when a pass booked ahead of its
   * bar line has to be taken back - not the fade gain, whose curves an
   * overlapping ramp would throw on.
   *
   * Sources are remembered so that stopping can stop them: a buffer booked
   * a bar ahead will play into the silence otherwise, exactly as a note
   * would.
   */
  const startPass = (row, clip, at, buffer, { early = false } = {}) => {
    const once = clip.fit === 'free';
    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // The window the clip asks for, which is the whole take unless it has
    // been trimmed. Clamped against this buffer's real length rather than
    // trusted, because a clip recorded over with something shorter keeps
    // the trim it had.
    const { offset, length } = takeWindow(clip, buffer.duration);

    // Where the nudge puts it. Trim says which part of a take to play and
    // this says when: a note sung a beat late is in the wrong place, and
    // trimming the front only makes the take shorter and still late.
    //
    // Clamped to now, which only ever bites when the pass could not have
    // been known about sooner - a launch pressed less than a pickup's length
    // before its bar line, or a nudge made earlier while playing. Every
    // other early pass is booked ahead of its bar line by `bookAhead` and
    // starts where the nudge says. (They all used to be booked with the
    // window their bar line fell in, 0.12 s ahead, so anything earlier than
    // that was clamped on every pass: half a beat early never happened at
    // any tempo the sketchpad allows.)
    const want = clock.timeOf(at + (clip.nudge ?? 0));
    const began = Math.max(want, ctx.currentTime);

    // A fade at each edge, through a gain of its own. A cut through a
    // waveform is a step, and a step is a click.
    //
    // On every clip, not only trimmed ones. This used to read "only where
    // there is actually a cut - an untrimmed take already starts and ends
    // at whatever the microphone was doing", which was true of the start
    // and false of the end: a looping clip is stopped at its bar line a few
    // lines below whether or not it is trimmed, and that stop is as much a
    // cut as a trim is. So an untrimmed loop clicked once a bar, and the
    // comment explaining why it needed no fade is why nobody looked.
    //
    // And a raised cosine, which is what that comment always claimed and
    // the `linearRampToValueAtTime` under it never did. The difference is
    // not pedantic: a straight line leaves a corner where it meets full
    // gain, a corner is a discontinuity in the slope, and splatter from one
    // falls away as 1/f^2 rather than faster. Measured against the linear
    // ramp this replaces, same cut through the same 220 Hz tone, energy
    // above 5 kHz:
    //
    //      1 ms   -79.1  ->  -97.9     18.8 dB quieter
    //      5 ms   -92.8  -> -125.9     33.1 dB quieter
    //     10 ms   -99.2  -> -138.0     38.8 dB quieter
    // How long this pass is actually audible for, which is NOT the window
    // into the take. A loop is stopped at its bar line below, and a take
    // longer than its clip never reaches its own end - so a fade-out placed
    // at the end of the WINDOW is placed after the audio has already been
    // cut off, and does nothing at all. That is how this check first failed
    // with the fade in place: every edge faded, and the loop still stepped
    // a full 0.64 between two samples at every wrap.
    // From the clock rather than from `clipSeconds`, because the clock also
    // knows about the clamp above: on the very first pass `began` can be
    // later than the nudge asked for, and a fade placed from the nominal
    // length would then sit past the end of what is heard. The panel works
    // the same number out from the tempo, and `project.test.js` holds the
    // two formulas against each other so they cannot drift apart.
    const stopsAt = clock.timeOf(at + clip.length);
    const heard = heardFor(once ? 'free' : 'bars', length, stopsAt - began);

    const shaped = ctx.createGain();
    const fade = fadeFor(clip.fade, heard);
    shaped.gain.setValueAtTime(0, began);
    if (fade.in > 0) {
      shaped.gain.setValueCurveAtTime(RISES[fadeShapeAt(fade.in)], began, fade.in);
    }
    shaped.gain.setValueAtTime(1, began + fade.in);
    const fall = fallOf(began, heard, fade);
    if (fade.out > 0 && fall.seconds > 0) {
      shaped.gain.setValueCurveAtTime(FALLS[fadeShapeAt(fade.out)], fall.at, fall.seconds);
    }
    const cut = early ? ctx.createGain() : null;
    source.connect(shaped);
    (cut ? shaped.connect(cut) : shaped).connect(row.track.chain.in);

    source.start(began, offset, length);
    // A loop is never longer than the clip it is in, or a take a shade too
    // long would overlap the next pass of itself. This is also what makes
    // switching a free take back to a loop safe: the samples past the bar
    // line are still in the store, and the loop simply stops before them
    // rather than them having been thrown away.
    //
    // A free take has no next pass to overlap, so it runs to its own end.
    // It is still in `row.sounding`, so stopping the transport stops it.
    if (!once) source.stop(clock.timeOf(at + clip.length));
    source.onended = () => {
      row.sounding = row.sounding.filter((each) => each !== source);
    };
    row.sounding.push(source);
    return { source, cut, began };
  };

  /**
   * A pass booked ahead of its bar line, taken back.
   *
   * Not begun: stopped before its start, which per the spec means it plays
   * nothing at all. Begun - its pickup is already sounding when the launch
   * that replaces it comes - it plays up to the bar line and goes there,
   * over `LET_GO`, which is the place the clip it belonged to would have
   * ended anyway.
   */
  const letGo = (entry, at) => {
    const now = ctx.currentTime;
    if (entry.began > now) {
      try { entry.source.stop(); } catch { /* already stopped */ }
      return;
    }
    const from = Math.max(now, at);
    entry.cut.gain.setValueAtTime(1, from);
    entry.cut.gain.linearRampToValueAtTime(0, from + LET_GO);
    try { entry.source.stop(from + LET_GO); } catch { /* already stopped */ }
  };

  /**
   * The passes of recordings whose bar lines fall in this window.
   *
   * One booked ahead by `bookAhead` for this very pass is already playing,
   * and is claimed rather than started again. One booked ahead for a pass
   * that is not happening after all - another scene launched over it, the
   * row stopped - is taken back, at the bar line it would have begun on.
   */
  const bookTakes = (row, pieces, to) => {
    for (const piece of pieces) {
      const buffer = takes.get(piece.clip.take);
      if (!buffer) continue;
      for (const at of passesIn(piece, piece.clip)) {
        const key = passKey(piece.scene, piece.anchor, at);
        const ahead = row.ahead.get(key);
        if (ahead) {
          row.ahead.delete(key);
          if (ahead.sound === soundOf(piece.clip)) continue;
          letGo(ahead, ctx.currentTime);
        }
        startPass(row, piece.clip, at, buffer);
      }
    }
    for (const [key, entry] of row.ahead) {
      if (entry.at >= to) continue;
      row.ahead.delete(key);
      letGo(entry, clock.timeOf(entry.at));
    }
  };

  /**
   * The passes whose bar lines are still to come but whose nudge puts their
   * start in this window, booked now.
   *
   * Which clip a row will be playing at a bar line not yet booked is known:
   * it is the launch state with whatever is queued on it and whatever its
   * clip's follow says, run through the same `booking` arithmetic the
   * window itself is. So a pass nudged early is booked when its START comes
   * into the lookahead, rather than when its bar line does - and starts
   * where the nudge says, at any tempo, the way an offline render always had
   * it. Up to one bar ahead, which is the most a nudge can be.
   *
   * The cost of booking before the bar line is that something can still be
   * launched over it, which is why every window asks again: a pass this
   * window no longer predicts, or predicts for a clip that has since been
   * edited, is let go.
   */
  const bookAhead = (row, index, to) => {
    let state = row.launch;
    const due = following(state, clipAt(current, index, state.scene), current.scenes.length);
    if (due && due.at < to + MOST_NUDGE) state = queue(state, due.scene, due.at);
    const { pieces } = booking(to, to + MOST_NUDGE, state);

    const wanted = new Set();
    for (const piece of pieces) {
      const clip = clipAt(current, index, piece.scene);
      if (!isTake(clip) || !((clip.nudge ?? 0) < 0)) continue;
      const buffer = takes.get(clip.take);
      if (!buffer) continue;
      for (const at of passesIn(piece, clip)) {
        // Its start is still in a later window: booked then.
        if (at + clip.nudge >= to) continue;
        const key = passKey(piece.scene, piece.anchor, at);
        const sound = soundOf(clip);
        wanted.add(key);
        const had = row.ahead.get(key);
        if (had?.sound === sound) continue;
        if (had) letGo(had, ctx.currentTime);
        row.ahead.set(key, { ...startPass(row, clip, at, buffer, { early: true }), at, sound });
      }
    }
    for (const [key, entry] of row.ahead) {
      if (wanted.has(key)) continue;
      row.ahead.delete(key);
      letGo(entry, clock.timeOf(entry.at));
    }
  };

  /**
   * A fader moved while the music is playing, booked with the notes.
   *
   * `riding` is an option rather than part of the project, and that was a
   * choice about blast radius: a track's shape is a whitelist in
   * `project.js`, so putting automation on it would mean the save format,
   * everything that validates a project, and the sketchpad's own panels -
   * for something only the mix exercise asks for. Handed in, nothing else
   * changes, and a stage with no rides on it behaves exactly as it did.
   *
   * Booked in the same window the notes are, so it is as early as they are
   * and it survives a clock driven by hand in an offline render, which is
   * how everything here gets measured.
   *
   * A staircase rather than a ramp, and how fine a staircase is
   * `RIDE_STEPS` in `lib/tempo.js` - where both ends of this can reach it,
   * since `sketch` may not import `mix` and the exercise lives over there.
   */
  const bookRide = (row, index, from, to) => {
    // The track as it is now, not as it was when the row was built: a fader
    // move replaces the track object without rebuilding the row.
    const spec = current.tracks[index];
    const depth = spec && rides[spec.id];
    if (!depth) return;

    const clip = clipAt(current, index, 0);
    const loop = clip?.length ?? clock.perBar;
    const step = Math.max(1, Math.round(clock.perBar / RIDE_STEPS));

    for (let tick = Math.ceil(from / step) * step; tick < to; tick += step) {
      const through = ((tick % loop) + loop) % loop / loop;
      row.track.set(
        { gain: spec.gain * 10 ** ((depth * (through - 0.5)) / 20) },
        clock.timeOf(tick),
      );
    }
  };

  /** Everything a row has booked, stopped - the passes booked ahead with it. */
  const hush = (row, at = ctx.currentTime) => {
    for (const source of row.sounding) {
      try { source.stop(at); } catch { /* already stopped */ }
      try { source.disconnect(); } catch { /* already gone */ }
    }
    row.sounding = [];
    // Forgotten as well as stopped. Play again and the anchors start from
    // nought again, so the same keys come back - and a pass found under its
    // key is taken to be playing already, and is not booked.
    row.ahead.clear();
  };

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
      options: optionsOf(spec, takes),
    });
    track.out.connect(bus);
    track.send.connect(verb.in);
    track.set({ muted: spec.muted });

    const row = {
      track, stamp: graphStamp(spec), launch: resting(), off: null, sounding: [],
      // Passes nudged ahead of a bar line not yet booked, by `passKey`.
      ahead: new Map(),
    };

    row.off = playPieces(clock, track, (from, to) => {
      bookRide(row, index, from, to);

      // Asked before the window is booked, not after: a follow landing
      // inside it has to be queued first so that `booking` splits there -
      // the old clip up to the handover and the new one after it, which is
      // the same thing a press on the next bar line gets.
      const due = following(
        row.launch,
        clipAt(current, index, row.launch.scene),
        current.scenes.length,
      );
      if (due && due.at < to) row.launch = queue(row.launch, due.scene, due.at);

      const { pieces, state } = booking(from, to, row.launch);
      row.launch = state;

      const booked = pieces.map((piece) => ({
        ...piece, clip: clipAt(current, index, piece.scene),
      }));

      // A recording is not notes, so `playPieces` has nothing to do with it:
      // every pass of the loop is one buffer, started at the tick that pass
      // begins on and playing through this track's own inserts and fader -
      // and, when it is nudged early, booked ahead of that tick.
      bookTakes(row, booked.filter((piece) => isTake(piece.clip)), to);
      bookAhead(row, index, to);

      return booked.filter((piece) => !isTake(piece.clip));
    });

    return row;
  };

  rows.push(...await Promise.all(current.tracks.map(build)));

  const tear = (row) => { row.off?.(); hush(row); row.track.destroy(); };

  /** When a launch lands: the next bar line if running, now if not. */
  const when = () => (clock.playing ? nextBar(clock.scheduled, clock.perBar) : 0);

  /**
   * The side chains, wired.
   *
   * Post-fader, from the source track's output, so turning the kit down
   * takes the ducking with it - which is what anybody would expect, and the
   * alternative is a mute that stops the sound and leaves the pumping.
   *
   * Done in one pass over the whole project rather than per track, because
   * whether an edge may be made at all is a question about the others: see
   * `keyRoutes` for the loop it is there to refuse.
   */
  const wireKeys = () => {
    const { kept } = keyRoutes(current);
    const wanted = new Map(kept.map(({ track, from }) => [track, from]));

    rows.forEach((row, at) => {
      const comp = row.track.chain.effects.find((each) => each.id === 'compression');
      if (!comp?.keyFrom) return;
      const from = wanted.get(at);
      comp.keyFrom(from === undefined ? null : rows[from]?.track.out ?? null);
    });
  };

  wireKeys();

  return {
    transport: clock,
    get project() { return current; },
    get playing() { return clock.playing; },
    get bar() { return clock.bar; },
    get tick() { return clock.tick; },

    /** Where each row is and what it is waiting for, for the grid to draw. */
    get state() {
      return rows.map(({ launch }) => ({
        scene: launch.scene, anchor: launch.anchor, next: launch.next,
      }));
    },

    /** The recordings this stage can play, by id. Shared, so it is live. */
    takes,

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

      // Every slot this edit speaks for, including the ones it takes away,
      // so a build still running from an earlier edit is overtaken.
      const slots = Math.max(next.tracks.length, rows.length, asked.length);
      for (let index = 0; index < slots; index += 1) asked[index] = (asked[index] ?? 0) + 1;

      await Promise.all(next.tracks.map(async (spec, index) => {
        const row = rows[index];
        if (!row || graphStamp(spec) !== row.stamp) {
          const mine = asked[index];
          const built = await build(spec, index);
          if (gone || asked[index] !== mine) { tear(built); return; }
          // The old row plays on until its replacement is ready, and hands
          // over where it had got to.
          const old = rows[index];
          if (old) { built.launch = old.launch; tear(old); }
          rows[index] = built;
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

      wireKeys();
    },

    /**
     * What the faders are doing over time, which the mix exercise changes
     * while it plays. Takes effect from the next window booked.
     */
    setRides(next) {
      rides = next ?? {};
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
        hush(row);
      }
    },

    destroy() {
      gone = true;
      clock.stop();
      for (const row of rows) tear(row);
      rows.length = 0;
      verb.destroy();
      // The limiter is a wrapper, not a node: its worklet is `node`.
      try { limiter.destroy?.(); } catch { /* already gone */ }
      for (const node of [bus, limiter.node, returns]) {
        try { node?.disconnect(); } catch { /* already gone */ }
      }
    },
  };
}
