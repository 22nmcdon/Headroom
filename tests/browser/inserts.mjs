// Opening each of the six plugins as a sketchpad insert, and checking the
// settings survive a round trip through storage.
//
// Moved in from a scratchpad, where it ran when somebody remembered to run
// it. See harness.mjs for why that is the same as not having it.

import { open, shot, FACES, TOOLS, SIZES } from './harness.mjs';

export const name = 'inserts';

export async function check({ browser, at, say }) {
  const EFFECTS = ['eq', 'compression', 'saturation', 'panning', 'delay', 'reverb'];
  const FACE = '.sketch-editor .eq, .sketch-editor .comp, .sketch-editor .heat, .sketch-editor .stereo, .sketch-editor .echo, .sketch-editor .verb';
  const problems = [];
  const page = await browser.newPage({ viewport: { width: 932, height: 430 } });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  await page.goto(at, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
  await page.click('[data-view="sketch"]');
  await page.waitForTimeout(350);
  await page.click('.track-name');
  await page.waitForTimeout(350);

  // Every insert on, so every plugin has something to open.
  for (const id of EFFECTS) {
    const chip = await page.$(`[data-insert="${id}"]`);
    if (!chip) { problems.push(`no chip for ${id}`); continue; }
    await chip.click();
    await page.waitForTimeout(400);
  }
  const names = await page.$$eval('[data-open-plugin]', (els) => els.map((e) => e.dataset.openPlugin));
  say('inserts that open:', names.join(', '));
  for (const id of EFFECTS) if (!names.includes(id)) problems.push(`${id} has no way in`);

  for (const id of EFFECTS) {
    const open = await page.$(`[data-open-plugin="${id}"]`);
    if (!open) continue;
    await open.click();
    await page.waitForTimeout(1200);
    const m = await page.evaluate((sel) => {
      const face = document.querySelector(sel);
      if (!face) return null;
      const r = face.getBoundingClientRect();
      const canvases = [...face.querySelectorAll('canvas')]
        .map((c) => ({ c, b: c.getBoundingClientRect() }))
        // A canvas with no box is one the insert hides; it draws nothing.
        .filter(({ b }) => b.width > 0 && b.height > 0)
        .map(({ c, b }) => ({ stale: c.width !== Math.round(b.width * devicePixelRatio) || c.height !== Math.round(b.height * devicePixelRatio) }));
      return {
        face: face.className.split(' ')[1],
        insert: face.classList.contains('is-insert'),
        w: Math.round(r.width), h: Math.round(r.height),
        canvases: canvases.length,
        stale: canvases.filter((c) => c.stale).length,
        transport: Boolean(face.querySelector('.eq-transport')?.offsetParent),
        knobs: face.querySelectorAll('.knob').length,
        name: face.querySelector('.plugin-name')?.textContent.trim(),
      };
    }, FACE);
    say(id.padEnd(12), JSON.stringify(m));
    if (!m) { problems.push(`${id}: nothing opened`); continue; }
    if (!m.insert) problems.push(`${id}: not marked as an insert`);
    if (m.transport) problems.push(`${id}: the exercise transport is on screen`);
    if (m.stale) problems.push(`${id}: ${m.stale} canvas(es) at the wrong size`);
    if (!m.knobs) problems.push(`${id}: no controls`);
    await shot(page, `six-${id}.png`);

    // Move a knob and check it lands in the saved project.
    const dial = await page.$(`${FACE.split(',').map((s) => `${s} .knob-dial`).join(', ')}`);
    if (dial) {
      const before = await page.evaluate(() => localStorage.getItem('headroom.sketch.v1'));
      await dial.focus();
      for (let i = 0; i < 6; i += 1) await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(500);
      const after = await page.evaluate(() => localStorage.getItem('headroom.sketch.v1'));
      if (before === after) problems.push(`${id}: moving a knob changed nothing in the project`);
    }
    // Back to the track for the next one.
    await page.evaluate(() => document.querySelector('[data-to-track]')?.click());
    await page.waitForTimeout(500);
  }

  // And what is stored for one of them, after the move.
  const stored = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('headroom.sketch.v1') ?? '{}');
    return raw.tracks?.[0]?.settings ?? null;
  });
  say('stored:', JSON.stringify(stored));
  return problems;
}
