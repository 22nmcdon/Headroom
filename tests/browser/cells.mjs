// Taking a clip out, by the gesture that does it.
//
// A long press on a cell offers to take it out and a second tap acts, which
// is a good design on paper: no cross in the corner of twenty cells to catch
// a thumb on, and nothing destroyed without being asked. What it had never
// been was pressed by anything but a mouse.
//
// Driven with real touch events it was broken twice over, in opposite
// directions:
//
//   * Held still, the lift itself acted. The clip was deleted on release
//     with nothing asked, and the confirming tap then landed on an empty
//     cell and made a fresh empty clip there - so the cell still looked
//     occupied and the gesture read as doing nothing. It had done
//     everything, twice.
//   * Held by a real hand, it never fired at all. `pointermove` cancelled
//     the press with no tolerance at all, and a finger always drifts a pixel.
//
// Neither shows with a mouse. A mouse holds perfectly still, so the second
// never happens; and `drawGrid` replaces the DOM mid-press, so the browser
// never synthesises a click for the mouse and the first never happens either.
// Every check before this one drove the grid with `page.click`.
//
// ## The claim
//
// A press asks, and only the tap after it acts. Both halves matter: the ask
// has to arrive for a hand that is not a clamp, and the clip has to survive
// the press that asked about it.

import { open } from './harness.mjs';

export const name = 'cells';

/** How long to hold. Longer than the gesture needs, to allow for a slow page. */
const HELD = 800;

/** How far a finger may drift and still be holding still. */
const DRIFT = 3;

/** And a movement that is plainly a drag, which must still cancel. */
const DRAG = 40;

export async function check({ browser, at, say }) {
  const problems = [];

  for (const [label, wobble, asks] of [
    ['a hand that holds still', 0, true],
    ['a hand that drifts', DRIFT, true],
    // The inverse, and the reason the tolerance is a few pixels and not any
    // number at all: a finger dragged up the grid is somebody scrolling, and
    // turning that into a delete prompt would be worse than the fault being
    // fixed.
    ['a finger dragged away', DRAG, false],
  ]) {
    const { page, noise, context } = await open(browser, at, {
      view: 'sketch', width: 430, height: 932, touch: true,
    });
    await page.waitForTimeout(400);

    // Planted rather than tapped, because at phone width tapping a cell
    // replaces the grid with the editor - and the grid is what is under test.
    await page.evaluate(async () => {
      const { newProject, setNotes } = await import('./src/sketch/project.js');
      const { saveSketch } = await import('./src/sketch/store.js');
      saveSketch(setNotes(newProject(), 0, 0, [{ pitch: 60, start: 0, length: 240 }]));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
    await page.click('[data-view="sketch"]');
    await page.waitForTimeout(700);

    const state = () => page.evaluate(() => {
      const cell = document.querySelector('[data-cell="0:0"]');
      return {
        full: cell?.dataset.full ?? null,
        asking: cell?.dataset.asking ?? null,
        text: cell?.innerText.replace(/\n+/g, ' ').trim() ?? '',
      };
    });

    const cdp = await context.newCDPSession(page);
    const box = await page.locator('[data-cell="0:0"]').boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;

    const began = await state();

    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 0; wobble && i < 3; i += 1) {
      await page.waitForTimeout(140);
      const d = i % 2 ? -wobble : wobble;
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove', touchPoints: [{ x: x + d, y: y + d }],
      });
    }
    await page.waitForTimeout(HELD);
    const held = await state();

    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(350);
    const lifted = await state();

    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await page.waitForTimeout(60);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(500);
    const tapped = await state();

    say(`\n  ${label}`);
    say(`    to begin    ${began.text.padEnd(12)} full=${began.full}`);
    say(`    while held  ${held.text.padEnd(12)} asking=${held.asking}`);
    say(`    after lift  ${lifted.text.padEnd(12)} full=${lifted.full}`);
    say(`    second tap  ${tapped.text.padEnd(12)} full=${tapped.full}`);

    if (began.full !== 'true') {
      problems.push(`${label}: nothing was in the cell to take out, so nothing was tested`);
      problems.push(...noise);
      await page.close();
      continue;
    }

    if (!asks) {
      // Dragged away: nothing is offered and nothing is lost.
      if (held.asking === 'true') {
        problems.push(`${label}: a finger dragged ${DRAG} pixels still offered to take the`
          + ' clip out, so scrolling the grid is now a delete prompt');
      }
      if (tapped.full !== 'true') {
        problems.push(`${label}: dragging away from a cell and tapping it left`
          + ` "${tapped.text}" - a drag must not cost anybody a clip`);
      }
      problems.push(...noise);
      await page.close();
      continue;
    }

    // The ask has to arrive. A hand is not a clamp.
    if (held.asking !== 'true') {
      problems.push(`${label}: held for ${HELD}ms and the cell never offered to be taken`
        + ` out - it still reads "${held.text}". A press cancelled by ${DRIFT} pixels of`
        + ' drift is a press nobody can make');
    }

    // And the press that asked must not also act.
    if (lifted.full === 'false') {
      problems.push(`${label}: letting go took the clip out on its own - the gesture asked`
        + ' and answered itself, so nothing was ever confirmed');
    }

    // Then the tap that does act.
    if (held.asking === 'true' && lifted.full === 'true' && tapped.full !== 'false') {
      problems.push(`${label}: the cell asked, the clip survived the press, and the tap`
        + ` after it left "${tapped.text}" in the cell rather than emptying it`);
    }

    problems.push(...noise);
    await page.close();
  }

  return problems;
}
