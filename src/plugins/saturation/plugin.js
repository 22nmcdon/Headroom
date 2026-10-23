import {
  HEAT_DEFAULTS, HARMONICS, HEAT_FLOOR, HARMONIC_AXIS, MOST_TONE, MASKED,
  harmonicsOf, harmonicsReading, transferCurve,
  HEAT_LIMITS,
} from './shape.js';
import { notReady, stampOf } from '../../lib/read.js';
import { HeatPlayer } from './player.js';
import { dialOf, offDial, readyCanvas, watchSize, span } from '../../lib/panel.js';
import { dressKnobs } from '../../lib/knob.js';
import { writeHertz } from '../../lib/panel.js';

/**
 * The saturator, as a plugin.
 *
 * Two pictures, and between them they say everything a saturator does. The
 * curve is the cause: a straight line through the middle of the panel does
 * nothing, a line that bends at the ends is saturating, and a line that bends
 * at one end sooner than the other is biased. The bars are the effect: the
 * harmonics that curve makes, coloured by whether they are even or odd,
 * because that division is the one an ear can learn.
 *
 * The bars are drawn from the settings rather than from the sound. Harmonics
 * are only ever harmonics of something, and a drum loop has no fundamental
 * for them to be harmonics of - so the reading comes off a sine put through
 * the same curve, which is a complete description of it and the same thing
 * the marking uses.
 */

const HEAT_TOP = 0;   // the bars are drawn against the fundamental, so 0 is it
const NUMBERS = 15;   // the strip along the bottom the harmonic numbers sit in

const barX = (i, width) => ((i + 0.5) / HARMONICS.length) * width;

const barY = (db, height) => {
  const plot = height - NUMBERS;
  return plot - ((db - HEAT_FLOOR) / (HEAT_TOP - HEAT_FLOOR)) * plot;
};

/** Every knob, and how it reads. */
const HEAT_KNOBS = [
  {
    id: 'drive',
    name: 'Drive',
    ...span(HEAT_LIMITS.drive),
    step: 0.5,
    write: (v) => `${v.toFixed(1)} dB`,
  },
  {
    id: 'bias',
    name: 'Bias',
    ...span(HEAT_LIMITS.bias),
    step: 0.01,
    write: (v) => (v < 0.02 ? 'Symmetric' : `${Math.round(v * 100)}%`),
  },
  {
    id: 'hardness',
    name: 'Hardness',
    ...span(HEAT_LIMITS.hardness),
    step: 0.05,
    write: (v) => (v < 1.6 ? `Soft · ${v.toFixed(1)}` : v > 4 ? `Hard · ${v.toFixed(1)}` : v.toFixed(1)),
  },
  {
    id: 'tone',
    name: 'Tone',
    ...span(HEAT_LIMITS.tone),
    log: true,
    write: (v) => (v >= MOST_TONE - 1 ? 'Open' : writeHertz(v)),
  },
  {
    id: 'mix',
    name: 'Mix',
    ...span(HEAT_LIMITS.mix),
    step: 0.01,
    write: (v) => `${Math.round(v * 100)}%`,
  },
];

const HEAT_LISTENS = [
  { id: 'out', label: 'Output' },
  { id: 'diff', label: 'Only the heat' },
];

function heatPalette(el) {
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
    faint: 'rgba(250, 246, 240, 0.3)',
    // Odd harmonics are not a verdict, so they are drawn in nothing in
    // particular and the even ones carry the only colour on the panel.
    odd: 'rgba(250, 246, 240, 0.5)',
    floorWash: 'rgba(250, 246, 240, 0.045)',
    rustWash: 'rgba(164, 85, 63, 0.18)',
  };
}

export class HeatPlugin {
  constructor(el, {
    engine, settings, onChange, source = 'mix', fault = null,
    player = null, role = 'tool',
  }) {
    this.el = el;
    this.engine = engine;
    this.settings = settings;
    this.onChange = onChange;
    this.role = role;
    this.interactive = true;
    this.target = null;
    this.reading = null;

    this.player = player ?? new HeatPlayer(engine, { source });
    this.player.setFault(fault);

    this.build();
    this.measure();
    this.draw();

    this.player.prepare()
      .then(() => { this.measure(); this.draw(); })
      .catch(() => { /* no audio yet; the knobs still work */ });
  }

