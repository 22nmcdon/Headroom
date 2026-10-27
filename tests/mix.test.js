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
} from '../src/mix/brief.js';
import { EQ_REST } from '../src/sketch/knobs.js';
import {
  markMix, markReading, mixAdvice, howClose, MIX_TOLERANCE, toleranceFor,
  READING_NAMES, HIT, NEAR, MISS,
} from '../src/mix/score.js';
import { placementOf, placementGap, placementReading, MOST_OFF_CENTRE } from '../src/mix/placement.js';
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
  return { whole: 0, bands: Object.fromEntries(STEREO_BANDS.map((band, i) => [band.id, i === 3 ? off : 0])) };
};

const axisFor = (kind) => {
  if (kind === 'crest') return { kind: 'whole' };
  if (kind === 'balance') return { kind: 'thirds', ids: THIRDS };
  return BANDS;
};

test('a reading inside its tolerance is a hit, outside twice it is a miss', () => {
  const tolerance = toleranceFor('medium');

  assert.equal(markReading('loudness', loud(-14), loud(-14.5), tolerance).mark, HIT);
  assert.equal(markReading('loudness', loud(-14), loud(-15), tolerance).mark, NEAR);
  assert.equal(markReading('loudness', loud(-14), loud(-17), tolerance).mark, MISS);
});

test('every marked reading has a name and a tolerance at every tier', () => {
  for (const kind of MARKED) {
    assert.ok(READING_NAMES[kind], `${kind} has no name`);
    for (const tier of Object.keys(MIX_TOLERANCE)) {
      assert.ok(MIX_TOLERANCE[tier][kind] > 0, `${kind} has no tolerance at ${tier}`);
    }
  }
});

test('the tolerances tighten as the tier does', () => {
  for (const kind of MARKED) {
    assert.ok(MIX_TOLERANCE.easy[kind] > MIX_TOLERANCE.medium[kind], kind);
    assert.ok(MIX_TOLERANCE.medium[kind] > MIX_TOLERANCE.hard[kind], kind);
  }
});

/** Five readings, each a given number of decibels out. */
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
