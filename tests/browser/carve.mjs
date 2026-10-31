// Making room: that the fault is really in the material, that the carve
// moves the reading that marks it, and that the round is neither already
// solved nor impossible.
//
// A browser check because every number here comes off a render. The carve
// tier is the one round whose problem is not injected - the four parts arrive
// flat and two pairs of them are already in each other's way - so the only
// way to know the round is worth asking is to render the flat mix and read
// it. If the parts did not actually fight, the tier would be a tier about
// nothing and `tests/mix.test.js` would pass either way: it holds the
// arithmetic over made-up readings, and a made-up reading cannot tell you
// whether a kick and a bass are in the same place.
//
// It is also where the 0.4 in `score.js` comes from. The table this prints is
// the tolerance's whole justification: flat has to fail, the answer has to
// pass, and a slip of a step or two has to be forgiven where a miss of three
// decibels is not.

import { open } from './harness.mjs';

export const name = 'carve';

export async function check({ browser, at, say }) {
  const problems = [];
  // `noise` is pushed at the end rather than here, because it goes on
  // collecting: an error thrown inside a click handler happens long after
  // the page has opened, and a check that copied the list out at the top
  // would report a clean page and a mysteriously dead control.
  const { page, noise } = await open(browser, at, { view: 'mix' });

  const out = await page.evaluate(async () => {
    const { mixBrief, flatMix, CARVES, CARVE_LEAST } = await import('./src/mix/brief.js');
    const { pieceOf, dress, STEM_IDS, PIECE_IDS } = await import('./src/mix/piece.js');
    const { readMix, RATE } = await import('./src/mix/render.js');
    const { renderStems } = await import('./src/sketch/stems.js');
    const { markMix, toleranceFor, mixAdvice } = await import('./src/mix/score.js');
    const { sharesOf, registersOf } = await import('./src/mix/share.js');
    const { EQ_REST } = await import('./src/sketch/knobs.js');
    const { THIRDS } = await import('./src/analysis/balance.js');

    const start = () => {
      const mix = flatMix();
      for (const id of STEM_IDS) {
        mix[id].inserts = ['eq'];
        mix[id].settings = { eq: { ...EQ_REST } };
      }
      return mix;
    };

    /* --- is there a fight, before anybody has done anything? --------------- */

    const fights = [];
    for (const id of PIECE_IDS) {
      const stems = await renderStems(dress(pieceOf(id), start()), 0, { rate: RATE });
      const { shares } = await sharesOf(stems, RATE);
      for (const { masker, masked, band } of CARVES) {
        fights.push({
          piece: id,
          pair: `${masker} over ${masked}`,
          band,
          masker: shares[masker][band],
          masked: shares[masked][band],
          apart: shares[masker][band] - shares[masked][band],
        });
      }
    }

    /* --- and does getting it wrong read as getting it wrong? --------------- */

    const rows = [];
    for (const id of PIECE_IDS) {
      const piece = pieceOf(id);
      const brief = mixBrief('carve', id === PIECE_IDS[0] ? 0x2f11 : 0x7a03);
      // The brief picks its own piece from the seed; this check wants both
      // pieces, so the target is taken and put on the piece being examined.
      const answer = brief.target;

      const theirs = await readMix(dress(piece, answer), 'answer');
      const off = async (what, changes) => {
        const mine = start();
        for (const { masker, band } of CARVES) {
          mine[masker].settings.eq[band] = (answer[masker].settings.eq[band] ?? 0)
            + (changes[masker] ?? 0);
        }
        const read = await readMix(dress(piece, mine), 'yours');
        const marked = markMix(read, theirs, 'carve');
        rows.push({
          piece: id,
          what,
          share: marked.readings.find((reading) => reading.kind === 'share').off,
          worst: marked.worst.kind,
          solved: marked.solved,
          said: mixAdvice(marked),
        });
      };

      // Flat is the mix a round opens on, so it is the one that must fail.
      const flat = await readMix(dress(piece, start()), 'yours');
      const atFlat = markMix(flat, theirs, 'carve');
      rows.push({
        piece: id,
        what: 'flat, which is where it starts',
        share: atFlat.readings.find((reading) => reading.kind === 'share').off,
        worst: atFlat.worst.kind,
        solved: atFlat.solved,
        said: mixAdvice(atFlat),
      });

      await off('the answer', {});
      await off('first carve out by a step', { [CARVES[0].masker]: 0.5 });
      await off('first carve out by 2 dB', { [CARVES[0].masker]: 2 });
      await off('second carve out by a step', { [CARVES[1].masker]: 0.5 });
      await off('second carve out by 3 dB', { [CARVES[1].masker]: 3 });
    }

    return { fights, rows, allowed: toleranceFor('carve').share, least: CARVE_LEAST };
  });

  say('what the parts are doing before anybody touches anything,\n'
    + '  as each part\'s share of that register against the mean of the parts\n');
  say('  piece          pair                band     masker    masked    apart');
  for (const row of out.fights) {
    say(`  ${row.piece.padEnd(14)} ${row.pair.padEnd(18)} ${row.band.padEnd(6)}`
      + ` ${row.masker.toFixed(2).padStart(8)} ${row.masked.toFixed(2).padStart(9)}`
      + ` ${row.apart.toFixed(2).padStart(8)}`);
    // A pair that is not in each other's way is a round about nothing. Twelve
    // decibels is where `share.js` stops comparing a part at all, so a masker
    // that is not within twelve of what it is supposed to be covering is not
    // covering it.
    if (row.apart < -12) {
      problems.push(`${row.piece}: ${row.pair} is ${row.apart.toFixed(1)} dB, so the masker`
        + ' is nowhere near the part it is meant to be covering');
    }
  }

  say(`\n  the round, marked against an answer, with ${out.allowed} allowed on the share\n`);
  say('  piece          what                             share   worst      solved');
  for (const row of out.rows) {
    say(`  ${row.piece.padEnd(14)} ${row.what.padEnd(30)} ${row.share.toFixed(3).padStart(7)}`
      + `   ${row.worst.padEnd(9)} ${row.solved ? 'yes' : 'no'}`);
  }
  say('');
  for (const row of out.rows.filter((one) => !one.solved).slice(0, 3)) {
    say(`  "${row.said}"`);
  }

  const look = (piece, what) => out.rows.find((row) => row.piece === piece && row.what === what);
  for (const piece of [...new Set(out.rows.map((row) => row.piece))]) {
    const must = (what, want, why) => {
      const row = look(piece, what);
      if (!row) { problems.push(`${piece}: "${what}" was not measured`); return; }
      if (row.solved !== want) problems.push(`${piece}: ${why} (share ${row.share.toFixed(3)})`);
    };

    must('the answer', true, 'the answer did not pass its own round');
    must('flat, which is where it starts', false, 'the round arrives already solved');
    must('first carve out by a step', true, 'half a decibel of slip failed the round');
    must('second carve out by a step', true, 'half a decibel of slip failed the round');
    must('first carve out by 2 dB', false, 'two decibels off the first carve passed');
    must('second carve out by 3 dB', false, 'three decibels off the second carve passed');

    // And the reading that is supposed to be doing the marking is the one
    // that does: a tier whose binding reading was `balance` would be the tone
    // tier with a different name on it.
    const flat = look(piece, 'flat, which is where it starts');
    if (flat && flat.worst !== 'share') {
      problems.push(`${piece}: the carve tier's worst reading at flat is ${flat.worst},`
        + ' not the share it is meant to be marked on');
    }
  }

  problems.push(...noise);
  await page.close();
  return problems;
}
