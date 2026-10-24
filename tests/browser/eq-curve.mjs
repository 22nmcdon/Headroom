// The EQ's drawn curve against the EQ you can actually hear.
//
// This is the one check here that exists because of a thing that turned out
// NOT to be wrong. The EQ is the only one of the six tools whose audio and
// whose marking are different code: `filters.js` computes cookbook
// coefficients to draw and to score, and the live chain is native
// BiquadFilterNodes. Two models, agreed by hand.
//
// Measured, they agree: no more than 0.013 dB apart on any bell or shelf,
// including at 10 and 15 kHz where the bilinear transform cramps hardest, and
// no more than 0.04 dB on a resonant cut at any slope. The reason is not luck
// - the W3C spec defines Web Audio's biquads with the same cookbook formulas
// filters.js implements, so both sides cramp identically. The picture is
// honest; it is simply not analogue.
//
// So why keep a check for something that is right? Because nothing was
// holding it there. It was measured once, by hand, in one browser, and a
// change to `sectionsOf` or to `coefficients` could part the picture from the
// sound again without a single unit test noticing - which has happened once
// already, when the low-pass resonance was read as a plain Q instead of
// Web Audio's decibels and the drawn corner sat 3.7 dB from the audible one.
//
// What it does not guard is other browsers. If the coefficients are
// spec-mandated then a divergence in Firefox or Safari is a browser bug, and
// a check that only ever starts Chromium could not see it anyway.

import { open } from './harness.mjs';

export const name = 'eq-curve';

/**
 * How far apart the two may be, in decibels, where it is audible.
 *
 * Set from what they actually measure, not from taste. Every bell and every
 * shelf comes in under 0.015 dB, including at 15 kHz. The cuts reach 0.085,
 * and only down at -28 dB and below, inside a stopband - and further still
 * below that, which is why the floor underneath exists.
 *
 * A seventh of a decibel is therefore well clear of the arithmetic and
 * nowhere near a real fault: the one divergence this has ever had was 3.7 dB.
 */
const CLOSE = 0.15;

/** And below this, down in a cut's stopband, nobody can hear the difference. */
const INAUDIBLE = -30;

/**
 * The cases, chosen to sit where a disagreement would show up: bells high
 * enough to cramp, both shelves, cuts at every slope with and without
 * resonance, a narrow bell at the bottom, and the whole strip at once.
 */
const CASES = [
  ['a bell at 1 kHz', [{ id: 'p1', type: 'peaking', frequency: 1000, gain: 9, q: 1.4, slope: 12 }]],
  ['a bell at 10 kHz', [{ id: 'p1', type: 'peaking', frequency: 10000, gain: 9, q: 1.4, slope: 12 }]],
  ['a bell at 15 kHz', [{ id: 'p1', type: 'peaking', frequency: 15000, gain: 12, q: 2, slope: 12 }]],
  ['a cut bell at 15 kHz', [{ id: 'p1', type: 'peaking', frequency: 15000, gain: -12, q: 2, slope: 12 }]],
  ['a narrow bell at 50 Hz', [{ id: 'p1', type: 'peaking', frequency: 50, gain: 9, q: 8, slope: 12 }]],
  ['a low shelf', [{ id: 'ls', type: 'lowshelf', frequency: 120, gain: 8, q: 0.7, slope: 12 }]],
  ['a high shelf', [{ id: 'hs', type: 'highshelf', frequency: 8000, gain: -8, q: 0.7, slope: 12 }]],
  ['a 12 dB/oct high-pass', [{ id: 'hp', type: 'highpass', frequency: 100, gain: 0, q: -3.0103, slope: 12 }]],
  ['a 24 dB/oct high-pass', [{ id: 'hp', type: 'highpass', frequency: 100, gain: 0, q: -3.0103, slope: 24 }]],
  ['a 48 dB/oct high-pass', [{ id: 'hp', type: 'highpass', frequency: 100, gain: 0, q: -3.0103, slope: 48 }]],
  ['a resonant 48 dB/oct high-pass', [{ id: 'hp', type: 'highpass', frequency: 100, gain: 0, q: 6, slope: 48 }]],
  ['a resonant low-pass', [{ id: 'lp', type: 'lowpass', frequency: 6000, gain: 0, q: 6, slope: 24 }]],
  ['the whole strip', [
    { id: 'hp', type: 'highpass', frequency: 40, gain: 0, q: -3.0103, slope: 24 },
    { id: 'ls', type: 'lowshelf', frequency: 120, gain: 5, q: 0.7, slope: 12 },
    { id: 'p1', type: 'peaking', frequency: 400, gain: -4, q: 1.4, slope: 12 },
    { id: 'p2', type: 'peaking', frequency: 2500, gain: 6, q: 2, slope: 12 },
    { id: 'hs', type: 'highshelf', frequency: 9000, gain: 4, q: 0.7, slope: 12 },
    { id: 'lp', type: 'lowpass', frequency: 17000, gain: 0, q: -3.0103, slope: 12 },
  ]],
];

