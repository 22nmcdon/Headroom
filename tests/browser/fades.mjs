// The shape of a clip's edges, through the real stage.
//
// `project.js` has held a measurement since the trim went in: a 220 Hz sine
// cut at its peak puts 27.9 dB of energy above 5 kHz, and a few milliseconds
// of fade takes that away. `stage.js` applied that fade to trimmed clips
// only, with a comment saying why an untrimmed one did not need it - "an
// untrimmed take already starts and ends at whatever the microphone was
// doing".
//
// That is true of the start and false of the end. Fifteen lines below it,
// every looping source is stopped at its bar line whether or not it is
// trimmed, and that stop cuts straight through the waveform. So an untrimmed
// loop clicked once a bar, and the comment explaining why it did not need a
// fade is the reason nobody went looking.
//
// ## How a click is seen
//
// Not by ear and not by a spectrum: by the step itself. A 220 Hz sine at 48
// kHz moves at most 2*pi*220/48000 = 0.0288 per sample. A cut at its peak
// steps by the whole amplitude at once. So the largest sample-to-sample jump
// in a window is the measurement, the tone's own slope is the floor, and
// between the two there is a factor of about thirty - which is a reading
// nobody has to squint at.
//
// ## The claims
//
// A looping take does not click at the bar line it loops on. A fade set long
// enough to hear is a fade that is actually there in the audio. And neither
// of those costs the middle of the clip any level, because a fade that quiets
// what it is not shaping is a volume control.

import { open } from './harness.mjs';

export const name = 'fades';

/**
 * The tone - and the quarter cycle on the end of it, which is the whole test.
 *
 * A bar at 120 in four is two seconds, and 220 Hz for two seconds is exactly
 * 440 cycles. A loop of that rejoins itself in perfect phase, so the first
 * version of this check measured a wrap with nothing wrong at it, found
 * nothing wrong, and passed - with the fade removed as well as with it.
 *
 * 220.125 Hz is 440.25 cycles a bar. The take is cut a quarter cycle in,
 * which is the peak of the sine, and the next pass begins at zero: the
 * largest step a loop of this tone can be made to take. Choosing the worst
 * case is the point. A frequency that divides the bar tests the arithmetic of
 * the bar line and nothing about fading it.
 *
 * (Half a cycle out would be no good either: the sine is at zero on both
 * sides of that cut, so the step is nothing and only the slope flips.)
 */
const HZ = 220.125;
const RATE = 48000;
const BPM = 120;

/** What this sine can do between two samples, which is the floor. */
const SLOPE = (2 * Math.PI * HZ) / RATE;

