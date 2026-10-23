// What a reading is.
//
// Six tools, and an audit that found five different shapes of reading between
// them: a bare Float64Array, a per-sample Float32Array with three numbers
// beside it, two identical band-and-time profiles, a nest of six bands of five
// statistics, and an object with numeric keys. Two of the six cached nothing at
// all. Four of them had a way to compare two readings, in three different
// conventions, and one of those four is not a pairwise metric.
//
// None of that is wrong. Each payload is calibrated, tested, and says exactly
// what its tool needs to say - translating them into one shape would be lossy
// for no gain. So the payloads stay verbatim. What gets unified is the
// envelope around them and the operations on them, which is all anything
// outside a tool ever needed.
//
// The envelope exists to answer one question the old readings could not: what
// is this a reading OF. Three bugs were shipping because nothing could ask.
// The imager painted a live goniometer beside band bars up to a debounce old,
// in the same frame, disagreeing. The saturator did the same with its curve
// and its harmonics, under a comment promising they redrew together. The
// compressor kept drawing a gain-reduction trace for a loop that was no longer
// loaded. All three are one missing field.

/**
 * A stable stamp for whatever a tool's settings are.
 *
 * Settings are plain objects, except the EQ's, which are an array of band
 * objects - so this walks rather than assuming. Keys are sorted, because
 * `{a:1,b:2}` and `{b:2,a:1}` are the same settings and JSON.stringify says
 * otherwise. Numbers are rounded to six places: a slider that reports
 * 0.30000000000000004 has not moved.
 */
export function stampOf(value) {
  if (value === null || value === undefined) return String(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value.toFixed(6) : String(value);
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stampOf).join(',')}]`;

  return `{${Object.keys(value).sort().map((key) => `${key}:${stampOf(value[key])}`).join(',')}}`;
}

/**
 * A reading, in its envelope.
 *
 * `of` is the whole point: the settings this was taken of, the material it was
 * taken over, and the axis the values are indexed by. A poller compares
 * `of.state` with what the tool is set to now and knows whether what it is
 * about to paint is current.
 *
 * `of.axis` closes a latent one. `profileDistance` walks `a.length` and never
 * looks at `b.length`, so two decay profiles were silently assumed to share a
 * time axis that neither of them carried any record of. Now they carry one,
 * and a comparison across two different axes is refused rather than averaged.
 */
export function readingOf({ tool, kind, of, values, ready = true }) {
  return { tool, kind, ready, of, values };
}

/**
 * A reading that has not been taken yet.
 *
 * Never null. `read()` is synchronous and a caller that has to branch on null
 * before it can ask what tool it is holding will get that branch wrong once.
 * What a tool hands back before its first measurement is an envelope with
 * everything but the values, and `ready: false` on the front of it.
 */
export const notReady = ({ tool, kind, of }) =>
  readingOf({ tool, kind, of, values: null, ready: false });

/** Is this reading of the settings the tool is on now? */
export const isCurrent = (reading, state) =>
  !!reading && reading.ready && reading.of.state === stampOf(state);

/**
 * A gap between two readings, in one shape.
 *
 * `off` is always decibels and always positive - how far apart. `where` is
 * always a label, never an index: the saturator's comparator returned the
 * number 3 and left every caller to turn it into "3rd harmonic" itself.
 * `detail` is whatever else that kind of reading knows, and is the only part
 * a caller has to know the kind to read.
 */
export const gapOf = ({ off, where = null, detail = {} }) =>
  ({ off: Math.abs(off), where, detail });

/**
 * Two readings that can be compared at all.
 *
 * Same kind, both ready, same axis. The axis check is the one that has never
 * been made: it is cheap, it is exactly the assumption every comparator here
 * quietly relies on, and being wrong about it produces a number rather than an
 * error - which is the worst way to be wrong.
 */
export function comparable(a, b) {
  if (!a?.ready || !b?.ready) return 'one of these has not been measured yet';
  if (a.kind !== b.kind) return `a ${a.kind} reading cannot be compared with a ${b.kind} one`;
  if (stampOf(a.of.axis) !== stampOf(b.of.axis)) {
    return `these two ${a.kind} readings are on different axes`;
  }
  return null;
}