  /* ---------- the furniture ---------- */

  build() {
    // Everything a host does, outside the chassis. Choosing the material,
    // starting it, comparing against the target, going back to the defaults:
    // none of that is a saturator's, and a saturator with a Sample menu on
    // its face is not one anybody would recognise. The sketchpad is its own
    // host and has these already, so an insert gets none of it.
    const host = this.role === 'insert' ? '' : `
      <div class="eq-transport heat-host">
        <button class="play-btn" type="button" data-heat="play">Play</button>
        <div class="eq-ab" role="group" aria-label="What you are hearing">
          <button class="ab-btn is-on" type="button" data-hear="mine">Yours</button>
          <button class="ab-btn" type="button" data-hear="theirs" id="heatOther">Target</button>
        </div>
        <label class="field">
          <span class="field-label">Sample</span>
          <select id="heatSource">
            <option value="mix">Full mix</option>
            <option value="instrument">Keys</option>
            <option value="drums">Drums</option>
            <option value="yours" id="heatYours" hidden>Your own</option>
          </select>
        </label>
        <label class="file-btn">Open a file<input type="file" id="heatFile" accept="audio/*"></label>
        <button class="link-btn" type="button" data-heat="reset">Reset</button>
      </div>`;

    this.el.innerHTML = `${host}
      <div class="plugin heat${this.role === 'insert' ? ' is-insert' : ''}">
        <div class="plugin-head">
          <span class="plugin-lamp"></span>
          <span class="plugin-name">Saturation</span>
          <span class="plugin-read" id="heatRead"></span>
          <div class="eq-ab" role="group" aria-label="What you are monitoring">
            ${HEAT_LISTENS.map((l) => `<button class="ab-btn${l.id === 'out' ? ' is-on' : ''}" type="button" data-listen="${l.id}">${l.label}</button>`).join('')}
          </div>
        </div>

        <div class="heat-meters">
          <div class="heat-bay heat-bay-curve">
            <span class="panel-name">Transfer</span>
            <div class="plugin-panel"><canvas id="heatCurve"></canvas></div>
          </div>
          <div class="heat-bay heat-bay-series">
            <span class="panel-name">Harmonic series</span>
            <div class="plugin-panel"><canvas id="heatBars"></canvas></div>
            <div class="heat-balance" id="heatBalance"></div>
          </div>
          <div class="heat-bay heat-bay-out">
            <span class="panel-name">Lvl</span>
            <div class="plugin-panel"><canvas id="heatMeters"></canvas></div>
            <div class="heat-delta" id="heatDelta"></div>
          </div>
        </div>

        <div class="heat-deck">
          <span class="panel-name">Curve &amp; output</span>
          <div class="plugin-controls" id="heatKnobs"></div>
        </div>

        <div class="heat-set">
          <label class="toggle">
            <input type="checkbox" id="heatAuto" checked>
            Auto gain
            <span class="plugin-trim" id="heatTrim"></span>
          </label>
        </div>
      </div>
      <div class="heat-drill" id="heatDrill" hidden></div>`;

    this.curve = this.el.querySelector('#heatCurve');
    this.bars = this.el.querySelector('#heatBars');
    this.meters = this.el.querySelector('#heatMeters');
    const picker = this.el.querySelector('#heatSource');
    if (picker) picker.value = this.player.source;

    this.buildKnobs();
    this.wire();
  }

  buildKnobs() {
    this.el.querySelector('#heatKnobs').innerHTML = HEAT_KNOBS.map((knob) => {
      const dial = dialOf(knob, this.settings[knob.id]);
      return `
        <div class="knob">
          <label class="knob-name" for="heat-${knob.id}">${knob.name}</label>
          <output class="knob-value" id="heat-${knob.id}-value">${knob.write(this.settings[knob.id])}</output>
          <input class="knob-dial" type="range" id="heat-${knob.id}" data-dial="${knob.id}"
                 min="${dial.min}" max="${dial.max}" step="${dial.step}" value="${dial.at}"
                 data-rest="${dialOf(knob, HEAT_DEFAULTS[knob.id] ?? dial.at).at}"
                 aria-label="${knob.name}">
        </div>`;
    }).join('');
    this.syncKnobs();
  }

