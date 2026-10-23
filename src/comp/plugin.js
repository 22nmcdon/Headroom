import { staticGain, COMP_DEFAULTS, COMP_LIMITS } from './dsp.js';
import { CompPlayer } from './player.js';
import { dialOf, offDial, sizeOf, readyCanvas, watchSize, span } from '../fx/panel.js';
import { dressKnobs } from '../fx/knob.js';
import { vuFace, aimVu, VU_DEEPEST } from '../fx/meter.js';
import { FRAME_MS, materialStamp } from './reading.js';
import { notReady, stampOf } from '../read.js';

/**
 * The compressor, as a plugin you work rather than a question you answer.
 *
 * Three things to look at, which is what every compressor puts in front of
 * you: the curve, which is what it would do to a steady level; the trace,
 * which is what it is actually doing to this loop, hit by hit; and the meters,
 * which are what it is doing right now. The curve is a prediction, the trace
 * is the whole bar, and the meter is the moment - and a compressor is hard to
 * learn precisely because those three are not the same thing.
 */

const DB_LOW = -60;    // the quietest input the curve bothers with
const GR_DEPTH = 24;   // how far down the trace reads

/**
 * How much of the reduction an insert keeps, and how finely.
 *
 * Eight seconds is about two bars at the tempos a sketch is written at,
 * which is long enough to see a pattern in the ducking and short enough
 * that what is on screen is still what you are hearing. Sixty a second is
 * a sample a frame at the rate the thing is drawn anyway, so nothing is
 * kept that is not shown.
 */
const HISTORY_SECONDS = 8;
const HISTORY_HZ = 60;
const HISTORY_LONG = HISTORY_SECONDS * HISTORY_HZ;

const compX = (db, width) => ((db - DB_LOW) / -DB_LOW) * width;
const compY = (db, height) => height - ((db - DB_LOW) / -DB_LOW) * height;
const compDbX = (x, width) => DB_LOW + (x / width) * -DB_LOW;
const compDbY = (y, height) => DB_LOW + ((height - y) / height) * -DB_LOW;

const holdIn = (value, low, high) => Math.min(high, Math.max(low, value));

export const writeTime = (ms) => (ms < 10 ? `${ms.toFixed(1)} ms` : `${Math.round(ms)} ms`);
export const writeRatio = (ratio) => (ratio >= 19.95 ? '∞ : 1' : `${ratio.toFixed(1)} : 1`);
export const writeDbValue = (db) => `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`;
export const writeHertz = (hz) => (hz >= 1000 ? `${(hz / 1000).toFixed(1)} kHz` : `${Math.round(hz)} Hz`);

/** Everything with a knob on it, and how each one reads. */
const COMP_KNOBS = [
  { id: 'threshold', name: 'Threshold', ...span(COMP_LIMITS.threshold), step: 0.5, write: (v) => `${v.toFixed(1)} dB` },
  { id: 'ratio', name: 'Ratio', ...span(COMP_LIMITS.ratio), log: true, write: writeRatio },
  { id: 'attack', name: 'Attack', ...span(COMP_LIMITS.attack), log: true, write: writeTime },
  { id: 'release', name: 'Release', ...span(COMP_LIMITS.release), log: true, write: writeTime },
  { id: 'knee', name: 'Knee', ...span(COMP_LIMITS.knee), step: 0.5, write: (v) => `${v.toFixed(1)} dB` },
  { id: 'makeup', name: 'Makeup', ...span(COMP_LIMITS.makeup), step: 0.5, write: writeDbValue },
  { id: 'mix', name: 'Mix', ...span(COMP_LIMITS.mix), step: 0.01, write: (v) => `${Math.round(v * 100)} %` },
  { id: 'lookahead', name: 'Lookahead', ...span(COMP_LIMITS.lookahead), step: 0.5, write: writeTime },
];

/** The detector's own controls - the half of a compressor nobody touches. */
const COMP_SIDECHAIN = [
  { id: 'scHigh', name: 'Key high-pass', ...span(COMP_LIMITS.scHigh), log: true, write: writeHertz },
  { id: 'scLow', name: 'Key low-pass', ...span(COMP_LIMITS.scLow), log: true, write: writeHertz },
];

