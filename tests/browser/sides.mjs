// The delay's two sides: that the routings are three different images, and
// that the controls for them fit on the face.
//
// The arithmetic - where each repeat lands on each side - is held without a
// browser in tests/echo.test.js. What is here is the part that says the
// routings are telling apart, read with the app's own image readings rather
// than with a number invented for this check. Measured through real material
// at 375 ms, half feedback, all wet:
//
//     routing                   correlation     width    mono cost      sides
//     together                        1.000   -30.00 dB     0.00 dB     0.00 dB
//     offset 12 ms                    0.331    -2.99 dB    -1.77 dB     0.00 dB
//     offset 90 ms                    0.131    -1.14 dB    -2.48 dB     0.00 dB
//     ping-pong                       0.294    -2.32 dB    -1.75 dB     4.31 dB
//     ping-pong from the right        0.294    -2.32 dB    -1.75 dB    -4.31 dB
//
// Three distinct pictures. Together reads as mono and folds down for nothing.
// An offset decorrelates the sides and costs a decibel or two in a fold-down,
// and stays centred because both ears are fed. A ping-pong does the same to
// the correlation and leans toward the ear it starts in, which is the reading
// that tells it from an offset - the correlations alone do not, at 0.294
// against 0.331.
//
// Through material rather than on the bare response, and the numbers are
// higher for it: on the impulse alone an offset reads 0.000 correlated, but a
// centred source arriving twelve milliseconds apart on the two sides is still
// partly the same wave, and that is what a listener gets. The thresholds here
// come from this table rather than from the response's.
//
// It also says what cannot be marked. Twelve and ninety milliseconds differ
// here, but not in any ordered way - on the bare response they read
// identically - so "which routing" is a question these readings can ask and
// "how much offset" is not.

import { open } from './harness.mjs';

export const name = 'sides';

