// Every drill, played: can the right answer actually be given?
//
// This exists because of what writing one of these found. Four drills had
// chips whose ids are numbers, and all four were wrong about it - one threw
// on every guess and three marked the right answer wrong - and the fault had
// been there since each of them shipped. Nothing caught it because every unit
// test builds its guess out of the answer and gets a number for free, and
// because no check had ever pressed a chip on a tool.
//
// So this presses them all. Sixty-two drill-and-tier combinations across
// twelve tools, two of which had ever been played before this file.
//
// The claim is deliberately end-to-end and weak on detail: for each round it
// presses chips until the board says the round is won, and fails if it runs
// out of chips first. It does not care which chip is right - that is the
// unit tests' business, and they are good at it. What it cares about is that
// SOME chip is, which is the one thing a scorer cannot check about itself and
// the exact shape of the fault that prompted it.
//
// ## What it cannot do
//
// The reverb's drill has a dial in it alongside its chips, so its answer is a
// continuous value and there is no sweep that finds it. Those rounds get the
// weaker pass: pick what can be picked, submit, and hold that something was
// marked and nothing threw. Said here rather than quietly skipped.

import { open, putRound, putKind } from './harness.mjs';

export const name = 'drills';

/** How many chip combinations are worth sweeping before it is not a sweep. */
const MOST_TRIES = 24;

/**
 * What the board says when the round is won.
 *
 * Written out again inside the page below, because an evaluate block is a
 * different world and cannot see anything declared here.
 */
const WON = /that is it/i;

