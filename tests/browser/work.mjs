// Every exercise answered on a tool, locked in: does the marking come back
// with a number in it?
//
// The drills have their own check now, and it exists because one of them
// could not be won. These are the other half - sixty-eight exercise-and-tier
// rounds where the answer is the tool itself rather than a chip - and none of
// them had ever been locked in outside a unit test either.
//
// ## The claim
//
// Every round has to be winnable with the answer the app itself reveals.
// Show the answer, put it on the controls, lock it in: the board must say
// that is it. Nothing weaker would do - a round that marks something and
// reports a number can still be marking the wrong thing - and until the
// controls could be moved onto the target there was no way to ask for it.
// This check used to say so, in a paragraph about what it could not do.
//
// It matters that the answer goes on through `targetOf` rather than the
// puzzle's raw answer. Several exercises re-measure against the loop the
// round is played on, so the raw answer is settings that miss the target
// here; the shell does the right one, and this is where that is held.
//
// The weaker claims are kept, because they fail differently: that locking in
// comes back marked with a reading that is a reading catches a guess and a
// target whose readings will not compare, which `read.js` refuses on purpose
// and which surfaces as a dash where a number should be.
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
        .map((one) => ({ id: one.id, label: one.label, onto: !!one.ontoTool })),
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
        const wantsOnto = exercise.onto;
        await putRound(page, { exercise: exercise.id, tier });

        const round = await page.evaluate(async () => {
          const submit = document.querySelector('#submit');
          const verdict = () => document.querySelector('#verdict')?.textContent.trim() ?? '';

          // Waited for rather than slept through.
          //
          // Every pause below used to be a fixed one, and a fixed pause is a
          // check that passes on an idle machine and reports the machine on a
          // loaded one. This check spent two runs claiming the delay's easy
          // tier "was rebuilt underneath this" when all that had happened was
          // that marking a round took longer than 400 ms on a box that was
          // also rendering a scene offline in another tab.
          //
          // The board writing a new verdict is the signal that it has marked
          // something, so that is what is waited for. It returns either way:
          // a timeout here is a real answer - the board never responded - and
          // the assertions below are the right place to say so.
          const spoke = async (was, most = 10000) => {
            const by = Date.now() + most;
            while (Date.now() < by) {
              if (verdict() !== was) return true;
              await new Promise((ok) => setTimeout(ok, 50));
            }
            return false;
          };

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
          await spoke(before.opened);

          const marked = {
            cells: [...document.querySelectorAll('.cell')].map((c) => c.textContent.trim()),
            verdict: verdict(),
          };

          // Sometimes the tool's own defaults are the answer - on a lenient
          // tier with a target near the middle of its range, locking in
          // without touching anything wins. The round is then over, so
          // "Show me" correctly does nothing and there is no button, and
          // reading that as a missing control is how this check spent a run
          // reporting eight rounds that drifted between runs.
          const alreadyWon = /that is it/i.test(marked.verdict);

          if (alreadyWon) {
            return { before, marked, alreadyWon, shown: null, won: { took: true, verdict: marked.verdict } };
          }

          // And the reveal, which every plugin implements itself and several
          // of which do real work to draw it - the reverb builds an impulse.
          let threw = null;
          try {
            document.querySelector('#show').click();
            await spoke(marked.verdict);
          } catch (e) {
            threw = String(e && e.message ? e.message : e);
          }

          const onto = document.querySelector('#onto');
          const shown = {
            verdict: verdict(),
            again: !document.querySelector('#again')?.hidden,
            onto: onto ? !onto.hidden : null,
            threw,
          };

          // Then the thing worth checking: put the answer on the controls and
          // lock it in. The app has just said what the answer is; its own
          // marking has to agree.
          //
          // And the face has to show it. Everything the controls read, before
          // and after - a tool whose settings changed and whose face did not
          // is a reveal nobody can see, which is exactly what the EQ did: its
          // curve redrew and its rail went on naming the bands it used to
          // have. The round is only reached when the first guess was wrong,
          // so the answer differs from what is on the face by enough to show.
          const faceNow = () => [
            ...document.querySelectorAll('.surface .knob-dial, .surface [data-dial]'),
          ].map((d) => d.value).join('|') + '//' + [
            ...document.querySelectorAll('.surface .rail-btn, .surface .knob-value'),
          ].map((n) => n.innerText.trim()).join('|');

          let won = null;
          if (shown.onto) {
            const faceWas = faceNow();
            onto.click();
            // The face moving is the claim, so it is also the thing to wait
            // for: a timeout costs time only on a round that really failed.
            const by = Date.now() + 10000;
            while (Date.now() < by && faceNow() === faceWas) {
              await new Promise((ok) => setTimeout(ok, 50));
            }
            const faceIs = faceNow();

            const said = verdict();
            submit.click();
            await spoke(said);
            won = {
              verdict: verdict(),
              took: /that is it/i.test(verdict()),
              faceMoved: faceIs !== faceWas,
              face: faceIs.slice(0, 80),
            };
          }

          return { before, marked, alreadyWon, shown, won };
        });

        played += 1;

        const first = round.marked.cells[0] ?? '';
        say(`  ${where.padEnd(28)} ${String(round.marked.cells.length)} cells`
          + `  ${(first ? `"${first}"` : '(none)').padEnd(26)}`
          + ` ${round.alreadyWon ? 'the defaults won it'
            : round.won?.took ? 'the answer wins'
              : round.won ? 'THE ANSWER LOSES'
                : wantsOnto ? 'NO BUTTON' : 'not dialled'}`);

        if (round.before.surface !== false) {
          problems.push(`${where}: the tool is the answer and its display is hidden`);
        }
        if (round.before.picker !== true) {
          problems.push(`${where}: chips are showing on a round answered on the tool`);
        }
        if (round.before.disabled) {
          problems.push(`${where}: could not be locked in at all`);
        }
        // A round answered by dialling must not be told to name what it heard.
        if (/name what you heard/i.test(round.before.opened)) {
          problems.push(`${where}: opens with "${round.before.opened}" on a round that is`
            + ' answered on the tool, not by naming anything');
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

        if (!round.shown) {
          // The defaults won it, so there was nothing to reveal. Nothing
          // about the reveal can be claimed from this round.
          continue;
        }
        if (round.shown.threw) {
          problems.push(`${where}: showing the answer threw - ${round.shown.threw}`);
        }
        if (!round.shown.again) {
          problems.push(`${where}: the answer was shown and the round did not end`);
        }
        // Not every round can be won by dialling: five of them are marked on a
        // reading derived from what came out rather than on matching a
        // settings object, and one hands back a delivery spec instead of knob
        // positions. Those declare it, and nothing is claimed about them here.
        // What IS claimed is the other way round: a round that offers the
        // button has to be winnable with what the button puts on.
        if (!round.shown.onto) {
          if (wantsOnto) {
            problems.push(`${where}: says its target is the settings that win and offers`
              + ' no way to put them on the controls');
          }
        } else if (!round.won) {
          problems.push(`${where}: the answer could be put on the controls and locking it`
            + ' in produced nothing');
        } else if (!round.won.took) {
          problems.push(`${where}: the answer the app revealed was put on its own controls`
            + ` and its own marking does not accept it - the board says "${round.won.verdict}"`);
        } else if (!round.won.faceMoved) {
          problems.push(`${where}: the answer went on and the marking accepted it, and nothing`
            + ' the controls read changed - the reveal is one nobody can see');
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
