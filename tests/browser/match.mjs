// The monitor trim: that the estimate behind it is close enough to be worth
// having, and that the button on the page actually moves a gain.
//
// Both halves need a browser and for different reasons. The estimate stands
// on two offline renders a mix - `renderMix` for the master and `renderStems`
// for the parts - so nothing without Web Audio can tell whether the
// arithmetic in `src/mix/monitor.js` resembles what comes out of the
// speakers; `tests/mix.test.js` holds that arithmetic against itself and
// cannot check it against anything. And the trim is a GainNode between the
// desk and the output, which exists only when there is a graph to put it in.
//
// The second half is the one that would fail silently. A monitor control
// wired to nothing looks exactly like a monitor control that works: the
// button lights, the note changes, and the reference goes on playing at its
// own level - which is also what it would do if the match were perfect. So
// this reads the gain off the node.

import { open } from './harness.mjs';

export const name = 'match';

/**
 * How far the estimate may be out, in decibels.
 *
 * Measured rather than chosen. The thing it is there to remove is the
 * difference between the answer's loudness and yours, which is 0.19 to 2.30
 * LU across the four tiers at one seed each - so an estimate inside 0.8 is
 * taking out at least two thirds of the worst case and nearly all of the
 * common one. What it is not is exact, and the table in `monitor.js` says so
 * in the same numbers this prints.
 */
const ALLOWED = 0.8;

