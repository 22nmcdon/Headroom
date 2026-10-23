// Answering by picking, rather than by dialling.
//
// Two shapes of control, written once. A chip is one of a short list - a band,
// a note value, a kind of distortion - and a dial is a number on a range. Both
// come from the same `slots` description, so whatever asks the question does
// not have to know how it will be answered.
//
// This was inside the shell, serving four modes that asked you to name what you
// heard. Those are gone, and what replaces them asks the same shape of
// question about a different subject: not "what chord was that" but "which band
// is boosted", "how much reduction is that", "even harmonics or odd". So the
// machinery outlived its callers by about a day, and moved out here to wait for
// the ones that need it.
//
// It knows nothing about a game, a tool or an engine. Hand it slots and the
// values they are on, and it draws them; ask it what it is showing, and it
// tells you. Everything else is the caller's.

/** A value from a slider, back in the units the slot is written in. */
export const dialValue = (slot, raw) => {
  const value = slot.log ? 2 ** Number(raw) : Number(raw);
  return slot.log ? value : Math.round(value / slot.step) * slot.step;
};

/** What one answer is called, for a summary line. */
export const pickedLabel = (slot, value) => {
  if (slot.kind === 'range') return slot.format(value);
  const option = slot.options.find((o) => o.id === value);
  return option ? option.symbol : '';
};

/** One chip: what somebody would write, over what it is called. */
function chipButton(slotId, option, { write, hand }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'option';
  button.dataset.slot = slotId;
  button.dataset.option = option.id;
  button.setAttribute('aria-pressed', 'false');
  button.setAttribute('aria-label', option.name ? `${option.symbol}, ${option.name}` : option.symbol);

  const symbol = document.createElement('span');
  // The hand face is for things somebody would have written by hand. A
  // frequency, an interval, a clave is set in the serif, on the line, with its
  // accidentals still borrowed from the serif.
  symbol.className = hand ? 'symbol hand' : 'symbol';
  write(symbol, option.symbol);
  button.appendChild(symbol);

  if (option.name) {
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = option.name;
    button.appendChild(name);
  }

  return button;
}

/**
 * One control: a slider, its value written out beside it, and its own name.
 *
 * The same thing you would reach for in a session, with the same units on it,
 * and audible before you commit to it.
 */
function controlRow(slot, value) {
  const row = document.createElement('div');
  row.className = 'control';

  const name = document.createElement('label');
  name.className = 'control-name';
  name.textContent = slot.label;
  name.htmlFor = `dial-${slot.id}`;
  row.appendChild(name);

  const readout = document.createElement('output');
  readout.className = 'control-value';
  readout.id = `read-${slot.id}`;
  row.appendChild(readout);

  const dial = document.createElement('input');
  dial.type = 'range';
  dial.id = `dial-${slot.id}`;
  dial.className = 'dial';
  dial.dataset.dial = slot.id;
  // A log control is dialled in log space, so an octave is the same distance
  // wherever you are on it - which is how the ear hears frequency and ratio.
  dial.min = slot.log ? Math.log2(slot.min) : slot.min;
  dial.max = slot.log ? Math.log2(slot.max) : slot.max;
  dial.step = slot.log ? 0.02 : slot.step;
  dial.value = slot.log ? Math.log2(value) : value;
  dial.setAttribute('aria-label', slot.label);
  row.appendChild(dial);

  const ends = document.createElement('div');
  ends.className = 'control-ends';
  ends.innerHTML = `<span>${slot.format(slot.min)}</span><span>${slot.format(slot.max)}</span>`;
  row.appendChild(ends);

  return row;
}

/** Draws the slots into `el`, on the values `answer` holds. */
export function renderPicker(el, slots, answer, { write, hand = false }) {
  el.textContent = '';

  for (const slot of slots) {
    const group = document.createElement('div');
    group.className = 'picker-group';

    if (slot.kind === 'range') {
      group.appendChild(controlRow(slot, answer[slot.id]));
      el.appendChild(group);
      continue;
    }

    const label = document.createElement('p');
    label.className = 'eyebrow';
    label.textContent = slot.label;
    group.appendChild(label);

    const options = document.createElement('div');
    options.className = 'options';
    options.setAttribute('role', 'group');
    options.setAttribute('aria-label', slot.label);
    for (const option of slot.options) options.appendChild(chipButton(slot.id, option, { write, hand }));

    group.appendChild(options);
    el.appendChild(group);
  }
}

/** Repaints which chips are pressed and what each dial now reads. */
export function syncPicker(el, slots, answer) {
  for (const button of el.querySelectorAll('[data-option]')) {
    const picked = answer[button.dataset.slot] === button.dataset.option;
    button.setAttribute('aria-pressed', picked ? 'true' : 'false');
  }

  for (const slot of slots) {
    if (slot.kind !== 'range') continue;
    const readout = el.querySelector(`#read-${slot.id}`);
    if (readout) readout.textContent = slot.format(answer[slot.id]);
  }
}

/**
 * What the picker is currently showing, for whoever owns the button under it.
 *
 * Returned rather than applied, because whether an answer can be submitted is
 * a question about the round and not about the controls.
 */
export function pickerState(slots, answer) {
  return {
    complete: slots.every((slot) => answer[slot.id] !== undefined),
    dialling: slots.some((slot) => slot.kind === 'range'),
    summary: slots.map((slot) => pickedLabel(slot, answer[slot.id])).join(' · '),
  };
}
