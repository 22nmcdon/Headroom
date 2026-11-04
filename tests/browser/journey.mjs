// The whole arc, once, in the order a person does it.
//
// Thirty-seven checks drive one thing each. Every one of them is worth
// having and not one of them is this: record a take, play some parts in,
// chain the scenes, export it, come back tomorrow and find it. That is what
// the sketchpad is for, and it was the only path through the app with
// nothing at all on it.
//
// What a check per feature cannot see is the joins. Each of the nine things
// found unreachable this week was reachable in its own test - a handler with
// no button, a button rendering nothing, a `takes` map the export never got
// handed. All nine were a join, and a join only shows when something crosses
// it.
//
// ## The claims, in order
//
// A take recorded through the microphone. Notes played into three other
// tracks through the step grid. A follow action set, so the scene goes
// somewhere. Then the two exports, and this is the crossing that matters:
// the MIDI carries the notes that were drawn, and the mic track's stem
// carries the audio that was recorded - not a silent file of the right
// length, which is what every stem would be if `takes` never reached the
// renderer. And then a reload, because a sketchpad that forgets is a
// sketchpad nobody trusts twice: the notes, the recording, the follow
// action and the drawn waveform all have to come back.
//
// Slow, deliberately. It renders a scene offline twice and reloads the page,
// and it is one check rather than ten because the point is the sequence.

import { open } from './harness.mjs';

export const name = 'journey';

/** The starter project's tracks. */
const PIANO = 0;
const BASS = 1;
const KIT = 2;
const MIC = 4;

/** How long to hold the record button. Several bars at the starter tempo. */
const SINGING = 3200;

/** Catch anything handed to a download, and stop the click navigating. */
const CATCH_FILES = () => {
  window.__caught = [];
  const real = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (blob) => {
    // Only what is handed over as a file: an AudioWorklet module goes out
    // through the same door, and a stems render installs several.
    if (!/javascript/.test(blob.type ?? '')) window.__caught.push(blob);
    return real(blob);
  };
  document.addEventListener('click', (e) => {
    const link = e.target.closest?.('a[download]');
    if (link) e.preventDefault();
  }, true);
};

