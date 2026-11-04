// Export, pressed, and the bytes read back.
//
// `midi.js`, `stems.js`, `zip.js` and `wav.js` all have unit tests, and every
// one of them tests a function rather than the button. Nothing had pressed
// Export and looked at what came out - the same shape as the record button,
// which was fine in every unit test and told the grid a recording was empty.
//
// It can be read back because `give` hands the file over through
// `URL.createObjectURL`, so replacing that catches the blob on its way to the
// download. What the app believes it wrote and what is in the file are then
// two different things that have to agree.
//
// ## The claims
//
// A MIDI export is a Type 1 file with a track per part and the notes in it. A
// stems export is a zip with a WAV per track, each one a real RIFF header of
// the right length, and all of them the same length, because stems that do not
// line up are not stems. The MIDI rides along in the same zip, on purpose -
// what the app offers is "the room, the mix and the MIDI", and the first
// version of this check called that bundled .mid a stem that would not open.
// And the refusals are refusals: a scene with nothing in it exports nothing,
// and a scene of only recordings says why MIDI cannot carry it rather than
// handing over an empty file.

import { open } from './harness.mjs';

export const name = 'export';

export async function check({ browser, at, say }) {
  const problems = [];
  const { page, noise } = await open(browser, at, { view: 'sketch', height: 1100 });
  await page.waitForTimeout(400);

  // Catch anything handed to a download, as bytes.
  await page.evaluate(() => {
    window.__caught = [];
    const real = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      // Only what is handed over as a FILE. An AudioWorklet module is a blob
      // through the same door, and the offline renders a stems export does
      // install several of them - which is how the first version of this read
      // a worklet's source where it expected a zip, and why the MIDI case
      // only passed by luck: nothing had installed one by then.
      if (!/javascript/.test(blob.type ?? '')) window.__caught.push(blob);
      return real(blob);
    };
    // And stop the click actually navigating, which in a headless browser is
    // a download prompt nobody answers.
    document.addEventListener('click', (e) => {
      const link = e.target.closest?.('a[download]');
      if (link) e.preventDefault();
    }, true);
  });

  /* --- a scene with nothing in it exports nothing ------------------------- */

  await page.click('[data-menu]');
  await page.waitForTimeout(400);
  await page.click('[data-export]');
  await page.waitForTimeout(600);

  const onEmpty = await page.evaluate(() => ({
    caught: window.__caught.length,
    said: document.querySelector('[data-menu-said]')?.textContent.trim()
      ?? document.querySelector('[data-said]')?.textContent.trim() ?? '',
  }));
  say(`  an empty scene: ${onEmpty.caught} files, "${onEmpty.said}"`);
  if (onEmpty.caught !== 0) {
    problems.push('an empty scene handed over a file - there is nothing in it to export');
  }
  if (!/nothing in that scene/i.test(onEmpty.said)) {
    problems.push(`an empty scene said "${onEmpty.said}" rather than that it is empty`);
  }

  /* --- a scene of parts exports a MIDI file with them in it --------------- */

  await page.evaluate(async () => {
    const { newProject, setNotes } = await import('./src/sketch/project.js');
    const { saveSketch } = await import('./src/sketch/store.js');
    let project = newProject();
    // Three parts, so a Type 1 file has something to put in separate tracks.
    project = setNotes(project, 0, 0, [
      { pitch: 60, start: 0, length: 240 }, { pitch: 64, start: 480, length: 240 },
    ]);
    project = setNotes(project, 1, 0, [{ pitch: 36, start: 0, length: 480 }]);
    project = setNotes(project, 2, 0, [
      { pitch: 36, start: 0, length: 120 }, { pitch: 42, start: 240, length: 120 },
    ]);
    saveSketch(project);
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    document.querySelectorAll('dialog[open]').forEach((d) => d.close());
    window.__caught = [];
    const real = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      if (!/javascript/.test(blob.type ?? '')) window.__caught.push(blob);
      return real(blob);
    };
    document.addEventListener('click', (e) => {
      const link = e.target.closest?.('a[download]');
      if (link) e.preventDefault();
    }, true);
  });
  await page.click('[data-view="sketch"]');
  await page.waitForTimeout(400);
  await page.click('[data-menu]');
  await page.waitForTimeout(400);
  await page.click('[data-export]');
  await page.waitForTimeout(800);

  const midi = await page.evaluate(async () => {
    const blob = window.__caught[0];
    if (!blob) return { none: true };
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const text = (at, n) => String.fromCharCode(...bytes.slice(at, at + n));
    const be = (at, n) => bytes.slice(at, at + n).reduce((v, b) => v * 256 + b, 0);

    // Every chunk in the file, so the track count is counted rather than
    // taken from the header that claims it.
    const chunks = [];
    for (let i = 0; i < bytes.length - 8;) {
      const kind = text(i, 4);
      const size = be(i + 4, 4);
      if (kind !== 'MThd' && kind !== 'MTrk') break;
      chunks.push({ kind, size, at: i });
      i += 8 + size;
    }

    // Note-ons across all the track chunks: status 0x9n with a velocity.
    let noteOns = 0;
    for (const chunk of chunks.filter((c) => c.kind === 'MTrk')) {
      const body = bytes.slice(chunk.at + 8, chunk.at + 8 + chunk.size);
      for (let i = 0; i < body.length - 2; i += 1) {
        if ((body[i] & 0xf0) === 0x90 && body[i + 2] > 0) noteOns += 1;
      }
    }

    return {
      size: bytes.length,
      head: text(0, 4),
      format: be(8, 2),
      claims: be(10, 2),
      division: be(12, 2),
      tracks: chunks.filter((c) => c.kind === 'MTrk').length,
      noteOns,
    };
  });

  if (midi.none) {
    problems.push('a scene with three parts in it handed over no MIDI file at all');
  } else {
    say(`\n  the MIDI file: ${midi.size} bytes, "${midi.head}", format ${midi.format},`
      + ` ${midi.tracks} track chunks (claims ${midi.claims}), ${midi.noteOns} note-ons,`
      + ` ${midi.division} ticks a quarter`);

    if (midi.head !== 'MThd') {
      problems.push(`the exported file begins "${midi.head}" rather than with a MIDI header`);
    }
    if (midi.format !== 1) {
      problems.push(`the file says format ${midi.format} - a part per track is Type 1, and`
        + ' Type 0 would collapse them into one');
    }
    if (midi.tracks !== midi.claims) {
      problems.push(`the header claims ${midi.claims} tracks and the file has ${midi.tracks}`
        + ' - anything reading it will stop early or run off the end');
    }
    if (midi.tracks < 3) {
      problems.push(`three parts went in and ${midi.tracks} track chunks came out`);
    }
    // Five notes went in across the three parts.
    if (midi.noteOns < 5) {
      problems.push(`five notes went in and ${midi.noteOns} note-ons came out`);
    }
    if (midi.division <= 0) {
      problems.push(`the file says ${midi.division} ticks a quarter, so nothing can time it`);
    }
  }

  /* --- and the stems are a zip of real WAVs ------------------------------- */

  await page.evaluate(() => { window.__caught = []; });
  await page.click('[data-stems]');
  // Each track is rendered offline, so this is the slow one.
  await page.waitForTimeout(9000);

  const stems = await page.evaluate(async () => {
    const blob = window.__caught[0];
    if (!blob) return { none: true };
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const text = (at, n) => String.fromCharCode(...bytes.slice(at, at + n));
    const le = (at, n) => bytes.slice(at, at + n).reduceRight((v, b) => v * 256 + b, 0);

    // Walk the local file headers rather than the central directory: it is
    // the same list and it is where the data actually is.
    const files = [];
    for (let i = 0; i + 30 < bytes.length;) {
      if (text(i, 4) !== 'PK\\x03\\x04' && le(i, 4) !== 0x04034b50) break;
      const nameLen = le(i + 26, 2);
      const extraLen = le(i + 28, 2);
      const size = le(i + 18, 4);
      const name = text(i + 30, nameLen);
      const from = i + 30 + nameLen + extraLen;
      files.push({ name, size, riff: text(from, 4), wave: text(from + 8, 4) });
      i = from + size;
    }

    return {
      size: bytes.length, zip: le(0, 4) === 0x04034b50, files,
      head: text(0, 16), type: blob.type, caught: window.__caught.length,
    };
  });

  if (stems.none) {
    problems.push('the stems export handed over nothing');
  } else {
    say(`\n  the stems: ${stems.size} bytes, a zip: ${stems.zip}, ${stems.files.length} files`
      + `, type "${stems.type}", caught ${stems.caught}, begins ${JSON.stringify(stems.head)}`);
    for (const one of stems.files) {
      say(`    ${one.name.padEnd(22)} ${String(one.size).padStart(8)} bytes`
        + `  ${one.riff}/${one.wave}`);
    }

    if (!stems.zip) {
      problems.push('the stems came back as something that is not a zip');
    }
    if (stems.files.length < 3) {
      problems.push(`three parts went in and the zip holds ${stems.files.length} files`);
    }
    // The zip is deliberately two kinds of thing, so sort them before judging
    // them: a WAV read as MIDI and a MIDI read as a WAV both look broken.
    const waves = stems.files.filter((one) => /\.wav$/i.test(one.name));
    const mids = stems.files.filter((one) => /\.mid$/i.test(one.name));
    const strays = stems.files.filter((one) => !waves.includes(one) && !mids.includes(one));

    for (const one of strays) {
      problems.push(`the zip holds "${one.name}", which is neither a stem nor the MIDI`);
    }
    if (waves.length < 3) {
      problems.push(`three parts went in and the zip holds ${waves.length} WAVs`);
    }
    for (const one of waves) {
      if (one.riff !== 'RIFF' || one.wave !== 'WAVE') {
        problems.push(`"${one.name}" begins ${one.riff}/${one.wave} rather than RIFF/WAVE,`
          + ' so nothing will open it');
      }
      // A bar of audio is tens of thousands of bytes; a header alone is 44.
      if (one.size < 1000) {
        problems.push(`"${one.name}" is ${one.size} bytes, which is a header and no audio`);
      }
    }
    // Every stem is the same stretch of time, so every file is the same number
    // of bytes. This is the claim that matters about a set of stems: dropped
    // into anything, at the same start, they have to add back up to the mix.
    const lengths = [...new Set(waves.map((one) => one.size))];
    if (lengths.length > 1) {
      problems.push(`the stems are ${lengths.join(', ')} bytes - they are different lengths,`
        + ' so lining them up at one start will not reassemble the scene');
    }
    if (mids.length !== 1) {
      problems.push(`the zip holds ${mids.length} MIDI files, and a scene is one`);
    }
    for (const one of mids) {
      if (one.riff !== 'MThd') {
        problems.push(`"${one.name}" begins ${one.riff} rather than with a MIDI header`);
      }
    }
  }

  problems.push(...noise);
  await page.close();
  return problems;
}
