// Accidentals, set properly.
//
// This began as a chord-symbol engraver, with extensions riding above the
// baseline and accidentals borrowed from the serif because the hand face has
// no flat or sharp glyph. The chord symbols are gone and the hard part stayed:
// deciding whether the b in a piece of text is a flat or a letter, which turns
// out to matter far more for a tool that writes sentences than it ever did for
// one that wrote "m7b5".

const FLAT = '♭';
const SHARP = '♯';

/**
 * Is the character at @p i an accidental, or just a letter?
 *
 * A proper ♭ or ♯ always is. An ASCII b or # only is when it is hanging off a
 * note name or a figure and no word continues past it - "Bb", "7b9", "m7b5"
 * yes; "beats", "back", "thumb" no. Reading every b as a flat was fine while
 * the only things engraved were chord symbols, and stopped being fine the
 * moment a mode wrote a sentence: the compressor reported that a duck "never
 * comes ♭ack up", and a rhythm two beats out was "2 ♭eats".
 */
function isAccidental(text, i) {
  const character = text[i];
  if (character === FLAT || character === SHARP) return true;
  if (character !== 'b' && character !== '#') return false;

  // A letter after it means a word is carrying on through it.
  if (/[A-Za-z]/.test(text[i + 1] ?? '')) return false;

  // And it has to be attached to something an accidental can belong to.
  const before = text[i - 1] ?? '';
  return before === '' || /[A-G0-9]/.test(before);
}

/** Appends @p text to @p parent, with accidentals in their own serif span. */
function writeWithAccidentals(parent, text) {
  let run = '';

  const flush = () => {
    if (run) parent.appendChild(document.createTextNode(run));
    run = '';
  };

  for (let i = 0; i < text.length; i += 1) {
    const character = text[i];

    if (isAccidental(text, i)) {
      flush();
      const accidental = document.createElement('span');
      accidental.className = 'acc';
      accidental.textContent = character === '#' ? SHARP : character === 'b' ? FLAT : character;
      parent.appendChild(accidental);
    } else {
      run += character;
    }
  }

  flush();
}

/**
 * A reading, written into @p target with its accidentals set: "3.15k", "B♭",
 * "−4.5 dB", "120 / 100 / 80%".
 *
 * Every slash is kept. This was `engraveNote`, which split on the first one
 * to set a note's second spelling ("A♯/B♭") quieter - and with no two-spelling
 * note left to write, all that split did was drop the third value off any
 * reading with two slashes in it.
 */
export function engrave(target, text) {
  target.textContent = '';
  writeWithAccidentals(target, text);
  return target;
}
