// The same core, aimed somewhere else.
//
// A gate and a de-esser are not new processors. They are this folder's
// detector, this folder's smoother and this folder's static curve, pointed at
// a different part of the signal: the gate at the quiet, the de-esser at a
// band. `dsp.js` grew two things for them - the curve mirrored about the
// threshold, and the reduction applied to a band instead of to everything -
// and everything else they need was already here.
//
// Which is why they share a face as well as a core. Two instruments whose
// difference is a curve and a crossover would be two nearly identical files,
// and the second one would stop matching the first within a month. What
// differs between them is a list of knobs, a set of defaults and what the
// figures are called, so that is what a spec holds.
//
// The compressor keeps its own face, because it has two families, a transfer
// curve to draw and a sidechain to wire, and folding three instruments into
// one display would make all three worse.

import {
  COMP_DEFAULTS, COMP_LIMITS, expandGain, staticGain,
} from './dsp.js';
import { CompPlayer } from './player.js';
import { reductionPass } from './reading.js';
import { notReady, stampOf } from '../../lib/read.js';
import {
  dialOf, offDial, readyCanvas, watchSize, span, writeMs, writeHertz,
} from '../../lib/panel.js';
import { dressKnobs } from '../../lib/knob.js';

/** Where the reduction trace starts and stops, in dB. */
const AIM_TOP = 0;
const AIM_DEEP = -42;

const aimY = (db, height) =>
  ((Math.max(AIM_DEEP, Math.min(AIM_TOP, db)) - AIM_TOP) / (AIM_DEEP - AIM_TOP)) * height;

/** Open enough to count as open, in dB of reduction. */
const AIM_OPEN = -1;

/**
 * Every knob either of them might have, by id.
 *
 * One table rather than one per spec, because `Threshold` means the same
 * thing on both and a second copy of it is a second place for the step size
 * to be wrong.
 */
const AIM_KNOBS = {
  threshold: {
    id: 'threshold',
    name: 'Threshold',
    ...span(COMP_LIMITS.threshold),
    step: 0.5,
    write: (v) => `${v.toFixed(1)} dB`,
  },
  ratio: {
    id: 'ratio',
    name: 'Ratio',
    ...span(COMP_LIMITS.ratio),
    step: 0.5,
    write: (v) => `${v.toFixed(1)}:1`,
  },
  range: {
    id: 'range',
    name: 'Range',
    ...span(COMP_LIMITS.range),
    step: 1,
    write: (v) => `${v.toFixed(0)} dB`,
  },
  attack: {
    id: 'attack',
    name: 'Attack',
    ...span(COMP_LIMITS.attack),
    step: 0.1,
    log: true,
    write: writeMs,
  },
  hold: {
    id: 'hold',
    name: 'Hold',
    ...span(COMP_LIMITS.hold),
    step: 5,
    write: (v) => (v > 0 ? writeMs(v) : 'none'),
  },
  release: {
    id: 'release',
    name: 'Release',
    ...span(COMP_LIMITS.release),
    step: 5,
    log: true,
    write: writeMs,
  },
  hysteresis: {
    id: 'hysteresis',
    name: 'Hysteresis',
    ...span(COMP_LIMITS.hysteresis),
    step: 0.5,
    write: (v) => (v > 0 ? `${v.toFixed(1)} dB` : 'none'),
  },
  crossover: {
    id: 'crossover',
    name: 'Crossover',
    ...span(COMP_LIMITS.crossover),
    step: 50,
    log: true,
    write: writeHertz,
  },
};

/**
 * The gate, as a spec.
 *
 * The `room` bed, which had to be built for this, and the measurement that
 * sent me to build it is worth keeping: the `drums` bed is digital silence
 * between its hits - a median of -180 dBFS in ten millisecond frames - so a
 * gate over it is deciding how much quieter to make nothing. Measured there,
 * moving the threshold from -44 to -20 changed what the gate did by a third
 * of a decibel. A gate needs something under the hits or it has no question
 * to answer; see `core/audio.js` for what got put there.
 *
 * `range` rather than silence is the control that matters - a gate shut all
 * the way is a gate you can hear closing, and the fix is to let it close only
 * part of the way.
 *
 * The ratio is 8 rather than the compressor's 3, and the measurement says
 * why only just. Under the knee the ratio is how steeply the gain falls away
 * once the signal is below the threshold, so what it decides is whether the
 * range is ever reached. Measured on the room bed at a threshold of -26 with
 * 24 dB of range allowed, the deepest the gate gets to is 15.4 dB at a ratio
 * of 2, 22.2 at 3 and 23.1 at 8 - so anything from 3 up arrives, and what 8
 * buys over 3 is not the depth but the time spent there: an average of 12.15
 * dB against 10.53. A gate that is on its way back up for a third of every
 * gap is a gate whose range knob reads as something else.
 */
