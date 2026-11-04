// The sketchpad on a phone, which is the machine it was built for.
//
// `project.js` says why the mic track exists: "an idea arrives when the phone
// is the only thing to hand". The count-in starts a take without the
// transport running for the same reason, and `record.js` caps a take at ten
// minutes because of what that costs in a phone's IndexedDB. The phone is not
// a secondary target for this view. It is the argument for it.
//
// And of the eight checks written for the recording work, one ran at phone
// width. The mic panel, the live waveform, the 28-pixel trim grabs, the pads
// that were given `flex-wrap` on purpose and the whole end-to-end journey had
// only ever been driven at 1280 pixels with a mouse.
//
// ## The claims
//
// Nothing scrolls sideways - a page that does is a page where half of every
// control is off the edge. Nothing a thumb has to hit is smaller than a
// thumb. Nothing sits outside the viewport while the thing that opened it
// says it is there. And the two trim grabs, which are 28 pixels wide and
// 14 of that borrowed from their neighbour, can still be told apart by a
// finger when the take is untrimmed and they are as close as they ever get.
//
// Measured rather than asserted first: every box is reported, so the numbers
// are in the output whether or not they pass. A threshold nobody can see the
// far side of is a threshold nobody can argue with.

import { open, shot } from './harness.mjs';

export const name = 'phone';

/** A phone, upright. The 430 is an iPhone 15 Pro Max; 932 is its height. */
const WIDE = 430;
const TALL = 932;

/**
 * How big a thing a thumb has to hit should be.
 *
 * Forty-four, which is Apple's figure and has been since 2008. Not a style
 * rule: it is the width of an adult fingertip's contact patch, so a target
 * below it is one the person cannot see under their own finger while they
 * aim at it.
 */
const THUMB = 44;

/** The starter project's tracks. */
const KIT = 2;
const MIC = 4;

