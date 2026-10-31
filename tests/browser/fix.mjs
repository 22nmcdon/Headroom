// The capstone: that each fault in the library is audible on the reading it
// claims, that fixing it puts the round back inside every tolerance, and that
// the two halves of the round can both be played.
//
// A browser check for the reason all of these are: `hurts` is a claim about
// what a render does, and a fault that moved no reading would be a round
// about nothing while every unit test went on passing. It is also the table
// that sets the sizes in `faults.js` - each one has to be far enough outside
// its tolerance to be worth finding and inside what the controls can put
// back.
//
// The last part drives the page because the capstone is the only round with
// two stages in it, and a stage that will not advance is a round nobody can
// finish.

import { open } from './harness.mjs';

export const name = 'fix';

export async function check({ browser, at, say }) {
  const problems = [];
  // `noise` is pushed at the end rather than here, because it goes on
  // collecting: an error thrown inside a click handler happens long after
  // the page has opened, and a check that copied the list out at the top
  // would report a clean page and a mysteriously dead control.
  const { page, noise } = await open(browser, at, { view: 'mix' });

  /* --- and both halves of the round, played ------------------------------- */

  await page.selectOption('[data-tier]', 'fix');
  await page.waitForTimeout(400);

  const played = await page.evaluate(async () => {
    const naming = document.querySelector('[data-naming]');
    const strips = document.querySelector('[data-strips]');
    const submit = document.querySelector('[data-submit]');
    const chips = [...naming.querySelectorAll('[data-option]')];

    const before = {
      asking: !naming.hidden,
      desk: !strips.hidden,
      chips: chips.length,
      says: submit.textContent.trim(),
      disabled: submit.disabled,
    };

    // Two chips, to prove the pressing is a set and not a choice.
    chips[0].click();
    chips[1].click();
    await new Promise((ok) => setTimeout(ok, 50));
    const pressed = chips.filter((chip) => chip.getAttribute('aria-pressed') === 'true').length;
    chips[1].click();
    await new Promise((ok) => setTimeout(ok, 50));
    const afterUnpress = chips.filter((chip) => chip.getAttribute('aria-pressed') === 'true').length;
    chips[1].click();
    await new Promise((ok) => setTimeout(ok, 50));

    submit.click();
    await new Promise((ok) => setTimeout(ok, 200));

    return {
      before,
      pressed,
      afterUnpress,
      after: {
        asking: !naming.hidden,
        desk: !strips.hidden,
        says: submit.textContent.trim(),
        disabled: submit.disabled,
        said: document.querySelector('[data-advice]').textContent.trim(),
        tone: !document.querySelector('[data-tone]').hidden,
      },
    };
  });

  const out = await page.evaluate(async () => {
    const { mixBrief } = await import('./src/mix/brief.js');
    const { pieceOf, dress, STEM_IDS } = await import('./src/mix/piece.js');
    const { readMix } = await import('./src/mix/render.js');
    const { markMix, toleranceFor } = await import('./src/mix/score.js');
    const { MIX_FAULTS, injure } = await import('./src/mix/faults.js');
    const { mulberry32 } = await import('./src/lib/random.js');

    const allowed = toleranceFor('fix');
    const kinds = Object.keys(allowed);

    // One mix underneath all of it, so the rows are comparable: the same
    // answer with one thing done to it at a time.
    const brief = mixBrief('fix', 0x6c21);
    const piece = pieceOf(brief.piece);
    const clean = brief.target;
    const theirs = await readMix(dress(piece, clean), 'answer');

    const rows = [];
    for (const fault of MIX_FAULTS) {
      const rng = mulberry32(0x9f17);
      const hurt = injure(clean, [fault.id], rng, STEM_IDS.filter((id) => id !== 'kit'));
      if (!hurt.done.length) {
        rows.push({ id: fault.id, on: null });
        continue;
      }

      const marked = markMix(await readMix(dress(piece, hurt.mix), 'yours'), theirs, 'fix');
      rows.push({
        id: fault.id,
        on: hurt.done[0].on,
        claims: fault.hurts,
        worst: marked.worst.kind,
        solved: marked.solved,
        offs: Object.fromEntries(marked.readings.map((one) => [one.kind, one.off])),
      });
    }

    // And the whole round: the mix as it was left, and the mix put back.
    const asLeft = markMix(await readMix(dress(piece, brief.start), 'yours'), theirs, 'fix');
    const putBack = markMix(await readMix(dress(piece, clean), 'yours'), theirs, 'fix');

    return {
      kinds,
      allowed,
      rows,
      faults: brief.faults,
      asLeft: { solved: asLeft.solved, worst: asLeft.worst.kind, off: asLeft.worst.off },
      putBack: { solved: putBack.solved, worst: putBack.worst.kind, off: putBack.worst.off },
    };
  });

  say('each fault on its own, against the mix it was done to\n');
  say(`  fault      on      claims      worst       ${out.kinds.map((k) => k.slice(0, 7).padStart(9)).join('')}`);
  for (const row of out.rows) {
    if (!row.on) {
      problems.push(`${row.id} could not be put on any part, so it is a fault no round can use`);
      continue;
    }
    say(`  ${row.id.padEnd(10)} ${row.on.padEnd(7)} ${row.claims.padEnd(11)} ${row.worst.padEnd(11)}`
      + out.kinds.map((k) => (row.offs[k] ?? 0).toFixed(2).padStart(9)).join(''));

    if (row.solved) {
      problems.push(`${row.id} on the ${row.on} left every reading inside its tolerance,`
        + ' so it is a fault nobody can hear or mark');
    }
    // What a fault claims to hurt has to be a reading it actually moves past
    // its own tolerance - otherwise the advice points somewhere else.
    const claimed = row.offs[row.claims] ?? 0;
    if (claimed <= out.allowed[row.claims]) {
      problems.push(`${row.id} says it hurts ${row.claims} and moved it ${claimed.toFixed(2)},`
        + ` which is inside the ${out.allowed[row.claims]} allowed`);
    }
  }

  say(`\n  the round itself: ${out.faults.map((one) => `${one.fault} on the ${one.on}`).join(', ')}\n`);
  say(`  as it was left:  ${out.asLeft.solved ? 'passes' : 'fails'}`
    + ` (${out.asLeft.worst} at ${out.asLeft.off.toFixed(2)})`);
  say(`  put back:        ${out.putBack.solved ? 'passes' : 'fails'}`
    + ` (${out.putBack.worst} at ${out.putBack.off.toFixed(2)})`);

  if (out.asLeft.solved) problems.push('the mix as it was left already passes, so there is nothing to fix');
  if (!out.putBack.solved) {
    problems.push(`putting it back exactly still fails on ${out.putBack.worst}`
      + ` at ${out.putBack.off.toFixed(2)}`);
  }

  say('\n  playing it\n');
  say(`  before: ${played.before.chips} chips, desk ${played.before.desk ? 'shown' : 'hidden'},`
    + ` button "${played.before.says}" ${played.before.disabled ? 'disabled' : 'live'}`);
  say(`  two chips pressed: ${played.pressed}; after unpressing one: ${played.afterUnpress}`);
  say(`  after: desk ${played.after.desk ? 'shown' : 'hidden'}, tone`
    + ` ${played.after.tone ? 'shown' : 'hidden'}, button "${played.after.says}"`);
  say(`  it said: "${played.after.said}"`);

  if (played.before.chips !== out.rows.length) {
    problems.push(`the round offered ${played.before.chips} chips for ${out.rows.length} faults`);
  }
  if (played.before.desk) problems.push('the desk was there before anybody had said what was wrong');
  if (!played.before.disabled) problems.push('what is wrong could be submitted with nothing picked');
  if (played.pressed !== 2) problems.push(`two chips pressed read as ${played.pressed}, so it is a choice and not a set`);
  if (played.afterUnpress !== 1) problems.push('a chip could not be unpressed');
  if (played.after.asking) problems.push('the chips are still there after saying what is wrong');
  if (!played.after.desk) problems.push('the desk never arrived, so there is nothing to fix it with');
  if (!played.after.tone) problems.push('the tone controls never arrived, and one of the faults is a colour');
  if (played.after.disabled) problems.push('the mix could not be submitted after the diagnosis');
  if (!/of \d|Now put it back/.test(played.after.said)) {
    problems.push(`the diagnosis said "${played.after.said}", which does not say how it went`);
  }


  problems.push(...noise);
  await page.close();
  return problems;
}
