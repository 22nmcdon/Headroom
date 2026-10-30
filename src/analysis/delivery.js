// What happens to a master after it leaves: the table, and the way to hear it.
//
// The analysis page reads a track back. This is the part that says what the
// world will do with it - which service turns it down and by how much, where
// that leaves the true peak, and what two masters of the same music sound
// like once both have been normalised to the same loudness.
//
// The last of those is the whole point and it needs sound rather than
// numbers. "Normalisation makes mastering loud pointless" is an argument;
// two masters playing at the same loudness with one of them visibly flatter
// is a demonstration, and the flip between them has to be instant and gapless
// or it is a comparison with a memory. So this owns a small transport: both
// slots started together, each through the gain the chosen service would
// apply, and a pair of gains to flip between them.
//
// The figures come from `lib/targets.js`, which is the one place in this app
// where a number is somebody's policy rather than a measurement - and says
// so, with a date.

import {
  TARGETS, TARGETS_CHECKED, SOURCE_KINDS, targetOfId, deliveryOf, matchedAgainst,
} from '../lib/targets.js';

/** Hearing it as delivered, which is not a service and has to be an option. */
const AS_MADE = 'made';

/** A gain with its sign on it, or a dash. */
const writeMove = (db) =>
  (Number.isFinite(db) ? `${db > 0 ? '+' : ''}${db.toFixed(1)}` : '—');

const writeAt = (db, unit) =>
  (Number.isFinite(db) ? `${db.toFixed(1)} ${unit}` : '—');

/**
 * What a row's source is worth, in one mark.
 *
 * A symbol rather than the sentence, because the sentence is in the title and
 * a table with an explanation in every row is a table nobody reads. The
 * sentence is still reachable - it is what the mark's tooltip says.
 */
const SOURCE_MARKS = { standard: '§', published: '•', secondary: '?' };

export class Delivery {
  constructor(el, { engine }) {
    this.el = el;
    this.engine = engine;
    this.as = AS_MADE;
    this.hearing = 'yours';
    this.playing = false;

    // The decoded audio, kept rather than discarded once it has been read.
    // The page used to throw the buffer away the moment the readings were
    // taken, which was right while nothing here could play.
    this.audio = { yours: null, reference: null };
    this.values = { yours: null, reference: null };
    this.names = { yours: '', reference: '' };

    this.build();
    this.wire();
  }

  build() {
    this.el.innerHTML = `
      <div class="delivery-bar">
        <label class="field">
          <span class="field-label">Played as</span>
          <select id="deliveryAs">
            <option value="${AS_MADE}">As you made it</option>
            ${TARGETS.map((t) => `<option value="${t.id}">${t.name}</option>`).join('')}
          </select>
        </label>
        <button class="play-btn" type="button" data-delivery="play">Play</button>
        <div class="eq-ab" role="group" aria-label="Which master you are hearing">
          <button class="ab-btn is-on" type="button" data-slot-hear="yours">Yours</button>
          <button class="ab-btn" type="button" data-slot-hear="reference">Reference</button>
        </div>
        <span class="fine" id="deliveryHeard"></span>
      </div>
      <div class="delivery-rows" id="deliveryRows"></div>
      <p class="fine" id="deliveryMatched"></p>`;

    this.rows = this.el.querySelector('#deliveryRows');
  }

  wire() {
    this.el.querySelector('#deliveryAs').addEventListener('change', (e) => {
      this.as = e.target.value;
      this.applyGains();
      this.show();
    });

    this.el.addEventListener('click', (e) => {
      const hear = e.target.closest('[data-slot-hear]');
      if (hear) {
        this.hear(hear.dataset.slotHear);
        return;
      }
      if (e.target.closest('[data-delivery="play"]')) this.toggle();
    });
  }

  /* ---------- what is loaded ---------- */

  /**
   * A slot's audio and what it measured.
   *
   * Both, because the panel needs the figures to build the table and the
   * buffer to play it, and keeping them apart meant a table that described
   * audio the page no longer had.
   */
  put(id, buffer, values, name) {
    if (this.audio[id] === undefined) return;
    this.audio[id] = buffer ?? null;
    this.values[id] = values ?? null;
    this.names[id] = name ?? '';
    if (this.playing) this.restart();
    this.show();
  }

