// The drawn waveform, against the audio it is drawn from.
//
// A recording was an invisible object until this: a cell saying it held one,
// a length beside it, and no way to see whether the take opened with four
// seconds of somebody finding the microphone. `tests/wave.test.js` holds the
// summarising - every column reports the lowest and highest sample in its
// slice, so a one-sample click stays as tall as a sustained note - but a
// summary is numbers, and what a person looks at is pixels.
//
// So this reads the pixels. A take is planted with a shape chosen so that
// the picture of it can be stated in advance, the clip panel is opened, and
// the canvas is measured column by column.
//
// ## Why it is worth the trouble
//
// Every way a waveform goes wrong leaves the numbers correct. Drawn from the
// wrong end of the buffer, drawn upside down, drawn at the canvas's CSS size
// on a canvas sized in device pixels, the centre line in the wrong place, the
// whole thing half a box high - all of those pass a test of the summary and
// all of them are plainly wrong to look at. The one thing a check can do
// that reading the numbers cannot is ask the canvas what it has got on it.

import { open } from './harness.mjs';

export const name = 'wave';

/** Where the planted take is put. The voice track in the starter project. */
const VOICE = 4;

export async function check({ browser, at, say }) {
  const problems = [];
  const { page, noise } = await open(browser, at, { view: 'sketch', height: 1100 });
  await page.waitForTimeout(400);

  // A take in two halves: a loud symmetric tone, then silence. Both halves
  // are claims about the picture - the first that it is drawn at all and
  // drawn evenly about the centre, the second that silence is a flat line
  // and not more of the same.
  const planted = await page.evaluate(async () => {
    const { putTake } = await import('./src/sketch/takes.js');
    const { newProject, setClip, clipOf, barTicks } = await import('./src/sketch/project.js');
    const { saveSketch } = await import('./src/sketch/store.js');

    const RATE = 48000;
    const seconds = 4;
    const channel = new Float32Array(RATE * seconds);
    const half = channel.length / 2;
    for (let i = 0; i < half; i += 1) channel[i] = Math.sin((2 * Math.PI * 220 * i) / RATE) * 0.8;

    const id = 'take-wave-halves';
    const ok = await putTake(id, [channel], RATE, { name: 'halves' });

    let project = newProject();
    project = setClip(project, 4, 0, clipOf({
      take: id, notes: [], fit: 'free', length: barTicks(project) * 2,
    }));
    saveSketch(project);
    return { ok, seconds };
  });

  if (!planted.ok) {
    problems.push('the take could not be planted, so nothing below was tested');
    problems.push(...noise);
    await page.close();
    return problems;
  }

  // Reloaded, so the grid loads the recording the way it does on opening,
  // and played once so there is an audio context for it to decode into.
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

  await page.click(`[data-cell="${VOICE}:0"]`);
  await page.waitForTimeout(800);

  const drawn = await page.evaluate(() => {
    const canvas = document.querySelector('[data-wave]');
    if (!canvas) return { missing: true };

    const box = canvas.getBoundingClientRect();
    const c = canvas.getContext('2d');
    const { width, height } = canvas;
    const pixels = c.getImageData(0, 0, width, height).data;

    // The background is whatever the first corner pixel is; anything that
    // differs from it is ink. Read rather than assumed, so a theme change
    // does not quietly turn this check into one that always passes.
    const bg = [pixels[0], pixels[1], pixels[2]];
    const inked = (x, y) => {
      const at = (y * width + x) * 4;
      return Math.abs(pixels[at] - bg[0]) + Math.abs(pixels[at + 1] - bg[1])
        + Math.abs(pixels[at + 2] - bg[2]) > 24;
    };

    // Per column: the topmost and bottommost inked row.
    const columns = [];
    for (let x = 0; x < width; x += 1) {
      let top = -1;
      let bottom = -1;
      for (let y = 0; y < height; y += 1) {
        if (inked(x, y)) { if (top < 0) top = y; bottom = y; }
      }
      columns.push({ top, bottom, tall: top < 0 ? 0 : bottom - top + 1 });
    }

    return {
      width, height, box: { w: Math.round(box.width), h: Math.round(box.height) },
      columns,
      dpr: window.devicePixelRatio || 1,
    };
  });

  if (drawn.missing) {
    problems.push('a clip holding a recording draws no waveform');
    problems.push(...noise);
    await page.close();
    return problems;
  }

  /* --- the canvas is the size it is shown at ------------------------------ */

  say(`  the canvas is ${drawn.box.w}x${drawn.box.h} on the page,`
    + ` ${drawn.width}x${drawn.height} in pixels (dpr ${drawn.dpr})`);
  if (drawn.width !== Math.round(drawn.box.w * drawn.dpr)
    || drawn.height !== Math.round(drawn.box.h * drawn.dpr)) {
    problems.push(`the waveform is shown at ${drawn.box.w}x${drawn.box.h} and drawn at`
      + ` ${drawn.width}x${drawn.height}, so it is a blurred or stretched picture`);
  }

  /* --- the loud half is drawn, the silent half is a line ------------------ */

  const half = Math.floor(drawn.columns.length / 2);
  // A margin in from each edge and from the middle, because the column the
  // signal changes in holds both halves and is neither.
  const edge = Math.max(2, Math.round(drawn.columns.length * 0.04));
  const loud = drawn.columns.slice(edge, half - edge);
  const quiet = drawn.columns.slice(half + edge, drawn.columns.length - edge);

  const average = (all) => (all.length ? all.reduce((n, one) => n + one.tall, 0) / all.length : 0);
  const loudTall = average(loud);
  const quietTall = average(quiet);

  say(`  the first half (a 220 Hz tone at 0.8) averages ${loudTall.toFixed(1)} px tall`);
  say(`  the second half (silence) averages ${quietTall.toFixed(1)} px tall`);

  if (!(loudTall > drawn.height * 0.4)) {
    problems.push(`the loud half of the take is drawn ${loudTall.toFixed(1)} px tall in a`
      + ` ${drawn.height} px box - a tone at 0.8 should fill most of it`);
  }
  if (quietTall > 3) {
    problems.push(`the silent half of the take is drawn ${quietTall.toFixed(1)} px tall,`
      + ' so silence is being drawn as signal');
  }
  if (!(quietTall >= 1)) {
    problems.push('the silent half has nothing drawn in it at all, not even the centre line'
      + ' - a waveform with a hole in it reads as a take that stops early');
  }

  /* --- and it is drawn about the centre, the right way up ----------------- */

  // The fault that reading the summary cannot catch. The planted tone is
  // symmetric, so the ink above the centre line and the ink below it have to
  // match; drawn upside down, or from the centre upward only, the numbers
  // stay right and the picture is wrong.
  const mid = drawn.height / 2;
  const above = average(loud.map((one) => ({ tall: one.top < 0 ? 0 : mid - one.top })));
  const below = average(loud.map((one) => ({ tall: one.bottom < 0 ? 0 : one.bottom - mid })));
  say(`  about the centre line: ${above.toFixed(1)} px above, ${below.toFixed(1)} px below`);

  if (above < 1 || below < 1) {
    problems.push(`a symmetric tone is drawn ${above.toFixed(1)} px above the centre and`
      + ` ${below.toFixed(1)} px below it - the waveform is on one side of its own box`);
  } else if (Math.abs(above - below) > drawn.height * 0.1) {
    problems.push(`a symmetric tone is drawn ${above.toFixed(1)} px above the centre and`
      + ` ${below.toFixed(1)} px below it, which is not the shape of what was planted`);
  }

  /* --- and the picture does not spill out of its box ---------------------- */

  const over = drawn.columns.filter((one) => one.top === 0 && one.bottom === drawn.height - 1);
  if (over.length > drawn.columns.length * 0.5) {
    problems.push(`${over.length} of ${drawn.columns.length} columns reach both edges of the`
      + ' box, so the waveform is drawn taller than the space it has and is clipped');
  }

  problems.push(...noise);
  await page.close();
  return problems;
}
