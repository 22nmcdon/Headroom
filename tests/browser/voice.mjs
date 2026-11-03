// The record button, pressed. Which nothing had ever done.
//
// Two checks here plant a take straight into IndexedDB and go on to test
// what happens to it - `root.mjs` reads its pitch, `sampler.mjs` plays it
// back at other pitches. Both were written that way deliberately, because
// what they are about is what happens to a recording once it exists. The
// consequence nobody noticed is that the code which MAKES one had never run
// outside a unit test of its arithmetic: not the worklet, not getUserMedia,
// not the two presses, not the storing, and not what the grid says
// afterwards.
//
// It runs here because Chromium will fake a microphone. `--use-fake-device-
// for-media-stream` answers getUserMedia with a generated tone and
// `--use-fake-ui-for-media-stream` stops it asking - both are on in
// `harness.mjs`, where they are inert for every other check because nothing
// else opens an input. Without them `canRecord()` is false and the button is
// not on the page at all.
//
// ## The claims
//
// That the whole path works, end to end, in the order a person does it:
// the button is offered on a voice track and nowhere else, pressing it
// records, pressing it again keeps what arrived, the recording reaches the
// store at the length it claims, it is not silence, and the grid says it is
// there.
//
// The last of those is the one that was wrong. `clipSays` counted the clip's
// notes and a recording has none, so a cell holding a take read "empty" -
// the panel said "2 bars recorded" and the grid said the cell was empty, in
// the same breath. Nothing caught it because the only tests that ever built
// a take-clip built it in a unit test with no DOM.
//
// And then that it plays, through the real stage, rendered offline: a take
// nothing can hear is not a recording.

import { open } from './harness.mjs';

export const name = 'voice';

/** Which track in the starter project is the voice one, and a note one. */
const VOICE = 4;
const PIANO = 0;

/** How long to hold the button down for. Long enough to be several bars. */
const SINGING = 5200;