/** The colours, read off the page so the plugin follows whatever light it is in. */
function compPalette(el) {
  const style = getComputedStyle(el);
  const read = (name) => style.getPropertyValue(name).trim();
  return {
    ink: read('--charcoal'),
    accent: read('--blush-deep'),
    blush: read('--blush'),
    gold: read('--gold'),
    sage: read('--sage'),
    rust: read('--rust'),
    enclosure: read('--enclosure'),
    paper: read('--paper'),
    soft: 'rgba(250, 246, 240, 0.55)',
    grid: 'rgba(250, 246, 240, 0.14)',
    faint: 'rgba(250, 246, 240, 0.08)',
    zero: 'rgba(250, 246, 240, 0.34)',
  };
}

export class CompPlugin {
  constructor(el, {
    engine, settings, onChange, source = 'drums', key = null, uneven = 0,
    player = null, role = 'tool', keys = null,
  }) {
    this.el = el;
    this.engine = engine;
    this.settings = settings;
    this.onChange = onChange;
    this.role = role;
    // What this compressor's detector could listen to instead of its own
    // signal: the other tracks in the sketch, as `{ id, name }`. Null on an
    // exercise, where the key is whatever the round provides.
    this.keys = keys;
    this.interactive = true;
    this.target = null;      // drawn only once the round is over
    this.meterGr = 0;
    // The last eight seconds of it, on a track. Built on the first draw.
    this.history = null;
    this.historyAt = 0;
    this.lastSample = 0;
    this.columns = null;

    this.player = player ?? new CompPlayer(engine, { source, key, uneven });
    this.player.setSettings(this.settings);

    this.build();
    this.draw();

    // Open on a track: there is no Play in here to start the picture moving,
    // so it follows the sketchpad's transport from the moment it opens.
    if (this.role === 'insert') this.playing(true);

    // The loop is rendered rather than played, so the trace can be there
    // before anybody presses anything.
    this.player.prepare().then(() => { this.restage(); this.draw(); }).catch(() => {});
  }

  /* ---------- the furniture ---------- */

  build() {
    const keyed = Boolean(this.player.key);

    this.el.innerHTML = `
      <div class="plugin comp${this.role === 'insert' ? ' is-insert' : ''}">
        <div class="plugin-head">
          <span class="plugin-lamp"></span>
          <span class="plugin-name">Compressor</span>
          <span class="plugin-trim" id="compTrim"></span>
          <span class="plugin-read" id="compRead"></span>
        </div>

        <div class="comp-meters">
          <div class="comp-bay comp-bay-now">
            <span class="panel-name">Gain reduction</span>
            <div class="vu" id="compVu">${vuFace()}</div>
          </div>
          <div class="comp-bay comp-bay-curve">
            <span class="panel-name">In &rarr; out</span>
            <div class="plugin-panel"><canvas id="compCurve"></canvas></div>
          </div>
          <div class="comp-bay comp-bay-trace">
            <span class="panel-name" id="compTraceName">The last eight seconds</span>
            <div class="plugin-panel"><canvas id="compTrace"></canvas></div>
          </div>
          <div class="comp-bay comp-bay-out">
            <span class="panel-name">Levels</span>
            <div class="plugin-panel"><canvas id="compMeters"></canvas></div>
          </div>
        </div>

        <div class="comp-deck">
          <span class="panel-name">Dynamics &amp; output</span>
          <div class="plugin-controls" id="compKnobs"></div>
        </div>

        <div class="comp-chain">
          <span class="panel-name">Side chain</span>
          <div class="chain-row">
            <label class="field" id="compKeyPick" ${this.keys ? '' : 'hidden'}>
              <span class="field-label">Key from</span>
              <select id="compKeyFrom">
                <option value="">This track</option>
                ${(this.keys ?? []).map((each) => `
                  <option value="${each.id}">${each.name}</option>`).join('')}
              </select>
            </label>
            <label class="toggle" ${keyed ? '' : 'hidden'}>
              <input type="checkbox" id="compSidechain"> Key from the ${this.player.key === 'kick' ? 'kick' : 'other track'}
            </label>
            <div class="plugin-controls comp-key-knobs" id="compKeyKnobs"></div>
            <div class="eq-ab" role="group" aria-label="How the level is measured">
              <button class="ab-btn is-on" type="button" data-detector="peak">Peak</button>
              <button class="ab-btn" type="button" data-detector="rms">RMS</button>
            </div>
            <button class="ab-btn listen-btn" type="button" data-comp="listen" aria-pressed="false">Listen to the key</button>
          </div>
        </div>

        <div class="eq-transport comp-transport">
          <button class="play-btn" type="button" data-comp="play">Play</button>
          <div class="eq-ab" role="group" aria-label="What you are hearing">
            <button class="ab-btn is-on" type="button" data-hear="mine">Yours</button>
            <button class="ab-btn" type="button" data-hear="theirs" id="compOther">Target</button>
          </div>
          <label class="toggle">
            <input type="checkbox" id="compAuto" checked> Auto gain
          </label>
          <label class="field">
            <span class="field-label">Sample</span>
            <select id="compSource">
              <option value="drums">Drums</option>
              <option value="mix">Full mix</option>
              <option value="bass">Bass</option>
              <option value="instrument">Keys</option>
              <option value="yours" id="compYours" hidden>Your own</option>
            </select>
          </label>
          <label class="file-btn">Open a file<input type="file" id="compFile" accept="audio/*"></label>
          <button class="link-btn" type="button" data-comp="reset">Reset</button>
        </div>
      </div>`;

    this.curve = this.el.querySelector('#compCurve');
    this.trace = this.el.querySelector('#compTrace');
    this.meters = this.el.querySelector('#compMeters');
    this.dial = this.el.querySelector('#compVu');
    this.el.querySelector('#compTraceName').textContent = this.role === 'insert'
      ? 'The last eight seconds'
      : 'Over the loop';

    const picked = this.el.querySelector('#compKeyFrom');
    if (picked) picked.value = this.settings.keyFrom ?? '';
    this.el.querySelector('#compSource').value = this.player.source;

    this.buildKnobs();
    this.wire();
  }

