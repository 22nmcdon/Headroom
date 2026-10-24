// Adding and dropping tracks, at every size.
//
// Moved in from a scratchpad, where it ran when somebody remembered to run
// it. See harness.mjs for why that is the same as not having it.

import { open, shot, FACES, TOOLS, SIZES } from './harness.mjs';

export const name = 'tracks';

export async function check({ browser, at, say }) {
  const problems = [];
  for (const [label, w, h] of [['portrait', 430, 932], ['landscape', 932, 430], ['desktop', 1280, 1000]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    page.on('pageerror', (e) => problems.push(`${label} pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`${label} console: ${m.text()}`); });
    await page.goto(at, { waitUntil: 'networkidle' });
    await page.waitForTimeout(350);
    await page.evaluate(() => { localStorage.clear(); });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(350);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
    await page.click('[data-view="sketch"]');
    await page.waitForTimeout(350);

    const names = () => page.$$eval('.track-name', (els) => els.map((e) => e.textContent.trim()));
    say(`\n=== ${label} ${w}x${h} ===`);
    say('tracks:', (await names()).join(', '));

    await page.click('[data-add-track]');
    await page.waitForTimeout(500);
    const after = await names();
    say('after +:', after.join(', '));
    if (after.length !== 6) problems.push(`${label}: adding a track gave ${after.length}`);

    // The cap holds.
    const capped = await page.$eval('[data-add-track]', (b) => b.disabled);
    if (!capped) problems.push(`${label}: the sixth track did not disable the plus`);

    // The new track's panel is open, so its instrument can be chosen.
    const open = await page.evaluate(() => ({
      kind: document.querySelector('.sketch-body')?.dataset.open,
      title: document.querySelector('.editor-title')?.textContent.trim(),
      instrument: document.querySelector('[data-instrument]')?.value,
      choices: [...(document.querySelector('[data-instrument]')?.options ?? [])].map((o) => o.value),
    }));
    say('panel:', JSON.stringify(open));
    if (open.kind !== 'track') problems.push(`${label}: the new track's panel did not open`);
    if (!open.choices?.length) problems.push(`${label}: no instrument to choose`);

    // Choose what it is, and the grid says so.
    await page.selectOption('[data-instrument]', 'kit');
    await page.waitForTimeout(500);
    const what = await page.$$eval('.track-what', (els) => els.map((e) => e.textContent.trim()));
    say('what each is:', what.join(' | '));
    if (!what.at(-1).includes('kit')) problems.push(`${label}: the grid did not follow the choice`);

    // Put something in it, and it may not be dropped.
    await page.evaluate(() => document.querySelector('[data-back]')?.click());
    await page.waitForTimeout(250);
    await page.click('[data-cell="5:0"]');
    await page.waitForTimeout(450);
    const steps = await page.$$('.step');
    await steps[0]?.click();
    await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector('[data-back]')?.click());
    await page.waitForTimeout(300);
    const held = await page.$eval('[data-drop-track]', (b) => b.disabled);
    if (!held) problems.push(`${label}: a track with a clip in it could still be dropped`);

    // Take the clip out - a long press, then the tap that confirms - and the
    // track may go.
    const cell = await page.$('[data-cell="5:0"]');
    const box = await cell.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
    await page.waitForTimeout(250);
    await page.click('[data-cell="5:0"]');
    await page.waitForTimeout(450);
    await page.click('[data-drop-track]');
    await page.waitForTimeout(450);
    const back = await names();
    say('after −:', back.join(', '));
    if (back.length !== 5) problems.push(`${label}: dropping left ${back.length} tracks`);

    const over = await page.evaluate(() => ({ d: document.documentElement.scrollWidth, w: innerWidth }));
    if (over.d > over.w + 1) problems.push(`${label}: the page scrolls sideways`);
    await shot(page, `tracks-${label}.png`);
    await page.close();
  }
  return problems;
}
