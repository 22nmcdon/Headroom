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
// the button is offered where recording belongs, pressing it
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

export const name = 'mic';

/** Which track in the starter project is the mic one, and a note one. */
const MIC = 4;
const PIANO = 0;

/** How long to hold the button down for. Long enough to be several bars. */
const SINGING = 5200;

export async function check({ browser, at, say }) {
  const problems = [];
  const { page, noise } = await open(browser, at, { view: 'sketch', height: 1100 });
  await page.waitForTimeout(500);

  /* --- a sketch saved before the rename still opens --------------------- */

  // `voice` was a saved instrument id, and `trackOf` falls back to the synth
  // for an id it does not know. Without the alias, every sketch holding a
  // recording would reopen as a synth track - and a synth with no notes in it
  // makes no sound, so nothing would look broken until somebody pressed play
  // and heard nothing where their singing used to be.
  //
  // Held here rather than only in a unit test because what matters is the
  // whole path: written to storage as the old version wrote it, read back
  // through the app's own loader, and shown on the grid.
  const migrated = await page.evaluate(async () => {
    const { PROJECT_FORMAT } = await import('./src/sketch/project.js');
    const { loadSketch, SKETCH_KEY } = await import('./src/sketch/store.js');

    const old = {
      format: PROJECT_FORMAT,
      name: 'Before the rename', bpm: 96, beats: 4, value: 4,
      scenes: [{ id: 'scene-1', name: '1' }],
      tracks: [
        { id: 'piano', name: 'Piano', instrument: 'piano', slots: [] },
        { id: 'voice', name: 'Voice', instrument: 'voice', slots: [] },
      ],
    };
    // Written to the real key the way the old version wrote it, then read
    // back by this one's own loader.
    try { localStorage.setItem(SKETCH_KEY, JSON.stringify(old)); } catch { return { none: true }; }
    const back = loadSketch();
    return back ? { instruments: back.tracks.map((t) => t.instrument) } : { none: true };
  });

  if (migrated.none) {
    say('  (a saved sketch could not be read back; the alias is held in the unit tests)');
  } else {
    say(`  a sketch saved as "voice" reopens as: ${migrated.instruments.join(', ')}`);
    if (migrated.instruments.includes('voice')) {
      problems.push('a sketch saved before the rename still reports a "voice" track,'
        + ' so two names for one thing are now in circulation');
    }
    if (!migrated.instruments.includes('mic')) {
      problems.push(`a sketch saved with a voice track reopened as`
        + ` ${migrated.instruments.join(', ')} - the recording track fell back to`
        + ' something else and anything recorded into it plays nothing');
    }
  }

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
  await page.click(`[data-cell="${MIC}:0"]`);
  await page.waitForTimeout(500);

  const before = await page.evaluate(() => {
    const mic = document.querySelector('[data-mic]');
    return {
      there: !!mic,
      says: mic?.innerText.trim() ?? '',
      pressed: mic?.getAttribute('aria-pressed') ?? null,
    };
  });
  say(`a mic clip offers it: ${before.there} — "${before.says}"`);
  if (!before.there) {
    problems.push('a mic clip offers no record button, which is the one place it belongs');
    problems.push(...noise);
    await page.close();
    return problems;
  }
  if (before.pressed !== 'false') {
    problems.push(`the button reads aria-pressed="${before.pressed}" before anything is recorded`);
  }

  /* --- press it, sing, press it again ------------------------------------- */

  const readCanvas = () => page.evaluate(() => {
    const canvas = document.querySelector('[data-wave]');
    if (!canvas) return { missing: true };
    const c = canvas.getContext('2d');
    const { width, height } = canvas;
    const pixels = c.getImageData(0, 0, width, height).data;
    const bg = [pixels[0], pixels[1], pixels[2]];

    // How many columns have anything in them beyond the centre line, and how
    // tall the tallest is. A flat line is one row of ink everywhere; a
    // waveform is many rows in some places.
    let inked = 0;
    let tallest = 0;
    for (let x = 0; x < width; x += 1) {
      let rows = 0;
      for (let y = 0; y < height; y += 1) {
        const at = (y * width + x) * 4;
        if (Math.abs(pixels[at] - bg[0]) + Math.abs(pixels[at + 1] - bg[1])
          + Math.abs(pixels[at + 2] - bg[2]) > 24) rows += 1;
      }
      if (rows > 2) inked += 1;
      tallest = Math.max(tallest, rows);
    }
    return { width, height, inked, tallest };
  });

  // The canvas before anything is recorded, to compare the live one against.
  const blank = await readCanvas();

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

  // The meter, while a take is running. The one thing nobody could see: the
  // level is entirely the hardware's, because `autoGainControl` is switched
  // off on purpose, and nothing reported it either during or after.
  await page.waitForTimeout(1200);
  const meter = await page.evaluate(() => {
    const fill = document.querySelector('[data-meter-fill]');
    const hold = document.querySelector('[data-meter-hold]');
    const read = document.querySelector('[data-meter-read]');
    const clock = document.querySelector('[data-rec-clock]');
    return {
      there: !!fill,
      wide: fill ? parseFloat(fill.style.width) : null,
      how: fill?.dataset.how ?? null,
      holdAt: hold && !hold.hidden ? parseFloat(hold.style.left) : null,
      read: read?.textContent.trim() ?? '',
      clock: clock?.innerText.replace(/\n+/g, ' ').trim() ?? '',
    };
  });

  say(`  the meter: ${meter.wide}% wide, ${meter.how}, hold at ${meter.holdAt}%`);
  say(`  it reads "${meter.read}", the clock "${meter.clock}"`);

  if (!meter.there) {
    problems.push('a take is running and there is no input meter on the panel - the level'
      + ' is the hardware\'s alone, so not showing it is not showing anything');
  } else {
    if (!(meter.wide > 0)) {
      problems.push(`the meter is ${meter.wide}% wide while a signal is arriving, so it is`
        + ' on the page and not reading anything');
    }
    if (!(meter.holdAt > 0)) {
      problems.push('the meter shows no peak hold - a transient is one block long and a bar'
        + ' that followed it exactly would flash past too fast to read');
    }
    // Chromium's fake microphone peaks at 1.13, measured. So this input is
    // over the ceiling, and a meter that called it fine would be a meter
    // agreeing with a take that has already lost samples.
    // Chromium's fake microphone peaks at 1.13, measured, so this input is
    // over the ceiling. Asserted on the latched state rather than on the
    // instantaneous colour, because catching the frame a beep lands on is a
    // race and a check that depends on one is a check that fails for reasons
    // nobody can read.
    if (meter.how !== 'over') {
      problems.push(`the meter calls this input "${meter.how}" after it has already gone`
        + ' over - an over is not something a take recovers from, so the warning for it'
        + ' has to stay up');
    }
    if (!/peak/.test(meter.read)) {
      problems.push(`the readout says "${meter.read}" rather than what the peak was`);
    }
    if (!/^\d+:\d\d\b/.test(meter.clock)) {
      problems.push(`the clock reads "${meter.clock}" while a take is running, rather than`
        + ' counting - a number that changes every second wants a shape that does not');
    }
  }

  // The waveform while the take is still being made. Before this the canvas
  // only ever held a stored summary, so a take in progress drew a flat line -
  // which looks exactly like a microphone that is not working.
  const drawing = await readCanvas();

  if (drawing.missing) {
    problems.push('a take is running and there is no waveform canvas on the panel');
  } else {
    say(`  the waveform mid-take: ${drawing.inked} of ${drawing.width} columns drawn,`
      + ` tallest ${drawing.tallest} of ${drawing.height} px`);
    // Against the empty canvas read before the take started, rather than
    // against a column count. Chromium's fake device is silent for 97% of its
    // samples, so most columns are legitimately empty and a check demanding
    // most of them filled would be demanding a signal this input never sends.
    // What is not legitimate is a flat line, which is what the canvas drew
    // before this existed and what a dead microphone draws now.
    say(`  before the take: tallest ${blank.tallest} px; mid-take: ${drawing.tallest} px`);

    if (!(drawing.tallest > blank.tallest + 8)) {
      problems.push(`the canvas was ${blank.tallest} px tall before the take and`
        + ` ${drawing.tallest} px during it - a take in progress is drawing nothing, which`
        + ' looks exactly like a microphone that is not working');
    }
    if (!(drawing.tallest > drawing.height * 0.3)) {
      problems.push(`the tallest column mid-take is ${drawing.tallest} px of ${drawing.height}`
        + ' - the shape is being drawn but not at the size of what is arriving');
    }
    if (!(drawing.inked >= 5)) {
      problems.push(`${drawing.inked} columns have a shape in them, which is too few to be`
        + ' a waveform of anything');
    }
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
  // And the part that cannot be undone, said once the take is over. The fake
  // device is over the ceiling, so this take really has lost samples.
  if (!/over the ceiling|flattened|Peak /.test(after.told)) {
    problems.push(`after stopping, the panel says "${after.told}" and nothing about what the`
      + ' take did to the ceiling - 24-bit storage clamps at full scale and a hot take'
      + ' arrives already flattened');
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
      project = setTrack(project, 0, { instrument: 'mic' });
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

  /* --- what the browser gave, and whether it did as it was asked ---------- */

  // The app asks for no gain control, no noise suppression and no echo
  // cancellation, and until now never looked at whether it got any of that.
  // A browser is free to ignore all three, and gain control riding up during
  // the quiet parts is exactly what lifts a microphone's noise floor into
  // audibility - so asking for it off and then not checking is how somebody
  // ends up recording into the very thing they switched off.
  const gave = await page.evaluate(async () => {
    const { overriddenIn, WANTED } = await import('./src/sketch/record.js');
    const rows = {};
    for (const node of document.querySelectorAll('.rec-about dt')) {
      rows[node.textContent.trim()] = node.nextElementSibling?.textContent.trim() ?? '';
    }
    return {
      rows,
      warned: !!document.querySelector('.rec-about dd.warn'),
      picker: !!document.querySelector('[data-input]'),
      inputs: [...document.querySelectorAll('[data-input] option')].map((o) => o.textContent.trim()),
      // What the page's own reading of the stream says, to compare against.
      asked: WANTED,
      over: overriddenIn({ autoGainControl: true }),
    };
  });

  say(`\n  what the browser handed over`);
  for (const [name, value] of Object.entries(gave.rows)) say(`    ${name.padEnd(12)} ${value}`);
  say(`    picker ${gave.picker}${gave.inputs.length ? `: ${gave.inputs.join(' · ')}` : ''}`);

  if (!gave.rows.Giving) {
    problems.push('the panel never says what the browser handed over - a request for no gain'
      + ' control is only a request, and the sample rate and channel count are the other two'
      + ' things nobody can otherwise see');
  } else if (!/kHz|does not say/.test(gave.rows.Giving)) {
    problems.push(`the panel reports the input as "${gave.rows.Giving}"`);
  }

  if (!gave.rows.Processing) {
    problems.push('the panel never says whether the processing it asked to be switched off'
      + ' actually was - which is the row that matters and the one nobody thinks to check');
  } else if (!/off, as asked|ignored the request/.test(gave.rows.Processing)) {
    problems.push(`the processing row reads "${gave.rows.Processing}", which answers neither way`);
  }

  // Chromium honours all three, so this run must read "off, as asked" and
  // must NOT be warning. A panel that cried wolf on a browser that did as it
  // was told would teach people to ignore the one case that matters.
  if (/ignored the request/.test(gave.rows.Processing ?? '')) {
    problems.push(`this browser honours all three and the panel says "${gave.rows.Processing}"`
      + ' - a warning shown when nothing is wrong is a warning nobody reads when it is');
  }
  if (gave.warned) {
    problems.push('something is marked as a warning on a browser that did as it was asked');
  }
  // And the arithmetic behind it is reachable and says what it should.
  if (gave.over.join() !== 'autoGainControl') {
    problems.push(`overriddenIn reports ${JSON.stringify(gave.over)} for a stream whose gain`
      + ' control came back on');
  }

  /* --- and a recording on a track that is not the mic track -------------- */

  // The gate this removes. The engine always played a take on any track -
  // `bookTake` wires the buffer into the track's chain and never looks at the
  // instrument - so the only thing stopping a vocal going on a piano track,
  // with that track's inserts already dialled in for it, was the panel
  // reading the track to decide what the clip was.
  //
  // Which also means this is the case nothing had ever drawn: a clip holding
  // audio, on a track whose instrument says notes. It used to get a step grid
  // over the top of it and no way to play it back.
  const elsewhere = await page.evaluate(async () => {
    const { newProject, setClip, clipOf, barTicks } = await import('./src/sketch/project.js');
    const { saveSketch } = await import('./src/sketch/store.js');
    const { putTake } = await import('./src/sketch/takes.js');

    const RATE = 48000;
    const channel = new Float32Array(RATE);
    for (let i = 0; i < channel.length; i += 1) {
      channel[i] = Math.sin((2 * Math.PI * 220 * i) / RATE) * 0.6;
    }
    await putTake('take-on-piano', [channel], RATE, { name: 'on a piano track' });

    let project = newProject();
    // Track 0 is the piano in the starter project.
    project = setClip(project, 0, 0, clipOf({
      take: 'take-on-piano', notes: [], fit: 'free', length: barTicks(project),
    }));
    saveSketch(project);
    return { instrument: project.tracks[0].instrument };
  });

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
  await page.click('[data-view="sketch"]');
  await page.waitForTimeout(400);
  await page.click('[data-play]');
  await page.waitForTimeout(700);
  await page.click('[data-play]');
  await page.waitForTimeout(300);
  await page.click('[data-view="tools"]');
  await page.waitForTimeout(300);
  await page.click('[data-view="sketch"]');
  await page.waitForTimeout(900);
  await page.click('[data-cell="0:0"]');
  await page.waitForTimeout(800);

  const takeThere = await page.evaluate(() => ({
    wave: !!document.querySelector('[data-wave]'),
    steps: !!document.querySelector('.steps'),
    keep: [...document.querySelectorAll('[data-fit]')].length,
    record: !!document.querySelector('[data-mic]'),
    cell: document.querySelector('[data-cell="0:0"]')?.innerText.replace(/\n+/g, ' ').trim() ?? '',
    summary: document.querySelector('.clip-sums')?.innerText.trim() ?? '',
  }));

  say(`\n  a recording on the ${elsewhere.instrument} track`);
  say(`    waveform ${takeThere.wave} · step grid ${takeThere.steps}`
    + ` · keep-it chips ${takeThere.keep} · record ${takeThere.record}`);
  say(`    the cell reads "${takeThere.cell}", the summary "${takeThere.summary}"`);

  if (!takeThere.wave) {
    problems.push(`a recording on the ${elsewhere.instrument} track draws no waveform,`
      + ' so the panel is still deciding what a clip is from the track it sits on');
  }
  if (takeThere.steps) {
    problems.push(`a recording on the ${elsewhere.instrument} track has a step grid drawn`
      + ' over it - there are no notes in a recording to put on it');
  }
  if (takeThere.keep !== 2) {
    problems.push(`a recording on the ${elsewhere.instrument} track offers`
      + ` ${takeThere.keep} ways to keep it rather than both`);
  }
  if (!takeThere.record) {
    problems.push(`a recording on the ${elsewhere.instrument} track offers no way to record`
      + ' over it, so a take that landed on the wrong track is stuck there');
  }
  if (/bar|note/.test(takeThere.summary) && !/second|plays once/.test(takeThere.summary)) {
    problems.push(`the summary for a recording reads "${takeThere.summary}", which describes`
      + ' a clip of notes');
  }

  problems.push(...noise);
  await page.close();
  return problems;
}
