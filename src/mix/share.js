// Which part owns which register, which is what masking is about.
//
// Two parts in one place fight, and the fight does not show up in any reading
// of the sum. Measured on the flat mix of short-night, in decibels of
// third-octave energy, the kick and the bass against each other:
//
//     band     63     80    100    125    160
//     kit    27.9   30.4   30.3   23.6   17.0
//     bass   30.5   26.7   24.9   23.1   19.9
//
// Five bands, nowhere more than five and a half decibels apart, and at 125
// they are within half of one. That is the classic problem and it is really in this material:
// everything the kick does below 160 the bass is also doing, so whichever is
// louder at any moment is the only one anybody hears.
//
// `balance.js` cannot see it, because by the time it reads the master the two
// have been added together and 30.5 plus 27.9 is just a low end. `levels.js`
// cannot see it either: it reads each part, but broadband, so a bass that is
// the right loudness and all of it below 160 reads correct. What is missing
// is each part's own spread, and that is this file.
//
// It is also the reading that makes a carve markable. A round that asks for
// the bass to be cut below 120 so the kick comes through is asking for one
// number, and every other reading in `score.js` either cannot see it or sees
// it as something else.

import { averageSpectrum } from '../plugins/eq/spectrum.js';
import { THIRDS, summed } from '../analysis/balance.js';
import { readingOf, stampOf, gapOf } from '../lib/read.js';
import { STEM_IDS } from './piece.js';

/**
 * Three registers, split where the desk's three tone controls meet.
 *
 * A strip has a shelf at 120, a bell at 800 and a shelf at 6 kHz, so those
 * are the only three places a part's spread can be moved from and there is no
 * point reading it anywhere else. The edges are the geometric means of
 * neighbouring controls - 310 Hz between 120 and 800, 2.2 kHz between 800 and
 * 6000 - which is the frequency equally far from both in the units an ear
 * works in.
 *
 * Contiguous on purpose. Bands with gaps between them would leave energy in
 * no band at all, and a part could then be moved without the reading moving.
 */
export const REGISTERS = [
  { id: 'low', label: 'below 310 Hz', to: 310 },
  { id: 'mid', label: 'from 310 Hz to 2.2 kHz', to: 2200 },
  { id: 'high', label: 'above 2.2 kHz', to: Infinity },
];

export const REGISTER_IDS = REGISTERS.map((band) => band.id);

/** Which register a third-octave band falls in. */
export const registerOf = (hz) => REGISTERS.find((band) => hz < band.to) ?? REGISTERS[2];

/** One part's energy in each register, in decibels. */
export function registersOf(channels, rate) {
  const mono = { sampleRate: rate, getChannelData: () => summed(channels) };
  const power = averageSpectrum(mono, THIRDS);

  const totals = Object.fromEntries(REGISTER_IDS.map((id) => [id, { sum: 0, n: 0 }]));
  THIRDS.forEach((hz, i) => {
    const into = totals[registerOf(hz).id];
    into.sum += power[i];
    into.n += 1;
  });

  return Object.fromEntries(REGISTER_IDS.map((id) => {
    const { sum, n } = totals[id];
    return [id, 10 * Math.log10(Math.max(sum / Math.max(1, n), 1e-20))];
  }));
}

/**
 * Each part's share of each register, with the register's own level removed.
 *
 * Read against the mean of the parts in that register, for the reason
 * `levels.js` removes the mean of the parts: what is being asked is who owns
 * the low end, not how much low end there is. How much there is already has a
 * reading - `balance` - and a mix with the right shares and too much bottom
 * should fail on that one and pass here.
 *
 * It is a share and not a ratio between two named parts, although a carve is
 * about two named parts, and the arithmetic says why: if the bass's low is
 * cut by six decibels then every pair involving the bass moves by six, so a
 * worst-pair reading cannot say which pair it was. The share can - the bass
 * moved and nothing else did - and the ratio the round actually asked about
 * is the difference of two shares, which is still in here.
 */
