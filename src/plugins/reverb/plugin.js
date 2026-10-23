import { VERB_DEFAULTS, makeImpulse, VERB_LIMITS } from './ir.js';
import {
  RESPONSE_BANDS, DECAY_FLOOR, decayProfile, decayTimes, rt60, bandOf, monoOf, wetDryImpulse, decayReading, decayAxis
} from '../../lib/response.js';
import { ImpulsePlayer } from '../../lib/player.js';
import { writeHertz } from '../compressor/plugin.js';
import { notReady, stampOf } from '../../lib/read.js';
import { dialOf, offDial, sizeOf, readyCanvas, decayX, decayY, watchSize, span } from '../../lib/panel.js';
import { dressKnobs } from '../../lib/knob.js';

/**
 * The reverb, as a plugin.
 *
 * Two pictures of the same room, because they answer different questions. The
 * impulse is what the room is - you can see the gap before it answers, the
 * walls arriving one at a time, and the wash closing over them. The decay is
 * what the room does, band by band, and it is also exactly what a guess is
 * marked against, so there is nothing hidden in the marking that is not on
 * the screen.
 */

const keepIn = (value, low, high) => Math.min(high, Math.max(low, value));

export const writeSeconds = (s) => (s >= 1 ? `${s.toFixed(2)} s` : `${Math.round(s * 1000)} ms`);

/** Every knob, and how it reads. */
const VERB_KNOBS = [
  { id: 'preDelay', name: 'Pre-delay', ...span(VERB_LIMITS.preDelay), step: 1, write: (v) => `${Math.round(v)} ms` },
  { id: 'decay', name: 'Decay', ...span(VERB_LIMITS.decay), log: true, write: (v) => writeSeconds(v) },
  { id: 'size', name: 'Size', ...span(VERB_LIMITS.size), log: true, write: (v) => `${Math.round(v)} m` },
  { id: 'damping', name: 'HF decay', ...span(VERB_LIMITS.damping), step: 0.01, write: (v) => `× ${v.toFixed(2)}` },
  { id: 'early', name: 'Early', ...span(VERB_LIMITS.early), step: 0.01, write: (v) => `${Math.round(v * 100)} %` },
  { id: 'lowCut', name: 'Low cut', ...span(VERB_LIMITS.lowCut), log: true, write: writeHertz },
  { id: 'highCut', name: 'High cut', ...span(VERB_LIMITS.highCut), log: true, write: writeHertz },
  { id: 'mix', name: 'Mix', ...span(VERB_LIMITS.mix), step: 0.01, write: (v) => `${Math.round(v * 100)} %` },
];

/** The three bands wear the same warm-to-cool ramp the EQ's regions do. */
const VERB_TINTS = { low: '--rust', mid: '--gold', high: '--enclosure' };

function verbPalette(el) {
  const style = getComputedStyle(el);
  const read = (name) => style.getPropertyValue(name).trim();
  return {
    bands: Object.fromEntries(Object.entries(VERB_TINTS).map(([id, token]) => [id, read(token)])),
    blush: read('--blush'),
    accent: read('--blush-deep'),
    sage: read('--sage'),
    gold: read('--gold'),
    paper: read('--paper'),
    soft: 'rgba(250, 246, 240, 0.55)',
    grid: 'rgba(250, 246, 240, 0.14)',
    faint: 'rgba(250, 246, 240, 0.07)',
  };
}

export class VerbPlugin {
  constructor(el, {
    engine, settings, onChange, source = 'instrument',
    player = null, role = 'tool',
  }) {
    this.el = el;
    this.engine = engine;
    this.settings = settings;
    this.onChange = onChange;
    this.role = role;
    this.interactive = true;
    this.target = null;      // drawn only once the round is over
    this.impulse = null;
    this.profile = null;
    this.columns = null;

    this.player = player ?? new ImpulsePlayer(engine, {
      source,
      impulseOf: makeImpulse,
      defaults: VERB_DEFAULTS,
    });

    this.build();
    this.restage();
    this.draw();

    // Open on a track: there is no Play in here to start the picture moving,
    // so it follows the sketchpad's transport from the moment it opens.
    if (this.role === 'insert') this.playing(true);

    // Rendered rather than played, so the room is on the screen before
    // anybody presses anything.
    this.player.prepare()
      .then(() => this.queue())
      .catch(() => { /* no audio yet; the pictures still work */ });
  }

  /* ---------- the furniture ---------- */

