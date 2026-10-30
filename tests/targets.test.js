// The delivery table, and the arithmetic hung off it.
//
// The figures themselves cannot be tested - they are somebody's published
// policy and a test would only assert that this file says what this file
// says. What is tested is the shape of the table, so a row cannot be added
// without a source and a claim, and all of the arithmetic downstream of it,
// which is where the teaching actually lives.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TARGETS, TARGETS_CHECKED, SOURCE_KINDS, targetOfId,
  ceilingAsked, deliveryOf, matchedAgainst,
} from '../src/lib/targets.js';

const spotify = targetOfId('spotify');
const youtube = targetOfId('youtube');
const r128 = targetOfId('r128');

/* --- the table ------------------------------------------------------------ */

test('every row says where it came from and what it claims', () => {
  for (const target of TARGETS) {
    assert.ok(target.id && target.name, 'a row needs an id and a name');
    assert.ok(Number.isFinite(target.lufs), `${target.id} has no target loudness`);
    assert.ok(Number.isFinite(target.peak), `${target.id} has no peak ceiling`);
    assert.ok(SOURCE_KINDS[target.from], `${target.id} claims an unknown kind of source`);
    assert.ok(target.says?.length > 20, `${target.id} does not say what it asks for`);
  }

  const ids = TARGETS.map((target) => target.id);
  assert.equal(new Set(ids).size, ids.length, 'two rows share an id');
});

test('the table says when it was last looked at', () => {
  assert.match(TARGETS_CHECKED, /^\d{4}-\d{2}-\d{2}$/);
  // A date that cannot be parsed is worse than none, because it looks like
  // one. The figures go stale; the format must not.
  assert.ok(Number.isFinite(Date.parse(TARGETS_CHECKED)));
});

test('the only first-hand rows are the two standards and the one publisher', () => {
  // Stated as a test rather than as a comment, because the temptation when
  // adding a row is to mark it `published` because the number is everywhere.
  // Everywhere is not a source.
  const firm = TARGETS.filter((target) => target.from !== 'secondary');
  assert.deepEqual(firm.map((target) => target.id).sort(), ['atsc', 'r128', 'spotify']);
});

/* --- what a service does to a master -------------------------------------- */

test('a loud master is turned down by exactly how loud it is', () => {
  const done = deliveryOf({ integrated: -8, truePeak: -0.5 }, spotify);
  assert.equal(done.gain, -6);
  assert.equal(done.played, -14);
  // And the peak comes down with it, which is why a master being turned down
  // cannot clip at playback however hot it was.
  assert.equal(done.peak, -6.5);
  assert.equal(done.short, 0);
});

test('a quiet master is turned up, and its peak goes up with it', () => {
  // The case the ceiling is actually about. Six decibels of lift on a master
  // that peaks at -1 dBTP puts the waveform five decibels over full scale,
  // which is why a service that turns things up has to limit as it does.
  const done = deliveryOf({ integrated: -20, truePeak: -1 }, spotify);
  assert.equal(done.gain, 6);
  assert.equal(done.played, -14);
  assert.equal(done.peak, 5);
});

test('a service that only turns down leaves a quiet master quiet', () => {
  const done = deliveryOf({ integrated: -20, truePeak: -1 }, youtube);
  assert.equal(done.gain, 0);
  assert.equal(done.played, -20);
  assert.equal(done.peak, -1);
  // And says how much is being given away by it, which is the number nobody
  // sees because nothing shows it.
  assert.equal(done.short, 6);

  // The same service still turns a loud one down.
  const loud = deliveryOf({ integrated: -9, truePeak: -1 }, youtube);
  assert.equal(loud.gain, -5);
  assert.equal(loud.short, 0);
});

test('mastering louder does not play louder, at any of them', () => {
  // The whole module in one assertion. Four masters of the same music, six
  // decibels apart end to end, all played at the same loudness.
  for (const target of TARGETS.filter((t) => t.turnsUp === true)) {
    const played = [-8, -11, -14, -17].map(
      (integrated) => deliveryOf({ integrated, truePeak: -1 }, target).played,
    );
    for (const at of played) assert.ok(Math.abs(at - target.lufs) < 1e-9);
  }
});

/* --- the ceilings --------------------------------------------------------- */