  buildKnobs() {
    const write = (knobs) => knobs.map((knob) => {
      const dial = dialOf(knob, this.settings[knob.id]);
      return `
        <div class="knob" data-knob="${knob.id}">
          <label class="knob-name" for="comp-${knob.id}">${knob.name}</label>
          <output class="knob-value" id="comp-${knob.id}-value">${knob.write(this.settings[knob.id])}</output>
          <input class="knob-dial" type="range" id="comp-${knob.id}" data-dial="${knob.id}"
                 min="${dial.min}" max="${dial.max}" step="${dial.step}" value="${dial.at}"
                 data-rest="${dialOf(knob, COMP_DEFAULTS[knob.id] ?? dial.at).at}"
                 aria-label="${knob.name}">
        </div>`;
    }).join('');

    this.el.querySelector('#compKnobs').innerHTML = write(COMP_KNOBS);
    this.el.querySelector('#compKeyKnobs').innerHTML = write(COMP_SIDECHAIN);
    this.syncKnobs();
  }

  /* ---------- working it ---------- */

  wire() {
    for (const holder of ['#compKnobs', '#compKeyKnobs']) {
      this.el.querySelector(holder).addEventListener('input', (e) => {
        const dial = e.target.closest('[data-dial]');
        if (!dial || !this.interactive) return;
        const knob = [...COMP_KNOBS, ...COMP_SIDECHAIN].find((k) => k.id === dial.dataset.dial);
        this.settings[knob.id] = offDial(knob, dial.value);
        this.changed();
      });
    }

    this.el.querySelector('#compKeyFrom')?.addEventListener('change', (e) => {
      if (!this.interactive) return;
      // Empty is this track's own signal, which is a compressor with no
      // side chain and is the thing most of them are.
      this.settings.keyFrom = e.target.value || null;
      this.changed();
    });

    this.curve.addEventListener('pointerdown', (e) => this.grab(e));
    this.curve.addEventListener('pointermove', (e) => this.drag(e));
    this.curve.addEventListener('pointerup', (e) => this.drop(e));
    this.curve.addEventListener('pointercancel', (e) => this.drop(e));

    this.el.addEventListener('click', (e) => {
      const hear = e.target.closest('[data-hear]');
      if (hear) {
        this.player.hear(hear.dataset.hear);
        for (const button of this.el.querySelectorAll('[data-hear]')) {
          button.classList.toggle('is-on', button === hear);
        }
        return;
      }

      const detector = e.target.closest('[data-detector]');
      if (detector && this.interactive) {
        this.settings.detector = detector.dataset.detector;
        for (const button of this.el.querySelectorAll('[data-detector]')) {
          button.classList.toggle('is-on', button === detector);
        }
        this.changed();
        return;
      }

      const action = e.target.closest('[data-comp]');
      if (!action) return;
      if (action.dataset.comp === 'play') this.toggle();
      if (action.dataset.comp === 'listen') this.toggleListen();
      if (action.dataset.comp === 'reset' && this.interactive) {
        Object.assign(this.settings, COMP_DEFAULTS);
        this.buildKnobs();
        this.changed();
      }
    });

    this.el.querySelector('#compAuto').addEventListener('change', (e) => {
      this.player.setAuto(e.target.checked);
      this.el.querySelector('[data-knob="makeup"]').classList.toggle('is-auto', e.target.checked);
      this.writeReadout();
    });

    const sidechain = this.el.querySelector('#compSidechain');
    sidechain?.addEventListener('change', (e) => {
      this.settings.sidechain = e.target.checked;
      this.changed();
    });

    this.el.querySelector('#compSource')
      .addEventListener('change', (e) => this.setSource(e.target.value));
    this.el.querySelector('#compFile')
      .addEventListener('change', (e) => this.loadFile(e.target.files?.[0]));

    this.resize = () => { this.restage(); this.draw(); };
    this.unwatch = watchSize(this.el, this.resize);
  }