export async function check({ browser, at, say }) {
  const problems = [];
  const { page, noise } = await open(browser, at, { view: 'sketch', height: 1000 });
  await page.waitForTimeout(400);

  const measured = await page.evaluate(async ({ hz, rate, bpm }) => {
    const { newProject, setClip, setTrack, setFade, barTicks } = await import('./src/sketch/project.js');
    const { makeStage } = await import('./src/sketch/stage.js');
    const { Transport } = await import('./src/sketch/transport.js');

    const bar = (60 / bpm) * 4;

    /** Run a scene through the real stage and hand back the samples. */
    const render = async (shape, seconds) => {
      const ctx = new OfflineAudioContext(1, Math.ceil(rate * seconds), rate);

      // A tone that runs past the bar line, so the bar line is a cut through
      // the middle of it rather than the end of the recording.
      const tone = ctx.createBuffer(1, Math.round(rate * bar * 2), rate);
      const face = tone.getChannelData(0);
      for (let i = 0; i < face.length; i += 1) {
        face[i] = Math.sin((2 * Math.PI * hz * i) / rate) * 0.9;
      }

      let project = newProject({ bpm });
      project.tracks.forEach((_, i) => { if (i > 0) project = setTrack(project, i, { muted: true }); });
      project = setTrack(project, 0, { instrument: 'mic', gain: 1, pan: 0 });
      project = setClip(project, 0, 0, {
        take: 'tone', notes: [], fit: shape.fit ?? 'bars', length: barTicks(project),
      });
      if (shape.fade) project = setFade(project, 0, 0, shape.fade);

      let clock = 0;
      const transport = new Transport({
        now: () => clock, every: () => null, clear: () => {},
        lookahead: 0, bpm, beats: 4, value: 4,
      });
      const stage = await makeStage(ctx, project, {
        out: ctx.destination, transport, takes: new Map([['tone', tone]]),
      });
      stage.launchScene(0);
      stage.play();
      for (clock = 0; clock < seconds; clock = Math.min(seconds, clock + 0.05)) {
        transport.pass();
        if (clock === seconds) break;
      }
      const done = await ctx.startRendering();
      stage.destroy();
      return done.getChannelData(0);
    };

    /** The biggest step between two samples in a stretch, and where it is. */
    const biggestJump = (data, from, to) => {
      let worst = 0;
      let at = from;
      for (let i = Math.max(1, from); i < Math.min(data.length, to); i += 1) {
        const jump = Math.abs(data[i] - data[i - 1]);
        if (jump > worst) { worst = jump; at = i; }
      }
      return { jump: worst, at };
    };

    /** The loudest sample in a stretch, for reading an envelope off. */
    const peakIn = (data, from, to) => {
      let peak = 0;
      for (let i = Math.max(0, from); i < Math.min(data.length, to); i += 1) {
        peak = Math.max(peak, Math.abs(data[i]));
      }
      return peak;
    };

    // Four bars of a one-bar loop: three wraps in it somewhere.
    //
    // Somewhere, and found rather than assumed. This looked in a 40 ms window
    // either side of each nominal bar line and came back with the steady tone
    // every time - the clip starts about 65 ms after the line, so the windows
    // missed all three wraps by 45 ms and the check passed on a render that
    // had a full-scale step in it three times over. So: the largest step
    // anywhere in the whole render, which needs no theory about where the
    // scheduler put anything.
    const loop = await render({ fit: 'bars' }, bar * 3 + 0.2);
    const everyJump = [];
    for (let i = 1; i < loop.length; i += 1) {
      everyJump.push([Math.abs(loop[i] - loop[i - 1]), i / rate]);
    }
    everyJump.sort((a, b) => b[0] - a[0]);
    const worst = everyJump.slice(0, 3).map(([jump, when]) => ({ jump, when }));

    // A fade long enough to see, on a clip kept whole.
    const swelled = await render({ fit: 'free', fade: { in: 0.3, out: 0.3 } }, bar * 2);
    const envelope = [0.02, 0.1, 0.2, 0.3, 0.6].map((t) => ({
      t, peak: peakIn(swelled, Math.round(t * rate) - 240, Math.round(t * rate) + 240),
    }));

    return {
      loopPeak: peakIn(loop, 0, loop.length),
      worst,
      envelope,
      swelledPeak: peakIn(swelled, 0, swelled.length),
    };
  }, { hz: HZ, rate: RATE, bpm: BPM });

  say(`  a one-bar loop of a ${HZ} Hz tone, four bars of it, peak`
    + ` ${measured.loopPeak.toFixed(3)}`);
  // From what was rendered, not from what was planted: the track gain and the
  // master limiter take the 0.9 that went in down to about 0.64, and a floor
  // computed from the input is a floor 40% too high - which makes the
  // threshold below looser than it reads.
  const floor = measured.loopPeak * SLOPE;
  say(`  what the tone itself can do between two samples: ${floor.toFixed(4)}`);
  say('  the three largest steps anywhere in it:');
  for (const one of measured.worst) {
    say(`    ${one.jump.toFixed(4)} at ${one.when.toFixed(4)}s`);
  }

  if (!(measured.loopPeak > 0.3)) {
    problems.push(`the loop rendered at ${measured.loopPeak.toFixed(4)} - nothing was heard,`
      + ' so none of the readings below mean anything');
  } else {
    // Three times the tone's own steepest moment. Not one times it: the
    // fade's own curve adds a little, and a threshold at the floor is a
    // threshold that fails on arithmetic rather than on a click.
    const allowed = floor * 3;
    const click = measured.worst[0];
    if (click.jump > allowed) {
      problems.push(`the signal jumps ${click.jump.toFixed(4)} between two samples at`
        + ` ${click.when.toFixed(3)}s, and this tone at this level can only manage`
        + ` ${floor.toFixed(4)} - the loop is cut where it wraps and nothing fades it,`
        + ' which is a click once a bar');
    }
  }

  say(`\n  a 0.3s fade in, on a clip kept whole (peak ${measured.swelledPeak.toFixed(3)}):`);
  for (const step of measured.envelope) {
    say(`    at ${step.t.toFixed(2)}s  ${step.peak.toFixed(3)}`);
  }

  const [early, tenth, fifth, full] = measured.envelope;
  if (!(full.peak > 0.5)) {
    problems.push(`after the fade is over the clip peaks at ${full.peak.toFixed(3)}`
      + ' - a fade that quiets what it is not shaping is a volume control');
  }
  if (!(early.peak < full.peak * 0.25)) {
    problems.push(`20 ms into a 300 ms fade the clip is already at`
      + ` ${(early.peak / full.peak * 100).toFixed(0)}% - the fade is not there`);
  }
  if (!(tenth.peak < fifth.peak && fifth.peak < full.peak)) {
    problems.push(`the fade does not climb: ${tenth.peak.toFixed(3)} at 0.1s,`
      + ` ${fifth.peak.toFixed(3)} at 0.2s, ${full.peak.toFixed(3)} at 0.3s`);
  }

  problems.push(...noise);
  await page.close();
  return problems;
}
