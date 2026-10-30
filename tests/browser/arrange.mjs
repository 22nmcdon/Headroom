// What is on it: that the four arrangements are four different sounds, that
// they come back at the same level, and that naming one is a round you can
// play.
//
// A browser check because all of it is a claim about rendered audio. Two
// nonlinear effects not commuting is arithmetic nobody can do on paper, and
// the gain staging that makes the four comparable was measured rather than
// derived - the compressor's makeup and the saturator's trim are numbers in
// `src/mix/chain.js` that came off a render, and a change to either plugin
// would quietly make them wrong. This re-measures both every run.
//
// The last part drives the page, because a round that cannot be answered is
// not a round: a chip that does not register, a submit that stays disabled,
// or a guess that is never recorded would all leave the four arrangements
// perfectly measured and the exercise unplayable.

import { open } from './harness.mjs';

export const name = 'arrange';

/**
 * How far apart the four have to be, and how level.
 *
 * The first two are the measured floor of what "plainly different" means
 * here: the closest pair of the six reads 1.12 dB on crest and 4.14 on
 * balance on short-night, so anything that drops the closest pair under half a
 * decibel of dynamics or one of tone has stopped being four arrangements.
 *
 * The third is the gain staging. 2.5 dB of spread between the loudest
 * arrangement and the quietest is what the measured trims leave behind on
 * these two pieces, and the point of holding it is that the round must not be
 * answerable by loudness - which it would be at the 19.6 dB the plugins' own
 * defaults give.
 */
const APART = { crest: 0.5, balance: 1.0 };
const LEVEL = 2.5;

