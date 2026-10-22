// Chord symbols, as notes.
//
// Typing "Cm7 | A♭maj7 | E♭ | B♭" is four seconds of work and drawing the
// same twelve notes on a step grid is four minutes of it. For the one part
// of a sketch that is nearly always a chord part, a line of symbols is the
// fastest way in that exists - and it is the notation the idea was already
// in, because that is how anybody writes a progression down.
//
// Two jobs, kept apart: reading a symbol, which is parsing, and deciding
// which octave each note goes in, which is voicing. The first has one right
// answer and the second has taste in it, so the first is exhaustive and the
// second is one rule stated plainly.
//
// The rule: each chord is voiced to move as little as possible from the one
// before it. Four triads in root position jump around; the same four voiced
// this way keep two notes in common and move the rest by a step or two,
// which is what a pair of hands does and what makes a progression sound
// like one thing rather than four.

/** Semitones above C, for every spelling anybody types. */
const LETTERS = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/**
 * What each quality is, as semitones above the root.
 *
 * In the order they are tried, longest first, so that "maj7" is not read as
 * a major triad with a stray 7 after it and "m11" is not read as "m1" and a
 * 1. Everything here is a shape somebody would type into a lead sheet.
 */
export const QUALITIES = [
  ['maj13', [0, 4, 7, 11, 14, 21]],
  ['maj11', [0, 4, 7, 11, 14, 17]],
  ['maj9', [0, 4, 7, 11, 14]],
  ['maj7', [0, 4, 7, 11]],
  ['m11', [0, 3, 7, 10, 14, 17]],
  ['m13', [0, 3, 7, 10, 14, 21]],
  ['madd9', [0, 3, 7, 14]],
  ['mmaj7', [0, 3, 7, 11]],
  ['m9', [0, 3, 7, 10, 14]],
  ['m7b5', [0, 3, 6, 10]],
  ['m7', [0, 3, 7, 10]],
  ['m6', [0, 3, 7, 9]],
  ['dim7', [0, 3, 6, 9]],
  ['dim', [0, 3, 6]],
  ['aug', [0, 4, 8]],
  ['sus4', [0, 5, 7]],
  ['sus2', [0, 2, 7]],
  ['add9', [0, 4, 7, 14]],
  ['13', [0, 4, 7, 10, 14, 21]],
  ['11', [0, 4, 7, 10, 14, 17]],
  ['9', [0, 4, 7, 10, 14]],
  ['7', [0, 4, 7, 10]],
  ['6', [0, 4, 7, 9]],
  ['m', [0, 3, 7]],
  ['', [0, 4, 7]],
];

/** The spellings people type for the same thing. */
const SAME = [
  [/^min/, 'm'],
  [/^-/, 'm'],
  [/^maj/, 'maj'],
  [/^ma(?!j)/, 'maj'],
  [/^M(?![a-z])/, 'maj'],
  [/^Δ/, 'maj7'],
  [/^ø/, 'm7b5'],
  [/^°/, 'dim'],
  [/^\+/, 'aug'],
  [/^sus$/, 'sus4'],
];