  /** Whether there is anything to say yet. */
  ready() {
    return !!this.values.yours;
  }

  /* ---------- the table ---------- */

  show() {
    if (!this.rows) return;

    const mine = this.values.yours;
    if (!mine) {
      this.rows.innerHTML = '';
      this.el.querySelector('#deliveryMatched').textContent = '';
      this.writeHeard();
      return;
    }

    this.rows.innerHTML = TARGETS.map((target) => {
      const done = deliveryOf(mine, target);
      const mark = SOURCE_MARKS[target.from] ?? '?';

      // What the service does, said as a move rather than as a destination:
      // "-6.0" is the thing being done to the master and "-14.0 LUFS" is
      // where everything ends up anyway.
      const move = target.turnsUp === null
        ? 'as delivered'
        : `${writeMove(done.gain)} LU`;

      return `
        <div class="delivery-row${done.meets ? '' : ' is-off'}">
          <span class="delivery-name" title="${SOURCE_KINDS[target.from]}: ${target.says}">
            ${target.name} <i class="delivery-mark">${mark}</i>
          </span>
          <span class="delivery-move">${move}</span>
          <span class="delivery-read">${writeAt(done.played, 'LUFS')}</span>
          <span class="delivery-read">${writeAt(done.peak, 'dBTP')}</span>
          <span class="delivery-verdict">${this.verdictFor(target, done)}</span>
        </div>`;
    }).join('');

    this.writeMatched();
    this.writeHeard();
  }

  /**
   * The one line that says what to do about it.
   *
   * Three things can be wrong and they want saying differently. A file over
   * the ceiling is a file to go back and fix. A master a service will not
   * turn up is loudness left on the table. A peak that lands over full scale
   * after the service has turned it UP is the one most people have never
   * thought about, and it is the only one where the number on your meter was
   * fine and the problem happened later.
   */
  verdictFor(target, done) {
    if (!Number.isFinite(done.played)) return 'nothing to say';
    if (done.over > 0) return `${done.over.toFixed(1)} dB over its ceiling`;
    if (done.peak > 0) return `peaks at ${done.peak.toFixed(1)} once turned up`;
    if (done.short > 0) return `plays ${done.short.toFixed(1)} LU under`;
    if (target.tolerance !== undefined && Math.abs(done.off) > target.tolerance) {
      return `${Math.abs(done.off).toFixed(1)} LU ${done.off > 0 ? 'over' : 'under'} target`;
    }
    return 'fine';
  }

  /**
   * Yours against the reference, with the loudness taken out.
   *
   * The sentence the module exists to be able to write. Both normalised to
   * whatever is selected - or to the first target when nothing is, because a
   * comparison "as you made it" is the one every loudness argument is already
   * having and is not the interesting one.
   */
  writeMatched() {
    const line = this.el.querySelector('#deliveryMatched');
    if (!line) return;

    const mine = this.values.yours;
    const theirs = this.values.reference;
    if (!mine || !theirs) {
      line.textContent = mine
        ? 'Load a reference into the second slot to hear the two at the same playback loudness.'
        : '';
      return;
    }

    const target = targetOfId(this.as) ?? TARGETS[0];
    const seen = matchedAgainst(mine, theirs, target);
    if (seen.lost === null) { line.textContent = ''; return; }

    const same = Math.abs(seen.quieter ?? 0) < 0.05;
    const level = same
      ? `At ${target.name} both play at the same loudness.`
      : `At ${target.name} yours still plays ${Math.abs(seen.quieter).toFixed(1)} LU `
        + `${seen.quieter < 0 ? 'quieter' : 'louder'}.`;

    // The sign is the whole message, so it is spelled out rather than
    // printed: "-3.4" next to "peak-to-loudness ratio" is a number half the
    // people reading it will take the wrong way round.
    const flat = Math.abs(seen.lost) < 0.3
      ? 'The two have the same peak-to-loudness ratio, so neither gave away more than the other.'
      : `Yours has ${Math.abs(seen.lost).toFixed(1)} LU ${seen.lost < 0 ? 'less' : 'more'} `
        + 'peak-to-loudness ratio, and a gain cannot give that back: '
        + `${seen.lost < 0 ? 'yours' : 'the reference'} is the flatter of the two at the same loudness.`;

    line.textContent = `${level} ${flat}`;
  }

