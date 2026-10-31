// The mix exercise, in the parts that do not need an audio context.
//
// The material, the target mix and the marking are all arithmetic; the render
// and the readings over it are measured in the browser, with the numbers
// written into `score.js` beside the tolerances they set.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  pieceOf, dress, PIECES, PIECE_IDS, STEMS, STEM_IDS, STEM_FLAT, HOW_LONG,
} from '../src/mix/piece.js';
import {
  mixBrief, flatMix, movesIn, gainFor, dbOf, STEPS, MOVABLE, ANCHOR,
  MIX_TIERS, MIX_TIER_IDS, ROOM_FOR, LEAST, TONE_BANDS, TONE_LEAST, toneIn,
  TONED, CARVES, CARVE_LEAST, colouring, DEPTHS, AT_A_DISTANCE, AIRY, TRIM,
  SWELL_LEAST,
} from '../src/mix/brief.js';
import { EQ_REST } from '../src/sketch/knobs.js';
import {
  markMix, markReading, mixAdvice, howClose, MIX_TOLERANCE, toleranceFor,
  READING_NAMES, HIT, NEAR, MISS,
} from '../src/mix/score.js';
import { placementOf, placementGap, placementReading, MOST_OFF_CENTRE } from '../src/mix/placement.js';
import { levelsReading, partsOut } from '../src/mix/levels.js';
import {
  REGISTERS, REGISTER_IDS, registerOf, shareGap, sharesOut, SHARE_AXIS, SHARE_FLOOR,
} from '../src/mix/share.js';
import { roomGap, roomOf, inARoom, ROOM_AXIS, ROOM_FLOOR } from '../src/mix/room.js';
import {
  CHAIN_ORDERS, CHAIN_IDS, CHAIN_ON, chainMix, arrangementOf,
} from '../src/mix/chain.js';
import { MIX_FAULTS, MIX_FAULT_IDS, HOW_MANY } from '../src/mix/faults.js';
import { rideAt, rideGain, rideGap, RIDE_AXIS, RIDE_BARS } from '../src/mix/ride.js';
import {
  sumOf, mixLoudness, staleFor, matchTrim, anchorOf, gainOfTrim, MATCH_LIMIT,
  LISTEN_MODES, LISTEN_IDS, SMALL_SPEAKER,
} from '../src/mix/monitor.js';
import { distance } from '../src/gap.js';
import { MARKED } from '../src/mix/render.js';
import { barTicks, clipAt } from '../src/sketch/project.js';
import { STEREO_BANDS } from '../src/plugins/stereo/field.js';
import { THIRDS } from '../src/analysis/balance.js';
import { toStep } from '../src/learn/work/scoring.js';

/* --- the material ---------------------------------------------------------- */

test('every piece is four stems with something in all of them', () => {
  for (const id of PIECE_IDS) {
    const piece = pieceOf(id);
    assert.equal(piece.tracks.length, STEMS.length, id);
    assert.equal(piece.name, PIECES[id].label);

    piece.tracks.forEach((track, index) => {
      const clip = clipAt(piece, index, 0);
      assert.ok(clip, `${id}: ${track.name} has no clip`);
      assert.ok(clip.notes.length > 0, `${id}: ${track.name} is empty`);
      assert.equal(clip.length, barTicks(piece) * HOW_LONG);
      assert.equal(track.instrument, STEMS[index].instrument);
    });
  }
});

test('a piece arrives flat, so the mix on it is the only thing being heard', () => {
  for (const track of pieceOf('short-night').tracks) {
    assert.equal(track.gain, STEM_FLAT.gain);
    assert.equal(track.pan, 0);
    assert.equal(track.send, 0);
    assert.deepEqual(track.inserts, []);
  }
});

test('no note in any piece runs past the end of its clip', () => {
  for (const id of PIECE_IDS) {
    const piece = pieceOf(id);
    for (let track = 0; track < piece.tracks.length; track += 1) {
      const clip = clipAt(piece, track, 0);
      for (const note of clip.notes) {
        assert.ok(note.start < clip.length, `${id}: a note starts past the end`);
        assert.ok(note.pitch >= 0 && note.pitch <= 127);
      }
    }
  }
});

test('dressing a piece changes the mix and not the notes', () => {
  const piece = pieceOf('short-night');
  const dressed = dress(piece, { bass: { ...STEM_FLAT, gain: 0.5, pan: -0.4 } });

  assert.equal(dressed.tracks[1].gain, 0.5);
  assert.equal(dressed.tracks[1].pan, -0.4);
  assert.deepEqual(clipAt(dressed, 1, 0).notes, clipAt(piece, 1, 0).notes);
  // And the one it was made from is untouched.
  assert.equal(piece.tracks[1].gain, STEM_FLAT.gain);
});

test('dressing twice from the same piece gives two independent mixes', () => {
  const piece = pieceOf('late-room');
  const loud = dress(piece, { pad: { ...STEM_FLAT, gain: 1.2 } });
  const quiet = dress(piece, { pad: { ...STEM_FLAT, gain: 0.2 } });
  assert.equal(loud.tracks[3].gain, 1.2);
  assert.equal(quiet.tracks[3].gain, 0.2);
});

/* --- the brief ------------------------------------------------------------- */

test('a brief is a function of its seed', () => {
  const a = mixBrief('medium', 4242);
  const b = mixBrief('medium', 4242);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.target, mixBrief('medium', 4243).target);
});

test('the drums never move, at any tier or seed', () => {
  for (const tier of MIX_TIER_IDS) {
    for (let seed = 0; seed < 60; seed += 1) {
      const { target } = mixBrief(tier, seed * 977);
      assert.equal(target[ANCHOR].gain, STEM_FLAT.gain, `${tier}/${seed}`);
      assert.equal(target[ANCHOR].pan, 0);
      assert.equal(target[ANCHOR].send, 0);
    }
  }
});

test('each tier moves what it says it moves, and nothing else', () => {
  for (const tier of MIX_TIER_IDS) {
    const spec = MIX_TIERS[tier];
    // A distance round sets its faders and sends from DEPTHS rather than from
    // the ranges `moves` and `sends` drive, so those counts say nothing about
    // it. What it does move is held two tests down.
    if (spec.depths) continue;
    let worstPan = 0;
    let worstSend = 0;

    for (let seed = 0; seed < 60; seed += 1) {
      const { target } = mixBrief(tier, seed * 131);
      for (const id of MOVABLE) {
        worstPan = Math.max(worstPan, Math.abs(target[id].pan));
        worstSend = Math.max(worstSend, target[id].send);
      }
    }

    if (!spec.pans) assert.equal(worstPan, 0, `${tier} panned something`);
    else assert.ok(worstPan > 0, `${tier} panned nothing in sixty rounds`);

    if (!spec.sends) assert.equal(worstSend, 0, `${tier} sent something to the room`);
    else assert.ok(worstSend > 0, `${tier} sent nothing in sixty rounds`);
  }
});

test('nothing goes further off centre than its stem is allowed', () => {
  for (let seed = 0; seed < 80; seed += 1) {
    const { target } = mixBrief('hard', seed * 7919);
    for (const id of STEM_IDS) {
      assert.ok(Math.abs(target[id].pan) <= ROOM_FOR[id] + 1e-9, `${id} at ${target[id].pan}`);
      assert.ok(target[id].send <= ROOM_FOR[id] + 1e-9, `${id} sends ${target[id].send}`);
    }
  }
});

test('every move the answer makes is one the controls can make', () => {
  for (const tier of MIX_TIER_IDS) {
    for (let seed = 0; seed < 40; seed += 1) {
      for (const stem of movesIn(mixBrief(tier, seed * 31).target)) {
        assert.equal(stem.db, toStep(stem.db, STEPS.gain), `${stem.name} at ${stem.db} dB`);
        assert.equal(stem.pan, toStep(stem.pan, STEPS.pan));
        assert.equal(stem.send, toStep(stem.send, STEPS.send));
      }
    }
  }
});

