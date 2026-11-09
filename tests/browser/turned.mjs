// The delivery drill, played: how far a service had to turn a master down.
//
// The arithmetic is held in `tests/ceiling.test.js` - every rung lands where
// it says, both sides come out level-matched, and what the service takes off
// is exactly what the master gave away. What that cannot hold is that a round
// built on it is playable: that the drill reaches the face at all, that the
// chips carry the ladder for the tier, that picking one and saying it marks
// the guess, and that the two sides really are the same loudness by the time
// a person hears them.
//
// The last of those is the one worth a browser. The whole exercise rests on
// the loud master not being louder, and that is a claim about a graph - the
// limiter's output trim, the player's own gain, and the A/B switch - rather
// than about the function that chose the trim.

import { open } from './harness.mjs';

export const name = 'turned';

/** The ladders, which the check knows so it can tell a wrong one from none. */
const RUNGS = {
  easy: ['not at all', '2.5 dB', '5.0 dB'],
  medium: ['not at all', '1.5 dB', '3.0 dB', '4.5 dB'],
  hard: ['not at all', '1.0 dB', '2.0 dB', '3.0 dB', '4.0 dB', '5.0 dB'],
};

export async function check({ browser, at, say }) {
  const problems = [];
  const { page, noise } = await open(browser, at, { view: 'tools' });

  await page.click('.modes button:text-is("Limiter")');
  await page.waitForSelector('.surface .plugin.limiter', { timeout: 8000 });
  await page.waitForTimeout(400);

  // Drills live behind their own pill, so the exercise list on the work pill
  // does not offer them at all.
  await page.click('button:text-is("Drills")');
  await page.waitForTimeout(400);

  const offered = await page.$$eval('[data-setting="exercise"] option',
    (all) => all.map((o) => ({ id: o.value, label: o.textContent.trim() })));
  say(`the drills on this tool: ${offered.map((o) => o.label).join(' · ')}`);

  if (!offered.some((o) => o.id === 'turned')) {
    problems.push('the turn-down drill is not offered on the limiter');
    problems.push(...noise);
    await page.close();
    return problems;
  }

  await page.selectOption('[data-setting="exercise"]', 'turned');
  await page.waitForTimeout(600);

  /* --- the chips carry the ladder, per tier ------------------------------- */

  say('\n  tier     chips');
  for (const [tier, wanted] of Object.entries(RUNGS)) {
    await page.selectOption('#tier', tier);
    await page.waitForTimeout(600);

    const chips = await page.$$eval('#picker [data-slot="turndown"]',
      (all) => all.map((b) => b.textContent.trim()));
    say(`  ${tier.padEnd(8)} ${chips.join(' · ')}`);

    if (chips.length !== wanted.length) {
      problems.push(`${tier} offered ${chips.length} chips, against the ${wanted.length} its ladder has`);
      continue;
    }
    // The lowest rung reads as words, because "the master arrived on target"
    // is a different kind of answer from a number of decibels.
    if (!/not at all/.test(chips[0])) {
      problems.push(`${tier}'s lowest chip reads "${chips[0]}" rather than saying it was not turned down`);
    }
  }

  /* --- and a round can be played ------------------------------------------ */

  await page.selectOption('#tier', 'hard');
  await page.waitForTimeout(600);

  // Both amount drills on this face, because the fault that this check found
  // belonged to all of them: a chip whose id is a number arrived at the
  // scoring as text, which threw here and quietly marked every right answer
  // wrong on three other tools. Pressing a real chip is the only way to see
  // it - every unit test builds its guess out of the answer and gets a
  // number for free.
  say('');
  for (const which of ['drill', 'turned']) {
    await page.selectOption('[data-setting="exercise"]', which);
    await page.waitForTimeout(700);

    const played = await page.evaluate(async () => {
      const chips = [...document.querySelectorAll('#picker [data-option]')];
      const submit = document.querySelector('#submit');
      const ask = document.querySelector('#drillAsk')?.textContent.trim() ?? '';
      const before = { ask, chips: chips.length, disabled: submit.disabled };

      chips[1].click();
      await new Promise((ok) => setTimeout(ok, 80));
      const picked = {
        pressed: chips[1].getAttribute('aria-pressed'),
        disabled: submit.disabled,
      };

      submit.click();
      await new Promise((ok) => setTimeout(ok, 300));
      const after = {
        cells: document.querySelectorAll('.cell').length,
        verdict: document.querySelector('#verdict')?.textContent.trim() ?? '',
      };

      return { before, picked, after };
    });

    say(`  ${which}: asks "${played.before.ask}"`);
    say(`    ${played.before.chips} chips, button ${played.before.disabled ? 'disabled' : 'live'} to begin`);
    say(`    a chip: pressed ${played.picked.pressed}, button ${played.picked.disabled ? 'disabled' : 'live'}`);
    say(`    saying it: ${played.after.cells} cells, "${played.after.verdict}"`);

    if (!played.before.disabled) problems.push(`${which} could be answered before anything was picked`);
    if (played.picked.pressed !== 'true') {
      problems.push(`${which}: a chip was chosen and does not look chosen`);
    }
    if (played.picked.disabled) problems.push(`${which}: picking a chip left the round unanswerable`);
    if (!played.after.cells) problems.push(`${which}: saying it marked nothing`);
    // A drill takes one answer: right first time, or shown with the answer.
    if (!/first time|not that one/i.test(played.after.verdict)) {
      problems.push(`${which}: after a guess the verdict reads "${played.after.verdict}"`);
    }
  }

  const asked = await page.$eval('#drillAsk', (el) => el.textContent.trim());
  if (!/turn/i.test(asked)) {
    problems.push(`the turn-down drill asks "${asked}", which is not about a turn-down`);
  }

  /* --- the two sides are the same loudness, through the real graph --------- */

  // The claim the whole exercise rests on. Rendered rather than read off the
  // settings: what has to be equal is what comes out of the player, after the
  // limiter's trim and whatever the A/B does, and that is three things
  // meeting rather than one function's return value.
  const matched = await page.evaluate(async () => {
    const { CEIL_WORK } = await import('./src/learn/work/limiter.js');
    const { runCeiling } = await import('./src/plugins/limiter/ceiling.js');
    const { integrated, kWeight, truePeakOf } = await import('./src/lib/loudness.js');
    const { TARGETS } = await import('./src/lib/targets.js');
    const { Engine } = await import('./src/core/audio.js');

    const engine = new Engine();
    engine.ensure();
    const loop = await engine.renderLoop('mix');
    const rate = loop.sampleRate;
    const left = loop.getChannelData(0);
    const right = loop.numberOfChannels > 1 ? loop.getChannelData(1) : left;
    const material = { left, right, rate };

    const lufsOf = (L, R) => integrated([kWeight(L, rate), kWeight(R, rate)], rate).lufs;
    const dry = lufsOf(left, right);
    const target = TARGETS[0];

    const rows = [];
    for (const rung of [0, 2, 5]) {
      const puzzle = {
        answer: { turndown: rung, service: target.id },
        tier: 'hard', settings: { exercise: 'turned' }, material,
      };
      const settings = CEIL_WORK.exercises.turned.startOf(puzzle);
      const pass = runCeiling(left, right, settings, rate);
      const wet = lufsOf(pass.left, pass.right);

      // And what was handed over, before the trim, which is what the service
      // would have measured.
      const bare = runCeiling(left, right, { ...settings, output: 0 }, rate);
      const delivered = lufsOf(bare.left, bare.right);

      rows.push({
        rung,
        drive: settings.drive,
        apart: wet - dry,
        turned: delivered - target.lufs,
        plr: Math.max(truePeakOf(bare.left), truePeakOf(bare.right)) - delivered,
      });
    }

    return { dry, rows };
  });

  say(`\n  on the app's own loop, which reads ${matched.dry.toFixed(2)} LUFS\n`);
  say('  rung    drive   turned down    PLR    the two sides apart');
  for (const row of matched.rows) {
    say(`  ${String(row.rung).padStart(4)} ${row.drive.toFixed(2).padStart(8)}`
      + ` ${row.turned.toFixed(2).padStart(13)} ${row.plr.toFixed(2).padStart(6)}`
      + ` ${row.apart.toFixed(3).padStart(22)} dB`);

    if (Math.abs(row.apart) > 0.15) {
      problems.push(`rung ${row.rung}: the limited side is ${row.apart.toFixed(2)} dB from the bypass,`
        + ' so the drill can be answered by which one is louder');
    }
    if (Math.abs(row.turned - row.rung) > 0.4) {
      problems.push(`rung ${row.rung}: the loop was turned down ${row.turned.toFixed(2)} dB`
        + ' - the ladder does not reach on this material');
    }
  }

  // And the invariant, on material the unit test never sees: what the service
  // takes off plus what is left of the ratio is a constant.
  const totals = matched.rows.map((r) => r.turned + r.plr);
  const spread = Math.max(...totals) - Math.min(...totals);
  say(`\n  turn-down plus ratio: ${totals.map((t) => t.toFixed(2)).join(', ')}`
    + ` - a spread of ${spread.toFixed(2)}`);
  if (spread > 0.5) {
    problems.push(`turn-down plus ratio moved by ${spread.toFixed(2)} dB across the ladder,`
      + ' so the one-for-one trade the drill teaches does not hold on this loop');
  }

  problems.push(...noise);
  await page.close();
  return problems;
}
