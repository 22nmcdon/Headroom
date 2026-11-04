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

import { open, shot } from './harness.mjs';

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

    // A fade long enough to be a gesture rather than a declick, sampled
    // across its length. A second, because that is where the curve is fully
    // the even one and where hanging-then-vanishing would be obvious.
    const swelled = await render({ fit: 'free', fade: { in: 1, out: 0.3 } }, bar * 2);
    const envelope = [0.1, 0.25, 0.5, 0.75, 1, 1.4].map((t) => ({
      t, peak: peakIn(swelled, Math.round(t * rate) - 480, Math.round(t * rate) + 480),
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

  const top = measured.swelledPeak;
  const asDb = (p) => (p > 0 ? 20 * Math.log10(p / top) : -Infinity);
  say(`\n  a 1s fade in, on a clip kept whole (peak ${top.toFixed(3)}):`);
  for (const step of measured.envelope) {
    say(`    at ${step.t.toFixed(2)}s  ${step.peak.toFixed(3)}`
      + `  ${asDb(step.peak) === -Infinity ? '  -inf' : asDb(step.peak).toFixed(1).padStart(6)} dB`);
  }

  const over = measured.envelope.filter((step) => step.t <= 1);
  const full = measured.envelope[measured.envelope.length - 1];
  if (!(full.peak > 0.5)) {
    problems.push(`after the fade is over the clip peaks at ${full.peak.toFixed(3)}`
      + ' - a fade that quiets what it is not shaping is a volume control');
  }

  // The claim the curve was changed for. A fade of a second is a gesture, and
  // what a gesture is judged on is falling - or climbing - at an even rate.
  // The raised cosine this replaced moved 3 dB in the first 73% of a long
  // fade and 32 dB in its last 10%, which reads as nothing happening and then
  // the sound disappearing.
  const climbs = [];
  for (let i = 1; i < over.length; i += 1) {
    const rise = asDb(over[i].peak) - asDb(over[i - 1].peak);
    if (Number.isFinite(rise)) climbs.push(rise / (over[i].t - over[i - 1].t));
  }
  if (climbs.length < 2) {
    problems.push('the fade could not be read across its length at all');
  } else {
    const slowest = Math.min(...climbs);
    const fastest = Math.max(...climbs);
    say(`    it climbs between ${slowest.toFixed(1)} and ${fastest.toFixed(1)} dB a second`
      + ` - a factor of ${(fastest / Math.max(0.01, slowest)).toFixed(1)}`);
    if (!(slowest > 0)) {
      problems.push(`part of the fade does not climb at all (${slowest.toFixed(1)} dB a second)`);
    } else if (fastest / slowest > 4) {
      problems.push(`the fade climbs between ${slowest.toFixed(1)} and ${fastest.toFixed(1)} dB`
        + ` a second - a factor of ${(fastest / slowest).toFixed(1)}, so it hangs at one end`
        + ' and rushes at the other rather than being a fade of one gesture');
    }
  }

  /* --- and the control that sets them ------------------------------------ */

  // The arithmetic above is all offline. This is the slider a person reaches
  // for: that it is there on a clip with a take in it, that moving it changes
  // what is stored, and that the number beside it says what was set. A fade
  // nobody can set is a constant with a comment.
  const driven = await page.evaluate(async () => {
    const { putTake } = await import('./src/sketch/takes.js');
    const { newProject, setClip, clipOf, barTicks } = await import('./src/sketch/project.js');
    const { saveSketch } = await import('./src/sketch/store.js');

    const rate = 48000;
    const channel = new Float32Array(rate * 3);
    for (let i = 0; i < channel.length; i += 1) {
      channel[i] = Math.sin((2 * Math.PI * 220 * i) / rate) * 0.7;
    }
    await putTake('take-for-fades', [channel], rate, { name: 'fades' });

    let project = newProject();
    project = setClip(project, 4, 0, clipOf({
      take: 'take-for-fades', notes: [], fit: 'free', length: barTicks(project) * 2,
    }));
    saveSketch(project);
    return true;
  });

  if (driven) {
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
    await page.click('[data-view="sketch"]');
    await page.waitForTimeout(400);
    // A gesture, so an audio context exists and the take can be decoded out
    // of storage. Without it the panel opens with an empty box where the
    // waveform goes - which is what the first screenshot of this showed,
    // and what this check had no claim about.
    await page.click('[data-play]');
    await page.waitForTimeout(500);
    await page.click('[data-play]');
    await page.waitForTimeout(300);
    await page.click('[data-cell="4:0"]');
    await page.waitForTimeout(1200);
    await page.click('[data-setup] summary').catch(() => {});
    await page.waitForTimeout(400);

    const before = await page.evaluate(() => ({
      sliders: [...document.querySelectorAll('[data-fade]')].map((el) => el.dataset.fade),
      read: [...document.querySelectorAll('[data-fade-read]')].map((el) => el.textContent.trim()),
    }));
    say(`\n  the control: ${before.sliders.length} sliders (${before.sliders.join(', ')}),`
      + ` reading ${before.read.join(' / ')}`);

    if (before.sliders.length !== 2) {
      problems.push(`a clip with a take in it offers ${before.sliders.length} fade controls`
        + ' rather than one for each of its two edges');
    } else {
      // Dragged by setting the value and dispatching the event the handler
      // listens for, which is what a drag amounts to from the page's side.
      const after = await page.evaluate(() => {
        const el = document.querySelector('[data-fade="in"]');
        el.value = '0.8';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return new Promise((ok) => setTimeout(() => ok({
          read: document.querySelector('[data-fade-read="in"]')?.textContent.trim() ?? '',
          label: document.querySelector('[data-fade="in"]')?.getAttribute('aria-label') ?? '',
        }), 200));
      });
      say(`  dragged the fade-in to 0.8 of its travel: it reads "${after.read}"`);

      const stored = await page.evaluate(async () => {
        const { loadSketch } = await import('./src/sketch/store.js');
        return loadSketch()?.tracks?.[4]?.slots?.[0]?.fade ?? null;
      });
      say(`  and what is saved: in ${stored?.in}, out ${stored?.out}`);

      if (!stored || !(stored.in > 0.3)) {
        problems.push(`the fade-in was dragged near the top of its travel and what was saved`
          + ` is ${stored?.in} - the control does not reach the clip`);
      }
      if (stored && Math.abs(stored.out - 0.005) > 1e-9) {
        problems.push(`setting the fade-in moved the fade-out to ${stored.out} as well`);
      }
      if (!/s$|ms$/.test(after.read)) {
        problems.push(`the readout says "${after.read}", which is not a length`);
      }
      // And the picture of it. A fade that is stored and not drawn is a fade
      // nobody can see the length of, which is most of why it is a control
      // rather than a constant. Counted in the first fifth of the canvas,
      // where a 0.44s fade on a 3s take has to leave ink.
      const drawn = await page.evaluate(() => {
        const canvas = document.querySelector('.clip-wave canvas');
        if (!canvas) return null;
        const { width, height } = canvas;
        const c = canvas.getContext('2d');
        // Away from the centre row, which is always drawn whether or not
        // there is a take: `drawWave` lays down a centre line even when it
        // has nothing to draw, so counting every lit pixel counts that line
        // and passes on an empty box. A 354x70 canvas at 2x has about 708
        // pixels of centre line in it, which is most of the 974 this check
        // first called proof that a waveform was there.
        const lit = (from, to) => {
          const { data } = c.getImageData(from, 0, Math.max(1, to - from), height);
          const wide = Math.max(1, to - from);
          let on = 0;
          for (let i = 3; i < data.length; i += 4) {
            const row = Math.floor((i - 3) / 4 / wide);
            if (Math.abs(row - height / 2) < 4) continue;
            if (data[i] > 8) on += 1;
          }
          return on;
        };
        return {
          head: lit(0, Math.round(width * 0.2)),
          all: lit(0, width),
          everything: (() => {
            const { data } = c.getImageData(0, 0, width, height);
            let on = 0;
            for (let i = 3; i < data.length; i += 4) if (data[i] > 8) on += 1;
            return on;
          })(),
          width,
          height,
        };
      });
      say(`  the canvas is ${drawn?.width}x${drawn?.height}: ${drawn?.everything} lit pixels`
        + ` in all, ${drawn?.all} of them away from the centre line,`
        + ` ${drawn?.head} in the first fifth where the fade is`);
      if (!drawn?.all) {
        problems.push('the take is not drawn at all, so neither is the fade over it');
      } else if (!drawn.head) {
        problems.push('nothing is drawn in the first fifth of the canvas, where a 0.44s fade'
          + ' on a 3s take has to be - the fade is stored and invisible');
      }

      await shot(page, 'fades-panel');
      if (!after.label.includes(after.read)) {
        problems.push(`the slider is announced as "${after.label}" while it reads`
          + ` "${after.read}" - a screen reader is told something else`);
      }
    }
  }

  problems.push(...noise);
  await page.close();
  return problems;
}