/** The accidentals, in every character they come in. */
const RAISED = /^[#♯]/;
const LOWERED = /^[b♭]/;

/** A root: a letter and whatever accidental follows it. */
function readRoot(text) {
  const letter = LETTERS[text[0]?.toLowerCase()];
  if (letter === undefined) return null;

  let at = 1;
  let root = letter;
  while (at < text.length) {
    if (RAISED.test(text[at])) { root += 1; at += 1; } else if (LOWERED.test(text[at])) { root -= 1; at += 1; } else break;
  }

  return { root: ((root % 12) + 12) % 12, rest: text.slice(at) };
}

/** A quality, after whatever spelling of it was typed is normalised. */
function readQuality(text) {
  let rest = text;
  for (const [pattern, into] of SAME) {
    if (pattern.test(rest)) { rest = rest.replace(pattern, into); break; }
  }

  for (const [name, steps] of QUALITIES) {
    if (rest === name) return { quality: name, steps };
  }
  return null;
}

/**
 * One symbol, read.
 *
 * Returns null rather than throwing when it is not a chord: a line of these
 * is typed a character at a time, and an exception on every keystroke that
 * is not yet a chord is not an error condition, it is somebody typing.
 */
export function parseChord(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return null;

  // A slash bass, which is a different note underneath and nothing else.
  // One slash only; "C/E/G" is not a thing anybody means.
  const parts = trimmed.split('/');
  if (parts.length > 2) return null;

  // A trailing slash with nothing after it yet is somebody halfway through
  // typing one, and the chord before the slash is a perfectly good chord.
  const [body, under] = parts;
  const head = readRoot(body);
  if (!head) return null;

  const quality = readQuality(head.rest);
  if (!quality) return null;

  const bass = under ? readRoot(under) : null;
  if (under && (!bass || bass.rest)) return null;

  return {
    text: trimmed,
    root: head.root,
    quality: quality.quality,
    steps: quality.steps,
    bass: bass ? bass.root : null,
  };
}

/** A whole line of them: "Cm7 | A♭maj7 | E♭ | B♭", or spaces, or commas. */
export function parseProgression(line) {
  return String(line ?? '')
    .split(/[|,]|\s+/)
    .map((piece) => piece.trim())
    .filter(Boolean)
    .map((piece) => ({ text: piece, chord: parseChord(piece) }));
}

/* --- voicing --------------------------------------------------------------- */

/** Where a chord part sits when nothing has been played yet. */
export const MIDDLE = 60;

/**
 * How far the middle of a voicing may sit from the middle of the part.
 *
 * A fifth. Leading each note to the nearest octave of the one before it is
 * the right rule and it drifts: every tie resolves the same way, and three
 * chords of ii-V-I climb a fourth a chord and end an octave up. So the
 * voicing is led, and then the whole of it is dropped or lifted by octaves
 * until its centre is back near the middle - which moves every note
 * together and so keeps the leading intact.
 */
export const ROOM = 7;

/**
 * The notes of a chord, stacked upwards from a bottom note.
 *
 * `rotation` is which chord tone is at the bottom, which is what an
 * inversion is. Each note above it goes in the first octave that clears the
 * one below, so a stack is always in order and never doubles a note.
 */
function stack(tones, rotation, bottom) {
  const order = [...tones.slice(rotation), ...tones.slice(0, rotation)];
  const notes = [];
  let floorAt = bottom;

  for (const tone of order) {
    let pitch = tone + 12 * Math.ceil((floorAt - tone) / 12);
    if (notes.length && pitch <= notes[notes.length - 1]) pitch += 12;
    notes.push(pitch);
    floorAt = pitch;
  }

  return notes;
}

const meanOf = (notes) => notes.reduce((sum, pitch) => sum + pitch, 0) / notes.length;

/** How far one voicing is from another, counting each note's nearest neighbour. */
const travel = (notes, was) => notes.reduce(
  (sum, pitch) => sum + Math.min(...was.map((before) => Math.abs(pitch - before))),
  0,
) / notes.length;

/**
 * One chord, as pitches, voiced to move as little as possible from `was`.
 *
 * Every inversion, in each of three octaves, is built and scored: how far it
 * is from the chord before, and how far its middle has wandered from the
 * middle of the part. The best one wins.
 *
 * Doing it by candidates rather than note by note is what stops a
 * progression climbing. Leading each note to the nearest octave of the one
 * before it is the obvious rule and it drifts - every tie resolves the same
 * way, and a ii-V-I ends an octave above where it started. A whole voicing
 * scored at once cannot drift, because the drift is the thing being scored.
 *
 * The bass note of a slash chord is not part of any of that: it goes below
 * the rest and stays put, because a slash chord is about what is underneath.
 */
export function voice(chord, was = null, { centre = MIDDLE, room = ROOM } = {}) {
  if (!chord) return [];

  const tones = [...new Set(chord.steps.map((step) => (chord.root + step) % 12))];
  const from = was?.length ? was : null;

  let best = null;
  let bestScore = Infinity;

  for (let rotation = 0; rotation < tones.length; rotation += 1) {
    for (const octave of [-24, -12, 0, 12]) {
      const notes = stack(tones, rotation, centre - 6 + octave);
      const drift = Math.abs(meanOf(notes) - centre);

      // Out of the part's range at all is not a candidate.
      if (drift > room + 6) continue;

      // Movement first, then staying put, then not spreading out - the
      // weights say which matters more when two voicings are close.
      const spread = notes[notes.length - 1] - notes[0];
      const score = (from ? travel(notes, from) * 3 : 0) + drift + spread * 0.1;

      if (score < bestScore) { bestScore = score; best = notes; }
    }
  }

  const notes = best ?? stack(tones, 0, centre - 6);

  if (chord.bass !== null) {
    const root = notes[0];
    let bass = chord.bass + 12 * Math.round((root - 12 - chord.bass) / 12);
    if (bass >= root) bass -= 12;
    notes.unshift(bass);
  }

  return notes;
}

/**
 * A progression, as the notes of a clip.
 *
 * The chords are laid out evenly across the clip, which is what a line of
 * symbols means: four chords in four bars, two in two, three in a three-bar
 * clip. A remainder goes to the last one rather than being dropped, so a
 * progression always fills the clip it was typed into.
 */
export function chordNotes(line, length, { centre = MIDDLE, velocity = 72, hold = 0.98 } = {}) {
  const read = parseProgression(line).filter((piece) => piece.chord);
  if (!read.length || !(length > 0)) return [];

  const each = Math.floor(length / read.length);
  const notes = [];
  let was = null;

  read.forEach((piece, index) => {
    const start = index * each;
    const until = index === read.length - 1 ? length : start + each;
    const pitches = voice(piece.chord, was, { centre });
    // What the next chord leads from is the chord itself, not the slash
    // bass under it: a bass an octave down would drag the whole next
    // voicing after it.
    was = piece.chord.bass === null ? pitches : pitches.slice(1);

    for (const pitch of pitches) {
      notes.push({
        pitch,
        start,
        length: Math.max(1, Math.round((until - start) * hold)),
        velocity,
      });
    }
  });

  return notes;
}
