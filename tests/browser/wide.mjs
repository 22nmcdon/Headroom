// The landscape layout: that the clip grid gets the whole page when nothing is
// selected, and that a selection fills the screen rather than opening a column.
//
// Moved in from a scratchpad, where it ran when somebody remembered to run
// it. See harness.mjs for why that is the same as not having it.

import { open, shot, FACES, TOOLS, SIZES } from './harness.mjs';

export const name = 'wide';

export async function check({ browser, at, say }) {
  const problems = [];
  for (const [label, width, height] of [
    ['portrait', 430, 932], ['landscape', 932, 430], ['desktop', 1280, 1000],
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on('pageerror', (e) => problems.push(`${label} pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`${label} console: ${m.text()}`); });
    await page.goto(at, { waitUntil: 'networkidle' });
    await page.waitForTimeout(350);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
    await page.click('[data-view="sketch"]');
    await page.waitForTimeout(350);

    // Nothing open: the grid should have the whole width of the body.
    const shut = await page.evaluate(() => {
      const body = document.querySelector('.sketch-body');
      const grid = document.querySelector('.sketch-grid');
      const scroll = document.querySelector('.grid-scroll');
      return {
        open: body.dataset.open,
        bodyWidth: Math.round(body.getBoundingClientRect().width),
        scrollWidth: Math.round(scroll.getBoundingClientRect().width),
        gridWidth: Math.round(grid.getBoundingClientRect().width),
        clipped: grid.scrollWidth > scroll.clientWidth + 1,
      };
    });
    say(`\n=== ${label} ${width}x${height} ===`);
    say('nothing open:', JSON.stringify(shut));
    if (shut.scrollWidth < shut.bodyWidth - 1) problems.push(`${label}: the grid gets ${shut.scrollWidth} of ${shut.bodyWidth} with nothing open`);
    if (shut.clipped) problems.push(`${label}: the grid is cut off with nothing open`);

    await shot(page, `wide-${label}-shut.png`);

    await page.click('[data-cell="0:0"]');
    await page.waitForTimeout(400);
    const open = await page.evaluate(() => {
      const body = document.querySelector('.sketch-body');
      const scroll = document.querySelector('.grid-scroll');
      const ed = document.querySelector('.sketch-editor');
      return {
        open: body.dataset.open,
        gridOnScreen: Boolean(scroll.offsetParent),
        sideBySide: Boolean(scroll.offsetParent)
          && Math.round(scroll.getBoundingClientRect().top) === Math.round(ed.getBoundingClientRect().top),
        back: Boolean(document.querySelector('.panel-back')?.offsetParent),
      };
    });
    say('clip open:', JSON.stringify(open));
    await shot(page, `wide-${label}-open.png`);
    const over = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
    if (over.doc > over.win + 1) problems.push(`${label}: scrolls sideways`);
    await page.close();
  }
  return problems;
}