test('a move is never too small to be a move', () => {
  for (const tier of MIX_TIER_IDS) {
    // Except on a distance round, where what has to be worth hearing is the
    // step between two distances and not the step from flat. The table is
    // three decibels apart at the fader, which reads 2.25 against a tolerance
    // of 0.6 - the floor here is about a single move being inside its own
    // tolerance, and a distance is never a single move.
    if (MIX_TIERS[tier].depths) continue;
    for (let seed = 0; seed < 60; seed += 1) {
      for (const stem of movesIn(mixBrief(tier, seed * 17).target)) {
        assert.ok(stem.db === 0 || Math.abs(stem.db) >= LEAST, `${stem.name} moved by ${stem.db} dB`);
      }
    }
  }
});

test('decibels and gains are the same thing said twice', () => {
  for (const db of [-12, -6, -1.5, 0, 3, 9]) {
    assert.ok(Math.abs(dbOf(gainFor(db)) - db) < 1e-9);
  }
  assert.equal(gainFor(0), STEM_FLAT.gain);
});

test('a round starts flat, which is not the answer', () => {
  const flat = flatMix();
  assert.deepEqual(Object.keys(flat).sort(), [...STEM_IDS].sort());
  for (const id of STEM_IDS) assert.deepEqual(flat[id], STEM_FLAT);
  assert.notDeepEqual(flat, mixBrief('medium', 99).target);
});

/* --- where things sit ------------------------------------------------------ */

const tone = (hz, rate, seconds, gain) => {
  const out = new Float32Array(Math.round(rate * seconds));
  for (let i = 0; i < out.length; i += 1) out[i] = gain * Math.sin((2 * Math.PI * hz * i) / rate);
  return out;
};

test('a centred thing reads centred, and a panned one reads where it is', () => {
  const rate = 44100;
  const centre = placementOf(tone(1000, rate, 0.5, 0.5), tone(1000, rate, 0.5, 0.5), rate);
  assert.ok(Math.abs(centre.whole) < 0.01);
  assert.ok(Math.abs(centre.bands.mid) < 0.05);

  // Six decibels more on the left is six decibels to the left.
  const left = placementOf(tone(1000, rate, 0.5, 0.5), tone(1000, rate, 0.5, 0.25), rate);
  assert.ok(Math.abs(left.whole - 6.02) < 0.05, `read ${left.whole}`);
  assert.ok(left.bands.mid > 5.5);
});

test('placement sees a band move without the rest of the mix moving', () => {
  const rate = 44100;
  // A low tone dead centre and a high one off to one side.
  const bassL = tone(120, rate, 0.5, 0.5);
  const bassR = tone(120, rate, 0.5, 0.5);
  const addTo = (into, from) => into.map((value, i) => value + from[i]);

  const mine = placementOf(
    addTo(bassL, tone(4000, rate, 0.5, 0.4)),
    addTo(bassR, tone(4000, rate, 0.5, 0.1)),
    rate,
  );
  const theirs = placementOf(
    addTo(bassL, tone(4000, rate, 0.5, 0.1)),
    addTo(bassR, tone(4000, rate, 0.5, 0.4)),
    rate,
  );

  const gap = placementGap({ values: mine }, { values: theirs });
  assert.equal(gap.where, '4k Hz');
  assert.ok(gap.off > 20, `read ${gap.off}`);
  assert.equal(gap.detail.side, 'left');
  // The low band did not move, so it is not the one named.
  assert.ok(Math.abs(mine.bands.low - theirs.bands.low) < 0.5);
});

test('a reading of silence is a number rather than an infinity', () => {
  const quiet = new Float32Array(4410);
  const read = placementOf(quiet, quiet, 44100);
  assert.ok(Number.isFinite(read.whole));
  for (const value of Object.values(read.bands)) assert.ok(Number.isFinite(value));

  const only = placementOf(tone(1000, 44100, 0.1, 0.5), quiet, 44100);
  assert.equal(only.whole, MOST_OFF_CENTRE);
});

test('a placement reading comes in the envelope everything else does', () => {
  const rate = 44100;
  const read = placementReading([tone(1000, rate, 0.2, 0.5), tone(1000, rate, 0.2, 0.2)], rate, { source: 'mine' });
  assert.equal(read.kind, 'placement');
  assert.equal(read.ready, true);
  assert.equal(read.of.source, 'mine');
  assert.ok(read.of.axis.ids.length > 0);
});

/* --- the marking ----------------------------------------------------------- */

/**
 * A reading-shaped thing, for marking without rendering anything.
 *
 * Each kind's comparator reads its own payload, so these are the real
 * shapes with one number moved - which is the point: a fake that the
 * comparator could not read would be testing the fake.
 */
const fake = (kind, values, axis) =>
  ({ kind, ready: true, of: { state: 'x', source: 'test', axis }, values });

const loud = (lufs) => fake(
  'loudness',
  { integrated: lufs, range: 8, truePeak: -1 },
  { kind: 'whole' },
);

const BANDS = { kind: 'bands', ids: STEREO_BANDS.map((band) => band.id) };

const payload = (kind, off) => {
  if (kind === 'crest') return { crest: 12 + off, tightest: 9, peak: -1 };
  if (kind === 'balance') {
    return { bands: Object.fromEntries(THIRDS.map((hz, i) => [hz, i === 10 ? off : 0])), low: 0, mid: off, high: 0 };
  }
  if (kind === 'width') {
    return {
      whole: { width: 0, balance: 0, mono: 0, correlation: 1, energy: -20 },
      bands: Object.fromEntries(STEREO_BANDS.map((band, i) => [band.id, { width: i === 3 ? off : 0, balance: 0 }])),
    };
  }
  if (kind === 'levels') {
    // One part out and the rest at the mean, which is the shape a single
    // fader error makes - see the note over the levels tolerances.
    return {
      parts: Object.fromEntries(STEM_IDS.map((id) => [id, -20])),
      shape: Object.fromEntries(STEM_IDS.map((id, i) => [id, i === 1 ? off : 0])),
    };
  }
  if (kind === 'share') {
    // One part out in one register, which is the shape a carve makes. The
    // rest sit at nought, which is their own mean - above the floor, so that
    // every cell is compared rather than passed over.
    return {
      parts: Object.fromEntries(STEM_IDS.map((id) => [id, { low: -20, mid: -20, high: -20 }])),
      shares: Object.fromEntries(STEM_IDS.map((id, i) => [id, {
        low: i === 1 ? off : 0, mid: 0, high: 0,
      }])),
    };
  }
  return { whole: 0, bands: Object.fromEntries(STEREO_BANDS.map((band, i) => [band.id, i === 3 ? off : 0])) };
};

const axisFor = (kind) => {
  if (kind === 'crest') return { kind: 'whole' };
  if (kind === 'balance') return { kind: 'thirds', ids: THIRDS };
  if (kind === 'levels') return { kind: 'stems', ids: STEM_IDS };
  if (kind === 'share') return SHARE_AXIS;
  return BANDS;
};

test('a reading inside its tolerance is a hit, outside twice it is a miss', () => {
  const tolerance = toleranceFor('medium');

  assert.equal(markReading('loudness', loud(-14), loud(-14.5), tolerance).mark, HIT);
  assert.equal(markReading('loudness', loud(-14), loud(-15), tolerance).mark, NEAR);
  assert.equal(markReading('loudness', loud(-14), loud(-17), tolerance).mark, MISS);
});

test('a tier is marked on the readings it has tolerances for, and they all have names', () => {
  for (const [tier, tolerance] of Object.entries(MIX_TOLERANCE)) {
    for (const [kind, allowed] of Object.entries(tolerance)) {
      assert.ok(MARKED.includes(kind), `${tier} has a tolerance for ${kind}, which is not marked`);
      assert.ok(READING_NAMES[kind], `${kind} has no name`);
      assert.ok(allowed > 0, `${kind} has no tolerance at ${tier}`);
    }
  }

  // And nothing is measured that nothing is marked on: a seventh reading
  // taken off every render and used by no tier would be a render nobody asked
  // for.
  for (const kind of MARKED) {
    const used = Object.values(MIX_TOLERANCE).some((tolerance) => tolerance[kind] > 0);
    assert.ok(used, `${kind} is read and no tier is marked on it`);
  }
});

