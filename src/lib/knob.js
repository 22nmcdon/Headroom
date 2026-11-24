// A knob, which is what every one of these controls has always been.
//
// They were sliders, and a slider is the wrong word for this. A slider says
// "a value between two numbers", which is true and is not what anybody is
// looking at when they reach for a compressor. A knob says "a control on a
// device". Six plugins made of sliders read as six forms; the same six made
// of knobs read as six instruments, and the skill this app is for is reading
// an instrument.
//
// Drop-in on purpose. Every plugin already renders
//
//   <div class="knob">… <input class="knob-dial" data-dial="id" …> …</div>
//
// and wires itself by listening for `input` events from `[data-dial]`. So
// the range input stays exactly where it is - it is still the thing that
// holds the value, still the thing a screen reader announces, still the
// thing the arrow keys move - and this dresses it: a face is built beside
// it, the input is hidden from the eye but not from the keyboard, and a
// drag on the face writes the input and fires the same `input` event the
// plugin was already listening for. Nothing in any plugin's wiring changes.
//
// The face is drawn in CSS rather than SVG or canvas, so moving a knob is
// one custom property on one element - no DOM built per frame, nothing to
// redraw, and eight of them dragging at once costs the same as one.

/** How far round the pointer travels, end to end. */
export const KNOB_SWEEP = 270;

/**
 * How far the finger moves for the whole range, in pixels.
 *
 * Measured against the thing it has to beat: the slider these replace was
 * the width of its bay, which at a phone's size was about 130 pixels for
 * the whole range - fine for a fader and far too twitchy for a threshold.
 * 180 is a comfortable thumb's travel and two and a half times the
 * resolution.
 */
export const KNOB_TRAVEL = 180;

/** And with shift held, for when the number matters more than the gesture. */
export const KNOB_FINE = 0.22;

const faceOf = (input) => input.parentElement?.querySelector('.knob-face');

/* --- typing a value ------------------------------------------------------ */

/** How big each unit a value can be written in is, against its own family. */
const UNITS = { khz: 1000, k: 1000, hz: 1, ms: 0.001, s: 1, db: 1, '%': 1 };

/**
 * A number and the unit written after it - "4.5k", "-18 dB", "120 ms",
 * "4:1", "× 0.55" - or null when there is no number in it.
 *
 * The minus sign is the typographic one as often as the ASCII one, because
 * that is what the readouts print and somebody editing one starts from it.
 */
export function readNumber(text) {
  const plain = String(text ?? '').replace(/[−–]/g, '-').replace(/×/g, '').trim().toLowerCase();
  const match = plain.match(/(-?\+?\d*\.?\d+)\s*(khz|k|hz|ms|s|db|%)?/);
  if (!match) return null;
  const number = Number(match[1].replace('+', ''));
  return Number.isFinite(number) ? { number, unit: match[2] ?? null } : null;
}

/**
 * What a typed value means on a dial, worked out from what the dial shows.
 *
 * The readout above a knob is written in the knob's own words - "1.80 s",
 * "120 ms", "6.0 kHz", "35 %" - and the setting behind it may be in seconds,
 * milliseconds, hertz or a fraction. Rather than every knob describing its
 * units, the two are compared: the number shown against the setting it shows
 * gives the scale, and a unit typed differently from the one shown is
 * converted. So "0.4k" on a knob reading "400 Hz" is 400, "1.2 s" on one
 * reading "120 ms" is 1200, and "50" on one reading "35 %" of a 0-to-1
 * setting is 0.5.
 *
 * `shown` is the readout's text and `real` the setting it is showing.
 * Returns the setting to put on, or null when nothing in `typed` is a number.
 */
