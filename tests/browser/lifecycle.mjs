// What every tool's audio has to do, whichever tool it is.
//
// Most of the bugs one audit found in the players were one mistake made
// several times, because each player was written by copying the last: a
// fault or a sample swapped while the loop played, and the old one kept
// sounding; a tool closed, and its nodes stayed wired to the output and its
// worklets ran for good; Play pressed twice before the graph was up, and two
// graphs were built. Each was fixed where it was found, and the next player
// written by copying would have brought all three back. This is the check
// that it does not, run against every tool on the strip.
//
// Black-box on purpose. It patches Web Audio before the app loads, drives the
// real buttons, and counts what the page leaves behind - so it holds of a
// player however it is written, and of one nobody has written yet.
//
// Three promises, for each tool:
//
//   gone      closing it leaves nothing sounding, and opening it again and
//             again leaves no more connected nodes than opening it once did
//   once      a double tap on Play builds no more worklets, and leaves no
//             more sources sounding, than a single one
//   swapped   a new sample picked while it plays is what is heard - none of
//             the old one is still sounding once the new one has started

import { TOOLS } from './harness.mjs';

export const name = 'lifecycle';

/** Where each tool is left from: opened, never played. Its own visits use the second. */
const NEUTRAL = ['Level', 'Limiter'];

/** Visits per tool. The first warms whatever is cached; growth is read after it. */
const VISITS = 3;

/**
 * Installed before the app's own scripts, so every node the app makes passes
 * through it. Only nodes on a realtime AudioContext count: renders are
 * offline contexts that end, and their graphs go with them.
 */
function probe() {
  const live = (node) => typeof AudioContext !== 'undefined' && node.context instanceof AudioContext;
  const wired = new Map();
  // Each sounding source, with where it was started from - which is what a
  // failure needs to say, since a count alone names no culprit.
  const sounding = new Map();
  const ids = new WeakMap();
  let next = 0;
  let worklets = 0;
  const idOf = (thing) => {
    if (!thing) return null;
    if (!ids.has(thing)) ids.set(thing, (next += 1));
    return ids.get(thing);
  };

  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (to, ...rest) {
    const made = connect.call(this, to, ...rest);
    if (live(this)) {
      if (!wired.has(this)) wired.set(this, new Set());
      wired.get(this).add(to);
    }
    return made;
  };

  const disconnect = AudioNode.prototype.disconnect;
  AudioNode.prototype.disconnect = function (...args) {
    const done = disconnect.apply(this, args);
    // No argument, or an output index, takes every connection that output
    // had; a destination takes that one.
    if (!args.length || typeof args[0] === 'number') wired.delete(this);
    else {
      wired.get(this)?.delete(args[0]);
      if (wired.get(this)?.size === 0) wired.delete(this);
    }
    return done;
  };

  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...args) {
    if (live(this)) {
      const where = (new Error().stack ?? '').split('\n').slice(2)
        .find((line) => line.includes('/src/'))?.trim().replace(/^at /, '').replace(/https?:\/\/[^/]+\//, '') ?? '?';
      sounding.set(this, where);
      this.addEventListener('ended', () => sounding.delete(this));
    }
    return start.apply(this, args);
  };
  const stop = AudioBufferSourceNode.prototype.stop;
  AudioBufferSourceNode.prototype.stop = function (...args) {
    sounding.delete(this);
    return stop.apply(this, args);
  };

  if (typeof AudioWorkletNode !== 'undefined') {
    const Original = AudioWorkletNode;
    window.AudioWorkletNode = class extends Original {
      constructor(ctx, ...rest) {
        super(ctx, ...rest);
        if (ctx instanceof AudioContext) worklets += 1;
      }
    };
  }

  window.__lifecycle = () => {
    const kinds = {};
    for (const node of wired.keys()) kinds[node.constructor.name] = (kinds[node.constructor.name] ?? 0) + 1;
    return {
      wired: wired.size,
      kinds,
      worklets,
      sounding: [...sounding.keys()].map((source) => idOf(source.buffer)),
      where: [...sounding.values()],
    };
  };
}