test('the three graded tiers tighten, reading by reading', () => {
  // The three that are the same job at three difficulties. `tone` and `carve`
  // are different jobs rather than harder ones, so they are not in this line
  // and are not required to sit anywhere on it.
  for (const kind of Object.keys(MIX_TOLERANCE.easy)) {
    assert.ok(MIX_TOLERANCE.easy[kind] > MIX_TOLERANCE.medium[kind], kind);
    assert.ok(MIX_TOLERANCE.medium[kind] > MIX_TOLERANCE.hard[kind], kind);
  }
});

/** Every marked reading, each a given number of decibels out. */
const master = (off = {}) => Object.fromEntries(MARKED.map((kind) => [
  kind,
  kind === 'loudness'
    ? loud(-14 + (off[kind] ?? 0))
    : fake(kind, payload(kind, off[kind] ?? 0), axisFor(kind)),
]));

test('a mix is solved only when every reading is inside its own tolerance', () => {
  const answer = master();

  assert.equal(markMix(master(), answer, 'hard').solved, true);
  assert.equal(markMix(master({ loudness: 0.2 }), answer, 'hard').solved, true);
  // Four perfect readings and one a mile out is not nearly right.
  assert.equal(markMix(master({ placement: 6 }), answer, 'easy').solved, false);
  assert.equal(markMix(master({ placement: 6 }), answer, 'easy').worst.kind, 'placement');
});

test('the same mix passes the easy tier and fails the hard one', () => {
  const answer = master();
  const slightly = master({ loudness: 0.9, balance: 1.4 });

  assert.equal(markMix(slightly, answer, 'easy').solved, true);
  assert.equal(markMix(slightly, answer, 'hard').solved, false);
});

test('the advice says which way, not what the answer is', () => {
  const answer = master();
  assert.equal(mixAdvice(markMix(master(), answer, 'easy')), 'That is the mix.');

  const line = mixAdvice(markMix(master({ loudness: 4 }), answer, 'easy'));
  assert.match(line, /louder/);
  assert.doesNotMatch(line, /\d/, 'the advice gave a number away');
});

test('closeness runs from nothing to one and never leaves it', () => {
  const answer = master();
  assert.equal(howClose(markMix(master(), answer, 'easy')), 1);
  assert.equal(howClose(markMix(master({ balance: 100 }), answer, 'hard')), 0);

  const middling = howClose(markMix(master({ balance: 3.6 }), answer, 'easy'));
  assert.ok(middling > 0 && middling < 1, `read ${middling}`);
});

/* --- tone ----------------------------------------------------------------- */

// The fourth tier. Levels, placement and the room are given right; two parts
// are the wrong colour. Marked on the master's balance reading, which is
// already one of the five and already band-wise - the measurements that say
// this is markable where a compressor insert is not are in brief.js, beside
// the table they set.

test('the tone tier moves tone, and tone is all it moves', () => {
  for (let seed = 0; seed < 60; seed += 1) {
    const { target } = mixBrief('tone', seed * 211);
    let moved = 0;

    for (const id of STEM_IDS) {
      assert.equal(target[id].gain, STEM_FLAT.gain, `${id} had its level moved`);
      assert.equal(target[id].pan, 0, `${id} was panned`);
      assert.equal(target[id].send, 0, `${id} was sent to the room`);
      if (toneIn(target[id])) moved += 1;
    }

    assert.equal(moved, MIX_TIERS.tone.tones,
      `${moved} stems were given a tone move and the tier asks for ${MIX_TIERS.tone.tones}`);
  }
});

test('every stem carries the insert, so moving a tone slider does not rebuild the graph', () => {
  // A track's graph is its instrument and its inserts, and a change of
  // inserts is a new graph under a running loop - which clicks. The resting
  // EQ is a wire, measured: the whole desk with one on every stem rendered
  // against the same desk with no inserts at all came back within 6.33e-8 a
  // sample, which is float32 rounding. So it stays on.
  for (let seed = 0; seed < 20; seed += 1) {
    const { target } = mixBrief('tone', seed * 977);
    for (const id of STEM_IDS) {
      assert.deepEqual(target[id].inserts, ['eq'], `${id} is missing its insert`);
      assert.ok(target[id].settings?.eq, `${id} has no EQ settings`);
    }
  }
});

test('a tone move lands on the band the stem lives in', () => {
  // Measured: a high-shelf move on any of these stems never reaches the
  // easy tier's tolerance, even at six decibels - there is nothing up there
  // to move. A round asking for one would arrive already solved.
  for (let seed = 0; seed < 60; seed += 1) {
    const { target } = mixBrief('tone', seed * 613);
    for (const id of STEM_IDS) {
      const eq = target[id].settings.eq;
      for (const band of ['low', 'mid', 'high']) {
        if (eq[band] === 0) continue;
        assert.equal(band, TONE_BANDS[id],
          `${id} was moved at ${band} and the band it lives in is ${TONE_BANDS[id]}`);
      }
    }
  }
});

test('a tone move is never too small to be a move, and sits on the control', () => {
  for (let seed = 0; seed < 60; seed += 1) {
    const { target } = mixBrief('tone', seed * 83);
    for (const id of STEM_IDS) {
      const db = toneIn(target[id]);
      if (db === 0) continue;
      assert.ok(Math.abs(db) >= TONE_LEAST, `${id} was moved by ${db} dB`);
      assert.ok(Math.abs(db) <= MIX_TIERS.tone.tone[1] + 1e-9, `${id} was moved by ${db} dB`);
      assert.equal(db, toStep(db, STEPS.tone), `${id} at ${db} is off the control's step`);
    }
  }
});

test('the mid frequency never moves, because the target space is the amount', () => {
  // The band is fixed at 800 Hz on every round. Every measurement behind this
  // tier was taken there, and a movable corner would be a second variable in
  // a round that is meant to have one.
  for (let seed = 0; seed < 40; seed += 1) {
    const { target } = mixBrief('tone', seed * 41);
    for (const id of STEM_IDS) {
      assert.equal(target[id].settings.eq.midHz, EQ_REST.midHz, `${id} moved the corner`);
    }
  }
});

test('the reveal says what the tone move was', () => {
  for (let seed = 0; seed < 20; seed += 1) {
    const { target } = mixBrief('tone', seed * 29);
    const moved = movesIn(target).filter((stem) => stem.tone);
    assert.equal(moved.length, MIX_TIERS.tone.tones, 'the reveal lost a move');
    for (const stem of moved) {
      assert.ok(stem.tone.band, `${stem.name} has no band to name`);
      assert.ok(Math.abs(stem.tone.db) >= TONE_LEAST, `${stem.name} at ${stem.tone.db}`);
    }
  }
});

test('the other tiers have no tone in them at all', () => {
  for (const tier of ['easy', 'medium', 'hard']) {
    for (let seed = 0; seed < 30; seed += 1) {
      const { target } = mixBrief(tier, seed * 53);
      for (const id of STEM_IDS) {
        assert.equal(toneIn(target[id]), 0, `${tier} gave ${id} a tone move`);
      }
    }
  }
});

/* --- the parts against each other ----------------------------------------- */

/**
 * Stems as `renderStems` hands them back, from levels in decibels.
 *
 * Built rather than rendered, because what is being tested here is the
 * arithmetic over the parts and not the graph that made them - a render needs
 * a browser, and `tests/browser/` is where the graph is held.
 */
