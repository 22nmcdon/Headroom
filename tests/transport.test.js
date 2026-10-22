// The clock, against a clock a test makes up.
//
// A loop that drifts is not a loop, and the whole design of `transport.js` is
// about one decision: every event's time is worked out from a fixed origin
// rather than from the event before it. That decision is invisible in the
// source - both versions are one line - and it is what these tests are for.
//
// `now` and `every` are injected, so the clock below can jump, stall, fire
// late and fire twice, which is what a real timer does on a loaded phone and
// what no test using a real one would ever reliably reproduce.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  Transport, loopWindows, ticksPerBar, tickSeconds, nextBar, barOf, LOOKAHEAD,
} from '../src/sketch/transport.js';
import { PPQ } from '../src/sketch/midi.js';

/**
 * A clock that only moves when told, and a timer that only fires when told.
 *
 * `tick(seconds)` moves time forward and fires the transport's pass the
 * number of times a real timer would have - which is what lets a test say
 * "now the page froze for 300 ms" and see what the scheduler does about it.
 */
function fakeClock() {
  let at = 0;
  const timers = [];

  return {
    now: () => at,
    every: (ms, fn) => { timers.push({ ms, fn, next: at + ms / 1000 }); return timers.length - 1; },
    clear: (id) => { timers[id] = null; },

    /** Move time on, firing timers as they come due. */
    run(seconds, { fireTimers = true } = {}) {
      const end = at + seconds;
      for (;;) {
        const due = timers
          .filter(Boolean)
          .filter((timer) => timer.next <= end)
          .sort((a, b) => a.next - b.next)[0];
        if (!due || !fireTimers) break;
        at = due.next;
        due.next = at + due.ms / 1000;
        due.fn();
      }
      at = end;
    },

    /** Move time on without firing anything: the page froze. */
    freeze(seconds) { at += seconds; },
  };
}

/** A transport on a fake clock, with everything it schedules recorded. */
function rig(options = {}) {
  const clock = fakeClock();
  const booked = [];
  const t = new Transport({ now: clock.now, every: clock.every, clear: clock.clear, ...options });
  t.onSchedule((from, to, timeOf) => booked.push({ from, to, at: clock.now(), timeOf }));
  return { clock, t, booked };
}

/* --- the arithmetic ------------------------------------------------------- */

test('a tick is a tick whatever the time signature, because tempo is per quarter', () => {
  // 96 bpm is 0.625 s a quarter, and a quarter is PPQ ticks.
  assert.ok(Math.abs(tickSeconds(96) - 0.625 / PPQ) < 1e-12);
  assert.ok(Math.abs(tickSeconds(120) - 0.5 / PPQ) < 1e-12);
});

test('a bar is as long as its time signature says, and six-eight is three quarters', () => {
  assert.equal(ticksPerBar(4, 4), PPQ * 4);
  assert.equal(ticksPerBar(3, 4), PPQ * 3);
  assert.equal(ticksPerBar(6, 8), PPQ * 3, 'six eighths is three quarters, not six');
  assert.equal(ticksPerBar(7, 8), Math.round(PPQ * 3.5));
  assert.equal(ticksPerBar(5, 4), PPQ * 5);
});

test('the next bar line is the next one, and a bar line is its own next', () => {
  const perBar = PPQ * 4;
  assert.equal(nextBar(0, perBar), 0);
  assert.equal(nextBar(1, perBar), perBar);
  assert.equal(nextBar(perBar - 1, perBar), perBar);
  assert.equal(nextBar(perBar, perBar), perBar, 'already on the line');
  assert.equal(nextBar(perBar + 1, perBar), perBar * 2);

  assert.equal(barOf(0, perBar), 1, 'bars count from one, the way a DAW shows them');
  assert.equal(barOf(perBar - 1, perBar), 1);
  assert.equal(barOf(perBar, perBar), 2);
});

/* --- wrapping a window around a loop -------------------------------------- */

