// The face of a thing that does not process anything.
//
// Every other plugin here shapes a signal and shows you what it did to it.
// This one takes two recordings of the same source and decides how to add
// them up, so what it has to show is not a curve it imposed - it is the one
// the arithmetic imposes on you, which is a comb, and the one instrument that
// tells you where it came from, which is a cross-correlation.
//
// Two displays and two knobs, and the displays are the tool. A delay and a
// polarity switch are trivial to build and impossible to set by eye; what
// makes alignment a craft is reading the pair, and a face without those two
// pictures is a pair of controls with nothing to aim them with.

import {
  ALIGN_DEFAULTS, ALIGN_LIMITS, ALIGN_HZ, MOST_LAG_MS,
  alignReading, notchesOf, pairBands, cmOf,
} from './pair.js';
import { PairPlayer } from './player.js';
import { notReady, stampOf } from '../../lib/read.js';
import {
  dialOf, offDial, readyCanvas, watchSize, span, writeHertz,
} from '../../lib/panel.js';
import { dressKnobs } from '../../lib/knob.js';

const ALIGN_KNOBS = [
  {
    id: 'delay',
    name: 'Delay',
    ...span(ALIGN_LIMITS.delay),
    // A fiftieth of a millisecond, which is about a sample at either rate
    // this app runs at - 0.96 of one at 48 kHz and 0.88 at 44.1. Finer than
    // that is a control with more steps than the pointer has pixels; coarser
    // is a control that cannot reach the answer. Measured on the pair this
    // tool is marked on, five steps of it is 0.8 dB of comb and ten steps is
    // 3.0, against a hard tolerance of 0.6 - so the answer is three steps
    // wide, which is what shift-dragging is for.
    step: 0.02,
    write: (ms) => (ms >= 10 ? `${ms.toFixed(1)} ms` : `${ms.toFixed(2)} ms`),
  },
  {
    id: 'blend',
    name: 'Far mic',
    ...span(ALIGN_LIMITS.blend),
    step: 0.5,
    write: (db) => `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`,
  },
];

/** What the monitor button offers, which is a pair of solos and the sum. */
const HEARING = [
  { id: 'sum', label: 'Both' },
  { id: 'close', label: 'Close mic' },
  { id: 'far', label: 'Far mic' },
];

/**
 * What the comb display shows, in decibels against the close mic alone.
 *
 * Twelve up because two identical signals added together are six, and a pair
 * whose low end agrees gets most of that - six is the line to see it against.
 * Twenty-four down because a notch is as deep as the two halves are equal and
 * nothing is learnt from watching it go to minus infinity.
 */
const COMB_TOP = 12;
const COMB_FLOOR = -24;

function alignPalette(el) {
  const style = getComputedStyle(el);
  const read = (name) => style.getPropertyValue(name).trim();
  return {
    blush: read('--blush'),
    accent: read('--blush-deep'),
    sage: read('--sage'),
    gold: read('--gold'),
    rust: read('--rust'),
    soft: 'rgba(250, 246, 240, 0.55)',
    grid: 'rgba(250, 246, 240, 0.14)',
    zero: 'rgba(250, 246, 240, 0.3)',
  };
}

const logX = (hz, width) => {
  const from = Math.log2(ALIGN_HZ[0]);
  const to = Math.log2(ALIGN_HZ[ALIGN_HZ.length - 1]);
  return ((Math.log2(hz) - from) / (to - from)) * width;
};

export class AlignPlugin {
  constructor(el, {
    engine, settings, onChange, source = null, fault = null, player = null, role = 'tool',
  }) {
    this.el = el;
    this.engine = engine;
    this.settings = settings ?? { ...ALIGN_DEFAULTS };
    this.onChange = onChange;
    this.role = role;
    this.interactive = true;
    this.target = null;
    this.shown = null;

    this.player = player ?? new PairPlayer(engine, {
      source: source ?? 'drums',
      path: fault ?? undefined,
    });

    this.build();
    this.draw();

    if (this.role === 'insert') this.playing(true);

    this.player.prepare()
      .then(() => { this.player.setSettings(this.settings); this.draw(); })
      .catch(() => { /* no audio yet; the knobs still work */ });
    this.player.setSettings(this.settings);
  }