function stemsAt(levels, rate = 44100) {
  const seconds = 4;
  const n = Math.round(rate * seconds);
  return Object.entries(levels).map(([id, db]) => {
    const g = 10 ** (db / 20);
    const channel = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      // A tone with a swell, so the gating has blocks of different levels to
      // keep rather than one flat one.
      const t = i / rate;
      const swell = 0.7 + 0.3 * Math.sin(2 * Math.PI * 0.4 * t);
      channel[i] = Math.sin(2 * Math.PI * 440 * t) * 0.3 * swell * g;
    }
    return { id, name: id, kind: 'track', channels: [channel, channel], rate };
  });
}

test('the parts reading is blind to the overall level and not to the balance', () => {
  // The whole reason it reads each part against the mean of the parts. How
  // loud the master is already has a reading of its own, and a mix that is
  // perfectly balanced two decibels down should fail on that one and pass
  // here - reading the parts absolutely would fail it twice for one mistake
  // and point at four parts for a fault that is in none of them.
  const base = { kit: -20, bass: -22, keys: -24, pad: -26 };
  const answer = levelsReading(stemsAt(base), 44100);

  const lifted = Object.fromEntries(Object.entries(base).map(([id, db]) => [id, db + 3]));
  assert.ok(distance(levelsReading(stemsAt(lifted), 44100), answer).off < 0.01,
    'every fader up by the same amount is the same balance');

  const tilted = { ...base, bass: base.bass + 3 };
  const gap = distance(levelsReading(stemsAt(tilted), 44100), answer);
  assert.ok(gap.off > 0.5, 'and one fader up by itself is not');
  assert.equal(gap.where, 'bass', 'and it says which one');
  assert.ok(gap.detail.hotter > 0, 'and which way');
});

test('what a reading of the parts means in faders, which is not one to one', () => {
  // The thing the first version of this got wrong. Removing the mean is lossy
  // on purpose, so a reading cannot be turned back into a fader position: any
  // set of moves and that set plus a constant read the same. What it can do
  // is grow with the error, and these are the anchors the tolerances are set
  // from.
  const base = { kit: -20, bass: -22, keys: -24, pad: -26 };
  const answer = levelsReading(stemsAt(base), 44100);
  const off = (moves) => distance(
    levelsReading(stemsAt({ ...base, ...moves }), 44100), answer,
  ).off;

  // One part out by a decibel reads three quarters of it, because a quarter
  // of the move goes into the mean of four.
  assert.ok(Math.abs(off({ bass: base.bass + 1 }) - 0.75) < 0.02,
    `one fader by a decibel should read 0.75, and read ${off({ bass: base.bass + 1 }).toFixed(3)}`);

  // Two out the same way read less than one out, which is the part that makes
  // the one-to-one story false: the mean moves with them.
  assert.ok(off({ bass: base.bass + 1, pad: base.pad + 1 }) < off({ bass: base.bass + 1 }),
    'two parts out the same way read less than one does');

  // And two out in opposite directions read the move itself, because the mean
  // does not shift at all.
  assert.ok(Math.abs(off({ bass: base.bass + 1, pad: base.pad - 1 }) - 1) < 0.02,
    'two parts out opposite ways read the move');
});

test('the advice names the parts rather than a frequency', () => {
  // The point of having this reading at all. "There is too much around 120 Hz"
  // is true and is not an instruction; naming the fader is.
  const base = { kit: -20, bass: -22, keys: -24, pad: -26 };
  const answer = levelsReading(stemsAt(base), 44100);
  const mine = levelsReading(stemsAt({ ...base, bass: base.bass + 4 }), 44100);

  const marked = markReading('levels', mine, answer, toleranceFor('easy'));
  assert.equal(marked.kind, 'levels');
  assert.equal(marked.where, 'bass');

  const line = mixAdvice({ solved: false, worst: marked });
  assert.match(line, /bass/, `the advice should name the part: "${line}"`);
  assert.match(line, /hot/, 'and which way it is out');
  // Never an absolute fader claim, which is the thing that was wrong before.
  assert.match(line, /Against the rest/, 'and that the number is relative');
});

test('a part that is right is never named, however wrong its neighbours are', () => {
  // What the broken version did: it said "the keys are 2.3 dB too hot" about a
  // fader nobody had touched, because it scaled the shape error by 4/3 and
  // called the result a fader position. A part at its target still shows a
  // shape error when others move - that is the mean shifting - so the advice
  // must only name parts outside the tolerance, worst first.
  const base = { kit: -20, bass: -22, keys: -24, pad: -26 };
  const answer = levelsReading(stemsAt(base), 44100);
  const mine = levelsReading(stemsAt({ ...base, bass: base.bass + 6 }), 44100);
  const gap = distance(mine, answer);

  const named = partsOut(gap, toleranceFor('easy').levels).map((p) => p.id);
  assert.ok(named.includes('bass'), 'the one that moved is named');
  assert.equal(named[0], 'bass', 'and it is named first, as the worst');
});

test('levels is marked on every tier and is loose where tone is the question', () => {
  // A tone round gives the levels right and asks for EQ, and an EQ boost
  // changes the stem's whole loudness - measured, a flat tone round reads 1.60
  // and 1.76 from its answer on levels alone. So the tone tier's tolerance is
  // loose enough never to fire, which is marking the tone move once rather
  // than twice.
  assert.ok(MARKED.includes('levels'), 'the parts are marked');
  for (const tier of ['easy', 'medium', 'hard']) {
    assert.ok(toleranceFor(tier).levels <= 0.8, `${tier} should hold the parts to something`);
  }
  assert.ok(toleranceFor('tone').levels >= 2,
    'and the tone tier should not fail somebody for the EQ it asked for');
});

/* --- hearing the two at the same level ------------------------------------- */

/**
 * An anchor, as `anchorOf` makes one, from numbers rather than from a render.
 *
 * The real one comes off two offline renders, which these cannot do - what is
 * being held here is the arithmetic on top of them, and the renders it stands
 * on are measured in `tests/browser/match.mjs` with the table in
 * `src/mix/monitor.js`.
 */
const anchorAt = (mix, master, parts) => anchorOf(mix, {
  loudness: { values: { integrated: master } },
  levels: { values: { parts } },
});

const SOME_PARTS = { kit: -27.9, bass: -29.7, keys: -31.9, pad: -30.4 };

/** Decibels, to the dust a double leaves behind. */
const near = (got, want, by = 1e-9) => Math.abs(got - want) < by;

test('the loudness of parts playing together is their energy, not their average', () => {
  // Two equal parts are three decibels louder than one of them, which is the
  // one case everybody can check by hand: ten log ten of two is 3.0103.
  assert.ok(near(sumOf([-20, -20]), -20 + 10 * Math.log10(2)));
  assert.ok(near(sumOf([-20, -20]), -16.9897, 0.0001));
  assert.ok(near(sumOf([-20]), -20));

  // And a part twenty decibels down barely counts, which is why a mix's
  // loudness is not the mean of its parts: the mean of these two is -30.
  assert.ok(near(sumOf([-20, -40]), -19.957, 0.001));
});

test('an estimate is exact at the mix it was anchored on', () => {
  const mix = flatMix();
  const anchor = anchorAt(mix, -24.9, SOME_PARTS);
  assert.ok(near(mixLoudness(anchor, mix), -24.9));
});

test('a fader moves the estimate the way the energy says it should', () => {
  const flat = flatMix();
  const anchor = anchorAt(flat, -24.9, SOME_PARTS);

  // Every fader up by the same amount is the whole mix up by that amount,
  // whatever the parts are, which is the one move with an answer in closed
  // form.
  const all = Object.fromEntries(STEM_IDS.map((id) =>
    [id, { ...flat[id], gain: gainFor(4) }]));
  assert.ok(near(mixLoudness(anchor, all), -24.9 + 4));

  // And one fader up moves it by less than the fader moved, because the other
  // three did not move: the kit is the loudest part here, so four decibels on
  // it is worth more than four on the keys.
  const kit = { ...flat, kit: { ...flat.kit, gain: gainFor(4) } };
  const keys = { ...flat, keys: { ...flat.keys, gain: gainFor(4) } };
  for (const one of [kit, keys]) {
    const by = mixLoudness(anchor, one) - -24.9;
    assert.ok(by > 0 && by < 4, `one fader of four moved the mix by ${by.toFixed(2)}`);
  }
  assert.ok(mixLoudness(anchor, kit) > mixLoudness(anchor, keys));
});

