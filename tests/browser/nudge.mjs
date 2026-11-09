// An early nudge, heard live: does a take nudged ahead of its bar line start
// where the nudge says, and what happens to it when something else is
// launched over it.
//
// Live and not offline, on purpose. An offline render's clock stands at zero
// while it is booked, so nothing booked is ever in the past and every nudge
// comes out exact - which is how stem exports had early nudges right all
// along while playback had them wrong. Playback books 0.12 s ahead, and a
// pass was booked when its bar line came into that window: an early nudge
// past 0.12 s asked to start in the past and was clamped to "now". At 96 bpm
// "half a beat early" asked for 0.31 s and got about 0.1, a different amount
// each pass with the timer, and at no tempo the sketchpad allows (40-220 bpm)
// did half a beat early ever happen.
//
// So the start time every pass is booked at is recorded, through the source
// node's own `start`, and held to the time the nudge asks for. And because
// booking a pass early means booking it before anyone could still launch
// something else on that bar, the two launches that can come after it are
// held too: one before its pickup starts, which must leave it unheard, and
// one after, which must stop it at the bar line rather than let it run on.

import { open } from './harness.mjs';

export const name = 'nudge';

/** How far off a booked start may be, in seconds: a sample at 48 kHz, plenty over. */
const EXACT = 0.002;

