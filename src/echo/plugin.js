import {
  ECHO_DEFAULTS, SYNC_DIVISIONS, makeEcho, timeOf, nearestDivision,
  ECHO_LIMITS,
} from './line.js';
import {
  RESPONSE_BANDS, DECAY_FLOOR, decayProfile, decayTimes, wetDryImpulse, decayReading, decayAxis
} from '../fx/response.js';
import { ImpulsePlayer } from '../fx/player.js';
import { notReady, stampOf } from '../read.js';
import { dialOf, offDial, sizeOf, readyCanvas, decayX, decayY, writeMs, watchSize, span } from '../fx/panel.js';
import { LOOP_BEAT } from '../audio.js';
import { writeHertz } from '../comp/plugin.js';

/**
 * The delay, as a plugin.
 *
 * Two pictures again, and the first one is the point of the thing: the
 * repeats, drawn against the beats of the track. A delay is right when its
 * repeats land on the grid and wrong when they walk off it, and that is
 * something you can see happening as well as hear - which is most of what
 * makes this learnable. Left goes up and right goes down from the middle, so
 * a ping-pong reads as repeats stepping from one side to the other.
 *
 * The grid is hidden in the exercise where the tempo is the question. Matching
 * a delay to a record nobody has told you the tempo of is the real version of
 * this job, and a beat grid would be answering it for you.
 */

const BARS_SHOWN = 4;    // beats of the track across the repeats panel

/** Every knob, and how it reads. */
const ECHO_KNOBS = [
  { id: 'time', name: 'Time', ...span(ECHO_LIMITS.time), log: true, write: writeMs },
  { id: 'feedback', name: 'Feedback', ...span(ECHO_LIMITS.feedback), step: 0.01, write: (v) => `${Math.round(v * 100)} %` },
  { id: 'tone', name: 'Tone', ...span(ECHO_LIMITS.tone), log: true, write: writeHertz },
  { id: 'lowCut', name: 'Low cut', ...span(ECHO_LIMITS.lowCut), log: true, write: writeHertz },
  { id: 'mix', name: 'Mix', ...span(ECHO_LIMITS.mix), step: 0.01, write: (v) => `${Math.round(v * 100)} %` },
];

const ECHO_TINTS = { low: '--rust', mid: '--gold', high: '--enclosure' };

function echoPalette(el) {
  const style = getComputedStyle(el);
  const read = (name) => style.getPropertyValue(name).trim();
  return {
    bands: Object.fromEntries(Object.entries(ECHO_TINTS).map(([id, token]) => [id, read(token)])),
    blush: read('--blush'),
    accent: read('--blush-deep'),
    sage: read('--sage'),
    gold: read('--gold'),
    soft: 'rgba(250, 246, 240, 0.55)',
    grid: 'rgba(250, 246, 240, 0.14)',
    beat: 'rgba(250, 246, 240, 0.3)',
  };
}

export class EchoPlugin {
  constructor(el, {
    engine, settings, onChange, source = 'instrument', tempo = true,
    player = null, role = 'tool',
  }) {
    this.el = el;
    this.engine = engine;
    this.settings = settings;
    this.onChange = onChange;
    this.role = role;
    this.tempo = tempo;   // whether the track's grid is on offer
    this.interactive = true;
    this.target = null;
    this.echo = null;
    this.profile = null;
    this.columns = null;

    this.player = player ?? new ImpulsePlayer(engine, {
      source,
      impulseOf: makeEcho,
      defaults: ECHO_DEFAULTS,
    });

    this.build();
    this.restage();
    this.draw();

    // Open on a track: there is no Play in here to start the picture moving,
    // so it follows the sketchpad's transport from the moment it opens.
    if (this.role === 'insert') this.playing(true);

    this.player.prepare()
      .then(() => this.queue())
      .catch(() => { /* no audio yet; the pictures still work */ });
  }

  /* ---------- the furniture ---------- */