test('a pan or a send leaves the estimate alone, because the measurement says to', () => {
  const flat = flatMix();
  const anchor = anchorAt(flat, -24.9, SOME_PARTS);
  const moved = {
    ...flat,
    keys: { ...flat.keys, pan: -0.7, send: 0.6 },
    pad: { ...flat.pad, pan: 0.7, send: 0.4 },
  };

  assert.ok(near(mixLoudness(anchor, moved), mixLoudness(anchor, flat), 1e-12));
  assert.equal(staleFor(anchor, moved), null);
});

test('a colour move puts the match out of date rather than carrying on', () => {
  const flat = flatMix();
  for (const id of STEM_IDS) {
    flat[id].inserts = ['eq'];
    flat[id].settings = { eq: { ...EQ_REST } };
  }
  const anchor = anchorAt(flat, -24.9, SOME_PARTS);
  assert.equal(staleFor(anchor, flat), null);

  const coloured = {
    ...flat,
    bass: { ...flat.bass, settings: { eq: { ...EQ_REST, low: 6 } } },
  };
  const why = staleFor(anchor, coloured);
  assert.ok(why && why.length > 20, `a stale match has to say why, not "${why}"`);
  assert.ok(staleFor(null, flat), 'nothing measured is not the same as a match');
});

test('the trim is the difference between the two, and is clamped', () => {
  const flat = flatMix();
  const anchor = anchorAt(flat, -24.9, SOME_PARTS);

  // Your mix is a decibel and a half louder than the reference, so the
  // reference comes up by a decibel and a half to meet it.
  assert.ok(near(matchTrim(anchor, flat, -26.4), 1.5));
  assert.ok(near(matchTrim(anchor, flat, -23.4), -1.5));
  assert.ok(near(matchTrim(anchor, flat, -24.9), 0));

  // Nothing measured means no trim at all, rather than a guess at one.
  assert.equal(matchTrim(null, flat, -26.4), 0);
  assert.equal(matchTrim(anchor, flat, null), 0);

  // And a number that could only be a fault is held at the clamp.
  assert.equal(matchTrim(anchor, flat, -90), MATCH_LIMIT);
  assert.equal(matchTrim(anchor, flat, 40), -MATCH_LIMIT);
});

test('a trim of nothing is unity, and the clamp is a gain somebody could hear', () => {
  assert.equal(gainOfTrim(0), 1);
  assert.ok(near(gainOfTrim(6), 1.9953, 1e-4));
  assert.ok(near(gainOfTrim(-6), 0.5012, 1e-4));
});

test('an anchor is made from the readings a submit already took', () => {
  const mix = flatMix();
  const readings = {
    loudness: { values: { integrated: -24.9 } },
    levels: { values: { parts: SOME_PARTS } },
  };
  const anchor = anchorOf(mix, readings);

  assert.equal(anchor.master, -24.9);
  assert.deepEqual(anchor.parts, SOME_PARTS);
  assert.ok(near(mixLoudness(anchor, mix), -24.9));

  // A copy of the mix rather than the mix itself: the desk goes on moving,
  // and an anchor that moved with it would describe whatever is current and
  // therefore nothing.
  mix.bass.gain = gainFor(6);
  assert.ok(Math.abs(mixLoudness(anchor, mix) - -24.9) > 0.5);
});

/* --- making room ----------------------------------------------------------- */

/** A share reading's shape, from numbers rather than from a render. */
const shares = (per) => ({
  kind: 'share',
  ready: true,
  of: { state: 'x', source: 'test', axis: SHARE_AXIS },
  values: {
    parts: Object.fromEntries(STEM_IDS.map((id) => [id, { low: -20, mid: -20, high: -20 }])),
    shares: Object.fromEntries(STEM_IDS.map((id) => [id, { low: 0, mid: 0, high: 0, ...per[id] }])),
  },
});

test('the three registers meet where the three tone controls do, and cover everything', () => {
  assert.deepEqual(REGISTER_IDS, ['low', 'mid', 'high']);

  // The edges are the geometric means of neighbouring controls: 120 and 800
  // meet at 310, 800 and 6000 at 2191, which rounds to the 2200 in the table.
  assert.ok(Math.abs(REGISTERS[0].to - Math.sqrt(120 * 800)) < 2);
  assert.ok(Math.abs(REGISTERS[1].to - Math.sqrt(800 * 6000)) < 10);
  assert.equal(REGISTERS[2].to, Infinity);

  // And nothing falls between them, which is the point of putting the edges
  // there rather than around each control: a part could otherwise be moved
  // without the reading moving.
  for (const hz of [10, 25, 309, 310, 311, 2199, 2200, 20000]) {
    assert.ok(REGISTER_IDS.includes(registerOf(hz).id), `${hz} is in no register`);
  }
  assert.equal(registerOf(309).id, 'low');
  assert.equal(registerOf(310).id, 'mid');
  assert.equal(registerOf(2200).id, 'high');
});

test('the share gap names the part and the register, not a frequency', () => {
  const flat = shares({});
  const heavy = shares({ bass: { low: 2.5 } });
  const gap = shareGap(heavy, flat);

  assert.ok(Math.abs(gap.off - 2.5) < 1e-9);
  assert.equal(gap.detail.part, 'bass');
  assert.equal(gap.where, REGISTERS[0].label);
  assert.equal(shareGap(flat, flat).off, 0);
});

test('a part too far down in a register is not compared there', () => {
  // The measurement behind the floor: a shelf move on a part shifts the
  // part's whole level a little, and in a register where it has nothing that
  // shift is all that is being read. See SHARE_FLOOR.
  const buried = { low: SHARE_FLOOR - 4, mid: 6, high: 0 };
  const a = shares({ pad: buried });
  const b = shares({ pad: { ...buried, low: buried.low - 3 } });

  assert.equal(shareGap(a, b).off, 0);

  // Above the floor on either side and it counts, so a part that becomes
  // audible in a register is not passed over for having been quiet before.
  const audible = shares({ pad: { ...buried, low: SHARE_FLOOR + 1 } });
  assert.ok(Math.abs(shareGap(audible, a).off) > 4);
});

test('the advice names a part and a register, which is an instruction', () => {
  const marked = markMix(
    { ...master(), share: shares({ bass: { low: 2.5 } }) },
    { ...master(), share: shares({}) },
    'carve',
  );
  const said = mixAdvice(marked);

  assert.match(said, /bass/);
  assert.match(said, /310/);
  assert.match(said, /too much/);

  // And the parts that are right are not named, however wrong one is.
  for (const id of ['kit', 'keys', 'pad']) assert.ok(!said.includes(id), said);
});

test('making room asks for cuts on the maskers and nothing else at all', () => {
  for (let seed = 1; seed <= 40; seed += 1) {
    const { target } = mixBrief('carve', seed * 977);
    const movers = CARVES.map((pair) => pair.masker);

    for (const stem of movesIn(target)) {
      assert.equal(stem.db, 0, `${stem.id} moved a fader on a carve round`);
      assert.equal(stem.pan, 0, `${stem.id} moved off centre on a carve round`);
      assert.equal(stem.send, 0, `${stem.id} went into the room on a carve round`);

      if (!movers.includes(stem.id)) {
        assert.equal(stem.tone, null, `${stem.id} was coloured and is not a masker`);
        continue;
      }

      // A carve is a cut. Not a convention: the lesson is that the control to
      // reach for is the one on whatever is covering the sound, and a boost
      // on a masker is that lesson backwards.
      assert.ok(stem.tone, `${stem.id} is a masker and was not carved`);
      assert.ok(stem.tone.db <= -CARVE_LEAST,
        `${stem.id} was carved by ${stem.tone.db}, which is not a cut of at least ${CARVE_LEAST}`);
      assert.ok(stem.tone.db >= -MIX_TIERS.carve.tone[1]);
      assert.equal(stem.tone.band, CARVES.find((pair) => pair.masker === stem.id).band);
      assert.equal(toStep(stem.tone.db, STEPS.tone), stem.tone.db);
    }
  }
});

