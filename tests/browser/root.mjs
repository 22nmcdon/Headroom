// Working out what note a recording sounds at, from the button that does it.
//
// The arithmetic is held without a browser in `tests/root.test.js`, down to a
// cent on eight kinds of material. What cannot be held there is the path the
// answer takes: a recording lives in IndexedDB as a WAV, the grid decodes it
// into a Map of AudioBuffers on opening, the button reads one channel of one
// of those and writes a note number into the project. Four things that only
// exist in a browser, joined by a lookup.
//
// So this plants a take the way a recording arrives - into the real store,
// through `putTake`, read back by the grid's own loader after a reload -
// rather than reaching into the page for a handle the app does not expose.
// The take is a saw at a known frequency, because what is being checked is
// the wiring and a signal whose answer is in doubt would check two things at
// once.

import { open } from './harness.mjs';

export const name = 'root';

/** The three recordings, and what the button should make of each. */
const TAKES = [
  { id: 'take-root-g3', hz: 196.00, wants: 55, says: 'G3' },
  { id: 'take-root-a4', hz: 440.00, wants: 69, says: 'A4' },
  // Thirty cents flat of C4, which is a real thing to hum and the case the
  // cents in the sentence exist for: the note is still C4 and saying only
  // "C4" would hide why the sample sounds wrong played back at it.
  { id: 'take-root-flat', hz: 257.14, wants: 60, says: 'C4' },
  // A snare-ish burst: noise through a band-pass, which has no note in it.
  { id: 'take-root-noise', hz: 0, wants: null, says: null },
];