  build() {
    this.el.innerHTML = `
      <div class="plugin echo${this.role === 'insert' ? ' is-insert' : ''}">
        <div class="plugin-head">
          <span class="plugin-name">Delay</span>
          <span class="plugin-trim" id="echoTrim"></span>
          <span class="plugin-read" id="echoRead"></span>
        </div>

        <div class="echo-display">
          <div class="plugin-panel echo-panel-taps">
            <canvas id="echoTaps"></canvas>
          </div>
          <div class="plugin-panel echo-panel-decay">
            <canvas id="echoDecay"></canvas>
          </div>
        </div>

        <div class="plugin-controls" id="echoKnobs"></div>

        <div class="echo-routing">
          <span class="panel-name" ${this.tempo ? '' : 'hidden'}>Sync</span>
          <label class="field" ${this.tempo ? '' : 'hidden'}>
            <span class="field-label">Note</span>
            <select id="echoSync">
              ${SYNC_DIVISIONS.map((d) => `<option value="${d.id}">${d.label}</option>`).join('')}
            </select>
          </label>
          <label class="toggle">
            <input type="checkbox" id="echoPingPong"> Ping-pong
          </label>
          <span class="eq-hint" ${this.tempo ? '' : 'hidden'}>repeats land on the beats when the note is right</span>
        </div>

        <div class="eq-transport echo-transport">
          <button class="play-btn" type="button" data-echo="play">Play</button>
          <div class="eq-ab" role="group" aria-label="What you are hearing">
            <button class="ab-btn is-on" type="button" data-hear="mine">Yours</button>
            <button class="ab-btn" type="button" data-hear="theirs" id="echoOther">Target</button>
          </div>
          <label class="field">
            <span class="field-label">Sample</span>
            <select id="echoSource">
              <option value="instrument">Keys</option>
              <option value="drums">Drums</option>
              <option value="mix">Full mix</option>
              <option value="bass">Bass</option>
              <option value="yours" id="echoYours" hidden>Your own</option>
            </select>
          </label>
          <label class="file-btn">Open a file<input type="file" id="echoFile" accept="audio/*"></label>
          <button class="link-btn" type="button" data-echo="reset">Reset</button>
        </div>
      </div>`;

    this.taps = this.el.querySelector('#echoTaps');
    this.decay = this.el.querySelector('#echoDecay');
    this.el.querySelector('#echoSource').value = this.player.source;

    this.buildKnobs();
    this.wire();
  }

  buildKnobs() {
    this.el.querySelector('#echoKnobs').innerHTML = ECHO_KNOBS.map((knob) => {
      const dial = dialOf(knob, this.settings[knob.id]);
      return `
        <div class="knob">
          <label class="knob-name" for="echo-${knob.id}">${knob.name}</label>
          <output class="knob-value" id="echo-${knob.id}-value">${knob.write(this.settings[knob.id])}</output>
          <input class="knob-dial" type="range" id="echo-${knob.id}" data-dial="${knob.id}"
                 min="${dial.min}" max="${dial.max}" step="${dial.step}" value="${dial.at}"
                 aria-label="${knob.name}">
        </div>`;
    }).join('');
  }

  wire() {
    this.el.querySelector('#echoKnobs').addEventListener('input', (e) => {
      const dial = e.target.closest('[data-dial]');
      if (!dial || !this.interactive) return;
      const knob = ECHO_KNOBS.find((k) => k.id === dial.dataset.dial);
      this.settings[knob.id] = offDial(knob, dial.value);
      // Dialling the time by hand is leaving the grid, which is what the
      // menu said you were on.
      if (knob.id === 'time') this.setSync('free');
      this.changed();
    });

    const sync = this.el.querySelector('#echoSync');
    sync?.addEventListener('change', (e) => {
      if (!this.interactive) return;
      const division = SYNC_DIVISIONS.find((d) => d.id === e.target.value);
      if (division?.beats) {
        this.settings.time = timeOf(division.beats);
        this.syncKnobs();
      }
      this.changed();
    });

    this.el.querySelector('#echoPingPong').addEventListener('change', (e) => {
      if (!this.interactive) return;
      this.settings.pingPong = e.target.checked;
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

      const action = e.target.closest('[data-echo]');
      if (!action) return;
      if (action.dataset.echo === 'play') this.toggle();
      if (action.dataset.echo === 'reset' && this.interactive) {
        Object.assign(this.settings, ECHO_DEFAULTS);
        this.buildKnobs();
        this.el.querySelector('#echoPingPong').checked = false;
        this.setSync('free');
        this.changed();
      }
    });

    this.el.querySelector('#echoSource')
      .addEventListener('change', (e) => this.setSource(e.target.value));
    this.el.querySelector('#echoFile')
      .addEventListener('change', (e) => this.loadFile(e.target.files?.[0]));

    this.resize = () => { this.restage(); this.draw(); };
    this.unwatch = watchSize(this.el, this.resize);
  }