test('the part being masked is never the part that moves', () => {
  const live = colouring('carve');
  for (const { masker, masked } of CARVES) {
    assert.ok(live.some((one) => one.id === masker), `${masker} cannot be carved`);
    assert.ok(!live.some((one) => one.id === masked), `${masked} can be coloured and is the one covered`);
  }
});

test('every tier says which stems it colours, and the other three colour none', () => {
  assert.deepEqual(colouring('easy'), []);
  assert.deepEqual(colouring('medium'), []);
  assert.deepEqual(colouring('hard'), []);
  assert.equal(colouring('tone').length, TONED.length);
  assert.equal(colouring('carve').length, CARVES.length);

  assert.equal(colouring('depth').length, AIRY.length);

  // And every band a tier offers is one the stem lives in. For the two tiers
  // about colour that is `TONE_BANDS`, the one band each stem has its weight
  // in; for a distance round it is the top shelf, which is air, and only on
  // the part that has a top end to lose.
  for (const tier of MIX_TIER_IDS) {
    for (const { id, band } of colouring(tier)) {
      if (MIX_TIERS[tier].faults || MIX_TIERS[tier].tones) {
        assert.equal(band, TONE_BANDS[id], `${tier} colours ${id} somewhere it does not live`);
        continue;
      }
      if (MIX_TIERS[tier].depths) {
        assert.equal(band, 'high', `${tier} rolls the air off somewhere that is not the top`);
        assert.ok(AIRY.includes(id), `${tier} takes air off ${id}, which has none to take`);
        continue;
      }
      assert.equal(band, TONE_BANDS[id], `${tier} colours ${id} somewhere it does not live`);
    }
  }
});

test('making room is marked on who owns which register, and not on the parts', () => {
  const tolerance = toleranceFor('carve');
  assert.ok(tolerance.share > 0);
  assert.equal(tolerance.levels, undefined);

  // Which means the result has six rows rather than seven, and one of them is
  // the share.
  const marked = markMix(
    { ...master(), share: shares({}) },
    { ...master(), share: shares({}) },
    'carve',
  );
  assert.deepEqual(marked.readings.map((reading) => reading.kind),
    ['loudness', 'balance', 'placement', 'width', 'crest', 'share']);
});

/* --- front to back --------------------------------------------------------- */

/** A room reading's shape, from numbers rather than from a render. */
const aRoom = (howMuch, shape = {}) => ({
  kind: 'room',
  ready: true,
  of: { state: 'x', source: 'test', axis: ROOM_AXIS },
  values: {
    howMuch,
    bands: {},
    shape: { low: 0, mid: 0, high: 0, ...shape },
  },
});

test('a distance is three things at once, and the three are in proportion', () => {
  // Quieter, duller and wetter, and ordered: there is no distance in this
  // table that is louder and further away than its neighbour.
  for (let i = 1; i < DEPTHS.length; i += 1) {
    assert.ok(DEPTHS[i].gain < DEPTHS[i - 1].gain, `${DEPTHS[i].id} is not quieter`);
    assert.ok(DEPTHS[i].send > DEPTHS[i - 1].send, `${DEPTHS[i].id} is not wetter`);
    assert.ok(DEPTHS[i].air < DEPTHS[i - 1].air, `${DEPTHS[i].id} is not duller`);
  }

  // The front is where the kit already is, so a part up front is a part with
  // no room on it at all rather than a part with a little.
  assert.equal(DEPTHS[0].send, 0);
  assert.equal(DEPTHS[0].air, 0);

  // And every one of them is a setting the controls can reach.
  for (const how of DEPTHS) {
    assert.equal(toStep(how.gain, STEPS.gain), how.gain, how.id);
    assert.equal(toStep(how.send, STEPS.send), how.send, how.id);
    assert.equal(toStep(how.air, STEPS.tone), how.air, how.id);
    assert.ok(how.gain >= TRIM.low && how.gain <= TRIM.high, how.id);
    assert.ok(how.air >= -12, `${how.id} asks for more air than the slider has`);
  }
});

test('only the parts with the whole room to move in are placed, and only one has air', () => {
  for (const id of AT_A_DISTANCE) assert.equal(ROOM_FOR[id], 1, id);
  for (const id of STEM_IDS.filter((one) => !AT_A_DISTANCE.includes(one))) {
    assert.ok(ROOM_FOR[id] < 1, `${id} has the room to move in and is not placed`);
  }

  // The anchor is never placed: something has to be the front.
  assert.ok(!AT_A_DISTANCE.includes(ANCHOR));
  for (const id of AIRY) assert.ok(AT_A_DISTANCE.includes(id), `${id} has air and is not placed`);
});

test('a distance round puts the two placed parts at two different distances', () => {
  for (let seed = 1; seed <= 40; seed += 1) {
    const { target } = mixBrief('depth', seed * 7919);

    const at = AT_A_DISTANCE.map((id) => {
      const how = DEPTHS.find((one) => Math.abs(one.send * ROOM_FOR[id] - target[id].send) < 1e-9
        && Math.abs(one.gain - dbOf(target[id].gain)) < 1e-9);
      assert.ok(how, `${id} is at no distance in the table`);
      return how.id;
    });
    assert.notEqual(at[0], at[1], 'both parts at one distance is a round with no front to back');

    // And nothing else moved: not the anchor, not the bass, nothing off centre.
    for (const stem of movesIn(target)) {
      assert.equal(stem.pan, 0, `${stem.id} went off centre on a distance round`);
      if (AT_A_DISTANCE.includes(stem.id)) continue;
      assert.equal(stem.db, 0, `${stem.id} moved and is not placed`);
      assert.equal(stem.send, 0, `${stem.id} went into the room and is not placed`);
      assert.equal(stem.tone, null, `${stem.id} was coloured and is not placed`);
    }

    // The air lands on the top shelf, which is the band the reveal reads back.
    for (const id of AIRY) {
      const tone = movesIn(target).find((stem) => stem.id === id)?.tone;
      if (tone) assert.equal(tone.band, 'high', 'air is the top shelf and nothing else');
    }
  }
});

test('the room says how much there is apart from what is in it', () => {
  // Twice as much reverb is six decibels more of it and the same colour.
  const quiet = aRoom(-18, { low: 12, mid: 14, high: -27 });
  const loud = aRoom(-12, { low: 12, mid: 14, high: -27 });
  assert.ok(Math.abs(roomGap(loud, quiet).off - 6) < 1e-9);
  assert.equal(roomGap(loud, quiet).where, 'how much room there is');
  assert.ok(roomGap(loud, quiet).detail.wetter > 0);

  // The same amount of it with something else in it is the other reading.
  const other = aRoom(-18, { low: -9, mid: 14, high: -5 });
  const gap = roomGap(other, quiet);
  assert.ok(Math.abs(gap.off) > 20, 'two different rooms read as the same room');
  assert.notEqual(gap.where, 'how much room there is');
  assert.equal(roomGap(quiet, quiet).off, 0);
});

