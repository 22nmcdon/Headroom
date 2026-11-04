// The meters, in the part that is arithmetic.
//
// `lib/meter.js` had no tests at all. The peak meter came first, because it
// was new and because getting it wrong is how a take comes back ruined
// without anybody being told - and the VU's needle was named as a gap rather
// than quietly left. This is that gap closed.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  peakAt, PEAK_FLOOR, PEAK_HOT, PEAK_FALL, fallenTo, clockOf,
  vuAngle, vuFace, aimVu, VU_SWEEP, VU_DEEPEST, VU_HEAVY,
} from '../src/lib/meter.js';

/* --- a peak meter, which is a different instrument from a VU ------------- */

// A VU reads an average and a peak meter reads the worst sample, and the
// recording panel needs the second: what ruins a take is one transient over
// the ceiling, which a VU is built not to show.

test('a peak meter runs from its floor to full scale', () => {
  assert.equal(peakAt(0), 1, 'full scale fills it');
  assert.equal(peakAt(PEAK_FLOOR), 0, 'the floor is empty');
  assert.ok(Math.abs(peakAt(PEAK_FLOOR / 2) - 0.5) < 1e-9, 'and it is linear in decibels');
});

test('a peak meter does not run off either end', () => {
  // Over is still full, because a meter that drew past its own box would be
  // a meter saying something the box cannot mean.
  assert.equal(peakAt(6), 1);
  assert.equal(peakAt(-500), 0);
  assert.equal(peakAt(-Infinity), 0, 'silence reads as nothing, not as NaN');
});

test('a peak meter says where the warnings sit', () => {
  // The two that matter: close to the ceiling, and at it.
  assert.ok(PEAK_HOT < 0 && PEAK_HOT > -12, 'hot is within a few decibels of the top');
  assert.ok(peakAt(PEAK_HOT) > 0.8, 'and it is near the end of the meter');
});

test('a clock while recording counts the way a clock does', () => {
  // Not "2 seconds". `saidLength` is the right way to report a finished take
  // and the wrong way to show one running - a number that changes every
  // second wants a shape that does not change with it.
  assert.equal(clockOf(0), '0:00');
  assert.equal(clockOf(2), '0:02');
  assert.equal(clockOf(59), '0:59');
  assert.equal(clockOf(60), '1:00');
  assert.equal(clockOf(61), '1:01');
  assert.equal(clockOf(600), '10:00');
  assert.equal(clockOf(3599), '59:59');
});

test('a clock does not go backwards or come back broken', () => {
  assert.equal(clockOf(-5), '0:00');
  assert.equal(clockOf(NaN), '0:00');
  assert.equal(clockOf(Infinity), '0:00');
});

test('a peak meter falls rather than snapping to nothing', () => {
  // Material with gaps in it - which is most of what anybody records - drives
  // the instantaneous peak to zero between transients. A bar that followed
  // that exactly would flicker at the floor and read as no signal at all.
  // Measured against the fall rate, in decibels a second.
  assert.ok(PEAK_FALL > 0, 'it falls');
  assert.equal(fallenTo(-6, -6, 1), -6, 'a level that holds, holds');
  assert.equal(fallenTo(-60, 0, 1), -PEAK_FALL, 'one second of silence is one second of fall');
  assert.equal(fallenTo(-3, -40, 0.5), -3, 'and a new peak takes it straight back up');
  // Never below the floor, so a long silence does not wander off the scale.
  assert.equal(fallenTo(-Infinity, PEAK_FLOOR, 10), PEAK_FLOOR);
});

/* --- and the VU, which is the other instrument in that file -------------- */

// A gain reduction dial: the needle rests at no reduction and swings across
// as the compressor pulls. Uncovered until now, and the arithmetic is the
// part that would go wrong silently - a needle pointing at the wrong number
// looks exactly like a needle pointing at the right one.

