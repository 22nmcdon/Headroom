// The seven ways a recording gets spoiled: that each one does something, that
// no two of them do the same thing, and that the quantiser is a quantiser.
//
// A browser check because all of it is arithmetic over real material, and
// the material is rendered by the engine. `tests/*.test.js` can hold that
// clipping clips a ramp; what it cannot hold is that seven artefacts on a
// drum loop are seven different sounds, which is the only thing that makes
// the drill a question rather than a coin toss with seven faces.
//
// It is also where the numbers in `lib/damage.js` and in the drill's own
// working come from, so they are re-measured every run rather than quoted
// from a session that has long since ended.

import { open } from './harness.mjs';

export const name = 'damage';

/**
 * How far apart two artefacts have to read to be two artefacts.
 *
 * A decibel of spectrum or a decibel of crest, which is deliberately low:
 * the claim being held is not that they are far apart but that none of them
 * is a second name for another. The closest pair measures 4.7 and 5.4.
 */
const APART = 1;

export async function check({ browser, at, say }) {
  const problems = [];
  const { page, noise } = await open(browser, at);

  const out = await page.evaluate(async () => {
    const { Engine } = await import('./src/core/audio.js');
    const { integrated, kWeight } = await import('./src/lib/loudness.js');
    const { DAMAGE, snrOf, bitsFrom, crushBits, loudestOf } = await import('./src/lib/damage.js');
    const { balanceReading } = await import('./src/analysis/balance.js');
    const { crestReading } = await import('./src/analysis/dynamics.js');
    const { distance } = await import('./src/gap.js');

    const engine = new Engine();
    engine.ensure();
    const loop = await engine.renderLoop('mix');
    const rate = loop.sampleRate;
    const clean = loop.getChannelData(0).slice(0, Math.round(rate * 2));

    // The sizes the drill's middle tier asks for.
    const how = {
      clip: { at: 0.5 },
      soft: { drive: 4 },
      bits: { bits: 8 },
      rate: { hold: 8 },
      hum: { hz: 50, at: -34 },
      click: { at: 1.1 },
      band: { from: 250, to: 5000 },
    };

    const lufs = (samples) => integrated([kWeight(samples, rate)], rate).lufs;

    const read = (samples) => ({
      balance: balanceReading([samples], rate, { source: 'd' }),
      crest: crestReading([samples], rate, { source: 'd' }),
    });
    const was = read(clean);

    const spoiled = {};
    const rows = [];
    for (const one of DAMAGE) {
      const got = one.apply(clean, rate, how[one.id]);
      spoiled[one.id] = read(got);
      rows.push({
        id: one.id,
        snr: snrOf(clean, got),
        balance: distance(spoiled[one.id].balance, was.balance).off,
        crest: distance(spoiled[one.id].crest, was.crest).off,
        // And that it did not quietly change how loud it is instead, which
        // would make the drill answerable by the fader.
        louder: lufs(got) - lufs(clean),
      });
    }

    const pairs = [];
    for (let i = 0; i < DAMAGE.length; i += 1) {
      for (let j = i + 1; j < DAMAGE.length; j += 1) {
        const a = spoiled[DAMAGE[i].id];
        const b = spoiled[DAMAGE[j].id];
        pairs.push({
          pair: `${DAMAGE[i].id} / ${DAMAGE[j].id}`,
          balance: distance(a.balance, b.balance).off,
          crest: distance(a.crest, b.crest).off,
        });
      }
    }

    // The quantiser against the formula, which only holds on a sine.
    const sine = new Float32Array(rate);
    for (let i = 0; i < rate; i += 1) sine[i] = Math.sin((2 * Math.PI * 997 * i) / rate);
    const peak = Math.max(1e-6, loudestOf(clean));
    const loud = Float32Array.from(clean, (x) => x / peak);

    const bits = [8, 12, 16].map((depth) => ({
      depth,
      ideal: 6.02 * depth + 1.76,
      sine: snrOf(sine, crushBits(sine, { bits: depth })),
      dithered: snrOf(sine, crushBits(sine, { bits: depth, dither: true })),
      music: snrOf(loud, crushBits(loud, { bits: depth })),
      back: bitsFrom(snrOf(sine, crushBits(sine, { bits: depth }))),
    }));

    /* --- and the seam: does the player actually hand both sides over? --- */

    const { HeatPlayer } = await import('./src/plugins/saturation/player.js');

    const sides = async (fault) => {
      const player = new HeatPlayer(engine, { source: 'mix' });
      player.setFault(fault);
      await player.prepare();
      const near = player.buffer.getChannelData(0);
      const far = (player.other ?? player.buffer).getChannelData(0);
      let worst = 0;
      for (let i = 0; i < Math.min(near.length, far.length); i += 1) {
        worst = Math.max(worst, Math.abs(near[i] - far[i]));
      }
      return { same: player.other === player.buffer, worst };
    };

    const seam = {
      named: await sides({ damage: 'hum', against: 'clean', hz: 50, at: -24 }),
      // A fault that is there to be fixed rather than named is on both sides,
      // which is the behaviour every other exercise relies on.
      fixed: await sides({ drive: 14, bias: 0.5 }),
      none: await sides(null),
    };

    return { rows, pairs, bits, peak, seam };
  });

  say('each artefact on the loop, against the same loop clean\n');
  say('  what      snr (dB)   spectrum    crest   loudness moved');
  for (const row of out.rows) {
    say(`  ${row.id.padEnd(9)} ${row.snr.toFixed(1).padStart(8)} ${row.balance.toFixed(2).padStart(10)}`
      + ` ${row.crest.toFixed(2).padStart(8)} ${row.louder.toFixed(2).padStart(12)}`);

    if (row.balance < APART && row.crest < APART) {
      problems.push(`${row.id} moved the spectrum ${row.balance.toFixed(2)} and the crest`
        + ` ${row.crest.toFixed(2)}, which is a fault nobody can hear`);
    }
    // Hum and a click add something, so they are allowed to be a shade
    // louder; the other five are level-matched on the way out and must be.
    const allowed = ['hum', 'click'].includes(row.id) ? 1.5 : 0.5;
    if (Math.abs(row.louder) > allowed) {
      problems.push(`${row.id} moved the loudness by ${row.louder.toFixed(2)} dB,`
        + ' so the drill could be answered by the fader');
    }
  }

  let closest = { pair: null, balance: Infinity, crest: Infinity };
  for (const pair of out.pairs) {
    if (pair.balance < APART && pair.crest < APART) {
      problems.push(`${pair.pair} are ${pair.balance.toFixed(2)} and ${pair.crest.toFixed(2)}`
        + ' apart, which is one artefact under two names');
    }
    if (pair.balance < closest.balance) closest = pair;
  }
  say(`\n  the closest of the twenty-one pairs: ${closest.pair},`
    + ` ${closest.balance.toFixed(2)} dB apart on the spectrum and ${closest.crest.toFixed(2)} on the crest`);

  say('\n  quantising, against 6.02b + 1.76\n');
  say('  bits      ideal     a sine   dithered   music, normalised   bits back');
  for (const row of out.bits) {
    say(`  ${String(row.depth).padStart(4)} ${row.ideal.toFixed(1).padStart(10)} ${row.sine.toFixed(1).padStart(10)}`
      + ` ${row.dithered.toFixed(1).padStart(10)} ${row.music.toFixed(1).padStart(19)} ${row.back.toFixed(2).padStart(11)}`);

    // The formula, on the signal the formula is about.
    if (Math.abs(row.sine - row.ideal) > 0.5) {
      problems.push(`${row.depth} bits of a sine read ${row.sine.toFixed(1)} dB against`
        + ` the ${row.ideal.toFixed(1)} the arithmetic says`);
    }
    // Triangular dither costs 4.77 dB and buys a floor that does not follow
    // the music. If it ever costs nothing, it is not being applied.
    const cost = row.sine - row.dithered;
    if (cost < 3.5 || cost > 6) {
      problems.push(`dither cost ${cost.toFixed(2)} dB at ${row.depth} bits, against the 4.77 it should`);
    }
    // And music is worse than a sine by its own crest factor, which is the
    // whole reason `bitsFrom` is only honest about a sine.
    if (row.music > row.sine - 6) {
      problems.push(`${row.depth} bits of music read ${row.music.toFixed(1)}, which is`
        + ' suspiciously close to the sine it cannot be as good as');
    }
  }
  say(`\n  the loop peaks at ${out.peak.toFixed(3)}`);

  say('\n  the two sides of the A/B\n');
  for (const [what, side] of Object.entries(out.seam)) {
    say(`  ${what.padEnd(8)} ${side.same ? 'one buffer' : 'two buffers'},`
      + ` furthest apart by ${side.worst.toFixed(4)}`);
  }

  // A round that asks you to name damage has to let you hear the material
  // without it; a round that asks you to fix something must not.
  if (out.seam.named.same || out.seam.named.worst < 1e-3) {
    problems.push('a round that asks what was done to the loop played the same thing on both sides');
  }
  if (!out.seam.fixed.same) problems.push('a fault to be fixed could be switched off with the A/B');
  if (!out.seam.none.same) problems.push('a round with no fault at all played two different things');

  problems.push(...noise);
  await page.close();
  return problems;
}