export async function check({ browser, at, say }) {
  const problems = [];
  const { page, noise } = await open(browser, at);

  const results = await page.evaluate(async ({ cases, base }) => {
    const filters = await import(`${base}src/plugins/eq/filters.js`);
    const sections = await import(`${base}src/plugins/eq/sections.js`);
    const { curveOf, logFrequencies } = filters;
    const { eqSections, tuneSections } = sections;

    const rate = 48000;
    const probe = logFrequencies(240, 20, 23000);
    const out = [];

    for (const [label, bands] of cases) {
      // The real chain, built the way the app builds it, measured by its own
      // impulse response rather than by reading the coefficients back.
      // `tuneSections` ramps every parameter with setTargetAtTime over 10 ms,
      // which is what stops a knob clicking - so an impulse at sample zero
      // would measure a chain still on its way to the settings asked for.
      // Render a fifth of a second of nothing first, which is twenty time
      // constants, then strike it.
      const SETTLE = Math.round(rate * 0.2);
      const length = SETTLE + 32768;
      const ctx = new OfflineAudioContext(1, length, rate);
      const chain = eqSections(ctx, bands.length);
      tuneSections(chain, bands, 0, rate, null);

      const impulse = ctx.createBuffer(1, length, rate);
      impulse.getChannelData(0)[SETTLE] = 1;
      const source = ctx.createBufferSource();
      source.buffer = impulse;
      source.connect(chain.input);
      chain.trim.connect(ctx.destination);
      source.start();

      const rendered = await ctx.startRendering();
      const ir = rendered.getChannelData(0).subarray(SETTLE);

      // The trim the chain applies is the auto-gain, which is not part of the
      // curve being drawn, so take it back off before comparing.
      const lift = filters.averageLift(bands, rate, null);
      const undo = 10 ** (lift / 20);

      const heard = probe.map((hz) => {
        // One bin of a DFT, at exactly the frequency asked for.
        const w = (2 * Math.PI * hz) / rate;
        let re = 0;
        let im = 0;
        for (let n = 0; n < ir.length; n += 1) {
          re += ir[n] * Math.cos(w * n);
          im -= ir[n] * Math.sin(w * n);
        }
        return 20 * Math.log10(Math.max(Math.hypot(re, im) * undo, 1e-12));
      });

      const drawn = Array.from(curveOf(bands, probe, rate));
      out.push({ label, probe, drawn, heard });
    }
    return out;
  }, { cases: CASES, base: at });

  for (const { label, probe, drawn, heard } of results) {
    let worst = 0;
    let worstAt = 0;
    let worstLevel = 0;
    for (let i = 0; i < probe.length; i += 1) {
      // Only where it could be heard. A cut's stopband is 40 dB down and the
      // two models disagree there by a fraction of a decibel of nothing.
      if (drawn[i] < INAUDIBLE && heard[i] < INAUDIBLE) continue;
      const off = Math.abs(drawn[i] - heard[i]);
      if (off > worst) { worst = off; worstAt = probe[i]; worstLevel = drawn[i]; }
    }

    say(`${label.padEnd(30)} worst ${worst.toFixed(3)} dB at ${Math.round(worstAt)} Hz `
      + `(where the curve is ${worstLevel.toFixed(1)} dB)`);
    if (worst > CLOSE) {
      problems.push(`${label}: drawn and heard differ by ${worst.toFixed(3)} dB at `
        + `${Math.round(worstAt)} Hz — the picture is not the sound`);
    }
  }

  problems.push(...noise);
  await page.close();
  return problems;
}
