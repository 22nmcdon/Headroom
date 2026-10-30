// What a mix exercise asks for.
//
// A target mix over the four stems, made from a seed, so a round is a
// function of its seed the way every other round in this app is. The answer
// is a set of fader positions; what you are marked on is the master they
// make, which is not the same thing and is the whole point - two different
// sets of moves that end up sounding the same are the same answer.
//
// Every number is on a grid the controls are also on. A target of +4.37 dB
// on a fader that moves in half-decibels is a round nobody can win, and a
// tolerance wide enough to forgive it is a tolerance wide enough to forgive
// everything.

import { mulberry32 } from '../lib/random.js';
import { toStep } from '../learn/work/scoring.js';
import { STEM_FLAT, STEMS, STEM_IDS, PIECE_IDS } from './piece.js';
import { EQ_REST } from '../sketch/knobs.js';

/** What a fader, a pan, a send and a tone control move in. Targets sit on these too. */
export const STEPS = { gain: 0.5, pan: 0.05, send: 0.05, tone: 0.5 };

/** How far a fader goes, in decibels against where the stem arrives. */
export const TRIM = { low: -12, high: 9 };

/**
 * The three tiers, as what gets moved rather than as how hard it is.
 *
 * Difficulty here is not a smaller tolerance over the same exercise: it is
 * more things to hear at once. Levels alone is a different job from levels
 * and placement, and both are a different job from levels, placement and a
 * room. The tolerances tighten as well, because somebody doing the hard one
 * has heard the easy one.
 */
export const MIX_TIERS = {
  easy: {
    label: 'Levels',
    blurb: 'Two parts are in the wrong place. Put them where they belong.',
    moves: 2,
    pans: 0,
    sends: 0,
    gain: [-6, 6],
  },
  medium: {
    label: 'Levels and placement',
    blurb: 'All four levels, and two of them are off to one side.',
    moves: 4,
    pans: 2,
    sends: 0,
    gain: [-7, 7],
    pan: [0.2, 0.55],
  },
  hard: {
    label: 'The whole desk',
    blurb: 'Every level, where things sit, and how much room they are in.',
    moves: 4,
    pans: 3,
    sends: 2,
    gain: [-8, 8],
    pan: [0.15, 0.7],
    send: [0.15, 0.6],
  },
  // A different job rather than a harder one, which is what the three above
  // are to each other as well. The levels, the placement and the room are
  // given right and two parts are the wrong colour.
  //
  // Nothing else moves, and that is the point rather than a simplification:
  // the reading this is marked on is `balance`, which is also where a level
  // error lands, so a round that asked for both would leave the advice unable
  // to say which of the two you had got wrong.
  tone: {
    label: 'Tone',
    blurb: 'The levels are right. Two parts are the wrong colour.',
    moves: 0,
    pans: 0,
    sends: 0,
    tones: 2,
    gain: [0, 0],
    tone: [3, 8],
  },
  // The one tier whose fault is in the material rather than in the brief.
  //
  // Nothing is put wrong. The four parts arrive flat and two pairs of them
  // are already in each other's way - measured on the flat mix of
  // short-night, the kick and the bass read 23.6 and 23.1 dB at 125 Hz, half
  // a decibel apart, and everything the kick does below 160 the bass is doing
  // too. The answer is the carve that makes room, and the round is to find
  // how much.
  //
  // Which is also why it is marked on `share` and not on `balance`: the
  // problem does not exist in the sum. By the time the master is read, 23.6
  // and 23.1 have been added together and what is left is a low end. See
  // `share.js`.
  // Front to back, which on this desk is three controls and not four.
  //
  // Distance has four classic cues - quieter, duller, more reverb, and the
  // reflections arriving sooner after the direct sound - and the fourth one
  // is not a per-part control here. There is one reverb and everything shares
  // it, so its pre-delay is a property of the room rather than of any part in
  // it; moving it moves everybody at once, which is a different question (how
  // big is the room) from this one (how far back is this part).
  //
  // The other three are measured. A send of 0.3 on the keys puts the return
  // 14.84 dB under the mix and 0.5 puts it at 10.53, so the room reads the
  // send to a third of a decibel; a fader is `levels`; and the air comes off
  // `share`'s top register. See DEPTHS and AIRY.
  depth: {
    label: 'Front to back',
    blurb: 'Everything is where it should be left to right. Two parts are at the wrong distance.',
    moves: 0,
    pans: 0,
    sends: 0,
    gain: [0, 0],
    depths: true,
  },
  carve: {
    label: 'Making room',
    blurb: 'Nothing is in the wrong place. Two pairs of parts are in the same place.',
    moves: 0,
    pans: 0,
    sends: 0,
    gain: [0, 0],
    carves: true,
    tone: [3, 7],
  },
};