export async function check({ browser, at, say }) {
  const problems = [];
  const { page, noise } = await open(browser, at, { view: 'sketch', height: 1200 });
  await page.waitForTimeout(500);

  // Ink on a waveform canvas, NOT counting the centre line.
  //
  // `drawWave` lays a centre line down whether or not it has anything to
  // draw, and on this canvas that line is about 970 pixels. This check used
  // to count every lit pixel and call 974 of them proof that a reloaded take
  // had come back - 974 being the line, a stub, and no waveform at all. It
  // was passing on exactly the bug it was written to catch: a reloaded
  // sketch loaded none of its recordings until the view was left and
  // re-entered, so the take was neither drawn nor playable.
  await page.addInitScript(() => {
    window.__inkAway = (canvas) => {
      const { width, height } = canvas;
      const { data } = canvas.getContext('2d').getImageData(0, 0, width, height);
      let on = 0;
      for (let i = 3; i < data.length; i += 4) {
        const row = Math.floor((i - 3) / 4 / width);
        if (Math.abs(row - height / 2) < 4) continue;
        if (data[i] > 8) on += 1;
      }
      return on;
    };
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
  await page.click('[data-view="sketch"]');
  await page.waitForTimeout(400);

  const able = await page.evaluate(async () => {
    const { canRecord } = await import('./src/sketch/record.js');
    return canRecord();
  });
  if (!able) {
    problems.push('this browser reports it cannot record, so the journey cannot start'
      + ' - the fake-device flags in harness.mjs are what make it able');
    problems.push(...noise);
    await page.close();
    return problems;
  }

  // An audio context needs a gesture before anything will open an input.
  await page.click('[data-play]');
  await page.waitForTimeout(500);
  await page.click('[data-play]');
  await page.waitForTimeout(300);

  /* --- 1. a take, recorded ------------------------------------------------ */

  await page.click(`[data-cell="${MIC}:0"]`);
  await page.waitForTimeout(500);
  await page.click('[data-mic]');
  await page.waitForTimeout(SINGING);
  await page.click('[data-mic]');
  await page.waitForTimeout(1200);

  const recorded = await page.evaluate(() => ({
    said: document.querySelector('[data-said]')?.textContent.trim() ?? '',
    cell: document.querySelector('[data-cell="4:0"]')?.innerText.replace(/\s+/g, ' ').trim() ?? '',
    full: document.querySelector('[data-cell="4:0"]')?.dataset.full ?? '',
    ink: (() => {
      const canvas = document.querySelector('.clip-wave canvas');
      if (!canvas) return null;
      return window.__inkAway(canvas);
    })(),
  }));
  say(`  1. recorded: "${recorded.said}"`);
  say(`     the cell reads "${recorded.cell}" (full: ${recorded.full}),`
    + ` and the waveform has ${recorded.ink} lit pixels`);

  if (recorded.full !== 'true') {
    problems.push('after recording, the grid still shows that slot as empty');
  }
  if (!/recorded/i.test(recorded.said)) {
    problems.push(`after recording, the app said "${recorded.said}"`);
  }
  if (!recorded.ink) {
    problems.push('a take was recorded and nothing is drawn of it - the waveform is the only'
      + ' way to see what is in a recording');
  }

  /* --- 2. parts, played in through the grid ------------------------------- */

  // Through the steps rather than straight into the project, because what is
  // being checked is the path: a click on a step is the only way a person
  // puts a note into a clip that is not played live.
  const drew = [];
  for (const [track, howMany] of [[PIANO, 3], [BASS, 2], [KIT, 4]]) {
    await page.click('[data-back]').catch(() => {});
    await page.waitForTimeout(250);
    await page.click(`[data-cell="${track}:0"]`);
    await page.waitForTimeout(450);

    // Whatever rows and columns this track offers - a clip's width is its
    // length over its division, and a check that assumed sixteen would be
    // testing the division rather than the writing.
    const grid = await page.evaluate(() => {
      const step = document.querySelector('.steps [data-step]');
      if (!step) return null;
      const pitch = Number(step.dataset.step.split(':')[0]);
      const wide = document.querySelectorAll(`.steps [data-step^="${pitch}:"]`).length;
      return { pitch, wide };
    });
    if (!grid) {
      problems.push(`track ${track} offers no steps, so nothing can be written into it`);
      continue;
    }
    const row = grid.pitch;
    const every = Math.max(1, Math.floor(grid.wide / howMany));
    const columns = Array.from({ length: howMany }, (_, i) => i * every)
      .filter((column) => column < grid.wide);
    for (const column of columns) {
      await page.click(`[data-step="${row}:${column}"]`);
      await page.waitForTimeout(120);
    }
    const on = await page.evaluate(() => document
      .querySelectorAll('.steps [data-step][data-on="true"]').length);
    drew.push({ track, row, wanted: columns.length, on });
  }

  say(`\n  2. parts drawn: ${drew.map((d) => `track ${d.track} pitch ${d.row}:`
    + ` ${d.on}/${d.wanted}`).join(', ')}`);
  for (const one of drew) {
    if (one.on < one.wanted) {
      problems.push(`${one.wanted} steps were clicked on track ${one.track} and ${one.on}`
        + ' came on - a step that does not stay down is a note that was not written');
    }
  }

  // And something in the next scene, so a follow action has a scene to go to.
  await page.click('[data-back]').catch(() => {});
  await page.waitForTimeout(250);
  await page.click(`[data-cell="${PIANO}:1"]`);
  await page.waitForTimeout(450);
  const second = await page.evaluate(() => {
    const step = document.querySelector('.steps [data-step]');
    return step ? step.dataset.step : null;
  });
  if (second) {
    await page.click(`[data-step="${second}"]`);
    await page.waitForTimeout(200);
  }

  /* --- 3. a follow action, so the scene goes somewhere -------------------- */

  await page.click('[data-back]').catch(() => {});
  await page.waitForTimeout(250);
  await page.click(`[data-cell="${PIANO}:0"]`);
  await page.waitForTimeout(450);
  // The chips live in the clip's set-up, which is folded away by default -
  // so the journey has to unfold it, the way a person does.
  await page.click('[data-setup] summary');
  await page.waitForTimeout(350);
  await page.click('[data-passes="2"]');
  await page.waitForTimeout(350);
  await page.click('[data-then="next"]').catch(() => {});
  await page.waitForTimeout(350);

  const chained = await page.evaluate(() => ({
    follows: document.querySelector('[data-cell="0:0"]')?.dataset.follows ?? '',
    badge: document.querySelector('[data-cell="0:0"] .cell-follow')?.textContent.trim() ?? '',
    says: document.querySelector('[data-said]')?.textContent.trim() ?? '',
  }));
  say(`\n  3. chained: the cell is marked "${chained.badge}" (follows: "${chained.follows}")`);
  if (chained.follows !== 'next') {
    problems.push(`a follow action was set and the cell reports "${chained.follows}"`);
  }
  if (!chained.badge) {
    problems.push('a clip that moves the scene on carries no mark saying so, so the one thing'
      + ' about a scene that is not visible on the grid stays invisible');
  }

  /* --- 4. the exports, and whether the recording is in them --------------- */

  await page.evaluate(CATCH_FILES);
  await page.click('[data-menu]');
  await page.waitForTimeout(400);
  await page.click('[data-export]');
  await page.waitForTimeout(900);

  const midi = await page.evaluate(async () => {
    const blob = window.__caught[0];
    if (!blob) return { none: true };
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const text = (i, n) => String.fromCharCode(...bytes.slice(i, i + n));
    const be = (i, n) => bytes.slice(i, i + n).reduce((v, b) => v * 256 + b, 0);
    let tracks = 0;
    let noteOns = 0;
    for (let i = 0; i < bytes.length - 8;) {
      const kind = text(i, 4);
      const size = be(i + 4, 4);
      if (kind !== 'MThd' && kind !== 'MTrk') break;
      if (kind === 'MTrk') {
        tracks += 1;
        const body = bytes.slice(i + 8, i + 8 + size);
        for (let j = 0; j < body.length - 2; j += 1) {
          if ((body[j] & 0xf0) === 0x90 && body[j + 2] > 0) noteOns += 1;
        }
      }
      i += 8 + size;
    }
    return { size: bytes.length, head: text(0, 4), tracks, noteOns };
  });

  // Nine steps were clicked across the three tracks.
  const wanted = drew.reduce((sum, one) => sum + one.on, 0);
  if (midi.none) {
    problems.push('the MIDI export handed over nothing');
  } else {
    say(`\n  4. the MIDI: ${midi.size} bytes, "${midi.head}", ${midi.tracks} tracks,`
      + ` ${midi.noteOns} note-ons for ${wanted} steps clicked`);
    if (midi.head !== 'MThd') {
      problems.push(`the MIDI export begins "${midi.head}"`);
    }
    if (midi.noteOns < wanted) {
      problems.push(`${wanted} notes were drawn and ${midi.noteOns} came out in the MIDI`
        + ' - what was played in is not what was exported');
    }
  }

  await page.evaluate(() => { window.__caught = []; });
  await page.click('[data-stems]');
  // Five tracks, a room and the mix, rendered offline, one of them a real
  // recording. Waited for rather than guessed at: a fixed pause is a check
  // that passes on a fast machine and fails on a loaded one.
  await page.waitForFunction(() => window.__caught.length > 0
    || /could not be rendered|nothing in that scene/i
      .test(document.querySelector('[data-menu-said]')?.textContent ?? ''),
  { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(400);
  const saidStems = await page.evaluate(() => document
    .querySelector('[data-menu-said]')?.textContent.trim() ?? '');
  say(`\n     after Export the stems: "${saidStems}"`);

  const stems = await page.evaluate(async () => {
    const blob = window.__caught[0];
    if (!blob) return { none: true };
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const text = (i, n) => String.fromCharCode(...bytes.slice(i, i + n));
    const le = (i, n) => bytes.slice(i, i + n).reduceRight((v, b) => v * 256 + b, 0);

    // The loudest sample in a 24-bit WAV, in decibels. The whole point of
    // reading the bytes rather than the file list: a silent stem of exactly
    // the right length is what a missing take looks like from outside.
    const peakOf = (wav) => {
      let i = 12;
      let channels = 0;
      let bits = 0;
      while (i + 8 <= wav.length) {
        const kind = String.fromCharCode(...wav.slice(i, i + 4));
        const size = wav.slice(i + 4, i + 8).reduceRight((v, b) => v * 256 + b, 0);
        if (kind === 'fmt ') {
          channels = wav.slice(i + 10, i + 12).reduceRight((v, b) => v * 256 + b, 0);
          bits = wav.slice(i + 22, i + 24).reduceRight((v, b) => v * 256 + b, 0);
        }
        if (kind === 'data') {
          if (bits !== 24) return { bits, db: null };
          let worst = 0;
          for (let j = i + 8; j + 3 <= i + 8 + size; j += 3) {
            const raw = wav[j] | (wav[j + 1] << 8) | (wav[j + 2] << 16);
            const signed = raw & 0x800000 ? raw - 0x1000000 : raw;
            worst = Math.max(worst, Math.abs(signed));
          }
          const level = worst / 0x800000;
          return { bits, channels, db: level > 0 ? 20 * Math.log10(level) : -Infinity };
        }
        i += 8 + size + (size % 2);
      }
      return { bits, db: null };
    };

    const files = [];
    for (let i = 0; i + 30 < bytes.length;) {
      if (le(i, 4) !== 0x04034b50) break;
      const nameLen = le(i + 26, 2);
      const extraLen = le(i + 28, 2);
      const size = le(i + 18, 4);
      const name = text(i + 30, nameLen);
      const from = i + 30 + nameLen + extraLen;
      const body = bytes.subarray(from, from + size);
      const wav = /\.wav$/i.test(name);
      files.push({
        name, size, riff: text(from, 4),
        ...(wav ? peakOf(body) : {}),
      });
      i = from + size;
    }
    return { size: bytes.length, files };
  });

  if (stems.none) {
    problems.push('the stems export handed over nothing');
  } else {
    say(`\n     the stems: ${stems.size} bytes, ${stems.files.length} files`);
    for (const one of stems.files) {
      const level = one.db === undefined ? '' : `  peak ${one.db === -Infinity
        ? 'silence' : `${one.db.toFixed(1)} dB`}`;
      say(`       ${one.name.padEnd(30)} ${String(one.size).padStart(8)} bytes${level}`);
    }

    const waves = stems.files.filter((one) => /\.wav$/i.test(one.name));
    if (waves.length < 4) {
      problems.push(`four tracks had something in them and the zip holds ${waves.length} WAVs`);
    }
    // The crossing. A recording reaches the export only if the grid hands its
    // `takes` map to the renderer; without it the stage finds no buffer, plays
    // nothing, and writes a file of silence exactly as long as the others.
    const mic = waves.find((one) => /\/(mic|voice)/i.test(one.name));
    if (!mic) {
      problems.push(`nothing in the zip is the mic track's stem - it holds`
        + ` ${waves.map((one) => one.name.split('/').pop()).join(', ')}, and a recorded take`
        + ' that does not come out in the stems is a take that only exists in this tab');
    } else if (!(mic.db > -60)) {
      problems.push(`the mic stem is ${mic.db === -Infinity ? 'silence' : `${mic.db} dB`}`
        + ' - the take was recorded and the file written, and the audio did not reach it');
    }
    const mix = waves.find((one) => /\/mix/i.test(one.name));
    if (mix && !(mix.db > -60)) {
      problems.push(`the mix stem is silence, with four tracks playing into it`);
    }
    // The room stem reads silence here, and that is right: a track's `send`
    // defaults to nothing and the starter sets none, so there is nothing in
    // the reverb to tap. Written down because a silent stem in a list of
    // loud ones is the first thing anybody reading this output will chase.
  }

  /* --- 5. and it is all still there tomorrow ------------------------------ */

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
  await page.click('[data-view="sketch"]');
  await page.waitForTimeout(500);

  const back = await page.evaluate(() => ({
    filled: [...document.querySelectorAll('[data-cell]')]
      .filter((cell) => cell.dataset.full === 'true').map((cell) => cell.dataset.cell).sort(),
    follows: document.querySelector('[data-cell="0:0"]')?.dataset.follows ?? '',
  }));
  say(`\n  5. after a reload: ${back.filled.join(' ')} are full, 0:0 follows`
    + ` "${back.follows}"`);

  for (const want of ['0:0', '0:1', '1:0', '2:0', '4:0']) {
    if (!back.filled.includes(want)) {
      problems.push(`${want} was written and is gone after a reload`);
    }
  }
  if (back.follows !== 'next') {
    problems.push('the follow action did not survive a reload, so a chained scene has to be'
      + ' chained again every time the page is opened');
  }

  // And the recording itself, which lives in IndexedDB rather than in the
  // saved project: drawn means it came back out, decoded, with samples in it.
  await page.click('[data-cell="4:0"]');
  await page.waitForTimeout(1400);
  const drawn = await page.evaluate(() => {
    const canvas = document.querySelector('.clip-wave canvas');
    if (!canvas) return { none: true };
    return { on: window.__inkAway(canvas) };
  });
  say(`     the reloaded take draws ${drawn.none ? 'no canvas at all' : `${drawn.on} lit pixels`}`);
  if (drawn.none || !drawn.on) {
    problems.push('the recording did not come back from storage after a reload - the project'
      + ' still points at a take and there is no audio behind it');
  }

  problems.push(...noise);
  await page.close();
  return problems;
}
