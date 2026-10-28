// Every knob on every face: that dragging one moves the value it is labelled
// with, and that the dial follows the setting back.
//
// Moved in from a scratchpad, where it ran when somebody remembered to run
// it. See harness.mjs for why that is the same as not having it.

import { open, FACES, TOOLS, SIZES } from './harness.mjs';

export const name = 'knobs';

export async function check({ browser, at, say }) {
  const problems = [];
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  await page.goto(at, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
  await page.click('[data-view="tools"]');
  await page.waitForTimeout(300);

  // Each face by its own class rather than by waiting long enough, which is
  // the difference between a check and a coin toss. Opening a tool tears the
  // desk down and builds it again, and one of those effects now has a worklet
  // to install - so the old 450 ms was sometimes measuring the face before it
  // and reading, for instance, the delay's seven knobs under Saturation's
  // name. It was not wrong about anything; it was looking at the wrong thing.
  const FACES_BY_TOOL = {
    EQ: 'eq',
    Compression: 'comp',
    Stereo: 'stereo',
    Reverb: 'verb',
    Delay: 'echo',
    Saturation: 'heat',
  };

  /** Clicks a tool and waits for that tool's own face to be the one there. */
  const openFace = async (tool) => {
    await page.click(`.modes button:text-is("${tool}")`);
    await page.waitForSelector(`.surface .plugin.${FACES_BY_TOOL[tool]}`, { timeout: 8000 });
    await page.waitForTimeout(120);
  };

  for (const tool of Object.keys(FACES_BY_TOOL)) {
    await openFace(tool);
    const dressed = await page.evaluate(() => {
      const dials = [...document.querySelectorAll('.surface .knob-dial')];
      const faces = [...document.querySelectorAll('.surface .knob-face')];
      return {
        dials: dials.length,
        faces: faces.length,
        ticks: document.querySelectorAll('.surface .knob-ticks i').length,
        angles: faces.map((f) => f.style.getPropertyValue('--angle')).filter(Boolean).length,
      };
    });
    if (dressed.dials !== dressed.faces) problems.push(`${tool}: ${dressed.dials} dials but ${dressed.faces} faces`);
    if (dressed.ticks !== dressed.faces * 11) problems.push(`${tool}: ${dressed.ticks} ticks for ${dressed.faces} knobs`);
    if (dressed.angles !== dressed.faces) problems.push(`${tool}: ${dressed.faces - dressed.angles} knobs never pointed anywhere`);
    say(tool.padEnd(12), JSON.stringify(dressed));
  }

  // Drag one and see the value, the readout and the pointer all move together.
  await openFace('Compression');
  const before = await page.evaluate(() => {
    const dial = document.querySelector('.surface [data-dial="threshold"]');
    return { value: Number(dial.value), angle: dial.parentElement.querySelector('.knob-face').style.getPropertyValue('--angle'), read: document.querySelector('#comp-threshold-value').textContent };
  });
  const box = await page.$eval('.surface [data-dial="threshold"]', (d) => {
    const r = d.parentElement.querySelector('.knob-face').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.mouse.move(box.x, box.y - 40, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(350);
  const after = await page.evaluate(() => {
    const dial = document.querySelector('.surface [data-dial="threshold"]');
    return { value: Number(dial.value), angle: dial.parentElement.querySelector('.knob-face').style.getPropertyValue('--angle'), read: document.querySelector('#comp-threshold-value').textContent };
  });
  say('drag up 40px:', JSON.stringify(before), '->', JSON.stringify(after));
  if (!(after.value > before.value)) problems.push('dragging up did not raise the value');
  if (after.angle === before.angle) problems.push('the pointer did not move');
  if (after.read === before.read) problems.push('the readout did not follow');

  // Keyboard still works through the input that is still there.
  await page.focus('.surface [data-dial="ratio"]');
  const kBefore = await page.$eval('.surface [data-dial="ratio"]', (d) => Number(d.value));
  for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(250);
  const kAfter = await page.evaluate(() => {
    const d = document.querySelector('.surface [data-dial="ratio"]');
    return { value: Number(d.value), angle: d.parentElement.querySelector('.knob-face').style.getPropertyValue('--angle') };
  });
  say('four arrow-ups:', kBefore, '->', JSON.stringify(kAfter));
  if (!(kAfter.value > kBefore)) problems.push('the arrow keys no longer move it');

  // The EQ's dials follow its curve, which they never did.
  await openFace('EQ');
  const eqBefore = await page.$eval('#eqGain', (d) => Number(d.value));
  await page.click('.eq-canvas');
  for (let i = 0; i < 6; i += 1) await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(350);
  const eqAfter = await page.$eval('#eqGain', (d) => Number(d.value));
  say('eq gain dial after nudging the band up:', eqBefore, '->', eqAfter);
  if (eqAfter === eqBefore) problems.push("the EQ's gain dial still does not follow the band");

  return problems;
}