  wire() {
    this.el.querySelector('#heatKnobs').addEventListener('input', (e) => {
      const dial = e.target.closest('[data-dial]');
      if (!dial || !this.interactive) return;
      const knob = HEAT_KNOBS.find((k) => k.id === dial.dataset.dial);
      this.settings[knob.id] = offDial(knob, dial.value);
      this.changed();
    });

    this.el.querySelector('#heatAuto').addEventListener('change', (e) => {
      this.player.setAuto(e.target.checked);
      this.writeReadout();
    });

    this.el.addEventListener('click', (e) => {
      const hear = e.target.closest('[data-hear]');
      if (hear) {
        this.player.hear(hear.dataset.hear);
        for (const button of this.el.querySelectorAll('[data-hear]')) {
          button.classList.toggle('is-on', button === hear);
        }
        return;
      }

      const listen = e.target.closest('[data-listen]');
      if (listen) {
        // Monitoring, not processing: it changes what you are checking and
        // never what you are marked on.
        this.settings.listen = listen.dataset.listen;
        for (const button of this.el.querySelectorAll('[data-listen]')) {
          button.classList.toggle('is-on', button === listen);
        }
        this.player.setSettings(this.settings);
        if (this.player.target) {
          this.player.setTarget({ ...this.player.target, listen: this.settings.listen });
        }
        this.writeReadout();
        return;
      }

      const action = e.target.closest('[data-heat]');
      if (!action) return;
      if (action.dataset.heat === 'play') this.toggle();
      if (action.dataset.heat === 'reset' && this.interactive) {
        const listen = this.settings.listen;
        Object.assign(this.settings, HEAT_DEFAULTS, { listen });
        this.buildKnobs();
        this.changed();
      }
    });

    this.el.querySelector('#heatSource')
      ?.addEventListener('change', (e) => this.setSource(e.target.value));
    this.el.querySelector('#heatFile')
      ?.addEventListener('change', (e) => this.loadFile(e.target.files?.[0]));

    this.resize = () => this.draw();
    this.unwatch = watchSize(this.el, this.resize);
  }


  changed() {
    this.syncKnobs();
    this.schedule();
    this.draw();
    this.onChange?.(this.settings);
  }

  /**
   * Hands the settings on, no more often than it is worth doing.
   *
   * Matching the level of a saturator means putting a second of the loop
   * through it, eight times oversampled, which is the most expensive thing
   * the app does - fine once, far too slow for every frame of a drag. The
   * curve and the bars are arithmetic and redraw instantly; the sound and
   * its trim catch up when the hand stops.
   */
  schedule() {
    clearTimeout(this.soon);
    this.soon = setTimeout(() => {
      this.player.setSettings(this.settings);
      this.measure();
      this.draw();
    }, 110);
  }

  measure() {
    const rate = this.engine?.ctx?.sampleRate ?? 48000;
    this.reading = harmonicsReading(rate, this.settings, { source: this.player.source ?? null });
    return this.reading;
  }

  /* ---------- the lifecycle ---------- */

  /**
   * Put the controls somewhere, without a round having to be started for it.
   *
   * New, and it is the piece the whole inversion turns on. Until now a tool
   * was mounted by an exercise and torn down when the exercise changed, so
   * "what is this set to" only ever had one answer per lifetime. A workbench
   * needs the other direction: the tool is the thing that stays, and an
   * exercise is something that arrives, sets it up, and leaves it as it found
   * it.
   */
  setState(next) {
    Object.assign(this.settings, next);
    this.buildKnobs();
    this.changed();
  }

  /**
   * Change what is running through it.
   *
   * Lifted out of the `<select>` handler, which is now three lines that call
   * this. An exercise has to be able to put its own material on a tool it did
   * not mount, and reaching into somebody's change event to do it is how a
   * plugin ends up with a second, worse copy of its own lifecycle.
   */
  async setSource(id) {
    this.player.source = id;
    this.player.buffer = null;
    const picker = this.el.querySelector('#heatSource');
    if (picker) picker.value = id;

    await this.player.prepare().catch(() => {});
    if (this.player.playing) await this.player.play();
    this.measure();
    this.draw();
  }

