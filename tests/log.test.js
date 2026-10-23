import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * A DOM small enough to be honest about.
 *
 * There is no jsdom here and there is not going to be: this project has no
 * dependencies, and the log needs about eight of the DOM's several hundred
 * methods. What is being tested is the log's arithmetic - what order entries
 * come out in, what number each one gets, which ones are folded away - and
 * none of that is about the browser. Anything that needs a real one is tested
 * in a real one, by driving the page.
 */
function fakeDom() {
  const make = (tag) => {
    const node = {
      tagName: tag.toUpperCase(),
      children: [],
      attributes: {},
      style: {},
      className: '',
      hidden: false,
      _text: '',
      get textContent() {
        return this.children.length
          ? this.children.map((child) => child.textContent).join('')
          : this._text;
      },
      set textContent(value) { this._text = String(value); this.children = []; },
      appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
      append(...kids) { for (const kid of kids) this.appendChild(kid); },
      prepend(child) { this.children.unshift(child); child.parentNode = this; return child; },
      setAttribute(name, value) { this.attributes[name] = String(value); },
      getAttribute(name) { return this.attributes[name] ?? null; },
      addEventListener(type, fn) { (this._on ??= {})[type] = fn; },
      click() { this._on?.click?.(); },
    };
    return node;
  };

  globalThis.document = { createElement: make };
  return make('div');
}

const root = fakeDom();
const { makeLog, drawCell } = await import('../src/learn/bench/log.js');

const write = (target, text) => { target.textContent = text; };
const reading = (n) => ({
  cells: [{ state: 'miss', text: `${n} dB out` }, { state: 'near', text: 'closer' }],
});

const entriesOf = (el) => el.children[0].children;
const more = (el) => el.children[1];

/* --- what an attempt looks like ------------------------------------------ */

test('a cell carries its meaning as a class and its reading as text', () => {
  const cell = drawCell({ state: 'hit', text: '0.4 dB out' }, write);
  assert.equal(cell.className, 'cell hit');
  assert.equal(cell.textContent, '0.4 dB out');
});

test('an attempt is numbered, and the newest is on top', () => {
  const el = fakeDom();
  const log = makeLog(el, { write, headings: ['how close', 'where'] });

  assert.equal(log.add(reading(9)), 1);
  assert.equal(log.add(reading(4)), 2);
  assert.equal(log.add(reading(1)), 3);

  const entries = entriesOf(el);
  assert.equal(entries.length, 3);
  // Newest first: the attempt you just made is the one you want on screen.
  assert.equal(entries[0].children[0].textContent, '3');
  assert.equal(entries[2].children[0].textContent, '1');
  assert.ok(entries[0].textContent.includes('1 dB out'));
});

test('a screen reader is told which reading is which', () => {
  const el = fakeDom();
  const log = makeLog(el, { write, headings: ['how close', 'where'] });
  log.add(reading(9));

  const row = entriesOf(el)[0].children[1];
  assert.match(row.getAttribute('aria-label'),
    /Attempt 1\. how close: 9 dB out, miss; where: closer, near/);

  // And the number beside it is decoration, since the label already says it.
  assert.equal(entriesOf(el)[0].children[0].getAttribute('aria-hidden'), 'true');
  assert.equal(el.children[0].getAttribute('aria-live'), 'polite');
});

/* --- the working --------------------------------------------------------- */

test('an attempt that shows its working gets a disclosure, and one that does not, does not', () => {
  const el = fakeDom();
  const log = makeLog(el, { write });

  log.add(reading(9));
  assert.equal(entriesOf(el)[0].children.length, 2, 'no working, no disclosure');

  log.add({
    ...reading(4),
    why: [{ label: 'Worst point', value: '4.0 dB at 250 Hz', how: 'The largest gap.' }],
  });

  const entry = entriesOf(el)[0];
  assert.equal(entry.children.length, 3);
  const panel = entry.children[2];
  assert.equal(panel.tagName, 'DETAILS');
  assert.ok(panel.textContent.includes('Worst point'));
  assert.ok(panel.textContent.includes('4.0 dB at 250 Hz'));
  assert.ok(panel.textContent.includes('The largest gap.'));
});

/* --- unbounded, and still legible ---------------------------------------- */

test('past eight, the older ones fold away and can be asked for', () => {
  const el = fakeDom();
  const log = makeLog(el, { write });

  for (let i = 1; i <= 8; i += 1) log.add(reading(i));
  assert.equal(more(el).hidden, true, 'nothing to fold yet');
  assert.ok(entriesOf(el).every((entry) => !entry.hidden));

  log.add(reading(9));
  log.add(reading(10));
  assert.equal(more(el).hidden, false);
  assert.equal(more(el).textContent, 'Show 2 earlier attempts');

  const shown = entriesOf(el).filter((entry) => !entry.hidden);
  assert.equal(shown.length, 8, 'eight on screen');
  assert.equal(shown[0].children[0].textContent, '10', 'and they are the newest eight');

  more(el).click();
  assert.ok(entriesOf(el).every((entry) => !entry.hidden), 'all of them, on request');
  assert.equal(more(el).textContent, 'Show the last 8');

  more(el).click();
  assert.equal(entriesOf(el).filter((entry) => !entry.hidden).length, 8);
});

test('one, folded away, is still "attempt" and not "attempts"', () => {
  const el = fakeDom();
  const log = makeLog(el, { write });
  for (let i = 1; i <= 9; i += 1) log.add(reading(i));
  assert.equal(more(el).textContent, 'Show 1 earlier attempt');
});

test('a new round starts from nothing, and numbers from one again', () => {
  const el = fakeDom();
  const log = makeLog(el, { write });

  log.add(reading(9));
  log.add(reading(4));
  assert.equal(log.count, 2);

  log.clear();
  assert.equal(log.count, 0);
  assert.equal(entriesOf(el).length, 0);
  assert.equal(more(el).hidden, true);
  assert.equal(log.add(reading(7)), 1);
});

test('there is nothing to draw before the first attempt', () => {
  // The whole reason the fixed grid could go. A board had to know how many
  // rows to draw before anything had been played, which meant knowing how
  // many attempts you were allowed, which meant there had to be a limit.
  const el = fakeDom();
  makeLog(el, { write });
  assert.equal(entriesOf(el).length, 0);
});