export const GATE_FACE = {
  id: 'gate',
  name: 'Gate',
  mark: 'gate',
  source: 'room',
  other: 'Untreated',
  defaults: {
    ...COMP_DEFAULTS,
    shape: 'expand',
    threshold: -30,
    ratio: 8,
    range: 30,
    knee: 3,
    attack: 1,
    hold: 40,
    release: 120,
    hysteresis: 6,
    makeup: 0,
    mix: 1,
  },
  knobs: ['threshold', 'ratio', 'range', 'attack', 'hold', 'release', 'hysteresis'],
  // A gate has no band. What it has is a detector, and hearing what the
  // detector hears is how anybody finds out that it is opening on the hi-hat.
  listen: 'Hear the detector',
  hint: 'a gate shut all the way is a gate you can hear closing — the range is the knob that fixes that',
  figures: (values, open) => [
    ['deepest', `${values.deepest.toFixed(1)} dB`],
    ['average', `${values.average.toFixed(2)} dB`],
    ['open for', `${(open.share * 100).toFixed(0)}%`],
    ['opened', `${open.times}×`],
  ],
};

/**
 * The de-esser, as a spec.
 *
 * The voice bed, which had to be built for this: nothing else in the app has
 * any sibilance in it, and a de-esser on material with none is a tool nobody
 * can hear working. See `core/audio.js` for what a synthetic ess is.
 *
 * `Band only` against `Whole signal` is the control that makes it a de-esser
 * rather than a compressor with a filtered sidechain, and it is a switch
 * rather than a fixed setting so the difference can be heard. Measured, with
 * the detector high-passed at 5 kHz: broadband ducks 400 Hz by 4 dB every
 * time an S arrives, where the split leaves it inside a decibel and a half.
 */
export const DEESS_FACE = {
  id: 'deess',
  name: 'De-esser',
  mark: 'deess',
  source: 'voice',
  other: 'Untreated',
  defaults: {
    ...COMP_DEFAULTS,
    shape: 'compress',
    split: true,
    crossover: 6500,
    scHigh: 6500,
    threshold: -30,
    ratio: 5,
    knee: 3,
    attack: 1,
    release: 60,
    range: 12,
    makeup: 0,
    mix: 1,
  },
  knobs: ['threshold', 'ratio', 'crossover', 'attack', 'release', 'range'],
  listen: 'Hear the band',
  hint: 'listen to the band on its own first — a de-esser aimed at the wrong place takes the voice with it',
  /**
   * The crossover drives the detector as well as the split, and that is a
   * measurement rather than a simplification.
   *
   * The reduction reading - what the compressor, the gate and the limiter are
   * all marked on - is the gain the detector asked for. The crossover decides
   * where that gain is applied and not how big it is, so with the detector on
   * its own control the crossover was invisible to the marking: measured,
   * moving it an octave either way changed the reading by 0.00 dB. A round
   * cannot ask for something it then cannot mark.
   *
   * Tying them is also the better instrument. "The band it listens to is the
   * band it ducks" is one idea with one control, where two controls that have
   * to be kept in agreement are two controls somebody will leave disagreeing.
   */
  couple: (settings) => ({ scHigh: settings.crossover }),
  // Whether the reduction goes on the band or on everything, which is the
  // whole difference and so is on the face rather than in the defaults.
  picker: {
    id: 'split',
    label: 'Ducks',
    options: [
      { id: 'band', label: 'Band only' },
      { id: 'whole', label: 'Whole signal' },
    ],
    read: (settings) => (settings.split ? 'band' : 'whole'),
    write: (value) => ({ split: value === 'band' }),
  },
  figures: (values, open, settings) => [
    ['deepest', `${values.deepest.toFixed(1)} dB`],
    ['average', `${values.average.toFixed(2)} dB`],
    ['ducking', `${(open.share * 100).toFixed(0)}%`],
    ['band from', writeHertz(settings.crossover ?? 6500)],
  ],
};