  /** Whatever the sample picker is now set to, rebuilt from the start. */
  async reload() {
    this.player.buffer = null;
    await this.player.prepare().catch(() => {});

    // Both sides may not exist yet. The repeats are rendered into the
    // material rather than filtered over it, so the two chains are built the
    // first time anything plays - and this is now called at attach, which is
    // before that. It used to be reached only from a change handler, which by
    // definition only ran once somebody had already been working.
    if (this.player.mine) this.player.mine.made = null;
    if (this.player.theirs) this.player.theirs.made = null;
    await this.player.setSettings(this.settings);
    if (this.player.target) await this.player.setTarget(this.player.target);
    if (this.player.playing) await this.player.play();
    this.draw();
  }


  setSync(id) {
    const select = this.el.querySelector('#echoSync');
    if (select) select.value = id;
  }

  changed() {
    this.syncKnobs();
    this.restage();
    this.draw();
    this.queue();
    this.onChange?.(this.settings);
  }

  /** Renders the repeats into the loop, latest settings winning. */
  queue() {
    this.pending = true;
    if (this.rendering) return;

    this.rendering = true;
    (async () => {
      while (this.pending) {
        this.pending = false;
        try {
          await this.player.setSettings({ ...this.settings });
        } catch {
          // No audio yet, or the render was cut short; the pictures are
          // already right and the sound catches up on the next change.
        }
      }
      this.rendering = false;
      this.writeReadout();
    })();
  }

  syncKnobs() {
    for (const knob of ECHO_KNOBS) {
      const readout = this.el.querySelector(`#echo-${knob.id}-value`);
      const dial = this.el.querySelector(`#echo-${knob.id}`);
      if (readout) readout.textContent = knob.write(this.settings[knob.id]);
      if (dial && document.activeElement !== dial) {
        dial.value = knob.log ? Math.log2(Math.max(knob.min, this.settings[knob.id])) : this.settings[knob.id];
      }
    }
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
    this.el.querySelector('[data-echo="play"]').textContent = on ? 'Stop' : 'Play';
    cancelAnimationFrame(this.frame);
    this.frame = null;
    if (!on) { this.writeReadout(); return; }

    // An insert has no Play of its own - the sketchpad's transport is the
    // one that runs - so the loop is started when the plugin opens and
    // paints only while there is something going through, plus the one
    // frame after it stops so the picture settles rather than freezing
    // mid-swing.
    const tick = () => {
      const live = this.role !== 'insert' || Boolean(this.player.playing);
      if (live || this.wasLive) this.writeReadout();
      this.wasLive = live;
      this.frame = requestAnimationFrame(tick);
    };
    tick();
  }

  /* ---------- drawing ---------- */

  restage() {
    const rate = this.engine.ctx?.sampleRate ?? 48000;
    this.echo = makeEcho(rate, this.settings);
    this.times = decayTimes();
    this.profile = decayProfile(
      wetDryImpulse(this.echo, this.settings.mix), rate, this.times);

    this.columns = null;
    const { width } = sizeOf(this.taps);
    if (!width) return;

    // Only the window the panel shows, which is the bar rather than the whole
    // tail - the question here is where the repeats fall against the beats.
    const shown = BARS_SHOWN * LOOP_BEAT;
    const count = Math.max(1, Math.round(width));
    const left = new Float32Array(count);
    const right = new Float32Array(count);
    const per = (shown * rate) / count;

    for (let x = 0; x < count; x += 1) {
      const from = Math.floor(x * per);
      const to = Math.min(this.echo.length, Math.floor((x + 1) * per));
      let l = 0;
      let r = 0;
      for (let i = from; i < to; i += 1) {
        const a = Math.abs(this.echo.channels[0][i]);
        const b = Math.abs(this.echo.channels[1][i]);
        if (a > l) l = a;
        if (b > r) r = b;
      }
      left[x] = l;
      right[x] = r;
    }

    let peak = 1e-9;
    for (let x = 0; x < count; x += 1) peak = Math.max(peak, left[x], right[x]);
    this.columns = { left, right, count, peak, shown };
  }

