// Front to back: that the three cues are really three cues, that the room
// says which part is in it, and that a distance round can be won and cannot
// be arrived at.
//
// A browser check because the room only exists when something is rendered
// through it. The claim this tier stands on - that a shared reverb still says
// which parts are in it, by its colour - is a claim about a convolution of
// real material with a real impulse, and nothing without Web Audio can check
// it. `tests/mix.test.js` holds the arithmetic over made-up readings, and a
// made-up room is whatever shape you made it.
//
// It is also where the tolerances in `score.js` come from: the table below is
// the whole justification, printed every run.

import { open } from './harness.mjs';

export const name = 'depth';

export async function check({ browser, at, say }) {
  const problems = [];
  // `noise` is pushed at the end rather than here, because it goes on
  // collecting: an error thrown inside a click handler happens long after
  // the page has opened, and a check that copied the list out at the top
  // would report a clean page and a mysteriously dead control.
  const { page, noise } = await open(browser, at, { view: 'mix' });

  const out = await page.evaluate(async () => {
    const {
      flatMix, gainFor, dbOf, DEPTHS, AT_A_DISTANCE, AIRY, ROOM_FOR, STEPS,
    } = await import('./src/mix/brief.js');
    const { pieceOf, dress, STEM_IDS } = await import('./src/mix/piece.js');
    const { readMix, RATE } = await import('./src/mix/render.js');
    const { renderStems } = await import('./src/sketch/stems.js');
    const { markMix, toleranceFor, mixAdvice } = await import('./src/mix/score.js');
    const { roomOf } = await import('./src/mix/room.js');
    const { EQ_REST } = await import('./src/sketch/knobs.js');

    const start = () => {
      const mix = flatMix();
      for (const id of STEM_IDS) {
        mix[id].inserts = ['eq'];
        mix[id].settings = { eq: { ...EQ_REST } };
      }
      return mix;
    };

    /* --- is the room a different room depending on who is in it? ---------- */

    const piece = pieceOf('short-night');
    const rooms = [];
    for (const id of AT_A_DISTANCE) {
      for (const send of [0.2, 0.45]) {
        const mix = start();
        mix[id].send = send;
        const stems = await renderStems(dress(piece, mix), 0, { rate: RATE });
        rooms.push({ who: `${id} at ${send}`, ...roomOf(stems, RATE) });
      }
    }

    /* --- and does a distance round mark what it means to? ----------------- */

    // The answer is built here rather than dealt, and on purpose: this check
    // is about what the readings do to a known pair of distances, and a dealt
    // round would put the parts somewhere different on every run - including,
    // one run in three, the pad up front, where "the air left flat" is not a
    // mistake at all and the row would quietly test nothing. That the deal
    // puts them at distances from this same table, and never two at one
    // distance, is held in tests/mix.test.js.
    const atDepth = (mix, id, which) => {
      const how = DEPTHS.find((one) => one.id === which);
      mix[id].gain = gainFor(how.gain);
      mix[id].send = how.send * ROOM_FOR[id];
      if (AIRY.includes(id)) mix[id].settings.eq.high = how.air;
    };
    const answer = start();
    atDepth(answer, AT_A_DISTANCE[0], 'middle');
    atDepth(answer, AT_A_DISTANCE[1], 'back');
    const theirs = await readMix(dress(piece, answer), 'answer');
    const allowed = toleranceFor('depth');

    const kinds = Object.keys(allowed);
    const rows = [];
    const tryIt = async (what, change) => {
      const mine = start();
      for (const id of STEM_IDS) {
        mine[id] = { ...answer[id], settings: { eq: { ...answer[id].settings.eq } } };
      }
      change(mine);
      const marked = markMix(await readMix(dress(piece, mine), 'yours'), theirs, 'depth');
      rows.push({
        what,
        offs: Object.fromEntries(marked.readings.map((one) => [one.kind, one.off])),
        worst: marked.worst.kind,
        solved: marked.solved,
        said: mixAdvice(marked),
      });
    };

    // Where a round starts: everything flat and in front.
    await tryIt('flat, which is where it starts', (mine) => {
      for (const id of STEM_IDS) {
        mine[id] = { ...start()[id] };
      }
    });
    await tryIt('the answer', () => {});

    // A step of slip on each of the three controls, which has to be forgiven.
    const first = AT_A_DISTANCE[0];
    await tryIt('one send out by a step', (mine) => {
      mine[first].send = Math.max(0, mine[first].send + STEPS.send);
    });
    await tryIt('one fader out by a step', (mine) => {
      mine[first].gain = gainFor(dbOf(mine[first].gain) + STEPS.gain);
    });
    await tryIt('the air out by 3 dB', (mine) => {
      mine[AIRY[0]].settings.eq.high += 3;
    });

    // And the things that have to fail: the air left flat, and a part put at
    // the wrong distance altogether.
    await tryIt('the air left flat', (mine) => {
      mine[AIRY[0]].settings.eq.high = 0;
    });

    const at = DEPTHS.find((one) => one.id === 'middle');
    const next = DEPTHS.find((one) => one.id === 'back');
    await tryIt(`${first} at the next distance along`, (mine) => atDepth(mine, first, 'back'));

    // The one that nothing but the room can catch: the right amount of
    // reverb, on the wrong part.
    await tryIt('the room on the wrong part', (mine) => {
      const [a, b] = AT_A_DISTANCE;
      const swap = mine[a].send;
      mine[a].send = mine[b].send;
      mine[b].send = swap;
    });

    return { rooms, rows, kinds, allowed, placed: AT_A_DISTANCE, at: at?.id, next: next?.id };
  });

  say('the room, with one part in it at a time, against the whole mix\n');
  say('  who                how much      low      mid     high');
  for (const row of out.rooms) {
    say(`  ${row.who.padEnd(18)} ${row.howMuch.toFixed(2).padStart(8)}`
      + ['low', 'mid', 'high'].map((band) => row.shape[band].toFixed(2).padStart(9)).join(''));
  }

  // The claim the tier stands on: two parts make two different rooms. If they
  // did not, "the room on the wrong part" would be unmarkable and the tier
  // would be the hard tier with a new name.
  const colours = out.rooms.filter((row) => row.who.endsWith('0.2'));
  if (colours.length === 2) {
    const apart = Math.max(...['low', 'mid', 'high']
      .map((band) => Math.abs(colours[0].shape[band] - colours[1].shape[band])));
    say(`\n  the two parts make rooms ${apart.toFixed(2)} dB apart in colour`);
    if (apart < 5) {
      problems.push(`the two parts make rooms only ${apart.toFixed(2)} dB apart,`
        + ' so the room cannot say which of them is in it');
    }
  }

  say(`\n  a distance round, marked. ${out.at} is where the answer put the first part,`);
  say(`  and "${out.next}" is the distance next along from it.\n`);
  const head = out.kinds.map((kind) => kind.slice(0, 8).padStart(9)).join('');
  say(`  what                             ${head}   solved`);
  for (const row of out.rows) {
    say(`  ${row.what.padEnd(32)}`
      + out.kinds.map((kind) => (row.offs[kind] ?? 0).toFixed(2).padStart(9)).join('')
      + `   ${row.solved ? 'yes' : `no (${row.worst})`}`);
  }
  say('');
  for (const row of out.rows.filter((one) => !one.solved).slice(0, 4)) {
    say(`  "${row.said}"`);
  }

  const look = (what) => out.rows.find((row) => row.what === what);
  const must = (what, want, why) => {
    const row = look(what);
    if (!row) { problems.push(`"${what}" was not measured`); return; }
    if (row.solved !== want) {
      problems.push(`${why} (worst was ${row.worst} at ${(row.offs[row.worst] ?? 0).toFixed(2)},`
        + ` against ${out.allowed[row.worst]} allowed)`);
    }
  };

  must('the answer', true, 'the answer did not pass its own round');
  must('flat, which is where it starts', false, 'the round arrives already solved');
  must('one send out by a step', true, 'a step of send failed the round');
  must('one fader out by a step', true, 'a step of fader failed the round');
  must('the air out by 3 dB', true, 'three decibels of air failed the round');
  must('the air left flat', false, 'the air could be left flat and the round still passed');
  must(`${out.placed[0]} at the next distance along`, false, 'a part at the wrong distance passed');
  must('the room on the wrong part', false, 'the reverb could go on the wrong part and pass');

  // And the reading that is supposed to catch the last of those is the one
  // that does. Everything else reads the two mixes as nearly the same.
  const swapped = look('the room on the wrong part');
  if (swapped && swapped.worst !== 'room') {
    problems.push(`the reverb on the wrong part was caught by ${swapped.worst} rather than the room`);
  }

  problems.push(...noise);
  await page.close();
  return problems;
}