  build() {
    this.el.innerHTML = `
      <div class="plugin verb${this.role === 'insert' ? ' is-insert' : ''}">
        <div class="plugin-head">
          <span class="plugin-name">Reverb</span>
          <span class="plugin-trim" id="verbTrim"></span>
          <span class="plugin-read" id="verbRead"></span>
        </div>

        <div class="verb-display">
          <div class="plugin-panel verb-panel-room">
            <canvas id="verbRoom"></canvas>
          </div>
          <div class="plugin-panel verb-panel-decay">
            <canvas id="verbDecay"></canvas>
          </div>
        </div>

        <div class="plugin-controls" id="verbKnobs"></div>

        <div class="eq-transport verb-transport">
          <button class="play-btn" type="button" data-verb="play">Play</button>
          <div class="eq-ab" role="group" aria-label="What you are hearing">
            <button class="ab-btn is-on" type="button" data-hear="mine">Yours</button>
            <button class="ab-btn" type="button" data-hear="theirs" id="verbOther">Target</button>
          </div>
          <label class="field">
            <span class="field-label">Sample</span>
            <select id="verbSource">
              <option value="instrument">Keys</option>
              <option value="drums">Drums</option>
              <option value="mix">Full mix</option>
              <option value="bass">Bass</option>
              <option value="yours" id="verbYours" hidden>Your own</option>
            </select>
          </label>
          <label class="file-btn">Open a file<input type="file" id="verbFile" accept="audio/*"></label>
          <button class="link-btn" type="button" data-verb="reset">Reset</button>
        </div>
      </div>`;

    this.room = this.el.querySelector('#verbRoom');
    this.decay = this.el.querySelector('#verbDecay');
    this.el.querySelector('#verbSource').value = this.player.source;

    this.buildKnobs();
    this.wire();
  }

  buildKnobs() {
    this.el.querySelector('#verbKnobs').innerHTML = VERB_KNOBS.map((knob) => {
      const dial = dialOf(knob, this.settings[knob.id]);
      return `
        <div class="knob">
          <label class="knob-name" for="verb-${knob.id}">${knob.name}</label>
          <output class="knob-value" id="verb-${knob.id}-value">${knob.write(this.settings[knob.id])}</output>
          <input class="knob-dial" type="range" id="verb-${knob.id}" data-dial="${knob.id}"
                 min="${dial.min}" max="${dial.max}" step="${dial.step}" value="${dial.at}"
                 data-rest="${dialOf(knob, VERB_DEFAULTS[knob.id] ?? dial.at).at}"
                 aria-label="${knob.name}">
        </div>`;
    }).join('');
    this.syncKnobs();
  }

  wire() {
    this.el.querySelector('#verbKnobs').addEventListener('input', (e) => {
      const dial = e.target.closest('[data-dial]');
      if (!dial || !this.interactive) return;
      const knob = VERB_KNOBS.find((k) => k.id === dial.dataset.dial);
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

      const action = e.target.closest('[data-verb]');
      if (!action) return;
      if (action.dataset.verb === 'play') this.toggle();
      if (action.dataset.verb === 'reset' && this.interactive) {
        Object.assign(this.settings, VERB_DEFAULTS);
        this.buildKnobs();
        this.changed();
      }
    });

    this.el.querySelector('#verbSource')
      .addEventListener('change', (e) => this.setSource(e.target.value));
    this.el.querySelector('#verbFile')
      .addEventListener('change', (e) => this.loadFile(e.target.files?.[0]));

    this.resize = () => { this.restage(); this.draw(); };
    this.unwatch = watchSize(this.el, this.resize);
  }


  /**
   * A knob moved.
   *
   * The pictures are redrawn straight away, from an impulse built here and
   * now; the sound follows when its render is done. Building the room is a
   * few milliseconds and rendering the loop through it is a few more, so the
   * two are kept apart - the display should not wait on the audio thread, and
   * the audio should not be re-rendered once per frame of a drag.
   */
  changed() {
    this.syncKnobs();
    this.restage();
    this.draw();
    this.queue();
    this.onChange?.(this.settings);
  }