  /**
   * The curve is a control surface, not a picture.
   *
   * Two handles, each on the axis that means something there: the knee moves
   * sideways and that is the threshold, the top of the curve moves up and
   * down and that is the ratio - which is exactly what the ratio looks like,
   * since it is how far the loud end has been pulled towards the quiet one.
   */
  handles() {
    const { width, height } = sizeOf(this.curve);
    const { threshold, ratio, knee } = this.settings;
    const topDb = staticGain(0, threshold, ratio, knee);

    // Held off the edges: the ratio's handle lives at full scale, which is the
    // right-hand wall, and a circle centred on the wall is a half circle.
    const inside = (x) => holdIn(x, 9, width - 9);

    return {
      knee: { x: inside(compX(threshold, width)), y: holdIn(compY(threshold, height), 9, height - 9), id: 'threshold' },
      ratio: { x: inside(compX(0, width)), y: holdIn(compY(topDb, height), 9, height - 9), id: 'ratio' },
    };
  }

  grab(e) {
    if (!this.interactive) return;
    const at = this.on(this.curve, e);
    const handles = this.handles();

    const near = (handle) => (at.x - handle.x) ** 2 + (at.y - handle.y) ** 2 < 24 ** 2;
    this.holding = near(handles.ratio) ? 'ratio' : near(handles.knee) ? 'threshold' : null;
    // Anywhere else on the display is the threshold: it is the control people
    // reach for, and hunting for a handle is not what a compressor feels like.
    if (!this.holding) this.holding = 'threshold';

    this.curve.setPointerCapture(e.pointerId);
    this.drag(e);
  }

  drag(e) {
    if (!this.holding || !this.interactive) return;
    const { width, height } = sizeOf(this.curve);
    const at = this.on(this.curve, e);

    if (this.holding === 'threshold') {
      this.settings.threshold = holdIn(Math.round(compDbX(at.x, width) * 2) / 2, -60, 0);
    } else {
      // Where the top of the curve has been dragged to, solved back into a
      // ratio: at 0 dBFS in, the output sits at -threshold/ratio + threshold.
      const wanted = holdIn(compDbY(at.y, height), DB_LOW, 0);
      const span = -this.settings.threshold;
      const left = wanted - this.settings.threshold;
      this.settings.ratio = span <= 0.5 || left <= 0.01
        ? 20
        : holdIn(Math.round((span / left) * 10) / 10, 1, 20);
    }

    this.changed();
  }

  drop(e) {
    if (!this.holding) return;
    this.holding = null;
    try { this.curve.releasePointerCapture(e.pointerId); } catch { /* it had let go */ }
  }

  on(canvas, e) {
    const box = canvas.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  }

  changed() {
    this.syncKnobs();
    this.player.setSettings(this.settings);
    this.restage();
    this.draw();
    this.onChange?.(this.settings);
  }

  syncKnobs() {
    for (const knob of [...COMP_KNOBS, ...COMP_SIDECHAIN]) {
      const value = this.settings[knob.id];
      const readout = this.el.querySelector(`#comp-${knob.id}-value`);
      const dial = this.el.querySelector(`#comp-${knob.id}`);
      if (readout) readout.textContent = knob.write(value);
      if (dial && document.activeElement !== dial) {
        dial.value = knob.log ? Math.log2(Math.max(knob.min, value)) : value;
      }
    }
    dressKnobs(this.el);
  }

  /** Hear what the detector hears, which is how a sidechain gets aimed. */
  toggleListen() {
    const button = this.el.querySelector('[data-comp="listen"]');
    const on = button.getAttribute('aria-pressed') !== 'true';
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
    button.classList.toggle('is-on', on);
    this.settings.listen = on;
    this.player.setSettings(this.settings);
    this.player.push();
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
    await this.player.play();
    this.playing(true);
  }