  /** Colour somebody else already put on it, before it reached you. */
  async setFault(fault) {
    this.player.setFault(fault ?? null);
    this.player.buffer = null;
    await this.player.prepare().catch(() => {});
    if (this.player.playing) await this.player.play();
    this.measure();
    this.draw();
  }

  /**
   * Something the player brought themselves.
   *
   * Was the body of an event handler, which meant nothing could load a file
   * except a file input. Takes a File now, and the handler unwraps the event.
   */
  async loadFile(file) {
    if (!file) return false;

    const yours = this.el.querySelector('#heatYours');
    if (yours) { yours.hidden = false; yours.textContent = 'reading…'; }

    try {
      const buffer = await this.player.load(file);
      await this.setSource('yours');
      if (!this.player.playing) { await this.player.play(); this.playing(true); }
      if (yours) {
        yours.textContent = `${file.name} · ${Math.round(buffer.duration)}s`
          + (buffer.numberOfChannels > 1 ? '' : ' · mono');
      }
      return true;
    } catch {
      if (yours) yours.textContent = 'that file could not be read';
      return false;
    }
  }

  /* ---------- what this is a reading of ---------- */

  /** What the saturator is set to. */
  state() {
    return { ...this.settings };
  }

  /**
   * The harmonic series these settings make - synchronously, always.
   *
   * The second of the three bugs the envelope exists for. `schedule()` defers
   * the measurement a hundred and ten milliseconds and the curve redraws at
   * once, so the transfer curve bent live while the bars underneath it still
   * showed the previous settings' harmonics - under a doc comment promising
   * that "the curve and the bars redraw instantly". The curve did. The bars
   * did not, and nothing could tell them apart.
   */
  read() {
    const of = {
      state: stampOf(this.state()),
      source: this.player.source ?? null,
      axis: HARMONIC_AXIS,
    };

    if (!this.reading) {
      this.schedule();
      return notReady({ tool: 'saturation', kind: 'harmonics', of });
    }
    if (this.reading.of.state !== of.state) {
      this.schedule();
      return { ...this.reading, of, ready: false };
    }
    return this.reading;
  }

  /** The same, but waited for. */
  async readNow() {
    clearTimeout(this.soon);
    this.player.setSettings(this.settings);
    this.measure();
    return this.read();
  }

