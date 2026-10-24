// Every face, at every size: does anything stick out of the chassis, is any
// canvas drawing at a size other than the one it is shown at, and does the
// page scroll sideways.
//
// This one found the deck overflowing the chassis in landscape the hour the
// saturator got its sixth curve button, and the stereo plugin failing to
// mount at all after a rename - with 528 unit tests passing both times.
//
// It looked only sideways until the EQ's face was rebuilt, which is a strange
// hole for a check about things not fitting: a chassis clips what runs off
// its bottom edge just as happily, and what you get is not a broken layout
// but a knob that is quietly not there.

import { open, FACES, TOOLS, SIZES } from './harness.mjs';

export const name = 'faces';

export async function check({ browser, at, say }) {
  const problems = [];

  for (const [label, width, height] of SIZES) {
    const { page, noise } = await open(browser, at, { width, height, view: 'tools' });

    for (const tool of TOOLS) {
      await page.click(`.modes button:text-is("${tool}")`);
      await page.waitForTimeout(500);

      const seen = await page.evaluate((sel) => {
        const face = document.querySelector(sel);
        if (!face) return { missing: true };
        const box = face.getBoundingClientRect();

        const canvases = [...face.querySelectorAll('canvas')].map((c) => {
          const b = c.getBoundingClientRect();
          return { w: b.width, h: b.height, aw: c.width, ah: c.height };
        });

        return {
          w: Math.round(box.width),
          h: Math.round(box.height),
          canvases: canvases.length,
          // Drawn at a size other than the one it is shown at, which is a
          // blurred or clipped display rather than a wrong one, so nothing
          // throws and nobody notices.
          stale: canvases.filter((c) => c.aw !== Math.round(c.w * devicePixelRatio)
            || c.ah !== Math.round(c.h * devicePixelRatio)).length,
          over: [...face.querySelectorAll('*')].some((kid) => {
            const b = kid.getBoundingClientRect();
            return b.width > 0 && (b.right > box.right + 1.5 || b.left < box.left - 1.5);
          }),
          // And out of the bottom, which this did not look for. The chassis
          // clips what overflows it, so a deck that does not fit is not a
          // layout that breaks - it is a knob that is silently not there,
          // which is worse. Only downwards: a face is a column, and nothing
          // in this app is anchored to the bottom of one.
          under: [...face.querySelectorAll('*')].reduce((worst, kid) => {
            const b = kid.getBoundingClientRect();
            return b.height > 0 ? Math.max(worst, b.bottom - box.bottom) : worst;
          }, 0),
          sideways: document.documentElement.scrollWidth > innerWidth + 1,
        };
      }, FACES);

      const where = `${label}/${tool}`;
      if (seen.missing) { problems.push(`${where}: no face in the page at all`); continue; }
      say(`${label.padEnd(10)} ${tool.padEnd(12)} ${String(seen.w).padStart(4)}x${String(seen.h).padStart(4)}`
        + `  canvases ${seen.canvases}${seen.stale ? ` STALE ${seen.stale}` : ''}${seen.over ? '  OVERFLOWS' : ''}`
        + `${seen.under > 1.5 ? `  CUT OFF BY ${Math.round(seen.under)}` : ''}`);
      if (seen.stale) problems.push(`${where}: ${seen.stale} canvas(es) drawing at the wrong size`);
      if (seen.over) problems.push(`${where}: something sticks out of the face`);
      if (seen.under > 1.5) {
        problems.push(`${where}: ${Math.round(seen.under)}px of the face is below the chassis `
          + 'and clipped away');
      }
      if (seen.sideways) problems.push(`${where}: the page scrolls sideways`);
    }

    problems.push(...noise.map((n) => `${label}: ${n}`));
    await page.close();
  }

  return problems;
}