  /* ---------- the furniture ---------- */

  build() {
    const host = this.role === 'insert' ? '' : `
      <div class="eq-transport host-row">
        <button class="play-btn" type="button" data-align="play">Play</button>
        <div class="eq-ab" role="group" aria-label="What you are hearing">
          <button class="ab-btn is-on" type="button" data-align-hear="mine">Yours</button>
          <button class="ab-btn" type="button" data-align-hear="theirs">Aligned</button>
        </div>
        <label class="field">
          <span class="field-label">Sample</span>
          <select id="alignSource">
            <option value="drums">Drums</option>
            <option value="kick">Kick</option>
            <option value="instrument">Keys</option>
            <option value="mix">Full mix</option>
            <option value="yours" id="alignYours" hidden>Your own</option>
          </select>
        </label>
        <label class="file-btn">Open a file<input type="file" id="alignFile" accept="audio/*"></label>
      </div>`;

    this.el.innerHTML = `${host}
      <div class="plugin align${this.role === 'insert' ? ' is-insert' : ''}">
        <div class="plugin-head">
          <span class="plugin-lamp"></span>
          <span class="plugin-name">Align</span>
          <span class="plugin-trim" id="alignTrim"></span>
          <span class="plugin-read" id="alignRead"></span>
        </div>

        <div class="stereo-display">
          <div class="plugin-bay">
            <span class="panel-name">The two added up</span>
            <div class="plugin-panel"><canvas id="alignComb"></canvas></div>
          </div>
          <div class="plugin-bay">
            <span class="panel-name">Where they line up</span>
            <div class="plugin-panel"><canvas id="alignLag"></canvas></div>
          </div>
        </div>

        <div class="plugin-controls" id="alignKnobs"></div>

        <div class="stereo-routing">
          <button class="ab-btn" type="button" data-align="flip">Flip the far mic</button>
          <label class="field">
            <span class="field-label">Listen to</span>
            <select id="alignHear">
              ${HEARING.map((h) => `<option value="${h.id}">${h.label}</option>`).join('')}
            </select>
          </label>
          <span class="eq-hint">the delay goes on the mic that heard it first — you cannot make a microphone hear something earlier</span>
        </div>
      </div>`;

    this.comb = this.el.querySelector('#alignComb');
    this.lag = this.el.querySelector('#alignLag');

    const sample = this.el.querySelector('#alignSource');
    if (sample) sample.value = this.player.source;

    this.buildKnobs();
    this.wire();
  }

  buildKnobs() {
    this.el.querySelector('#alignKnobs').innerHTML = ALIGN_KNOBS.map((knob) => {
      const dial = dialOf(knob, this.settings[knob.id]);
      return `
        <div class="knob">
          <label class="knob-name" for="align-${knob.id}">${knob.name}</label>
          <output class="knob-value" id="align-${knob.id}-value">${knob.write(this.settings[knob.id])}</output>
          <input class="knob-dial" type="range" id="align-${knob.id}" data-dial="${knob.id}"
                 min="${dial.min}" max="${dial.max}" step="${dial.step}" value="${dial.at}"
                 data-rest="${dialOf(knob, ALIGN_DEFAULTS[knob.id]).at}"
                 aria-label="${knob.name}">
        </div>`;
    }).join('');
    this.syncKnobs();
  }