export async function check({ browser, at, say }) {
  const problems = [];
  const page = await browser.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  await page.goto(at, { waitUntil: 'networkidle' });

  const rows = await page.evaluate(async () => {
    const { makeEffect } = await import('./src/core/effects.js');
    const { ECHO_DEFAULTS } = await import('./src/plugins/delay/line.js');
    const { stereoProfile } = await import('./src/plugins/stereo/field.js');
    const { placementOf } = await import('./src/mix/placement.js');

    const RATE = 48000;
    const N = Math.round(RATE * 3);

    // A centred source, because that is what everything in this app puts
    // into a delay and the only thing a two-channel response can cross.
    const through = async (settings) => {
      const ctx = new OfflineAudioContext(2, N, RATE);
      const buf = ctx.createBuffer(2, Math.round(RATE * 0.12), RATE);
      for (let i = 0; i < buf.length; i += 1) {
        const env = Math.exp(-(i / RATE) * 30);
        const s = (Math.sin((2 * Math.PI * 240 * i) / RATE)
          + Math.sin((2 * Math.PI * 700 * i) / RATE) * 0.5) * env * 0.5;
        buf.getChannelData(0)[i] = s;
        buf.getChannelData(1)[i] = s;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const fx = await makeEffect(ctx, 'delay', {
        settings: { ...ECHO_DEFAULTS, time: 375, feedback: 0.5, mix: 1, ...settings },
      });
      src.connect(fx.in);
      fx.out.connect(ctx.destination);
      src.start();
      const done = await ctx.startRendering();
      const L = done.getChannelData(0);
      const R = done.getChannelData(1);
      const image = stereoProfile(L, R, RATE).whole;
      return {
        correlation: image.correlation,
        width: image.width,
        mono: image.mono,
        sides: placementOf(L, R, RATE).whole,
      };
    };

    return [
      { what: 'together', ...(await through({ offset: 0 })) },
      { what: 'offset 12 ms', ...(await through({ offset: 12 })) },
      { what: 'offset 90 ms', ...(await through({ offset: 90 })) },
      { what: 'ping-pong', ...(await through({ pingPong: true })) },
      { what: 'ping-pong from the right', ...(await through({ pingPong: true, pingPongFrom: 'right' })) },
    ];
  });

  say('  a centred source through a delay insert, read as an image\n');
  say('  routing                   correlation     width    mono cost      sides');
  for (const r of rows) {
    say(`  ${r.what.padEnd(25)} ${r.correlation.toFixed(3).padStart(11)}`
      + ` ${r.width.toFixed(2).padStart(8)} dB ${r.mono.toFixed(2).padStart(8)} dB`
      + ` ${r.sides.toFixed(2).padStart(8)} dB`);
  }

  const by = (what) => rows.find((r) => r.what === what);

  // Together is mono: the two sides are the same signal, so they correlate
  // and a fold-down costs nothing.
  if (by('together').correlation < 0.99) {
    problems.push(`with no offset the two sides read ${by('together').correlation.toFixed(3)} `
      + 'correlated, and they should be the same signal');
  }
  if (Math.abs(by('together').mono) > 0.2) {
    problems.push(`with no offset a fold-down cost ${by('together').mono.toFixed(2)} dB, `
      + 'and there is nothing for it to cancel with');
  }

  // An offset is not mono any more, at either size.
  for (const what of ['offset 12 ms', 'offset 90 ms']) {
    // Six tenths, from the table above: together reads 1.000 and the offsets
    // read 0.331 and 0.131, so this sits in the gap rather than on either.
    if (by(what).correlation > 0.6) {
      problems.push(`${what} left the sides ${by(what).correlation.toFixed(3)} correlated`);
    }
    if (by(what).mono > -1) {
      problems.push(`${what} cost only ${by(what).mono.toFixed(2)} dB in a fold-down, so the `
        + 'two sides are not carrying different things');
    }
    // And it is not a ping-pong: an offset feeds both ears, so it stays centred.
    if (Math.abs(by(what).sides) > 2) {
      problems.push(`${what} sat ${by(what).sides.toFixed(2)} dB off centre, and an offset `
        + 'feeds both ears equally');
    }
  }

  // A ping-pong starts in one ear, so it is off centre - and the other way
  // round when it is told to start on the other side.
  if (by('ping-pong').sides < 2) {
    problems.push(`a ping-pong sat ${by('ping-pong').sides.toFixed(2)} dB off centre and should `
      + 'lean toward the ear it starts in');
  }
  if (by('ping-pong from the right').sides > -2) {
    problems.push('a ping-pong started from the right did not lean right: '
      + `${by('ping-pong from the right').sides.toFixed(2)} dB`);
  }

  await page.close();

  // Then the face, at the two widths, because this added a knob and a select
  // to a chassis that is checked for exactly that.
  for (const [label, width, height] of [['portrait', 430, 932], ['desktop', 1280, 1000]]) {
    const view = await open(browser, at, { width, height, view: 'tools' });
    await view.page.click('.modes button:text-is("Delay")');
    await view.page.waitForTimeout(500);

    const face = await view.page.evaluate(() => {
      const offset = document.querySelector('[data-dial="offset"]');
      const heads = document.querySelector('#echoHeads');
      const field = document.querySelector('#echoFromField');
      const chassis = document.querySelector('.plugin');
      const box = chassis?.getBoundingClientRect();
      const over = [...(chassis?.querySelectorAll('*') ?? [])]
        .filter((el) => {
          const b = el.getBoundingClientRect();
          return b.width > 0 && box && (b.right > box.right + 1 || b.bottom > box.bottom + 1);
        })
        .map((el) => el.className)
        .slice(0, 4);
      return {
        offset: !!offset,
        heads: heads ? heads.options.length : 0,
        // Hidden until there is a ping-pong to start, which is the point of it.
        fromHidden: field ? field.hidden : null,
        over,
      };
    });

    say('');
    say(`  ${label}: an offset knob is ${face.offset ? 'there' : 'missing'}, `
      + `${face.heads} head patterns, and the side picker is `
      + `${face.fromHidden ? 'put away until ping-pong is on' : 'showing'}`);

    if (!face.offset) problems.push(`${label}: the delay face has no offset knob`);
    if (face.heads < 3) {
      problems.push(`${label}: the heads picker offers ${face.heads} patterns rather than three`);
    }
    if (face.fromHidden !== true) {
      problems.push(`${label}: the ping-pong side picker is showing with ping-pong off`);
    }
    for (const which of face.over) {
      problems.push(`${label}: ${which} is outside the chassis`);
    }

    problems.push(...view.noise.map((n) => `${label}: ${n}`));
    await view.page.close();
  }

  return problems;
}
