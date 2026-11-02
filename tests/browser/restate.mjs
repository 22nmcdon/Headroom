// A strip set from outside, and the whole face following it.
//
// Every tool in this app has its state put on it by something other than a
// finger: a round starts by setting its opening settings, "Show me" puts the
// answer on the controls, a fault round's A/B swaps a clean strip for a broken
// one and back. All of that goes through one method per plugin, `setState`,
// and until this check existed nothing read the face afterwards.
//
// ## Why the EQ and not the others
//
// Ten of the eleven plugins set their state the same way - `buildKnobs()` and
// then `changed()`, which is the tool's own full refresh - and not one of them
// has ever got this wrong. The EQ hand-rolled a subset of its refresh, and the
// subset was wrong twice:
//
//   * First the band rail was missing from it, so a strip arriving as six new
//     bands left the one row that names them reading the six it used to have.
//   * Then, with the rail added, the type and slope rows were still missing,
//     so band one could arrive as a 157 Hz bell with "PK 157" on the rail,
//     157 Hz on the readout, "HP" still lit on the type row, and a resonance
//     knob on screen where the bell's gain belonged.
//
// Both times the curve redrew, the audio was right, and the scoring accepted
// the answer - so every unit test passed and the only thing wrong was what a
// person could read. That is the shape of fault this holds.
//
// ## The claim
//
// After a strip is set from outside, nothing on the face contradicts the strip
// or contradicts another part of the face. The EQ states a band's type in two
// places at once - its abbreviation on the rail and a pressed button on the
// type row - and which knobs exist at all is a third statement of the same
// thing, so the face can be checked against itself as well as against the
// state it was given.
//
// It opens its own instance rather than driving the app, because what is being
// tested is the plugin's refresh and because a round only ever hands over the
// one strip it happens to have. Here every band type gets a turn at being the
// selected one, which is the case that was broken. The shell's own path is
// held in `work.mjs`, where the answer goes on through the button a person
// presses.

import { open } from './harness.mjs';

export const name = 'restate';

/**
 * The strips to put on, each one chosen so the selected band changes type.
 *
 * Band three is the one the EQ opens with selected, so it is the band whose
 * type row and knobs are on screen - and the band the broken refresh lied
 * about. Every type takes a turn there.
 */
const STRIPS = [
  ['a bell where the bell was', 'peaking', { frequency: 800, gain: 4, q: 1.5 }],
  ['a high-pass where the bell was', 'highpass', { frequency: 157, gain: 0, q: 0, slope: 24 }],
  ['a low-pass, gently', 'lowpass', { frequency: 9000, gain: 0, q: 0, slope: 6 }],
  ['a low shelf', 'lowshelf', { frequency: 120, gain: -6, q: 0.7 }],
  ['a high shelf', 'highshelf', { frequency: 10000, gain: 3, q: 0.9 }],
];