  draw() {
    // A plugin that has been taken off the sheet stops drawing. Its setters
    // are async - rendering a loop takes a second - so their promises can
    // land after it has been torn down, and writing to elements that are no
    // longer in the page is how a clean handover throws.
    if (this.gone) return;
    const ink = echoPalette(this.el);
    this.drawTaps(ink);
    this.drawDecay(ink);
    this.writeReadout();
  }

  drawTaps(ink) {
    const stage = readyCanvas(this.taps);
    if (!stage || !this.columns) return;
    const { c, width, height } = stage;
    const { left, right, count, peak, shown } = this.columns;

    const middle = height / 2;
    const span = width / count;

    // The track's own grid: beats strong, eighths faint. It is not drawn in
    // the exercise that is asking what the tempo is.
    if (this.tempo) {
      for (let eighth = 0; eighth * (LOOP_BEAT / 2) < shown; eighth += 1) {
        const x = ((eighth * (LOOP_BEAT / 2)) / shown) * width;
        c.strokeStyle = eighth % 2 === 0 ? ink.beat : ink.grid;
        c.lineWidth = 1;
        c.beginPath(); c.moveTo(x, 0); c.lineTo(x, height); c.stroke();
      }
    }

    c.strokeStyle = 'rgba(250, 246, 240, 0.28)';
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(0, middle); c.lineTo(width, middle); c.stroke();

    // Left above the line and right below it, so a ping-pong is a set of
    // repeats stepping from one side to the other rather than a number.
    const reach = (value) => {
      const level = value / peak;
      return level <= 0 ? 0 : Math.max(0, 1 + Math.log10(level) / 3);
    };

    c.beginPath();
    for (let x = 0; x < count; x += 1) {
      const at = x * span;
      if (left[x] > 0) {
        c.moveTo(at, middle);
        c.lineTo(at, middle - reach(left[x]) * middle * 0.92);
      }
      if (right[x] > 0) {
        c.moveTo(at, middle);
        c.lineTo(at, middle + reach(right[x]) * middle * 0.92);
      }
    }
    c.strokeStyle = ink.blush;
    c.lineWidth = Math.max(1.5, span);
    c.stroke();

    c.fillStyle = ink.soft;
    c.font = '9.5px system-ui, sans-serif';
    c.textAlign = 'left';
    c.fillText(this.tempo ? 'the repeats · left up, right down · one bar'
      : 'the repeats · left up, right down', 6, height - 6);
  }

  drawDecay(ink) {
    const stage = readyCanvas(this.decay);
    if (!stage || !this.profile) return;
    const { c, width, height } = stage;

    c.lineWidth = 1;
    c.font = '9.5px system-ui, sans-serif';
    c.strokeStyle = ink.grid;
    c.fillStyle = ink.soft;
    c.textAlign = 'right';
    for (let db = -20; db > DECAY_FLOOR; db -= 20) {
      const y = decayY(db, height);
      c.beginPath(); c.moveTo(0, y); c.lineTo(width, y); c.stroke();
      c.fillText(`${db}`, width - 4, y - 3);
    }

    c.textAlign = 'center';
    for (const t of [0.1, 1]) {
      const x = decayX(t, width);
      c.beginPath(); c.moveTo(x, 0); c.lineTo(x, height); c.stroke();
      c.fillText(t >= 1 ? `${t}s` : `${t * 1000}ms`, x, height - 4);
    }

    const trace = (profile, alpha, dash) => {
      for (const band of RESPONSE_BANDS) {
        const curve = profile[band.id];
        c.beginPath();
        for (let i = 0; i < curve.length; i += 1) {
          const x = decayX(this.times[i], width);
          const y = decayY(curve[i], height);
          if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
        }
        c.strokeStyle = ink.bands[band.id];
        c.globalAlpha = alpha;
        c.lineWidth = 2;
        c.setLineDash(dash);
        c.stroke();
        c.setLineDash([]);
        c.globalAlpha = 1;
      }
    };

    if (this.targetProfile) trace(this.targetProfile, 0.5, [6, 4]);
    trace(this.profile, 1, []);

    c.fillStyle = ink.soft;
    c.textAlign = 'left';
    c.fillText('how it dies away', 6, height - 16);
  }