test('a room nobody is in is compared on how much, and not on its colour', () => {
  // Because there is no colour to it: a silent return's three registers are
  // three floors, and their shape is whatever the arithmetic did with them.
  const dry = aRoom(-Infinity, { low: 40, mid: -80, high: 9 });
  const wet = aRoom(-18, { low: 12, mid: 14, high: -27 });

  const gap = roomGap(dry, wet);
  assert.equal(gap.where, 'how much room there is');
  assert.ok(Number.isFinite(gap.off), 'a dry mix reads as an infinity');
  // Unsigned, as every gap in this app is: which way round it is lives in the
  // detail, where the advice reads it.
  assert.ok(Math.abs(gap.off - Math.abs(ROOM_FLOOR - -18)) < 1e-9);
  assert.ok(gap.detail.wetter < 0, 'a dry mix is not drier than a wet one');

  // And two dry mixes are the same mix, whatever their floors say.
  assert.equal(roomGap(dry, aRoom(-Infinity, { low: -3 })).off, 0);
  assert.equal(inARoom(-Infinity), false);
  assert.equal(inARoom(ROOM_FLOOR - 1), false);
  assert.equal(inARoom(-20), true);
});

test('the advice about a room says which of the two things is wrong', () => {
  const near = { ...master(), share: shares({}), room: aRoom(-18, { low: 12, mid: 14, high: -27 }) };
  const wetter = { ...near, room: aRoom(-12, { low: 12, mid: 14, high: -27 }) };
  const wrong = { ...near, room: aRoom(-18, { low: -9, mid: 14, high: -5 }) };

  assert.match(mixAdvice(markMix(wetter, near, 'depth')), /more room/);
  assert.match(mixAdvice(markMix(wrong, near, 'depth')), /wrong colour/);
  assert.match(mixAdvice(markMix(wrong, near, 'depth')), /wrong distance/);
  assert.equal(mixAdvice(markMix(near, near, 'depth')), 'That is the mix.');
});

test('front to back is marked on the room and the shares, and not on the parts', () => {
  const tolerance = toleranceFor('depth');
  assert.ok(tolerance.room > 0);
  assert.ok(tolerance.share > 0);
  // Measured, a fader move reads the same on `levels` and on `share`, so both
  // would be one mistake reported twice. See the note over the tolerances.
  assert.equal(tolerance.levels, undefined);
});

/* --- what is on it --------------------------------------------------------- */

test('the four arrangements are four different chains, and both orders are there', () => {
  assert.equal(CHAIN_ORDERS.length, 4);
  assert.equal(new Set(CHAIN_IDS).size, 4);

  const chains = CHAIN_ORDERS.map((one) => one.inserts.join('>'));
  assert.ok(chains.includes('compression'), 'there is no compressor on its own');
  assert.ok(chains.includes('saturation'), 'there is no saturator on its own');
  assert.ok(chains.includes('compression>saturation'), 'one of the two orders is missing');
  assert.ok(chains.includes('saturation>compression'), 'one of the two orders is missing');

  // Four, because the round is answered by naming it: two would be a coin
  // toss and one guess is all anybody gets. Every one of them also has to say
  // what it is, since that is the chip somebody reads.
  for (const how of CHAIN_ORDERS) {
    assert.ok(how.symbol && how.symbol.length <= 12, `${how.id} has no readable symbol`);
    assert.ok(how.name && how.name.length > 8, `${how.id} does not say what it is`);
  }
});

test('every arrangement is gain-staged, and both effects carry settings either way', () => {
  for (const how of CHAIN_ORDERS) {
    assert.ok(how.settings.compression, `${how.id} has no compressor settings`);
    assert.ok(how.settings.saturation, `${how.id} has no saturator settings`);

    // Both, whichever is in the chain, so that the project stamp in render.js
    // changes when the order does. See chainMix.
    const staged = how.inserts.includes('compression')
      ? how.settings.compression.makeup
      : how.settings.saturation.trim;
    assert.ok(Number.isFinite(staged), `${how.id} is not gain-staged`);
  }

  // The one with nothing but the saturator takes its correction on the trim,
  // and the one with nothing but the compressor on the makeup.
  assert.ok(arrangementOf('heat').settings.saturation.trim < 0);
  assert.ok(arrangementOf('comp').settings.compression.makeup > 0);
});

test('a chain goes on one part and leaves the other three alone', () => {
  for (const how of CHAIN_ORDERS) {
    const mix = chainMix(flatMix(), how.id);
    assert.deepEqual(mix[CHAIN_ON].inserts, how.inserts);

    for (const id of STEM_IDS.filter((one) => one !== CHAIN_ON)) {
      assert.deepEqual(mix[id].inserts ?? [], [], `${id} was given an insert`);
      assert.equal(mix[id].gain, STEM_FLAT.gain);
      assert.equal(mix[id].pan, 0);
      assert.equal(mix[id].send, 0);
    }
  }

  // An unknown arrangement is the first one rather than an exception: a
  // reveal reads the answer back through this and a round with no chain at all
  // would be a round about nothing.
  assert.equal(arrangementOf('nonsense').id, CHAIN_ORDERS[0].id);
});

test('a naming round picks an arrangement and asks nothing else', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 60; seed += 1) {
    const brief = mixBrief('order', seed * 1013);
    assert.ok(CHAIN_IDS.includes(brief.naming.order), 'the answer is not an arrangement');
    seen.add(brief.naming.order);

    assert.deepEqual(brief.target[CHAIN_ON].inserts, arrangementOf(brief.naming.order).inserts);
    for (const stem of movesIn(brief.target)) {
      assert.equal(stem.db, 0, `${stem.id} moved a fader on a naming round`);
      assert.equal(stem.pan, 0);
      assert.equal(stem.send, 0);
    }
  }

  // All four come up, or three of them are unreachable rounds.
  assert.equal(seen.size, CHAIN_IDS.length, `only ${seen.size} of the four were ever dealt`);
});

test('a naming round is marked by naming it, so it has no tolerances at all', () => {
  assert.ok(MIX_TIERS.order.names);
  assert.equal(MIX_TOLERANCE.order, undefined);

  // And no other tier is: everything else is answered by matching, where a
  // reading is what says whether you got there.
  for (const tier of MIX_TIER_IDS.filter((id) => id !== 'order')) {
    assert.ok(!MIX_TIERS[tier].names, `${tier} is answered by naming and has tolerances`);
    assert.ok(MIX_TOLERANCE[tier], `${tier} is answered by matching and has none`);
  }
});

/* --- listening somewhere else ---------------------------------------------- */

test('there are three ways to listen and each says what it is for', () => {
  assert.deepEqual(LISTEN_IDS, ['full', 'mono', 'phone']);
  for (const how of LISTEN_MODES) {
    assert.ok(how.label && how.label.length <= 14, `${how.id} has no readable label`);
    assert.ok(how.tells && how.tells.length > 20, `${how.id} does not say what it is for`);
  }
});

test('a small speaker is two corners, and its Q is in the units it is in', () => {
  // Both corners are inside the range a mix lives in, or the mode would be
  // telling nobody anything: 400 Hz is above the kick and the bass, which is
  // the whole point, and 8 kHz is below the air.
  assert.ok(SMALL_SPEAKER.from > 200 && SMALL_SPEAKER.from < 1000);
  assert.ok(SMALL_SPEAKER.to > 4000 && SMALL_SPEAKER.to < 12000);

  // In decibels, and negative, which is the thing that was got wrong twice.
  // A BiquadFilterNode's Q is a figure in dB for a lowpass or a highpass -
  // how far up the corner sits - so Butterworth is -3.01 and not 0.7071, and
  // the default of 1 is a one-decibel bump. See SMALL_SPEAKER.
  assert.ok(Math.abs(SMALL_SPEAKER.q - 20 * Math.log10(Math.SQRT1_2)) < 0.001);
  assert.ok(SMALL_SPEAKER.q < 0, 'a Butterworth corner is three decibels down, not up');
});

/* --- fixing a mix somebody has been at ------------------------------------- */