test('a window inside one pass of a loop is that window', () => {
  assert.deepEqual(loopWindows(100, 200, 1000), [{ from: 100, to: 200, offset: 0 }]);
});

test('a window across the loop point comes back as the two pieces it is', () => {
  // The end of one pass and the start of the next, each with the offset that
  // puts it back on the timeline.
  assert.deepEqual(loopWindows(900, 1100, 1000), [
    { from: 900, to: 1000, offset: 0 },
    { from: 0, to: 100, offset: 1000 },
  ]);
});

test('a window ending exactly on the loop point does not emit an empty piece', () => {
  assert.deepEqual(loopWindows(900, 1000, 1000), [{ from: 900, to: 1000, offset: 0 }]);
});

test('a window starting exactly on the loop point belongs to the pass beginning', () => {
  // The half-open rule, and the reason for it: an event exactly on the loop
  // point counted in both pieces would fire twice every pass.
  assert.deepEqual(loopWindows(1000, 1100, 1000), [{ from: 0, to: 100, offset: 1000 }]);
});

test('a window longer than the loop emits every pass it covers', () => {
  const pieces = loopWindows(0, 2500, 1000);
  assert.deepEqual(pieces, [
    { from: 0, to: 1000, offset: 0 },
    { from: 0, to: 1000, offset: 1000 },
    { from: 0, to: 500, offset: 2000 },
  ]);
});

test('an empty or backwards window is nothing, and a loop of no length does not wrap', () => {
  assert.deepEqual(loopWindows(500, 500, 1000), []);
  assert.deepEqual(loopWindows(600, 500, 1000), []);
  assert.deepEqual(loopWindows(0, 100, 0), [{ from: 0, to: 100, offset: 0 }]);
});

/* --- no drift ------------------------------------------------------------- */

test('an event an hour in is where arithmetic says it is, not where adding up says', () => {
  // The decision this file exists for. Each time is `startedAt + tick * per`,
  // so nothing accumulates. Adding a beat's length on each time - the obvious
  // way to write it - loses a little on every one of these.
  const { t } = rig({ bpm: 96 });
  t.startedAt = 0;

  const perBeat = PPQ;
  const beatSeconds = 60 / 96;

  for (const beat of [1, 100, 10000, 345600]) {
    const want = beat * beatSeconds;
    assert.ok(Math.abs(t.timeOf(beat * perBeat) - want) < 1e-9,
      `beat ${beat} lands at ${t.timeOf(beat * perBeat)}, not ${want}`);
  }

  // And a tempo whose beat is not a round number of anything.
  t.setTempo(97.3);
  const odd = 60 / 97.3;
  assert.ok(Math.abs(t.timeOf(10000 * perBeat) - 10000 * odd) < 1e-6);
});

test('time and tick are inverses of each other', () => {
  const { t } = rig({ bpm: 128 });
  t.startedAt = 3.5;
  for (const tick of [0, 1, PPQ, PPQ * 4, 123456]) {
    assert.ok(Math.abs(t.tickAt(t.timeOf(tick)) - tick) < 1e-6);
  }
});

/* --- the scheduling loop -------------------------------------------------- */

test('starting books the first window before the timer has fired at all', () => {
  // Otherwise the opening beat is a timer interval late, which at 25 ms is
  // audible and at the first wake after a page load can be far worse.
  const { t, booked } = rig();
  t.start();
  assert.equal(booked.length, 1);
  assert.equal(booked[0].from, 0);
  assert.ok(booked[0].to > 0);
});

test('windows are contiguous: nothing is booked twice and nothing is skipped', () => {
  const { clock, t, booked } = rig({ bpm: 96 });
  t.start();
  clock.run(4);

  assert.ok(booked.length > 20, `only ${booked.length} passes in four seconds`);
  for (let i = 1; i < booked.length; i += 1) {
    assert.equal(booked[i].from, booked[i - 1].to,
      `pass ${i} starts at ${booked[i].from} where the last ended at ${booked[i - 1].to}`);
  }
  assert.equal(booked[0].from, 0);
});

