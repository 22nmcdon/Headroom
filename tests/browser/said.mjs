// The line under the imager's two pickers: what the widener and the pan mode
// are actually doing, in words.
//
// A browser check rather than a unit test because the claim is not that the
// phrases exist - `image.test.js` holds that, and holds that they are not the
// labels read back. The claim here is that they reach the face and change
// when the picker does, which is the part that was missing for as long as the
// strings sat on the tables with nothing reading them.
//
// It also holds the one piece of logic in the line: widening is left out when
// the amount knob is down, because then the kind picker is not doing anything
// - moving it with the knob at nought changes no samples at all, which
// `image.test.js` measures, and a face that announced a decorrelator that was
// not running would be the face lying about what you are hearing.

import { open } from './harness.mjs';

export const name = 'said';

/** Everything the line should name, and what it should say when it does. */
const ROUNDS = [
  { widen: 'off', amount: 0.8, mode: 'balance', wants: ['Balance'], not: ['Off'] },
  { widen: 'velvet', amount: 0, mode: 'balance', wants: ['Balance'], not: ['Decorrelator'] },
  { widen: 'velvet', amount: 0.8, mode: 'balance', wants: ['Decorrelator', 'Balance'], not: [] },
  { widen: 'haas', amount: 0.8, mode: 'rotate', wants: ['Haas', 'Rotate'], not: ['Balance'] },
  { widen: 'micro', amount: 0.5, mode: 'dual', wants: ['Micro-pitch', 'Dual'], not: ['Rotate'] },
];

export async function check({ browser, at, say }) {
  const problems = [];

  // Both sizes, because this line is the one thing on the face that explains
  // a picker and `.eq-hint` - the other soft line on a plugin - is hidden on
  // a phone. If it ever picks up those rules it goes quiet exactly where the
  // dropdown label is the only other mention of what is running.
  for (const [label, width, height] of [['desktop', 1280, 1100], ['phone', 430, 932]]) {
    const { page, noise } = await open(browser, at, { width, height, view: 'tools' });
    await page.click('.modes button:text-is("Stereo")');
    await page.waitForSelector('.surface .plugin.stereo', { timeout: 8000 });
    await page.waitForTimeout(300);

    say(`\n=== ${label} ${width}x${height} ===\n`);

    for (const round of ROUNDS) {
      await page.selectOption('#stereoWiden', round.widen);
      await page.selectOption('#stereoPanMode', round.mode);
      await page.$eval('.surface [data-dial="widenAmount"]', (dial, value) => {
        dial.value = String(value);
        dial.dispatchEvent(new Event('input', { bubbles: true }));
      }, round.amount);
      await page.waitForTimeout(260);

      const seen = await page.evaluate(() => {
        const line = document.querySelector('#stereoSaid');
        if (!line) return { missing: true };
        const box = line.getBoundingClientRect();
        const face = document.querySelector('.surface .plugin.stereo').getBoundingClientRect();
        return {
          text: line.textContent.trim(),
          shown: box.width > 0 && box.height > 0,
          // Inside the chassis, like everything else on it.
          over: Math.round(Math.max(0, box.right - face.right)),
        };
      });

      const how = `${round.widen} at ${round.amount}, ${round.mode}`;
      if (seen.missing) {
        problems.push(`${label}: there is no line under the pickers at all`);
        break;
      }
      say(`  ${how.padEnd(28)} "${seen.text}"`);

      if (!seen.shown) problems.push(`${label}: the line is on the page but not on the face (${how})`);
      if (seen.over > 0) problems.push(`${label}: the line runs ${seen.over}px past the chassis (${how})`);
      for (const want of round.wants) {
        if (!seen.text.includes(want)) {
          problems.push(`${label}: ${how} and the line never mentions ${want}`);
        }
      }
      for (const no of round.not) {
        if (seen.text.includes(no)) {
          problems.push(`${label}: ${how} and the line still says ${no}`);
        }
      }
      // A name and then what it does. A line that is only names is the
      // dropdowns read back, which is the thing this replaced.
      if (!seen.text.includes(': ')) {
        problems.push(`${label}: "${seen.text}" names something without saying what it does`);
      }
    }

    problems.push(...noise);
    await page.close();
  }

  return problems;
}
