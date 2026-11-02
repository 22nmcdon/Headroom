// The analysis view, which nothing had ever opened.
//
// Twenty-nine browser checks before this one and not one of them went near
// it - a whole view of four, with three canvases, a readings table, a width
// breakdown and a delivery panel that owns its own transport. The first probe
// of it found a sentence printing the word "null" into the middle of itself.
//
// ## The claim worth making here
//
// The same material in both slots has to read zero. Every reading on this
// page is a comparison, every comparison goes through the gap functions the
// exercises are marked with, and a thing against itself is the one case whose
// answer is known in advance for all of them at once. A reading that cannot
// get that right cannot be trusted about anything, and nothing else on the
// page tells you which readings are even being compared.
//
// Then the other way round: two different things have to read NOT zero, or
// the first claim is satisfied by a page that always says zero.
//
// ## And the delivery panel
//
// Its arithmetic is held in `tests/targets.test.js`. What is held here is
// that the arithmetic reaches the page and agrees with itself: the gain a
// service applies, plus the loudness as delivered, is the loudness it plays
// at. Three numbers printed in three different places on one row, and
// nothing anywhere else checks that they are the same three numbers.

import { open } from './harness.mjs';

export const name = 'analysis';

/** How long a render of the app's own material takes to settle. */
const RENDERED = 3000;

/** A number out of a cell, or NaN. */
const numberIn = (text) => {
  const found = String(text).match(/-?\d+(\.\d+)?/);
  return found ? Number(found[0]) : NaN;
};

