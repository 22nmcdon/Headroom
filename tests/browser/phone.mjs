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
 * And the same phone on its side, which `styles.css:3649` calls "the right
 * way up for this": a clip grid wants width and the step grid wants as many
 * rows on screen as it can get. What is scarce there is height, and every
 * rule in that section is something giving height back.
 *
 * Driven because that section was written and never pressed. It sets its own
 * `.step` height - and at 17px it is below the 18 that portrait had before
 * this check raised it, so the orientation somebody actually holds a phone in
 * to work on a timeline had the smallest targets in the app.
 */
const LONG = 932;
const SHORT = 430;

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
const PIANO = 0;
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
        what: el.dataset.pad ?? el.dataset.grab ?? el.dataset.cell ?? el.dataset.step
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
      // And dragged with a pointer, which nothing here used to do: the drag
      // read a constant `grid.js` never imported, so every move of a handle
      // threw and the take could only be trimmed by keyboard.
      const spot = await page.evaluate(() => {
        document.querySelector('[data-trimmable]')?.scrollIntoView({ block: 'center' });
        const grab = document.querySelector('[data-grab="from"]')?.getBoundingClientRect();
        const wave = document.querySelector('[data-trimmable]')?.getBoundingClientRect();
        return grab && wave && {
          x: grab.left + grab.width / 2,
          y: grab.top + grab.height / 2,
          to: wave.left + wave.width * 0.4,
          before: document.querySelector('[data-grab="from"]').getAttribute('aria-valuenow'),
        };
      });
      if (spot) {
        const errors = noise.length;
        await page.mouse.move(spot.x, spot.y);
        await page.mouse.down();
        await page.mouse.move(spot.to, spot.y, { steps: 5 });
        await page.mouse.up();
        await page.waitForTimeout(400);
        const after = await page.evaluate(() => document.querySelector('[data-grab="from"]')
          ?.getAttribute('aria-valuenow'));
        say(`    dragged the start handle: ${spot.before}s → ${after}s`);
        if (noise.length > errors) {
          problems.push(`dragging a trim handle threw: ${noise.slice(errors).join('; ')}`);
        } else if (!(Number(after) > Number(spot.before))) {
          problems.push(`dragging the start handle 40% in left it at ${after}s - a drag moved nothing`);
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

  /* --- and the same phone on its side ----------------------------------- */

  // Turned rather than reloaded, so the take recorded above is still there to
  // measure the trim handles against. The media queries key on height, so
  // this crosses into `@media (max-height: 560px)` and out of the
  // `max-width: 560px` block - a different set of rules, not fewer.
  await page.setViewportSize({ width: LONG, height: SHORT });
  await page.waitForTimeout(700);

  const turned = await sideways('on its side');
  say(`\n  turned to ${LONG}x${SHORT} (page ${turned.scroll}px in ${turned.seen}px):`);

  // Nothing open first. `styles.css:2516` hides the grid behind an open panel
  // at this height as well as at this width, and for a reason it states: a
  // 430-point window split two ways gives the grid half and the panel half
  // and fits neither. So the grid is measured with nothing over it, which is
  // the only state it is ever visible in here. Measuring it with the step
  // panel still open is how this check first reported twenty slots of 0x0.
  await page.tap('[data-back]').catch(() => {});
  await page.waitForTimeout(500);
  const sideCells = await boxes('[data-cell]');
  if (sideCells.length) {
    say(`    ${sideCells.length} cells, smallest ${Math.min(...sideCells.map((c) => c.w))}`
      + `x${Math.min(...sideCells.map((c) => c.h))}px`);
    const small = sideCells.filter((one) => one.w < THUMB || one.h < THUMB);
    if (small.length) {
      problems.push(`on its side, ${small.length} of ${sideCells.length} clip slots are under`
        + ` ${THUMB}px - the smallest is ${small[0].w}x${small[0].h}`);
    }
  }
  await shot(page, 'phone-side-grid');

  // The step grid, which is the reason this orientation has a section at all.
  await openCell(KIT, 0);
  const sideSteps = await boxes('.steps [data-step]');
  const sidePads = await boxes('[data-pad]');
  const sideMic = await boxes('[data-mic]');

  if (sideSteps.length) {
    const tall = Math.min(...sideSteps.map((one) => one.h));
    const rows = new Set(sideSteps.map((one) => one.what.split(':')[0])).size;
    say(`    ${sideSteps.length} steps, smallest ${Math.min(...sideSteps.map((s) => s.w))}`
      + `x${tall}px`);
    say(`    and ${await page.evaluate(() => [...document
      .querySelectorAll('.steps [data-step]')]
      .filter((el) => el.getBoundingClientRect().bottom <= window.innerHeight).length)}`
      + ` of them above the fold, over ${rows} rows`);
    // Not the portrait floor, and not for want of trying. The piano offers 15
    // rows and the furniture above them takes 98 of a 430-point window, so
    // 332 remain: fifteen rows of 20 and a pixel between them is 314, and 24
    // would need 374 and push the bottom of the keyboard off the screen.
    // Twenty is what the arithmetic allows. The claim below is the one the
    // number is really in service of.
    if (tall < 20) {
      problems.push(`on its side, the steps are ${tall}px tall - under 20, and this is the`
        + ' orientation the step grid exists for');
    }
  }
  for (const one of sidePads) {
    if (one.h < THUMB) {
      problems.push(`on its side, pad ${one.what} is ${one.w}x${one.h}px`);
    }
  }
  await shot(page, 'phone-side-steps');

  // The piano, which is the case the 17px was chosen for: a kit has three
  // rows and a scale has ten or so, and "more of the keyboard on screen at
  // once" is a claim about the long one. Measured rather than assumed, so the
  // height is picked from what fits rather than from caution.
  await openCell(PIANO, 0);
  const keyboard = await page.evaluate(() => {
    const steps = [...document.querySelectorAll('.steps [data-step]')];
    if (!steps.length) return null;
    const rows = new Set(steps.map((el) => el.dataset.step.split(':')[0]));
    const box = document.querySelector('.steps')?.getBoundingClientRect();
    return {
      rows: rows.size,
      tall: Math.round(steps[0].getBoundingClientRect().height),
      grid: Math.round(box?.height ?? 0),
      top: Math.round(box?.top ?? 0),
      window: window.innerHeight,
      onScreen: steps.filter((el) => el.getBoundingClientRect().bottom
        <= window.innerHeight).length,
      of: steps.length,
    };
  });
  if (keyboard) {
    say(`    the piano: ${keyboard.rows} rows at ${keyboard.tall}px =`
      + ` ${keyboard.grid}px of grid, starting ${keyboard.top}px down a`
      + ` ${keyboard.window}px window - ${keyboard.onScreen} of ${keyboard.of}`
      + ' steps above the fold');
    // The claim of this orientation, held as well as the row height, because
    // the two trade against each other and a check on only one of them can
    // be satisfied by breaking the other.
    if (keyboard.onScreen < keyboard.of) {
      problems.push(`on its side, ${keyboard.of - keyboard.onScreen} of the piano's`
        + ` ${keyboard.of} steps are below the fold - "more of the keyboard on screen at`
        + ' once" is what this orientation has a section of its own for');
    }
  }

  /* --- and the scale that never fitted ---------------------------------- */

  // The claim above is about a seven-note scale, and this check only ever ran
  // the default one. Chromatic is twelve steps to the octave: the same two
  // octaves come out as 25 rows wanting 524 pixels of a 332-pixel window, so
  // it has never fitted and never could at a row height worth tapping.
  //
  // So the claim for it is a different one, and the one that actually
  // matters: nothing is out of reach, and what moves to reach it is the grid
  // rather than the page - because scrolling the page takes the transport
  // and the clip's name away with it.
  await page.evaluate(async () => {
    const { loadSketch, saveSketch } = await import('./src/sketch/store.js');
    const { setProject } = await import('./src/sketch/project.js');
    const had = loadSketch();
    if (had) saveSketch(setProject(had, { key: { root: 0, scale: 'chromatic' } }));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
  await page.click('[data-view="sketch"]');
  await page.waitForTimeout(400);
  await openCell(PIANO, 0);

  const wide = await page.evaluate(() => {
    const steps = [...document.querySelectorAll('.steps [data-step]')];
    const grid = document.querySelector('.steps');
    const doc = document.documentElement;
    if (!steps.length || !grid) return null;
    return {
      rows: new Set(steps.map((el) => el.dataset.step.split(':')[0])).size,
      tall: Math.round(grid.scrollHeight),
      seen: Math.round(grid.clientHeight),
      gridScroll: grid.scrollHeight - grid.clientHeight,
      pageScroll: doc.scrollHeight - doc.clientHeight,
    };
  });

  if (!wide) {
    problems.push('a chromatic sketch offers no steps at all on its side');
  } else {
    say(`\n  chromatic on its side: ${wide.rows} rows, ${wide.tall}px of grid in`
      + ` ${wide.seen}px — the grid scrolls ${wide.gridScroll}px, the page ${wide.pageScroll}px`);

    if (wide.rows < 20) {
      problems.push(`a chromatic sketch shows ${wide.rows} rows, which is not a chromatic scale`);
    }
    if (!(wide.gridScroll > 0)) {
      problems.push(`${wide.tall}px of keyboard sits in ${wide.seen}px and the grid does not`
        + ' scroll - so the only way to a low note is to scroll the page, which takes the'
        + ' transport and the clip name off the screen');
    }
    // And the rows really are reachable once it does scroll.
    const reached = await page.evaluate(() => {
      const grid = document.querySelector('.steps');
      grid.scrollTop = grid.scrollHeight;
      const steps = [...document.querySelectorAll('.steps [data-step]')];
      const last = steps[steps.length - 1].getBoundingClientRect();
      const box = grid.getBoundingClientRect();
      return { inside: last.bottom <= box.bottom + 2 && last.top >= box.top - 2 };
    });
    if (!reached.inside) {
      problems.push('scrolling the grid to its end does not bring the lowest row into it');
    }
  }
  await shot(page, 'phone-side-piano');

  for (const one of sideMic) {
    say(`    record button ${one.w}x${one.h}px`);
    if (one.h < THUMB) {
      problems.push(`on its side, the record button is ${one.w}x${one.h}px`);
    }
  }
  await sideways('on its side, with a panel open');

  problems.push(...noise);
  await page.close();
  return problems;
}
