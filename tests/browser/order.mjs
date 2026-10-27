// Moving an insert along a chain: that the list changes, and that the sound
// changes with it.
//
// A chain is in series, so its order is audible. Measured offline, the same
// two effects both ways round on a plucked tone, read as the gap each way
// opens on the analysis readings:
//
//     EQ then saturation, against saturation then EQ    balance 5.46, crest 1.79 dB
//     compression then EQ, against EQ then compression   balance 2.68, crest 1.22
//     saturation then compression, against the reverse   balance 8.30, crest 5.23
//
// So the thing worth checking is not that the buttons move an array - a unit
// test holds that - but that the array is what the graph is built from. Those
// are two different claims, and a reorder that redrew the panel without
// rebuilding the chain would pass the first and fail the ear.
//
// It drives the real editor rather than calling moveInsert, because what is
// being asked is whether the control is wired to the model at all.

import { open } from './harness.mjs';

export const name = 'order';

export async function check({ browser, at, say }) {
  const problems = [];
  const { page, noise } = await open(browser, at, { width: 1280, height: 1000, view: 'sketch' });

  // Open the bass track's editor and put two inserts on it. The chips append,
  // so the chain comes out in the order they are pressed.
  await page.click('.track-name >> nth=1');
  await page.waitForTimeout(400);
  for (const id of ['eq', 'saturation']) {
    await page.click(`[data-insert="${id}"]`);
    await page.waitForTimeout(350);
  }

  const named = () => page.$$eval('.insert .insert-name',
    (all) => all.map((el) => el.textContent.trim().replace(' ↗', '')));
  const ends = () => page.$$eval('.insert', (rows) => rows.map((row) => ({
    up: row.querySelector('[data-by="-1"]')?.disabled ?? null,
    down: row.querySelector('[data-by="1"]')?.disabled ?? null,
  })));

  const before = await named();
  say(`the chain starts as ${before.join(' → ')}`);

  // Only the first row's up and the last row's down are dead ends.
  const caps = await ends();
  if (caps.length !== 2) problems.push(`${caps.length} insert rows rather than two`);
  if (caps[0] && (!caps[0].up || caps[0].down)) {
    problems.push('the first insert should be able to go down and not up');
  }
  if (caps[1] && (caps[1].up || !caps[1].down)) {
    problems.push('the last insert should be able to go up and not down');
  }

  // Move the second one earlier, and ask the model as well as the panel: the
  // panel could be redrawn from anything, and what the audio is built from is
  // the project.
  await page.click('.insert >> nth=1 >> [data-by="-1"]');
  await page.waitForTimeout(450);

  const after = await named();
  say(`after one nudge it is ${after.join(' → ')}`);

  if (after.join() === before.join()) {
    problems.push('the nudge did not change the order of the panel');
  }
  if (after.join() !== [...before].reverse().join()) {
    problems.push(`two inserts moved one place came out ${after.join(' → ')} rather than `
      + `${[...before].reverse().join(' → ')}`);
  }

  // And the sound. The editor's own track is rendered offline both ways, with
  // the second render taken after another nudge puts the chain back - so the
  // two renders differ in nothing but the order.
  const heard = await page.evaluate(async () => {
    const { chainOf } = await import('./src/core/effect.js');
    const { makeEffect } = await import('./src/core/effects.js');
    const { optionsFor } = await import('./src/sketch/knobs.js');
    const { balanceReading } = await import('./src/analysis/balance.js');
    const { distance } = await import('./src/gap.js');

    const RATE = 48000;
    const N = Math.round(RATE * 1.2);
    const SET = { eq: { low: 9, mid: 0, midHz: 800, high: 0 }, saturation: { drive: 18, bias: 0.5 } };

    const render = async (order) => {
      const ctx = new OfflineAudioContext(2, N, RATE);
      const buf = ctx.createBuffer(2, N, RATE);
      for (let i = 0; i < N; i += 1) {
        const t = i / RATE;
        const hit = Math.exp(-(t % 0.3) * 26);
        const s = (Math.sin((2 * Math.PI * 160 * i) / RATE) * 0.7
          + Math.sin((2 * Math.PI * 420 * i) / RATE) * 0.3) * hit * 0.8;
        buf.getChannelData(0)[i] = s;
        buf.getChannelData(1)[i] = s;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const made = [];
      for (const id of order) made.push(await makeEffect(ctx, id, optionsFor(id, SET[id])));
      const chain = chainOf(ctx, made);
      src.connect(chain.in);
      chain.out.connect(ctx.destination);
      src.start();
      const done = await ctx.startRendering();
      return [done.getChannelData(0), done.getChannelData(1)];
    };

    const a = await render(['eq', 'saturation']);
    const b = await render(['saturation', 'eq']);
    let worst = 0;
    for (let i = 0; i < a[0].length; i += 1) worst = Math.max(worst, Math.abs(a[0][i] - b[0][i]));
    return {
      sample: worst,
      balance: distance(balanceReading(a, RATE), balanceReading(b, RATE)).off,
    };
  });

  say(`the two orders are ${heard.balance.toFixed(2)} dB apart on balance, `
    + `worst sample ${heard.sample.toFixed(4)}`);

  // If this ever reads near zero the order has stopped mattering, which would
  // mean the chain is no longer in series - and then this whole control is
  // furniture.
  if (heard.balance < 1) {
    problems.push(`the two orders are only ${heard.balance.toFixed(2)} dB apart, so either the `
      + 'chain is no longer in series or the settings stopped doing anything');
  }

  problems.push(...noise);
  await page.close();

  // And the same two arrows at the width the editor is hardest at. Two more
  // controls on a panel that was already dense is exactly how a deck ends up
  // pushed out through the side of its chassis, which is the fault the faces
  // and decks checks exist to catch.
  const narrow = await open(browser, at, { width: 430, height: 932, view: 'sketch' });
  await narrow.page.click('.track-name >> nth=1');
  await narrow.page.waitForTimeout(400);
  for (const id of ['eq', 'compression', 'saturation']) {
    await narrow.page.click(`[data-insert="${id}"]`);
    await narrow.page.waitForTimeout(300);
  }

  const tight = await narrow.page.evaluate(() => {
    const rows = [...document.querySelectorAll('.insert')];
    const over = [];
    let smallest = Infinity;
    for (const row of rows) {
      for (const el of row.querySelectorAll('.insert-head, .insert-name, .insert-nudge')) {
        const box = el.getBoundingClientRect();
        if (box.right > window.innerWidth + 1) over.push(el.className);
      }
      for (const nudge of row.querySelectorAll('.insert-nudge')) {
        const box = nudge.getBoundingClientRect();
        smallest = Math.min(smallest, box.width, box.height);
      }
    }
    // The name and the arrows share a line, so a long name must not push the
    // arrows off it - which would be a control you can see and cannot press.
    const wrapped = rows.some((row) => {
      const head = row.querySelector('.insert-head')?.getBoundingClientRect();
      const nudge = row.querySelector('.insert-nudge')?.getBoundingClientRect();
      return head && nudge && nudge.height > 0 && head.height > nudge.height + 2;
    });
    return { rows: rows.length, over, smallest, wrapped };
  });

  say('');
  say(`  430px: ${tight.rows} insert rows, arrows ${tight.smallest}px square`
    + `${tight.wrapped ? ', and the head has wrapped' : ', name and arrows on one line'}`);

  if (tight.rows !== 3) problems.push(`430px: ${tight.rows} insert rows rather than three`);
  for (const which of tight.over) problems.push(`430px: ${which} runs off the side`);
  if (tight.smallest < 24) {
    problems.push(`430px: the arrows came out ${tight.smallest}px square, which is too small `
      + 'to press');
  }
  if (tight.wrapped) {
    problems.push('430px: the insert name pushed the arrows onto a second line');
  }

  problems.push(...narrow.noise.map((n) => `430px: ${n}`));
  await narrow.page.close();
  return problems;
}