  writeReadout() {
    const trim = this.el.querySelector('#echoTrim');
    if (!trim) return;

    const mix = this.settings.mix;
    const back = 20 * Math.log10(1 / Math.sqrt((1 - mix) ** 2 + mix ** 2));
    trim.textContent = Math.abs(back) < 0.05
      ? 'auto gain · none'
      : `auto gain · ${back > 0 ? '+' : '−'}${Math.abs(back).toFixed(1)} dB`;

    const parts = [writeMs(this.settings.time)];

    // What note value this is, only where the track's tempo is on offer. In
    // the other exercise that is the question, and printing the answer over
    // it would be a strange way to ask.
    if (this.tempo) {
      const near = nearestDivision(this.settings.time);
      parts.push(near && near.off < 0.02 ? near.division.label : 'off the grid');
    }

    parts.push(`${Math.round(this.settings.feedback * 100)}% back`);
    if (this.settings.pingPong) parts.push('ping-pong');
    if (this.player.playing) parts.push(`out ${this.player.level().toFixed(0)} dB`);

    this.el.querySelector('#echoRead').textContent = parts.join(' · ');
  }

  /* ---------- what the round does to it ---------- */

  async setTarget(target) {
    await this.player.setTarget(target);
  }

  /** Draw the answer over yours, or take it back off. */
  showTarget(target) {
    if (!target) {
      this.target = null;
      this.targetProfile = null;
      this.draw();
      return;
    }

    const rate = this.engine.ctx?.sampleRate ?? 48000;
    this.target = target;
    const theirs = makeEcho(rate, target);
    this.targetProfile = decayProfile(
      wetDryImpulse(theirs, target.mix), rate, this.times ?? decayTimes());
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
    return this.el.querySelector('#echoOther')?.textContent ?? null;
  }

  /** The other side of the A/B, named for what it actually is. */
  nameAB(label) {
    const slot = this.el.querySelector('#echoOther');
    if (slot) slot.textContent = label;
  }

  nameOther(label) {
    const slot = this.el.querySelector('#echoOther');
    if (slot) slot.textContent = label;
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

  /** Change what is running through it. */
  async setSource(id) {
    this.player.source = id;
    const picker = this.el.querySelector('#echoSource');
    if (picker) picker.value = id;
    await this.reload();
  }

  /** Nothing is done to a delay's material before it reaches you. */
  async setFault() {}

  /** What is on the other side of the A/B, or nothing. */
  async setTarget(target) {
    await this.player.setTarget(target ?? null);
  }

  /** Something the player brought themselves. */
  async loadFile(file) {
    if (!file) return false;

    const yours = this.el.querySelector('#echoYours');
    if (yours) { yours.hidden = false; yours.textContent = 'reading…'; }

    try {
      const buffer = await this.player.load(file);
      await this.setSource('yours');
      if (!this.player.playing) { await this.player.play(); this.playing(true); }
      if (yours) yours.textContent = `${file.name} · ${Math.round(buffer.duration)}s`;
      return true;
    } catch {
      if (yours) yours.textContent = 'that file could not be read';
      return false;
    }
  }

  /* ---------- what this is a reading of ---------- */

  /** What the delay is set to. */
  state() {
    return { ...this.settings };
  }

  /**
   * How it decays, band by band, in an envelope.
   *
   * The reverb and the delay declare the same kind on purpose. A room and a
   * repeat are the same sort of object here - each is completely described by
   * what it does to one click - so their readings are genuinely comparable,
   * and "is this delay as long as that room" is a question that can be asked.
   *
   * No debounce and no staleness to report: `restage` rebuilds this on every
   * change, synchronously, because it is arithmetic over an impulse rather
   * than a pass over audio. The envelope still carries the axis, which is what
   * `profileDistance` spent its whole life assuming without a record of.
   */
  read() {
    const of = {
      state: stampOf(this.state()),
      source: null,
      axis: decayAxis(this.times ?? undefined),
    };

    if (!this.profile) return notReady({ tool: 'delay', kind: 'decay', of });
    return decayReading('delay', this.profile,
      { times: this.times, state: this.state() });
  }

  /** Nothing to wait for: the profile is rebuilt on every change. */
  async readNow() {
    this.restage();
    return this.read();
  }

  lock() {
    this.interactive = false;
    this.el.querySelector('.echo').classList.add('is-locked');
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
    this.el.querySelector('.echo').classList.remove('is-locked');
  }

  destroy() {
    this.gone = true;
    cancelAnimationFrame(this.frame);
    this.unwatch?.();
    this.player.destroy();
  }
}
