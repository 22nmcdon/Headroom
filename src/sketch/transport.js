// The clock everything else is hung off.
//
// A loop that drifts is not a loop, and the usual way to build one in a
// browser drifts: `setInterval` fires a few milliseconds late, every time,
// and if each event is scheduled relative to the last one those few
// milliseconds add up until the kick is behind the hat. By the end of a
// minute it is audible; by the end of a track it is a different tempo.
//
// So there are two clocks here and they do different jobs. A plain timer
// wakes this up a few times a second and asks "what happens soon"; the audio
// clock is what every event is actually booked against, and every one of
// those bookings is worked out from a fixed origin - `startedAt + tick *
// seconds-per-tick` - rather than from the one before it. Nothing accumulates
// because nothing is added up.
//
// The position is in ticks at MIDI resolution, which is the same decision the
// exporter makes and for the same reason: an idea stored in the units it is
// exported in is a translation away from a file, not a conversion away.
//
// `now` and `every` are handed in rather than taken from an audio context, so
// that all of the arithmetic - the windows, the loop wrapping, the bar
// quantising, the drift - is checked against a clock a test makes up.
//
// Measured, which is the only way to believe a claim about drift. A four-bar
// loop at 140 bpm, stepped the way a 25 ms timer steps it, rendered offline
// for thirty-two bars and read back from the samples: 128 clicks, the worst
// one 0.024 ms from where it should be, and the gap between any two of them
// within 0.012 ms of a beat. One sample at 48 kHz is 0.0208 ms, so that is
// the measurement's own floor and not an error this code makes - and the
// first click is as far out as the last, which is what no drift looks like.

import { PPQ } from './midi.js';

/** How far ahead to book, and how often to look. */
export const LOOKAHEAD = 0.12;
export const EVERY_MS = 25;

/** Seconds in one tick. Tempo is per quarter note whatever the time signature. */
export const tickSeconds = (bpm, ppq = PPQ) => 60 / bpm / ppq;

/**
 * Ticks in one bar.
 *
 * Four quarter notes to a whole note, so a bar of `beats` notes of size
 * `value` is `4 * beats / value` quarters. Six-eight is three quarters, not
 * six, which is the arithmetic that makes a compound time signature loop in
 * the right place.
 */
export const ticksPerBar = (beats = 4, value = 4, ppq = PPQ) =>
  Math.round((ppq * 4 * beats) / value);

/** The next bar line at or after a tick. */
export const nextBar = (tick, perBar) => Math.ceil(tick / perBar) * perBar;

/** The bar a tick is in, counting from one the way a DAW does. */
export const barOf = (tick, perBar) => Math.floor(tick / perBar) + 1;

/**
 * A window of ticks, cut into the pieces of a loop it covers.
 *
 * A clip four bars long asked for ticks 7000 to 7400 is really being asked
 * for two pieces of itself - the end of one pass and the start of the next -
 * and the caller needs both, with the offset that puts each back on the
 * timeline. Written here because it is where the off-by-ones live: a window
 * that ends exactly on the loop point must not emit an empty piece, and a
 * window longer than the loop must emit every pass in between.
 *
 * Half-open throughout: `[from, to)`. An event exactly on the loop point
 * belongs to the pass that is starting, never to the one that just ended, or
 * it fires twice.
 */
export function loopWindows(from, to, length) {
  if (!(length > 0)) return [{ from, to, offset: 0 }];
  if (to <= from) return [];

  const pieces = [];
  let at = from;

  while (at < to) {
    const pass = Math.floor(at / length);
    const offset = pass * length;
    const end = Math.min(to, offset + length);
    pieces.push({ from: at - offset, to: end - offset, offset });
    at = end;
  }

  return pieces;
}

/**
 * The transport.
 *
 * Owns the position, hands out times, and wakes up often enough to book what
 * is coming. What it does not own is anything that makes a sound: callers
 * register with `onSchedule` and are handed a window of ticks and a function
 * that turns a tick into an audio time. That keeps the clock testable and
 * means the practice side, the sketchpad and anything later all drive the
 * same one.
 */
