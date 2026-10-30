// The side chain: that keying a compressor from another track actually moves
// its needle, and that muting the key track stops it.
//
// Moved in from a scratchpad, where it ran when somebody remembered to run
// it. See harness.mjs for why that is the same as not having it.

import { open, shot, FACES, TOOLS, SIZES } from './harness.mjs';

export const name = 'chain';

export async function check({ browser, at, say }) {
  const problems = [];
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  await page.goto(at, { waitUntil: 'networkidle' });
  await page.waitForTimeout(350);
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(350);
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
  await page.click('[data-view="sketch"]');
  await page.waitForTimeout(350);

  // Notes on the Kit (track 2) and the Bass (track 1), so there is a kick to
  // duck under and a bass to duck.
  for (const [cell, steps] of [['2:0', [0, 8, 16, 24]], ['1:0', [0, 2, 4, 6, 8, 10, 12, 14]]]) {
    await page.click(`[data-cell="${cell}"]`);
    await page.waitForTimeout(450);
    const all = await page.$$('.step');
    for (const i of steps) await all[i]?.click();
    await page.waitForTimeout(250);
    await page.evaluate(() => document.querySelector('[data-back]')?.click());
    await page.waitForTimeout(250);
  }

  // A compressor on the Bass, opened.
  await page.click('.grid-track:nth-of-type(2) .track-name, .track-name >> nth=1');
  await page.waitForTimeout(400);
  say('track open:', await page.$eval('.editor-title', (e) => e.textContent.trim()));
  await page.click('[data-insert="compression"]');
  await page.waitForTimeout(500);
  await page.click('[data-open-plugin="compression"]');
  await page.waitForTimeout(1200);

  const picker = await page.evaluate(() => {
    const sel = document.querySelector('#compKeyFrom');
    return sel ? { shown: Boolean(sel.offsetParent), options: [...sel.options].map((o) => o.textContent.trim()) } : null;
  });
  say('key picker:', JSON.stringify(picker));
  if (!picker?.shown) problems.push('the key picker is not on the panel');
  if (!picker?.options.includes('Kit')) problems.push('the kit is not on offer as a key');

  await page.selectOption('#compKeyFrom', { label: 'Kit' });
  await page.waitForTimeout(600);
  const stored = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('headroom.sketch.v1') ?? '{}');
    return raw.tracks?.map((t) => [t.id, t.settings?.compression?.keyFrom ?? null]);
  });
  say('stored keys:', JSON.stringify(stored));
  if (!stored?.some(([, k]) => k === 'kit')) problems.push('the key source was not stored');

  // Play it and watch the reduction, which should now be pumping on the kick.
  await page.click('[data-play]');
  await page.waitForTimeout(300);
  await page.click('[data-scene-go="0"]');
  await page.waitForTimeout(2500);
  const pumping = await page.evaluate(async () => {
    const canvas = document.querySelector('#compTrace');
    const c = canvas.getContext('2d');
    const hash = () => {
      const d = c.getImageData(0, 0, canvas.width, canvas.height).data;
      let h = 0;
      for (let i = 0; i < d.length; i += 53) h = (h * 31 + d[i]) | 0;
      return h;
    };
    const seen = new Set();
    for (let i = 0; i < 14; i += 1) { seen.add(hash()); await new Promise((r) => setTimeout(r, 90)); }
    // And how deep the needle is swinging.
    const swings = [];
    for (let i = 0; i < 20; i += 1) {
      const t = document.querySelector('#compVu [data-needle]')?.getAttribute('transform') ?? '';
      swings.push(Math.abs(parseFloat(t.replace('rotate(', '')) || 0));
      await new Promise((r) => setTimeout(r, 70));
    }
    return { pictures: seen.size, deepest: Math.max(...swings).toFixed(1), read: document.querySelector('#compRead')?.textContent.trim() };
  });
  say('with the kit keying it:', JSON.stringify(pumping));
  if (pumping.pictures < 3) problems.push('the reduction never moved with a key feeding it');
  if (Number(pumping.deepest) < 2) problems.push(`the needle barely left zero (${pumping.deepest} degrees)`);
  await shot(page, `chain.png`);

  // Decisive: the kit muted should take the ducking with it, because the key
  // is tapped after that track's fader.
  const swing = async () => page.evaluate(async () => {
    const swings = [];
    for (let i = 0; i < 24; i += 1) {
      const t = document.querySelector('#compVu [data-needle]')?.getAttribute('transform') ?? '';
      swings.push(Math.abs(parseFloat(t.replace('rotate(', '')) || 0));
      await new Promise((r) => setTimeout(r, 70));
    }
    return Number(Math.max(...swings).toFixed(1));
  });
  await page.evaluate(() => {
    // The Kit's mute, from the grid behind the panel.
    const kit = [...document.querySelectorAll('.grid-track')].find((t) => /Kit/.test(t.textContent));
    kit?.querySelector('[data-mute]')?.click();
  });
  await page.waitForTimeout(900);
  const muted = await swing();
  await page.evaluate(() => {
    const kit = [...document.querySelectorAll('.grid-track')].find((t) => /Kit/.test(t.textContent));
    kit?.querySelector('[data-mute]')?.click();
  });
  await page.waitForTimeout(900);
  const back = await swing();
  say('kit muted / unmuted, deepest swing:', muted, '/', back);
  say('state:', await page.evaluate(() => ({
    pos: document.querySelector('[data-pos]')?.textContent.trim(),
    play: document.querySelector('[data-play]')?.textContent.trim(),
    mutes: [...document.querySelectorAll('[data-mute]')].map((b) => `${b.closest('.grid-track')?.textContent.trim().split('\n')[0]}:${b.getAttribute('aria-pressed')}`),
  })));
  if (!(muted < 2)) problems.push(`muting the kit did not stop the ducking (${muted} degrees)`);
  if (!(back > 4)) problems.push(`unmuting the kit did not bring it back (${back} degrees)`);
  return problems;
}