  wire() {
    this.el.querySelector('#alignKnobs').addEventListener('input', (e) => {
      const dial = e.target.closest('[data-dial]');
      if (!dial || !this.interactive) return;
      const knob = ALIGN_KNOBS.find((k) => k.id === dial.dataset.dial);
      this.settings[knob.id] = offDial(knob, dial.value);
      this.changed();
    });

    this.el.addEventListener('click', (e) => {
      const hear = e.target.closest('[data-align-hear]');
      if (hear) {
        this.player.hear(hear.dataset.alignHear);
        for (const button of this.el.querySelectorAll('[data-align-hear]')) {
          button.classList.toggle('is-on', button === hear);
        }
        return;
      }
      if (e.target.closest('[data-align="play"]')) this.toggle();
      if (e.target.closest('[data-align="flip"]')) this.toggleFlip();
    });

    this.el.querySelector('#alignHear')?.addEventListener('change', (e) => {
      this.settings.hear = e.target.value;
      this.changed();
    });
    this.el.querySelector('#alignSource')
      ?.addEventListener('change', (e) => this.setSource(e.target.value));
    this.el.querySelector('#alignFile')
      ?.addEventListener('change', (e) => this.loadFile(e.target.files?.[0]));

    this.resize = () => this.draw();
    this.unwatch = watchSize(this.el, this.resize);
  }

  changed() {
    this.syncKnobs();
    this.player.setSettings(this.settings);
    this.draw();
    this.onChange?.(this.settings);
  }

  syncKnobs() {
    for (const knob of ALIGN_KNOBS) {
      const readout = this.el.querySelector(`#align-${knob.id}-value`);
      const dial = this.el.querySelector(`#align-${knob.id}`);
      if (readout) readout.textContent = knob.write(this.settings[knob.id]);
      if (dial && document.activeElement !== dial) {
        dial.value = dialOf(knob, this.settings[knob.id]).at;
      }
    }
    const hear = this.el.querySelector('#alignHear');
    if (hear) hear.value = this.settings.hear ?? 'sum';
    this.el.querySelector('[data-align="flip"]')?.classList.toggle('is-on', !!this.settings.flip);
    dressKnobs(this.el);
  }

  /**
   * The polarity switch, which is a button and not a knob for a reason.
   *
   * It has two positions and no middle, and the thing it does has no amount:
   * the far mic is either the way round it was recorded or the other way. A
   * knob with two detents would imply there was something in between.
   */
  toggleFlip() {
    if (!this.interactive) return;
    this.settings.flip = !this.settings.flip;
    this.changed();
  }

  /* ---------- the reading ---------- */

  read() {
    const of = {
      state: stampOf({ ...this.settings, rate: this.engine?.ctx?.sampleRate ?? null }),
      source: this.player.source,
      axis: this.player.reading?.of?.axis ?? null,
    };
    if (!this.player.reading) return notReady({ tool: 'align', kind: 'align', of });
    return this.player.reading;
  }

  async readNow() {
    await this.player.prepare().catch(() => {});
    this.player.setSettings(this.settings);
    return this.read();
  }

  /* ---------- the pictures ---------- */

  draw() {
    const ink = alignPalette(this.el);
    this.drawComb(ink);
    this.drawLag(ink);
    this.writeReadout();
  }