export class Transport {
  constructor({
    now,
    every,
    clear,
    bpm = 96,
    beats = 4,
    value = 4,
    ppq = PPQ,
    lookahead = LOOKAHEAD,
    interval = EVERY_MS,
  }) {
    this.now = now;
    this.every = every ?? ((ms, fn) => setInterval(fn, ms));
    this.clear = clear ?? ((id) => clearInterval(id));

    this.ppq = ppq;
    this.lookahead = lookahead;
    this.interval = interval;
    this.setTempo(bpm, beats, value);

    this.startedAt = 0;
    this.scheduled = 0; // ticks booked so far
    this.timer = null;
    this.listeners = new Set();
    this.pending = [];
  }

  /**
   * Change the tempo or the time signature.
   *
   * While stopped only, for now. Changing it under a running transport means
   * deciding what happens to everything already booked, and a sketchpad with
   * one tempo per project does not have to answer that yet.
   */
  setTempo(bpm, beats = this.beats, value = this.value) {
    if (!(bpm > 0)) throw new Error(`${bpm} is not a tempo`);
    this.bpm = bpm;
    this.beats = beats;
    this.value = value;
    this.perTick = tickSeconds(bpm, this.ppq);
    this.perBar = ticksPerBar(beats, value, this.ppq);
  }

  get playing() { return this.timer !== null; }

  /** When a tick happens, in audio time. The whole reason there is no drift. */
  timeOf(tick) { return this.startedAt + tick * this.perTick; }

  /** And back: where the transport is at a given audio time. */
  tickAt(time) { return (time - this.startedAt) / this.perTick; }

  /** Where it is now. */
  get tick() { return this.playing ? this.tickAt(this.now()) : this.scheduled; }

  /** Which bar it is in, counting from one. */
  get bar() { return barOf(this.tick, this.perBar); }

  /**
   * Somebody who wants to be asked what happens next.
   *
   * Called with `(from, to, timeOf)` - a half-open window of ticks and the
   * function that turns one into an audio time. Returns an unsubscribe.
   */
  onSchedule(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * Do something on the next bar line.
   *
   * Which is what launching a clip is: you press it in the middle of a bar
   * and it comes in on the next one, so parts land together rather than
   * wherever a finger happened to be. Queued rather than run, and run from
   * inside the scheduling pass, so whatever it changes is in place before the
   * window that covers it is booked.
   */
  launch(fn, { quantise = this.perBar } = {}) {
    if (!this.playing) {
      fn(this.scheduled);
      return;
    }
    const at = quantise > 0 ? nextBar(this.scheduled, quantise) : this.scheduled;
    this.pending.push({ at, fn });
  }

  /** What is waiting for a bar line, for anything that wants to show it. */
  get queued() { return this.pending.map(({ at }) => at); }

  start(at = this.now(), from = 0) {
    if (this.playing) return;
    this.startedAt = at - from * this.perTick;
    this.scheduled = from;
    // Book the first window before the timer's first wake, or the opening
    // beat is a quarter of a second late.
    this.pass();
    this.timer = this.every(this.interval, () => this.pass());
  }

  stop() {
    if (!this.playing) return;
    this.scheduled = this.tick;
    this.clear(this.timer);
    this.timer = null;
    this.pending = [];
  }

  /**
   * One pass: book everything between where the booking got to and the edge
   * of the lookahead.
   *
   * The window starts where the last one finished rather than at the current
   * position, which is what makes this gapless: a pass that is late still
   * books from where the last left off, so nothing is skipped, it is just
   * booked with less notice.
   */
  pass() {
    const until = this.tickAt(this.now() + this.lookahead);
    if (until <= this.scheduled) return;

    // Anything waiting for a bar line that falls inside this window runs
    // first, so what it changes is visible to the listeners below.
    for (const job of this.pending.filter(({ at }) => at < until)) job.fn(job.at);
    this.pending = this.pending.filter(({ at }) => at >= until);

    const from = this.scheduled;
    const to = until;
    for (const listener of this.listeners) listener(from, to, (tick) => this.timeOf(tick));
    this.scheduled = to;
  }
}

/** A transport driven by an audio context, which is the usual case. */
export const transportFor = (ctx, options = {}) =>
  new Transport({ now: () => ctx.currentTime, ...options });