export async function check({ browser, at, say }) {
  const problems = [];
  const { page, noise } = await open(browser, at, { view: 'mix' });
  problems.push(...noise);

  const out = await page.evaluate(async () => {
    const { flatMix } = await import('./src/mix/brief.js');
    const { pieceOf, dress, PIECE_IDS } = await import('./src/mix/piece.js');
    const { RATE } = await import('./src/mix/render.js');
    const { renderStems } = await import('./src/sketch/stems.js');
    const { CHAIN_ORDERS, CHAIN_ON, chainMix } = await import('./src/mix/chain.js');
    const { crestReading } = await import('./src/analysis/dynamics.js');
    const { balanceReading } = await import('./src/analysis/balance.js');
    const { integrated, kWeight } = await import('./src/lib/loudness.js');
    const { distance } = await import('./src/gap.js');

    const lufs = (channels) => integrated(
      channels.map((channel) => kWeight(channel, RATE)), RATE,
    ).lufs;

    const tapOf = async (piece, mix) => {
      const stems = await renderStems(dress(piece, mix), 0, { rate: RATE });
      return stems.find((stem) => stem.kind === 'track' && stem.id === CHAIN_ON).channels;
    };

    const pieces = [];
    for (const id of PIECE_IDS) {
      const piece = pieceOf(id);
      const plain = await tapOf(piece, flatMix());
      const at = lufs(plain);

      const each = [];
      for (const how of CHAIN_ORDERS) {
        const channels = await tapOf(piece, chainMix(flatMix(), how.id));
        const level = lufs(channels);
        // Level-matched before reading, because a level difference is not a
        // difference anybody is being asked to hear - and the whole point of
        // the trims is that there should not be one left.
        const lift = 10 ** ((at - level) / 20);
        const matched = channels.map((channel) => Float32Array.from(channel, (x) => x * lift));
        each.push({
          id: how.id,
          symbol: how.symbol,
          level: level - at,
          crest: crestReading(matched, RATE, { source: 'c' }),
          balance: balanceReading(matched, RATE, { source: 'c' }),
        });
      }

      const pairs = [];
      for (let i = 0; i < each.length; i += 1) {
        for (let j = i + 1; j < each.length; j += 1) {
          pairs.push({
            pair: `${each[i].symbol} / ${each[j].symbol}`,
            crest: distance(each[i].crest, each[j].crest).off,
            balance: distance(each[i].balance, each[j].balance).off,
          });
        }
      }

      pieces.push({
        piece: id,
        levels: each.map(({ symbol, level }) => ({ symbol, level })),
        spread: Math.max(...each.map((one) => one.level)) - Math.min(...each.map((one) => one.level)),
        pairs,
      });
    }

    return pieces;
  });

  for (const row of out) {
    say(`${row.piece}: the four arrangements on the part that carries them\n`);
    say('  arrangement     against plain');
    for (const one of row.levels) {
      say(`  ${one.symbol.padEnd(14)} ${one.level.toFixed(2).padStart(13)} dB`);
    }
    say(`  spread: ${row.spread.toFixed(2)} dB, against ${LEVEL} allowed\n`);
    say('  pair                          crest   balance');
    for (const pair of row.pairs) {
      say(`  ${pair.pair.padEnd(28)} ${pair.crest.toFixed(2).padStart(6)} ${pair.balance.toFixed(2).padStart(9)}`);
    }
    say('');

    if (row.spread > LEVEL) {
      problems.push(`${row.piece}: the four arrangements are ${row.spread.toFixed(2)} dB apart,`
        + ' so the round can be answered by loudness');
    }
    for (const pair of row.pairs) {
      if (pair.crest < APART.crest && pair.balance < APART.balance) {
        problems.push(`${row.piece}: ${pair.pair} are ${pair.crest.toFixed(2)} dB apart on crest`
          + ` and ${pair.balance.toFixed(2)} on balance, which is the same sound twice`);
      }
    }
  }

  /* --- and the round itself ------------------------------------------------ */

  await page.selectOption('[data-tier]', 'order');
  await page.waitForTimeout(350);

  const played = await page.evaluate(async () => {
    const pick = document.querySelector('[data-picker]');
    const chips = [...pick.querySelectorAll('[data-option]')];
    const submit = document.querySelector('[data-submit]');

    const before = {
      chips: chips.length,
      submitAt: submit.textContent.trim(),
      disabled: submit.disabled,
      strips: !document.querySelector('[data-strips]').hidden,
      sides: [...document.querySelectorAll('[data-ab]')].map((one) => one.textContent.trim()),
    };

    chips[0].click();
    await new Promise((ok) => setTimeout(ok, 50));
    const picked = {
      pressed: chips[0].getAttribute('aria-pressed'),
      disabled: submit.disabled,
    };

    submit.click();
    await new Promise((ok) => setTimeout(ok, 150));

    const said = {
      result: !document.querySelector('[data-result]').hidden,
      advice: document.querySelector('[data-advice]').textContent.trim(),
      submitAt: submit.textContent.trim(),
      disabled: submit.disabled,
      // A second press must change nothing: one guess is the whole point.
      marks: document.querySelectorAll('[data-mark]').length,
    };

    submit.click();
    await new Promise((ok) => setTimeout(ok, 150));
    said.marksAfterSecond = document.querySelectorAll('[data-mark]').length;

    return { before, picked, said };
  });

  say('  playing it\n');
  say(`  chips: ${played.before.chips}`);
  say(`  the desk: ${played.before.strips ? 'shown' : 'hidden'}`);
  say(`  the switch says: ${played.before.sides.join(' / ')}`);
  say(`  the button says: "${played.before.submitAt}", ${played.before.disabled ? 'disabled' : 'live'}`);
  say(`  after a chip: pressed ${played.picked.pressed}, button ${played.picked.disabled ? 'disabled' : 'live'}`);
  say(`  after saying it: "${played.said.submitAt}", ${played.said.marks} mark shown`);
  say(`  it said: "${played.said.advice}"`);

  if (played.before.chips !== 4) problems.push(`the round offered ${played.before.chips} chips, not four`);
  if (played.before.strips) problems.push('the desk is shown on a round that cannot be answered with it');
  if (!played.before.disabled) problems.push('the round could be answered before anything was picked');
  if (played.picked.pressed !== 'true') problems.push('a chip did not register as picked');
  if (played.picked.disabled) problems.push('picking a chip left the round unanswerable');
  if (!played.said.result) problems.push('saying it showed no result');
  if (played.said.advice.length < 20) problems.push('saying it said nothing worth reading');
  if (!played.said.disabled) problems.push('the round took a second guess, which is four tries at four answers');
  if (played.said.marksAfterSecond !== played.said.marks) problems.push('a second press changed the result');

  await page.close();
  return problems;
}
