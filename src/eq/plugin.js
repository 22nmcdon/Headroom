import {
  BAND_TYPES, SLOPES, RESTING_Q, FLAT_CORNER,
  averageLift, contributionOf, curveOf, curveReading, logFrequencies, shortHz, exactHz,
} from './filters.js';
import { EQPlayer } from './player.js';
import { stampOf } from '../read.js';

const LOW = 20;
const HIGH = 20000;
const RANGE = 18; // decibels shown above and below the line
const MOST_RESONANCE = 15;

const toX = (hz, width) => (Math.log2(hz / LOW) / Math.log2(HIGH / LOW)) * width;
const toHz = (x, width) => LOW * (HIGH / LOW) ** (x / width);
const toY = (db, height) => height / 2 - (db / RANGE) * (height / 2);
const toDb = (y, height) => ((height / 2 - y) / (height / 2)) * RANGE;

/**
 * What the analyser is set to show.
 *
 * Tilt is the one that matters. Music loses roughly three decibels an octave
 * on the way up, so an untilted analyser draws every mix as a slope down to
 * the right and there is no reading to be had from the shape. Tilted, a
 * balanced mix is level, and what stands out is what actually stands out.
 *
 * Ballistics is the analyser's own attack and release: fast shows the
 * transients, slow shows the balance. They answer different questions, which
 * is why every analyser has the switch.
 */
const TILTS = [
  { value: 0, label: 'Flat' },
  { value: 3, label: '3 dB/oct' },
  { value: 4.5, label: '4.5 dB/oct' },
];

const BALLISTICS = [
  { value: 0.45, label: 'Fast' },
  { value: 0.72, label: 'Medium' },
  { value: 0.93, label: 'Slow' },
];

/** How close a handle may come to the wall of the display. */
const NODE_EDGE = 12;

/** Where the tilt pivots - the middle of the range, and of the ear. */
const TILT_PIVOT = 1000;

/** How fast a held peak falls back, in decibels per frame. */
const HOLD_FALL = 0.35;

const GRID_HZ = [30, 50, 100, 200, 300, 500, 1000, 2000, 3000, 5000, 10000, 20000];
const LABEL_HZ = [50, 100, 500, 1000, 5000, 10000];
const GRID_DB = [-12, -6, 0, 6, 12];

/**
 * A colour per band, laid out the way the spectrum itself reads: warm at the
 * bottom, cool at the top. Every one is a token the page already owns, so the
 * display stays in the same family as everything around it.
 *
 * They tint a region rather than mark a verdict - the fills sit at a fifth of
 * their strength, under a curve that is drawn in ink - so nothing here
 * competes with the three colours the attempts are read in.
 */
const BAND_TINTS = ['--rust', '--blush-deep', '--gold', '--approach', '--sage', '--enclosure'];

/** The colours the curve is drawn in, read off the page so the mode follows it. */
function palette(el) {
  const style = getComputedStyle(el);
  const read = (name) => style.getPropertyValue(name).trim();
  return {
    tints: BAND_TINTS.map(read),
    ink: read('--charcoal'),
    line: read('--line'),
    // On the display, which is charcoal, rather than on the page.
    soft: 'rgba(250, 246, 240, 0.55)',
    grid: 'rgba(250, 246, 240, 0.14)',
    zero: 'rgba(250, 246, 240, 0.34)',
    accent: read('--blush-deep'),
    blush: read('--blush'),
    paper: read('--paper'),
    sage: read('--sage'),
    gold: read('--gold'),
  };
}

/**
 * The EQ itself: a curve you drag, over a spectrum, with the loop running.
 *
 * Everything here is the plugin a producer already knows how to use - the
 * frequencies laid out the way the ear hears them, a node per band, the
 * numbers underneath. What it is not is a quiz about the plugin.
 */
export class EQPlugin {
  /**
   * `player` and `role` are what let this same interface be two things.
   *
   * As a tool it builds its own player and runs its own loop, which is what
   * an exercise needs. As an insert on a sketchpad track it is handed a
   * player that is a view onto an effect already in somebody's signal path,
   * and the half of the furniture that belongs to an exercise - the A/B
   * against a target, the sample picker, the file button - goes away,
   * because a plugin on a track has a track for its material and a
   * transport of its own.
   *
   * Built here rather than passed in by default so that nothing that
   * already opens a tool has to know this option exists.
   */
  constructor(el, {
    engine, bands, onChange, source = 'mix', player = null, role = 'tool',
  }) {
    this.el = el;
    this.engine = engine;
    this.bands = bands;
    this.onChange = onChange;
    // Not `this.source`: `source()` is the getter for it, and an own property
    // of the same name shadows the method - so asking a freshly built EQ what
    // it was monitoring called a string. The session caught the TypeError,
    // decided the exercise could not be set up, and left the tool untouched.
    this.monitoring = source;
    this.selected = this.bands.findIndex((band) => band.type === 'peaking');
    this.target = null; // drawn only once the round is over
    this.role = role;
    this.player = player ?? new EQPlayer(engine, this.bands);
    this.interactive = true;
    this.tilt = 0;        // decibels per octave added to the drawn spectrum
    this.holding = false; // whether the peaks are being held
    this.held = null;     // and where they have got to

    this.build();
    this.draw();
  }