  syncKnobs() {
    for (const knob of HEAT_KNOBS) {
      const readout = this.el.querySelector(`#heat-${knob.id}-value`);
      const dial = this.el.querySelector(`#heat-${knob.id}`);
      if (readout) readout.textContent = knob.write(this.settings[knob.id]);
      if (dial && document.activeElement !== dial) {
        dial.value = dialOf(knob, this.settings[knob.id]).at;
      }
    }
    dressKnobs(this.el);
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
      return;
    }
    await this.player.play();
    this.playing(true);
  }

  playing(on) {
    this.el.querySelector('[data-heat="play"]').textContent = on ? 'Stop' : 'Play';
  }

  /* ---------- drawing ---------- */

  draw() {
    // A plugin that has been taken off the sheet stops drawing. Its setters
    // are async - rendering a loop takes a second - so their promises can
    // land after it has been torn down, and writing to elements that are no
    // longer in the page is how a clean handover throws.
    if (this.gone) return;
    const ink = heatPalette(this.el);
    this.drawCurve(ink);
    this.drawBars(ink);
    this.drawBalance();
    this.drawLevels(ink);
    this.drawDrill();
    this.writeReadout();
  }

  /**
   * The transfer curve: what comes out, for everything that could go in.
   *
   * Drawn against the straight line it would be if nothing happened, because
   * a curve on its own is hard to read and the gap between the two is the
   * whole of the effect. The lopsidedness is the part worth looking for -
   * one half pulling away from the line sooner than the other is the even
   * harmonics, drawn.
   */
  drawCurve(ink) {
    const stage = readyCanvas(this.curve);
    if (!stage) return;
    const { c, width, height } = stage;

    const pad = 10;
    const span = Math.min(width, height) - pad * 2;
    const left = (width - span) / 2;
    const top = (height - span) / 2;
    const at = (x, y) => [left + ((x + 1) / 2) * span, top + ((1 - y) / 2) * span];

    c.strokeStyle = ink.grid;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(...at(-1, 0)); c.lineTo(...at(1, 0));
    c.moveTo(...at(0, -1)); c.lineTo(...at(0, 1));
    c.stroke();

    // What no processing at all looks like.
    c.strokeStyle = ink.zero;
    c.setLineDash([4, 4]);
    c.beginPath();
    c.moveTo(...at(-1, -1)); c.lineTo(...at(1, 1));
    c.stroke();
    c.setLineDash([]);

    // Drawn to fill the panel, so that the shape is what you read rather
    // than the level. The dashed diagonal is then a straight line through
    // the same two corners - what a gain change alone would do - and how far
    // the curve leaves it is exactly how much saturation there is.
    const line = (settings, stroke, dash) => {
      const points = transferCurve(settings);
      let tallest = 0;
      for (const y of points) tallest = Math.max(tallest, Math.abs(y));
      const scale = tallest > 1e-9 ? 1 / tallest : 1;

      c.strokeStyle = stroke;
      c.lineWidth = dash ? 1.6 : 2.2;
      c.setLineDash(dash ? [5, 3] : []);
      c.beginPath();
      points.forEach((y, i) => {
        const x = (i / (points.length - 1)) * 2 - 1;
        const [px, py] = at(x, y * scale);
        if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
      });
      c.stroke();
      c.setLineDash([]);
    };

    line(this.settings, ink.blush, false);

    c.font = '9.5px system-ui, sans-serif';
    c.fillStyle = ink.soft;
    c.textAlign = 'left';
    c.fillText('in against out', 6, 12);
  }

  /**
   * The harmonics the curve makes, second to tenth, against the note itself.
   *
   * Coloured rather than labelled, because the division that matters is not
   * one you read off a number. Even harmonics are an octave, a fifteenth, a
   * seventeenth above - intervals that sound like the note getting bigger.
   * Odd ones are a twelfth and a seventeenth of a different kind, and they
   * sound like something breaking. A saturator whose bars are mostly one
   * colour is a saturator with a character you can name.
   */
  drawBars(ink) {
    const stage = readyCanvas(this.bars);
    if (!stage) return;
    const { c, width, height } = stage;

    c.font = '9.5px system-ui, sans-serif';
    c.strokeStyle = ink.grid;
    c.lineWidth = 1;
    c.textAlign = 'right';
    c.fillStyle = ink.soft;
    for (let db = 0; db > HEAT_FLOOR; db -= 20) {
      const y = barY(db, height);
      c.beginPath(); c.moveTo(0, y); c.lineTo(width, y); c.stroke();
      c.fillText(`${db}`, width - 4, y - 3);
    }

    const reading = this.read();
    if (!reading.values) return;

    // Dimmed while it is behind. The curve beside these is arithmetic and is
    // always current; measuring the series is fifty-odd milliseconds and is
    // not. Saying so is the whole fix - the bars are still worth seeing, they
    // are just not a reading of what is on the knobs this instant.
    const behind = !reading.ready;

    this.drawFloors(c, reading.values, width, height, ink);

    const slot = width / HARMONICS.length;
    const bar = Math.min(26, slot * 0.52);
    const base = barY(HEAT_FLOOR, height);

    HARMONICS.forEach((m, i) => {
      const level = Math.max(HEAT_FLOOR, reading.values.harmonics[m]);
      const x = barX(i, width);
      const top = barY(level, height);

      // Blush for even, a neutral for odd. Not gold and rust: those two
      // pigments mean "in the chord but misplaced" and "outside the chord"
      // everywhere else in this app, and a harmonic's parity is not a verdict
      // on it. The rust below is the one place here that does mean that.
      c.fillStyle = m % 2 === 0 ? ink.blush : ink.odd;
      c.globalAlpha = behind ? 0.32 : 0.8;
      c.fillRect(x - bar / 2, top, bar, Math.max(1, base - top));
      c.globalAlpha = 1;

      c.fillStyle = ink.soft;
      c.textAlign = 'center';
      c.fillText(String(m), x, height - 4);
    });

    c.textAlign = 'left';
    if (behind) {
      c.fillStyle = ink.soft;
      c.fillText('harmonics · measuring…', 6, 12);
    } else {
      // Two notes, and only as many of them as fit. On a phone the panel is
      // narrow enough that the second one ran off the edge, and a caption
      // clipped mid-word reads worse than a caption that is not there.
      const legend = 'harmonics · pink is even';
      const floor = this.floorSays ?? '';
      const joined = `${legend} · `;
      c.fillStyle = ink.soft;
      const room = 6 + c.measureText(joined).width + c.measureText(floor).width < width - 6;
      c.fillText(room ? joined : legend, 6, 12);
      if (room) {
        c.fillStyle = this.floorCovered ? ink.rust : ink.faint;
        c.fillText(floor, 6 + c.measureText(joined).width, 12);
      }
    }
  }

  /**
   * Two floors, and only ever one of them drawn.
   *
   * The low one is masking: a harmonic more than MASKED under the loudest of
   * them is covered by its neighbours, and there is no point marking anybody
   * on something they cannot hear. That is normal and it is drawn quietly.
   *
   * The other is everything the curve made that is not at a multiple of the
   * note - `aliasing`, which is measured on the same scale as the bars and in
   * every honest mode sits at -279 dB, far below the bottom of this panel. It
   * climbs when a curve runs too fast for the rate it is running at, and a bar
   * whose top is under it is a harmonic you can no longer hear as one, because
   * it is inside hash that belongs to no note. Rust, because that pigment
   * already means outside the chord, and inharmonic is exactly that.
   */
  drawFloors(c, values, width, height, ink) {
    const loudest = Math.max(...HARMONICS.map((m) => values.harmonics[m]));
    const masking = Math.max(HEAT_FLOOR, loudest - MASKED);
    const junk = values.aliasing ?? -200;
    const covered = junk > masking;
    const at = Math.max(masking, Math.min(HEAT_TOP, junk));
    const y = barY(at, height);
    const base = barY(HEAT_FLOOR, height);

    c.fillStyle = covered ? ink.rustWash : ink.floorWash;
    c.fillRect(0, y, width, Math.max(0, base - y));
    c.strokeStyle = covered ? ink.rust : ink.grid;
    c.lineWidth = 1;
    c.setLineDash([3, 3]);
    c.beginPath(); c.moveTo(0, y); c.lineTo(width, y); c.stroke();
    c.setLineDash([]);

    this.floorSays = covered
      ? `inharmonic from ${junk.toFixed(0)}`
      : `masked below ${at.toFixed(0)}`;
    this.floorCovered = covered;
  }

  /**
   * Parity on one strip, order on the other.
   *
   * Even against odd is the flavour, and it is the half of this an untrained
   * ear can learn first. Low orders against high is the body: the second and
   * the third both read as warmth whichever way their parity falls, and the
   * seventh and the ninth both read as edge. One without the other is half a
   * description, and both come off the same nine numbers at no cost.
   */
  drawBalance() {
    const host = this.el.querySelector('#heatBalance');
    if (!host) return;
    const reading = this.read();

    if (!this.strips) {
      this.strips = [
        { id: 'flavour', left: 'Odd', right: 'Even', name: 'Flavour', span: 24 },
        { id: 'body', left: 'Fizz', right: 'Warmth', name: 'Body', span: 40 },
      ];
      host.innerHTML = this.strips.map((strip) => `
        <div class="heat-strip">
          <div class="heat-strip-names">
            <span>${strip.left}</span><span>${strip.name}</span><span>${strip.right}</span>
          </div>
          <canvas data-strip="${strip.id}"></canvas>
        </div>`).join('');
    }

    const values = reading.values;
    const sum = (keep) => {
      let total = 0;
      for (const m of HARMONICS) if (keep(m)) total += Math.pow(10, values.harmonics[m] / 10);
      return 10 * Math.log10(Math.max(total, 1e-20));
    };
    const tilts = values
      ? {
        flavour: sum((m) => m % 2 === 0) - sum((m) => m % 2 === 1),
        body: sum((m) => m <= 4) - sum((m) => m >= 5),
      }
      : null;

    const ink = heatPalette(this.el);
    for (const strip of this.strips) {
      const stage = readyCanvas(host.querySelector(`[data-strip="${strip.id}"]`));
      if (!stage) continue;
      const { c, width, height } = stage;
      const mid = width / 2;
      const reach = mid - 4;
      const at = (v) => mid + Math.max(-1, Math.min(1, v / strip.span)) * reach;

      c.strokeStyle = ink.grid;
      c.lineWidth = 1;
      c.beginPath(); c.moveTo(mid, 1); c.lineTo(mid, height - 1); c.stroke();

      if (!tilts) continue;
      const x = at(tilts[strip.id]);
      c.globalAlpha = reading.ready ? 1 : 0.35;
      c.fillStyle = ink.blush;
      c.fillRect(Math.min(mid, x), height / 2 - 2, Math.abs(x - mid), 4);
      c.fillStyle = '#faf6f0';
      c.fillRect(x - 1.4, 0, 2.8, height);
      c.globalAlpha = 1;
    }
  }

  /**
   * What went in against what came out, and the difference named.
   *
   * The difference is the point. A saturator makes everything louder and
   * denser at once, louder wins every blind comparison there has ever been,
   * and a number saying how much louder is the cheapest honesty on the face.
   * Only the sketchpad's player meters anything, so in a drill this reads as
   * dashes rather than disappearing - a control that vanishes teaches a
   * different plugin.
   */
  drawLevels(ink) {
    const stage = readyCanvas(this.meters);
    if (!stage) return;
    const { c, width, height } = stage;
    const read = this.player.levels?.();
    const delta = this.el.querySelector('#heatDelta');

    const lane = Math.min(10, width / 3);
    const bar = (x, db) => {
      const h = height * Math.max(0, Math.min(1, (db + 48) / 48));
      c.fillStyle = 'rgba(0, 0, 0, 0.3)';
      c.fillRect(x, 0, lane, height);
      c.fillStyle = db > -48 ? ink.blush : 'transparent';
      c.fillRect(x, height - h, lane, h);
    };

    const bay = this.meters.closest('.heat-bay');
    bay?.classList.toggle('is-idle', !read);

    if (!read) {
      c.fillStyle = 'rgba(0, 0, 0, 0.28)';
      c.fillRect(0, 0, lane, height);
      c.fillRect(width - lane, 0, lane, height);
      if (delta) delta.textContent = 'no meter';
      return;
    }

    bar(0, read.input ?? -96);
    bar(width - lane, read.output ?? -96);
    if (delta) {
      const off = (read.output ?? -96) - (read.input ?? -96);
      delta.textContent = `${off > 0 ? '+' : ''}${off.toFixed(1)} Δ`;
    }
  }

  /**
   * How far off this is, drawn on the paper rather than on the plugin.
   *
   * Nothing the exercise has to say goes on the face. A target dashed across
   * a meter is still a mark on a device that will not have one, and somebody
   * who learns to hit the mark has learned to read a mark rather than to
   * hear - which is the one thing this is for. So it goes here, under the
   * chassis, in the page's own ink: nine gauges, one per harmonic, each the
   * distance between what is set and what is being matched.
   *
   * Better than the dashes it replaces, as it happens. Those made you compare
   * two heights by eye; these are the error itself, which is what is marked.
   */
  drawDrill() {
    const host = this.el.querySelector('#heatDrill');
    if (!host) return;
    const reading = this.read();
    if (!this.target || !reading.values) {
      host.hidden = true;
      host.innerHTML = '';
      return;
    }

    host.hidden = false;
    const SPAN = 12;
    const close = this.targetClose;
    const gauges = HARMONICS.map((m) => {
      const mine = Math.max(HEAT_FLOOR, reading.values.harmonics[m]);
      const theirs = Math.max(HEAT_FLOOR, this.target.harmonics[m]);
      const off = mine - theirs;
      const span = Math.max(-SPAN, Math.min(SPAN, off));
      const inside = close ? Math.abs(off) <= close : null;
      const band = close ? Math.min(1, close / SPAN) * 46 : 0;
      const y = 50 - (span / SPAN) * 46;
      return `
        <span class="gauge">
          <svg viewBox="0 0 54 100" aria-hidden="true">
            ${close ? `<rect x="14" y="${50 - band}" width="26" height="${band * 2}" rx="3"
              fill="rgba(111,127,99,.22)"/>` : ''}
            <line x1="27" y1="8" x2="27" y2="92" stroke="rgba(58,51,47,.14)" stroke-width="2"/>
            <line x1="12" y1="50" x2="42" y2="50" stroke="rgba(58,51,47,.32)" stroke-width="2"/>
            <circle cx="27" cy="${y.toFixed(1)}" r="8"
              fill="${inside === null ? '#6b615a' : inside ? '#6f7f63' : '#a4553f'}"/>
          </svg>
          <b>${m}</b>
        </span>`;
    }).join('');

    const scored = close
      ? HARMONICS.filter((m) => Math.abs(
        Math.max(HEAT_FLOOR, reading.values.harmonics[m])
        - Math.max(HEAT_FLOOR, this.target.harmonics[m]),
      ) <= close).length
      : null;

    host.innerHTML = `
      <div class="heat-drill-head">
        <span>Exercise · match the sound</span>
        ${scored === null ? '' : `<span class="heat-drill-score">${scored} of ${HARMONICS.length} inside ±${close.toFixed(1)} dB</span>`}
      </div>
      <div class="heat-gauges">${gauges}</div>`;
  }

  writeReadout() {
    const trim = this.el.querySelector('#heatTrim');
    if (trim) {
      const level = this.player.trim ?? 0;
      trim.textContent = this.player.auto ? `${level > 0 ? '+' : ''}${level.toFixed(1)} dB` : 'off';
    }

    const parts = [];
    const reading = this.read();
    if (reading.values && reading.ready) {
      parts.push(`${reading.values.thd.toFixed(1)} dB of harmonics`);
      const tilt = reading.values.even - reading.values.odd;
      if (reading.values.even < HEAT_FLOOR) parts.push('odd only');
      else if (tilt > 3) parts.push('even-led');
      else if (tilt < -3) parts.push('odd-led');
      else parts.push('even and odd together');
    } else if (reading.values) {
      parts.push('measuring…');
    }
    if (this.settings.listen === 'diff') parts.push('hearing the difference only');

    this.el.querySelector('#heatRead').textContent = parts.join(' · ');
  }

  /* ---------- what the round does to it ---------- */

  setTarget(target) {
    this.player.setTarget(target);
  }

  /** Draw the answer over yours, or take it back off. */
  /**
   * `close` is the window the round is being marked to, in decibels, and it
   * is optional because the one call that shows a target serves all six
   * tools and none of them are handed one yet. Without it the gauges still
   * say how far off each harmonic is; they just do not say which of them
   * count as right, because inventing a tolerance here would be a second
   * copy of a number that lives in work/ and the day the two drift is the
   * day the page disagrees with the marking.
   */
  showTarget(target, { close = null } = {}) {
    this.targetClose = close;
    if (!target) {
      this.target = null;
      this.targetSettings = null;
      this.draw();
      return;
    }

    const rate = this.engine?.ctx?.sampleRate ?? 48000;
    this.targetSettings = { ...HEAT_DEFAULTS, ...target };
    this.target = harmonicsOf(rate, this.targetSettings);
    this.draw();
  }

  /**
   * What the monitor is set to.
   *
   * A getter, and new. Restoring a tool to what it was doing means knowing
   * what it was doing, and nothing could say. Note that it is not `playing`:
   * that one is a setter on all six, so asking it a question answers by
   * turning the sound off.
   */
  source() {
    return this.player.source ?? null;
  }

  /** What the other side of the A/B is currently called. */
  abLabel() {
    return this.el.querySelector('#heatOther')?.textContent ?? null;
  }

  /**
   * Nothing to render.
   *
   * A saturator is marked on what its curve does to a sine, which is a
   * complete description of what it does to anything - so the reading needs
   * no loop, and the rate is all the session has to pin.
   */
  async material() {
    return { rate: this.engine?.ctx?.sampleRate ?? 48000 };
  }

  /** The other side of the A/B, named for what it actually is. */
  nameAB(label) {
    const slot = this.el.querySelector('#heatOther');
    if (slot) slot.textContent = label;
  }

  nameOther(label) {
    const slot = this.el.querySelector('#heatOther');
    if (slot) slot.textContent = label;
  }

  lock() {
    this.interactive = false;
    this.el.querySelector('.heat').classList.add('is-locked');
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
    this.el.querySelector('.heat').classList.remove('is-locked');
  }

  destroy() {
    this.gone = true;
    clearTimeout(this.soon);
    this.unwatch?.();
    this.player.destroy();
  }
}