export async function check({ browser, at, say }) {
  const problems = [];
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const noise = [];
  page.on('pageerror', (e) => noise.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') noise.push(`console: ${m.text()}`); });
  await page.addInitScript(probe);
  await page.goto(at, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
  await page.click('[data-view="tools"]');

  const read = () => page.evaluate(() => window.__lifecycle());

  /** Open a tool and wait for its round, which is what attaching it ends with. */
  const openTool = async (tool) => {
    // The one already showing starts no round when it is clicked, so there
    // is nothing to wait for.
    const here = await page.$eval(`.modes button:text-is("${tool}")`,
      (pill) => pill.getAttribute('aria-checked') === 'true');
    if (here) return;
    await page.evaluate(() => { const v = document.querySelector('#verdict'); if (v) v.textContent = ''; });
    await page.click(`.modes button:text-is("${tool}")`);
    await page.waitForFunction(
      () => (document.querySelector('#verdict')?.textContent.trim().length ?? 0) > 0,
      null, { timeout: 20000 },
    );
    await page.waitForTimeout(250);
  };

  /** Until something is sounding, or a reason why not. */
  const playing = async () => {
    try {
      await page.waitForFunction(() => window.__lifecycle().sounding.length > 0, null, { timeout: 15000 });
      await page.waitForTimeout(300);
      return true;
    } catch {
      return false;
    }
  };

  /** Whatever happens to a tool's audio once it has gone takes a moment. */
  const settle = () => page.waitForTimeout(600);

  say('  tool          grew by     left sounding   worklets 1 tap / 2 taps   swap');

  // HEADROOM_TOOLS=Level,EQ narrows it to those, for working on one player
  // without waiting for all twelve.
  const only = process.env.HEADROOM_TOOLS?.split(',').map((t) => t.trim()).filter(Boolean);
  for (const tool of only?.length ? TOOLS.filter((t) => only.includes(t)) : TOOLS) {
    const neutral = tool === NEUTRAL[0] ? NEUTRAL[1] : NEUTRAL[0];
    const row = { grew: '', left: '', taps: '', swap: '' };

    /* --- gone --- */
    const after = [];
    let quiet = true;
    for (let visit = 0; visit < VISITS; visit += 1) {
      await openTool(tool);
      await page.click('.surface .play-btn');
      if (!(await playing())) { problems.push(`${tool}: Play made no sound`); quiet = false; break; }
      await openTool(neutral);
      await settle();
      const left = await read();
      after.push(left);
      if (left.sounding.length) {
        const from = [...new Set(left.where)].join('; ');
        problems.push(`${tool}: ${left.sounding.length} source(s) still sounding after it was closed, started at ${from}`);
        quiet = false;
      }
    }
    if (after.length === VISITS) {
      const grew = after[VISITS - 1].wired - after[1].wired;
      row.grew = grew > 0 ? `+${grew}` : '0';
      if (grew > 0) {
        const kinds = Object.entries(after[VISITS - 1].kinds)
          .map(([kind, n]) => [kind, n - (after[1].kinds[kind] ?? 0)])
          .filter(([, n]) => n > 0).map(([kind, n]) => `${n} ${kind}`).join(', ');
        problems.push(`${tool}: ${grew} more node(s) still connected after ${VISITS - 1} more visits (${kinds})`);
      }
    }
    row.left = quiet ? 'none' : 'YES';

    /* --- once --- */
    await openTool(tool);
    let before = await read();
    await page.click('.surface .play-btn');
    await playing();
    await page.waitForTimeout(1200);
    const single = await read();
    const oneTap = single.worklets - before.worklets;
    const oneSound = single.sounding.length;

    await openTool(neutral);
    await settle();
    await openTool(tool);
    before = await read();
    // Two clicks in one task, which is the double tap: the second lands while
    // the first is still awaiting its build.
    await page.evaluate(() => {
      const button = document.querySelector('.surface .play-btn');
      button.click();
      button.click();
    });
    await page.waitForTimeout(2500);
    const double = await read();
    const twoTaps = double.worklets - before.worklets;
    row.taps = `${oneTap} / ${twoTaps}`;
    if (twoTaps > oneTap) problems.push(`${tool}: a double tap on Play built ${twoTaps} worklets against ${oneTap} for one`);
    if (double.sounding.length > oneSound) {
      problems.push(`${tool}: a double tap left ${double.sounding.length} sources sounding against ${oneSound} for one`);
    }

    /* --- swapped --- */
    const picker = await page.$('.surface select[id$="Source"]');
    if (!picker) {
      row.swap = 'no picker';
    } else {
      if (!double.sounding.length) {
        await page.click('.surface .play-btn');
        await playing();
      }
      const was = new Set((await read()).sounding);
      const other = await picker.evaluate((select) => [...select.options]
        .find((option) => !option.hidden && !option.disabled && option.value !== select.value
          && option.value !== 'yours')?.value ?? null);
      if (!other) {
        row.swap = 'one choice';
      } else {
        await picker.selectOption(other);
        const changed = await page.waitForFunction((old) => {
          const now = window.__lifecycle().sounding;
          return now.length > 0 && now.every((id) => !old.includes(id));
        }, [...was], { timeout: 15000 }).then(() => true, () => false);
        row.swap = changed ? 'heard' : 'OLD STILL PLAYING';
        if (!changed) {
          const now = (await read()).sounding;
          problems.push(`${tool}: picked another sample while playing, and `
            + `${now.filter((id) => was.has(id)).length} of the old one's sources were still sounding`);
        }
      }
    }

    await openTool(neutral);
    await settle();
    say(`  ${tool.padEnd(12)}  ${row.grew.padEnd(10)}  ${row.left.padEnd(14)}  ${row.taps.padEnd(24)}  ${row.swap}`);
  }

  problems.push(...noise);
  await page.close();
  return problems;
}