test('Spotify asks for more headroom from a master that is over its target', () => {
  assert.equal(ceilingAsked(spotify, -16), -1);
  assert.equal(ceilingAsked(spotify, -14), -1);
  assert.equal(ceilingAsked(spotify, -13.9), -2);
  assert.equal(ceilingAsked(spotify, -8), -2);

  // And `deliveryOf` applies the conditional rather than leaving it to the
  // caller, which is how a rule like this ends up honoured in one place and
  // not another.
  assert.equal(deliveryOf({ integrated: -8, truePeak: -1.5 }, spotify).asked, -2);
  assert.equal(deliveryOf({ integrated: -8, truePeak: -1.5 }, spotify).over, 0.5);
  assert.ok(!deliveryOf({ integrated: -8, truePeak: -1.5 }, spotify).meets);
  assert.ok(deliveryOf({ integrated: -8, truePeak: -2.5 }, spotify).meets);
});

test('a target with no tolerance is met by respecting its ceiling', () => {
  // A normalising service is going to move you to its number, so hitting it
  // is not something it asks of you. Its ceiling is.
  assert.ok(deliveryOf({ integrated: -22, truePeak: -1.2 }, spotify).meets);
  assert.ok(!deliveryOf({ integrated: -22, truePeak: -0.2 }, spotify).meets);
});

test('a standard with a tolerance wants the number as well', () => {
  assert.ok(deliveryOf({ integrated: -23.3, truePeak: -1.5 }, r128).meets);
  assert.ok(!deliveryOf({ integrated: -21, truePeak: -1.5 }, r128).meets);
  assert.ok(!deliveryOf({ integrated: -23, truePeak: -0.5 }, r128).meets);
  assert.equal(r128.tolerance, 0.5);
});

test('a reading that gated out is not reported as meeting anything', () => {
  const done = deliveryOf({ integrated: -Infinity, truePeak: -30 }, spotify);
  assert.equal(done.played, null);
  assert.equal(done.meets, false);
});

/* --- two masters, as a listener hears them -------------------------------- */

test('normalisation takes the loudness difference away and leaves the cost', () => {
  // The same music mastered twice: one squashed to -8 LUFS with 7 dB of
  // peak-to-loudness ratio left, one left at -14 with 13.
  const squashed = { integrated: -8, truePeak: -1 };
  const open = { integrated: -14, truePeak: -1 };

  const seen = matchedAgainst(squashed, open, spotify);
  assert.equal(seen.quieter, 0, 'both should play at the same loudness');
  assert.equal(seen.plr.mine, 7);
  assert.equal(seen.plr.theirs, 13);
  assert.equal(seen.lost, -6);
});

test('the ratio survives the gain, which is why it is the thing to compare', () => {
  // Normalisation is a gain and a gain moves the peak and the loudness
  // together, so the gap between them is exactly what a service cannot give
  // back. Held across every target so a future row cannot quietly break it.
  const master = { integrated: -6.4, truePeak: -0.3 };
  for (const target of TARGETS) {
    const done = deliveryOf(master, target);
    if (!Number.isFinite(done.played) || !Number.isFinite(done.peak)) continue;
    assert.ok(Math.abs((done.peak - done.played) - (master.truePeak - master.integrated)) < 1e-9,
      `${target.id} changed the peak-to-loudness ratio, which a gain cannot do`);
  }
});

test('at a service that will not turn things up, quiet still plays quiet', () => {
  const quiet = { integrated: -20, truePeak: -1 };
  const onTarget = { integrated: -14, truePeak: -1 };

  const seen = matchedAgainst(quiet, onTarget, youtube);
  assert.equal(seen.quieter, -6);
  // And it kept its dynamics, which is the trade going the other way: six
  // decibels quieter, six decibels more peak-to-loudness ratio.
  assert.equal(seen.lost, 6);
});

test('a delivery standard moves nothing, because it is not a normaliser', () => {
  // The first version treated anything that was not explicitly downward-only
  // as a normaliser, and reported a broadcast master as playing at -23 LUFS
  // whatever had been handed over. A specification is the other way round:
  // the file is expected to arrive on the number, and if it has not, that is
  // the finding rather than something the standard fixes.
  const master = { integrated: -21.7, truePeak: -6.2 };
  const done = deliveryOf(master, r128);

  assert.equal(done.gain, 0);
  assert.equal(done.played, -21.7);
  assert.equal(done.peak, -6.2);
  assert.ok(Math.abs(done.off - 1.3) < 1e-9, 'and it says how far off, with a sign');
  assert.ok(!done.meets);

  const onTarget = deliveryOf({ integrated: -23.2, truePeak: -2 }, r128);
  assert.equal(onTarget.gain, 0);
  assert.ok(onTarget.meets);
});

test('how far off target has a sign, so a verdict can say which way', () => {
  assert.ok(deliveryOf({ integrated: -20, truePeak: -2 }, r128).off > 0, 'too loud reads over');
  assert.ok(deliveryOf({ integrated: -26, truePeak: -2 }, r128).off < 0, 'too quiet reads under');
});