  /* ---------- the furniture ---------- */

  build() {
    this.el.innerHTML = `
      <div class="eq${this.role === 'insert' ? ' is-insert' : ''}">
        <div class="eq-head">
          <span class="eq-name">Channel EQ</span>
          <span class="eq-trim" id="eqTrim"></span>
          <span class="eq-read" id="eqRead"></span>
        </div>
        <div class="eq-display">
          <canvas class="eq-canvas" id="eqCanvas" tabindex="0"
                  aria-label="The curve. Arrow keys move the selected band."></canvas>
        </div>
        <div class="eq-bands" id="eqBands"></div>
        <div class="eq-shape" id="eqShape"></div>
        <div class="eq-controls" id="eqControls"></div>
        <div class="eq-analyser">
          <span class="panel-name">Analyser</span>
          <label class="field">
            <span class="field-label">Tilt</span>
            <select id="eqTilt">
              ${TILTS.map((tilt) => `<option value="${tilt.value}">${tilt.label}</option>`).join('')}
            </select>
          </label>
          <label class="field">
            <span class="field-label">Ballistics</span>
            <select id="eqBallistics">
              ${BALLISTICS.map((b) => `<option value="${b.value}"${b.value === 0.72 ? ' selected' : ''}>${b.label}</option>`).join('')}
            </select>
          </label>
          <label class="toggle"><input type="checkbox" id="eqHold"> Peak hold</label>
        </div>
        <div class="eq-transport">
          <button class="play-btn" type="button" data-eq="play">Play</button>
          <div class="eq-ab" role="group" aria-label="What you are hearing">
            <button class="ab-btn is-on" type="button" data-hear="mine">Yours</button>
            <button class="ab-btn" type="button" data-hear="theirs" id="eqOther">Target</button>
          </div>
          <button class="ab-btn solo-btn" type="button" data-eq="solo" aria-pressed="false">Solo band</button>
          <label class="field">
            <span class="field-label">Sample</span>
            <select id="eqSource">
              <option value="mix">Full mix</option>
              <option value="drums">Drums</option>
              <option value="instrument">Keys</option>
              <option value="noise">Pink noise</option>
              <option value="yours" id="eqYours" hidden>Your own</option>
            </select>
          </label>
          <label class="file-btn">Open a file<input type="file" id="eqFile" accept="audio/*"></label>
          <button class="link-btn" type="button" data-eq="flatten">Flatten</button>
        </div>
      </div>`;

    this.canvas = this.el.querySelector('#eqCanvas');
    this.readout = this.el.querySelector('#eqRead');
    this.el.querySelector('#eqSource').value = this.monitoring;

    this.buildBandButtons();
    this.buildShape();
    this.buildControls();
    this.wire();
  }

  buildBandButtons() {
    this.el.querySelector('#eqBands').innerHTML = this.bands.map((band, i) => `
      <button class="band-btn" type="button" data-band="${i}"
              aria-pressed="${band.on ? 'true' : 'false'}">
        <span class="band-short">${BAND_TYPES[band.type].short}</span>
        <span class="band-hz">${shortHz(band.frequency)}</span>
      </button>`).join('');
  }

  /**
   * What kind of band this is, and how steep it is if it is a cut.
   *
   * A strip whose six bands are fixed at one type each is a tone control. Any
   * band being any type is a parametric EQ, which is what the display already
   * draws and what the scoring already reads - the curve does not care how
   * you arrived at it.
   */
  buildShape() {
    const band = this.bands[this.selected];
    const cut = Boolean(BAND_TYPES[band.type].resonance);

    this.el.querySelector('#eqShape').innerHTML = `
      <span class="panel-name">Type</span>
      <div class="pick-row" role="group" aria-label="Band type">
        ${Object.entries(BAND_TYPES).map(([id, type]) => `
          <button class="pick-btn" type="button" data-type="${id}"
                  aria-pressed="${id === band.type}" title="${type.label}">${type.short}</button>`).join('')}
      </div>
      <span class="panel-name" ${cut ? '' : 'hidden'}>Slope</span>
      <div class="pick-row" role="group" aria-label="Slope" ${cut ? '' : 'hidden'}>
        ${SLOPES.map((slope) => `
          <button class="pick-btn" type="button" data-slope="${slope}"
                  aria-pressed="${slope === (band.slope ?? 12)}">${slope}</button>`).join('')}
      </div>
      <span class="eq-hint">arrows nudge · shift for fine · [ ] for Q</span>`;
  }

