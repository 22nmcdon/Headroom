// A fader that moves while the music is playing: that it moves, that the
// reading sees it, and that a round about it can be won and cannot be
// arrived at.
//
// A browser check because a ride only exists when something is rendered. It
// is also the only thing in this app that is booked rather than set - the
// gain steps go into the same scheduling window the notes do - so "the
// render has the ride on it" is a claim about two subsystems meeting, which
// is exactly the kind that passes every unit test and produces silence.
//
// The first table is the one that decided the shape of the exercise, and it
// is kept here because it is the argument for reading a ride on the parts
// rather than on the master.

import { open } from './harness.mjs';

export const name = 'ride';

export async function check({ browser, at, say }) {
  const problems = [];
  const { page, noise } = await open(browser, at, { view: 'mix' });

  const out = await page.evaluate(async () => {
    const { mixBrief, flatMix } = await import('./src/mix/brief.js');
    const { pieceOf, dress } = await import('./src/mix/piece.js');
    const { readMix, renderMix, channelsIn, RATE } = await import('./src/mix/render.js');
    const { renderStems } = await import('./src/sketch/stems.js');
    const { markMix, toleranceFor, mixAdvice } = await import('./src/mix/score.js');
    const { barsOf, ridesOf, rideAt } = await import('./src/mix/ride.js');

    const piece = pieceOf('short-night');
    const flat = flatMix();

    /* --- does a ride reach the audio at all? ------------------------------ */

    const shapeOf = async (rides) => {
      const stems = await renderStems(dress(piece, flat), 0, { rate: RATE, rides });
      return ridesOf(stems, RATE);
    };

    const still = await shapeOf({});
    const rows = [];
    for (const depth of [0, 4, 6, 9, -6]) {
      const shapes = await shapeOf(depth ? { keys: depth } : {});
      rows.push({
        depth,
        keys: shapes.keys.map((level, bar) => level - still.keys[bar]),
        // Nothing else should have moved: a ride is one fader.
        others: Math.max(...['kit', 'bass', 'pad'].map((id) => Math.max(
          ...shapes[id].map((level, bar) => Math.abs(level - still[id][bar])),
        ))),
      });
    }

    /* --- and what the master makes of the same thing ---------------------- */

    const masterShape = async (rides) => {
      const buffer = await renderMix(dress(piece, flat), { rate: RATE, rides });
      return barsOf(channelsIn(buffer), RATE);
    };
    const masterStill = await masterShape({});
    const masterSwell = await masterShape({ keys: 6 });
    const onMaster = Math.max(...masterSwell.map((level, bar) =>
      Math.abs(level - masterStill[bar])));

    /* --- the round ------------------------------------------------------- */

    const brief = mixBrief('swell', 0x51ab);
    const answer = brief.rides;
    const theirs = await readMix(dress(piece, brief.target), 'answer', { rides: answer });
    const allowed = toleranceFor('swell');

    const tryIt = async (what, rides) => {
      const marked = markMix(
        await readMix(dress(piece, brief.target), 'yours', { rides }), theirs, 'swell',
      );
      return {
        what,
        ride: marked.readings.find((one) => one.kind === 'ride').off,
        worst: marked.worst.kind,
        solved: marked.solved,
        said: mixAdvice(marked),
      };
    };

    const [first] = Object.keys(answer);
    const nudge = (by) => ({ ...answer, [first]: answer[first] + by });

    const tries = [
      await tryIt('nothing moving, which is where it starts', {}),
      await tryIt('the answer', answer),
      await tryIt('one swell out by a step', nudge(0.5)),
      await tryIt('one swell out by a decibel', nudge(1)),
      await tryIt('one swell out by two', nudge(2)),
      await tryIt('both swells the same way', { ...answer, [first]: -answer[first] }),
    ];

    return {
      rows, onMaster, tries, allowed: allowed.ride, answer,
      expected: [0, 1, 2, 3].map((bar) => rideAt(6, (bar + 0.5) / 4)),
    };
  });

  say('a six decibel swell on one part, read on that part and on the master\n');
  say('  swell     bar 1   bar 2   bar 3   bar 4    the other three');
  for (const row of out.rows) {
    say(`  ${String(row.depth).padStart(5)}  `
      + row.keys.map((v) => v.toFixed(2).padStart(7)).join('')
      + `  ${row.others.toFixed(3).padStart(15)}`);
    if (Math.abs(row.depth) >= 4 && Math.max(...row.keys.map(Math.abs)) < 1) {
      problems.push(`a swell of ${row.depth} dB moved that part's own bars by`
        + ` ${Math.max(...row.keys.map(Math.abs)).toFixed(2)}, which is nothing`);
    }
    if (row.others > 0.01) {
      problems.push(`a ride on one part moved another by ${row.others.toFixed(3)} dB`);
    }
  }
  say(`\n  what six decibels should put in the outside bars: `
    + out.expected.map((v) => v.toFixed(2)).join(', '));
  say(`  the same swell on the master, at its worst: ${out.onMaster.toFixed(2)} dB`);

  // The argument for reading this on the parts. If the master ever saw a
  // swell as clearly as the part does, the reading should move.
  if (out.onMaster > 1) {
    problems.push(`the master sees a six decibel swell as ${out.onMaster.toFixed(2)} dB,`
      + ' which is large enough that reading it on the parts wants re-arguing');
  }

  say(`\n  a round, with ${out.allowed} allowed on the ride`);
  say(`  the answer is ${Object.entries(out.answer).map(([id, db]) => `${id} ${db}`).join(', ')}\n`);
  say('  what                                      ride   worst     solved');
  for (const row of out.tries) {
    say(`  ${row.what.padEnd(40)} ${row.ride.toFixed(2).padStart(6)}   ${row.worst.padEnd(8)} ${row.solved ? 'yes' : 'no'}`);
  }
  say('');
  for (const row of out.tries.filter((one) => !one.solved).slice(0, 2)) say(`  "${row.said}"`);

  const look = (what) => out.tries.find((row) => row.what === what);
  const must = (what, want, why) => {
    const row = look(what);
    if (!row) { problems.push(`"${what}" was not measured`); return; }
    if (row.solved !== want) problems.push(`${why} (ride at ${row.ride.toFixed(2)})`);
  };

  must('the answer', true, 'the answer did not pass its own round');
  must('nothing moving, which is where it starts', false, 'the round arrives already solved');
  must('one swell out by a step', true, 'half a decibel of slip failed the round');
  must('one swell out by two', false, 'two decibels of swell passed');
  must('both swells the same way', false, 'two parts swelling together passed for one up and one down');

  problems.push(...noise);
  await page.close();
  return problems;
}