export async function check({ browser, at, say }) {
  const problems = [];
  const { page, noise } = await open(browser, at, { view: 'sketch', height: 1100 });
  await page.waitForTimeout(500);

  const able = await page.evaluate(async () => {
    const { canRecord } = await import('./src/sketch/record.js');
    return canRecord();
  });
  say(`the browser will record: ${able}`);
  if (!able) {
    problems.push('this browser reports it cannot record, so nothing below could be tested'
      + ' - the fake-device flags in harness.mjs are what make it able');
    problems.push(...noise);
    await page.close();
    return problems;
  }

  // An audio context has to exist before the grid will do anything with
  // recordings, and a browser will not make one before a gesture. Press play
  // and stop, which is what `root.mjs` does and for the same reason.
  await page.click('[data-play]');
  await page.waitForTimeout(600);
  await page.click('[data-play]');
  await page.waitForTimeout(300);

  /* --- the button is offered where it makes sense, and not elsewhere ------- */

  await page.click(`[data-cell="${PIANO}:0"]`);
  await page.waitForTimeout(500);
  const onPiano = await page.evaluate(() => !!document.querySelector('[data-mic]'));
  say(`a piano clip offers it: ${onPiano}`);
  if (onPiano) {
    problems.push('a piano clip offers a record button - recording into a clip of notes'
      + ' would have to throw them away, and nothing says so');
  }

  await page.click('[data-back]').catch(() => {});
  await page.waitForTimeout(300);
  await page.click(`[data-cell="${VOICE}:0"]`);
  await page.waitForTimeout(500);

  const before = await page.evaluate(() => {
    const mic = document.querySelector('[data-mic]');
    return {
      there: !!mic,
      says: mic?.innerText.trim() ?? '',
      pressed: mic?.getAttribute('aria-pressed') ?? null,
    };
  });
  say(`a voice clip offers it: ${before.there} — "${before.says}"`);
  if (!before.there) {
    problems.push('a voice clip offers no record button, which is the one place it belongs');
    problems.push(...noise);
    await page.close();
    return problems;
  }
  if (before.pressed !== 'false') {
    problems.push(`the button reads aria-pressed="${before.pressed}" before anything is recorded`);
  }

  /* --- press it, sing, press it again ------------------------------------- */

  await page.click('[data-mic]');
  await page.waitForTimeout(900);

  const during = await page.evaluate(() => ({
    says: document.querySelector('[data-mic]')?.innerText.trim() ?? '',
    pressed: document.querySelector('[data-mic]')?.getAttribute('aria-pressed') ?? null,
    told: document.body.innerText.match(/[^\n]*(Recording|microphone)[^\n]*/i)?.[0]?.trim() ?? '',
  }));
  say(`recording: "${during.says}" — ${during.told}`);
  if (during.pressed !== 'true') {
    problems.push(`while recording the button reads aria-pressed="${during.pressed}"`);
  }
  if (!/stop/i.test(during.says)) {
    problems.push(`while recording the button says "${during.says}" rather than offering a stop`);
  }

  await page.waitForTimeout(SINGING);
  await page.click('[data-mic]');
  await page.waitForTimeout(1600);

  const after = await page.evaluate(() => ({
    told: document.body.innerText.match(/[^\n]*(recorded|silence|Nothing came back)[^\n]*/i)?.[0]?.trim() ?? '',
    says: document.querySelector('[data-mic]')?.innerText.trim() ?? '',
  }));
  say(`stopped: ${after.told}`);

  if (/Nothing came back/i.test(after.told)) {
    problems.push('the microphone was opened, held for five seconds and gave back nothing'
      + ' - the capture worklet is not handing its blocks over');
  }
  if (/silence/i.test(after.told)) {
    problems.push('what came back was under the silence floor, so the capture node is running'
      + ' but nothing is reaching it');
  }
  if (!/recorded/i.test(after.told)) {
    problems.push(`after stopping, the panel says "${after.told}" rather than what it kept`);
  }

  /* --- what reached the project, and the store --------------------------- */

  const kept = await page.evaluate(async () => {
    const { allTakes } = await import('./src/sketch/takes.js');
    const takes = await allTakes();
    const cell = document.querySelector('[data-cell="4:0"]');
    return {
      takes: takes.map((one) => ({ id: one.id, seconds: one.seconds })),
      cell: cell?.innerText.replace(/\n+/g, ' ').trim() ?? '',
      full: cell?.dataset.full ?? null,
    };
  });

  say(`\n  the store holds ${kept.takes.length} recording(s):`
    + ` ${kept.takes.map((t) => `${t.seconds?.toFixed(2)}s`).join(' · ')}`);
  say(`  the cell reads "${kept.cell}" (holds a clip: ${kept.full})`);

  if (!kept.takes.length) {
    problems.push('the panel said it recorded something and the store has nothing in it');
  }
  if (kept.full !== 'true') {
    problems.push('a recording was made and the cell it went into is still empty');
  }
  // The fault this check was written for. A cell holding a recording that
  // reads "empty" is the app telling you, in the one place you look after
  // recording, that nothing happened.
  if (/\bempty\b/i.test(kept.cell)) {
    problems.push(`the cell holding the recording reads "${kept.cell}" - a take is not`
      + ' notes, so counting notes says a recording is nothing');
  }
  // And it has to fit. A cell is about seven characters wide, so a label the
  // browser has to cut short is the same fault wearing a different word.
  if (/…|\.\.\./.test(kept.cell)) {
    problems.push(`the cell reads "${kept.cell}" - the label is too long for a cell and`
      + ' the browser has cut it, so it says nothing again');
  }

  /* --- the toggle, pressed ------------------------------------------------- */

  // The control a person actually uses. It is a switch and not a decision -
  // the take in the store is everything that was played, in both modes - so
  // pressing it back and forth has to leave the clip where it started.
  const toggle = await page.evaluate(async () => {
    const read = () => {
      const chips = [...document.querySelectorAll('[data-fit]')];
      const cell = document.querySelector('[data-cell="4:0"]');
      return {
        chips: chips.map((c) => `${c.dataset.fit}${c.getAttribute('aria-pressed') === 'true' ? '*' : ''}`),
        cell: cell?.innerText.replace(/\n+/g, ' ').trim() ?? '',
      };
    };
    const press = async (fit) => {
      document.querySelector(`[data-fit="${fit}"]`)?.click();
      await new Promise((ok) => setTimeout(ok, 350));
      return read();
    };
    if (!document.querySelector('[data-fit]')) return { missing: true };
    return { opened: read(), toBars: await press('bars'), backToFree: await press('free') };
  });

  if (toggle.missing) {
    problems.push('a clip holding a recording offers no way to choose how it is kept');
  } else {
    say(`\n  how it is kept, pressed both ways\n`);
    say(`  as recorded:   ${toggle.opened.chips.join(' ')}   cell "${toggle.opened.cell}"`);
    say(`  to a loop:     ${toggle.toBars.chips.join(' ')}   cell "${toggle.toBars.cell}"`);
    say(`  back to free:  ${toggle.backToFree.chips.join(' ')}   cell "${toggle.backToFree.cell}"`);

    if (!toggle.opened.chips.includes('free*')) {
      problems.push(`a fresh recording opens as ${toggle.opened.chips.join(' ')} - a new take`
        + ' is kept at its own length, which is the point of the option');
    }
    if (!toggle.toBars.chips.includes('bars*')) {
      problems.push(`pressing the loop chip left it reading ${toggle.toBars.chips.join(' ')}`);
    }
    if (!/bars?\b/.test(toggle.toBars.cell)) {
      problems.push(`switched to a loop, the cell still reads "${toggle.toBars.cell}"`);
    }
    if (!toggle.backToFree.chips.includes('free*')) {
      problems.push(`pressing it back left it reading ${toggle.backToFree.chips.join(' ')}`);
    }
    // The claim that makes it a switch. If anything had been cut to the bar
    // line on the way in, this would come back shorter than it went.
    if (toggle.backToFree.cell !== toggle.opened.cell) {
      problems.push(`the clip read "${toggle.opened.cell}", went to a loop and came back as`
        + ` "${toggle.backToFree.cell}" - switching modes is losing part of the take, so the`
        + ' audio is still being trimmed somewhere on the way in');
    }
  }

  /* --- and it can be heard, through the real stage ------------------------ */

  const heard = await page.evaluate(async () => {
    const { loadTake, allTakes } = await import('./src/sketch/takes.js');
    const takes = await allTakes();
    if (!takes.length) return { skipped: 'nothing in the store' };

    const RATE = 48000;
    const ctx = new OfflineAudioContext(2, Math.ceil(RATE * 0.5), RATE);
    const buffer = await loadTake(ctx, takes[0].id);
    if (!buffer) return { skipped: 'the stored take would not decode' };

    // What is actually in it, which is the difference between a recording
    // and a file of the right length full of nothing.
    const data = buffer.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < data.length; i += 1) peak = Math.max(peak, Math.abs(data[i]));

    return { decoded: { seconds: buffer.duration, channels: buffer.numberOfChannels, peak } };
  });

  if (heard.skipped) {
    problems.push(`the recording could not be played back: ${heard.skipped}`);
  } else {
    say(`  it decodes to ${heard.decoded.seconds.toFixed(2)}s,`
      + ` ${heard.decoded.channels} channel(s), peaking at ${heard.decoded.peak.toFixed(3)}`);
    if (!(heard.decoded.seconds > 0.5)) {
      problems.push(`the stored recording decodes to ${heard.decoded.seconds.toFixed(2)}s`
        + ' after five seconds of input');
    }
    // Round-tripped through the WAV writer and the browser's decoder, which
    // is the path a recording takes on every reload. A take that stores and
    // decodes to silence is a take that is gone.
    if (!(heard.decoded.peak > 0.002)) {
      problems.push(`the stored recording decodes to a peak of ${heard.decoded.peak.toFixed(5)},`
        + ' so what was written to the store was silence');
    }
  }

  /* --- the two ways a take can be kept, as they sound ---------------------- */

  // The claim the whole feature rests on, and the only one that can tell the
  // modes apart: rendered through the real stage, a loop retriggers on its bar
  // line and a free take does not. Everything else about `fit` is a field in
  // an object, and a field nobody can hear is not a feature.
  //
  // Measured as the number of times the take starts inside a window several
  // clip-lengths long. A loop of one bar in a four-bar window starts four
  // times; the same audio kept free starts once, however long the window.
  const modes = await page.evaluate(async () => {
    const { makeStage } = await import('./src/sketch/stage.js');
    const { Transport } = await import('./src/sketch/transport.js');
    const { newProject, setClip, setTrack, barTicks } = await import('./src/sketch/project.js');

    const RATE = 48000;
    const BPM = 120;
    const bar = 2;

    // A take that is plainly a take: a short click at the top, silence after.
    // Counting clicks is counting launches, with no pitch or envelope to
    // confuse it.
    const holder = new OfflineAudioContext(1, 128, RATE);
    const clicky = holder.createBuffer(1, Math.round(RATE * bar * 0.9), RATE);
    const face = clicky.getChannelData(0);
    for (let i = 0; i < Math.round(RATE * 0.01); i += 1) face[i] = 1;

    const run = async (fit) => {
      const seconds = bar * 4 + 0.3;
      const ctx = new OfflineAudioContext(1, Math.ceil(RATE * seconds), RATE);

      let project = newProject({ bpm: BPM });
      project.tracks.forEach((_, i) => { if (i > 0) project = setTrack(project, i, { muted: true }); });
      project = setTrack(project, 0, { instrument: 'voice' });
      project = setClip(project, 0, 0, {
        take: 'one', notes: [], fit, length: barTicks(project),
      });

      let clock = 0;
      const transport = new Transport({
        now: () => clock, every: () => null, clear: () => {},
        lookahead: 0, bpm: BPM, beats: 4, value: 4,
      });
      const takes = new Map([['one', clicky]]);
      const stage = await makeStage(ctx, project, { out: ctx.destination, transport, takes });
      stage.launchScene(0);
      stage.play();
      for (clock = 0; clock < seconds; clock = Math.min(seconds, clock + 0.05)) {
        transport.pass();
        if (clock === seconds) break;
      }
      const done = await ctx.startRendering();
      stage.destroy();

      // Count the clicks: a rise above the floor after being below it.
      const data = done.getChannelData(0);
      let peak = 0;
      for (let i = 0; i < data.length; i += 1) peak = Math.max(peak, Math.abs(data[i]));
      let starts = 0;
      let quiet = true;
      for (let i = 0; i < data.length; i += 1) {
        const loud = Math.abs(data[i]) > peak * 0.5;
        if (loud && quiet) { starts += 1; quiet = false; }
        if (!loud) quiet = true;
      }
      return { starts, peak, window: seconds, clipBars: 1 };
    };

    return { bars: await run('bars'), free: await run('free') };
  });

  say(`\n  a one-bar take in a ${modes.bars.window}s window at 120 bpm\n`);
  say(`  kept as a loop:      starts ${modes.bars.starts}×, peaks ${modes.bars.peak.toFixed(3)}`);
  say(`  kept at its length:  starts ${modes.free.starts}×, peaks ${modes.free.peak.toFixed(3)}`);

  if (!(modes.bars.peak > 0.1)) {
    problems.push(`a looping take rendered through the stage peaks at`
      + ` ${modes.bars.peak.toFixed(4)}, so nothing was heard and neither count means anything`);
  } else if (!(modes.free.peak > 0.1)) {
    problems.push(`a free take rendered through the stage peaks at`
      + ` ${modes.free.peak.toFixed(4)} - a one-shot that cannot be heard is not a one-shot`);
  } else {
    if (modes.bars.starts < 3) {
      problems.push(`a one-bar loop started ${modes.bars.starts}× in four bars - a clip kept`
        + ' as a loop has to come back on its bar line, which is what the mode is for');
    }
    if (modes.free.starts !== 1) {
      problems.push(`a free take started ${modes.free.starts}× in four bars - kept at its own`
        + ' length it plays once from the launch, or it is still a looping cell');
    }
    if (modes.free.starts >= modes.bars.starts) {
      problems.push(`both modes started the take ${modes.free.starts}× and ${modes.bars.starts}×`
        + ' - the two ways of keeping a recording are not doing different things');
    }
  }

  problems.push(...noise);
  await page.close();
  return problems;
}