  buildControls() {
    const band = this.bands[this.selected];
    const type = BAND_TYPES[band.type];

    // The readouts are fields, not labels. A slider is how you find a
    // frequency and a terrible way to state one: somebody who knows they want
    // 3.15k should be able to say so, and get 3.15k rather than whatever
    // 3.15k is to the nearest pixel.
    this.el.querySelector('#eqControls').innerHTML = `
      <div class="knob">
        <label class="knob-name" for="eqFreq">Frequency</label>
        <input class="knob-value" id="eqFreqValue" data-entry="frequency" type="text"
               inputmode="decimal" spellcheck="false" value="${exactHz(band.frequency)} Hz"
               aria-label="Frequency, in hertz">
        <input class="knob-dial" type="range" id="eqFreq" min="${Math.log2(LOW)}" max="${Math.log2(HIGH)}"
               step="0.01" value="${Math.log2(band.frequency)}" aria-label="Frequency">
      </div>
      <div class="knob" ${type.gain ? '' : 'hidden'}>
        <label class="knob-name" for="eqGain">Gain</label>
        <input class="knob-value" id="eqGainValue" data-entry="gain" type="text"
               inputmode="decimal" spellcheck="false" value="${band.gain.toFixed(1)} dB"
               aria-label="Gain, in decibels">
        <input class="knob-dial" type="range" id="eqGain" min="-${RANGE}" max="${RANGE}" step="0.1"
               value="${band.gain}" aria-label="Gain">
      </div>
      <div class="knob" ${type.q ? '' : 'hidden'}>
        <label class="knob-name" for="eqQ">Q</label>
        <input class="knob-value" id="eqQValue" data-entry="q" type="text"
               inputmode="decimal" spellcheck="false" value="${band.q.toFixed(2)}" aria-label="Q">
        <input class="knob-dial" type="range" id="eqQ" min="${Math.log2(0.4)}" max="${Math.log2(12)}"
               step="0.01" value="${Math.log2(Math.max(0.4, band.q))}" aria-label="Q">
      </div>
      <div class="knob" ${type.resonance ? '' : 'hidden'}>
        <label class="knob-name" for="eqRes">Resonance</label>
        <input class="knob-value" id="eqResValue" data-entry="resonance" type="text"
               inputmode="decimal" spellcheck="false"
               value="${band.q > 0 ? '+' : ''}${band.q.toFixed(1)} dB" aria-label="Resonance, in decibels">
        <input class="knob-dial" type="range" id="eqRes" min="-${RANGE}" max="${MOST_RESONANCE}" step="0.1"
               value="${band.q}" aria-label="Resonance">
      </div>`;
  }

  /**
   * A number out of something a person typed.
   *
   * "3.15k", "3150", "3.15 kHz" and "3k15" are all the same frequency to an
   * engineer, so they are all the same frequency here. Anything that is not a
   * number at all leaves the control where it was.
   */
  static readEntry(text, kind) {
    const cleaned = String(text).trim().toLowerCase().replace(/\s|hz/g, '');

    if (kind === 'frequency') {
      // 3k15 - the way it is written on a console, with the k where the point
      // would go.
      const split = /^(\d+)k(\d+)$/.exec(cleaned);
      if (split) return Number(`${split[1]}.${split[2]}`) * 1000;

      const value = parseFloat(cleaned);
      if (!Number.isFinite(value)) return null;
      return /k/.test(cleaned) ? value * 1000 : value;
    }

    const value = parseFloat(cleaned.replace('db', ''));
    return Number.isFinite(value) ? value : null;
  }

  /* ---------- working it ---------- */