  /**
   * What adding the second microphone did, band by band - and where the
   * arithmetic says the notches are.
   *
   * Against the close mic rather than on its own, which is the only reading
   * of this that is legible. Drawn absolutely, the sum of a drum loop is a
   * kick at 60 Hz and thirty decibels of nothing above it, and the comb -
   * which is the entire subject - is invisible inside it. Against the close
   * mic the picture is the comb and only the comb: zero is "adding the second
   * mic changed nothing here", up is where the two agree, down is where they
   * take each other away.
   *
   * The ticks along the top are `notchesOf` on whatever time is still between
   * the two microphones. They are drawn from the formula and the measurement
   * is right behind them, which is the whole demonstration: a millisecond out
   * puts the first one at 500 Hz, and there it is in the curve.
   *
   * On a sparse loop the line wobbles by a couple of decibels above a few
   * hundred hertz even when the pair is in time, and that is the material
   * rather than the pair: the drums bed's mids are 25 to 30 dB below its kick
   * and arrive in short bursts, so fifteen windows of a sixth-octave band up
   * there is a noisy estimate. Measured on the probe kit, which has the same
   * bands filled evenly, an aligned pair draws 4.25 dB flat from 40 Hz to 320
   * and tapers to 2.69 at 3.6 kHz - no wobble at all.
   */
  drawComb(ink) {
    const stage = readyCanvas(this.comb);
    if (!stage) return;
    const { c, width, height } = stage;
    const values = this.player.reading?.values;

    const floor = height - 12;
    const y = (db) => ((COMB_TOP - db) / (COMB_TOP - COMB_FLOOR)) * floor;

    c.font = '9.5px system-ui, sans-serif';
    c.lineWidth = 1;
    c.textAlign = 'center';
    for (const [hz, label] of [[50, '50'], [100, '100'], [200, '200'], [500, '500'],
      [1000, '1k'], [2000, '2k'], [4000, '4k']]) {
      const x = logX(hz, width);
      c.strokeStyle = ink.grid;
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, floor);
      c.stroke();
      c.fillStyle = ink.soft;
      c.fillText(label, Math.min(width - 8, Math.max(8, x)), height - 2);
    }

    // Where the second mic changed nothing, and the two it changed by six -
    // which is what a pair adds up to when it agrees, and the line a comb is
    // read against.
    c.textAlign = 'right';
    for (const db of [6, 0, -12]) {
      c.strokeStyle = db === 0 ? ink.zero : ink.grid;
      c.beginPath();
      c.moveTo(0, y(db));
      c.lineTo(width, y(db));
      c.stroke();
      c.fillStyle = ink.soft;
      c.fillText(`${db > 0 ? '+' : ''}${db}`, width - 2, y(db) - 2);
    }

    if (!values) {
      c.textAlign = 'left';
      c.fillStyle = ink.soft;
      c.fillText(this.role === 'insert' ? 'play the sketch' : 'press play', 6, 12);
      return;
    }

    const dry = this.dryBands();
    if (!dry) return;

    const line = (bands, stroke, dash = null) => {
      c.strokeStyle = stroke;
      c.lineWidth = dash ? 1 : 1.4;
      if (dash) c.setLineDash(dash);
      c.beginPath();
      bands.forEach((db, i) => {
        const x = logX(ALIGN_HZ[i], width);
        const at = y(Math.max(COMB_FLOOR, Math.min(COMB_TOP, db - dry[i])));
        if (i === 0) c.moveTo(x, at); else c.lineTo(x, at);
      });
      c.stroke();
      if (dash) c.setLineDash([]);
    };

    // The answer's own comb, when the round has asked for it to be shown.
    if (this.shown) line(this.shown, ink.sage, [2, 3]);
    line(values.bands, ink.accent || ink.blush);