export async function check({ browser, at, say }) {
  const problems = [];
  // `noise` is pushed at the end rather than here, because it goes on
  // collecting: an error thrown inside a click handler happens long after
  // the page has opened, and a check that copied the list out at the top
  // would report a clean page and a mysteriously dead control.
  const { page, noise } = await open(browser, at, { view: 'mix' });

  const out = await page.evaluate(async () => {
    const { mixBrief, flatMix, gainFor, dbOf } = await import('./src/mix/brief.js');
    const { pieceOf, dress, STEM_IDS } = await import('./src/mix/piece.js');
    const { readMix } = await import('./src/mix/render.js');
    const { anchorOf, mixLoudness } = await import('./src/mix/monitor.js');

    const rows = [];

    for (const tier of ['easy', 'medium', 'hard']) {
      const brief = mixBrief(tier, 0x1111);
      const piece = pieceOf(brief.piece);
      const flat = flatMix();

      const read = async (mix) => anchorOf(mix, await readMix(dress(piece, mix), 'probe'));
      const nudge = (mix, changes) => {
        const out = Object.fromEntries(STEM_IDS.map((id) => [id, { ...mix[id] }]));
        for (const [id, by] of Object.entries(changes)) {
          out[id].gain = gainFor(dbOf(out[id].gain) + by);
        }
        return out;
      };

      // Anchored two ways: on the answer, which is where somebody about to
      // submit is, and on the flat mix a round opens on, which is the
      // furthest the anchor is ever from the desk.
      const onAnswer = await read(brief.target);
      const onFlat = await read(flat);

      for (const [what, changes] of [
        ['one fader by 1 dB', { bass: 1 }],
        ['two faders 3 dB apart', { keys: 3, pad: -3 }],
        ['all three by 4 dB', { bass: 4, keys: 4, pad: 4 }],
      ]) {
        const mix = nudge(brief.target, changes);
        const truth = (await read(mix)).master;
        rows.push({
          tier,
          what,
          truth,
          fromAnswer: mixLoudness(onAnswer, mix) - truth,
          fromFlat: mixLoudness(onFlat, nudge(flat, changes)) - (await read(nudge(flat, changes))).master,
        });
      }

      rows.push({
        tier,
        what: 'the answer against flat',
        truth: onAnswer.master,
        apart: onAnswer.master - onFlat.master,
      });
    }

    return rows;
  });

  say('the estimate against a real render, in decibels off\n');
  say('  tier     move                      render   anchored on   anchored on');
  say('                                                the answer          flat');
  let worst = 0;
  for (const row of out) {
    if (row.apart !== undefined) {
      say(`  ${row.tier.padEnd(8)} ${row.what.padEnd(24)} ${row.truth.toFixed(2).padStart(7)}`
        + `   ${row.apart.toFixed(2).padStart(11)} LU apart`);
      continue;
    }
    say(`  ${row.tier.padEnd(8)} ${row.what.padEnd(24)} ${row.truth.toFixed(2).padStart(7)}`
      + `   ${row.fromAnswer.toFixed(2).padStart(11)}   ${row.fromFlat.toFixed(2).padStart(11)}`);
    worst = Math.max(worst, Math.abs(row.fromAnswer), Math.abs(row.fromFlat));
    for (const [from, off] of [['the answer', row.fromAnswer], ['flat', row.fromFlat]]) {
      if (Math.abs(off) > ALLOWED) {
        problems.push(`anchored on ${from}, ${row.tier}'s "${row.what}" was estimated`
          + ` ${off.toFixed(2)} dB out, against ${ALLOWED} allowed`);
      }
    }
  }
  say(`\n  worst: ${worst.toFixed(2)} dB, against ${ALLOWED} allowed`);

  /* --- and the gain the button is supposed to move ------------------------- */

  const trim = await page.evaluate(async () => {
    const { Engine } = await import('./src/core/audio.js');
    const { MixPage } = await import('./src/mix/page.js');

    const el = document.createElement('div');
    el.style.display = 'none';
    document.body.append(el);

    const engine = new Engine();
    engine.ensure();
    const view = new MixPage(el, { engine });
    view.tier = 'medium';
    view.deal();

    // Three faders down six decibels, so the two mixes are certainly not at
    // the same loudness. Without this the check depends on the seed: a round
    // whose moves happen to cancel reads 0.05 LU apart, and a trim of unity
    // is then both the right answer and what a control wired to nothing
    // would do.
    const { gainFor, dbOf } = await import('./src/mix/brief.js');
    for (const id of ['bass', 'keys', 'pad']) {
      view.mine[id] = { ...view.mine[id], gain: gainFor(dbOf(view.mine[id].gain) - 6) };
    }

    // A graph to put the trim in. `ready` is what the play button calls.
    await view.ready();
    const settle = () => new Promise((ok) => setTimeout(ok, 250));

    const seen = [];
    const note = () => el.querySelector('[data-match-note]').textContent;
    const look = async (what) => {
      await settle();
      seen.push({
        what,
        gain: view.speakers.input.gain.value,
        pressed: el.querySelector('[data-match]').getAttribute('aria-pressed'),
        said: note().slice(0, 48),
      });
    };

    await look('nothing pressed');

    // With nothing measured, the reference plays at its own level: the switch
    // is the thing that measures.
    view.hear('theirs');
    await look('reference, no match');

    await view.measureMatch();
    const apart = view.reference === null ? null
      : (view.anchor ? view.anchor.master - view.reference : null);
    view.hear('theirs');
    await look('reference, matched');

    view.hear('mine');
    await look('yours, matched');

    view.hear('theirs');
    await view.toggleMatch();
    await look('reference, match off');

    view.destroy();
    el.remove();
    return { seen, apart };
  });

  say('\n  what the monitor is doing\n');
  say('  what                     gain   pressed   the note says');
  for (const row of trim.seen) {
    say(`  ${row.what.padEnd(22)} ${row.gain.toFixed(3).padStart(6)}   ${row.pressed.padEnd(7)}   ${row.said}…`);
  }
  say(`\n  the two mixes were ${trim.apart === null ? 'not measured' : `${trim.apart.toFixed(2)} LU apart`}`);

  const was = (what) => trim.seen.find((row) => row.what === what);
  const unity = (row) => Math.abs(row.gain - 1) < 0.002;

  if (!unity(was('nothing pressed'))) problems.push('the monitor was trimmed before anything was pressed');
  if (!unity(was('reference, no match'))) problems.push('the reference was trimmed by an unmeasured match');
  if (!unity(was('yours, matched'))) problems.push('a match trimmed your own mix, which is the work and not the reference');
  if (!unity(was('reference, match off'))) problems.push('switching the match off left the trim on');

  // And the one that says the control is wired to something: with the two
  // mixes measurably apart, the reference has to come to meet yours.
  if (trim.apart === null) {
    problems.push('the match measured nothing, so there was no trim to check');
  } else if (Math.abs(trim.apart) < 0.1) {
    say('\n  (the two mixes were within a tenth of a decibel, so a trim of unity is right)');
  } else if (unity(was('reference, matched'))) {
    problems.push(`the two mixes were ${trim.apart.toFixed(2)} LU apart and the trim stayed at unity`);
  } else {
    const wanted = 10 ** (trim.apart / 20);
    const off = 20 * Math.log10(was('reference, matched').gain / wanted);
    say(`  the trim landed ${off.toFixed(3)} dB from the difference it was measuring`);
    if (Math.abs(off) > 0.05) {
      problems.push(`the trim was ${off.toFixed(2)} dB away from the measured difference`);
    }
  }

  problems.push(...noise);
  await page.close();
  return problems;
}