export const MIX_TIER_IDS = Object.keys(MIX_TIERS);

/** A stem's gain, from decibels against the flat position. */
export const gainFor = (db) => STEM_FLAT.gain * 10 ** (db / 20);

/** And back, which is what a fader shows. */
export const dbOf = (gain) => 20 * Math.log10(Math.max(gain, 1e-6) / STEM_FLAT.gain);

/** Some of a list, shuffled, so the same two are not always the ones. */
function some(rng, list, count) {
  const ids = [...list];
  for (let i = ids.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids.slice(0, Math.min(count, ids.length));
}

const between = (rng, [low, high]) => low + rng() * (high - low);

/** The smallest level move a round is allowed to ask for. */
export const LEAST = 3;

/**
 * A number somewhere in a range but never near nothing.
 *
 * A "move" of 0.3 dB is not a move: it is inside everybody's tolerance and
 * inside the answer's own, so the round would be asking for something that
 * is already true. Three decibels is the floor, and it is a floor rather
 * than a taste: measured, a stem two decibels out of place reads inside the
 * easy tier's tolerance on four of the five readings, so a round built on
 * smaller moves than that would arrive already solved.
 */
function worthIt(rng, range, least, step) {
  const raw = between(rng, range);
  const away = Math.abs(raw) < least ? Math.sign(raw || 1) * least : raw;
  return toStep(away, step);
}

/**
 * Which stems a round is allowed to move.
 *
 * Not the drums, and not only because a hard-panned kit is a strange mix.
 * Something has to be the thing everything else is set against, and on every
 * desk in the world that is the drums - a round where all four parts float
 * is a round with no reference level in it at all, and what comes back is
 * the right mix at the wrong loudness, every time.
 */
export const ANCHOR = 'kit';
export const MOVABLE = STEM_IDS.filter((id) => id !== ANCHOR);

/**
 * Which band each stem is moved in, and why it is only one.
 *
 * An EQ insert is markable where a compressor insert is not, and this is the
 * table that says where. Measured on both pieces, a single band moved on one
 * stem, read as the gap it opens on the master's `balance` reading against
 * the same mix flat:
 *
 *     piece         stem    band     +2     +3     +4     +5     +6
 *     short-night   bass    low    1.14   1.67   2.17   2.64   3.07
 *     short-night   bass    mid    0.29   0.46   0.65   0.86   1.09
 *     short-night   bass    high   0.29   0.47   0.67   0.91   1.17
 *     short-night   keys    low    0.38   0.61   0.87   1.16   1.48
 *     short-night   keys    mid    0.75   1.13   1.51   1.88   2.24
 *     short-night   keys    high   0.30   0.49   0.70   0.94   1.21
 *     short-night   pad     low    0.35   0.56   0.80   1.06   1.36
 *     short-night   pad     mid    1.38   2.06   2.74   3.40   4.05
 *     short-night   pad     high   0.28   0.45   0.64   0.86   1.10
 *     late-room     bass    low    0.50   0.76   1.03   1.29   1.54
 *     late-room     bass    mid    0.14   0.22   0.30   0.40   0.51
 *     late-room     bass    high   0.15   0.24   0.35   0.46   0.59
 *     late-room     keys    low    0.27   0.44   0.63   0.84   1.08
 *     late-room     keys    mid    0.36   0.57   0.81   1.06   1.33
 *     late-room     keys    high   0.21   0.34   0.48   0.64   0.82
 *     late-room     pad     low    0.35   0.57   0.81   1.08   1.39
 *     late-room     pad     mid    1.13   1.68   2.20   2.70   3.17
 *     late-room     pad     high   0.29   0.46   0.66   0.89   1.14
 *
 * Every row rises with the move, which is the first thing a control has to
 * do and the thing a compressor insert could not: measured the same way, a
 * loudness-matched compressor's effect on the master's `crest` reading was
 * not monotonic in its own threshold, and sixteen decibels of reduction on
 * the bass moved it 0.49 dB against a tolerance of 0.45.
 *
 * What the table decides is the band. A high-shelf move never reaches 1.21 on
 * any stem of either piece, and a low-shelf move only does on the bass -
 * because that is where the energy is, and a band with nothing in it cannot
 * be heard to change. So each stem is moved in the one band it lives in, and
 * the round is never asked to hear something that is not there.
 */
export const TONE_BANDS = { bass: 'low', keys: 'mid', pad: 'mid' };

/**
 * The smallest tone move a round is allowed to ask for.
 *
 * Three decibels, for the reason the level floor is three decibels: anything
 * less arrives already solved. The quietest of the six pairs above is
 * late-room's keys at the mid, which reads 0.36 at two decibels and 0.57 at
 * three - and the tone tier's balance tolerance is 0.5, so two is inside it
 * and three is not. The floor is the measurement rather than a taste.
 */
export const TONE_LEAST = 3;

/**
 * Which part is in whose way, and in which register.
 *
 * Measured rather than picked, on both pieces, as each part's share of each
 * register against the mean of the parts (see `share.js`):
 *
 *     short-night        low     mid    high        late-room      low     mid    high
 *     kit               9.61   -3.35   13.41        kit          10.67   -8.19   15.24
 *     bass              9.24  -11.61  -20.42        bass          7.26   -2.28  -14.67
 *     keys             -1.58    6.04   -8.52        keys          2.72   -1.07  -17.73
 *     pad             -17.27    8.93   15.53        pad          -20.65   11.54   17.16
 *
 * Two pairs stand out and they are the same two on both pieces. The kick and
 * the bass are within three and a half decibels of each other in the low on
 * both - on short-night, within a third of one - which is the oldest problem
 * in mixing. The pad sits above the keys in the mid by three decibels on one
 * piece and twelve on the other, which is the next oldest.
 *
 * The masker is what moves, never the part being masked, and that is the
 * lesson rather than a simplification: the thing to reach for is the control
 * on whatever is covering the sound you cannot hear, not the control on the
 * sound you cannot hear. A boost on the buried part puts two things in one
 * place louder.
 *
 * Which band each masker moves in is `TONE_BANDS`, already, and not by luck -
 * it is the band that stem lives in, which is the same question.
 */
export const CARVES = [
  { masker: 'bass', masked: 'kit', band: 'low' },
  { masker: 'pad', masked: 'keys', band: 'mid' },
];

/**
 * What each part is called in the brief's own sentence, and its possessive.
 *
 * The possessive travels with the name rather than being worked out from it,
 * for the reason the plural verb does in `score.js`: the keys are plural, so
 * it is the keys' way and not the keys's way, and guessing at that from a
 * four-item table is harder than writing the four down. The kit is the kick
 * here because that is what is being covered - a bass guitar is not in the
 * way of a hi-hat.
 */
export const CARVE_NAMES = {
  kit: { name: 'kick', own: "kick's" },
  bass: { name: 'bass', own: "bass's" },
  keys: { name: 'keys', own: "keys'" },
  pad: { name: 'pad', own: "pad's" },
};

/**
 * The smallest carve a round is allowed to ask for, and the largest.
 *
 * Three decibels for the reason every other floor here is three decibels:
 * measured, the `share` reading moves 0.48 dB for every decibel of the bass's
 * low shelf and 0.19 for every decibel of the pad's bell, so a two decibel
 * carve on the pad reads 0.38 and the tolerance is 0.4 - a round asking for
 * one would arrive already solved. Seven at the top because the controls stop
 * being a carve and start being a hole: eight decibels off the bass below 120
 * is a mix with no bottom rather than a mix with room in it.
 */
export const CARVE_LEAST = 3;

/** Which stems a round lets you colour, and in which band. */
export function colouring(tier) {
  const spec = MIX_TIERS[tier] ?? MIX_TIERS.easy;
  if (spec.depths) return AIRY.map((id) => ({ id, band: 'high' }));
  if (spec.carves) return CARVES.map(({ masker, band }) => ({ id: masker, band }));
  if (spec.tones) return TONED.map((id) => ({ id, band: TONE_BANDS[id] }));
  return [];
}

/**
 * Which band of a stem is off flat, and by how much, or nothing.
 *
 * The band comes from the settings rather than from `TONE_BANDS`, which it
 * used to, and that was wrong the moment a second tier moved a stem somewhere
 * else: a distance round rolls the top off the pad, and the table says the
 * pad's band is the mid, so the reveal read out a mid move that had not
 * happened. One band a stem is still true of any one round - no round moves
 * two bands of one part - and the first one found is that band.
 */
export function toneAt(set) {
  const eq = set?.settings?.eq;
  if (!eq) return null;
  for (const band of ['low', 'mid', 'high']) if (eq[band]) return { band, db: eq[band] };
  return null;
}

/** How far off flat a stem's tone is, in decibels, or zero. */
export const toneIn = (set) => toneAt(set)?.db ?? 0;

/** Which stems a tone round is allowed to colour. */
export const TONED = STEM_IDS.filter((id) => id in TONE_BANDS);

/**
 * How far each stem is allowed off centre, and into the room.
 *
 * A level is a level and any stem can be at any of them. Where a thing sits
 * is not like that: a bass hard right is a mix nobody has ever made, and a
 * round that asked for one would be teaching an ear to expect something it
 * will never meet again. So the bass gets a quarter of the field and a
 * quarter of the room, and the parts that really do move get all of it.
 */
export const ROOM_FOR = { bass: 0.25, keys: 1, pad: 1, kit: 0 };

/**
 * Three distances, as what each one does to a part.
 *
 * A distance rather than three independent numbers, and that is the lesson:
 * far away is quieter AND duller AND wetter, all at once and in proportion.
 * One of them alone does not read as distance - a part that is only quiet is
 * a part that is turned down, and a part that is only wet is a part with an
 * effect on it.
 *
 * The amounts are chosen so that neighbouring distances are plainly
 * different, and every one of the three was set from a measurement. The room:
 * nothing at the front, 18.3 dB under the mix at a step back and 11.4 at the
 * back, which is seven decibels between neighbours against a tolerance of two.
 * The faders: three decibels apart, which reads 2.25 against a tolerance of
 * 0.7.
 *
 * The air is the one that had to be pushed. At -3 and -7 it was so weak that
 * a learner could leave it flat and still pass: seven decibels off the pad's
 * top read 0.54 where the tolerance has to forgive a step of fader at 0.38.
 * So the back of the room rolls off twelve decibels rather than seven, which
 * reads 0.72 and cannot be ignored. That is not a number bent to fit a test -
 * air absorption over distance really does take the top off that hard, and
 * the alternative was a control on the face that made no difference to the
 * answer. Twelve is also where the slider stops, so there was nowhere further
 * to go: if the pad had less top end than it has, this tier would have no air
 * cue in it and would have to say so.
 */
export const DEPTHS = [
  { id: 'front', label: 'up front', gain: 1.5, send: 0, air: 0 },
  { id: 'middle', label: 'a step back', gain: -1.5, send: 0.2, air: -5 },
  { id: 'back', label: 'at the back', gain: -4.5, send: 0.45, air: -12 },
];

export const DEPTH_IDS = DEPTHS.map((how) => how.id);

/**
 * Which parts a distance round moves, and which of them can lose any air.
 *
 * The two that have the whole room to move in: `ROOM_FOR` gives the bass a
 * quarter of it and the kit none, and a quarter of the room is not a distance.
 * The kit is the reference here for the reason its fader is one everywhere
 * else - something has to be the thing the others are heard against, and a
 * round where every part floats front to back is a round with no front in it.
 *
 * Only the pad loses air, and that is a measurement rather than a
 * simplification. Rolling the top off a part is a distance cue only where
 * there is top to lose, and measured as each part's share of the register
 * above 2.2 kHz, the four read: kit 13.41, pad 15.53, keys -8.52, bass
 * -20.42. Two of them have a top end and one of those two is the reference.
 * On the keys a high shelf is not an air control at all - measured, six
 * decibels off it moves that part's loudness by 0.50 dB and its share of the
 * top by the same, which is a fader with extra steps.
 */
export const AT_A_DISTANCE = STEM_IDS.filter((id) => ROOM_FOR[id] === 1);
export const AIRY = ['pad'];

/** One round: a piece, and the mix it is supposed to end up as. */
export function mixBrief(tier, seed) {
  const spec = MIX_TIERS[tier] ?? MIX_TIERS.easy;
  const rng = mulberry32(seed);

  const piece = PIECE_IDS[Math.floor(rng() * PIECE_IDS.length)];
  const target = Object.fromEntries(STEM_IDS.map((id) => [id, { ...STEM_FLAT }]));

  for (const id of some(rng, MOVABLE, spec.moves)) {
    target[id].gain = gainFor(worthIt(rng, spec.gain, LEAST, STEPS.gain));
  }

  for (const id of some(rng, MOVABLE, spec.pans)) {
    const side = rng() < 0.5 ? -1 : 1;
    target[id].pan = toStep(side * between(rng, spec.pan) * ROOM_FOR[id], STEPS.pan);
  }

  for (const id of some(rng, MOVABLE, spec.sends)) {
    target[id].send = toStep(between(rng, spec.send) * ROOM_FOR[id], STEPS.send);
  }

  // A distance for each of the two parts that can be at one, and never the
  // same distance twice: two parts at one distance is a round with no front
  // to back in it at all, which is the only thing this tier is about.
  if (spec.depths) {
    for (const id of STEM_IDS) {
      target[id].inserts = ['eq'];
      target[id].settings = { eq: { ...EQ_REST } };
    }

    const picked = some(rng, DEPTH_IDS, AT_A_DISTANCE.length);
    AT_A_DISTANCE.forEach((id, at) => {
      const how = DEPTHS.find((one) => one.id === picked[at]);
      target[id].gain = gainFor(toStep(how.gain, STEPS.gain));
      target[id].send = toStep(how.send * ROOM_FOR[id], STEPS.send);
      if (AIRY.includes(id)) target[id].settings.eq.high = toStep(how.air, STEPS.tone);
    });
  }

  // A carve: the masker in each pair pulled out of the way, which is a cut
  // and never a boost. The sign is not random the way the tone tier's is -
  // there is a right direction here and the round is only about how far.
  if (spec.carves) {
    for (const id of STEM_IDS) {
      target[id].inserts = ['eq'];
      target[id].settings = { eq: { ...EQ_REST } };
    }
    for (const { masker, band } of CARVES) {
      target[masker].settings.eq[band] = worthIt(
        rng, [-spec.tone[1], -spec.tone[0]], CARVE_LEAST, STEPS.tone,
      );
    }
  }

  // Tone, when the tier asks for it. The insert goes on every stem and not
  // only the moved ones: a track's graph is its instrument and its inserts,
  // so a change of inserts is a new graph under a running loop, and the
  // resting EQ is a wire - measured, the whole desk with one on each stem
  // came back within 6.33e-8 a sample of the same desk with none, which is
  // float32 rounding.
  if (spec.tones) {
    for (const id of STEM_IDS) {
      target[id].inserts = ['eq'];
      target[id].settings = { eq: { ...EQ_REST } };
    }

    for (const id of some(rng, TONED, spec.tones)) {
      const side = rng() < 0.5 ? -1 : 1;
      target[id].settings.eq[TONE_BANDS[id]] = worthIt(
        rng, [side * spec.tone[0], side * spec.tone[1]], TONE_LEAST, STEPS.tone,
      );
    }
  }

  return { tier, piece, target, spec };
}

/** The mix a round starts from: the stems as they arrive, flat and centred. */
export const flatMix = () => Object.fromEntries(STEM_IDS.map((id) => [id, { ...STEM_FLAT }]));

/** What the answer actually moved, for the reveal. */
export const movesIn = (mix) => STEMS
  .map((stem) => {
    const tone = toneAt(mix[stem.id]);
    return {
      id: stem.id,
      name: stem.name,
      db: toStep(dbOf(mix[stem.id]?.gain ?? STEM_FLAT.gain), 0.1),
      pan: mix[stem.id]?.pan ?? 0,
      send: mix[stem.id]?.send ?? 0,
      // `null` rather than a zero, so a reveal can tell a stem that was left
      // alone from one whose tone move happened to be nothing - which cannot
      // happen, because of the floor, and would be worth seeing if it did.
      tone,
    };
  });
