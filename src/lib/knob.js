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

/** Where a dial's value sits in its own range, 0 to 1. */
function fractionOf(input) {
  const min = Number(input.min);
  const max = Number(input.max);
  if (!(max > min)) return 0;
  return Math.min(1, Math.max(0, (Number(input.value) - min) / (max - min)));
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
    face.addEventListener('dblclick', () => {
      const rest = input.dataset.rest;
      if (rest === undefined) return;
      input.value = rest;
      face.style.setProperty('--angle', `${fractionOf(input) * KNOB_SWEEP}deg`);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  // The arrow keys still work on the input itself; this keeps the face in
  // step with them.
  if (!root.dataset.knobsWired) {
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

  const count = deck.querySelectorAll('.knob').length;
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