export async function check({ browser, at, say }) {
  const problems = [];
  const { page, noise } = await open(browser, at, {
    view: 'sketch', width: WIDE, height: TALL, touch: true,
  });
  await page.waitForTimeout(600);

  /** Nothing may stick out sideways, at any point in this check. */
  const sideways = async (where) => {
    const over = await page.evaluate(() => {
      const doc = document.documentElement;
      return {
        scroll: doc.scrollWidth,
        seen: doc.clientWidth,
        // And whatever is actually doing it, named rather than left a mystery.
        blame: [...document.querySelectorAll('body *')]
          .filter((el) => {
            const box = el.getBoundingClientRect();
            return box.width > 0 && box.right > doc.clientWidth + 1;
          })
          .slice(0, 4)
          .map((el) => `${el.tagName.toLowerCase()}.${(el.className || '').toString()
            .split(' ')[0]} to ${Math.round(el.getBoundingClientRect().right)}px`),
      };
    });
    if (over.scroll > over.seen + 1) {
      problems.push(`${where}: the page is ${over.scroll}px wide in a ${over.seen}px window`
        + ` - ${over.blame.join('; ') || 'nothing named'}`);
    }
    return over;
  };

  /**
   * Open a slot, the way the phone layout requires.
   *
   * `styles.css:2516` hides the grid whenever a panel is open at this width -
   * the phone shows one or the other, never both, and `[data-back]` exists
   * only here for that reason. So a cell behind an open panel is genuinely
   * not there to tap, and the first version of this check drove the grid like
   * a desktop and timed out on an invisible cell. Which is the check finding
   * the layout it was written to find, by falling over it.
   */
  const openCell = async (track, scene) => {
    const open = await page.evaluate(() => document
      .querySelector('.sketch-body')?.dataset.open ?? 'none');
    if (open !== 'none') {
      await page.tap('[data-back]');
      await page.waitForTimeout(400);
    }
    await page.tap(`[data-cell="${track}:${scene}"]`);
    await page.waitForTimeout(600);
  };

  /** Every box in a group, measured and reported. */
  const boxes = (selector) => page.evaluate((css) => [...document.querySelectorAll(css)]
    .map((el) => {
      const box = el.getBoundingClientRect();
      return {
        what: el.dataset.pad ?? el.dataset.grab ?? el.dataset.cell
          ?? (el.textContent || '').trim().slice(0, 14) ?? el.tagName,
        w: Math.round(box.width),
        h: Math.round(box.height),
        left: Math.round(box.left),
        right: Math.round(box.right),
        seen: box.width > 0 && box.height > 0,
      };
    }), selector);

  /* --- the grid, which is the first thing anybody sees ------------------- */

  // The gesture that lets an audio context exist, before any panel is open:
  // on a phone the transport is the only thing on screen either way.
  await page.tap('[data-play]');
  await page.waitForTimeout(500);
  await page.tap('[data-play]');
  await page.waitForTimeout(300);

  const onGrid = await sideways('the clip grid');
  say(`  the grid: page ${onGrid.scroll}px in a ${onGrid.seen}px window`);

  const cells = await boxes('[data-cell]');
  const smallCell = cells.filter((one) => one.w < THUMB || one.h < THUMB);
  say(`  ${cells.length} cells, smallest ${Math.min(...cells.map((c) => c.w))}`
    + `×${Math.min(...cells.map((c) => c.h))}px`);
  if (smallCell.length) {
    problems.push(`${smallCell.length} of ${cells.length} clip slots are under ${THUMB}px`
      + ` - the smallest is ${smallCell[0].w}×${smallCell[0].h}, and a slot too small to`
      + ' hit is a slot whose long-press cannot be started either');
  }
  await shot(page, 'phone-grid');

  /* --- the mic panel, which is all new --------------------------------- */

  await openCell(MIC, 0);

  const micPanel = await sideways('the mic panel');
  const micBits = await page.evaluate(() => {
    const seenOf = (css) => {
      const el = document.querySelector(css);
      if (!el) return null;
      const box = el.getBoundingClientRect();
      return {
        w: Math.round(box.width), h: Math.round(box.height),
        right: Math.round(box.right), top: Math.round(box.top),
      };
    };
    return {
      button: seenOf('[data-mic]'),
      meter: seenOf('.in-meter'),
      clock: seenOf('.rec-clock'),
      wave: seenOf('.clip-wave'),
      canvas: seenOf('.clip-wave canvas'),
      pick: seenOf('.in-pick'),
      about: seenOf('.rec-about'),
      said: document.querySelector('[data-said]')?.textContent.trim().slice(0, 60) ?? '',
    };
  });

  say(`\n  the mic panel at ${WIDE}px (page ${micPanel.scroll}px):`);
  for (const [name_, box] of Object.entries(micBits)) {
    if (box && typeof box === 'object') {
      say(`    ${name_.padEnd(8)} ${String(box.w).padStart(4)}×${String(box.h).padEnd(4)}`
        + ` right edge ${box.right}`);
    }
  }

  if (!micBits.button) {
    problems.push('the record button is not on the mic panel at phone width');
  } else if (micBits.button.h < THUMB) {
    problems.push(`the record button is ${micBits.button.w}×${micBits.button.h}px`
      + ` - under ${THUMB}, and it is the one control this whole panel exists for`);
  }
  if (!micBits.meter) {
    problems.push('the input meter is missing at phone width - setting a level by ear alone'
      + ' is the thing the meter was built to stop');
  }
  if (!micBits.wave || !micBits.canvas) {
    problems.push('the waveform is missing at phone width');
  } else if (micBits.canvas.h < 40) {
    problems.push(`the waveform is ${micBits.canvas.h}px tall on a phone, which is not enough`
      + ' to see the shape of anything in');
  }
  await shot(page, 'phone-mic-panel');

  /* --- and recording, which is the panel doing its job ------------------- */

  const able = await page.evaluate(async () => {
    const { canRecord } = await import('./src/sketch/record.js');
    return canRecord();
  });

  if (!able) {
    say('  (this browser will not record, so the live panel is not driven)');
  } else {
    await page.tap('[data-mic]');
    await page.waitForTimeout(2600);

    const live = await sideways('while recording');
    const running = await page.evaluate(() => ({
      clock: document.querySelector('.rec-clock')?.textContent.trim() ?? '',
      fill: document.querySelector('.in-fill')?.getBoundingClientRect().width ?? 0,
      pressed: document.querySelector('[data-mic]')?.getAttribute('aria-pressed') ?? '',
    }));
    say(`\n  recording at ${WIDE}px: clock "${running.clock}",`
      + ` meter ${Math.round(running.fill)}px wide, page ${live.scroll}px`);
    await shot(page, 'phone-recording');

    await page.tap('[data-mic]');
    await page.waitForTimeout(1500);

    /* --- the trim grabs, which is where the fingers are smallest -------- */

    const afterTake = await sideways('a recorded take');
    const grabs = await boxes('[data-grab]');
    const canvasBox = (await boxes('.clip-wave canvas'))[0];
    say(`\n  the take at ${WIDE}px (page ${afterTake.scroll}px), canvas`
      + ` ${canvasBox?.w}×${canvasBox?.h}px:`);
    for (const one of grabs) {
      say(`    grab "${one.what}" ${one.w}×${one.h}px at ${one.left}–${one.right}`);
    }

    if (grabs.length !== 2) {
      problems.push(`a recorded take shows ${grabs.length} trim handles rather than two`);
    } else {
      // Untrimmed, they sit at the two ends - which is as close as they get
      // only on a take shorter than the handles are wide. Apart is the claim.
      const [from, to] = grabs;
      const gap = to.left - from.right;
      say(`    and ${gap}px between them`);
      if (gap < 0) {
        problems.push(`the two trim handles overlap by ${-gap}px on an untrimmed take`
          + ' - one finger lands on both and the take cannot be trimmed from either end');
      }
      for (const one of grabs) {
        if (one.w < 28) {
          problems.push(`the "${one.what}" handle is ${one.w}px wide, under its designed 28`);
        }
        if (one.left < -1 || (canvasBox && one.right > canvasBox.right + 15)) {
          problems.push(`the "${one.what}" handle sits at ${one.left}–${one.right},`
            + ` outside the waveform it trims (${canvasBox?.left}–${canvasBox?.right})`);
        }
      }
    }
    await shot(page, 'phone-trim');
  }

  /* --- the pads, which were given flex-wrap for this width --------------- */

  await openCell(KIT, 0);

  const onPads = await sideways('the pads');
  const pads = await boxes('[data-pad]');
  const rows = new Set(pads.map((one) => one.right - one.w));
  say(`\n  the pads at ${WIDE}px (page ${onPads.scroll}px): ${pads.length} of them`);
  for (const one of pads) {
    say(`    pad ${String(one.what).padEnd(4)} ${one.w}×${one.h}px at ${one.left}–${one.right}`);
  }

  if (!pads.length) {
    problems.push('no pads at phone width - the one surface that is faster played than drawn');
  }
  for (const one of pads) {
    if (one.h < THUMB) {
      problems.push(`pad ${one.what} is ${one.w}×${one.h}px - under ${THUMB}, and a pad is`
        + ' struck in time rather than aimed at, so it is the one control that cannot be small');
    }
    if (one.right > WIDE + 1) {
      problems.push(`pad ${one.what} runs to ${one.right}px in a ${WIDE}px window`);
    }
  }
  say(`    on ${rows.size === pads.length ? 'separate' : 'shared'} rows`);
  await shot(page, 'phone-pads');

  /* --- and the steps, which are the other way to write a part ----------- */

  const steps = await boxes('.steps [data-step]');
  if (steps.length) {
    const tiny = steps.filter((one) => one.w < 24 || one.h < 24);
    say(`\n  ${steps.length} steps, smallest ${Math.min(...steps.map((s) => s.w))}`
      + `×${Math.min(...steps.map((s) => s.h))}px`);
    // A step is aimed at rather than struck in time, and there are sixteen of
    // them across a 430-pixel screen, so 44 is not available and not the
    // right number. Twenty-four is: smaller than a fingertip, big enough to
    // hit deliberately, and what every step sequencer on a phone uses.
    if (tiny.length) {
      problems.push(`${tiny.length} of ${steps.length} steps are under 24px`
        + ` (smallest ${tiny[0].w}×${tiny[0].h})`);
    }
  }
  await shot(page, 'phone-steps');

  problems.push(...noise);
  await page.close();
  return problems;
}