  playing(on) {
    this.el.querySelector('[data-comp="play"]').textContent = on ? 'Stop' : 'Play';
    cancelAnimationFrame(this.frame);
    this.frame = null;
    if (!on) { this.draw(); return; }

    // An insert has no Play of its own - the sketchpad's transport is the
    // one that runs - so the loop is started when the plugin opens and
    // paints only while there is something going through, plus the one
    // frame after it stops so the picture settles rather than freezing
    // mid-swing.
    const tick = () => {
      const live = this.role !== 'insert' || Boolean(this.player.playing);
      if (live || this.wasLive) this.draw();
      this.wasLive = live;
      this.frame = requestAnimationFrame(tick);
    };
    tick();
  }

  /* ---------- drawing ---------- */

  /**
   * The loop, boiled down to one value per pixel column.
   *
   * Five seconds at forty-eight thousand samples is a quarter of a million
   * numbers behind a display five hundred pixels wide, and walking all of them
   * sixty times a second to draw the same picture would leave nothing for the
   * audio. It is redone when the settings change, which is when it differs.
   */
  restage() {
    const { width } = sizeOf(this.trace);
    const gr = this.player.trace;
    const samples = this.player.samples;
    // Cleared, not left. This returned early without touching `this.columns`,
    // so after an awaited source change the animation loop went on drawing a
    // gain-reduction trace - and printing "N dB deepest" beside it - for a
    // loop that was no longer loaded. Nothing was wrong with the arithmetic;
    // it was arithmetic about audio that had gone.
    if (!width || !gr || !samples) { this.columns = null; return; }

    const columns = Math.max(1, Math.round(width));
    const deepest = new Float32Array(columns);
    const loudest = new Float32Array(columns);
    const per = samples.length / columns;

    for (let x = 0; x < columns; x += 1) {
      const from = Math.floor(x * per);
      const to = Math.min(samples.length, Math.floor((x + 1) * per));
      let low = 0;
      let peak = 0;

      for (let i = from; i < to; i += 1) {
        if (gr[i] < low) low = gr[i];
        const level = samples[i] < 0 ? -samples[i] : samples[i];
        if (level > peak) peak = level;
      }

      deepest[x] = low;
      loudest[x] = peak;
    }

    this.columns = { deepest, loudest, width: columns };
    this.targetColumns = null;

    if (this.target && this.player.targetTrace) {
      const theirs = new Float32Array(columns);
      const trace = this.player.targetTrace;
      for (let x = 0; x < columns; x += 1) {
        const from = Math.floor(x * per);
        const to = Math.min(trace.length, Math.floor((x + 1) * per));
        let low = 0;
        for (let i = from; i < to; i += 1) if (trace[i] < low) low = trace[i];
        theirs[x] = low;
      }
      this.targetColumns = theirs;
    }
  }

  draw() {
    // A plugin that has been taken off the sheet stops drawing. Its setters
    // are async - rendering a loop takes a second - so their promises can
    // land after it has been torn down, and writing to elements that are no
    // longer in the page is how a clean handover throws.
    if (this.gone) return;
    const ink = compPalette(this.el);

    // The live reduction falls back rather than snapping, the way a needle
    // does - a meter that jumped straight back to nothing would be
    // unreadable. Read once here because three things now want it: the
    // needle, the history, and the levels.
    const fresh = this.player.playing ? this.player.reduction() : 0;
    this.meterGr = this.player.playing ? Math.min(fresh, this.meterGr + 0.8) : 0;
    this.remember();

    this.drawCurve(ink);
    this.drawTrace(ink);
    this.drawMeters(ink);
    this.writeReadout();
  }

  /**
   * The last eight seconds of reduction, kept.
   *
   * Only on a track. An exercise has a fixed loop and renders the whole of
   * its reduction in one go, which is a better picture than a rolling one
   * when the material never changes; a track's material is whatever the
   * clip is this bar, so there is nothing to render and the history is the
   * only picture there is.
   */
  remember() {
    if (this.role !== 'insert') return;
    if (!this.history) {
      this.history = new Float32Array(HISTORY_LONG);
      this.historyAt = 0;
      this.lastSample = performance.now();
      return;
    }

    const per = 1000 / HISTORY_HZ;
    const now = performance.now();
    const due = Math.floor((now - this.lastSample) / per);
    if (due < 1) return;

    // A frame that arrived late stands for the samples it missed, so eight
    // seconds across the screen is eight seconds of sound however the
    // drawing is keeping up.
    const missed = Math.min(HISTORY_LONG, due);
    for (let i = 0; i < missed; i += 1) {
      this.history[this.historyAt] = this.meterGr;
      this.historyAt = (this.historyAt + 1) % HISTORY_LONG;
    }
    this.lastSample += missed * per;
  }