test('the needle rests at no reduction and swings right across', () => {
  // Half the sweep each side of straight up, so the two ends are the sweep
  // apart and nothing is drawn outside the face.
  assert.equal(vuAngle(0), VU_SWEEP / 2);
  assert.equal(vuAngle(VU_DEEPEST), -VU_SWEEP / 2);
  assert.equal(vuAngle(VU_DEEPEST / 2), 0, 'half the reduction is straight up');
});

test('the needle does not leave the face, whatever it is handed', () => {
  // A compressor asked for more than the dial shows still has a needle, and
  // a reading of nothing is not a reading of plus something.
  assert.equal(vuAngle(-100), vuAngle(VU_DEEPEST), 'past the end, pinned at the end');
  assert.equal(vuAngle(6), vuAngle(0), 'and gain is not reduction');
  assert.equal(vuAngle(NaN), vuAngle(0), 'nor is nothing');
  assert.equal(vuAngle(undefined), vuAngle(0));
});

test('a deeper dial spreads the same sweep over more decibels', () => {
  // The sweep is the face; `deepest` is what the face is labelled with.
  assert.equal(vuAngle(-20, -40), 0, 'half of forty is straight up');
  assert.equal(vuAngle(-40, -40), -VU_SWEEP / 2);
  assert.ok(vuAngle(-10, -40) > vuAngle(-10, -20),
    'ten decibels is a smaller swing on a dial that goes deeper');
});

test('the face carries its numbers, its needle and its red', () => {
  const svg = vuFace();
  assert.match(svg, /<svg /);
  assert.match(svg, /data-needle/, 'or `aimVu` has nothing to point');
  // Five numbers, because at this sweep a sixth lands on its neighbour.
  assert.equal((svg.match(/class="vu-mark"/g) ?? []).length, 5);
  for (const db of [20, 12, 6, 3, 0]) {
    assert.ok(svg.includes(`>${db}</text>`), `the dial is labelled ${db}`);
  }
  // The heavy arc, which is the whole reason the scale is worth printing.
  assert.match(svg, /#a4553f/, 'past VU_HEAVY the scale turns red');
  assert.ok(VU_HEAVY > VU_DEEPEST && VU_HEAVY < 0);
});

test('the face is a picture and says so', () => {
  // It is a drawing of a number that is also printed beside it, so a screen
  // reader reading the whole dial out is noise.
  assert.match(vuFace(), /aria-hidden="true"/);
});

test('a legend goes on only when there is one', () => {
  assert.doesNotMatch(vuFace(), /vu-legend/);
  assert.match(vuFace({ legend: 'Reduction' }), /vu-legend">Reduction/);
});

test('the numbers climb across the face rather than doubling back', () => {
  // Drawn from `vuAngle`, so an off-by-one in the sign would put 20 next to
  // 12 on the wrong side and still produce a plausible-looking dial.
  const xs = [...vuFace().matchAll(/class="vu-mark" x="([-\d.]+)"/g)].map((m) => Number(m[1]));
  assert.equal(xs.length, 5);
  for (let i = 1; i < xs.length; i += 1) {
    assert.ok(xs[i] > xs[i - 1], `mark ${i} sits right of the one before it`);
  }
});

test('pointing the needle turns it about the pivot, and only it', () => {
  const turns = [];
  const dial = {
    querySelector: () => ({ setAttribute: (name, value) => turns.push([name, value]) }),
  };

  aimVu(dial, 0);
  assert.match(turns[0][1], /^rotate\(0\.00 /, 'no reduction is no turn');

  aimVu(dial, VU_DEEPEST);
  assert.match(turns[1][1], new RegExp(`^rotate\\(-${VU_SWEEP.toFixed(2)} `),
    'and the deepest is the whole sweep');
  assert.equal(turns[1][0], 'transform');
});

test('pointing a dial that is not there does nothing rather than throwing', () => {
  // Which is every frame between a face being asked for and the browser
  // having laid it out.
  assert.doesNotThrow(() => aimVu(null, -6));
  assert.doesNotThrow(() => aimVu({ querySelector: () => null }, -6));
});
