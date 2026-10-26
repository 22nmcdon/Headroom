// Every knob deck, at every width: does it end with one knob on its own?
//
// This is the check the stranded-knob fix is held by, and it is a browser
// check rather than a unit test because the thing that decides a deck's
// column count is not arithmetic anybody wrote down. The tracks are
// `minmax(var(--deck), 1fr)` and a grid track cannot be narrower than the
// widest thing inside it, so a knob whose name wraps to two lines makes its
// own column wider than the variable asked for. Measured at 430 px: the
// stereo deck has room for six 54 px tracks and lays out five of 62.8, and
// nothing but a browser will tell you that.
//
// It sweeps more widths than the three in SIZES, because the fault was at 390,
// 500, 700, 820 and 1024 - none of which is one of the three. A check that
// only looks where the other checks look would have gone on passing.

import { open } from './harness.mjs';

export const name = 'decks';

/** The widths the fault was found across, plus the three the others use. */
const WIDTHS = [360, 390, 430, 500, 600, 700, 820, 932, 1024, 1280, 1440];

const TOOLS = ['EQ', 'Compression', 'Stereo', 'Reverb', 'Delay', 'Saturation'];

/**
 * Was a row of one avoidable?
 *
 * Asked rather than assumed, because sometimes it is not: nine knobs two to a
 * row is 2+2+2+2+1 however they are arranged, and so is three knobs two to a
 * row. The row budget is part of the question - ten knobs three to a row is
 * 3+3+3+1 or 2+2+2+2+2, and the second buys an even deck for an extra row,
 * which is how a deck grows until it pushes out through the bottom of the
 * chassis. The faces check calls that broken where this one only calls a
 * stranded knob untidy, so rows are not spent to fix it.
 */
function avoidable(count, widest) {
  const rows = Math.ceil(count / widest);
  for (let c = 2; c <= widest; c += 1) {
    const last = count - (Math.ceil(count / c) - 1) * c;
    if (Math.ceil(count / c) === rows && last !== 1) return true;
  }
  return false;
}

export async function check({ browser, at, say }) {
  const problems = [];

  for (const width of WIDTHS) {
    const { page, noise } = await open(browser, at, { width, height: 1000, view: 'tools' });

    for (const tool of TOOLS) {
      await page.click(`.modes button:text-is("${tool}")`);
      await page.waitForTimeout(400);

      // Deck by deck, not face by face. The compressor has two of them -
      // dynamics and output in one, the side chain in another - and pooling
      // their knobs asks a question neither deck was answering: ten knobs
      // across two decks read as one row list of 4+4+2, which is deck A's
      // 4+4 and deck B's 2 with nothing stranded anywhere.
      const decks = await page.evaluate(() => {
        const face = document.querySelector('.plugin');
        if (!face) return [];
        return [...face.querySelectorAll('.plugin-controls, .eq-knobs')].map((deck, i) => {
          const knobs = [...deck.querySelectorAll('.knob')];

          // Rows by the top of each knob, which is what a row actually is -
          // not the grid's own column count, because the question is where
          // the knobs ended up and not what the grid was told to do.
          const rows = new Map();
          for (const knob of knobs) {
            const top = Math.round(knob.getBoundingClientRect().top);
            rows.set(top, (rows.get(top) ?? 0) + 1);
          }
          return {
            which: i,
            flex: getComputedStyle(deck).display !== 'grid',
            count: knobs.length,
            counts: [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, n]) => n),
          };
        }).filter((deck) => deck.count > 0);
      });

      for (const { which, flex, count, counts } of decks) {
        const widest = Math.max(...counts);
        const last = counts[counts.length - 1];
        const label = decks.length > 1 ? `${tool} deck ${which + 1}` : tool;

        if (counts.length > 1 && last === 1 && avoidable(count, widest)) {
          problems.push(`${label} at ${width}px: ${count} knobs came out ${counts.join('+')}`
            + ' and a better split was available');
        }

        say?.(`${label.padEnd(16)} ${String(width).padStart(4)}px  ${String(count).padStart(2)} knobs`
          + `  ${counts.join('+').padEnd(11)}${flex ? ' (flex, not spread)' : ''}`);
      }
    }

    problems.push(...noise.map((n) => `${width}px: ${n}`));
    await page.close();
  }

  return problems;
}
