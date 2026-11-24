// Presets, recalled through the menu a person uses, and read back.
//
// A preset is a state with a name, and putting a state on a face is the one
// thing every face already does - so the risk is not that a recall goes
// wrong in the audio but that the face does not say it went right. Two did
// not: the reverb's space and the saturation's curve were switches drawn
// lit where they were clicked and never redrawn from the settings, so a
// preset (or an undo, or the other slot) could put a plate on with "Room"
// still lit. That is the shape of fault this holds, for every built-in preset
// on every tool.
//
// It also holds the two rules the menu has: it sits after the device's name,
// and nothing can be saved while the answer is on the controls - a preset of
// the target would be the answer, kept under a name.

import { open } from './harness.mjs';

export const name = 'presets';

/** The switches a face draws from a setting: [setting, attribute]. */
const SWITCHES = { reverb: ['space', 'space'], saturation: ['mode', 'mode'] };

/** Selects and boxes on a face that stand for one setting each. */
const FIELDS = {
  delay: { echoMachine: 'machine', echoPingPong: 'pingPong' },
  modulation: { modKind: 'kind' },
  limiter: { ceilMode: 'mode' },
};

export async function check({ browser, at, say }) {
  const problems = [];
  const { page, noise } = await open(browser, at, { view: 'tools' });
  const dialogs = [];
  page.on('dialog', (d) => {
    dialogs.push(d.type());
    d.accept(d.type() === 'prompt' ? 'Read back' : undefined);
  });

  const plan = await page.evaluate(async () => {
    const { TOOLS, TOOL_IDS } = await import('./src/learn/bench/registry.js');
    return TOOL_IDS.map((id) => ({ id, presets: TOOLS[id].presets }));
  });

  // What the controls hold, as the shell would save it: through the menu.
  const readBack = async (id) => {
    await page.selectOption('#facePreset', 'save');
    return page.evaluate((tool) => JSON.parse(localStorage.getItem('headroom.presets.v1'))[tool]
      .find((p) => p.name === 'Read back').state, id);
  };

  for (const { id, presets } of plan) {
    await page.goto(`${at}#/tools/${id}/work/easy`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
    // The round arrives after the page does - a reverb renders its room
    // first - and a new round starts the menu over, as it should. So the
    // recalls wait for it rather than racing it.
    await page.waitForTimeout(1500);

    const after = await page.evaluate(() => document.querySelector('#facePreset')
      ?.previousElementSibling?.classList.contains('plugin-name'));
    if (!after) problems.push(`${id}: the preset menu is not after the device's name`);
    say(`${id}: ${presets.length} built in`);

    for (const [i, preset] of presets.entries()) {
      const where = `${id} / "${preset.name}"`;
      await page.selectOption('#facePreset', `b:${i}`);
      await page.waitForTimeout(80);

      const shown = await page.evaluate(() => document.querySelector('#facePreset').options[0].textContent);
      if (shown !== preset.name) problems.push(`${where}: recalled, and the menu reads "${shown}"`);

      const got = await readBack(id);
      if (Array.isArray(preset.state)) {
        if (JSON.stringify(got) !== JSON.stringify(preset.state)) {
          problems.push(`${where}: the bands on the controls are not the preset's`);
        }
      } else {
        for (const [key, want] of Object.entries(preset.state)) {
          if (key === 'listen' || key === 'hear') continue;
          if (JSON.stringify(got[key]) !== JSON.stringify(want)) {
            problems.push(`${where}: ${key} is ${JSON.stringify(got[key])}, the preset says ${JSON.stringify(want)}`);
          }
        }
      }

      const face = await page.evaluate(({ sw, fields }) => ({
        lit: sw ? [...document.querySelectorAll(`#surface [data-${sw[1]}].is-on`)].map((b) => b.dataset[sw[1]]) : null,
        fields: Object.fromEntries(Object.keys(fields ?? {}).map((fid) => {
          const el = document.getElementById(fid);
          return [fid, el ? (el.type === 'checkbox' ? el.checked : el.value) : null];
        })),
      }), { sw: SWITCHES[id], fields: FIELDS[id] });

      if (SWITCHES[id]) {
        const want = String(got[SWITCHES[id][0]]);
        if (face.lit.join() !== want) {
          problems.push(`${where}: ${want} is on and the face has "${face.lit.join() || 'nothing'}" lit`);
        }
      }
      for (const [fid, key] of Object.entries(FIELDS[id] ?? {})) {
        const want = typeof got[key] === 'boolean' ? got[key] : String(got[key]);
        if (face.fields[fid] !== want) {
          problems.push(`${where}: ${key} is ${JSON.stringify(got[key])} and #${fid} shows ${JSON.stringify(face.fields[fid])}`);
        }
      }
    }
  }

  /* --- the answer on the controls is not a preset ------------------------- */

  await page.goto(`${at}#/tools/compression/work/easy`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
  await page.click('#show');
  await page.waitForTimeout(200);
  if (await page.isVisible('#onto')) {
    await page.click('#onto');
    await page.waitForTimeout(200);
    const asked = dialogs.length;
    await page.selectOption('#facePreset', 'save');
    await page.waitForTimeout(150);
    if (dialogs.length !== asked) {
      problems.push('compression: with the answer on the controls, saving a preset asked for a name');
    }
    say('answer on the controls: saving refused');
  } else {
    problems.push('compression: Show me offered no way to put the answer on the controls');
  }

  problems.push(...noise);
  await page.close();
  return problems;
}
