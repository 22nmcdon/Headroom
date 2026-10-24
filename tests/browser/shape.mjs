// A face keeps its shape as it narrows - the bays stay where they are and the
// scale comes down, rather than the layout becoming a different layout.
//
// Moved in from a scratchpad, where it ran when somebody remembered to run
// it. See harness.mjs for why that is the same as not having it.

import { open, shot, FACES, TOOLS, SIZES } from './harness.mjs';

export const name = 'shape';

export async function check({ browser, at, say }) {
  const problems = [];

  // A phone upright, the same phone on its side, and a desktop.
  for (const [label, width, height] of [
    ['portrait', 430, 932], ['landscape', 932, 430], ['desktop', 1280, 1000],
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`${label} console: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`${label} pageerror: ${e.message}`));
    await page.goto(at, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
    await page.click('[data-view="sketch"]');
    await page.waitForTimeout(400);

    say(`\n=== ${label} ${width}x${height} ===`);
    const bar = await page.evaluate(() => {
      const b = document.querySelector('.sketch-bar');
      const title = document.querySelector('.sketch-called');
      const r = b.getBoundingClientRect();
      const t = title.getBoundingClientRect();
      const mid = (t.left + t.right) / 2;
      return {
        tempo: Boolean(document.querySelector('.sketch-bar [data-bpm]')),
        titleOffCentre: Math.round(mid - (r.left + r.right) / 2),
        barWidth: Math.round(r.width),
      };
    });
    say('bar:', JSON.stringify(bar));
    if (!bar.tempo) problems.push(`${label}: no tempo on the bar`);
    if (Math.abs(bar.titleOffCentre) > 6) problems.push(`${label}: the title is ${bar.titleOffCentre}px off centre`);

    await page.click('[data-cell="0:0"]');
    await page.waitForTimeout(450);

    const clip = await page.evaluate(() => {
      const setup = document.querySelector('[data-setup]');
      const steps = document.querySelector('.steps');
      const sums = document.querySelector('.clip-sums');
      const rows = document.querySelectorAll('.step-name').length;
      const onScreen = [...document.querySelectorAll('.step-name')]
        .filter((n) => n.getBoundingClientRect().bottom <= window.innerHeight).length;
      return {
        folded: !setup.open,
        summary: sums.innerText.replace(/[▾▴]/g, '').trim(),
        setupHeight: Math.round(setup.getBoundingClientRect().height),
        gridTop: Math.round(steps.getBoundingClientRect().top),
        rows,
        rowsOnScreen: onScreen,
        sideBySide: Boolean(document.querySelector('.sketch-grid')?.offsetParent),
      };
    });
    say('clip:', JSON.stringify(clip, null, 1));
    if (!clip.folded) problems.push(`${label}: the set-up is not folded by default`);
    if (clip.setupHeight > 56) problems.push(`${label}: the folded set-up is ${clip.setupHeight}px tall`);

    // Unfold and check it still works.
    await page.click('.clip-sums');
    await page.waitForTimeout(300);
    const open = await page.evaluate(() => ({
      open: document.querySelector('[data-setup]').open,
      bars: document.querySelectorAll('[data-bars]').length,
      rowsKey: document.querySelectorAll('.row-key').length,
    }));
    if (!open.open || open.bars !== 3 || open.rowsKey !== 2) {
      problems.push(`${label}: unfolding did not show the controls`);
    }
    // Changing something keeps it open and updates the summary.
    await page.click('[data-bars="4"]');
    await page.waitForTimeout(350);
    const after = await page.evaluate(() => ({
      stillOpen: document.querySelector('[data-setup]').open,
      summary: document.querySelector('.clip-sums').innerText.replace(/[▾▴]/g, '').trim(),
    }));
    say('after setting 4 bars:', JSON.stringify(after));
    if (!after.stillOpen) problems.push(`${label}: it folded itself on a change`);
    if (!/4 bars/.test(after.summary)) problems.push(`${label}: the summary did not keep up`);

    await page.click('.clip-sums');
    await page.waitForTimeout(300);
    await shot(page, `shape-${label}.png`);
    const over = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
    if (over.doc > over.win + 1) problems.push(`${label}: scrolls sideways`);
    await page.close();
  }
  return problems;
}