  /** The kept reduction, oldest at the left. */
  drawHistory(c, width, height, grY, ink) {
    if (!this.history) return;
    const step = width / (HISTORY_LONG - 1);
    const value = (i) => Math.max(this.history[(this.historyAt + i) % HISTORY_LONG], -GR_DEPTH);

    c.beginPath();
    c.moveTo(0, 0);
    for (let i = 0; i < HISTORY_LONG; i += 1) c.lineTo(i * step, grY(value(i)));
    c.lineTo(width, 0);
    c.closePath();
    c.fillStyle = 'rgba(217, 166, 160, 0.26)';
    c.fill();

    c.beginPath();
    for (let i = 0; i < HISTORY_LONG; i += 1) {
      const y = grY(value(i));
      if (i === 0) c.moveTo(0, y); else c.lineTo(i * step, y);
    }
    c.strokeStyle = ink.blush;
    c.lineWidth = 1.8;
    c.stroke();
  }

  drawCurve(ink) {
    const stage = readyCanvas(this.curve);
    if (!stage) return;
    const { c, width, height } = stage;
    const { threshold, ratio, knee } = this.settings;

    // The grid, every 12 dB, and the line where nothing happens.
    c.strokeStyle = ink.grid;
    c.lineWidth = 1;
    for (let db = DB_LOW; db <= 0; db += 12) {
      const x = compX(db, width);
      const y = compY(db, height);
      c.beginPath(); c.moveTo(x, 0); c.lineTo(x, height); c.stroke();
      c.beginPath(); c.moveTo(0, y); c.lineTo(width, y); c.stroke();
    }

    c.strokeStyle = ink.zero;
    c.setLineDash([4, 4]);
    c.beginPath(); c.moveTo(0, height); c.lineTo(width, 0); c.stroke();
    c.setLineDash([]);

    const at = (db) => db + staticGain(db, threshold, ratio, knee);

    // What is being taken off, as the gap between doing this and doing
    // nothing - the area is the compression, and it grows as you work it.
    c.beginPath();
    c.moveTo(compX(DB_LOW, width), compY(DB_LOW, height));
    for (let db = DB_LOW; db <= 0; db += 0.5) c.lineTo(compX(db, width), compY(at(db), height));
    c.lineTo(compX(0, width), compY(0, height));
    c.closePath();
    c.fillStyle = 'rgba(192, 127, 121, 0.22)';
    c.fill();

    c.beginPath();
    for (let db = DB_LOW; db <= 0; db += 0.5) {
      const x = compX(db, width);
      const y = compY(at(db), height);
      if (db === DB_LOW) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.strokeStyle = ink.blush;
    c.lineWidth = 2.5;
    c.stroke();

    // The target's curve, once the round is over.
    if (this.target) {
      c.beginPath();
      for (let db = DB_LOW; db <= 0; db += 0.5) {
        const y = compY(db + staticGain(db, this.target.threshold, this.target.ratio, this.target.knee), height);
        const x = compX(db, width);
        if (db === DB_LOW) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.strokeStyle = ink.sage;
      c.lineWidth = 2;
      c.setLineDash([6, 4]);
      c.stroke();
      c.setLineDash([]);
    }

    // Where the signal is sitting right now, and what is happening to it.
    if (this.player.playing) {
      const level = this.player.levels().input;
      if (level > DB_LOW) {
        const x = compX(holdIn(level, DB_LOW, 0), width);
        const y = compY(holdIn(level + this.meterGr, DB_LOW, 0), height);
        c.beginPath();
        c.arc(x, y, 4.5, 0, Math.PI * 2);
        c.fillStyle = ink.gold;
        c.fill();
      }
    }

    if (this.interactive) {
      const handles = this.handles();
      for (const handle of [handles.knee, handles.ratio]) {
        c.beginPath();
        c.arc(handle.x, handle.y, 6, 0, Math.PI * 2);
        c.fillStyle = ink.paper;
        c.fill();
        c.strokeStyle = ink.accent;
        c.lineWidth = 2;
        c.stroke();
      }
    }

    c.fillStyle = ink.soft;
    c.font = '10px system-ui, sans-serif';
    c.textAlign = 'left';
    c.fillText('in →', 6, height - 6);
    c.save();
    c.translate(10, 14);
    c.fillText('out ↑', 0, 0);
    c.restore();
  }

  drawTrace(ink) {
    const stage = readyCanvas(this.trace);
    if (!stage) return;
    const { c, width, height } = stage;

    const grY = (db) => (-db / GR_DEPTH) * height;

    c.strokeStyle = ink.grid;
    c.lineWidth = 1;
    c.font = '9.5px system-ui, sans-serif';
    c.fillStyle = ink.soft;
    c.textAlign = 'right';
    for (let db = -6; db >= -GR_DEPTH; db -= 6) {
      const y = grY(db);
      c.beginPath(); c.moveTo(0, y); c.lineTo(width, y); c.stroke();
      c.fillText(`${db}`, width - 4, y - 3);
    }

    if (this.role === 'insert') { this.drawHistory(c, width, height, grY, ink); return; }

    // Nothing loaded means nothing to have a trace of. Clearing this inside
    // `restage` is necessary and not sufficient: a source change sets the
    // samples to null and then awaits a render, and nothing calls `restage`
    // until that resolves - while the animation loop, which does not stop for
    // a source change, goes on drawing the old loop's reduction over the new
    // loop's silence. This is where it is noticed, because this is the only
    // thing running.
    if (!this.player.samples) this.columns = null;
    if (!this.columns) return;
    const { deepest, loudest, width: columns } = this.columns;
    const span = width / columns;

    // What the compressor is working on, behind what it is doing about it.
    c.beginPath();
    c.moveTo(0, height);
    for (let x = 0; x < columns; x += 1) {
      c.lineTo(x * span, height - Math.min(1, loudest[x] * 1.6) * height * 0.55);
    }
    c.lineTo(width, height);
    c.closePath();
    c.fillStyle = ink.faint;
    c.fill();

    // The reduction, hanging from the top the way every meter draws it.
    const hang = (values, fill, stroke) => {
      c.beginPath();
      c.moveTo(0, 0);
      for (let x = 0; x < columns; x += 1) c.lineTo(x * span, grY(Math.max(values[x], -GR_DEPTH)));
      c.lineTo(width, 0);
      c.closePath();
      if (fill) { c.fillStyle = fill; c.fill(); }
      if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1.5; c.stroke(); }
    };

    if (this.targetColumns) hang(this.targetColumns, 'rgba(111, 127, 99, 0.24)', ink.sage);
    hang(deepest, 'rgba(217, 166, 160, 0.26)', ink.blush);

    const position = this.player.position;
    if (position !== null) {
      const x = position * width;
      c.strokeStyle = ink.gold;
      c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(x, 0); c.lineTo(x, height); c.stroke();
    }

  }

  drawMeters(ink) {
    const stage = readyCanvas(this.meters);
    if (!stage) return;
    const { c, width, height } = stage;

    aimVu(this.dial, this.meterGr, VU_DEEPEST);

    const { input, output } = this.player.levels();
    const top = 16;
    const floor = height - 14;
    const run = floor - top;
    const bars = [
      { label: 'in', value: holdIn((input + 60) / 60, 0, 1), colour: ink.soft, from: 'bottom' },
      { label: 'out', value: holdIn((output + 60) / 60, 0, 1), colour: ink.soft, from: 'bottom' },
    ];

    const lane = width / bars.length;
    const bar = Math.min(12, lane - 8);

    bars.forEach((meter, i) => {
      const x = i * lane + (lane - bar) / 2;
      c.fillStyle = 'rgba(250, 246, 240, 0.09)';
      c.fillRect(x, top, bar, run);

      const length = meter.value * run;
      c.fillStyle = meter.colour;
      if (meter.from === 'top') c.fillRect(x, top, bar, length);
      else c.fillRect(x, floor - length, bar, length);

      c.fillStyle = ink.soft;
      c.font = '9px system-ui, sans-serif';
      c.textAlign = 'center';
      c.fillText(meter.label, i * lane + lane / 2, height - 3);
    });
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
  async setSource(id, { key, uneven } = {}) {
    this.player.source = id;
    this.player.samples = null;
    // The key and the fault travel with the source because they are part of
    // what the material is: ducking needs a kick to duck to, and levelling
    // needs a bed that is actually uneven. They were constructor arguments,
    // which is why changing exercise used to mean building a new plugin.
    if (key !== undefined) this.player.key = key;
    if (uneven !== undefined) this.player.uneven = uneven;

    const picker = this.el.querySelector('#compSource');
    if (picker) picker.value = id;

    await this.player.prepare().catch(() => {});
    if (this.player.playing) await this.player.play();
    this.restage();
    this.draw();
  }

  /**
   * How uneven the loop handed to you is.
   *
   * The compressor's fault is not a filter sitting in the path, it is how far
   * apart the hits of the bed are before you touch them - so setting it means
   * re-rendering the material rather than changing a node.
   */
  async setFault(fault) {
    await this.setSource(this.player.source, { uneven: fault?.uneven ?? fault ?? 0 });
  }

  /**
   * Something the player brought themselves.
   *
   * Was the body of an event handler, which meant nothing could load a file
   * except a file input. Takes a File now, and the handler unwraps the event.
   */
  async loadFile(file) {
    if (!file) return false;

    const yours = this.el.querySelector('#compYours');
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

  /** What the compressor is set to. */
  state() {
    return { ...this.settings };
  }

  /**
   * What these settings do to this loop - synchronously, always.
   *
   * Never null, and never a stale value passed off as a current one. If the
   * material has not loaded, or the settings have moved since the last pass,
   * what comes back carries `ready: false` and whatever the last pass found,
   * and a recomputation is scheduled. A caller that has to branch on null
   * before it can ask what tool it is holding will get that branch wrong once.
   */
  read() {
    const of = {
      state: stampOf(this.state()),
      source: this.player.source ?? null,
      axis: { kind: 'frames', ms: FRAME_MS, rate: this.engine?.ctx?.sampleRate ?? 48000,
              over: materialStamp(this.player.samples) },
    };

    if (!this.player.samples) return notReady({ tool: 'compression', kind: 'reduction', of });
    if (!this.player.reading) { this.player.measure(); }
    if (!this.player.reading) return notReady({ tool: 'compression', kind: 'reduction', of });

    const current = this.player.reading.of.state === of.state
      && this.player.reading.of.axis.over === of.axis.over;
    return current ? this.player.reading : { ...this.player.reading, of, ready: false };
  }

  /** The same, but waited for: the material loaded and the pass run. */
  async readNow() {
    await this.player.prepare().catch(() => {});
    this.player.measure();
    this.restage();
    return this.read();
  }

  writeReadout() {
    const reading = this.read();
    const trim = this.el.querySelector('#compTrim');

    if (this.player.auto && reading.values) {
      trim.textContent = Math.abs(reading.values.makeup) < 0.1
        ? 'auto gain · none'
        : `auto gain · ${writeDbValue(reading.values.makeup)}`;
    } else {
      trim.textContent = 'auto gain · off';
    }

    const { threshold, ratio, attack, release } = this.settings;
    const parts = [
      `${writeRatio(ratio)} over ${threshold.toFixed(1)} dB`,
      `${writeTime(attack)} / ${writeTime(release)}`,
    ];
    // Only when it is a reading of what is on the knobs now. Saying "6.2 dB
    // deepest" beside settings that have moved since is the same class of
    // untruth as saying it about a loop that is no longer loaded.
    if (reading.values) {
      parts.push(reading.ready
        ? `${reading.values.deepest.toFixed(1)} dB deepest`
        : 'measuring…');
    }
    if (this.settings.sidechain) parts.push('keyed');
    this.el.querySelector('#compRead').textContent = parts.join(' · ');
  }

  /* ---------- what the round does to it ---------- */

  setTarget(target) {
    this.player.setTarget(target);
  }

  /** Draw the answer over yours, or take it back off. */
  showTarget(target) {
    this.target = target ?? null;
    this.player.setTarget(this.target);
    this.restage();
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
    return this.el.querySelector('#compOther')?.textContent ?? null;
  }

  /**
   * The loop a guess is read against, rendered and handed over.
   *
   * Asked for by the session rather than filled in from an unawaited IIFE the
   * way the exercise used to do it - which meant scoring could fall back to a
   * synthetic probe, and "marked on drums while hearing noise" was a thing
   * that could happen.
   */
  async material() {
    await this.player.prepare().catch(() => null);
    if (!this.player.samples) return null;

    return {
      rate: this.engine?.ctx?.sampleRate ?? 48000,
      samples: this.player.samples,
      even: this.player.evenSamples ?? this.player.samples,
      key: this.player.keySamples ?? null,
    };
  }

  /** The other side of the A/B, named for what it actually is. */
  nameAB(label) {
    const slot = this.el.querySelector('#compOther');
    if (slot) slot.textContent = label;
  }

  nameOther(label) {
    const slot = this.el.querySelector('#compOther');
    if (slot) slot.textContent = label;
  }

  lock() {
    this.interactive = false;
    this.el.querySelector('.comp').classList.add('is-locked');
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
    this.el.querySelector('.comp').classList.remove('is-locked');
  }

  destroy() {
    this.gone = true;
    cancelAnimationFrame(this.frame);
    this.unwatch?.();
    this.player.destroy();
  }
}