export function readTyped(typed, { shown, real, max }) {
  const wanted = readNumber(typed);
  if (!wanted) return null;
  const display = readNumber(shown);

  // Settings per shown unit: 1 almost always; 0.01 for a fraction shown as a
  // percentage; whatever the two say when they can be compared at all.
  let per = 1;
  if (display && display.number !== 0 && Number.isFinite(real) && real !== 0) {
    per = real / (display.number * (UNITS[display.unit] ?? 1));
    // A display that rounds - "1.8 s" for 1.79 - should not leave the scale
    // at 0.9944; scales are powers of ten.
    per = 10 ** Math.round(Math.log10(Math.abs(per)));
  } else if (display?.unit === '%' && max <= 1.0001) {
    per = 0.01;
  }

  // A bare number is in the unit shown - except a frequency typed in hertz
  // on a knob that reads in kilohertz, which is what "400" means on a knob
  // reading "6.0 kHz": nobody types 400 kHz.
  let unit = wanted.unit ?? display?.unit ?? null;
  if (!wanted.unit && ['k', 'khz'].includes(unit) && Math.abs(wanted.number) >= 50) unit = 'hz';
  return wanted.number * (UNITS[unit] ?? 1) * per;
}

/** Where a dial's value sits in its own range, 0 to 1. */
function fractionOf(input) {
  const min = Number(input.min);
  const max = Number(input.max);
  if (!(max > min)) return 0;
  return Math.min(1, Math.max(0, (Number(input.value) - min) / (max - min)));
}

/** Put a value on a dial as if it had been dialled, and tell everyone. */
function setDial(input, value, face = faceOf(input)) {
  input.value = value;
  if (face) face.style.setProperty('--angle', `${fractionOf(input) * KNOB_SWEEP}deg`);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Back to where it rests, if it says where that is. */
function restore(input, face) {
  if (input.disabled || input.closest('.is-locked')) return;
  const rest = input.dataset.rest;
  if (rest !== undefined) setDial(input, rest, face);
}

/**
 * Type a value into a knob.
 *
 * The readout is swapped for a text field holding what it said, selected,
 * so typing replaces it. Enter or leaving the field puts the value on;
 * Escape leaves the knob as it was. What was typed is read against what the
 * readout said (see `readTyped`), so units can be the readout's or another
 * of the same kind. A log dial - `data-log` - holds octaves, and is given
 * the log of the value.
 */
function typeInto(shown) {
  const input = shown.parentElement?.querySelector('.knob-dial');
  if (!input || input.disabled || input.closest('.is-locked')) return;
  if (shown.parentElement.querySelector('.knob-entry')) return;

  const log = input.hasAttribute('data-log');
  const toReal = (raw) => (log ? 2 ** Number(raw) : Number(raw));
  const name = input.getAttribute('aria-label') ?? 'this knob';

  const entry = document.createElement('input');
  entry.type = 'text';
  entry.className = 'knob-value knob-entry';
  entry.value = shown.textContent.trim();
  entry.setAttribute('aria-label', `Type a value for ${name}`);
  entry.spellcheck = false;
  shown.hidden = true;
  shown.after(entry);
  entry.focus();
  entry.select();

  let done = false;
  const finish = (commit) => {
    if (done) return;
    done = true;
    if (commit) {
      const value = readTyped(entry.value, {
        shown: shown.textContent, real: toReal(input.value), max: toReal(input.max),
      });
      if (value !== null) {
        const min = Number(input.min);
        const max = Number(input.max);
        let dial = log ? Math.log2(Math.max(value, 1e-9)) : value;
        dial = Math.min(max, Math.max(min, dial));
        if (log) {
          // A range input snaps to its step, and a log dial's step is a two-
          // hundredth of an octave - so 1.2 s came out 1198 ms. What was typed
          // is what was meant: the step is let go for the one assignment, and
          // the plugin reads the exact value while its input event runs.
          const step = input.step;
          input.step = 'any';
          setDial(input, dial);
          input.step = step;
        } else {
          const step = Number(input.step) || 0;
          if (step > 0) dial = min + Math.round((dial - min) / step) * step;
          setDial(input, Number(dial.toFixed(6)));
        }
      }
    }
    entry.remove();
    shown.hidden = false;
    input.focus({ preventScroll: true });
  };
  entry.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); finish(true); }
    if (event.key === 'Escape') { event.preventDefault(); finish(false); }
    // The page's own keys - Space for the transport - are not for this.
    event.stopPropagation();
  });
  entry.addEventListener('blur', () => finish(true));
}