test('everything is booked before it is due, with the lookahead to spare', () => {
  // The promise a lookahead scheduler makes: by the time an event's audio
  // time arrives, it was handed to the audio clock a while ago.
  const { clock, t, booked } = rig({ bpm: 140 });
  t.start();
  clock.run(3);

  for (const pass of booked) {
    const earliest = pass.timeOf(pass.from);
    assert.ok(earliest >= pass.at - 1e-9,
      `a window starting at ${earliest} was booked at ${pass.at}, which is late`);
  }
});

test('a frozen page catches up without losing a beat', () => {
  // What actually happens on a phone: the tab stalls, the timer does not
  // fire, and then everything fires at once. A scheduler that booked from
  // "now" would skip whatever happened during the freeze; this one books
  // from where it got to, so nothing is lost - it is just booked late.
  const { clock, t, booked } = rig({ bpm: 96 });
  t.start();
  clock.run(1);
  const before = booked[booked.length - 1].to;

  clock.freeze(0.4);
  clock.run(0.1);

  const after = booked[booked.length - 1];
  assert.equal(booked.find((pass) => pass.from === before).from, before,
    'the next window picks up exactly where the last one stopped');
  assert.ok(after.to > t.tickAt(clock.now() - 0.001), 'and it has caught up past the freeze');

  for (let i = 1; i < booked.length; i += 1) {
    assert.equal(booked[i].from, booked[i - 1].to, 'still gapless across the freeze');
  }
});

test('a pass with nothing new to book does nothing', () => {
  // Two timer fires inside one lookahead window should not produce an empty
  // window, which every listener would then have to guard against.
  const { clock, t, booked } = rig({ interval: 1 });
  t.start();
  const first = booked.length;
  clock.run(0.002);
  for (const pass of booked.slice(first)) assert.ok(pass.to > pass.from);
});

test('stopping leaves the position where it was, and starting again goes on from there', () => {
  const { clock, t } = rig({ bpm: 96 });
  t.start();
  clock.run(2.5); // a bar at 96 in four is 2.5 s
  t.stop();

  const at = t.tick;
  assert.ok(Math.abs(at - PPQ * 4) < PPQ, `stopped at tick ${at}, not near the bar line`);
  assert.equal(t.playing, false);

  clock.run(5);
  assert.equal(t.tick, at, 'a stopped transport does not move');

  t.start(clock.now(), at);
  assert.ok(Math.abs(t.tick - at) < 1, 'and picks up where it was');
});

/* --- launching on the bar -------------------------------------------------- */

test('a launch waits for the bar line, and lands on it', () => {
  const { clock, t } = rig({ bpm: 96 });
  const perBar = PPQ * 4;
  const fired = [];

  t.start();
  clock.run(1); // part way into bar one
  t.launch((at) => fired.push(at));

  assert.deepEqual(fired, [], 'not yet - it is the middle of a bar');
  clock.run(2);
  assert.equal(fired.length, 1);
  assert.equal(fired[0], perBar, 'exactly on bar two');
});

test('a launch runs before the window that covers it is booked', () => {
  // Which is the point of running it from inside the pass: whatever the
  // launch changes - a new clip in a slot - has to be in place before the
  // listeners are asked what happens in that window, or the first bar of it
  // is silence.
  const { clock, t } = rig({ bpm: 96 });
  const order = [];

  t.onSchedule((from, to) => order.push(`window ${from}-${Math.round(to)}`));
  t.start();
  clock.run(1);
  t.launch(() => order.push('launch'));
  clock.run(2);

  const launched = order.indexOf('launch');
  assert.ok(launched > 0);
  const window = order[launched + 1];
  assert.ok(window?.startsWith('window'), 'a window follows the launch it belongs to');
  assert.ok(Number(window.split(' ')[1].split('-')[1]) > PPQ * 4,
    'and that window reaches past the bar line');
});

