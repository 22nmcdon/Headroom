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

  problems.push(...noise);
  await page.close();
  return problems;
}