export function sharesOf(stems, rate) {
  const parts = {};
  for (const stem of stems) {
    if (stem.kind !== 'track') continue;
    if (!STEM_IDS.includes(stem.id)) continue;
    parts[stem.id] = registersOf(stem.channels, stem.rate ?? rate);
  }

  const ids = Object.keys(parts);
  const shares = Object.fromEntries(ids.map((id) => [id, {}]));
  for (const band of REGISTER_IDS) {
    const here = ids.filter((id) => Number.isFinite(parts[id][band]));
    if (!here.length) continue;
    const mean = here.reduce((sum, id) => sum + parts[id][band], 0) / here.length;
    for (const id of here) shares[id][band] = parts[id][band] - mean;
  }

  return { parts, shares };
}

/**
 * How far below the other parts a part can be and still be compared there.
 *
 * A floor, and it is there because of a measurement that looked like a bug.
 * Cutting the pad's high shelf by six decibels moved the pad's reading in the
 * LOW register by 0.50 dB, and cutting the keys' low shelf moved the keys'
 * reading in the HIGH register by 0.68 - both of them a register the control
 * does not touch, and both reading exactly the same on two different pieces
 * of music, which is not what a measurement of two different pieces does.
 *
 * What it was: those are registers where the part has almost nothing. The
 * pad's share of the low is -17 dB and the keys' share of the high on
 * late-room is -18, which is far enough down that what the spectrum reports
 * there is not the part at all but what leaks into those bins from the part's
 * own loud bands - so boosting the loud band raises the quiet one with it,
 * decibel for decibel, which is the identical-looking number.
 *
 * Twelve decibels below the average part, which is also the honest line for
 * what this reading is for: a part that far down in a register is neither
 * masking anything there nor being masked, because nobody can hear it there.
 * The test is on the louder of the two sides, so the cell is compared
 * whenever either mix has something audible in it.
 */
export const SHARE_FLOOR = -12;

/** What a share reading is indexed by: the stems, in three registers. */
export const SHARE_AXIS = { kind: 'stem-registers', ids: STEM_IDS, bands: REGISTER_IDS };

/** The shares, in an envelope. */
export function shareReading(stems, rate, { source = null } = {}) {
  const { parts, shares } = sharesOf(stems, rate);
  return readingOf({
    tool: null,
    kind: 'share',
    of: {
      state: stampOf({ parts: Object.keys(parts).sort(), rate }),
      source,
      axis: SHARE_AXIS,
    },
    values: { parts, shares },
  });
}

/** What each register is called where somebody has to read it. */
const SAID = Object.fromEntries(REGISTERS.map((band) => [band.id, band.label]));

/**
 * How far apart two sets of shares are: the worst part in the worst register.
 *
 * The worst rather than the average, for the reason every other reading here
 * gives. A mix with one part sitting four decibels too heavy in one register
 * is a mix with a masking problem in it, and averaging over twelve numbers
 * would call it nearly right.
 */
export function shareGap(mine, theirs) {
  const a = (mine.values ?? mine).shares;
  const b = (theirs.values ?? theirs).shares;

  let off = 0;
  let where = null;
  let hotter = 0;
  let part = null;
  const each = {};

  for (const id of Object.keys(a)) {
    for (const band of REGISTER_IDS) {
      if (a[id]?.[band] === undefined || b[id]?.[band] === undefined) continue;
      if (Math.max(a[id][band], b[id][band]) < SHARE_FLOOR) continue;
      const by = a[id][band] - b[id][band];
      each[`${id}:${band}`] = by;
      if (Math.abs(by) > Math.abs(off)) {
        off = by;
        where = SAID[band];
        hotter = by;
        part = id;
      }
    }
  }

  return gapOf({ off, where, detail: { hotter, part, each } });
}

/**
 * The parts and registers that are out by more than this much, worst first.
 *
 * For the advice, which wants to name them rather than report a number.
 */
export function sharesOut(gap, allowed) {
  const each = gap.detail?.each ?? {};
  return Object.entries(each)
    .filter(([, by]) => Math.abs(by) > allowed)
    .sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]))
    .map(([key, by]) => {
      const [id, band] = key.split(':');
      return { id, band, by };
    });
}
