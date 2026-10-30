// The face of six devices that are one device.
//
// What it has to show is not what the modulation did to the signal - that is
// different for each family and is the reason the reading is what it is, see
// `trace.js` - but what the oscillator is doing, which is the same picture for
// all six and the only one that makes them comparable. A path across four
// seconds, two channels of it, in the family's own unit.
//
// The kind picker is the instrument. Everything else on the face is the same
// three or four controls whichever row of the table is selected, which is the
// claim this suite exists to make: these are not six effects.

import {
  MOD_DEFAULTS, MOD_LIMITS, MOD_KINDS, MOD_SHAPES, MOD_SPREADS, MOD_FAMILIES,
  modKind,
} from './dsp.js';
import { MOD_SECONDS, modReading, unitOf } from './trace.js';
import { ModPlayer } from './player.js';
import { notReady, stampOf } from '../../lib/read.js';
import {
  dialOf, offDial, readyCanvas, watchSize, span, writeHertz,
} from '../../lib/panel.js';
import { dressKnobs } from '../../lib/knob.js';
import { SYNC_DIVISIONS, rateFor, nearestDivision } from '../../lib/tempo.js';

const MOD_KNOBS = {
  rate: {
    id: 'rate',
    name: 'Rate',
    ...span(MOD_LIMITS.rate),
    log: true,
    write: (hz) => (hz >= 10 ? `${hz.toFixed(1)} Hz` : `${hz.toFixed(2)} Hz`),
  },
  depth: {
    id: 'depth',
    name: 'Depth',
    ...span(MOD_LIMITS.depth),
    step: 0.01,
    write: (v) => `${Math.round(v * 100)} %`,
  },
  feedback: {
    id: 'feedback',
    name: 'Feedback',
    ...span(MOD_LIMITS.feedback),
    step: 0.05,
    write: (v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)} %`,
  },
};

/** How tall the path display is, in fractions of full travel either way. */
const PATH_TOP = 1.15;

function modPalette(el) {
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

export class ModulationPlugin {
  constructor(el, {
    engine, settings, onChange, source = null, player = null, role = 'tool',
  }) {
    this.el = el;
    this.engine = engine;
    this.settings = settings ?? { ...MOD_DEFAULTS };
    this.onChange = onChange;
    this.role = role;
    this.interactive = true;
    this.target = null;
    this.shown = null;

    this.player = player ?? new ModPlayer(engine, { source: source ?? 'instrument' });

    this.build();
    this.draw();

    if (this.role === 'insert') this.playing(true);

    this.player.prepare()
      .then(() => { this.player.setSettings(this.settings); this.draw(); })
      .catch(() => { /* no audio yet; the knobs still work */ });
    this.player.setSettings(this.settings);
  }

  /* ---------- the furniture ---------- */

  kind() { return modKind(this.settings.kind); }

  knobsFor() {
    return this.kind().knobs.map((id) => MOD_KNOBS[id]).filter(Boolean);
  }

  build() {
    const host = this.role === 'insert' ? '' : `
      <div class="eq-transport host-row">
        <button class="play-btn" type="button" data-mod="play">Play</button>
        <div class="eq-ab" role="group" aria-label="What you are hearing">
          <button class="ab-btn is-on" type="button" data-mod-hear="mine">Yours</button>
          <button class="ab-btn" type="button" data-mod-hear="theirs">Target</button>
        </div>
        <label class="field">
          <span class="field-label">Sample</span>
          <select id="modSource">
            <option value="instrument">Keys</option>
            <option value="mix">Full mix</option>
            <option value="drums">Drums</option>
            <option value="voice">Voice</option>
            <option value="yours" id="modYours" hidden>Your own</option>
          </select>
        </label>
        <label class="file-btn">Open a file<input type="file" id="modFile" accept="audio/*"></label>
      </div>`;

    this.el.innerHTML = `${host}
      <div class="plugin modulation${this.role === 'insert' ? ' is-insert' : ''}">
        <div class="plugin-head">
          <span class="plugin-lamp"></span>
          <span class="plugin-name" id="modName">Modulation</span>
          <span class="plugin-trim" id="modTrim"></span>
          <span class="plugin-read" id="modRead"></span>
        </div>

        <div class="stereo-display">
          <div class="plugin-bay">
            <span class="panel-name">What is moving</span>
            <div class="plugin-panel"><canvas id="modPath"></canvas></div>
          </div>
          <div class="plugin-bay">
            <span class="panel-name">Where it is wired</span>
            <div class="plugin-panel"><canvas id="modFigures"></canvas></div>
          </div>
        </div>

        <div class="plugin-controls" id="modKnobs"></div>

        <div class="stereo-routing">
          <label class="field">
            <span class="field-label">Effect</span>
            <select id="modKind">
              ${MOD_KINDS.map((k) => `<option value="${k.id}">${k.label}</option>`).join('')}
            </select>
          </label>
          <label class="field">
            <span class="field-label">Sync</span>
            <select id="modSync">
              ${SYNC_DIVISIONS.map((d) => `<option value="${d.id}">${d.label}</option>`).join('')}
            </select>
          </label>
          <label class="field" id="modSpreadField">
            <span class="field-label">Sides</span>
            <select id="modSpread">
              ${MOD_SPREADS.map((s) => `<option value="${s.id}">${s.label}</option>`).join('')}
            </select>
          </label>
          <label class="field">
            <span class="field-label">Shape</span>
            <select id="modShape">
              ${MOD_SHAPES.map((s) => `<option value="${s.id}">${s.label}</option>`).join('')}
            </select>
          </label>
          <span class="eq-hint" id="modHint"></span>
        </div>
      </div>`;

    this.path = this.el.querySelector('#modPath');
    this.figures = this.el.querySelector('#modFigures');

    const sample = this.el.querySelector('#modSource');
    if (sample) sample.value = this.player.source;

    this.buildKnobs();
    this.wire();
  }

  buildKnobs() {
    this.el.querySelector('#modKnobs').innerHTML = this.knobsFor().map((knob) => {
      const dial = dialOf(knob, this.settings[knob.id]);
      return `
        <div class="knob">
          <label class="knob-name" for="mod-${knob.id}">${knob.name}</label>
          <output class="knob-value" id="mod-${knob.id}-value">${knob.write(this.settings[knob.id])}</output>
          <input class="knob-dial" type="range" id="mod-${knob.id}" data-dial="${knob.id}"
                 min="${dial.min}" max="${dial.max}" step="${dial.step}" value="${dial.at}"
                 data-rest="${dialOf(knob, MOD_DEFAULTS[knob.id]).at}"
                 aria-label="${knob.name}">
        </div>`;
    }).join('');
    this.syncKnobs();
  }

  wire() {
    this.el.querySelector('#modKnobs').addEventListener('input', (e) => {
      const dial = e.target.closest('[data-dial]');
      if (!dial || !this.interactive) return;
      const knob = MOD_KNOBS[dial.dataset.dial];
      this.settings[knob.id] = offDial(knob, dial.value);
      // Turning the rate by hand is how you leave the grid, which is what
      // every synced delay and every synced modulation has always done.
      if (knob.id === 'rate') this.settings.sync = 'free';
      this.changed();
    });

    this.el.addEventListener('click', (e) => {
      const hear = e.target.closest('[data-mod-hear]');
      if (hear) {
        this.player.hear(hear.dataset.modHear);
        for (const button of this.el.querySelectorAll('[data-mod-hear]')) {
          button.classList.toggle('is-on', button === hear);
        }
        return;
      }
      if (e.target.closest('[data-mod="play"]')) this.toggle();
    });

    this.el.querySelector('#modKind')?.addEventListener('change', (e) => {
      if (!this.interactive) return;
      this.settings.kind = e.target.value;
      // The deck is per kind: a vibrato has no feedback and a tremolo has no
      // sides, and a knob that does nothing is a knob that lies.
      this.buildKnobs();
      this.changed();
    });

    this.el.querySelector('#modSync')?.addEventListener('change', (e) => {
      if (!this.interactive) return;
      this.setSync(e.target.value);
    });

    this.el.querySelector('#modSpread')?.addEventListener('change', (e) => {
      if (!this.interactive) return;
      this.settings.spread = Number(e.target.value);
      this.changed();
    });

    this.el.querySelector('#modShape')?.addEventListener('change', (e) => {
      if (!this.interactive) return;
      this.settings.shape = e.target.value;
      this.changed();
    });

    this.el.querySelector('#modSource')
      ?.addEventListener('change', (e) => this.setSource(e.target.value));
    this.el.querySelector('#modFile')
      ?.addEventListener('change', (e) => this.loadFile(e.target.files?.[0]));

    this.resize = () => this.draw();
    this.unwatch = watchSize(this.el, this.resize);
  }

  /**
   * The rate, from a note value.
   *
   * One cycle per note, which is the convention every synced modulation uses:
   * a tremolo on eighths pulses twice a beat. The rate knob is still the rate
   * - this writes it rather than overriding it - so leaving the grid is a
   * matter of turning the knob and the two can never disagree.
   */
  setSync(id) {
    const division = SYNC_DIVISIONS.find((d) => d.id === id);
    this.settings.sync = id;
    if (division?.beats) this.settings.rate = rateFor(division.beats);
    this.changed();
  }

  changed() {
    this.syncKnobs();
    this.player.setSettings(this.settings);
    this.draw();
    this.onChange?.(this.settings);
  }

  syncKnobs() {
    for (const knob of this.knobsFor()) {
      const readout = this.el.querySelector(`#mod-${knob.id}-value`);
      const dial = this.el.querySelector(`#mod-${knob.id}`);
      if (readout) readout.textContent = knob.write(this.settings[knob.id]);
      if (dial && document.activeElement !== dial) {
        dial.value = dialOf(knob, this.settings[knob.id]).at;
      }
    }

    const kind = this.kind();
    const set = (id, value) => {
      const field = this.el.querySelector(id);
      if (field && field.value !== String(value)) field.value = String(value);
    };
    set('#modKind', this.settings.kind);
    set('#modSync', this.settings.sync ?? 'free');
    set('#modSpread', this.settings.spread);
    set('#modShape', this.settings.shape ?? 'sine');

    // The sides picker is hidden rather than disabled for the two kinds that
    // have no say in it: a vibrato is one signal and an auto-pan is opposite
    // by definition.
    const sides = this.el.querySelector('#modSpreadField');
    if (sides) sides.hidden = !kind.knobs.includes('spread');

    const name = this.el.querySelector('#modName');
    if (name) name.textContent = kind.label;
    const hint = this.el.querySelector('#modHint');
    if (hint) hint.textContent = MOD_HINTS[kind.id] ?? '';

    dressKnobs(this.el);
  }

  /* ---------- the reading ---------- */

  read() {
    const of = {
      state: stampOf({ ...this.settings }),
      source: this.player.source,
      axis: this.player.reading?.of?.axis ?? null,
    };
    if (!this.player.reading) return notReady({ tool: 'modulation', kind: 'modulation', of });
    return this.player.reading;
  }

  async readNow() {
    this.player.setSettings(this.settings);
    return this.read();
  }

  /* ---------- the pictures ---------- */

  draw() {
    const ink = modPalette(this.el);
    this.drawPath(ink);
    this.drawFigures(ink);
    this.writeReadout();
  }

  /**
   * The oscillator's path: four seconds of it, both channels.
   *
   * Drawn as a fraction of full travel rather than in the family's unit, so
   * that the picture is the same picture for all six and a tremolo and a
   * flanger can be looked at side by side. The unit is on the axis instead -
   * the two ends of the travel, in milliseconds or hertz or decibels - which
   * is where the number anybody wants is.
   *
   * The second channel is drawn underneath in the same colour at half
   * strength. When the sides are set to mono the two lie exactly on top of
   * each other, which is the right picture of mono: one line.
   */
  drawPath(ink) {
    const stage = readyCanvas(this.path);
    if (!stage) return;
    const { c, width, height } = stage;
    const values = this.player.reading?.values;

    const mid = height / 2;
    const y = (travel) => mid - (travel / PATH_TOP) * (mid - 8);

    c.font = '9.5px system-ui, sans-serif';
    c.strokeStyle = ink.grid;
    c.lineWidth = 1;
    for (let s = 1; s < MOD_SECONDS; s += 1) {
      const x = (s / MOD_SECONDS) * width;
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, height);
      c.stroke();
    }
    c.strokeStyle = ink.zero;
    c.beginPath();
    c.moveTo(0, mid);
    c.lineTo(width, mid);
    c.stroke();

    if (!values) {
      c.fillStyle = ink.soft;
      c.textAlign = 'left';
      c.fillText(this.role === 'insert' ? 'play the sketch' : 'press play', 6, 12);
      return;
    }

    const line = (frames, stroke, alpha = 1, dash = null) => {
      c.strokeStyle = stroke;
      c.globalAlpha = alpha;
      c.lineWidth = 1.3;
      if (dash) c.setLineDash(dash);
      c.beginPath();
      for (let i = 0; i < frames.length; i += 1) {
        const x = (i / (frames.length - 1)) * width;
        const at = y(Math.max(-PATH_TOP, Math.min(PATH_TOP, frames[i])));
        if (i === 0) c.moveTo(x, at); else c.lineTo(x, at);
      }
      c.stroke();
      c.globalAlpha = 1;
      if (dash) c.setLineDash([]);
    };

    if (this.shown) {
      line(this.shown.left, ink.sage, 1, [2, 3]);
      line(this.shown.right, ink.sage, 0.45, [2, 3]);
    }
    line(values.right, ink.blush, 0.45);
    line(values.left, ink.accent || ink.blush);

    // The ends of the travel, in the unit the thing is actually set in.
    c.fillStyle = ink.soft;
    c.textAlign = 'left';
    c.fillText(this.writeUnit(values.to), 4, 11);
    c.fillText(this.writeUnit(values.from), 4, height - 4);
    c.textAlign = 'right';
    c.fillText(`${MOD_SECONDS} s`, width - 4, height - 4);
  }

  writeUnit(value) {
    const unit = MOD_FAMILIES[this.kind().family].unit;
    if (unit === 'Hz') return writeHertz(value);
    if (unit === 'dB') return `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`;
    return `${value.toFixed(1)} ms`;
  }

  /**
   * Where the oscillator is wired, and what it works out to.
   *
   * The rate twice over - in hertz and as the note value it is nearest, the
   * way the delay writes its time - because a modulation that is in time with
   * the music is a different instrument from one that is not, and nobody
   * tunes one in hertz.
   */
  drawFigures(ink) {
    const stage = readyCanvas(this.figures);
    if (!stage) return;
    const { c, width, height } = stage;
    const values = this.player.reading?.values;
    const kind = this.kind();

    c.font = '9.5px system-ui, sans-serif';
    const rows = [
      ['wired to', MOD_FAMILIES[kind.family].label],
      ['rate', values ? this.writeRate(values.hz) : '—'],
      ['travel', values ? `${this.writeUnit(values.from)} to ${this.writeUnit(values.to)}` : '—'],
      ['sides', kind.opposed ? 'opposite' : (MOD_SPREADS.find((s) => s.id === this.settings.spread)?.label ?? '—')],
    ];
    if (kind.feeds) rows.push(['feedback', `${Math.round((this.settings.feedback ?? 0) * 100)} %`]);

    // Spread across the panel rather than stacked at the top of it: this bay
    // is as tall as the path beside it and five rows of text at a fixed
    // eighteen pixels left two thirds of it empty.
    const line = (height - 6) / (rows.length + 0.4);
    rows.forEach(([name, value], i) => {
      const at = line * (i + 0.8);
      c.textAlign = 'left';
      c.fillStyle = ink.soft;
      c.fillText(name, 2, at);
      c.textAlign = 'right';
      c.fillStyle = ink.blush;
      c.fillText(String(value), width - 4, at);
    });
  }

  /**
   * The rate, in hertz and in notes.
   *
   * "not read" below two bins of the path's own transform, which is half a
   * hertz: a four second window cannot be told the rate of something that has
   * not been round twice, and saying so is better than printing the number
   * the fit collapses to. See `rateOf`.
   */
  writeRate(hz) {
    if (!(hz > 0)) return 'slower than this reads';
    const near = nearestDivision(1000 / hz);
    const on = near && near.off < 0.02 ? ` · ${near.division.label}` : '';
    return `${hz < 10 ? hz.toFixed(2) : hz.toFixed(1)} Hz${on}`;
  }

  writeReadout() {
    const values = this.player.reading?.values;
    const read = this.el.querySelector('#modRead');
    const trim = this.el.querySelector('#modTrim');
    if (read) read.textContent = values ? this.writeRate(values.hz) : '';
    if (trim) {
      trim.textContent = values
        ? `${Math.round(values.depth * 100)}% of travel`
        : '';
    }
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
    const button = this.el.querySelector('[data-mod="play"]');
    if (button) button.textContent = on ? 'Stop' : 'Play';
    this.el.querySelector('.plugin-lamp')?.classList.toggle('is-on', !!on);
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

  /** Draw the answer's own path over yours, or take it back off. */
  showTarget(target) {
    if (!target) { this.shown = null; this.draw(); return; }
    this.shown = modReading({ ...MOD_DEFAULTS, ...target }).values;
    this.draw();
  }

  source() {
    return this.player.source ?? null;
  }

  abLabel() {
    return this.el.querySelector('[data-mod-hear="theirs"]')?.textContent ?? null;
  }

  nameAB(label) {
    const slot = this.el.querySelector('[data-mod-hear="theirs"]');
    if (slot) slot.textContent = label;
  }

  /**
   * What a guess is marked against: nothing.
   *
   * The reading is the oscillator's own path and no material enters into it,
   * so there is nothing to pin. A chorus sweeps the same way over a drum loop
   * and over a piano - which is the property that lets somebody practise on
   * whichever they like and be marked on what they did rather than on what
   * they listened to.
   */
  async material() {
    return null;
  }

  lock() {
    this.interactive = false;
    this.el.querySelector('.modulation')?.classList.add('is-locked');
  }

  unlock() {
    this.interactive = true;
    this.el.querySelector('.modulation')?.classList.remove('is-locked');
  }

  async setSource(id) {
    this.player.source = id;
    const picker = this.el.querySelector('#modSource');
    if (picker) picker.value = id;
    await this.player.prepare().catch(() => {});
    this.player.setSettings(this.settings);
    this.draw();
  }

  async loadFile(file) {
    if (!file) return;
    await this.player.load(file);
    const option = this.el.querySelector('#modYours');
    if (option) option.hidden = false;
    await this.setSource('yours');
  }

  destroy() {
    this.unwatch?.();
    this.player.destroy();
  }
}

/** One line per kind, about the thing people get wrong with it. */
const MOD_HINTS = {
  chorus: 'two voices rather than one — the depth is how far out of tune the second one goes',
  flanger: 'the feedback is the character and the depth is the sweep; they are not the same control',
  vibrato: 'no dry signal at all, which is why it bends rather than thickens',
  phaser: 'six all-passes, so three notches — the feedback is what makes them whistle',
  tremolo: 'a gain, not a filter: nothing about the tone changes, only how much of it there is',
  autopan: 'the same gain twice, pulling opposite ways — in mono it disappears entirely',
};
