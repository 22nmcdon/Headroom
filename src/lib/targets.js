// What the places a record gets played ask for, and what they do to it if it
// does not comply.
//
// Every other number in this project is measured. These cannot be: they are
// somebody's published policy, and policy changes without telling anybody.
// So this file is the one place in the app where a figure is a claim rather
// than a measurement, and it is built to say so - every row carries where it
// came from and how direct that source is, and the whole table carries the
// date it was last looked at.
//
// What IS measured here is everything downstream of the figures: the gain a
// service applies, where that leaves the true peak, and what two masters of
// the same music sound like once they have both been normalised. That is the
// part worth teaching, and it does not depend on the table being current.
//
// The one thing to understand before reading any of it: loudness
// normalisation means the loudness war is over and nobody can win it. A
// master at -8 LUFS is not played at -8 LUFS. It is turned down six decibels
// and played at the same loudness as everybody else's, having spent its
// dynamics to get there. What the listener hears is not "louder", it is
// "flatter". The table below is how to check that for a given master, and
// `deliveryOf` is the arithmetic.

/**
 * When these figures were last reviewed.
 *
 * Not when the file was last edited - when somebody last went and read the
 * sources. The two come apart immediately and the second is the only one that
 * matters, so it is written down rather than inferred from a commit date.
 *
 * A figure a year past this date should be assumed wrong. The services change
 * these quietly and do not announce it; the standards do not change often and
 * announce it when they do.
 */
export const TARGETS_CHECKED = '2026-10-30';

/**
 * How much weight a row's figures carry.
 *
 * Worth stating per row rather than once, because the spread is wide and it
 * is not obvious from the outside. Two of these are published standards with
 * document numbers; one is a company's own guidance to the people delivering
 * to it; the rest is the trade press and the mastering blogs agreeing with
 * each other, which is a weaker thing than it looks - they also cite each
 * other.
 */
export const SOURCE_KINDS = {
  standard: 'a published standard',
  published: 'the service\'s own guidance',
  secondary: 'widely reported, no first-party source found',
};

/**
 * Where a record gets played, and what each place asks for.
 *
 *   lufs      the integrated loudness it normalises to
 *   peak      the true-peak ceiling it asks a delivered file to respect
 *   loudPeak  a tighter ceiling, and `loudAbove` the loudness it applies past
 *   turnsUp   whether a master quieter than the target is turned up to it
 *   tolerance how far off the target still counts as on it, where one is given
 *
 * `turnsUp` is the field that catches people out and the reason it is here.
 * A service that only ever turns down means a quiet master simply plays quiet
 * - the normalisation does not rescue it - and a service that turns up means
 * a quiet master's true peak goes up with it, which is where the peak ceiling
 * stops being paperwork.
 */
export const TARGETS = [
  {
    id: 'spotify',
    name: 'Spotify',
    lufs: -14,
    peak: -1,
    // The conditional ceiling, which is theirs and is worth copying exactly:
    // under -14 LUFS keep the peak under -1 dBTP, and if the master is louder
    // than -14 keep it under -2, because a loud master is about to be turned
    // down and then encoded, and the encoder reconstructs a waveform that the
    // samples only imply.
    loudPeak: -2,
    loudAbove: -14,
    turnsUp: true,
    from: 'published',
    says: 'Normalises to -14 LUFS to ITU-R BS.1770. Listeners can choose Loud '
        + '(-11), Normal (-14) or Quiet (-19); on Loud, a limiter is applied to '
        + 'quiet dynamic tracks so turning them up cannot clip.',
  },
  {
    id: 'apple',
    name: 'Apple Music',
    lufs: -16,
    peak: -1,
    turnsUp: true,
    from: 'secondary',
    // Worth saying plainly: this is the figure everybody repeats and nobody
    // sources. Apple's own documentation describes Sound Check as a feature
    // and does not publish a target, so -16 is the trade's reverse-engineered
    // consensus rather than a specification. Treated here as what it is.
    says: 'Sound Check, reported at -16 LUFS. Apple publishes no target '
        + 'figure; this is the trade consensus and nothing more.',
  },
  {
    id: 'youtube',
    name: 'YouTube',
    lufs: -14,
    peak: -1,
    // The important one. YouTube turns loud things down and leaves quiet
    // things alone, so a quiet master is not rescued - it just plays quiet
    // next to everything else.
    turnsUp: false,
    from: 'secondary',
    says: 'Reported at -14 LUFS, and only ever downward: a master quieter '
        + 'than the target is left where it is.',
  },
  {
    id: 'amazon',
    name: 'Amazon Music',
    lufs: -14,
    peak: -1,
    turnsUp: true,
    from: 'secondary',
    says: 'Reported at -14 LUFS, normalised per track.',
  },
  {
    id: 'tidal',
    name: 'Tidal',
    lufs: -14,
    peak: -1,
    turnsUp: true,
    from: 'secondary',
    says: 'Reported at -14 LUFS, normalised per album.',
  },
  {
    id: 'deezer',
    name: 'Deezer',
    lufs: -15,
    peak: -1,
    turnsUp: true,
    from: 'secondary',
    says: 'Reported at -15 LUFS. The figure traces back to a forum post '
        + 'relaying their developers rather than to a document.',
  },
  {
    id: 'r128',
    name: 'EBU R 128',
    lufs: -23,
    peak: -1,
    tolerance: 0.5,
    // Not a normaliser. A delivery specification: the file is expected to
    // arrive at the target rather than be moved to it, which is why the
    // tolerance exists and why `turnsUp` is meaningless here.
    turnsUp: null,
    from: 'standard',
    says: 'European broadcast. -23 LUFS programme loudness, -1 dBTP maximum, '
        + 'measured to ITU-R BS.1770. -2 dBTP where a data-reduction codec is '
        + 'downstream. The file is expected to arrive on target, not be moved '
        + 'to it.',
  },
  {
    id: 'atsc',
    name: 'ATSC A/85',
    lufs: -24,
    peak: -2,
    tolerance: 2,
    turnsUp: null,
    from: 'standard',
    says: 'US broadcast. -24 LKFS, which is the same measurement as LUFS '
        + 'under a different name - the one decibel between this and R 128 is '
        + 'a real difference and not a units mix-up.',
  },
];