test('every fault can be done, can be undone, and says what it hurts', () => {
  assert.equal(MIX_FAULTS.length, 4);
  assert.equal(new Set(MIX_FAULT_IDS).size, 4);

  const marked = toleranceFor('fix');
  for (const fault of MIX_FAULTS) {
    assert.ok(fault.symbol && fault.symbol.length <= 14, `${fault.id} has no readable symbol`);
    assert.ok(fault.name && fault.name.length > 10, `${fault.id} does not say what it is`);

    // What it claims to hurt has to be a reading this tier is marked on, or
    // the fault is invisible to the round it is in.
    assert.ok(marked[fault.hurts] > 0, `${fault.id} hurts ${fault.hurts}, which is not marked here`);

    // And somebody has to be able to put it back: every fault moves a
    // control the desk has, which is why none of them touches the anchor's
    // fader or a band its part does not live in.
    const [low, high] = fault.size;
    assert.ok(high > low && low > 0, `${fault.id} has no size`);
  }
});

test('a round has one to three things wrong with it, never two of a kind', () => {
  const counts = new Set();
  for (let seed = 1; seed <= 80; seed += 1) {
    const { faults, start, target } = mixBrief('fix', seed * 5099);

    assert.ok(faults.length >= 1 && faults.length <= 3, `${faults.length} faults`);
    counts.add(faults.length);

    const kinds = faults.map((one) => one.fault);
    const parts = faults.map((one) => one.on);
    assert.equal(new Set(kinds).size, kinds.length, 'two faults of one kind cannot both be named');
    assert.equal(new Set(parts).size, parts.length, 'two faults on one part hide each other');
    assert.ok(!parts.includes(ANCHOR), 'the anchor was broken and its fader does not move');

    // The mix underneath is a whole mix, not flat: a round whose answer is
    // flat is a round you win by zeroing everything.
    const moved = movesIn(target).filter((stem) => stem.db || stem.pan || stem.send);
    assert.ok(moved.length >= 2, 'the mix under the faults is nearly flat');

    // And the mix it opens on is not the answer.
    assert.notDeepEqual(start, target);
  }

  // All three counts come up, or the round is not asking a question about
  // how many: see HOW_MANY.
  assert.equal(counts.size, 3, `only ${[...counts].join(', ')} ever came up`);
});

test('what was done to a mix is always something the desk can undo', () => {
  for (let seed = 1; seed <= 40; seed += 1) {
    const { faults, start, target } = mixBrief('fix', seed * 8191);

    for (const { fault, on } of faults) {
      const was = target[on];
      const now = start[on];
      const moved = Math.abs(dbOf(now.gain) - dbOf(was.gain)) > 1e-9
        || Math.abs(now.pan - was.pan) > 1e-9
        || Math.abs(now.send - was.send) > 1e-9
        || toneIn(now) !== toneIn(was);
      assert.ok(moved, `${fault} on the ${on} changed nothing`);

      // On the grid the controls are on, so it can be put back exactly.
      assert.equal(toStep(dbOf(now.gain), STEPS.gain), toStep(dbOf(now.gain), STEPS.gain));
      assert.equal(now.pan, toStep(now.pan, STEPS.pan));
      assert.equal(now.send, toStep(now.send, STEPS.send));
      assert.equal(toneIn(now), toStep(toneIn(now), STEPS.tone));
      assert.ok(Math.abs(now.pan) <= 1 && now.send <= 1 && now.send >= 0);
      assert.ok(Math.abs(toneIn(now)) <= 12, 'a colour fault went past the slider');
    }
  }
});

test('the capstone is marked on everything it could have broken', () => {
  const tolerance = toleranceFor('fix');
  for (const fault of MIX_FAULTS) assert.ok(tolerance[fault.hurts] > 0, fault.id);

  // The whole desk is out, because anything might have been done to it.
  assert.equal(colouring('fix').length, TONED.length);
});

/* --- a fader that moves while it plays ------------------------------------- */

/** A ride reading's shape, from numbers rather than from a render. */
const shapes = (per) => ({
  kind: 'ride',
  ready: true,
  of: { state: 'x', source: 'test', axis: RIDE_AXIS },
  values: {
    shapes: Object.fromEntries(STEM_IDS.map((id) => [id, per[id] ?? [0, 0, 0, 0]])),
  },
});

test('a swell is half up and half down, so it is not also a fader', () => {
  // Three eighths of the depth in the outside bars, nothing in the middle,
  // and nought on average - which is what keeps a ride out of `levels`.
  const over = [0, 1, 2, 3].map((bar) => rideAt(6, (bar + 0.5) / 4));
  assert.deepEqual(over.map((v) => Number(v.toFixed(3))), [-2.25, -0.75, 0.75, 2.25]);

  const mean = over.reduce((sum, v) => sum + v, 0) / over.length;
  assert.ok(Math.abs(mean) < 1e-12, 'a swell is not centred');

  // And at the two ends it is exactly half the depth either way.
  assert.equal(rideAt(8, 0), -4);
  assert.equal(rideAt(8, 1), 4);
  assert.equal(rideAt(0, 0.9), 0);

  // As a gain, which is what the stage multiplies the fader by.
  assert.ok(Math.abs(rideGain(6, 1) - 10 ** (3 / 20)) < 1e-12);
  assert.equal(rideGain(0, 0.3), 1);
});

test('the ride gap names the part and the bar', () => {
  const still = shapes({});
  const rising = shapes({ keys: [-2.25, -0.75, 0.75, 2.25] });
  const gap = rideGap(rising, still);

  assert.ok(Math.abs(gap.off - 2.25) < 1e-9);
  assert.equal(gap.detail.part, 'keys');
  // Bar 1 and bar 4 are equally wrong on a swell, and the first of a tie is
  // the one reported - which is also the first one anybody would hear.
  assert.equal(gap.where, 'bar 1');
  assert.ok(gap.detail.louder < 0, 'the first bar of a swell is the quiet end');
  assert.equal(rideGap(still, still).off, 0);

  // Two swells the other way round are as far apart as a reading can say,
  // which is the mistake the tier is most about.
  const falling = shapes({ keys: [2.25, 0.75, -0.75, -2.25] });
  assert.ok(Math.abs(rideGap(rising, falling).off - 4.5) < 1e-9);
});

test('a swell round asks for two, one up and one down, and nothing else', () => {
  for (let seed = 1; seed <= 40; seed += 1) {
    const { rides, target } = mixBrief('swell', seed * 3571);
    const parts = Object.keys(rides);

    assert.equal(parts.length, 2, 'a ride round is one part moving against another');
    assert.ok(!parts.includes(ANCHOR), 'the anchor rode, and it is the reference');
    const depths = parts.map((id) => rides[id]);
    assert.ok(depths[0] * depths[1] < 0, 'both swells went the same way, which is a fader');

    for (const db of depths) {
      assert.ok(Math.abs(db) >= SWELL_LEAST, `a swell of ${db} is too small to hear`);
      assert.ok(Math.abs(db) <= MIX_TIERS.swell.depth[1]);
      assert.equal(toStep(db, STEPS.gain), db, 'a swell off the grid the fader is on');
    }

    // And the mix underneath is flat: nothing else is being asked for.
    for (const stem of movesIn(target)) {
      assert.equal(stem.db, 0, `${stem.id} moved a fader on a ride round`);
      assert.equal(stem.pan, 0);
      assert.equal(stem.send, 0);
    }
  }
});

test('what moves is marked on the reading about time, and on nothing to do with level', () => {
  const tolerance = toleranceFor('swell');
  assert.ok(tolerance.ride > 0);
  // A swell averages to nought over the loop, so a part that rides is a part
  // at the right level: `levels` and `share` have nothing to say here and
  // are not asked.
  assert.equal(tolerance.levels, undefined);
  assert.equal(tolerance.share, undefined);

  const marked = markMix(
    { ...master(), ride: shapes({ keys: [-2.25, -0.75, 0.75, 2.25] }) },
    { ...master(), ride: shapes({}) },
    'swell',
  );
  assert.equal(marked.worst.kind, 'ride');
  assert.match(mixAdvice(marked), /keys are/);
  assert.match(mixAdvice(marked), /bar 1/);
  assert.match(mixAdvice(marked), /too far down/);
});
