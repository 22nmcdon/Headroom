// A trimmed take, as it sounds.
//
// The whole of a trim is a field on a clip, so the only thing worth checking
// is whether the field reaches the speakers. Rendered through the real stage:
// a take with three bursts in it, trimmed to the middle one, has to come out
// as one burst.
//
// ## And the fade
//
// A cut through a waveform is a step, and a step is a click. Measured on a
// 220 Hz sine cut at its peak, a hard cut puts 27.9 dB of energy above 5 kHz;
// a raised-cosine fade takes that down 52 dB at one millisecond, 79 at five
// and 92 at ten. Five is what the trim uses - inaudible as a shortening,
// inaudible as a click - and what is held here is that the fade is actually
// applied, by reading the shape of the first few milliseconds rather than by
// trusting that a gain node was built.

import { open } from './harness.mjs';

export const name = 'trim';

/** Where the three bursts sit in the planted take, in seconds. */
const BURSTS = [0.4, 2.4, 4.4];
const BURST = 0.5;

export async function check({ browser, at, say }) {
  const problems = [];
  const { page, noise } = await open(browser, at);
  await page.waitForTimeout(400);

  const heard = await page.evaluate(async ({ bursts, burst }) => {
    const { makeStage } = await import('./src/sketch/stage.js');
    const { Transport } = await import('./src/sketch/transport.js');
    const { newProject, setClip, setTrack, clipOf, barTicks } = await import('./src/sketch/project.js');

    const RATE = 48000;
    const WHOLE = 6;

    // Three bursts of tone with silence between them, so what came out can be
    // counted rather than inferred from a length.
    const holder = new OfflineAudioContext(1, 128, RATE);
    const take = holder.createBuffer(1, Math.round(RATE * WHOLE), RATE);
    const face = take.getChannelData(0);
    for (const begins of bursts) {
      const from = Math.round(begins * RATE);
      for (let i = 0; i < Math.round(burst * RATE); i += 1) {
        face[from + i] = Math.sin((2 * Math.PI * 220 * i) / RATE) * 0.8;
      }
    }

    const run = async (trim) => {
      const seconds = WHOLE + 0.5;
      const ctx = new OfflineAudioContext(1, Math.ceil(RATE * seconds), RATE);
      let project = newProject({ bpm: 120 });
      project.tracks.forEach((_, i) => { if (i > 0) project = setTrack(project, i, { muted: true }); });
      project = setTrack(project, 0, { instrument: 'mic' });
      project = setClip(project, 0, 0, clipOf({
        take: 'one', notes: [], fit: 'free', length: barTicks(project) * 8, trim,
      }));

      let clock = 0;
      const transport = new Transport({
        now: () => clock, every: () => null, clear: () => {},
        lookahead: 0, bpm: 120, beats: 4, value: 4,
      });
      const stage = await makeStage(ctx, project, {
        out: ctx.destination, transport, takes: new Map([['one', take]]),
      });
      stage.launchScene(0);
      stage.play();
      for (clock = 0; clock < seconds; clock = Math.min(seconds, clock + 0.05)) {
        transport.pass();
        if (clock === seconds) break;
      }
      const done = await ctx.startRendering();
      stage.destroy();

      // Count the bursts, off an ENVELOPE rather than off the samples. A
      // 220 Hz tone crosses zero every 2.3 ms, so a run of samples above a
      // floor ends at the first crossing and no burst is ever longer than a
      // millisecond - which is how the first version of this check reported
      // nought bursts from a take the stage was playing perfectly well.
      const data = done.getChannelData(0);
      const step = Math.round(RATE * 0.01);
      const loud = 0.05;
      const envelope = [];
      for (let c = 0; c * step < data.length; c += 1) {
        let peak = 0;
        for (let i = c * step; i < (c + 1) * step && i < data.length; i += 1) {
          peak = Math.max(peak, Math.abs(data[i]));
        }
        envelope.push(peak);
      }

      const runs = [];
      let from = -1;
      envelope.forEach((peak, c) => {
        const on = peak > loud;
        if (on && from < 0) from = c;
        if (!on && from >= 0) {
          if (c - from >= 5) runs.push({ from: (from * step) / RATE, to: (c * step) / RATE });
          from = -1;
        }
      });
      if (from >= 0) runs.push({ from: (from * step) / RATE, to: data.length / RATE });

      // The shape of the first milliseconds of sound, anchored to the first
      // sample that is not silence - which, on a window that begins inside a
      // burst, is the first sample of the fade.
      //
      // That anchor took four attempts. The detector's own start is ten
      // milliseconds granular and only fires above a floor, so measuring from
      // it gave neither the fade nor the attack. The render's start is not
      // the window's: a scene launch quantises to a bar, so the take begins
      // about 160 ms in and measuring from zero reads twelve milliseconds of
      // nothing. The first non-silent sample is the only one of the three
      // that is actually where the cut is.
      const onset = [];
      let begins = -1;
      for (let i = 0; i < data.length; i += 1) {
        if (Math.abs(data[i]) > 1e-4) { begins = i; break; }
      }
      if (begins >= 0) {
        for (let ms = 0; ms <= 12; ms += 1) {
          const at = begins + Math.round((ms / 1000) * RATE);
          let peak = 0;
          for (let i = at; i < at + Math.round(RATE * 0.001) && i < data.length; i += 1) {
            peak = Math.max(peak, Math.abs(data[i]));
          }
          onset.push({ ms, peak });
        }
      }

      return { runs, onset };
    };

    return {
      whole: await run(null),
      middle: await run({ from: bursts[1] - 0.1, to: bursts[1] + burst + 0.1 }),
      // A window that begins INSIDE a burst, so the first samples out are the
      // fade and nothing else. Cutting just before one measures the burst's
      // own attack instead, which is how the first version of this passed
      // while testing nothing about the fade.
      inside: await run({ from: bursts[1] + 0.2, to: bursts[1] + 0.45 }),
    };
  }, { bursts: BURSTS, burst: BURST });

  /* --- the window is what plays ------------------------------------------ */

  say(`  untrimmed: ${heard.whole.runs.length} bursts at`
    + ` ${heard.whole.runs.map((r) => r.from.toFixed(2)).join(', ')}s`);
  say(`  trimmed to the middle one: ${heard.middle.runs.length} burst(s) at`
    + ` ${heard.middle.runs.map((r) => r.from.toFixed(2)).join(', ')}s`);

  if (heard.whole.runs.length !== BURSTS.length) {
    problems.push(`the untrimmed take came out as ${heard.whole.runs.length} bursts rather`
      + ` than ${BURSTS.length}, so nothing below means anything`);
    problems.push(...noise);
    await page.close();
    return problems;
  }
  if (heard.middle.runs.length !== 1) {
    problems.push(`trimmed to one burst, ${heard.middle.runs.length} came out - the window is`
      + ' a field on the clip and is not reaching the stage');
  } else {
    // And it begins at the top of the window, not at the top of the take.
    const began = heard.middle.runs[0].from;
    if (began > 0.3) {
      problems.push(`the trimmed take begins ${began.toFixed(2)}s in - the offset is being`
        + ' dropped, so the window plays from the start of the recording');
    }
  }

  /* --- and the cut is faded rather than stepped --------------------------- */

  const onset = heard.inside.onset;
  if (onset.length) {
    say('\n  the first 10 ms of a cut made mid-burst, where the fade is all there is:');
    say(`  ${onset.filter((o) => o.ms % 2 === 0).map((o) => `${o.ms}ms ${o.peak.toFixed(3)}`).join('  ')}`);

    const first = onset[0]?.peak ?? 0;
    const settled = Math.max(...onset.slice(8).map((o) => o.peak));
    // A hard cut arrives at level within its first millisecond. A five
    // millisecond fade is a fraction of the way there at one and all the way
    // by eight, so the two are told apart by the ratio rather than by either
    // number on its own.
    if (!(settled > 0.3)) {
      problems.push(`a cut made mid-burst never reaches level - it is ${settled.toFixed(3)}`
        + ' once past the fade, so the window is not playing live signal and the fade is not'
        + ' what is being measured');
    } else if (!(first < settled * 0.4)) {
      problems.push(`the cut is at ${first.toFixed(3)} in its first millisecond and`
        + ` ${settled.toFixed(3)} once settled - that is a step rather than a fade, and a step`
        + ' through a waveform is a click: measured, 27.9 dB of energy above 5 kHz');
    }
  }

  problems.push(...noise);
  await page.close();
  return problems;
}