export async function check({ browser, at, say }) {
  const problems = [];
  const { page, noise } = await open(browser, at, { view: 'tools' });

  // The tools, their drills and their tiers, from the registry rather than
  // from a list here: a check that has to be edited when a drill is added is
  // a check that stops covering the newest thing in the app.
  const plan = await page.evaluate(async () => {
    const { TOOLS, TOOL_IDS } = await import('./src/learn/bench/registry.js');
    return TOOL_IDS.map((id) => ({
      id,
      label: TOOLS[id].label,
      tiers: Object.keys(TOOLS[id].tiers),
      drills: Object.values(TOOLS[id].exercises)
        .filter((one) => one.drill)
        .map((one) => ({ id: one.id, label: one.label })),
    })).filter((tool) => tool.drills.length);
  });

  const rounds = plan.reduce((n, t) => n + t.drills.length * t.tiers.length, 0);
  say(`${plan.length} tools, ${rounds} drill-and-tier rounds to play\n`);

  let played = 0;
  let swept = 0;
  let dialled = 0;

  for (const tool of plan) {
    await page.click(`.modes button:text-is("${tool.label}")`);
    await page.waitForTimeout(500);
    await putKind(page, 'drill');

    for (const drill of tool.drills) {
      for (const tier of tool.tiers) {
        const where = `${tool.id}/${drill.id}/${tier}`;

        // The waiting is the harness's, because getting it wrong cost two
        // runs of the suite and because the work-exercise check needs the
        // same thing. See `putRound`.
        await putRound(page, { exercise: drill.id, tier });

        const round = await page.evaluate(async (limit) => {
          const picker = document.querySelector('#picker');
          const submit = document.querySelector('#submit');
          const verdict = () => document.querySelector('#verdict')?.textContent.trim() ?? '';

          if (picker.hidden) return { skipped: 'the picker is hidden on a drill' };

          // The chips, grouped by the slot they answer. A dial among them is
          // a slot this cannot sweep.
          const groups = [...picker.querySelectorAll('.picker-group')].map((group) => ({
            dial: !!group.querySelector('[data-dial]'),
            chips: [...group.querySelectorAll('[data-option]')],
          }));

          const chipGroups = groups.filter((g) => !g.dial && g.chips.length);
          const hasDial = groups.some((g) => g.dial);
          if (!chipGroups.length) return { skipped: 'no chips at all' };

          const before = {
            chips: chipGroups.map((g) => g.chips.length),
            disabled: submit.disabled,
            opened: verdict(),
            // A drill takes the tool away: its display would be the answer.
            // A drill puts the tool's display away, because on every one of
            // these tools the display is the answer. Hidden rather than
            // emptied - the tool is still there and still playing, it owns
            // the audio - so what to read is the container's own state.
            surface: document.querySelector('#surface')?.hidden ?? null,
          };

          // Every combination of one chip per slot, in order.
          const combos = chipGroups.reduce(
            (all, group) => all.flatMap((pre) => group.chips.map((chip) => [...pre, chip])),
            [[]],
          );

          const tried = [];
          let won = false;
          let pressedOk = true;

          for (const combo of combos.slice(0, limit)) {
            for (const chip of combo) {
              chip.click();
              await new Promise((ok) => setTimeout(ok, 30));
              if (chip.getAttribute('aria-pressed') !== 'true') pressedOk = false;
            }
            // The chips start again after every attempt - the next guess is a
            // fresh one - so a button still closed after a pick means the
            // round itself is over, which is the only reason to stop.
            if (submit.disabled) break;

            submit.click();
            await new Promise((ok) => setTimeout(ok, 180));
            tried.push(combo.map((c) => c.dataset.option).join('+'));

            if (/that is it/i.test(verdict())) { won = true; break; }
          }

          return {
            before,
            hasDial,
            combos: combos.length,
            tried: tried.length,
            won,
            pressedOk,
            cells: document.querySelectorAll('.cell').length,
            verdict: verdict(),
          };
        }, MOST_TRIES);

        played += 1;

        if (round.skipped) {
          problems.push(`${where}: ${round.skipped}`);
          continue;
        }

        const chips = round.before.chips.join('x');
        const note = round.hasDial ? ' (has a dial, so not swept)' : '';
        say(`  ${where.padEnd(30)} ${chips.padEnd(6)} ${String(round.tried).padStart(2)} tries`
          + `  ${round.won ? 'won' : 'not won'}${note}`);

        // What every round owes, dial or no dial.
        if (round.before.surface !== true) {
          problems.push(`${where}: the tool's display is still on screen during a drill`);
        }
        if (!round.before.disabled) {
          problems.push(`${where}: could be answered before anything was picked`);
        }
        if (!round.pressedOk) {
          problems.push(`${where}: a chip was chosen and did not look chosen`);
        }
        if (!round.cells) {
          problems.push(`${where}: submitting marked nothing`);
        }

        if (round.hasDial) {
          dialled += 1;
          // The weaker pass. A dial's answer cannot be found by pressing
          // things, so all that is held is that the round runs.
          if (!/attempt|that is it/i.test(round.verdict)) {
            problems.push(`${where}: after a guess the verdict reads "${round.verdict}"`);
          }
          continue;
        }

        swept += 1;
        if (round.won) continue;

        // Two different failures, and they want saying apart. A verdict that
        // never mentions an attempt means the board was rebuilt underneath
        // the sweep, which is this check losing a race rather than the drill
        // being unwinnable - worth its own words so the next person does not
        // go looking for a scoring fault that is not there.
        if (!/attempt|that is it/i.test(round.verdict)) {
          problems.push(`${where}: after ${round.tried} attempts the board reads`
            + ` "${round.verdict}", which is an opening line - the round was rebuilt`
            + ' mid-sweep and nothing here was actually tested');
          continue;
        }
        problems.push(`${where}: ${round.tried} of ${round.combos} chip combinations tried`
          + ` and none was accepted - the verdict is still "${round.verdict}", so this`
          + ' drill cannot be won by pressing a chip');
      }
    }
  }

  say(`\nplayed ${played} rounds: ${swept} swept to a win, ${dialled} with a dial in them`);
  if (played !== rounds) problems.push(`${played} rounds played against the ${rounds} there are`);

  problems.push(...noise);
  await page.close();
  return problems;
}