  wire() {
    const bands = this.el.querySelector('#eqBands');
    bands.addEventListener('click', (e) => {
      const button = e.target.closest('[data-band]');
      if (!button || !this.interactive) return;

      const index = Number(button.dataset.band);
      // The band you are already on toggles; any other one is selected.
      if (index === this.selected) this.bands[index].on = !this.bands[index].on;
      else this.selected = index;

      this.changed();
    });

    this.el.querySelector('#eqControls').addEventListener('input', (e) => {
      if (!this.interactive) return;
      const band = this.bands[this.selected];

      if (e.target.id === 'eqFreq') band.frequency = 2 ** Number(e.target.value);
      if (e.target.id === 'eqGain') band.gain = Number(e.target.value);
      if (e.target.id === 'eqQ') band.q = 2 ** Number(e.target.value);
      if (e.target.id === 'eqRes') band.q = Number(e.target.value);
      band.on = true;
      this.changed({ keepControls: true });
    });

    // Typing a number in, and moving one with the keyboard.
    this.el.querySelector('#eqControls').addEventListener('change', (e) => {
      const entry = e.target.closest('[data-entry]');
      if (entry && this.interactive) this.enter(entry);
    });
    this.el.querySelector('#eqControls').addEventListener('keydown', (e) => {
      const entry = e.target.closest('[data-entry]');
      if (entry && e.key === 'Enter') { e.preventDefault(); entry.blur(); }
    });

    // What kind of band this is, and how steep it is.
    this.el.querySelector('#eqShape').addEventListener('click', (e) => {
      if (!this.interactive) return;
      const band = this.bands[this.selected];

      const type = e.target.closest('[data-type]');
      if (type) {
        const wanted = type.dataset.type;
        if (wanted !== band.type) {
          // Q means three different things across these five, so it is reset
          // to whatever it means here rather than carried over as a number
          // that happened to be in the field. A peak at Q 1.4 becoming a
          // high-pass with 1.4 dB of resonance is a ring, not a cut.
          band.q = RESTING_Q[wanted];
          band.type = wanted;
          band.on = true;
        }
        this.changed();
        return;
      }

      const slope = e.target.closest('[data-slope]');
      if (slope) {
        band.slope = Number(slope.dataset.slope);
        band.on = true;
        this.changed();
      }
    });

    this.canvas.addEventListener('keydown', (e) => this.nudge(e));
    this.canvas.addEventListener('pointerdown', (e) => this.grab(e));
    this.canvas.addEventListener('pointermove', (e) => this.drag(e));
    this.canvas.addEventListener('pointerup', (e) => this.drop(e));
    this.canvas.addEventListener('pointercancel', (e) => this.drop(e));
    this.canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });

    this.el.addEventListener('click', (e) => {
      const hear = e.target.closest('[data-hear]');
      if (hear) {
        this.player.hear(hear.dataset.hear);
        for (const button of this.el.querySelectorAll('[data-hear]')) {
          button.classList.toggle('is-on', button === hear);
        }
        return;
      }

      const action = e.target.closest('[data-eq]');
      if (!action) return;
      if (action.dataset.eq === 'play') this.toggle();
      if (action.dataset.eq === 'solo') this.toggleSolo();
      if (action.dataset.eq === 'flatten' && this.interactive) {
        for (const band of this.bands) { band.gain = 0; band.on = false; }
        this.changed();
      }
    });

    this.el.querySelector('#eqSource')
      .addEventListener('change', (e) => this.setSource(e.target.value));

    this.el.querySelector('#eqTilt').addEventListener('change', (e) => {
      this.tilt = Number(e.target.value);
      this.held = null;
      this.draw();
    });

    this.el.querySelector('#eqBallistics').addEventListener('change', (e) => {
      this.player.setBallistics(Number(e.target.value));
    });

    this.el.querySelector('#eqHold').addEventListener('change', (e) => {
      this.holding = e.target.checked;
      this.held = null;
      this.draw();
    });

    this.el.querySelector('#eqFile')
      .addEventListener('change', (e) => this.loadFile(e.target.files?.[0]));

    this.resize = () => this.draw();
    window.addEventListener('resize', this.resize);
  }

  /** Where the whole curve sits at one frequency - where a handle belongs. */
  curveAt(hz) {
    return curveOf(this.bands, [hz], this.rate())[0];
  }

  rate() {
    return this.engine.ctx?.sampleRate ?? 48000;
  }

  /** Which node the pointer is on, if any. */
  nodeAt(x, y) {
    const { width, height } = this.size();
    return this.bands.findIndex((band) => {
      // Where the disc was drawn, so that what looks grabbable is grabbable.
      const bandX = Math.max(NODE_EDGE, Math.min(width - NODE_EDGE, toX(band.frequency, width)));
      const bandY = toY(this.curveAt(band.frequency), height);
      return Math.hypot(bandX - x, bandY - y) < 22;
    });
  }

  grab(e) {
    if (!this.interactive) return;
    const { x, y } = this.at(e);
    const found = this.nodeAt(x, y);
    if (found === -1) return;

    this.selected = found;
    this.dragging = found;
    this.bands[found].on = true;
    this.canvas.setPointerCapture(e.pointerId);
    this.changed();
  }

  drag(e) {
    const { x, y } = this.at(e);

    if (this.dragging === undefined || this.dragging === null) {
      this.canvas.style.cursor = this.nodeAt(x, y) === -1 ? 'default' : 'grab';
      return;
    }

    const { width, height } = this.size();
    const band = this.bands[this.dragging];
    band.frequency = Math.min(HIGH, Math.max(LOW, toHz(x, width)));
    this.pull(band, toDb(y, height));
    this.changed();
  }

  drop(e) {
    if (this.dragging === undefined || this.dragging === null) return;
    this.dragging = null;
    try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* gone already */ }
  }

  /**
   * Drags the curve to the pointer by moving whatever that band controls.
   *
   * Solved rather than assigned, because the handle is on the composite curve:
   * what has to land under the pointer is the sum of every band at this
   * frequency, so the one being dragged takes the difference. A shelf takes
   * twice it, since it is only halfway up at its corner, and a cut takes it as
   * resonance - which is the fix for dragging a high-pass up and down like
   * everything else, instead of reaching for the wheel.
   */
  pull(band, wanted) {
    const type = BAND_TYPES[band.type];
    const others = this.curveAt(band.frequency) - contributionOf(band, this.rate());
    const mine = wanted - others;

    if (type.gain) {
      band.gain = Math.max(-RANGE, Math.min(RANGE, mine / type.contributes));
    } else if (type.resonance) {
      band.q = Math.max(-RANGE, Math.min(MOST_RESONANCE, mine));
    }
  }

  /** The wheel is the Q of a peak, which is what it does in every EQ worth
      using. A cut has no Q to speak of - its handle is the resonance. */
  wheel(e) {
    if (!this.interactive) return;
    const { x, y } = this.at(e);
    const found = this.nodeAt(x, y);
    if (found === -1) return;

    e.preventDefault();
    const band = this.bands[found];
    if (!BAND_TYPES[band.type].q) return;

    this.selected = found;
    band.q = Math.min(12, Math.max(0.4, band.q * (e.deltaY > 0 ? 1.12 : 1 / 1.12)));
    this.changed();
  }

  at(e) {
    const box = this.canvas.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  }

  changed({ keepControls = false } = {}) {
    this.player.setBands(this.bands);
    // Soloing follows the selection, so picking another band while listening
    // moves the ear rather than dropping out of solo.
    if (this.player.soloing) this.player.setSolo(this.bands[this.selected]);
    this.buildBandButtons();
    this.buildShape();
    if (!keepControls) this.buildControls();
    else this.syncControls();
    this.draw();
    this.onChange?.(this.bands);
  }

  syncControls() {
    const band = this.bands[this.selected];
    const set = (id, value) => {
      const node = this.el.querySelector(id);
      // Never under the hands of somebody typing into it.
      if (node && document.activeElement !== node) node.value = value;
    };
    set('#eqFreqValue', `${exactHz(band.frequency)} Hz`);
    set('#eqGainValue', `${band.gain.toFixed(1)} dB`);
    set('#eqQValue', band.q.toFixed(2));
    set('#eqResValue', `${band.q > 0 ? '+' : ''}${band.q.toFixed(1)} dB`);
  }

  /**
   * Moves the selected band by the keyboard.
   *
   * Left and right are a semitone of frequency, up and down are half a
   * decibel, and shift makes all four of them fine. It is the difference
   * between a plugin you can set and a plugin you can only aim at: a pixel of
   * a logarithmic axis is a different number of hertz at either end of it,
   * and the last decibel of a match is not a pixel wide.
   */
  nudge(e) {
    if (!this.interactive) return;

    const band = this.bands[this.selected];
    const type = BAND_TYPES[band.type];
    const fine = e.shiftKey;
    const hold = (value, low, high) => Math.max(low, Math.min(high, value));
    let took = true;

    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const octaves = (e.key === 'ArrowRight' ? 1 : -1) * (fine ? 1 / 48 : 1 / 12);
      band.frequency = hold(band.frequency * 2 ** octaves, LOW, HIGH);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const by = (e.key === 'ArrowUp' ? 1 : -1) * (fine ? 0.1 : 0.5);
      if (type.gain) band.gain = hold(band.gain + by, -RANGE, RANGE);
      else band.q = hold(band.q + by, -RANGE, MOST_RESONANCE);
      band.on = true;
    } else if ((e.key === '[' || e.key === ']') && type.q) {
      const by = fine ? 1.02 : 1.12;
      band.q = hold(e.key === ']' ? band.q * by : band.q / by, 0.4, 12);
    } else if (e.key === 'Enter' || e.key === ' ') {
      band.on = !band.on;
    } else if (/^[1-6]$/.test(e.key)) {
      this.selected = Number(e.key) - 1;
    } else {
      took = false;
    }

    if (!took) return;
    e.preventDefault();
    this.changed();
  }

  /** Types a number into a control, in whatever form it was written. */
  enter(input) {
    const band = this.bands[this.selected];
    const value = EQPlugin.readEntry(input.value, input.dataset.entry);

    if (value !== null) {
      const hold = (v, low, high) => Math.max(low, Math.min(high, v));
      if (input.dataset.entry === 'frequency') band.frequency = hold(value, LOW, HIGH);
      if (input.dataset.entry === 'gain') { band.gain = hold(value, -RANGE, RANGE); band.on = true; }
      if (input.dataset.entry === 'q') band.q = hold(value, 0.4, 12);
      if (input.dataset.entry === 'resonance') { band.q = hold(value, -RANGE, MOST_RESONANCE); band.on = true; }
    }

    // Rebuilt either way: a number that could not be read is replaced by the
    // one the band is actually on, rather than left sitting there looking set.
    this.changed();
  }

  /**
   * Whether the loop is running, asked from outside.
   *
   * The shell needs this because a drill hides the tool and drives the
   * transport itself: the Play button a drill draws has to say Stop when the
   * loop is going, and the only thing that knows is the player. Reaching
   * through `tool.player.playing` from the shell worked and was a hole in the
   * contract - this is the same answer, asked properly.
   */
  isPlaying() {
    return !!this.player?.playing;
  }

  async toggle() {
    if (this.player.playing) {
      this.player.stop();
      this.playing(false);
      this.draw();
      return;
    }

    await this.player.play(this.monitoring);
    this.player.setBands(this.bands);
    this.playing(true);
  }

  /** The transport's own state, in one place. */
  playing(on) {
    this.el.querySelector('[data-eq="play"]').textContent = on ? 'Stop' : 'Play';

    cancelAnimationFrame(this.frame);
    this.frame = null;
    if (!on) return;

    const tick = () => {
      this.draw();
      this.frame = requestAnimationFrame(tick);
    };
    tick();
  }

  /**
   * Hear the selected band on its own.
   *
   * The fastest way to learn what a frequency sounds like is to listen to it
   * with nothing else in the way - and on a cut, what you hear is exactly what
   * you are throwing out.
   */
  toggleSolo() {
    const button = this.el.querySelector('[data-eq="solo"]');
    const on = button.getAttribute('aria-pressed') !== 'true';

    button.setAttribute('aria-pressed', on ? 'true' : 'false');
    button.classList.toggle('is-on', on);
    this.player.setSolo(on ? this.bands[this.selected] : null);
    this.draw();
  }

  /* ---------- drawing ---------- */

  size() {
    const box = this.canvas.getBoundingClientRect();
    return { width: box.width, height: box.height };
  }

  draw() {
    // A plugin that has been taken off the sheet stops drawing. Its setters
    // are async - rendering a loop takes a second - so their promises can
    // land after it has been torn down, and writing to elements that are no
    // longer in the page is how a clean handover throws.
    if (this.gone) return;
    const { width, height } = this.size();
    if (!width || !height) return;

    const dpr = window.devicePixelRatio || 1;
    if (this.canvas.width !== Math.round(width * dpr)) {
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
    }

    const ink = palette(this.el);
    const c = this.canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, width, height);

    this.drawGrid(c, width, height, ink);
    this.drawSpectrum(c, width, height, ink);
    this.drawRegions(c, width, height, ink);
    if (this.target) this.drawCurve(c, width, height, this.target, ink.sage, 2, [6, 4]);
    this.drawCurve(c, width, height, this.bands, ink.accent, 2.5);
    this.drawNodes(c, width, height, ink);
    this.writeReadout();
  }

  drawGrid(c, width, height, ink) {
    c.lineWidth = 1;
    c.font = '10px system-ui, sans-serif';
    c.textAlign = 'center';

    for (const hz of GRID_HZ) {
      const x = toX(hz, width);
      c.strokeStyle = ink.grid;
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, height);
      c.stroke();

      if (LABEL_HZ.includes(hz)) {
        c.fillStyle = ink.soft;
        c.fillText(shortHz(hz), x, height - 5);
      }
    }

    c.textAlign = 'left';
    for (const db of GRID_DB) {
      const y = toY(db, height);
      c.strokeStyle = db === 0 ? ink.zero : ink.grid;
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(width, y);
      c.stroke();
      if (db !== 0) {
        c.fillStyle = ink.soft;
        c.fillText(`${db > 0 ? '+' : ''}${db}`, 4, y - 3);
      }
    }
  }

  /** What is actually coming out, behind the curve that is shaping it. */
  drawSpectrum(c, width, height, ink) {
    const bins = this.player.spectrum();
    if (!bins) return;

    const rate = this.engine.ctx.sampleRate;
    const columns = Math.floor(width / 2) + 2;
    if (!this.held || this.held.length !== columns) this.held = new Float32Array(columns).fill(-140);

    // -100 dB at the floor of the display, -20 at the top of it.
    const toLevel = (db) => Math.max(0, Math.min(1, (db + 100) / 80));

    c.beginPath();
    c.moveTo(0, height);

    for (let i = 0, x = 0; x <= width; x += 2, i += 1) {
      const hz = toHz(x, width);
      const bin = Math.round((hz / (rate / 2)) * bins.length);
      // Tilted, so a balanced mix reads level instead of sloping away to the
      // right. It changes the picture and nothing else: the curve, the bands
      // and the marking are all untouched by it.
      const db = bins[Math.min(bins.length - 1, bin)] + this.tilt * Math.log2(hz / TILT_PIVOT);

      if (this.holding) this.held[i] = Math.max(db, this.held[i] - HOLD_FALL);
      c.lineTo(x, height - toLevel(db) * height * 0.92);
    }

    c.lineTo(width, height);
    c.closePath();
    c.fillStyle = ink.blush;
    c.globalAlpha = 0.22;
    c.fill();
    c.globalAlpha = 1;

    if (!this.holding) return;

    // Where it has been, which is what you are listening for when a resonance
    // only shows itself on one note in the bar.
    c.beginPath();
    for (let i = 0, x = 0; x <= width; x += 2, i += 1) {
      const y = height - toLevel(this.held[i]) * height * 0.92;
      if (x === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.strokeStyle = ink.gold;
    c.lineWidth = 1;
    c.globalAlpha = 0.75;
    c.stroke();
    c.globalAlpha = 1;
  }

  /**
   * What each band is doing, on its own, shaded from the line it moves away
   * from - so a curve made of several bands can be read as the bands that
   * made it rather than as one shape nobody can take apart.
   *
   * The band being worked on is held a little stronger than the rest, which
   * saves hunting for which region belongs to the handle under the pointer.
   */
  drawRegions(c, width, height, ink) {
    const points = Math.max(120, Math.round(width / 3));
    const frequencies = logFrequencies(points, LOW, HIGH);
    const zero = toY(0, height);

    this.bands.forEach((band, i) => {
      if (band.on === false) return;

      const curve = curveOf([band], frequencies, this.rate());
      let moves = false;

      c.beginPath();
      c.moveTo(0, zero);
      for (let n = 0; n < points; n += 1) {
        if (Math.abs(curve[n]) > 0.05) moves = true;
        c.lineTo((n / (points - 1)) * width, toY(curve[n], height));
      }
      c.lineTo(width, zero);
      c.closePath();

      // A band sitting at unity has no region: there is nothing between it
      // and the line.
      if (!moves) return;

      const tint = ink.tints[i % ink.tints.length];

      c.fillStyle = tint;
      c.globalAlpha = i === this.selected ? 0.36 : 0.15;
      c.fill();

      // Its own edge, drawn faintly. Without it, two regions that overlap are
      // one wash and there is no telling which band is doing what.
      c.strokeStyle = tint;
      c.globalAlpha = i === this.selected ? 0.9 : 0.45;
      c.lineWidth = 1;
      c.stroke();
      c.globalAlpha = 1;
    });
  }

  drawCurve(c, width, height, bands, colour, weight, dash = []) {
    const points = Math.max(160, Math.round(width / 2));
    const frequencies = logFrequencies(points, LOW, HIGH);
    const curve = curveOf(bands, frequencies, this.rate());

    c.beginPath();
    for (let i = 0; i < points; i += 1) {
      const x = (i / (points - 1)) * width;
      const y = toY(curve[i], height);
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.setLineDash(dash);
    c.strokeStyle = colour;
    c.lineWidth = weight;
    c.lineJoin = 'round';
    c.stroke();
    c.setLineDash([]);
  }

  drawNodes(c, width, height, ink) {
    this.bands.forEach((band, i) => {
      const type = BAND_TYPES[band.type];
      // Held inside the display. A low-pass parked at 18k sits a handle's
      // width from the wall, so half of it hung off the edge - and that is
      // where the strip starts, so it was the first thing anybody saw. The
      // curve is still drawn where it belongs and the handle is still grabbed
      // where it belongs; only the disc moves, by a few pixels, at the two
      // ends of the range where the curve is flat anyway.
      const x = Math.max(NODE_EDGE, Math.min(width - NODE_EDGE, toX(band.frequency, width)));
      const y = toY(this.curveAt(band.frequency), height);
      const chosen = i === this.selected;

      const tint = ink.tints[i % ink.tints.length];

      c.beginPath();
      c.arc(x, y, chosen ? 11 : 9, 0, Math.PI * 2);
      // The handle wears its region's colour, so the two are one thing.
      c.fillStyle = band.on ? tint : 'rgba(36, 31, 29, 0.75)';
      c.strokeStyle = band.on ? ink.paper : tint;
      c.lineWidth = chosen ? 3 : 1.5;
      c.fill();
      c.stroke();

      c.fillStyle = band.on ? ink.paper : tint;
      c.font = '600 9px system-ui, sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(type.short, x, y + 0.5);
      c.textBaseline = 'alphabetic';
    });
  }

  writeReadout() {
    // What auto gain is taking back off, said out loud: it is doing something
    // to what you hear, so it should not be doing it invisibly. It keeps its
    // place whatever is loaded - the file's name belongs on the thing that
    // chose it, not in front of the number.
    const lift = averageLift(this.bands, this.rate(), this.player.weights);
    this.el.querySelector('#eqTrim').textContent = Math.abs(lift) < 0.1
      ? 'auto gain · none'
      : `auto gain · ${lift > 0 ? '−' : '+'}${Math.abs(lift).toFixed(1)} dB`;

    const band = this.bands[this.selected];
    const type = BAND_TYPES[band.type];
    const parts = [type.label, `${shortHz(band.frequency)} Hz`];
    if (type.resonance) parts.push(`${band.slope ?? 12} dB/oct`);
    if (type.gain) parts.push(`${band.gain > 0 ? '+' : ''}${band.gain.toFixed(1)} dB`);
    if (type.q) parts.push(`Q ${band.q.toFixed(2)}`);
    if (type.resonance) parts.push(`res ${band.q > 0 ? '+' : ''}${band.q.toFixed(1)} dB`);
    this.readout.textContent = band.on ? parts.join(' · ') : `${type.label} · off`;
  }

  /* ---------- what the round does to it ---------- */

  /**
   * Draw the answer over yours, or take it back off.
   *
   * Null is new, and until the inversion there was nothing that could have
   * asked for it: a round ended, the answer went up, and the whole plugin was
   * destroyed a moment later. A tool that outlives the exercise has to be able
   * to forget one, or the next exercise is worked against the last one's
   * ghost.
   */
  showTarget(bands) {
    this.target = bands ?? null;
    this.draw();
  }

  /* ---------- the lifecycle ---------- */

  /**
   * Put the bands somewhere, without a round having to be started for it.
   *
   * New, and it is the piece the whole inversion turns on. Until now a tool
   * was mounted by an exercise and torn down when the exercise changed, so
   * "what is this set to" only ever had one answer per lifetime. A workbench
   * needs the other direction: the tool is the thing that stays, and an
   * exercise is something that arrives, sets it up, and leaves it as it found
   * it.
   *
   * The strip is mutated rather than replaced, because the player, the drag
   * handles and the readout all hold the same array. Six bands in, six bands
   * out, always: `newStrip` decides what a strip is and this does not.
   */
  setState(bands) {
    if (!Array.isArray(bands)) return;
    bands.forEach((band, i) => { if (this.bands[i]) Object.assign(this.bands[i], band); });

    this.reading = null;
    this.syncControls();
    this.player.setBands(this.bands);
    this.draw();
    this.onChange?.(this.state());
  }

  /** A resonance somebody else left in the sample, before it reached you. */
  setFault(fault) {
    this.player.setFault(fault ?? null);
    this.draw();
  }

  /**
   * What is on the other side of the A/B, or nothing.
   *
   * Null had never been passed here: a round ended and the plugin was
   * destroyed. `EQPlayer.tune` walks the bands it is given, so null went
   * straight into a `forEach` - an error nobody had a way to reach.
   */
  setTarget(bands) {
    this.player.setTarget(bands ?? []);
  }

  /** Change what is running through it. */
  async setSource(id) {
    this.monitoring = id;
    const picker = this.el.querySelector('#eqSource');
    if (picker) picker.value = id;
    if (this.player.playing) await this.player.play(id);
    this.draw();
  }

  /** Something the player brought themselves. */
  async loadFile(file) {
    if (!file) return false;

    const yours = this.el.querySelector('#eqYours');
    if (yours) { yours.hidden = false; yours.textContent = 'reading…'; }

    try {
      const buffer = await this.player.load(file);
      this.monitoring = 'yours';
      const picker = this.el.querySelector('#eqSource');
      if (picker) picker.value = 'yours';
      // Straight onto it: somebody who has just chosen a file wants to hear
      // their own material, not to be told it loaded.
      await this.player.play('yours');
      this.playing(true);
      this.player.setBands(this.bands);
      if (yours) yours.textContent = `${file.name} · ${Math.round(buffer.duration)}s`;
      this.draw();
      return true;
    } catch {
      if (yours) yours.textContent = 'that file could not be read';
      return false;
    }
  }

  /** The other side of the A/B, named for what it actually is. */
  /**
   * What the monitor is set to.
   *
   * A getter, and new. Restoring a tool to what it was doing means knowing
   * what it was doing, and nothing could say. Note that it is not `playing`:
   * that one is a setter on all six, so asking it a question answers by
   * turning the sound off.
   */
  source() {
    return this.monitoring ?? null;
  }

  /** What the other side of the A/B is currently called. */
  abLabel() {
    return this.el.querySelector('#eqOther')?.textContent ?? null;
  }

  /** The other side of the A/B, named for what it actually is. */
  nameAB(label) {
    const slot = this.el.querySelector('#eqOther');
    if (slot) slot.textContent = label;
  }

  nameOther(label) {
    const slot = this.el.querySelector('#eqOther');
    if (slot) slot.textContent = label;
  }

  /* ---------- what this is a reading of ---------- */

  /** What the strip is set to. Copied, so a caller cannot move it by holding it. */
  state() {
    return this.bands.map((band) => ({ ...band }));
  }

  /**
   * The curve, in an envelope.
   *
   * Memoised on the settings it was taken of, which is the first time the EQ
   * has cached anything at all - `curveOf` ran three times per frame on the
   * display and twice more in the scoring, five answers to one question with
   * nothing asserting they agreed. Cheap enough that nobody noticed, and that
   * is not the same as correct.
   *
   * The display keeps recomputing per frame at whatever resolution the canvas
   * is: that is a picture, at a different number of points, and it is not this.
   */
  read() {
    const state = stampOf(this.state());
    if (!this.reading || this.reading.of.state !== state) {
      this.reading = curveReading(this.state(), this.rate(),
        { source: this.player?.source ?? null });
    }
    return this.reading;
  }

  /** The curve needs no material and no waiting, so this is the same answer. */
  async readNow() {
    return this.read();
  }

  lock() {
    this.interactive = false;
    this.el.querySelector('.eq').classList.add('is-locked');
  }

  /**
   * And back, with everything where it was left.
   *
   * `lock()` never had an inverse, because nothing ever needed one: a round
   * ended and the surface was torn down. Asking to be shown the answer is a
   * state the round carries on from - the target is drawn and the controls
   * stay live, so you can hear your way towards what you were chasing - and
   * that needs the door to open again.
   */
  unlock() {
    this.interactive = true;
    this.el.querySelector('.eq').classList.remove('is-locked');
  }

  destroy() {
    this.gone = true;
    this.player.stop();
    // Whatever the player is, it is told to let go of what it made. An
    // insert's adapter drops an analyser; a tool's player stops a loop. The
    // effect itself belongs to the track and is not this view's to end.
    this.player.destroy?.();
    cancelAnimationFrame(this.frame);
    window.removeEventListener('resize', this.resize);
  }
}
