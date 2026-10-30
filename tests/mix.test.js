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
import { levelsReading, partsOut } from '../src/mix/levels.js';
import {
  sumOf, mixLoudness, staleFor, matchTrim, anchorOf, gainOfTrim, MATCH_LIMIT,
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
  if (kind === 'levels') {
    // One part out and the rest at the mean, which is the shape a single
    // fader error makes - see the note over the levels tolerances.
    return {
      parts: Object.fromEntries(STEM_IDS.map((id) => [id, -20])),
      shape: Object.fromEntries(STEM_IDS.map((id, i) => [id, i === 1 ? off : 0])),
    };
  }
  return { whole: 0, bands: Object.fromEntries(STEREO_BANDS.map((band, i) => [band.id, i === 3 ? off : 0])) };
};

const axisFor = (kind) => {
  if (kind === 'crest') return { kind: 'whole' };
  if (kind === 'balance') return { kind: 'thirds', ids: THIRDS };
  if (kind === 'levels') return { kind: 'stems', ids: STEM_IDS };
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
