// What a tool does with a click while its round is still arriving.
//
// Opening a tool puts its face on the page at once, and the round that
// opened it attaches a moment later - its material rendered, its fault
// baked in, and then its starting settings put on the face. That moment is
// 0.2 to 0.8 seconds, measured, and the face used to take input through all
// of it: pick the crusher on the saturator in that time and the round put
// the soft clip back underneath you, so the knob you went to turn next was
// not there.
//
// A round's starting settings are the round's, so keeping the click is not
// the answer. Not taking it is: until the round has arrived the face is
// inert, and a click it does take stays taken.
//
// The clicks are real mouse clicks at the button's place on the screen,
// rather than `element.click()`, because a programmatic click goes through
// whatever a person's click would not, and that is the whole question.

import { open } from './harness.mjs';

export const name = 'arrive';

/** How long to keep clicking for. Longer than the slowest round takes to arrive. */
const KEEP_CLICKING = 2500;

export async function check({ browser, at, say }) {
  const problems = [];
  const { page, noise } = await open(browser, at, { view: 'tools' });

  await page.evaluate(() => { document.querySelector('#verdict').textContent = ''; });
  await page.click('.modes button:text-is("Saturation")');

  // From the moment the crusher's button exists, click where it is, as fast
  // as a person might, until the round has arrived.
  await page.waitForSelector('.surface [data-mode="crush"]', { timeout: 10000 });
  const began = Date.now();
  let clicks = 0;
  let taken = 0;
  while (Date.now() - began < KEEP_CLICKING) {
    const box = await page.$eval('.surface [data-mode="crush"]', (b) => {
      // Centred first, the way a person would bring it up: the answer bar is
      // stuck to the bottom of the window, and a button under it is not
      // there to be clicked.
      b.scrollIntoView({ block: 'center' });
      const r = b.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }).catch(() => null);
    if (box) {
      await page.mouse.click(box.x, box.y);
      clicks += 1;
      // Once is enough, the way it is for a person: the crusher is chosen,
      // and the next thing is the knob it brought. Clicking on would only
      // put back whatever the round had just taken away.
      if (await page.$('.surface [data-dial="dither"]')) { taken += 1; break; }
    }
    await page.waitForTimeout(40);
  }

  await page.waitForFunction(() => document.querySelector('#verdict').textContent.trim().length > 0,
    null, { timeout: 20000 });
  // Long enough for anything the round still had to put on the face to land.
  await page.waitForTimeout(800);

  const knobs = await page.$$eval('.surface [data-dial]', (dials) => dials.map((d) => d.dataset.dial));
  const crushing = knobs.includes('dither');
  say(`  ${clicks} click(s) on the crusher before it took${taken ? '' : ' (it never did)'}`);
  say(`  once the round was in: ${knobs.join(', ')}`);

  if (taken && !crushing) {
    problems.push('the crusher was picked while the round was arriving, and the round put the soft clip back');
  }
  if (!taken) {
    problems.push('the crusher could not be picked at all, before the round arrived or after');
  }

  problems.push(...noise);
  await page.close();
  return problems;
}