export async function check({ browser, at, say }) {
  const problems = [];
  const { page, noise } = await open(browser, at);

  // --- plant the recordings, and a project pointing at the first ----------

  const planted = await page.evaluate(async (takes) => {
    const { putTake } = await import('./src/sketch/takes.js');
    const { newProject, setTrack, setNotes, setClip, clipOf } = await import('./src/sketch/project.js');
    const { saveSketch } = await import('./src/sketch/store.js');

    const RATE = 48000;
    const made = [];
    for (const take of takes) {
      const channel = new Float32Array(Math.round(RATE * 0.8));
      if (take.hz) {
        for (let i = 0; i < channel.length; i += 1) {
          let v = 0;
          for (let n = 1; n <= 20 && n * take.hz < RATE / 2; n += 1) {
            v += Math.sin((2 * Math.PI * n * take.hz * i) / RATE) / n;
          }
          channel[i] = 0.4 * v;
        }
      } else {
        // Two poles of band-pass round 400 Hz over noise, which is a snare
        // with none of the work: pitched enough to be worth refusing, and
        // not pitched at all.
        let a = 0;
        let b = 0;
        for (let i = 0; i < channel.length; i += 1) {
          const x = (Math.random() * 2 - 1) * Math.exp(-6 * (i / RATE));
          a += ((x - a) * 2 * Math.PI * 1200) / RATE;
          b += ((a - b) * 2 * Math.PI * 300) / RATE;
          channel[i] = (a - b) * 2;
        }
      }
      made.push(await putTake(take.id, [channel], RATE, { name: take.id }));
    }

    // A project whose first track is a sampler pointed at the first take -
    // and a clip carrying each of the four, because the grid loads the takes
    // its clips point at and nothing else. That is the whole route under
    // test: an id in a project file, audio in IndexedDB, and a Map built by
    // the grid on opening that joins them.
    let project = newProject();
    project = setTrack(project, 0, {
      instrument: 'sampler',
      sample: { take: takes[0].id, root: 60 },
    });
    project = setNotes(project, 0, 0, [{ step: 0, pitch: 60, velocity: 96, length: 2 }], 16);
    takes.forEach((take, scene) => {
      project = setClip(project, 0, scene, clipOf({
        ...(project.tracks[0].slots[scene] ?? {}), take: take.id,
      }));
    });
    saveSketch(project);

    return { made, stored: made.filter(Boolean).length };
  }, TAKES);

  say(`planted ${planted.stored} of ${TAKES.length} recordings`);
  if (planted.stored !== TAKES.length) {
    problems.push(`only ${planted.stored} of ${TAKES.length} takes reached the store`);
    await page.close();
    return problems;
  }

  // --- reload, so the grid loads them the way it does on opening ----------

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
  await page.click('[data-view="sketch"]');
  await page.waitForTimeout(400);

  // The grid loads its recordings only once an audio context exists, because
  // asking for one before a gesture is what browsers refuse and the
  // sketchpad is often the first thing opened. So: press play, which makes
  // one, press it again to stop, and leave and come back so the loader gets
  // its second chance. Without this the take picker is empty and the reason
  // is nothing to do with anything being tested here.
  await page.click('[data-play]');
  await page.waitForTimeout(700);
  await page.click('[data-play]');
  await page.waitForTimeout(300);
  await page.click('[data-view="tools"]');
  await page.waitForTimeout(300);
  await page.click('[data-view="sketch"]');
  await page.waitForTimeout(900);

  // Open the first track's page, which is where the sampler's fields are.
  await page.click('[data-open-track="0"]');
  await page.waitForSelector('[data-sample-root]', { timeout: 8000 });
  await page.waitForTimeout(300);

  const there = await page.evaluate(() => ({
    button: !!document.querySelector('[data-sample-hear]'),
    picker: !!document.querySelector('[data-sample-root]'),
    takes: [...document.querySelectorAll('[data-sample-take] option')].map((o) => o.value),
  }));
  say(`the sampler's fields: button ${there.button}, picker ${there.picker},`
    + ` ${there.takes.filter(Boolean).length} recordings offered`);

  if (!there.button || !there.picker) {
    problems.push('the sampler panel has no detect button or no root picker');
    problems.push(...noise);
    await page.close();
    return problems;
  }

  /* --- press it, once per recording ------------------------------------- */

  say('\n  recording               picker before   picker after   the line');
  for (const take of TAKES) {
    await page.selectOption('[data-sample-take]', take.id);
    await page.waitForTimeout(250);
    // Back to middle C by hand each time, so a picker that never moved and a
    // picker that was already right cannot be told apart by luck.
    await page.selectOption('[data-sample-root]', '60');
    await page.waitForTimeout(200);

    const before = await page.$eval('[data-sample-root]', (el) => el.value);
    const cleared = await page.$eval('[data-sample-heard]', (el) => el.textContent.trim());
    if (cleared) problems.push(`setting the root by hand left "${cleared}" under it`);

    await page.click('[data-sample-hear]');
    await page.waitForTimeout(400);

    const after = await page.evaluate(() => ({
      root: document.querySelector('[data-sample-root]').value,
      line: document.querySelector('[data-sample-heard]')?.textContent.trim() ?? '',
    }));

    say(`  ${take.id.replace('take-root-', '').padEnd(22)} ${before.padStart(13)}`
      + ` ${after.root.padStart(14)}   "${after.line}"`);

    if (take.wants === null) {
      if (after.root !== before) {
        problems.push(`${take.id} has no note in it and moved the picker to ${after.root}`);
      }
      if (!/could not tell/.test(after.line)) {
        problems.push(`${take.id} has no note in it and the line said "${after.line}"`);
      }
      continue;
    }

    if (Number(after.root) !== take.wants) {
      problems.push(`${take.id} should read ${take.wants} and the picker says ${after.root}`);
    }
    if (!after.line.startsWith(take.says)) {
      problems.push(`${take.id}: the line says "${after.line}" and should start ${take.says}`);
    }
    if (take.id === 'take-root-flat' && !/cents flat/.test(after.line)) {
      problems.push(`a note 30 cents flat read as "${after.line}", which does not say so`);
    }
  }

  // A reading belongs to the recording it was taken from. Choosing another
  // one has to clear it, or the line is a sentence about a recording nobody
  // is looking at any more - which is what this found the first time it ran.
  await page.click('[data-sample-hear]');
  await page.waitForTimeout(300);
  const held = await page.$eval('[data-sample-heard]', (el) => el.textContent.trim());
  await page.selectOption('[data-sample-take]', TAKES[0].id);
  await page.waitForTimeout(300);
  const afterSwap = await page.$eval('[data-sample-heard]', (el) => el.textContent.trim());
  say(`\n  a reading, then another recording chosen: "${held}" -> "${afterSwap}"`);
  if (afterSwap) {
    problems.push(`choosing another recording left "${afterSwap}" under it,`
      + ' which is a reading of the one before');
  }

  problems.push(...noise);
  await page.close();
  return problems;
}
