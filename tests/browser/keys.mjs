// The app without a pointer.
//
// Nothing had ever tried. The survey that prompted this found the good news
// first - all 152 interactive things on a loaded sketchpad are reachable by
// Tab, and the EQ's curve already carries `tabindex="0"` and an aria-label
// naming the arrow keys - so this was not neglected wholesale. What it also
// found is that the trim handles added the same afternoon took focus and did
// nothing: arrow keys inert, Enter inert, announced as a button with no
// value. A control that can only be dragged is a control nobody without a
// pointer can use, and it had been written without a thought for that.
//
// ## The claims
//
// Reachable, and operable. The first is a property of the markup and the
// second is the one that gets forgotten, because a `<button>` is reachable by
// construction whether or not pressing anything does something.
//
// Also that what a control is called out loud is not the same as what it
// looks like: a handle that moves a value is a slider, not a button, and a
// screen reader should be told where it is rather than that it exists.

import { open } from './harness.mjs';

export const name = 'keys';

export async function check({ browser, at, say }) {
  const problems = [];
  const { page, noise } = await open(browser, at, { view: 'sketch', height: 1200 });
  await page.waitForTimeout(400);

  // A take, so the waveform and its handles exist to be reached at all.
  await page.evaluate(async () => {
    const { putTake } = await import('./src/sketch/takes.js');
    const { newProject, setClip, clipOf, barTicks } = await import('./src/sketch/project.js');
    const { saveSketch } = await import('./src/sketch/store.js');
    const RATE = 48000;
    const ch = new Float32Array(RATE * 6);
    for (let i = 0; i < ch.length; i += 1) ch[i] = Math.sin((2 * Math.PI * 220 * i) / RATE) * 0.5;
    await putTake('keys-take', [ch], RATE, { name: 'keys' });
    let project = newProject();
    project = setClip(project, 4, 0, clipOf({
      take: 'keys-take', notes: [], fit: 'free', length: barTicks(project) * 3,
      trim: { from: 1, to: 5 },
    }));
    saveSketch(project);
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
  await page.click('[data-view="sketch"]');
  await page.waitForTimeout(400);
  await page.click('[data-play]');
  await page.waitForTimeout(700);
  await page.click('[data-play]');
  await page.waitForTimeout(300);
  await page.click('[data-view="tools"]');
  await page.waitForTimeout(300);
  await page.click('[data-view="sketch"]');
  await page.waitForTimeout(800);
  await page.click('[data-cell="4:0"]');
  await page.waitForTimeout(800);

  /* --- everything on screen can be reached ------------------------------- */

  const reach = await page.evaluate(() => {
    const all = [...document.querySelectorAll(
      'button, [role="button"], [role="slider"], input, select, textarea, a[href], [tabindex]',
    )].filter((el) => {
      if (el.disabled || el.hidden || el.closest('[hidden]')) return false;
      const box = el.getBoundingClientRect();
      return Boolean(box.width || box.height);
    });
    return {
      total: all.length,
      lost: all.filter((el) => el.tabIndex < 0).map((el) => el.tagName.toLowerCase()
        + (el.className ? `.${String(el.className).split(' ')[0]}` : '')),
    };
  });

  say(`  ${reach.total} things on screen can be used; ${reach.lost.length} cannot be reached`);
  if (reach.lost.length) {
    problems.push(`${reach.lost.length} controls are on screen and out of reach of the keyboard:`
      + ` ${[...new Set(reach.lost)].join(', ')}`);
  }

  /* --- a control that holds a value says which, and where ---------------- */

  const named = await page.evaluate(() => [...document.querySelectorAll('[data-grab]')].map((el) => ({
    role: el.getAttribute('role'),
    label: el.getAttribute('aria-label'),
    now: el.getAttribute('aria-valuenow'),
    text: el.getAttribute('aria-valuetext'),
  })));

  say(`  the trim handles: ${named.map((n) => `${n.role} "${n.label}" at ${n.text}`).join(' · ')}`);
  for (const one of named) {
    if (one.role !== 'slider') {
      problems.push(`a trim handle is announced as a ${one.role ?? 'button'} - it moves a value`
        + ' rather than doing a thing, and a screen reader has no way to read it as one');
    }
    if (one.now === null || one.text === null) {
      problems.push(`a trim handle announces no value, so where it sits can only be seen`);
    }
  }

  /* --- and operating them with keys actually moves something ------------- */

  const worked = await page.evaluate(async () => {
    const where = () => {
      const el = document.querySelector('[data-grab="from"]');
      return { left: el?.style.left ?? null, now: el?.getAttribute('aria-valuenow') ?? null };
    };
    const press = async (key, shift = false) => {
      const el = document.querySelector('[data-grab="from"]');
      el?.focus();
      el?.dispatchEvent(new KeyboardEvent('keydown', {
        key, shiftKey: shift, bubbles: true, cancelable: true,
      }));
      await new Promise((ok) => setTimeout(ok, 250));
      return where();
    };

    const began = where();
    const right = await press('ArrowRight');
    const coarse = await press('ArrowRight', true);
    const home = await press('Home');
    return { began, right, coarse, home, holds: document.activeElement?.dataset?.grab ?? null };
  });

  say(`  from ${worked.began.now}s: right → ${worked.right.now}s,`
    + ` shift-right → ${worked.coarse.now}s, Home → ${worked.home.now}s`);
  say(`  and focus is still on the handle afterwards: ${worked.holds === 'from'}`);

  if (worked.right.now === worked.began.now) {
    problems.push(`an arrow key on a focused trim handle moved nothing - it reads`
      + ` ${worked.began.now}s before and after. A handle that can only be dragged is one`
      + ' nobody without a pointer can use');
  }
  if (Number(worked.coarse.now) - Number(worked.right.now)
    <= Number(worked.right.now) - Number(worked.began.now)) {
    problems.push('shift does not move the handle further than a bare arrow, so there is no'
      + ' way to cross a long take without a great many presses');
  }
  if (Number(worked.home.now) !== 0) {
    problems.push(`Home left the handle at ${worked.home.now}s rather than at the start`);
  }
  // The fault that makes a keyboard control useless even when it works: the
  // panel is rebuilt on every change, so without putting focus back, one
  // press is all anybody gets.
  if (worked.holds !== 'from') {
    problems.push('after a key press the handle no longer has focus - the panel is rebuilt on'
      + ' every change, so one arrow key is all anybody gets before the control is taken out'
      + ' from under them');
  }

  problems.push(...noise);
  await page.close();
  return problems;
}