export async function check({ browser, at, say }) {
  const problems = [];
  const { page, noise } = await open(browser, at);

  const runs = await page.evaluate(async () => {
    const { makeStage } = await import('./src/sketch/stage.js');
    const { newProject, setClip, setTrack, clipOf, barTicks } = await import('./src/sketch/project.js');
    const { PPQ } = await import('./src/sketch/midi.js');

    const BPM = 96;
    const NUDGE = -PPQ / 2;

    // Every start and stop booked on a source playing one of these takes,
    // with when it was booked for and when it was asked.
    const booked = [];
    const start = AudioBufferSourceNode.prototype.start;
    const stop = AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.start = function (when = 0, ...rest) {
      if (this.buffer?.label) {
        this.record = { take: this.buffer.label, start: when, asked: this.context.currentTime, stops: [] };
        booked.push(this.record);
      }
      return start.call(this, when, ...rest);
    };
    AudioBufferSourceNode.prototype.stop = function (when = 0, ...rest) {
      this.record?.stops.push({ when, asked: this.context.currentTime });
      return stop.call(this, when, ...rest);
    };

    const sleepUntil = (ctx, t) => new Promise((resolve) => {
      const tick = () => (ctx.currentTime >= t ? resolve() : setTimeout(tick, 5));
      tick();
    });

    const run = async (plan) => {
      booked.length = 0;
      const ctx = new AudioContext({ sampleRate: 48000 });
      await ctx.resume();
      const takeOf = (label, hz) => {
        const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i += 1) data[i] = 0.2 * Math.sin((2 * Math.PI * hz * i) / ctx.sampleRate);
        buffer.label = label;
        return buffer;
      };

      let project = newProject({ bpm: BPM });
      project.tracks.forEach((_, i) => { if (i > 0) project = setTrack(project, i, { muted: true }); });
      project = setTrack(project, 0, { instrument: 'mic' });
      const bar = barTicks(project);
      project = setClip(project, 0, 0, clipOf({
        take: 'early', notes: [], fit: 'bars', length: bar, nudge: NUDGE,
      }));
      project = setClip(project, 0, 1, clipOf({ take: 'other', notes: [], fit: 'bars', length: bar }));

      const stage = await makeStage(ctx, project, {
        out: ctx.destination,
        takes: new Map([['early', takeOf('early', 220)], ['other', takeOf('other', 330)]]),
      });
      const clock = stage.transport;
      stage.launchScene(0);
      stage.play();

      const bars = [];
      for (let n = 0; n < 6; n += 1) bars.push(clock.timeOf(n * bar));
      const pickup = (n) => clock.timeOf(n * bar + NUDGE);

      if (plan.press !== undefined) {
        // `press` is when to launch scene 1, as seconds before bar 3's pickup
        // begins: positive is before it, negative after it has started.
        await sleepUntil(ctx, pickup(3) - plan.press);
        stage.launchScene(1);
      }
      await sleepUntil(ctx, bars[5]);
      stage.stop();
      const out = {
        bars, pickups: bars.map((_, n) => pickup(n)),
        booked: booked.map((b) => ({ ...b })),
        lookahead: clock.lookahead,
      };
      stage.destroy();
      await ctx.close();
      return out;
    };

    return {
      steady: await run({}),
      early: await run({ press: 0.25 }),
      // After the pickup is booked - 0.12 s before it starts - and before
      // it starts: the case where it has to be stopped rather than not made.
      between: await run({ press: 0.05 }),
      late: await run({ press: -0.06 }),
    };
  });

  /* --- exact: every pass after the first starts where the nudge says --- */

  const { steady } = runs;
  const passes = steady.booked.filter((b) => b.take === 'early');
  say(`  half a beat early at 96 bpm asks for ${(steady.bars[1] - steady.pickups[1]).toFixed(3)} s;`
    + ` the transport books ${steady.lookahead} s ahead`);
  say('  pass   wanted     booked     off by');
  for (let n = 1; n <= 4; n += 1) {
    const want = steady.pickups[n];
    const got = passes.find((b) => Math.abs(b.start - want) < 0.5);
    const off = got ? got.start - want : NaN;
    say(`  ${n}      ${want.toFixed(3)}    ${got ? got.start.toFixed(3) : '   -   '}    ${got ? `${(off * 1000).toFixed(1)} ms` : 'not booked'}`);
    if (!got) problems.push(`pass ${n} of the early-nudged loop was never booked`);
    else if (Math.abs(off) > EXACT) {
      problems.push(`pass ${n} was booked ${(off * 1000).toFixed(0)} ms off its nudged time`
        + ' - an early nudge past the lookahead is being clamped');
    }
  }

  /* --- a launch over it, wherever the press lands --- */

  // Held to what must be true wherever the press actually lands rather than
  // where it was aimed. The press comes off a timer polling the audio clock,
  // and on a loaded machine it can land a window later than meant - which
  // moved a launch to the next bar and failed this once in sixteen runs for
  // the check's own timing, not the stage's. So: find the bar the new clip
  // really started on, and the old clip's pass for that same bar must be
  // unheard past the bar line - never booked, stopped before it began, or
  // let go within a few milliseconds of the line. Which of those it was is
  // reported, so a run that took an unexpected branch still says so.
  const settle = (label, got) => {
    const firsts = got.booked.filter((b) => b.take === 'other').map((b) => b.start);
    const landed = got.bars.findIndex((t) => firsts.some((f) => Math.abs(f - t) < EXACT));
    if (landed < 1) {
      problems.push(`${label}: the clip launched over the early-nudged one did not start on a bar line`);
      return;
    }
    const pass = got.booked.find((b) => b.take === 'early' && Math.abs(b.start - got.pickups[landed]) < 0.05);
    const first = pass?.stops.length ? Math.min(...pass.stops.map((one) => one.when)) : Infinity;
    const unbegun = pass && pass.stops.some((one) => one.asked < pass.start && one.when <= pass.start + 1e-6);
    const onLine = pass && first >= got.bars[landed] - 1e-6 && first <= got.bars[landed] + 0.03;
    const what = !pass ? 'was never booked'
      : unbegun ? 'was booked, and stopped before it began'
        : onLine ? `had begun, and stopped ${((first - got.bars[landed]) * 1000).toFixed(1)} ms after the bar line`
          : `played on to ${(first - got.bars[landed]).toFixed(3)} s past the bar line`;
    say(`  ${label}: the new clip came in on bar ${landed}; the old clip's pickup for it ${what}`);
    if (pass && !unbegun && !onLine) {
      problems.push(`${label}: the replaced clip's pickup for bar ${landed} ${what}`);
    }
  };
  say('');
  settle('pressed 0.25 s before the pickup', runs.early);
  settle('pressed 0.05 s before it', runs.between);
  settle('pressed 0.06 s after it began', runs.late);

  problems.push(...noise);
  await page.close();
  return problems;
}
