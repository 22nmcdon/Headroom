// Playing a part in, by the pads that do it.
//
// This exists because of what looking for them found. `tap.js` is a tested
// module about snapping a tapped hit onto the nearest line of a grid; the
// grid has a `hitPad` handler that sounds the note and writes it down, an
// `[data-arm]` handler that arms the writing, a `sayTap` that reports how far
// off the last few hits were, and `.pad` styling with a comment about three
// pads for "the part of a sketch that is faster played than drawn".
//
// Nothing anywhere rendered a pad. Not one. So the whole feature - the
// handlers, the arithmetic, the styling, the timing feedback - was wired to
// buttons that had never existed, and playing a part in had never once been
// possible. A search of the repository for `data-pad` returned the handler
// and nothing else.
//
// ## The claims
//
// That the pads are there, that pressing one writes a note where the clock
// says, and that pressing one while not recording writes nothing - because a
// pad that only works while recording is a pad nobody can find the sound of,
// and one that writes while not recording is a pad that fills a clip with
// notes somebody was only auditioning.

import { open } from './harness.mjs';

export const name = 'pads';

/** The starter project's tracks: a kit at 2 and a piano at 0. */
const KIT = 2;
const PIANO = 0;

export async function check({ browser, at, say }) {
  const problems = [];
  const { page, noise } = await open(browser, at, { view: 'sketch', height: 1200 });
  await page.waitForTimeout(400);

  /* --- the pads a track offers ------------------------------------------- */

  const padsOn = async (cell) => {
    await page.click(`[data-cell="${cell}"]`);
    await page.waitForTimeout(600);
    return page.evaluate(() => ({
      pads: [...document.querySelectorAll('[data-pad]')]
        .map((one) => ({ pitch: Number(one.dataset.pad), label: one.textContent.trim() })),
      arm: !!document.querySelector('[data-arm]'),
      said: document.querySelector('[data-tap-said]')?.textContent.trim() ?? '',
      rows: [...document.querySelectorAll('.steps [data-step]')]
        .map((one) => Number(one.dataset.step.split(':')[0])),
    }));
  };

  const kit = await padsOn(`${KIT}:0`);
  say(`  the kit offers ${kit.pads.length} pads: ${kit.pads.map((p) => p.label).join(' · ')}`);
  say(`  it says "${kit.said}"`);

  if (kit.pads.length !== 3) {
    problems.push(`the kit offers ${kit.pads.length} pads rather than its three drums`);
  }
  if (!kit.arm) {
    problems.push('the kit has pads and no way to record what is played on them');
  }
  if (!kit.said) {
    problems.push('nothing tells anybody what the pads are for or how they land');
  }

  // The pads and the grid have to name the same pitches, or what can be drawn
  // and what can be played are two different parts of the same track.
  const kitPitches = [...new Set(kit.pads.map((p) => p.pitch))].sort((a, b) => a - b);
  const kitRows = [...new Set(kit.rows)].sort((a, b) => a - b);
  say(`  pads ${kitPitches.join(',')} against grid rows ${kitRows.join(',')}`);
  if (kitPitches.join() !== kitRows.join()) {
    problems.push(`the pads play ${kitPitches.join(',')} and the grid draws ${kitRows.join(',')}`
      + ' - what can be played and what can be drawn are different parts of one track');
  }

  await page.click('[data-back]').catch(() => {});
  await page.waitForTimeout(300);

  const piano = await padsOn(`${PIANO}:0`);
  say(`\n  the piano offers ${piano.pads.length} pads:`
    + ` ${piano.pads.map((p) => p.label).join(' · ')}`);
  if (piano.pads.length < 8) {
    problems.push(`a melodic track offers ${piano.pads.length} pads, which is not its scale`);
  }
  // Ascending, because a row of pads reads like a keyboard even though the
  // grid above it runs downwards like a stave.
  const climbing = piano.pads.every((one, i) => i === 0 || one.pitch > piano.pads[i - 1].pitch);
  if (!climbing) {
    problems.push(`the piano's pads run ${piano.pads.map((p) => p.label).join(',')} - a row of`
      + ' pads reads left to right as going up');
  }

  /* --- and what a press does ---------------------------------------------- */

  // Not armed: heard and not written. A clip filling with notes somebody was
  // only listening to is worse than no pads at all.
  const idle = await page.evaluate(async () => {
    const before = document.querySelectorAll('.steps [data-step][data-on="true"]').length;
    document.querySelector('[data-pad]')?.click();
    await new Promise((ok) => setTimeout(ok, 400));
    return { before, after: document.querySelectorAll('.steps [data-step][data-on="true"]').length };
  });
  say(`\n  a pad pressed while not recording: ${idle.before} notes before, ${idle.after} after`);
  if (idle.after !== idle.before) {
    problems.push('a pad pressed while not recording wrote a note - a clip that fills up with'
      + ' whatever somebody auditioned is worse than no pads');
  }

  // Armed, with the clock running: written, on a line of the grid.
  const played = await page.evaluate(async () => {
    document.querySelector('[data-arm]')?.click();
    await new Promise((ok) => setTimeout(ok, 200));
    const armed = document.querySelector('[data-arm]')?.getAttribute('aria-pressed');
    const said = document.querySelector('[data-tap-said]')?.textContent.trim() ?? '';

    document.querySelector('[data-play]')?.click();
    await new Promise((ok) => setTimeout(ok, 700));

    const before = document.querySelectorAll('.steps [data-step][data-on="true"]').length;
    for (const _ of [0, 1, 2]) {
      document.querySelector('[data-pad]')?.click();
      await new Promise((ok) => setTimeout(ok, 260));
    }
    await new Promise((ok) => setTimeout(ok, 400));
    const after = document.querySelectorAll('.steps [data-step][data-on="true"]').length;
    const told = document.querySelector('[data-tap-said]')?.textContent.trim() ?? '';

    document.querySelector('[data-play]')?.click();
    await new Promise((ok) => setTimeout(ok, 200));
    return { armed, said, before, after, told };
  });

  say(`  armed: aria-pressed=${played.armed} — "${played.said}"`);
  say(`  three taps with the clock running: ${played.before} notes before, ${played.after} after`);
  say(`  it then says "${played.told}"`);

  if (played.armed !== 'true') {
    problems.push(`arming reads aria-pressed="${played.armed}"`);
  }
  if (!(played.after > played.before)) {
    problems.push(`three taps with the clock running and the clip went from ${played.before}`
      + ` notes to ${played.after} - the pads are on the page and not writing anything, which`
      + ' is what every one of these handlers did before a pad existed to press');
  }
  if (!/hit|time|grid/i.test(played.told)) {
    problems.push(`after tapping, the line reads "${played.told}" rather than how the hits sat`);
  }

  problems.push(...noise);
  await page.close();
  return problems;
}
