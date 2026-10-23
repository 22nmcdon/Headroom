// What you have tried, in the order you tried it.
//
// This replaces a fixed grid of four rows. The grid was Wordle's, and it came
// with Wordle's arithmetic: a board has to know how many rows to draw before
// anything is played, so it had to know how many attempts you were allowed,
// so there had to be a number of attempts you were allowed. Take the ceiling
// off and the whole apparatus that sized an empty board goes with it - the
// first entry decides the columns, and before the first entry there is
// nothing to draw.
//
// Append-only and newest first, because the thing you want on screen is what
// you just did, and the thing you want under it is what you did before that.
// Entries are prepended rather than the list rebuilt, so the scroll position
// and any disclosure somebody has opened survive the next attempt.

/** How many are on screen before the rest are folded away. */
const SHOWN = 8;

/** One reading, in its colour. */
export function drawCell(cell, write) {
  const node = document.createElement('div');
  node.className = `cell ${cell.state}`;

  const value = document.createElement('span');
  value.className = 'value';
  write(value, cell.text);
  node.appendChild(value);
  return node;
}

const columns = (cells) => cells.map((cell) => (cell.narrow ? '0.45fr' : '1fr')).join(' ');

/**
 * The working, for an attempt that computed more than it printed.
 *
 * Every scorer here already works out more than the two cells it shows - the
 * frequency the curves part company at, how much of the gap is depth and how
 * much is timing, what summing to mono costs down low - and then throws it
 * away after formatting. `why` is that arithmetic, kept: each row is what was
 * measured, what it came to, and how it was arrived at.
 */
function whyPanel(why) {
  const panel = document.createElement('details');
  panel.className = 'why';

  const open = document.createElement('summary');
  open.className = 'why-open';
  open.textContent = 'How that was read';
  panel.appendChild(open);

  const list = document.createElement('dl');
  list.className = 'why-list';
  for (const row of why) {
    const label = document.createElement('dt');
    label.textContent = row.label;

    const value = document.createElement('dd');
    value.className = 'why-value';
    value.textContent = row.value;

    const how = document.createElement('dd');
    how.className = 'why-how';
    how.textContent = row.how;

    list.append(label, value, how);
  }
  panel.appendChild(list);
  return panel;
}

/** One attempt: its number, its readings, and optionally its working. */
function entryNode({ n, cells, why, headings }, write) {
  const entry = document.createElement('li');
  entry.className = 'attempt';

  const count = document.createElement('span');
  count.className = 'attempt-n';
  count.textContent = n;
  // The number is decoration beside the readings, which already say it.
  count.setAttribute('aria-hidden', 'true');
  entry.appendChild(count);

  const row = document.createElement('div');
  row.className = 'row';
  row.style.gridTemplateColumns = columns(cells);
  row.setAttribute('aria-label', `Attempt ${n}. ` + cells
    .map((cell, i) => `${headings[i] ?? 'reading'}: ${cell.text}, ${cell.state}`)
    .join('; '));

  for (const cell of cells) row.appendChild(drawCell(cell, write));
  entry.appendChild(row);

  if (why?.length) entry.appendChild(whyPanel(why));
  return entry;
}

/**
 * The log, over an element that holds it.
 *
 * `write` is how a reading is set - the shell's, because the log has no
 * opinion about typography. `headings` names the columns for a screen reader,
 * since there is no head row to name them visually any more: with one attempt
 * per line and the units inside every cell, a header would be a third thing
 * to size and would say what the cells already say.
 */
export function makeLog(el, { write, headings = [] } = {}) {
  el.textContent = '';

  const list = document.createElement('ol');
  list.className = 'attempts';
  // Polite, and on the list rather than the sheet: what is announced is the
  // attempt that just landed, not everything that moved on the page with it.
  list.setAttribute('aria-live', 'polite');
  list.setAttribute('aria-label', 'What you have tried');
  el.appendChild(list);

  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'link-btn log-more';
  more.hidden = true;
  el.appendChild(more);

  let count = 0;
  let all = false;

  const fold = () => {
    const entries = [...list.children];
    for (const [i, entry] of entries.entries()) entry.hidden = !all && i >= SHOWN;

    const hidden = Math.max(0, entries.length - SHOWN);
    more.hidden = hidden === 0;
    // Left alone while there is nothing to fold, rather than set to "show 0".
    if (hidden === 0) return;
    more.textContent = all
      ? `Show the last ${SHOWN}`
      : `Show ${hidden} earlier ${hidden === 1 ? 'attempt' : 'attempts'}`;
  };

  more.addEventListener('click', () => { all = !all; fold(); });

  return {
    /** Put an attempt at the top. Returns its number. */
    add({ cells, why }) {
      count += 1;
      list.prepend(entryNode({ n: count, cells, why, headings }, write));
      fold();
      return count;
    },

    /** Start again: a new round, or a new tool. */
    clear() {
      list.textContent = '';
      count = 0;
      all = false;
      fold();
    },

    get count() { return count; },
  };
}