test('a launch on a stopped transport happens now, because there is no bar to wait for', () => {
  const { t } = rig();
  const fired = [];
  t.launch((at) => fired.push(at));
  assert.deepEqual(fired, [0]);
});

test('launches can be quantised to something other than a bar, or to nothing', () => {
  const { clock, t } = rig({ bpm: 96 });
  const fired = [];

  t.start();
  clock.run(0.1);
  t.launch((at) => fired.push(at), { quantise: PPQ }); // the next beat
  clock.run(1);
  assert.equal(fired[0] % PPQ, 0);
  assert.ok(fired[0] <= PPQ * 2, `landed at ${fired[0]}, which is not the next beat or two`);
});

test('several launches at once all land on the same line', () => {
  // Which is what makes a scene a scene: press four clips, they come in
  // together rather than wherever each finger was.
  const { clock, t } = rig({ bpm: 96 });
  const fired = [];

  t.start();
  clock.run(0.3);
  for (const id of ['a', 'b', 'c', 'd']) t.launch((at) => fired.push([id, at]));
  clock.run(3);

  assert.equal(fired.length, 4);
  assert.equal(new Set(fired.map(([, at]) => at)).size, 1, 'all on one line');
  assert.equal(fired[0][1], PPQ * 4);
});

/* --- what a listener is actually handed ------------------------------------ */

test('a four-bar loop plays every one of its hits, once a pass', () => {
  // The spike, as a test: a pattern four bars long, run for three passes,
  // with every hit counted. The window arithmetic and the loop wrapping have
  // to agree or this comes out with a hole in it or a double.
  const { clock, t } = rig({ bpm: 140 });
  const perBar = PPQ * 4;
  const length = perBar * 4;
  const pattern = Array.from({ length: 16 }, (_, i) => i * PPQ); // one a beat
  const played = [];

  t.onSchedule((from, to, timeOf) => {
    for (const piece of loopWindows(from, to, length)) {
      for (const at of pattern) {
        if (at >= piece.from && at < piece.to) played.push(timeOf(at + piece.offset));
      }
    }
  });

  t.start();
  // Three passes of four bars at 140 bpm: 16 beats x 3 x (60/140).
  clock.run(16 * 3 * (60 / 140) + 0.2);

  // How many there should be is worked out from how far the booking actually
  // got, not from the stopwatch: the scheduler books past the end of the run
  // on purpose, and a test that expected exactly three passes would be
  // failing the lookahead for doing its job.
  const booked = t.scheduled;
  const expected = Math.ceil(booked / PPQ);
  assert.equal(played.length, expected, `played ${played.length} hits, not ${expected}`);
  assert.ok(expected >= 48, 'and at least the three passes asked for');
  assert.deepEqual([...played].sort((a, b) => a - b), played, 'in order');
  assert.equal(new Set(played.map((x) => x.toFixed(9))).size, expected, 'none of them twice');

  // Evenly spaced, to the nanosecond, from first to last.
  const beat = 60 / 140;
  for (let i = 1; i < played.length; i += 1) {
    assert.ok(Math.abs((played[i] - played[i - 1]) - beat) < 1e-9,
      `hit ${i} is ${(played[i] - played[i - 1]).toFixed(9)} s after the last, not ${beat}`);
  }
});

test('the lookahead is long enough to survive a timer that is late', () => {
  // 120 ms of notice against a 25 ms timer: four fires may be missed before
  // anything is booked late, which is the margin a loaded phone needs.
  assert.ok(LOOKAHEAD >= 0.1, 'less than a tenth of a second is not much notice');
  const { clock, t, booked } = rig();
  t.start();
  clock.freeze(LOOKAHEAD * 0.8);
  clock.run(0.05);
  const last = booked[booked.length - 1];
  assert.ok(last.timeOf(last.from) >= last.at - 1e-9, 'still booked ahead of time');
});

test('a tempo that is not a tempo is refused', () => {
  const { t } = rig();
  assert.throws(() => t.setTempo(0), /not a tempo/);
  assert.throws(() => t.setTempo(-96), /not a tempo/);
});