/**
 * Every knob under here, pointed where its value says.
 *
 * Called after anything sets a dial's value from code - a preset, auto gain
 * moving the makeup, a plugin rebuilding its readouts - because assigning
 * to `input.value` fires no event and nothing would otherwise know.
 */
export function paintKnobs(root) {
  for (const input of root.querySelectorAll('.knob-dial')) {
    const face = faceOf(input);
    if (face) face.style.setProperty('--angle', `${fractionOf(input) * KNOB_SWEEP}deg`);
  }
}

/**
 * Dress every bare dial under here, and make the faces draggable.
 *
 * Safe to call twice: a dial that already has a face is left alone, which
 * matters because a plugin rebuilds parts of itself - the EQ's controls
 * change shape with the band type - and the ones that did not change should
 * not be taken apart and put back.
 */
export function dressKnobs(root) {
  for (const input of root.querySelectorAll('.knob-dial')) {
    if (faceOf(input)) continue;

    const face = document.createElement('span');
    face.className = 'knob-face';
    const ticks = Array.from({ length: 11 }, (_, i) =>
      `<i style="--t:${(i * KNOB_SWEEP) / 10}deg"></i>`).join('');
    face.innerHTML = `<span class="knob-ticks">${ticks}</span><span class="knob-cap"></span>`;
    input.parentElement.insertBefore(face, input);

    // The input keeps the value and the keyboard; the face takes the
    // pointer. A range input dragged with a pointer moves horizontally,
    // which is not what a knob does, so it is taken out of the way.
    input.classList.add('is-dressed');

    let from = null;

    face.addEventListener('pointerdown', (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      // Alt-click (Option on a Mac) puts it back where it rests, the way
      // Logic and Pro Tools have it, beside the double tap below.
      if (event.altKey) {
        event.preventDefault();
        restore(input, face);
        return;
      }
      const min = Number(input.min);
      const max = Number(input.max);
      if (!(max > min)) return;

      from = { y: event.clientY, value: Number(input.value), min, max };
      face.setPointerCapture(event.pointerId);
      face.classList.add('is-held');
      // The page is not scrolling and nothing is being selected.
      event.preventDefault();
      // Focus goes to the input, so the arrows carry on from where the
      // finger left off.
      input.focus({ preventScroll: true });
    });

    face.addEventListener('pointermove', (event) => {
      if (!from) return;
      const span = from.max - from.min;
      const scale = event.shiftKey ? KNOB_FINE : 1;
      // Up is more, which is the way every knob on a screen has ever been
      // dragged and the opposite of what the raw coordinate says.
      const moved = ((from.y - event.clientY) / KNOB_TRAVEL) * span * scale;

      const next = Math.min(from.max, Math.max(from.min, from.value + moved));
      const step = Number(input.step) || 0;
      input.value = step > 0 ? Math.round(next / step) * step : next;

      face.style.setProperty('--angle', `${fractionOf(input) * KNOB_SWEEP}deg`);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const drop = (event) => {
      if (!from) return;
      from = null;
      face.classList.remove('is-held');
      try { face.releasePointerCapture(event.pointerId); } catch { /* already gone */ }
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    face.addEventListener('pointerup', drop);
    face.addEventListener('pointercancel', drop);

    // A double tap puts it back where it rests, which is the one gesture
    // every plugin has and none of these had.
    face.addEventListener('dblclick', () => restore(input, face));

    // The readout above it can be typed into: say so on it.
    const shown = input.parentElement.querySelector('output.knob-value');
    if (shown) shown.title = 'Click to type a value';
  }

  // The arrow keys still work on the input itself; this keeps the face in
  // step with them.
  if (!root.dataset.knobsWired) {
    // Click the readout, or press Enter on the knob, to type a value.
    root.addEventListener('click', (event) => {
      const shown = event.target.closest?.('output.knob-value');
      if (shown) typeInto(shown);
    });
    root.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      const input = event.target.closest?.('.knob-dial');
      const shown = input?.parentElement?.querySelector('output.knob-value');
      if (!shown) return;
      event.preventDefault();
      typeInto(shown);
    });
    root.addEventListener('input', (event) => {
      const input = event.target.closest?.('.knob-dial');
      if (!input) return;
      const face = faceOf(input);
      if (face) face.style.setProperty('--angle', `${fractionOf(input) * KNOB_SWEEP}deg`);
    });
    root.dataset.knobsWired = '1';
  }

  for (const deck of root.querySelectorAll('.plugin-controls')) spreadKnobs(deck);
  paintKnobs(root);
}

/* ---------- the More row ---------- */

/**
 * Whether each deck's More row is open, kept apart from the markup because a
 * face writes its deck again on every new state - a preset, an undo, a change
 * of space - and the row a person opened should still be open after it.
 */
const moreOpen = new WeakMap();
const moreWatched = new WeakSet();

/**
 * Tuck a deck's rarely used knobs behind a More row.
 *
 * Most rounds never touch a compressor's lookahead or a delay's diffusion,
 * and nine knobs where five would do is a face that reads as a form. So the
 * ones named here go at the end of the deck, folded, under a row that still
 * says what each is set to - "More · Lookahead 0 ms · Range 40 dB" - with any
 * that is off where it rests drawn in gold, so nothing set behind it is ever
 * set out of sight.
 *
 * Called by a face right after it writes its deck. The knobs stay inside the
 * deck element, so the listener the face hung on the deck still hears them;
 * they sit in a row of its own grid, in the same columns as the rest.
 * Open or shut is whatever this deck was last, and otherwise what the nearest
 * `[data-more]` above it says - the shell sets that per round, open on the
 * harder tiers, where these are part of the question.
 */
export function foldMore(deck, ids) {
  if (!deck) return;
  deck.querySelector(':scope > .knob-more')?.remove();
  const knobs = [...deck.querySelectorAll(':scope > .knob')]
    .filter((knob) => ids.includes(knob.querySelector('[data-dial]')?.dataset.dial));
  if (!knobs.length) return;

  // A row of the deck's own grid rather than a box inside it, so the folded
  // knobs fall into the same columns as the ones above them.
  const more = document.createElement('div');
  more.className = 'knob-more';
  more.innerHTML = '<button class="knob-more-sum" type="button" aria-expanded="false">'
    + '<span class="knob-more-word">More</span><span class="knob-more-read"></span></button>';
  more.append(...knobs);
  deck.append(more);
  showMore(more, moreOpen.get(deck) ?? deck.closest('[data-more]')?.dataset.more === 'open');
  more.firstElementChild.addEventListener('click', () => {
    const open = !more.classList.contains('is-open');
    moreOpen.set(deck, open);
    showMore(more, open);
  });
  readMore(deck);

  // The readouts are rewritten by the face whenever a value moves; the row
  // follows them rather than every face having to remember to tell it.
  if (!moreWatched.has(deck)) {
    moreWatched.add(deck);
    new MutationObserver(() => readMore(deck)).observe(deck, {
      subtree: true, childList: true, characterData: true,
    });
  }
}

function showMore(more, open) {
  more.classList.toggle('is-open', open);
  more.firstElementChild.setAttribute('aria-expanded', String(open));
}

/** Write what the folded knobs are set to into the More row. */
function readMore(deck) {
  const read = deck.querySelector(':scope > .knob-more .knob-more-read');
  if (!read) return;
  const html = [...deck.querySelectorAll(':scope > .knob-more .knob')].map((knob) => {
    const name = knob.querySelector('.knob-name')?.textContent.trim() ?? '';
    const value = knob.querySelector('output.knob-value')?.textContent.trim() ?? '';
    const dial = knob.querySelector('.knob-dial');
    const moved = dial && dial.dataset.rest !== undefined
      && Math.abs(Number(dial.value) - Number(dial.dataset.rest)) > 1e-9;
    return `<span class="knob-more-one${moved ? ' is-moved' : ''}">${name} ${value}</span>`;
  }).join('');
  if (read.innerHTML !== html) read.innerHTML = html;
}

/**
 * Open or shut every More row under `root`, and make it what rows built from
 * here on start as. A person's own opening and shutting is forgotten: this is
 * the shell starting a round.
 */
export function setMoreOpen(root, open) {
  if (!root) return;
  root.dataset.more = open ? 'open' : 'shut';
  for (const more of root.querySelectorAll('.knob-more')) {
    moreOpen.delete(more.parentElement);
    showMore(more, open);
  }
}

/**
 * How many knobs a row should hold, so the last row is never one knob.
 *
 * `n` knobs into rows of at most `fit` is a choice of column count, and the
 * grid was making it the greedy way: as many as fit, and the remainder wraps.
 * Measured across widths from 360 to 1440, every face in the app ended a deck
 * with a single stranded knob somewhere - the stereo plugin at 390, 430, 820
 * and 932, which is two phone widths and one of the three sizes the browser
 * checks run at; the reverb at 360, 500 and 1024; the EQ, saturator and delay
 * at 360 and 700. Only the compressor never did, and that was luck in its
 * knob count rather than anything it does differently.
 *
 * The fix is to take the rows the greedy count would need and then spread the
 * knobs evenly over them, which is one line of arithmetic: ceil(n / rows)
 * where rows is ceil(n / fit). Nine knobs in a width that fits eight stops
 * being 8+1 and becomes 5+4; six in a width that fits five stops being 5+1
 * and becomes 3+3. It never costs a row, because the row count is the greedy
 * one.
 *
 * It cannot always win, and does not pretend to: nine knobs two to a row is
 * 2+2+2+2+1 whatever you do with it, and so is three knobs two to a row. The
 * browser check that guards this works out whether a better split existed
 * before it complains.
 */
export function knobColumns(count, fit) {
  if (!(count > 0) || !(fit > 0)) return fit;
  return Math.ceil(count / Math.ceil(count / fit));
}

/**
 * The widths each deck was last laid out at, so this is idempotent.
 *
 * Changing the column count changes the deck's height, and a ResizeObserver
 * watching a box watches both of its sides - so without this, spreading the
 * knobs would wake the observer that then spreads them again. Keyed on the
 * width and the knob count, which are the only two things the answer depends
 * on, so the second call is a lookup and the loop stops at one pass.
 */
const spread = new WeakMap();

/**
 * Lay a deck's knobs out so the last row is not a single knob.
 *
 * The column count comes from the grid rather than from arithmetic on
 * `--deck`, because `--deck` is not what decides it: the tracks are
 * `minmax(var(--deck), 1fr)` and a track cannot be narrower than the widest
 * thing in it, so a knob whose name wraps to two lines makes its column wider
 * than the variable asks for. Measured at 430 px, the stereo deck has room
 * for six 54 px tracks and lays out five of 62.8 px, because "Low width" does
 * not fit in 54. So the browser is asked how many columns it managed, and
 * only the spread of knobs over them is changed.
 *
 * The EQ's deck is not one of these. It is flex rather than grid, because its
 * three knobs have to hold a basis of `min(var(--deck), 30%)` to survive a
 * landscape column, and three knobs two to a row strand one however they are
 * laid out - so there is nothing here for it to win.
 */
export function spreadKnobs(deck) {
  if (!deck) return;

  // Its own knobs: a More row's are a deck of their own, spread on their own.
  const count = deck.querySelectorAll(':scope > .knob').length;
  const width = Math.round(deck.getBoundingClientRect().width);
  const seen = spread.get(deck);
  if (seen && seen.width === width && seen.count === count) return;
  spread.set(deck, { width, count });

  if (!seen) {
    // Watching the deck itself rather than the chassis, because a deck inside
    // a container query can change width without the window doing anything.
    try {
      new ResizeObserver(() => spreadKnobs(deck)).observe(deck);
    } catch { /* no observer here; it will still be right on every rebuild */ }
  }

  // Back to the stylesheet's own count, so what is read next is how many the
  // grid can actually fit rather than how many it was last told to use.
  deck.style.removeProperty('grid-template-columns');
  if (count < 3) return;

  const tracks = getComputedStyle(deck).gridTemplateColumns;
  const fit = tracks && tracks !== 'none' ? tracks.split(' ').length : 0;
  if (!(fit > 1) || fit >= count) return;

  const columns = knobColumns(count, fit);
  if (columns < fit) deck.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
}