    const left = Math.abs(values.leftMs ?? 0);
    const notches = notchesOf(left, ALIGN_HZ[ALIGN_HZ.length - 1]);
    if (notches.length) {
      c.strokeStyle = ink.rust;
      c.lineWidth = 1;
      for (const hz of notches) {
        if (hz < ALIGN_HZ[0]) continue;
        const x = logX(hz, width);
        c.beginPath();
        c.moveTo(x, 0);
        c.lineTo(x, 7);
        c.stroke();
      }
      c.textAlign = 'left';
      c.fillStyle = ink.rust;
      c.fillText(`first notch ${writeHertz(notches[0])}`, 4, 16);
    }
  }

  /** The close mic on its own, cached: it only changes with the material. */
  dryBands() {
    const pair = this.player.window();
    if (!pair) return null;
    const stamp = `${pair.close.length}:${pair.rate}:${this.player.source}`;
    if (this.dryStamp !== stamp) {
      this.dryStamp = stamp;
      this.dry = pairBands(pair.close, pair.rate);
    }
    return this.dry;
  }

  /**
   * Where the two recordings agree, lag by lag.
   *
   * The one display that says which way to move, and the reason this tool is
   * usable at all. A comb tells you that something is wrong; the correlation
   * tells you how far and in which direction, and its sign tells you whether
   * the two are the same way up.
   *
   * No number is printed on it, which is deliberate. Reading a peak off a
   * curve is the skill; being told "3.46 ms" is an auto-align button, and a
   * tool that answers the question for you teaches nothing about it. The
   * curve is drawn at the resolution the search runs at - a step of
   * LAG_STRIDE samples, about a twelfth of a millisecond - which is coarser
   * than the tolerances, so it gets you close and your ears do the rest.
   */
  drawLag(ink) {
    const stage = readyCanvas(this.lag);
    if (!stage) return;
    const { c, width, height } = stage;
    const values = this.player.reading?.values;

    const middle = height / 2;
    c.font = '9.5px system-ui, sans-serif';
    c.strokeStyle = ink.grid;
    c.beginPath();
    c.moveTo(0, middle);
    c.lineTo(width, middle);
    c.stroke();

    const curve = this.player.lag?.curve ?? null;
    if (!values || !curve?.length) {
      c.textAlign = 'left';
      c.fillStyle = ink.soft;
      c.fillText('press play', 6, 12);
      return;
    }

    const x = (ms) => ((ms + MOST_LAG_MS) / (2 * MOST_LAG_MS)) * width;
    const { step } = this.player.lag;

    // Nought, and the quarter-metre marks either side of it, because the
    // thing being read off this is a distance.
    c.textAlign = 'center';
    c.fillStyle = ink.soft;
    for (const ms of [-20, -10, 0, 10, 20]) {
      const at = x(ms);
      c.strokeStyle = ms === 0 ? ink.zero : ink.grid;
      c.beginPath();
      c.moveTo(at, 0);
      c.lineTo(at, height);
      c.stroke();
      c.fillText(ms === 0 ? '0' : `${Math.abs(ms)}`, at, height - 2);
    }

    c.strokeStyle = ink.blush;
    c.lineWidth = 1.2;
    c.beginPath();
    curve.forEach((r, i) => {
      const at = x((i - (curve.length - 1) / 2) * step);
      const y = middle - r * (middle - 10);
      if (i === 0) c.moveTo(at, y); else c.lineTo(at, y);
    });
    c.stroke();

    // Where you have put the delay, against where the peak is. When the two
    // lines meet, the pair is aligned - which is the whole instrument.
    const peak = x(values.lagMs ?? 0);
    c.strokeStyle = ink.gold;
    c.lineWidth = 1;
    c.setLineDash([2, 2]);
    c.beginPath();
    c.moveTo(peak, 0);
    c.lineTo(peak, height);
    c.stroke();
    c.setLineDash([]);

    const mine = x(this.settings.delay ?? 0);
    c.strokeStyle = ink.sage;
    c.lineWidth = 1.4;
    c.beginPath();
    c.moveTo(mine, middle - 6);
    c.lineTo(mine, middle + 6);
    c.stroke();
  }

  /**
   * The two figures a console gives you, and the one it does not.
   *
   * `zero` is the correlation meter every desk has had since the sixties, and
   * it is here to be distrusted: measured on a pair eight milliseconds apart,
   * it reads -0.82 when the two are the same way up and +0.82 when one of
   * them is inverted. What it reports is the delay, not the polarity, and
   * anybody who has been told otherwise has been told wrong.
   *
   * The low end is the figure that matters and the one no console shows: how
   * much of the bottom came back when the two were put in time. That is what
   * alignment is for.
   */
  writeReadout() {
    const values = this.player.reading?.values;
    const read = this.el.querySelector('#alignRead');
    const trim = this.el.querySelector('#alignTrim');
    if (!read) return;

    if (!values) {
      read.textContent = '';
      if (trim) trim.textContent = '';
      return;
    }

    const dry = this.dryBands();
    const recovered = dry ? values.low - this.lowOfDry(dry) : null;
    read.textContent = `${values.zero >= 0 ? '+' : ''}${values.zero.toFixed(2)} at zero`
      + (recovered === null ? '' : ` · low end ${recovered > 0 ? '+' : ''}${recovered.toFixed(1)} dB`);
    if (trim) {
      const left = values.leftMs ?? 0;
      trim.textContent = Math.abs(left) < 0.03
        ? 'in time'
        : `${Math.abs(cmOf(left)).toFixed(0)} cm ${left > 0 ? 'to go' : 'too far'}`;
    }
  }

  lowOfDry(dry) {
    let sum = 0;
    let n = 0;
    ALIGN_HZ.forEach((hz, i) => {
      if (hz > 200) return;
      sum += 10 ** (dry[i] / 10);
      n += 1;
    });
    return 10 * Math.log10(Math.max(1e-30, sum / Math.max(1, n)));
  }

  /* ---------- transport ---------- */

  async toggle() {
    if (this.player.playing) {
      this.player.stop();
      this.playing(false);
      return;
    }
    await this.player.play();
    this.playing(true);
  }

  playing(on) {
    const button = this.el.querySelector('[data-align="play"]');
    if (button) button.textContent = on ? 'Stop' : 'Play';
    const lamp = this.el.querySelector('.plugin-lamp');
    if (lamp) lamp.classList.toggle('is-on', !!on);
  }

  /* ---------- what a host asks of it ---------- */

  setState(next) {
    Object.assign(this.settings, next);
    this.buildKnobs();
    this.changed();
  }

  state() {
    return { ...this.settings };
  }

  setTarget(settings) {
    this.target = settings ?? null;
    this.player.setTarget(this.target);
  }

  /** Draw the answer's comb over yours, or take it back off. */
  showTarget(target) {
    const pair = this.player.window();
    if (!target || !pair) { this.shown = null; this.draw(); return; }
    this.shown = alignReading(pair, pair.rate, { ...ALIGN_DEFAULTS, ...target }).values.bands;
    this.draw();
  }

  source() {
    return this.player.source ?? null;
  }

  abLabel() {
    return this.el.querySelector('[data-align-hear="theirs"]')?.textContent ?? null;
  }

  nameAB(label) {
    const slot = this.el.querySelector('[data-align-hear="theirs"]');
    if (slot) slot.textContent = label;
  }

  /**
   * What a guess is marked against: the close microphone, and nothing else.
   *
   * The far one is deliberately not pinned, because it is not material - it
   * is a function of the close mic and the round's path, and the exercise
   * rebuilds it with the same arithmetic the player used. Pinning it would
   * mean the material and the fault had to be set in the right order, and
   * `attach` sets the material first.
   */
  async material() {
    await this.player.prepare().catch(() => null);
    const pair = this.player.window();
    return pair ? { close: pair.close, rate: pair.rate } : null;
  }

  async setFault(fault) {
    await this.player.setPath(fault ?? { ms: 3.5, level: -4, flip: false });
    this.player.setSettings(this.settings);
    this.dryStamp = null;
    this.draw();
  }

  lock() {
    this.interactive = false;
    this.el.querySelector('.align')?.classList.add('is-locked');
  }

  unlock() {
    this.interactive = true;
    this.el.querySelector('.align')?.classList.remove('is-locked');
  }

  async setSource(id) {
    this.player.source = id;
    const picker = this.el.querySelector('#alignSource');
    if (picker) picker.value = id;
    this.dryStamp = null;
    await this.player.prepare().catch(() => {});
    this.player.setSettings(this.settings);
    this.draw();
  }

  async loadFile(file) {
    if (!file) return;
    await this.player.load(file);
    const option = this.el.querySelector('#alignYours');
    if (option) option.hidden = false;
    await this.setSource('yours');
  }

  destroy() {
    this.unwatch?.();
    this.player.destroy();
  }
}