  writeHeard() {
    const heard = this.el.querySelector('#deliveryHeard');
    if (!heard) return;

    const values = this.values[this.hearing];
    if (!values) { heard.textContent = ''; return; }

    const gain = this.gainFor(this.hearing);
    heard.textContent = this.as === AS_MADE
      ? `${writeAt(values.integrated, 'LUFS')}, as delivered`
      : `${writeAt(values.integrated + gain, 'LUFS')} after ${writeMove(gain)} LU`;
  }

  /* ---------- hearing it ---------- */

  /** The gain the chosen service would apply to this slot. */
  gainFor(id) {
    const values = this.values[id];
    const target = targetOfId(this.as);
    if (!values || !target) return 0;
    const { gain } = deliveryOf(values, target);
    return Number.isFinite(gain) ? gain : 0;
  }

  async toggle() {
    if (this.playing) { this.stop(); return; }
    await this.play();
  }

  async play() {
    const ctx = this.engine.ensure();
    this.stop();

    const ready = ['yours', 'reference'].filter((id) => this.audio[id]);
    if (!ready.length) return false;

    this.gains = {};
    this.flips = {};
    this.sources = {};

    // Both started at the same instant, so the flip lands on the same bar of
    // music rather than at the beginning of whichever one was pressed.
    const at = ctx.currentTime + 0.08;
    for (const id of ready) {
      const level = ctx.createGain();
      const flip = ctx.createGain();
      level.gain.value = 10 ** (this.gainFor(id) / 20);
      flip.gain.value = id === this.hearing ? 1 : 0;

      const node = ctx.createBufferSource();
      node.buffer = this.audio[id];
      node.connect(level).connect(flip).connect(this.engine.out);
      node.start(at);

      this.gains[id] = level;
      this.flips[id] = flip;
      this.sources[id] = node;
    }

    // Whichever runs longest decides when the button goes back to Play. Two
    // files of different lengths is the ordinary case here - a master and a
    // reference are different records - and hanging this on whichever
    // happened to be loaded first left the button saying Play while the other
    // one was still going.
    const longest = ready.reduce(
      (so, id) => (this.audio[id].duration > this.audio[so].duration ? id : so),
      ready[0],
    );
    this.sources[longest].onended = () => { if (this.playing) this.stop(); };

    this.playing = true;
    this.markPlaying();
    return true;
  }

  stop() {
    for (const node of Object.values(this.sources ?? {})) {
      try { node.stop(); } catch { /* already stopped, which is fine */ }
      node.disconnect();
    }
    this.sources = {};
    this.gains = {};
    this.flips = {};
    this.playing = false;
    this.markPlaying();
  }

  /** Both sides are already running; a change of service is a change of gain. */
  applyGains() {
    if (!this.playing) return;
    const at = this.engine.ctx.currentTime;
    for (const [id, gain] of Object.entries(this.gains ?? {})) {
      gain.gain.setTargetAtTime(10 ** (this.gainFor(id) / 20), at, 0.02);
    }
  }

  hear(which) {
    this.hearing = which;
    for (const button of this.el.querySelectorAll('[data-slot-hear]')) {
      button.classList.toggle('is-on', button.dataset.slotHear === which);
    }
    if (this.playing) {
      const at = this.engine.ctx.currentTime;
      for (const [id, flip] of Object.entries(this.flips ?? {})) {
        flip.gain.setTargetAtTime(id === which ? 1 : 0, at, 0.008);
      }
    }
    this.writeHeard();
  }

  /** A slot arriving mid-play means a new pair, started together again. */
  restart() {
    this.stop();
    this.play().catch(() => { /* no gesture yet; the button still works */ });
  }

  markPlaying() {
    const button = this.el.querySelector('[data-delivery="play"]');
    if (button) button.textContent = this.playing ? 'Stop' : 'Play';
  }

  destroy() {
    this.stop();
  }
}

/** What the panel says about itself, so the page does not have to know. */
export const DELIVERY_FINE = 'Every figure in the first column is somebody\'s published '
  + `policy rather than a measurement, last checked ${TARGETS_CHECKED}. `
  + 'Everything to the right of it is arithmetic on your own file. '
  + `§ a published standard · • the service\'s own guidance · ? widely reported, no first-party source found.`;
