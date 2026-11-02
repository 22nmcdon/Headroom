// Every exercise answered on a tool, locked in: does the marking come back
// with a number in it?
//
// The drills have their own check now, and it exists because one of them
// could not be won. These are the other half - sixty-eight exercise-and-tier
// rounds where the answer is the tool itself rather than a chip - and none of
// them had ever been locked in outside a unit test either.
//
// ## What it can claim, and what it cannot
//
// It cannot press the right answer. A drill's answers are chips, so a sweep
// finds the one that wins; these are answered by where a dozen controls are
// set, and there is no sweep over that. "Show me" does not help - it reveals
// the target and deliberately leaves the controls alone, which is the right
// behaviour and the wrong hook.
//
// So what is held here is narrower and still worth holding: that locking in
// whatever the tool is set to comes back MARKED, with a finite reading, and
// that the reveal runs. The failure that shape catches is the one this
// codebase actually has - a guess and a target whose readings will not
// compare, which `read.js` refuses on purpose and which surfaces as a dash
// where a number should be. A round that cannot say how far off you are is a
// round that teaches nothing, and it looks exactly like a working one until
// somebody locks it in.
//
// It also holds the inverse of what the drills check holds about the shell:
// a tool exercise shows the tool and hides the chips, because the tool is
// the answer.

import { open, putRound, putKind } from './harness.mjs';

export const name = 'work';

/**
 * A cell that says nothing, which is the thing worth catching.
 *
 * `scoreMatch` and its relatives print a dash when a gap is not finite, which
 * is what a guess and a target whose readings will not compare come out as.
 *
 * Not "a cell with no digits in it", which is what this asked for first and
 * which is wrong: several exercises here are marked on a name rather than on
 * an amount. Panning's placing round reads "Centre", its mono round reads
 * "the low end survives mono", the saturator's even-harmonics round reads
 * "no even harmonics at all" and the reverb's tempo round reads "gone long
 * before it". Every one of those is the reading doing its job - the answer to
 * "where is it" is a place, and the answer to "is there any" is no.
 */
const NOTHING = /^(--|—|NaN|undefined|null)\b/;

export async function check({ browser, at, say }) {
  const problems = [];
  const { page, noise } = await open(browser, at, { view: 'tools' });

  const plan = await page.evaluate(async () => {
    const { TOOLS, TOOL_IDS } = await import('./src/learn/bench/registry.js');
    return TOOL_IDS.map((id) => ({
      id,
      label: TOOLS[id].label,
      tiers: Object.keys(TOOLS[id].tiers),
      work: Object.values(TOOLS[id].exercises)
        .filter((one) => !one.drill)
        .map((one) => ({ id: one.id, label: one.label })),
    })).filter((tool) => tool.work.length);
  });

  const rounds = plan.reduce((n, t) => n + t.work.length * t.tiers.length, 0);
  say(`${plan.length} tools, ${rounds} exercise-and-tier rounds to lock in\n`);

  let played = 0;

  for (const tool of plan) {
    await page.click(`.modes button:text-is("${tool.label}")`);
    await page.waitForTimeout(500);
    await putKind(page, 'work');

    for (const exercise of tool.work) {
      for (const tier of tool.tiers) {
        const where = `${tool.id}/${exercise.id}/${tier}`;
        await putRound(page, { exercise: exercise.id, tier });

        const round = await page.evaluate(async () => {
          const submit = document.querySelector('#submit');
          const verdict = () => document.querySelector('#verdict')?.textContent.trim() ?? '';

          const before = {
            // The tool is the answer here, so it has to be on screen - and
            // the chips must not be, or there are two ways to answer one
            // question.
            surface: document.querySelector('#surface')?.hidden ?? null,
            picker: document.querySelector('#picker')?.hidden ?? null,
            submit: submit.textContent.trim(),
            disabled: submit.disabled,
            // Both ways out are there from the first attempt, by design.
            hint: !document.querySelector('#hint')?.hidden,
            show: !document.querySelector('#show')?.hidden,
            opened: verdict(),
          };

          submit.click();
          await new Promise((ok) => setTimeout(ok, 400));

          const marked = {
            cells: [...document.querySelectorAll('.cell')].map((c) => c.textContent.trim()),
            verdict: verdict(),
          };

          // And the reveal, which every plugin implements itself and several
          // of which do real work to draw it - the reverb builds an impulse.
          let threw = null;
          try {
            document.querySelector('#show').click();
            await new Promise((ok) => setTimeout(ok, 400));
          } catch (e) {
            threw = String(e && e.message ? e.message : e);
          }

          const shown = {
            verdict: verdict(),
            again: !document.querySelector('#again')?.hidden,
            threw,
          };

          return { before, marked, shown };
        });

        played += 1;

        const first = round.marked.cells[0] ?? '';
        say(`  ${where.padEnd(28)} ${String(round.marked.cells.length)} cells`
          + `  ${first ? `"${first}"` : '(none)'}`);

        if (round.before.surface !== false) {
          problems.push(`${where}: the tool is the answer and its display is hidden`);
        }
        if (round.before.picker !== true) {
          problems.push(`${where}: chips are showing on a round answered on the tool`);
        }
        if (round.before.disabled) {
          problems.push(`${where}: could not be locked in at all`);
        }
        if (!round.before.hint || !round.before.show) {
          problems.push(`${where}: a way out is missing - hint ${round.before.hint},`
            + ` show ${round.before.show}`);
        }

        if (!round.marked.cells.length) {
          problems.push(`${where}: locking it in marked nothing`);
        } else if (NOTHING.test(first)) {
          problems.push(`${where}: the reading came back as "${first}", so the guess and`
            + ' the target would not compare and the round cannot say how far off it is');
        }

        if (!/attempt|that is it/i.test(round.marked.verdict)) {
          problems.push(`${where}: after locking in, the board reads "${round.marked.verdict}"`
            + ' - the round was rebuilt underneath this and nothing was tested');
        }

        if (round.shown.threw) {
          problems.push(`${where}: showing the answer threw - ${round.shown.threw}`);
        }
        if (!round.shown.again) {
          problems.push(`${where}: the answer was shown and the round did not end`);
        }
      }
    }
  }

  say(`\nlocked in ${played} rounds`);
  if (played !== rounds) problems.push(`${played} rounds played against the ${rounds} there are`);

  problems.push(...noise);
  await page.close();
  return problems;
}