function aimPalette(el) {
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

/** How much of the loop was worked on, and how many separate times. */
function openingsOf(frames) {
  if (!frames?.length) return { share: 0, times: 0 };
  let worked = 0;
  let times = 0;
  let was = false;
  for (let i = 0; i < frames.length; i += 1) {
    const now = frames[i] < AIM_OPEN;
    if (now) worked += 1;
    if (now && !was) times += 1;
    was = now;
  }
  return { share: worked / frames.length, times };
}

export class AimedPlugin {
  constructor(el, {
    engine, settings, onChange, spec, source = null, fault = null,
    player = null, role = 'tool',
  }) {
    this.el = el;
    this.engine = engine;
    this.spec = spec;
    this.settings = settings;
    this.onChange = onChange;
    this.role = role;
    this.interactive = true;
    this.target = null;
    this.shown = null;
    this.live = 0;

    this.player = player ?? new CompPlayer(engine, { source: source ?? spec.source });

    this.build();
    this.draw();

    if (this.role === 'insert') this.playing(true);

    this.player.prepare()
      .then(() => { this.player.setSettings(this.settings); this.draw(); })
      .catch(() => { /* no audio yet; the knobs still work */ });
    this.player.setSettings(this.settings);
  }

  /* ---------- the furniture ---------- */

  knobsFor() {
    return this.spec.knobs.map((id) => AIM_KNOBS[id]).filter(Boolean);
  }

  build() {
    const mark = this.spec.mark;
    const host = this.role === 'insert' ? '' : `
      <div class="eq-transport host-row">
        <button class="play-btn" type="button" data-aim="play">Play</button>
        <div class="eq-ab" role="group" aria-label="What you are hearing">
          <button class="ab-btn is-on" type="button" data-aim-hear="mine">Treated</button>
          <button class="ab-btn" type="button" data-aim-hear="theirs">${this.spec.other}</button>
        </div>
        <label class="field">
          <span class="field-label">Sample</span>
          <select id="${mark}Source">
            <option value="voice">Voice</option>
            <option value="drums">Drums</option>
            <option value="room">Drums in a room</option>
            <option value="mix">Full mix</option>
            <option value="instrument">Keys</option>
            <option value="yours" id="${mark}Yours" hidden>Your own</option>
          </select>
        </label>
        <label class="file-btn">Open a file<input type="file" id="${mark}File" accept="audio/*"></label>
      </div>`;

    this.el.innerHTML = `${host}
      <div class="plugin ${mark}${this.role === 'insert' ? ' is-insert' : ''}">
        <div class="plugin-head">
          <span class="plugin-lamp"></span>
          <span class="plugin-name">${this.spec.name}</span>
          <span class="plugin-trim" id="${mark}Live"></span>
          <span class="plugin-read" id="${mark}Read"></span>
        </div>

        <div class="stereo-display">
          <div class="plugin-bay">
            <span class="panel-name">Gain reduction</span>
            <div class="plugin-panel"><canvas id="${mark}Trace"></canvas></div>
          </div>
          <div class="plugin-bay">
            <span class="panel-name">What it did</span>
            <div class="plugin-panel"><canvas id="${mark}Figures"></canvas></div>
          </div>
        </div>

        <div class="plugin-controls" id="${mark}Knobs"></div>

        <div class="stereo-routing">
          ${this.spec.picker ? `
            <label class="field">
              <span class="field-label">${this.spec.picker.label}</span>
              <select id="${mark}Picker">
                ${this.spec.picker.options.map((o) => `<option value="${o.id}">${o.label}</option>`).join('')}
              </select>
            </label>` : ''}
          <button class="ab-btn" type="button" data-aim="listen">${this.spec.listen}</button>
          <span class="eq-hint">${this.spec.hint}</span>
        </div>
      </div>`;

    this.trace = this.el.querySelector(`#${mark}Trace`);
    this.figures = this.el.querySelector(`#${mark}Figures`);

    const sample = this.el.querySelector(`#${mark}Source`);
    if (sample) sample.value = this.player.source;

    this.buildKnobs();
    this.wire();
  }

  buildKnobs() {
    const mark = this.spec.mark;
    this.el.querySelector(`#${mark}Knobs`).innerHTML = this.knobsFor().map((knob) => {
      const dial = dialOf(knob, this.settings[knob.id]);
      return `
        <div class="knob">
          <label class="knob-name" for="${mark}-${knob.id}">${knob.name}</label>
          <output class="knob-value" id="${mark}-${knob.id}-value">${knob.write(this.settings[knob.id])}</output>
          <input class="knob-dial" type="range" id="${mark}-${knob.id}" data-dial="${knob.id}"
                 min="${dial.min}" max="${dial.max}" step="${dial.step}" value="${dial.at}"
                 data-rest="${dialOf(knob, this.spec.defaults[knob.id] ?? dial.at).at}"
                 aria-label="${knob.name}">
        </div>`;
    }).join('');
    this.syncKnobs();
  }

  wire() {
    const mark = this.spec.mark;

    this.el.querySelector(`#${mark}Knobs`).addEventListener('input', (e) => {
      const dial = e.target.closest('[data-dial]');
      if (!dial || !this.interactive) return;
      const knob = this.knobsFor().find((k) => k.id === dial.dataset.dial);
      this.settings[knob.id] = offDial(knob, dial.value);
      this.changed();
    });

    this.el.addEventListener('click', (e) => {
      const hear = e.target.closest('[data-aim-hear]');
      if (hear) {
        this.player.hear(hear.dataset.aimHear);
        for (const button of this.el.querySelectorAll('[data-aim-hear]')) {
          button.classList.toggle('is-on', button === hear);
        }
        return;
      }
      if (e.target.closest('[data-aim="play"]')) this.toggle();
      if (e.target.closest('[data-aim="listen"]')) this.toggleListen();
    });

    this.el.querySelector(`#${mark}Picker`)?.addEventListener('change', (e) => {
      if (!this.interactive) return;
      Object.assign(this.settings, this.spec.picker.write(e.target.value));
      this.changed();
    });
    this.el.querySelector(`#${mark}Source`)
      ?.addEventListener('change', (e) => this.setSource(e.target.value));
    this.el.querySelector(`#${mark}File`)
      ?.addEventListener('change', (e) => this.loadFile(e.target.files?.[0]));

    this.resize = () => this.draw();
    this.unwatch = watchSize(this.el, this.resize);
  }

  changed() {
    // Anything one control implies about another, applied before the audio
    // thread or the reading sees either of them.
    if (this.spec.couple) Object.assign(this.settings, this.spec.couple(this.settings));
    this.syncKnobs();
    this.player.setSettings(this.settings);
    this.draw();
    this.onChange?.(this.settings);
  }

  syncKnobs() {
    const mark = this.spec.mark;
    for (const knob of this.knobsFor()) {
      const readout = this.el.querySelector(`#${mark}-${knob.id}-value`);
      const dial = this.el.querySelector(`#${mark}-${knob.id}`);
      if (readout) readout.textContent = knob.write(this.settings[knob.id]);
      if (dial && document.activeElement !== dial) {
        dial.value = dialOf(knob, this.settings[knob.id]).at;
      }
    }
    const picker = this.el.querySelector(`#${mark}Picker`);
    if (picker && this.spec.picker) picker.value = this.spec.picker.read(this.settings);

    const listen = this.el.querySelector('[data-aim="listen"]');
    if (listen) listen.classList.toggle('is-on', !!this.settings.listen);

    dressKnobs(this.el);
  }

  /**
   * Monitor the detector instead of the output.
   *
   * The most useful button on either of these faces and the one people never
   * find on a real one. A gate triggering off the wrong thing and a de-esser
   * aimed at the wrong part of the spectrum are both diagnosed in a second by
   * listening to what the detector hears, and are nearly undiagnosable from
   * the output.
   */
  toggleListen() {
    if (!this.interactive) return;
    this.settings.listen = !this.settings.listen;
    this.changed();
  }

  /* ---------- the reading ---------- */

  read() {
    const of = {
      state: stampOf({ ...this.settings, rate: this.engine?.ctx?.sampleRate ?? null }),
      source: this.player.source,
      axis: this.player.reading?.of?.axis ?? null,
    };
    if (!this.player.reading) return notReady({ tool: this.spec.id, kind: 'reduction', of });
    return this.player.reading;
  }

  async readNow() {
    await this.player.prepare().catch(() => {});
    this.player.setSettings(this.settings);
    return this.read();
  }

  /* ---------- the pictures ---------- */

  draw() {
    const ink = aimPalette(this.el);
    this.drawTrace(ink);
    this.drawFigures(ink);
    this.writeReadout();
  }

  frames() {
    return this.player.reading?.values?.gr ?? null;
  }

  drawTrace(ink) {
    const stage = readyCanvas(this.trace);
    if (!stage) return;
    const { c, width, height } = stage;

    const lane = 16;
    const plot = Math.max(40, width - 30 - lane - 8);

    c.font = '9.5px system-ui, sans-serif';
    c.strokeStyle = ink.grid;
    c.lineWidth = 1;
    c.textAlign = 'right';
    c.fillStyle = ink.soft;
    for (let db = AIM_TOP; db >= AIM_DEEP; db -= 12) {
      const y = aimY(db, height);
      c.beginPath(); c.moveTo(0, y); c.lineTo(plot, y); c.stroke();
      c.fillText(`${db}`, plot + 24, Math.max(9, y + 10));
    }

    const frames = this.frames();
    if (!frames?.length) {
      c.textAlign = 'left';
      c.fillStyle = ink.soft;
      c.fillText(this.role === 'insert' ? 'play the sketch' : 'press play', 6, height - 6);
      return;
    }

    // The target's trace behind yours, when somebody has asked to see it.
    if (this.shown?.length) {
      c.strokeStyle = ink.sage;
      c.lineWidth = 1;
      c.setLineDash([3, 3]);
      c.beginPath();
      for (let i = 0; i < this.shown.length; i += 1) {
        const x = (i / (this.shown.length - 1 || 1)) * plot;
        const y = aimY(this.shown[i], height);
        if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.stroke();
      c.setLineDash([]);
    }

    // Filled, because reduction is an amount taken off and not a level: the
    // quantity is the area between zero and the trace.
    c.fillStyle = ink.blush;
    c.globalAlpha = 0.5;
    c.beginPath();
    c.moveTo(0, aimY(0, height));
    for (let i = 0; i < frames.length; i += 1) {
      c.lineTo((i / (frames.length - 1 || 1)) * plot, aimY(frames[i], height));
    }
    c.lineTo(plot, aimY(0, height));
    c.closePath();
    c.fill();
    c.globalAlpha = 1;

    c.strokeStyle = ink.accent || ink.blush;
    c.lineWidth = 1.2;
    c.beginPath();
    for (let i = 0; i < frames.length; i += 1) {
      const x = (i / (frames.length - 1 || 1)) * plot;
      const y = aimY(frames[i], height);
      if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.stroke();

    // And the live one, off the audio thread.
    const at = width - lane;
    c.strokeStyle = ink.grid;
    c.strokeRect(at, 0, lane, height);
    if (this.live < -0.01) {
      c.fillStyle = this.live < -24 ? ink.rust : ink.gold;
      c.globalAlpha = 0.8;
      c.fillRect(at + 1, 0, lane - 2, aimY(this.live, height));
      c.globalAlpha = 1;
    }
  }

  /**
   * The figures, which for these two are the whole of the second bay.
   *
   * A gate's are about time rather than depth - how much of the loop it let
   * through and how many separate times it opened - because that is what
   * somebody setting one is actually watching. "Opened 8 times" on an
   * eight-hit loop is a gate doing its job; 40 times is a gate chattering,
   * and the hysteresis knob is right there.
   */
  drawFigures(ink) {
    const stage = readyCanvas(this.figures);
    if (!stage) return;
    const { c, width, height } = stage;

    c.font = '9.5px system-ui, sans-serif';

    const values = this.player.reading?.values;
    if (!values) {
      c.textAlign = 'left';
      c.fillStyle = ink.soft;
      c.fillText('what it took off, and when', 6, height - 6);
      return;
    }

    const rows = this.spec.figures(values, openingsOf(this.frames()), this.settings);
    const line = Math.min(18, (height - 14) / (rows.length + 1));

    rows.forEach(([name, value], i) => {
      const y = 12 + i * line;
      c.textAlign = 'left';
      c.fillStyle = ink.soft;
      c.fillText(name, 2, y);
      c.textAlign = 'right';
      c.fillStyle = ink.blush;
      c.fillText(value, width - 4, y);
    });

    // The curve this instrument is working to, drawn small under the figures:
    // the input level across, the output level up, so a gate's elbow points
    // down and to the left where a compressor's points up and to the right.
    this.drawCurve(c, ink, width, height, 12 + rows.length * line + 8);
  }

  drawCurve(c, ink, width, height, top) {
    const room = height - top - 6;
    if (room < 36) return;

    // Square, because a transfer curve read against its own 1:1 line is only
    // readable square - and centred in what is left under the figures, which
    // is the whole of why this is not drawn at x = 2. On a phone the panel is
    // narrower than it is tall and the centring is a no-op.
    const size = Math.min(room, width - 8);
    const left = Math.max(2, (width - size) / 2);
    const bottom = top + size;
    const at = (db) => (db + 60) / 60;   // -60..0 dB across the square

    c.strokeStyle = ink.grid;
    c.lineWidth = 1;
    c.strokeRect(left, top, size, size);

    // The 1:1 line, so the curve has something to be read against.
    c.strokeStyle = ink.zero;
    c.beginPath();
    c.moveTo(left, bottom);
    c.lineTo(left + size, top);
    c.stroke();

    const expanding = (this.settings.shape ?? 'compress') === 'expand';
    c.strokeStyle = ink.blush;
    c.lineWidth = 1.5;
    c.beginPath();
    for (let i = 0; i <= 60; i += 1) {
      const input = -60 + i;
      const gain = expanding
        ? Math.max(-(this.settings.range ?? 60), expandGain(
          input, this.settings.threshold, this.settings.ratio, this.settings.knee,
        ))
        : Math.max(-(this.settings.range ?? 60), staticGain(
          input, this.settings.threshold, this.settings.ratio, this.settings.knee,
        ));
      const out = Math.max(-60, Math.min(0, input + gain));
      const x = left + at(input) * size;
      const y = bottom - at(out) * size;
      if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.stroke();
  }

  writeReadout() {
    const mark = this.spec.mark;
    const read = this.el.querySelector(`#${mark}Read`);
    const live = this.el.querySelector(`#${mark}Live`);
    const values = this.player.reading?.values;

    if (read) {
      read.textContent = values
        ? `${values.deepest.toFixed(1)} dB deepest · ${values.average.toFixed(2)} average`
        : '';
    }
    if (live) {
      live.textContent = this.isPlaying() && this.live < -0.05
        ? `holding ${(-this.live).toFixed(1)} dB`
        : '';
    }
  }

  /* ---------- the transport ---------- */

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
    const button = this.el.querySelector('[data-aim="play"]');
    if (button) button.textContent = on ? 'Stop' : 'Play';
    cancelAnimationFrame(this.frame);
    this.frame = null;
    if (!on) { this.live = 0; this.draw(); return; }
    const tick = () => {
      const now = this.player.reduction();
      this.live = now < this.live ? now : Math.min(0, this.live + 0.4);
      this.draw();
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
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

  /** Draw the answer's own trace over yours, or take it back off. */
  showTarget(target) {
    if (!target || !this.player.channels) { this.shown = null; this.draw(); return; }
    const rate = this.engine?.ctx?.sampleRate ?? 48000;
    this.shown = reductionPass(
      this.player.channels, rate, { ...this.spec.defaults, ...target },
    ).reading.values.gr;
    this.draw();
  }

  source() {
    return this.player.source ?? null;
  }

  abLabel() {
    return this.el.querySelector('[data-aim-hear="theirs"]')?.textContent ?? null;
  }

  nameAB(label) {
    const slot = this.el.querySelector('[data-aim-hear="theirs"]');
    if (slot) slot.textContent = label;
  }

  /** The material a guess is read against. */
  async material() {
    await this.player.prepare().catch(() => null);
    return this.player.channels ?? null;
  }

  async setFault(fault) {
    this.player.uneven = fault?.uneven ?? 0;
    await this.player.prepare().catch(() => {});
    this.player.setSettings(this.settings);
    this.draw();
  }

  lock() {
    this.interactive = false;
    this.el.querySelector(`.${this.spec.mark}`)?.classList.add('is-locked');
  }

  unlock() {
    this.interactive = true;
    this.el.querySelector(`.${this.spec.mark}`)?.classList.remove('is-locked');
  }

  async setSource(id) {
    this.player.source = id;
    const picker = this.el.querySelector(`#${this.spec.mark}Source`);
    if (picker) picker.value = id;
    await this.player.prepare().catch(() => {});
    this.player.setSettings(this.settings);
    this.draw();
  }

  async loadFile(file) {
    if (!file) return;
    await this.player.load(file);
    const option = this.el.querySelector(`#${this.spec.mark}Yours`);
    if (option) option.hidden = false;
    await this.setSource('yours');
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.unwatch?.();
    this.player.destroy();
  }
}
