import { LEVEL_DEFAULTS, TRIM_RANGE, TRIM_STEP, levelReading, LEVEL_GATE } from './gain.js';
import { LevelPlayer } from './player.js';
import { notReady, stampOf } from '../../lib/read.js';
import { dialOf, offDial, readyCanvas, watchSize, span } from '../../lib/panel.js';
import { dressKnobs } from '../../lib/knob.js';

/**
 * The level, as a plugin.
 *
 * One knob, and two pictures that do the work. This is the only face in the
 * app where the meters are the instrument rather than a readout beside it,
 * and that is deliberate: level is the one quantity in a mix that nobody can
 * judge without a reference, so the thing being taught is the comparison and
 * the thing on screen has to be what you compare with.
 *
 * The bar is where it is now - integrated, short-term, and the peaks beside
 * them. The trace is where it has been, which is the half a single number
 * cannot show: two masters at the same integrated loudness can be a steady
 * one and a lurching one, and that is the difference between the two readings
 * this draws.
 */

/**
 * Where the meters start and stop, in dB.
 *
 * Zero at the top because the peaks are drawn on the same scale as the
 * loudness and a true peak goes to zero and past it - the first version
 * stopped at -6 and pinned every peak reading to the top edge with its label
 * off the canvas, which is a meter that cannot show the one number it is
 * most important not to exceed. Both quantities are decibels relative to full
 * scale, so one scale holds them honestly.
 *
 * Forty-two decibels of range, which puts a -23 LUFS mix near the middle and
 * still has room under it for something quiet.
 */
const METER_TOP = 0;
const METER_FLOOR = -42;

const meterY = (lufs, height) =>
  height - ((Math.max(METER_FLOOR, Math.min(METER_TOP, lufs)) - METER_FLOOR)
    / (METER_TOP - METER_FLOOR)) * height;

/**
 * The one knob, and why the readout says what it does.
 *
 * A trim reads as a signed number because that is what a trim is - a move
 * from where you were, not a position. "0.0 dB" rather than "unity" for the
 * same reason the imager's pan says "Centre": the number is the thing being
 * dialled and a word in its place is one more thing to translate.
 */