export async function check({ browser, at, say }) {
  const problems = [];
  // Tall, because the delivery table is a long way down a page that does not
  // scroll its own figures into view.
  const { page, noise } = await open(browser, at, { view: 'analysis', height: 1500 });
  await page.waitForTimeout(600);

  /* --- nothing loaded says so ---------------------------------------------- */

  const empty = await page.evaluate(() => ({
    note: document.querySelector('#analysisNote')?.textContent.trim() ?? '',
    figures: document.querySelector('#analysisFigures')?.children.length ?? 0,
  }));
  say(`with nothing loaded: "${empty.note}"`);
  if (!/open a file|pick something/i.test(empty.note)) {
    problems.push(`with nothing loaded the page says "${empty.note}" rather than what to do`);
  }

  /* --- one slot, then two -------------------------------------------------- */

  await page.selectOption('[data-pick="yours"]', 'mix');
  await page.waitForTimeout(RENDERED);

  const alone = await page.evaluate(() => ({
    note: document.querySelector('#analysisNote')?.textContent.trim() ?? '',
    figures: document.querySelector('#analysisFigures')?.children.length ?? 0,
    bands: document.querySelectorAll('#analysisBands .band, #analysisBands > *').length,
  }));
  say(`with one slot: "${alone.note}"`);
  if (!/reference/i.test(alone.note)) {
    problems.push(`with one slot loaded the page says "${alone.note}" rather than asking for the other`);
  }
  if (!alone.figures) problems.push('one slot loaded and the figures are empty');
  if (!alone.bands) problems.push('one slot loaded and the width breakdown is empty');

  /* --- a thing against itself reads zero, on every reading ----------------- */

  await page.selectOption('[data-pick="reference"]', 'mix');
  await page.waitForTimeout(RENDERED);

  const same = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#analysisFigures > *')].map((box) => {
      const text = box.innerText.split('\n').map((line) => line.trim()).filter(Boolean);
      return { name: text[1] ?? text[0] ?? '?', value: text[0] ?? '', against: text[2] ?? '' };
    });
    return {
      rows,
      note: document.querySelector('#analysisNote')?.textContent.trim() ?? '',
      canvases: [...document.querySelectorAll('.analysis-canvas')].map((c) => {
        const box = c.getBoundingClientRect();
        return { wide: Math.round(box.width), high: Math.round(box.height), w: c.width, h: c.height };
      }),
    };
  });

  say('\n  the same material in both slots\n');
  say('  reading            value            against the reference');
  for (const row of same.rows) {
    say(`  ${row.name.padEnd(18)} ${row.value.padEnd(16)} ${row.against}`);

    const off = numberIn(row.against);
    if (!Number.isFinite(off)) {
      problems.push(`${row.name}: reads "${row.against}" against itself, with no number in it`);
    } else if (Math.abs(off) > 0.05) {
      problems.push(`${row.name}: the same material against itself reads ${off} apart,`
        + ' so this reading is comparing two different things or comparing them wrongly');
    }
  }
  if (!same.rows.length) problems.push('both slots loaded and there are no figures at all');

  say(`\n  "${same.note}"`);
  // The fault the first probe of this view found. `balanceGap` returns a null
  // `where` when not one band differs - every comparator here uses that
  // convention - and the sentence printed it.
  if (/\bnull\b|\bundefined\b|\bNaN\b/.test(same.note)) {
    problems.push(`the note reads "${same.note}", which has a missing value printed into it`);
  }
  if (/0\.0 LU (louder|quieter)/.test(same.note)) {
    problems.push('the note claims a direction for a difference it has just rounded to nothing');
  }

  // A canvas drawing at a size other than the one it is shown at is a blurred
  // canvas, which is the fault `faces` holds for every tool and nothing held
  // for this page.
  for (const one of same.canvases) {
    if (one.w !== one.wide || one.h !== one.high) {
      problems.push(`a canvas is shown at ${one.wide}x${one.high} and drawn at ${one.w}x${one.h}`);
    }
  }
  say(`  canvases: ${same.canvases.map((c) => `${c.wide}x${c.high}`).join(', ')}`);

  /* --- and two different things do not ------------------------------------- */

  await page.selectOption('[data-pick="reference"]', 'noise');
  await page.waitForTimeout(RENDERED);

  const apart = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('#analysisFigures > *')].map((box) => {
      const text = box.innerText.split('\n').map((line) => line.trim()).filter(Boolean);
      return { name: text[1] ?? '?', against: text[2] ?? '' };
    }),
    note: document.querySelector('#analysisNote')?.textContent.trim() ?? '',
  }));

  const moved = apart.rows.filter((row) => Math.abs(numberIn(row.against)) > 0.05);
  say(`\n  the bed against pink noise: ${moved.length} of ${apart.rows.length} readings moved`);
  say(`  "${apart.note}"`);
  if (moved.length < 3) {
    problems.push(`only ${moved.length} readings moved between the bed and pink noise,`
      + ' so a page that always reads zero would pass the check above');
  }
  if (!/dB at /.test(apart.note)) {
    problems.push(`two different things and the note still says "${apart.note}"`);
  }

  /* --- the delivery panel agrees with itself ------------------------------- */

  const rows = await page.evaluate(() => {
    const table = document.querySelector('#analysisDelivery');
    if (!table) return null;
    // One row per service: its name, the gain it applies, the loudness it
    // plays at, where that leaves the peak, and the verdict.
    return [...table.querySelectorAll('.delivery-row')].map((row) => ({
      name: row.querySelector('.delivery-name')?.innerText.trim() ?? '',
      move: row.querySelector('.delivery-move')?.innerText.trim() ?? '',
      reads: [...row.querySelectorAll('.delivery-read')].map((c) => c.innerText.trim()),
      verdict: row.querySelector('.delivery-verdict')?.innerText.trim() ?? '',
      off: row.classList.contains('is-off'),
    }));
  });

  if (!rows || !rows.length) {
    problems.push('the delivery table has no rows in it');
  } else {
    say(`\n  what each service would do, ${rows.length} rows\n`);
    const asDelivered = await page.evaluate(() => {
      const box = document.querySelector('#analysisDelivery');
      const found = box.innerText.match(/(-?\d+(?:\.\d+)?)\s*LUFS, as delivered/);
      return found ? Number(found[1]) : NaN;
    });
    say(`  as delivered: ${asDelivered} LUFS`);
    if (!Number.isFinite(asDelivered)) {
      problems.push('the delivery panel does not say what was delivered');
    }

    say('  service            applies      plays at     peak       meets it');
    for (const row of rows) {
      const line = `${row.name} ${row.move} ${row.reads.join(' ')} ${row.verdict}`;
      say(`  ${row.name.padEnd(18)} ${row.move.padEnd(12)} ${(row.reads[0] ?? '').padEnd(12)}`
        + ` ${(row.reads[1] ?? '').padEnd(10)} ${row.off ? 'no' : 'yes'}`);

      if (/\bnull\b|\bundefined\b|\bNaN\b/.test(line)) {
        problems.push(`the ${row.name} row reads "${line}", with a missing value in it`);
      }
      if (row.reads.length < 2) {
        problems.push(`the ${row.name} row has ${row.reads.length} readings on it, not two`);
      }
    }

    // The arithmetic, from the page's own three numbers. A master handed over
    // at one loudness, plus the gain a service applies, is the loudness that
    // service plays it at - three numbers printed in three places on one row,
    // and nothing anywhere else checks that they are the same three.
    say('');
    let checked = 0;
    for (const row of rows) {
      const gain = numberIn(row.move);
      const played = numberIn(row.reads[0] ?? '');
      if (!Number.isFinite(gain) || !Number.isFinite(played)) continue;

      checked += 1;
      const adds = asDelivered + gain;
      if (Math.abs(adds - played) > 0.15) {
        problems.push(`${row.name}: ${asDelivered} LUFS delivered and ${gain} LU applied`
          + ` is ${adds.toFixed(1)}, and the row says it plays at ${played}`);
      }
    }
    say(`  ${checked} of ${rows.length} rows apply a gain, and each one adds up`
      + ' from what was delivered');
    if (checked < 2) {
      problems.push(`only ${checked} rows had a gain to check, so the arithmetic is untested`);
    }
  }

  problems.push(...noise);
  await page.close();
  return problems;
}