export async function check({ browser, at, say }) {
  const problems = [];
  const { page, noise } = await open(browser, at);

  const runs = await page.evaluate(async (strips) => {
    const { EQ_TOOL } = await import('./src/tools/eq.js');
    const { newStrip, BAND_TYPES, shortHz, exactHz } = await import('./src/plugins/eq/filters.js');
    const { Engine } = await import('./src/core/audio.js');

    const engine = new Engine();
    engine.ensure();
    const el = document.createElement('div');
    // Wide enough that the face lays out the way it does in the app; a panel
    // measuring zero is a different panel.
    el.style.width = '900px';
    document.body.append(el);
    const eq = EQ_TOOL.open(el, { engine });
    await new Promise((ok) => setTimeout(ok, 400));

    /** What a live control reads, or null when the face has not got one. */
    const live = (id) => {
      const node = el.querySelector(id);
      return node && !node.disabled ? node.value : null;
    };

    const out = [];
    for (const [label, type, band] of strips) {
      // Every band gets a frequency of its own so the rail cannot pass by
      // accident, and the selected band gets the type under test.
      const strip = newStrip().map((one, i) => ({
        ...one, on: true, frequency: 100 * (i + 1) + 7,
        ...(i === 2 ? { type, ...band } : {}),
      }));

      eq.setState(strip);
      await new Promise((ok) => setTimeout(ok, 250));

      const picked = [...el.querySelectorAll('[data-type]')]
        .filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.type);
      const slopes = [...el.querySelectorAll('[data-slope]')];

      out.push({
        label,
        // What the strip says, worked out in here so the check compares the
        // face against the plugin's own formatting rather than against a
        // second copy of it.
        wanted: strip.map((one) => ({
          short: BAND_TYPES[one.type].short,
          hz: shortHz(one.frequency),
          type: one.type,
          slope: String(one.slope ?? 12),
          gain: BAND_TYPES[one.type].gain ? `${one.gain.toFixed(1)} dB` : null,
          q: BAND_TYPES[one.type].q ? one.q.toFixed(2) : null,
          res: BAND_TYPES[one.type].resonance && (one.slope ?? 12) !== 6
            ? `${one.q > 0 ? '+' : ''}${one.q.toFixed(1)} dB` : null,
          freq: `${exactHz(one.frequency)} Hz`,
          cut: Boolean(BAND_TYPES[one.type].resonance),
        })),
        selected: 2,
        rail: [...el.querySelectorAll('.rail-btn')].map((b) => ({
          short: b.querySelector('.rail-type')?.textContent.trim() ?? '',
          hz: b.querySelector('.rail-hz')?.textContent.trim() ?? '',
          here: b.classList.contains('is-here'),
        })),
        typeOn: picked,
        slopeOn: slopes.filter((b) => b.getAttribute('aria-pressed') === 'true')
          .map((b) => b.dataset.slope),
        slopeLive: slopes.some((b) => !b.disabled),
        freq: live('#eqFreqValue'),
        gain: live('#eqGainValue'),
        q: live('#eqQValue'),
        res: live('#eqResValue'),
      });
    }
    return out;
  }, STRIPS);

  for (const run of runs) {
    const want = run.wanted[run.selected];
    say(`\n  ${run.label}`);
    say(`    rail        ${run.rail.map((b) => `${b.short} ${b.hz}${b.here ? '*' : ''}`).join(' · ')}`);
    say(`    type row    ${run.typeOn.join(',') || '(none lit)'}  ·  wanted ${want.type}`);
    say(`    slope row   ${run.slopeOn.join(',') || '(none lit)'}`
      + `  ${run.slopeLive ? 'live' : 'dimmed'}  ·  wanted ${want.cut ? `${want.slope}, live` : 'dimmed'}`);
    say(`    knobs       freq ${run.freq}  gain ${run.gain}  q ${run.q}  res ${run.res}`);

    const at = `"${run.label}"`;

    /* --- the rail names the strip it was given ---------------------------- */

    if (run.rail.length !== run.wanted.length) {
      problems.push(`${at}: the rail has ${run.rail.length} buttons for a strip of ${run.wanted.length}`);
    }
    run.rail.forEach((button, i) => {
      const band = run.wanted[i];
      if (!band) return;
      if (button.short !== band.short || button.hz !== band.hz) {
        problems.push(`${at}: band ${i + 1} was set to ${band.short} ${band.hz} and the rail`
          + ` still reads "${button.short} ${button.hz}" - the row that names the bands is stale`);
      }
    });
    const here = run.rail.findIndex((b) => b.here);
    if (here !== run.selected) {
      problems.push(`${at}: the rail marks band ${here + 1} as the one being edited and the`
        + ` controls are band ${run.selected + 1}'s`);
    }

    /* --- and the type row names the same band the rail does --------------- */

    if (run.typeOn.length !== 1) {
      problems.push(`${at}: ${run.typeOn.length} buttons are lit on the type row, not one`);
    } else if (run.typeOn[0] !== want.type) {
      problems.push(`${at}: the selected band is a ${want.type} and the type row still has`
        + ` ${run.typeOn[0]} lit - the rail and the type row name the same band two different`
        + ' things');
    }

    /* --- the slope row, which only a cut has ------------------------------ */

    if (run.slopeLive !== want.cut) {
      problems.push(`${at}: the slope row is ${run.slopeLive ? 'live' : 'dimmed'} on a`
        + ` ${want.type}, which ${want.cut ? 'has a slope' : 'has none'}`);
    }
    if (want.cut && run.slopeOn.join() !== want.slope) {
      problems.push(`${at}: the band was set to ${want.slope} dB an octave and the slope row`
        + ` reads "${run.slopeOn.join(',') || 'nothing'}"`);
    }
    if (!want.cut && run.slopeOn.length) {
      problems.push(`${at}: ${run.slopeOn.join(',')} is lit on the slope row of a ${want.type}`);
    }

    /* --- and the knobs that exist are the ones this type has ------------- */

    // Which of the three slots is live is a third statement of the band's
    // type, and the one the broken refresh never reached at all: a bell
    // arriving where a high-pass was had no gain knob to put its gain on.
    for (const [slot, got, wanted] of [
      ['frequency', run.freq, want.freq],
      ['gain', run.gain, want.gain],
      ['Q', run.q, want.q],
      ['resonance', run.res, want.res],
    ]) {
      if (wanted === null && got !== null) {
        problems.push(`${at}: a ${slot} knob is live on a ${want.type}, which has none`);
      } else if (wanted !== null && got === null) {
        problems.push(`${at}: a ${want.type} takes a ${slot} and the face has no live`
          + ' knob for it - the controls are still the ones the band used to need');
      } else if (wanted !== null && got !== wanted) {
        problems.push(`${at}: the band's ${slot} was set to ${wanted} and the knob reads ${got}`);
      }
    }
  }

  if (runs.length !== STRIPS.length) {
    problems.push(`${runs.length} strips were put on against the ${STRIPS.length} there are`);
  }

  problems.push(...noise);
  await page.close();
  return problems;
}