const LEVEL_KNOBS = [
  {
    id: 'trim',
    name: 'Trim',
    ...span(TRIM_RANGE),
    step: TRIM_STEP,
    write: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`,
  },
];

const LEVEL_SIDES = [
  { id: 'mine', label: 'Yours' },
  { id: 'theirs', label: 'Untreated' },
];

function levelPalette(el) {
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

export class LevelPlugin {
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
    // What the loop was before the fault, read once and kept: it is the thing
    // every exercise here is measured against and it never changes while the
    // material does not.
    this.reference = null;

    this.player = player ?? new LevelPlayer(engine, { source });
    this.player.setFault(fault);

    this.build();
    this.draw();

    if (this.role === 'insert') this.playing(true);

    this.player.prepare()
      .then(() => { this.measure(); this.draw(); })
      .catch(() => { /* no audio yet; the knob still works */ });
  }

  /* ---------- the furniture ---------- */

  build() {
    const host = this.role === 'insert' ? '' : `
      <div class="eq-transport host-row">
        <button class="play-btn" type="button" data-level="play">Play</button>
        <div class="eq-ab" role="group" aria-label="What you are hearing">
          ${LEVEL_SIDES.map((l) => `<button class="ab-btn${l.id === 'mine' ? ' is-on' : ''}" type="button" data-hear="${l.id}">${l.label}</button>`).join('')}
        </div>
        <label class="field">
          <span class="field-label">Sample</span>
          <select id="levelSource">
            <option value="mix">Full mix</option>
            <option value="instrument">Keys</option>
            <option value="drums">Drums</option>
            <option value="yours" id="levelYours" hidden>Your own</option>
          </select>
        </label>
        <label class="file-btn">Open a file<input type="file" id="levelFile" accept="audio/*"></label>
      </div>`;

    this.el.innerHTML = `${host}
      <div class="plugin level${this.role === 'insert' ? ' is-insert' : ''}">
        <div class="plugin-head">
          <span class="plugin-lamp"></span>
          <span class="plugin-name">Level</span>
          <span class="plugin-trim" id="levelAgainst"></span>
          <span class="plugin-read" id="levelRead"></span>
        </div>

        <div class="stereo-display">
          <div class="plugin-bay">
            <span class="panel-name">Loudness</span>
            <div class="plugin-panel"><canvas id="levelMeters"></canvas></div>
          </div>
          <div class="plugin-bay">
            <span class="panel-name">Over time</span>
            <div class="plugin-panel"><canvas id="levelTrace"></canvas></div>
          </div>
        </div>

        <div class="plugin-controls" id="levelKnobs"></div>

        <div class="stereo-routing">
          <span class="eq-hint">a level is a comparison — flip between the two and trust the gap, not the number</span>
        </div>
      </div>`;

    this.meters = this.el.querySelector('#levelMeters');
    this.trace = this.el.querySelector('#levelTrace');
    const sample = this.el.querySelector('#levelSource');
    if (sample) sample.value = this.player.source;

    this.buildKnobs();
    this.wire();
  }

  buildKnobs() {
    this.el.querySelector('#levelKnobs').innerHTML = LEVEL_KNOBS.map((knob) => {
      const dial = dialOf(knob, this.settings[knob.id]);
      return `
        <div class="knob">
          <label class="knob-name" for="level-${knob.id}">${knob.name}</label>
          <output class="knob-value" id="level-${knob.id}-value">${knob.write(this.settings[knob.id])}</output>
          <input class="knob-dial" type="range" id="level-${knob.id}" data-dial="${knob.id}"
                 min="${dial.min}" max="${dial.max}" step="${dial.step}" value="${dial.at}"
                 data-rest="${dialOf(knob, LEVEL_DEFAULTS[knob.id] ?? dial.at).at}"
                 aria-label="${knob.name}">
        </div>`;
    }).join('');
    this.syncKnobs();
  }

  wire() {
    this.el.querySelector('#levelKnobs').addEventListener('input', (e) => {
      const dial = e.target.closest('[data-dial]');
      if (!dial || !this.interactive) return;
      const knob = LEVEL_KNOBS.find((k) => k.id === dial.dataset.dial);
      this.settings[knob.id] = offDial(knob, dial.value);
      this.changed();
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
      if (e.target.closest('[data-level="play"]')) this.toggle();
    });

    this.el.querySelector('#levelSource')
      ?.addEventListener('change', (e) => this.setSource(e.target.value));
    this.el.querySelector('#levelFile')
      ?.addEventListener('change', (e) => this.loadFile(e.target.files?.[0]));

    this.resize = () => this.draw();
    this.unwatch = watchSize(this.el, this.resize);
  }

  changed() {
    this.syncKnobs();
    this.player.setSettings(this.settings);
    this.measure();
    this.draw();
    this.onChange?.(this.settings);
  }

  syncKnobs() {
    for (const knob of LEVEL_KNOBS) {
      const readout = this.el.querySelector(`#level-${knob.id}-value`);
      const dial = this.el.querySelector(`#level-${knob.id}`);
      if (readout) readout.textContent = knob.write(this.settings[knob.id]);
      if (dial && document.activeElement !== dial) {
        dial.value = dialOf(knob, this.settings[knob.id]).at;
      }
    }
    dressKnobs(this.el);
  }

  /* ---------- the reading ---------- */

  /**
   * Read it, every time, rather than on a timer.
   *
   * The imager debounces because filtering a bar into seven bands and
   * correlating each one is tens of milliseconds. This is cheaper - one
   * K-weighting pass and a run of 400 ms blocks - so it is measured on the
   * move, which is what makes the meter a meter rather than a scoreboard.
   */
  measure() {
    const material = this.player.sample();
    if (!material) return;
    this.reading = levelReading(
      material.left, material.right, material.rate, this.settings,
      { source: this.player.source },
    );

    // The untouched loop, which is what "matched" means here. Read on the
    // same window and with no trim, because comparing a four-second reading
    // against a two-second one would be comparing two different pieces of
    // music.
    const dry = this.player.untreated();
    this.reference = dry
      ? levelReading(dry.left, dry.right, dry.rate, { trim: 0 }, { source: 'untreated' })
      : null;
  }

  read() {
    const of = {
      state: stampOf({ ...this.settings, rate: this.engine?.ctx?.sampleRate ?? null }),
      source: this.player.source,
      axis: this.reading?.of?.axis ?? null,
    };
    if (!this.reading) return notReady({ tool: 'level', kind: 'loudness', of });
    return this.reading;
  }

  async readNow() {
    await this.player.prepare().catch(() => {});
    this.measure();
    return this.read();
  }

  /**
   * Whether the comparison against the untreated loop may be shown.
   *
   * Not while a round is on, for the reason in `drawTrace`. A target arrives
   * when an exercise starts and is cleared when it ends, so this follows the
   * round without the plugin having to know what a round is.
   */
  revealing() {
    return !this.target;
  }

  /** How far the output is from the untreated loop, in LU, or null. */
  against() {
    const mine = this.reading?.values;
    const theirs = this.reference?.values;
    if (!mine || !theirs) return null;
    return mine.integrated - theirs.integrated;
  }

  /* ---------- the pictures ---------- */

  draw() {
    const ink = levelPalette(this.el);
    this.drawMeters(ink);
    this.drawTrace(ink);
    this.writeReadout();
  }

  drawMeters(ink) {
    const stage = readyCanvas(this.meters);
    if (!stage) return;
    const { c, width, height } = stage;

    // The numbers live down the right, so the bars get the rest. A meter
    // bridge is a picture and a set of figures, and the figures are what
    // anybody writes down.
    // Wide enough for the longest name and the longest value side by side at
     // this font, which "integrated" against "-16.3 LUFS" was not: they
     // overlapped. The unit is dropped from the loudness rows because the
     // header above already says LUFS, and kept where it is the informative
     // part of the number.
    const figures = 108;
    const lanes = Math.max(40, width - figures - 34);

    c.font = '9.5px system-ui, sans-serif';
    c.strokeStyle = ink.grid;
    c.lineWidth = 1;
    c.textAlign = 'right';
    c.fillStyle = ink.soft;
    // Above the line rather than below it, or the bottom one falls off the
    // canvas - which it did. Clamping the top one then put it on top of the
    // one under it, so a label is skipped rather than drawn over: a grid is
    // for reading off, and two numbers in the same place are worse than one.
    let lastLabel = -Infinity;
    for (let db = METER_TOP; db >= METER_FLOOR; db -= 6) {
      const y = meterY(db, height);
      c.beginPath(); c.moveTo(0, y); c.lineTo(lanes, y); c.stroke();
      const at = Math.max(9, y - 3);
      if (at - lastLabel < 10) continue;
      lastLabel = at;
      c.fillText(`${db}`, lanes + 22, at);
    }

    const values = this.reading?.values;
    if (!values) {
      c.textAlign = 'left';
      c.fillStyle = ink.soft;
      c.fillText(this.role === 'insert' ? 'play the sketch' : 'press play', 6, height - 6);
      return;
    }

    // Two bars: where it is on average and where it is right now. The short
    // one is the last three seconds, which is the window a listener's sense
    // of "how loud is this" actually runs on.
    const short = values.short.length
      ? values.short[values.short.length - 1].lufs
      : values.integrated;
    const bars = [
      { at: values.integrated, label: 'int', ink: ink.blush },
      { at: short, label: '3 s', ink: ink.sage },
    ];
    const lane = Math.min(44, (lanes - 24) / 2);
    const base = meterY(METER_FLOOR, height);
    bars.forEach((bar, i) => {
      const x = 10 + i * (lane + 10);
      const top = meterY(Number.isFinite(bar.at) ? bar.at : METER_FLOOR, height);
      c.fillStyle = bar.ink;
      c.globalAlpha = 0.75;
      c.fillRect(x, top, lane, Math.max(1, base - top));
      c.globalAlpha = 1;
      c.fillStyle = ink.soft;
      c.textAlign = 'center';
      c.fillText(bar.label, x + lane / 2, base - 5);
    });

    // The peak, as a line across rather than a bar, because a peak is a
    // ceiling you are approaching and not a quantity you have. Red once it is
    // inside a decibel of full scale, which is where every delivery spec in
    // the world starts asking for room.
    const peak = values.truePeak;
    if (Number.isFinite(peak)) {
      const y = meterY(peak, height);
      c.strokeStyle = peak > -1 ? ink.rust : ink.gold;
      c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(0, y); c.lineTo(lanes, y); c.stroke();
    }

    // And the figures, which are the half anybody acts on. PLR is the peak
    // over the loudness: how much room the music keeps between its average
    // and its loudest moment, and the number a master is squashed out of.
    const plr = Number.isFinite(peak) && Number.isFinite(values.integrated)
      ? peak - values.integrated : null;
    const rows = [
      ['integrated', Number.isFinite(values.integrated) ? `${values.integrated.toFixed(1)}` : 'gated'],
      ['short', Number.isFinite(short) ? `${short.toFixed(1)}` : '--'],
      ['true peak', Number.isFinite(peak) ? `${peak.toFixed(1)} dBTP` : '--'],
      ['sample', Number.isFinite(values.samplePeak) ? `${values.samplePeak.toFixed(1)}` : '--'],
      ['range', Number.isFinite(values.range) ? `${values.range.toFixed(1)} LU` : '--'],
      ['PLR', plr === null ? '--' : `${plr.toFixed(1)} LU`],
    ];
    const line = Math.min(15, (height - 10) / rows.length);
    rows.forEach(([name, value], i) => {
      const y = 11 + i * line;
      c.textAlign = 'left';
      c.fillStyle = ink.soft;
      c.fillText(name, width - figures, y);
      c.textAlign = 'right';
      c.fillStyle = name === 'true peak' && peak > -1 ? ink.rust : ink.blush;
      c.fillText(value, width - 4, y);
    });
  }

  drawTrace(ink) {
    const stage = readyCanvas(this.trace);
    if (!stage) return;
    const { c, width, height } = stage;

    c.font = '9.5px system-ui, sans-serif';
    c.strokeStyle = ink.grid;
    c.lineWidth = 1;
    c.textAlign = 'right';
    c.fillStyle = ink.soft;
    for (let db = METER_TOP; db >= METER_FLOOR; db -= 12) {
      const y = meterY(db, height);
      c.beginPath(); c.moveTo(0, y); c.lineTo(width - 26, y); c.stroke();
      c.fillText(`${db}`, width - 4, Math.max(9, y - 3));
    }

    const values = this.reading?.values;
    if (!values?.short?.length) {
      c.textAlign = 'left';
      c.fillStyle = ink.soft;
      c.fillText('short-term loudness, three seconds at a time', 6, height - 6);
      return;
    }

    // The untreated loop's level, drawn as the line to get back to - and only
    // when there is no round on. It is literally the answer to the matching
    // exercise, so leaving it up during one would turn a listening question
    // into a reading question, which is the same mistake as printing the
    // target's width on the imager. The meters themselves stay: a meter that
    // hides what you are doing is not a meter. What goes is the comparison.
    const reference = this.revealing()
      ? this.reference?.values?.integrated
      : this.shown;
    if (Number.isFinite(reference)) {
      const y = meterY(reference, height);
      c.strokeStyle = ink.zero;
      c.setLineDash([3, 3]);
      c.beginPath(); c.moveTo(0, y); c.lineTo(width - 26, y); c.stroke();
      c.setLineDash([]);
    }

    const series = values.short;
    const last = series[series.length - 1].at || 1;
    c.strokeStyle = ink.blush;
    c.lineWidth = 1.5;
    c.beginPath();
    series.forEach(({ at, lufs }, i) => {
      const x = (at / last) * (width - 30);
      const y = meterY(lufs, height);
      if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
    });
    c.stroke();
  }

  writeReadout() {
    const read = this.el.querySelector('#levelRead');
    const against = this.el.querySelector('#levelAgainst');
    const values = this.reading?.values;

    if (read) {
      read.textContent = values
        ? `${values.integrated.toFixed(1)} LUFS · peak ${values.truePeak.toFixed(1)} dBTP`
        : '';
    }

    if (against && !this.revealing()) {
      against.textContent = '';
    } else if (against) {
      const off = this.against();
      if (off === null || !Number.isFinite(off)) {
        against.textContent = '';
      } else if (Math.abs(off) < 0.05) {
        against.textContent = 'matched';
      } else {
        against.textContent = `${Math.abs(off).toFixed(1)} LU ${off > 0 ? 'louder' : 'quieter'}`;
      }
    }

    // A reading that has fallen through the gate is not a quiet reading, it
    // is no reading, and a meter that shows minus infinity without saying so
    // looks broken rather than gated.
    if (read && values && !Number.isFinite(values.integrated)) {
      read.textContent = `under ${LEVEL_GATE} LUFS — gated`;
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
    const button = this.el.querySelector('[data-level="play"]');
    if (button) button.textContent = on ? 'Stop' : 'Play';
    cancelAnimationFrame(this.frame);
    this.frame = null;
    if (!on) { this.draw(); return; }
    const tick = () => { this.draw(); this.frame = requestAnimationFrame(tick); };
    this.frame = requestAnimationFrame(tick);
  }

  /* ---------- what a host asks of it ---------- */

  setState(next) {
    Object.assign(this.settings, next);
    this.buildKnobs();
    this.changed();
  }

  /** What the trim is set to. */
  state() {
    return { ...this.settings };
  }

  setTarget(settings) {
    this.target = settings ?? null;
    this.draw();
  }

  /**
   * Draw the answer, or take it back off.
   *
   * Separate from `setTarget` and not the same flag, which matters here more
   * than on the other faces. A target arrives when a round starts and is what
   * hides the comparison against the untreated loop, because that comparison
   * is the answer. `showTarget` is the other direction - somebody has asked
   * to be shown - so it puts a line at the level they were chasing.
   */
  showTarget(target) {
    this.shown = target
      ? (this.reference?.values?.integrated ?? null)
      : null;
    this.draw();
  }

  /** What the monitor is set to. */
  source() {
    return this.player.source ?? null;
  }

  /** What the other side of the A/B is currently called. */
  abLabel() {
    return this.el.querySelector('[data-hear="theirs"]')?.textContent ?? null;
  }

  /** The other side of the A/B, named for what it actually is. */
  nameAB(label) {
    const slot = this.el.querySelector('[data-hear="theirs"]');
    if (slot) slot.textContent = label;
  }

  /** The pair a guess is read against, rendered and handed over. */
  async material() {
    await this.player.prepare().catch(() => null);
    return this.player.sample() ?? null;
  }

  async setFault(fault) {
    this.player.setFault(fault);
    await this.player.prepare().catch(() => {});
    this.measure();
    this.draw();
  }

  lock() {
    this.interactive = false;
    this.el.querySelector('.level')?.classList.add('is-locked');
  }

  unlock() {
    this.interactive = true;
    this.el.querySelector('.level')?.classList.remove('is-locked');
  }

  async setSource(id) {
    this.player.source = id;
    const picker = this.el.querySelector('#levelSource');
    if (picker) picker.value = id;
    await this.player.prepare().catch(() => {});
    this.measure();
    this.draw();
  }

  async loadFile(file) {
    if (!file) return;
    await this.player.load(file);
    const option = this.el.querySelector('#levelYours');
    if (option) option.hidden = false;
    await this.setSource('yours');
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.unwatch?.();
    this.player.stop();
  }
}