/** A target by id, or null. */
export const targetOfId = (id) => TARGETS.find((target) => target.id === id) ?? null;

/**
 * The true-peak ceiling this target asks of a master at this loudness.
 *
 * One function rather than a field, because Spotify's is conditional and
 * writing that out at every call site is how it ends up applied in some
 * places and not others.
 */
export function ceilingAsked(target, lufs) {
  if (target.loudPeak === undefined) return target.peak;
  if (!Number.isFinite(lufs)) return target.peak;
  return lufs > target.loudAbove ? target.loudPeak : target.peak;
}

/**
 * What this place would do to this master.
 *
 * `values` is a loudness reading's values - `integrated` and `truePeak`, in
 * LUFS and dBTP. Everything here is arithmetic on those two, and the
 * arithmetic is the lesson:
 *
 *   - `gain` is what the service applies. Exactly the gap to its target,
 *     unless it only turns things down, in which case a quiet master gets
 *     nothing.
 *   - `played` is the loudness the listener actually gets. For most services
 *     this is their target whatever you delivered, which is the whole point:
 *     mastering louder does not make it play louder. At a delivery standard
 *     it is whatever you delivered, because nothing is going to move it.
 *   - `peak` is where the true peak lands after that gain. A master being
 *     turned down cannot clip at playback. A master being turned UP can, and
 *     that is the case the peak ceiling is really about.
 *   - `short` is how far under the target it still plays, which is only ever
 *     non-zero at a service that refuses to turn things up.
 *
 * Nothing here is clamped or rounded. A service that would turn a master up
 * fourteen decibels is told so, because that is a real thing to know about a
 * master and hiding it behind a sensible-looking number would not help.
 */
export function deliveryOf(values, target) {
  const lufs = values?.integrated;
  const truePeak = values?.truePeak;

  if (!Number.isFinite(lufs)) {
    return { gain: 0, played: null, peak: truePeak ?? null, short: 0, asked: target.peak, over: null, meets: false };
  }

  const wanted = target.lufs - lufs;
  // Three behaviours, not two. A service that normalises applies the whole
  // gap; one that only turns down applies it when it is negative; and a
  // delivery standard applies nothing at all - it expects the file to arrive
  // on target rather than moving it there. The first version treated that
  // last case as a normaliser and reported a broadcast master as playing at
  // -23 LUFS whatever had been handed over, which is the opposite of what a
  // specification means.
  const gain = target.turnsUp === null ? 0
    : target.turnsUp === false ? Math.min(0, wanted)
      : wanted;
  const asked = ceilingAsked(target, lufs);
  const over = Number.isFinite(truePeak) ? truePeak - asked : null;

  return {
    gain,
    played: lufs + gain,
    peak: Number.isFinite(truePeak) ? truePeak + gain : null,
    // What it still gives away at a service that will not turn it up.
    short: target.turnsUp === false ? Math.max(0, wanted) : 0,
    asked,
    over,
    // How far off its stated number the file is, which only a target with a
    // tolerance is actually asking about.
    off: -wanted,
    // On target within whatever tolerance it gives, and under its ceiling.
    // A service with no stated tolerance is not asking you to hit a number -
    // it is going to move you to it - so what "meets" means there is only the
    // ceiling.
    meets: (over === null || over <= 0)
      && (target.tolerance === undefined || Math.abs(wanted) <= target.tolerance),
  };
}

/**
 * Two masters of the same music, as a listener would hear them.
 *
 * The comparison the whole module exists for. Both are normalised to the same
 * target, so whatever is left between them is not loudness - it is what each
 * one spent getting there.
 *
 * `quieter` is how much quieter the first one still plays, which is zero
 * almost everywhere: a normalising service makes that difference go away, and
 * seeing it go away is the point. It is non-zero only where the service
 * refuses to turn something up.
 *
 * `lost` is the peak-to-loudness ratio the first one has against the second.
 * Negative means yours is flatter, and flatter at the same loudness is the
 * only thing a loudness war ever buys you.
 *
 * Peak-to-loudness ratio survives normalisation untouched, and that is not an
 * accident of the arithmetic - it is the reason it is the right thing to
 * compare. Normalisation is a gain, a gain moves the peak and the loudness by
 * the same amount, so the gap between them is exactly what a service cannot
 * give back. Whatever a master spent to get loud, it has still spent after
 * the service has turned it down again.
 */
export function matchedAgainst(mine, theirs, target) {
  const ours = deliveryOf(mine, target);
  const other = deliveryOf(theirs, target);

  const plrOf = (values) => (
    Number.isFinite(values?.truePeak) && Number.isFinite(values?.integrated)
      ? values.truePeak - values.integrated
      : null
  );

  const minePlr = plrOf(mine);
  const theirsPlr = plrOf(theirs);

  return {
    mine: ours,
    theirs: other,
    quieter: Number.isFinite(ours.played) && Number.isFinite(other.played)
      ? ours.played - other.played
      : null,
    lost: minePlr === null || theirsPlr === null ? null : minePlr - theirsPlr,
    plr: { mine: minePlr, theirs: theirsPlr },
  };
}