  /** Renders the room into the loop, latest settings winning. */
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
          // No audio context yet, or the render was cut short. The pictures
          // are already right; the sound catches up on the next change.
        }
      }
      this.rendering = false;
      this.writeReadout();
    })();
  }

  syncKnobs() {
    for (const knob of VERB_KNOBS) {
      const readout = this.el.querySelector(`#verb-${knob.id}-value`);
      const dial = this.el.querySelector(`#verb-${knob.id}`);
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
    this.el.querySelector('[data-verb="play"]').textContent = on ? 'Stop' : 'Play';
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

  /**
   * The room, measured, ready to be drawn.
   *
   * Done when something changes rather than once a frame: building an impulse
   * and reading its decay in three bands is tens of milliseconds, and the
   * only thing that moves between changes is a number in the readout.
   */
  restage() {
    const rate = this.engine.ctx?.sampleRate ?? 48000;
    this.impulse = makeImpulse(rate, this.settings);
    this.times = decayTimes();
    // What is drawn is what is marked: the room and the dry sound together.
    this.profile = decayProfile(wetDryImpulse(this.impulse, this.settings.mix), rate, this.times);

    const mono = monoOf(this.impulse);
    this.measured = {
      rt: Object.fromEntries(RESPONSE_BANDS.map((band) =>
        [band.id, rt60(bandOf(mono, rate, band), rate)])),
    };

    this.columns = null;
    const { width } = sizeOf(this.room);
    if (!width) return;

    // The impulse boiled down to one pair of numbers a column: how far it
    // swings either way. A quarter of a million samples behind four hundred
    // pixels has to be reduced by something, and the loudest either way is
    // what an impulse looks like.
    const count = Math.max(1, Math.round(width));
    const high = new Float32Array(count);
    const low = new Float32Array(count);
    const per = this.impulse.length / count;

    for (let x = 0; x < count; x += 1) {
      const from = Math.floor(x * per);
      const to = Math.min(this.impulse.length, Math.floor((x + 1) * per));
      let top = 0;
      let bottom = 0;
      for (let i = from; i < to; i += 1) {
        const value = mono[i];
        if (value > top) top = value;
        if (value < bottom) bottom = value;
      }
      high[x] = top;
      low[x] = bottom;
    }

    // Scaled to whatever the loudest thing in this room is, because the
    // impulses are normalised to energy and a long one is therefore quieter
    // sample by sample than a short one.
    let peak = 1e-6;
    for (let x = 0; x < count; x += 1) peak = Math.max(peak, high[x], -low[x]);
    this.columns = { high, low, count, peak };
  }

  draw() {
    // A plugin that has been taken off the sheet stops drawing. Its setters
    // are async - rendering a loop takes a second - so their promises can
    // land after it has been torn down, and writing to elements that are no
    // longer in the page is how a clean handover throws.
    if (this.gone) return;
    const ink = verbPalette(this.el);
    this.drawRoom(ink);
    this.drawDecay(ink);
    this.writeReadout();
  }

  drawRoom(ink) {
    const stage = readyCanvas(this.room);
    if (!stage || !this.columns) return;
    const { c, width, height } = stage;
    const { high, low, count, peak } = this.columns;

    const middle = height / 2;
    const span = width / count;
    const seconds = this.impulse.seconds;

    // A line every half second, so the length of the room is readable rather
    // than just visible.
    c.strokeStyle = ink.grid;
    c.lineWidth = 1;
    c.font = '9.5px system-ui, sans-serif';
    c.fillStyle = ink.soft;
    c.textAlign = 'left';
    const stepFor = seconds > 4 ? 1 : seconds > 1.5 ? 0.5 : 0.1;
    for (let t = stepFor; t < seconds; t += stepFor) {
      const x = (t / seconds) * width;
      c.beginPath(); c.moveTo(x, 0); c.lineTo(x, height); c.stroke();
    }

    c.strokeStyle = 'rgba(250, 246, 240, 0.28)';
    c.beginPath(); c.moveTo(0, middle); c.lineTo(width, middle); c.stroke();

    // The gap before the room answers: the one thing on this display that
    // people reliably cannot hear and reliably can see.
    const gap = (this.impulse.preDelay / seconds) * width;
    if (gap > 1) {
      c.fillStyle = 'rgba(250, 246, 240, 0.06)';
      c.fillRect(0, 0, gap, height);
      c.strokeStyle = ink.gold;
      c.setLineDash([3, 3]);
      c.beginPath(); c.moveTo(gap, 0); c.lineTo(gap, height); c.stroke();
      c.setLineDash([]);
    }

    // Drawn in decibels. In plain amplitude a tail is invisible within a
    // fifth of a second - an exponential decay spends almost all of its
    // length very near zero - so the panel was a spike at the left and four
    // fifths of nothing.
    //
    // The floor is eighty-five decibels down rather than sixty, because what
    // it is measured against is the loudest single thing in the room, and
    // that is a reflection: one sample carrying a whole copy of the sound,
    // twenty-odd decibels above the wash it arrives in front of. Against a
    // sixty decibel floor the wash ran out of room halfway across.
    const reach = (value) => {
      const level = Math.abs(value) / peak;
      return level <= 0 ? 0 : Math.max(0, 1 + Math.log10(level) / 4.25);
    };

    c.beginPath();
    for (let x = 0; x < count; x += 1) {
      const at = x * span;
      c.moveTo(at, middle - reach(high[x]) * middle * 0.94);
      c.lineTo(at, middle + reach(low[x]) * middle * 0.94);
    }
    c.strokeStyle = ink.blush;
    c.lineWidth = Math.max(1, span);
    c.stroke();

    c.fillStyle = ink.soft;
    c.font = '9.5px system-ui, sans-serif';
    c.textAlign = 'left';
    c.fillText(`the room · ${writeSeconds(seconds)} · dB`, 6, height - 6);
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
    for (let db = -10; db > DECAY_FLOOR; db -= 10) {
      const y = decayY(db, height);
      c.beginPath(); c.moveTo(0, y); c.lineTo(width, y); c.stroke();
      c.fillText(`${db}`, width - 4, y - 3);
    }

    c.textAlign = 'center';
    for (const t of [0.01, 0.1, 1, 4]) {
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
    c.fillText('how it decays · low, mid, high', 6, height - 16);
  }

  writeReadout() {
    const trim = this.el.querySelector('#verbTrim');
    if (!trim) return;

    const mix = this.settings.mix;
    const back = 20 * Math.log10(1 / Math.sqrt((1 - mix) ** 2 + mix ** 2));
    trim.textContent = Math.abs(back) < 0.05
      ? 'auto gain · none'
      : `auto gain · ${back > 0 ? '+' : '−'}${Math.abs(back).toFixed(1)} dB`;

    const parts = [];
    if (this.measured) {
      const { low, mid, high } = this.measured.rt;
      parts.push(`${writeSeconds(low)} low · ${writeSeconds(mid)} mid · ${writeSeconds(high)} high`);
    }
    parts.push(`${Math.round(this.settings.preDelay)} ms in front`);
    if (this.player.playing) parts.push(`out ${this.player.level().toFixed(0)} dB`);

    this.el.querySelector('#verbRead').textContent = parts.join(' · ');
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
    const theirs = makeImpulse(rate, target);
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
    return this.el.querySelector('#verbOther')?.textContent ?? null;
  }

  /** The other side of the A/B, named for what it actually is. */
  nameAB(label) {
    const slot = this.el.querySelector('#verbOther');
    if (slot) slot.textContent = label;
  }

  nameOther(label) {
    const slot = this.el.querySelector('#verbOther');
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

  /**
   * Rebuild both sides over whatever is loaded now.
   *
   * A reverb is rendered rather than filtered: the room is convolved into the
   * material ahead of time, so new material means both sides have to be made
   * again. The echo has had this for as long as it has existed; here it was
   * the body of a change handler, which is the same thing with nobody else
   * able to call it.
   */
  async reload() {
    this.player.buffer = null;
    await this.player.prepare().catch(() => {});

    // Both sides may not exist yet. A room is rendered into the material
    // rather than filtered over it, so the two chains are built the first
    // time anything plays - and this is now called at attach, which is
    // before that. It used to be the body of a change handler, which by
    // definition only ran once somebody had already been working.
    if (this.player.mine) this.player.mine.made = null;
    if (this.player.theirs) this.player.theirs.made = null;
    await this.player.setSettings(this.settings);
    if (this.player.target) await this.player.setTarget(this.player.target);
    if (this.player.playing) await this.player.play();
    this.draw();
  }

  /** Change what is running through it. */
  async setSource(id) {
    this.player.source = id;
    const picker = this.el.querySelector('#verbSource');
    if (picker) picker.value = id;
    await this.reload();
  }

  /** Nothing is done to a reverb's material before it reaches you. */
  async setFault() {}

  /** What is on the other side of the A/B, or nothing. */
  async setTarget(target) {
    await this.player.setTarget(target ?? null);
  }

  /** Something the player brought themselves. */
  async loadFile(file) {
    if (!file) return false;

    const yours = this.el.querySelector('#verbYours');
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

  /** What the room is set to. */
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

    if (!this.profile) return notReady({ tool: 'reverb', kind: 'decay', of });
    return decayReading('reverb', this.profile,
      { times: this.times, state: this.state() });
  }

  /** Nothing to wait for: the profile is rebuilt on every change. */
  async readNow() {
    this.restage();
    return this.read();
  }

  lock() {
    this.interactive = false;
    this.el.querySelector('.verb').classList.add('is-locked');
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
    this.el.querySelector('.verb').classList.remove('is-locked');
  }

  destroy() {
    this.gone = true;
    cancelAnimationFrame(this.frame);
    this.unwatch?.();
    this.player.destroy();
  }
}
