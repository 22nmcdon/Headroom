import {
  STEREO_DEFAULTS, STEREO_BANDS, STEREO_FLOOR, STEREO_AXIS, stereoReading, widthOf,
  STEREO_LIMITS,
} from './field.js';
import { notReady, stampOf } from '../../lib/read.js';
import { StereoPlayer } from './player.js';
import { dialOf, offDial, sizeOf, readyCanvas, watchSize, span } from '../../lib/panel.js';
import { dressKnobs } from '../../lib/knob.js';
import { writeHertz } from '../../lib/panel.js';
import { MONO_SLOPES } from './shuffle.js';
import { WIDEN_KINDS } from './widen.js';
import { PAN_MODES, PAN_LAWS } from './pan.js';

/**
 * The imager, as a plugin.
 *
 * Two pictures, and they answer the two questions anybody has about a stereo
 * mix. The goniometer is the live one: it draws the two channels against each
 * other, so a mono signal is a vertical line, a wide one is a cloud, and
 * anything leaning over to the horizontal is two channels disagreeing - which
 * is what will not survive being summed. The bars are the considered one:
 * width band by band, coloured by whether the two channels in that band are
 * agreeing or arguing.
 */

const WIDTH_TOP = 6;      // decibels of width the bars reach to

const bandX = (i, width) => ((i + 0.5) / STEREO_BANDS.length) * width;
const widthY = (db, height) => height - ((db - STEREO_FLOOR) / (WIDTH_TOP - STEREO_FLOOR)) * height;

/**
 * Where a thing sits, said rather than numbered.
 *
 * One writer for all three pan knobs. The dead band is there because a
 * continuous dial does not land on zero: without it a knob nudged off centre
 * by a pixel reads "1% left", which is a number nobody asked for and a
 * position nobody can hear.
 */
const writePlace = (v) => (Math.abs(v) < 0.02
  ? 'Centre'
  : `${Math.round(Math.abs(v) * 100)}% ${v < 0 ? 'left' : 'right'}`);

/** Every knob, and how it reads. */
const STEREO_KNOBS = [
  { id: 'low', name: 'Low width', ...span(STEREO_LIMITS.low), step: 0.01, write: (v) => `${Math.round(v * 100)} %` },
  { id: 'mid', name: 'Mid width', ...span(STEREO_LIMITS.mid), step: 0.01, write: (v) => `${Math.round(v * 100)} %` },
  { id: 'high', name: 'High width', ...span(STEREO_LIMITS.high), step: 0.01, write: (v) => `${Math.round(v * 100)} %` },
  { id: 'lowMid', name: 'Low ends at', ...span(STEREO_LIMITS.lowMid), log: true, write: writeHertz },
  { id: 'midHigh', name: 'Top starts at', ...span(STEREO_LIMITS.midHigh), log: true, write: writeHertz },
  // The two that work on the side across the whole range rather than inside
  // one band. They pull in opposite directions in the same part of the
  // spectrum on purpose - see shuffle.js.
  {
    id: 'monoBelow',
    name: 'Mono below',
    ...span(STEREO_LIMITS.monoBelow),
    log: true,
    write: (v) => (v <= STEREO_LIMITS.monoBelow[0] ? 'off' : writeHertz(v)),
  },
  {
    id: 'shuffle',
    name: 'Bass width',
    ...span(STEREO_LIMITS.shuffle),
    step: 0.5,
    write: (v) => (v <= 0 ? 'flat' : `+${v.toFixed(1)} dB`),
  },
  // The one block that makes side out of middle. Amount first, because it is
  // the one that does nothing until it is up, and the two that shape it
  // after - the delay belongs to two of the five kinds and the detune to one,
  // which is a thing the face says by greying them rather than by hiding them.
  {
    id: 'widenAmount',
    name: 'Widen',
    ...span(STEREO_LIMITS.widenAmount),
    step: 0.01,
    write: (v) => (v <= 0 ? 'off' : `${Math.round(v * 100)} %`),
  },
  {
    id: 'widenDelay',
    name: 'Widen time',
    ...span(STEREO_LIMITS.widenDelay),
    step: 0.5,
    write: (v) => `${v.toFixed(1)} ms`,
  },
  {
    id: 'widenCents',
    name: 'Detune',
    ...span(STEREO_LIMITS.widenCents),
    step: 1,
    write: (v) => `\u00b1 ${Math.round(v)} cents`,
  },
  // In dual mode these two replace Pan, the way a reverb's spaces swap their
  // own knobs: a mode that quietly left a control doing nothing would be a
  // preset wearing a plugin's face.
  {
    id: 'panL',
    name: 'Left goes',
    ...span(STEREO_LIMITS.panL),
    step: 0.01,
    write: writePlace,
  },
  {
    id: 'panR',
    name: 'Right goes',
    ...span(STEREO_LIMITS.panR),
    step: 0.01,
    write: writePlace,
  },
  {
    id: 'pan',
    name: 'Pan',
    ...span(STEREO_LIMITS.pan),
    step: 0.01,
    write: writePlace,
  },
];

/**
 * Which knobs a pan mode has.
 *
 * Balance has one number and dual has two, and neither has the other's - a
 * face that showed all three would be showing a control that does nothing,
 * which is the thing the reverb's spaces comment calls a preset wearing a
 * plugin's controls.
 */
const PAN_KNOBS = { balance: ['pan'], dual: ['panL', 'panR'] };

export const panDeck = (mode) => {
  const mine = PAN_KNOBS[mode] ?? PAN_KNOBS.balance;
  const theirs = Object.values(PAN_KNOBS).flat().filter((id) => !mine.includes(id));
  return STEREO_KNOBS.filter((knob) => !theirs.includes(knob.id));
};

const LISTENS = [
  { id: 'stereo', label: 'Stereo' },
  { id: 'mono', label: 'Mono' },
  { id: 'side', label: 'Side' },
];

function stereoPalette(el) {
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

/** Agreeing, arguing, or somewhere between - the colour a band is drawn in. */
function agreement(correlation, ink) {
  if (correlation >= 0.6) return ink.sage;
  if (correlation >= 0) return ink.gold;
  return ink.rust;
}

export class StereoPlugin {
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
    // One envelope, not a bare profile beside a timestamp that was started
    // and abandoned. `readAt` was there to answer exactly the question the
    // envelope now answers, and answered it for nobody.
    this.reading = null;

    this.player = player ?? new StereoPlayer(engine, { source });
    this.player.setFault(fault);

    this.build();
    this.draw();

    // Open on a track: there is no Play in here to start the picture moving,
    // so it follows the sketchpad's transport from the moment it opens.
    if (this.role === 'insert') this.playing(true);

    this.player.prepare()
      .then(() => { this.measure(); this.draw(); })
      .catch(() => { /* no audio yet; the knobs still work */ });
  }

  /* ---------- the furniture ---------- */

  build() {
    // Everything a host does, outside the chassis. Choosing the material,
    // starting it, comparing against a target: none of that is this
    // processor's, and a unit with a Sample menu screwed to its face is not
    // one anybody would recognise. The sketchpad is its own host and has
    // these already, so an insert gets none of it - and gets none of it by
    // not being built, rather than by being built and hidden with CSS. A
    // hidden control is still a control somebody has to explain.
    //
    // Reset went out with them rather than away, for the reason the EQ's
    // Flatten did: most plugins have no reset at all - they have presets, and
    // you reset by recalling one - so a button that silently undoes a face
    // full of work belongs with the furniture that is about running an
    // exercise, not on the face.
    const host = this.role === 'insert' ? '' : `
      <div class="eq-transport host-row image-transport">
        <button class="play-btn" type="button" data-stereo="play">Play</button>
        <div class="eq-ab" role="group" aria-label="What you are hearing">
          <button class="ab-btn is-on" type="button" data-hear="mine">Yours</button>
          <button class="ab-btn" type="button" data-hear="theirs" id="stereoOther">Target</button>
        </div>
        <label class="field">
          <span class="field-label">Sample</span>
          <select id="stereoSource">
            <option value="mix">Full mix</option>
            <option value="instrument">Keys</option>
            <option value="drums">Drums</option>
            <option value="yours" id="stereoYours" hidden>Your own</option>
          </select>
        </label>
        <label class="file-btn">Open a file<input type="file" id="stereoFile" accept="audio/*"></label>
        <button class="link-btn" type="button" data-stereo="reset">Reset</button>
      </div>`;

    this.el.innerHTML = `${host}
      <div class="plugin stereo${this.role === 'insert' ? ' is-insert' : ''}">
        <div class="plugin-head">
          <span class="plugin-lamp"></span>
          <span class="plugin-name">Stereo image</span>
          <span class="plugin-trim" id="stereoTrim"></span>
          <span class="plugin-read" id="stereoRead"></span>
        </div>

        <div class="stereo-display">
          <div class="plugin-bay">
            <span class="panel-name">Field</span>
            <div class="plugin-panel"><canvas id="stereoScope"></canvas></div>
          </div>
          <div class="plugin-bay">
            <span class="panel-name">Width</span>
            <div class="plugin-panel"><canvas id="stereoBands"></canvas></div>
          </div>
        </div>

        <div class="plugin-controls" id="stereoKnobs"></div>

        <div class="stereo-routing">
          <span class="panel-name">Listen</span>
          <div class="eq-ab" role="group" aria-label="What you are monitoring">
            ${LISTENS.map((l) => `<button class="ab-btn${l.id === 'stereo' ? ' is-on' : ''}" type="button" data-listen="${l.id}">${l.label}</button>`).join('')}
          </div>
          <!-- Beside Listen because it belongs to the Mono below knob, and
               that knob is about what survives the button to its left. -->
          <label class="field">
            <span class="field-label">Widen</span>
            <select id="stereoWiden">
              ${WIDEN_KINDS.map((kind) => `<option value="${kind.id}">${kind.label}</option>`).join('')}
            </select>
          </label>
          <label class="field">
            <span class="field-label">Slope</span>
            <select id="stereoSlope">
              ${MONO_SLOPES.map((slope) => `<option value="${slope.id}">${slope.label}</option>`).join('')}
            </select>
          </label>
          <!-- The mode changes which knobs are on the face, so it is a
               picker rather than a knob: a control that rearranges the
               controls is not one of them. -->
          <label class="field">
            <span class="field-label">Pan</span>
            <select id="stereoPanMode">
              ${PAN_MODES.map((mode) => `<option value="${mode.id}">${mode.label}</option>`).join('')}
            </select>
          </label>
          <label class="field">
            <span class="field-label">Law</span>
            <select id="stereoPanLaw">
              ${PAN_LAWS.map((law) => `<option value="${law.id}">${law.label}</option>`).join('')}
            </select>
          </label>
          <span class="eq-hint">mono is the check that matters — what survives it is what everybody hears</span>
        </div>
      </div>`;

    this.scope = this.el.querySelector('#stereoScope');
    this.bands = this.el.querySelector('#stereoBands');
    // Null for an insert, which has no host row: a track's own signal is
    // the material, so there is nothing to pick.
    const sample = this.el.querySelector('#stereoSource');
    if (sample) sample.value = this.player.source;

    this.buildKnobs();
    this.wire();
  }

  buildKnobs() {
    this.el.querySelector('#stereoKnobs').innerHTML = panDeck(this.settings.panMode).map((knob) => {
      const dial = dialOf(knob, this.settings[knob.id]);
      return `
        <div class="knob">
          <label class="knob-name" for="image-${knob.id}">${knob.name}</label>
          <output class="knob-value" id="image-${knob.id}-value">${knob.write(this.settings[knob.id])}</output>
          <input class="knob-dial" type="range" id="image-${knob.id}" data-dial="${knob.id}"
                 min="${dial.min}" max="${dial.max}" step="${dial.step}" value="${dial.at}"
                 data-rest="${dialOf(knob, STEREO_DEFAULTS[knob.id] ?? dial.at).at}"
                 aria-label="${knob.name}">
        </div>`;
    }).join('');
    this.syncKnobs();
  }

  wire() {
    this.el.querySelector('#stereoKnobs').addEventListener('input', (e) => {
      const dial = e.target.closest('[data-dial]');
      if (!dial || !this.interactive) return;
      const knob = STEREO_KNOBS.find((k) => k.id === dial.dataset.dial);
      this.settings[knob.id] = offDial(knob, dial.value);
      this.changed();
    });

    this.el.querySelector('#stereoWiden').addEventListener('change', (e) => {
      if (!this.interactive) return;
      const want = e.target.value;
      this.settings.widen = WIDEN_KINDS.some((kind) => kind.id === want) ? want : 'off';
      this.changed();
    });

    this.el.querySelector('#stereoSlope').addEventListener('change', (e) => {
      if (!this.interactive) return;
      const want = e.target.value;
      this.settings.monoSlope = MONO_SLOPES.some((slope) => slope.id === want) ? want : 'gentle';
      this.changed();
    });

    this.el.querySelector('#stereoPanMode').addEventListener('change', (e) => {
      if (!this.interactive) return;
      const want = e.target.value;
      this.settings.panMode = PAN_MODES.some((mode) => mode.id === want) ? want : 'balance';
      // The deck is different in the two modes, so this one rebuilds rather
      // than syncs - and buildKnobs ends in a sync, so the rest follows.
      this.buildKnobs();
      this.changed();
    });

    this.el.querySelector('#stereoPanLaw').addEventListener('change', (e) => {
      if (!this.interactive) return;
      const want = e.target.value;
      this.settings.panLaw = PAN_LAWS.some((law) => law.id === want) ? want : 'power';
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

      const listen = e.target.closest('[data-listen]');
      if (listen) {
        // Monitoring, not processing: it changes what you are checking and
        // never what you are marked on.
        this.settings.listen = listen.dataset.listen;
        for (const button of this.el.querySelectorAll('[data-listen]')) {
          button.classList.toggle('is-on', button === listen);
        }
        this.player.setSettings(this.settings);
        if (this.player.target) this.player.setTarget({ ...this.player.target, listen: this.settings.listen });
        this.writeReadout();
        return;
      }

      const action = e.target.closest('[data-stereo]');
      if (!action) return;
      if (action.dataset.stereo === 'play') this.toggle();
      if (action.dataset.stereo === 'reset' && this.interactive) {
        const listen = this.settings.listen;
        Object.assign(this.settings, STEREO_DEFAULTS, { listen });
        this.buildKnobs();
        this.changed();
      }
    });

    this.el.querySelector('#stereoSource')
      ?.addEventListener('change', (e) => this.setSource(e.target.value));
    this.el.querySelector('#stereoFile')
      ?.addEventListener('change', (e) => this.loadFile(e.target.files?.[0]));

    this.resize = () => this.draw();
    this.unwatch = watchSize(this.el, this.resize);
  }


  changed() {
    this.syncKnobs();
    this.player.setSettings(this.settings);
    this.schedule();
    this.draw();
    this.onChange?.(this.settings);
  }

  /**
   * Reads the image off the material, no more often than it is worth doing.
   *
   * Filtering a bar of stereo audio into six bands and correlating each one
   * is tens of milliseconds - fine once, far too slow for every frame of a
   * drag. The goniometer is the live picture; this is the considered one, and
   * it catches up when the hand stops.
   */
  schedule() {
    clearTimeout(this.soon);
    this.soon = setTimeout(() => { this.measure(); this.draw(); }, 120);
  }

  measure() {
    const sample = this.player.sample();
    if (!sample) return null;
    this.reading = stereoReading(sample.left, sample.right, sample.rate, this.settings,
      { source: this.player.source ?? null });
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
    const picker = this.el.querySelector('#stereoSource');
    if (picker) picker.value = id;

    await this.player.prepare().catch(() => {});
    if (this.player.playing) await this.player.play();
    this.measure();
    this.draw();
  }

  /** A width somebody else already applied, before it reached you. */
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

    const yours = this.el.querySelector('#stereoYours');
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

  /** What the imager is set to. */
  state() {
    return { ...this.settings };
  }

  /**
   * The image, as measured - synchronously, always, and honest about its age.
   *
   * This is the bug the envelope exists for. `changed()` schedules a
   * measurement a hundred and twenty milliseconds out and then redraws
   * immediately, so the animation loop painted a live goniometer beside band
   * bars up to a debounce old, in the same frame, in the same panel,
   * disagreeing with each other - and a sustained drag kept pushing the
   * deadline, so the bars could be arbitrarily stale. Neither picture was
   * wrong; nothing could say which one was current.
   */
  read() {
    const of = {
      state: stampOf(this.state()),
      source: this.player.source ?? null,
      axis: STEREO_AXIS,
    };

    if (!this.reading) {
      this.schedule();
      return notReady({ tool: 'panning', kind: 'image', of });
    }
    if (this.reading.of.state !== of.state) {
      this.schedule();
      return { ...this.reading, of, ready: false };
    }
    return this.reading;
  }

  /** The same, but waited for: the material loaded and the bands measured. */
  async readNow() {
    await this.player.prepare().catch(() => {});
    clearTimeout(this.soon);
    this.measure();
    return this.read();
  }

  syncKnobs() {
    for (const knob of panDeck(this.settings.panMode)) {
      const readout = this.el.querySelector(`#image-${knob.id}-value`);
      const dial = this.el.querySelector(`#image-${knob.id}`);
      if (readout) readout.textContent = knob.write(this.settings[knob.id]);
      if (dial && document.activeElement !== dial) {
        dial.value = dialOf(knob, this.settings[knob.id]).at;
      }
    }
    const slope = this.el.querySelector('#stereoSlope');
    if (slope) slope.value = this.settings.monoSlope ?? 'gentle';
    const which = this.el.querySelector('#stereoWiden');
    if (which) which.value = this.settings.widen ?? 'off';
    const mode = this.el.querySelector('#stereoPanMode');
    if (mode) mode.value = this.settings.panMode ?? 'balance';
    const law = this.el.querySelector('#stereoPanLaw');
    if (law) law.value = this.settings.panLaw ?? 'power';
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
    const button = this.el.querySelector('[data-stereo="play"]');
    if (button) button.textContent = on ? 'Stop' : 'Play';
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

  draw() {
    // A plugin that has been taken off the sheet stops drawing. Its setters
    // are async - rendering a loop takes a second - so their promises can
    // land after it has been torn down, and writing to elements that are no
    // longer in the page is how a clean handover throws.
    if (this.gone) return;
    const ink = stereoPalette(this.el);
    this.drawScope(ink);
    this.drawBands(ink);
    this.writeReadout();
  }

  /**
   * The goniometer: the two channels drawn against each other, turned so that
   * what they agree on points up.
   *
   * Straight up and down is mono. A cloud is wide. Anything lying over
   * towards the horizontal is two channels arguing, and the horizontal is
   * exactly the axis that disappears when somebody sums them.
   */
  drawScope(ink) {
    const stage = readyCanvas(this.scope);
    if (!stage) return;
    const { c, width, height } = stage;

    const middle = { x: width / 2, y: height / 2 };
    const reach = Math.min(width, height) * 0.44;

    c.strokeStyle = ink.grid;
    c.lineWidth = 1;
    c.beginPath();
    c.arc(middle.x, middle.y, reach, 0, Math.PI * 2);
    c.stroke();

    // The two axes it is read against: up is what the channels share, across
    // is what they do not.
    c.strokeStyle = ink.zero;
    c.setLineDash([3, 4]);
    c.beginPath();
    c.moveTo(middle.x, middle.y - reach); c.lineTo(middle.x, middle.y + reach);
    c.moveTo(middle.x - reach, middle.y); c.lineTo(middle.x + reach, middle.y);
    c.stroke();
    c.setLineDash([]);

    const frames = this.player.playing ? this.player.frames() : null;
    if (frames) {
      let peak = 1e-4;
      for (let i = 0; i < frames.left.length; i += 1) {
        peak = Math.max(peak, Math.abs(frames.left[i]), Math.abs(frames.right[i]));
      }

      c.fillStyle = ink.blush;
      c.globalAlpha = 0.5;
      for (let i = 0; i < frames.left.length; i += 2) {
        const m = ((frames.left[i] + frames.right[i]) * 0.5) / peak;
        const s = ((frames.left[i] - frames.right[i]) * 0.5) / peak;
        c.fillRect(middle.x + s * reach - 0.75, middle.y - m * reach - 0.75, 1.5, 1.5);
      }
      c.globalAlpha = 1;
    }

    c.fillStyle = ink.soft;
    c.font = '9.5px system-ui, sans-serif';
    c.textAlign = 'center';
    c.fillText('mono', middle.x, 12);
    c.textAlign = 'left';
    c.fillText('side', 4, middle.y - 4);
    c.textAlign = 'left';
    const idle = this.role === 'insert' ? 'the field · play the sketch' : 'the field · press play';
    c.fillText(this.player.playing ? 'the field' : idle, 6, height - 6);
  }

  drawBands(ink) {
    const stage = readyCanvas(this.bands);
    if (!stage) return;
    const { c, width, height } = stage;

    c.font = '9.5px system-ui, sans-serif';
    c.strokeStyle = ink.grid;
    c.lineWidth = 1;
    c.textAlign = 'right';
    c.fillStyle = ink.soft;
    for (let db = 0; db > STEREO_FLOOR; db -= 10) {
      const y = widthY(db, height);
      c.beginPath(); c.moveTo(0, y); c.lineTo(width, y); c.stroke();
      c.fillText(`${db}`, width - 4, y - 3);
    }

    const reading = this.read();
    if (!reading.values) return;

    // Dimmed while it is behind, rather than blanked or - as before - drawn
    // at full strength as though it were current. Blanking would flicker on
    // every nudge; the bars still have the shape worth seeing, and the label
    // below says they are catching up.
    c.globalAlpha = reading.ready ? 1 : 0.4;

    const slot = width / STEREO_BANDS.length;
    const bar = Math.min(26, slot * 0.5);

    STEREO_BANDS.forEach((band, i) => {
      const read = reading.values.bands[band.id];
      const x = bandX(i, width);
      const top = widthY(read.width, height);
      const base = widthY(STEREO_FLOOR, height);

      c.fillStyle = agreement(read.correlation, ink);
      c.globalAlpha = 0.75;
      c.fillRect(x - bar / 2, top, bar, Math.max(1, base - top));
      c.globalAlpha = 1;

      if (this.target) {
        const theirs = widthY(this.target.bands[band.id].width, height);
        c.strokeStyle = ink.sage;
        c.lineWidth = 2;
        c.setLineDash([5, 3]);
        c.beginPath();
        c.moveTo(x - bar * 0.8, theirs); c.lineTo(x + bar * 0.8, theirs);
        c.stroke();
        c.setLineDash([]);
      }

      c.fillStyle = ink.soft;
      c.textAlign = 'center';
      c.fillText(band.label, x, height - 4);
    });

    c.fillStyle = ink.soft;
    c.textAlign = 'left';
    c.fillText(reading.ready
      ? 'width by band · green agrees, red argues'
      : 'width by band · measuring…', 6, 12);
    c.globalAlpha = 1;
  }

  writeReadout() {
    const trim = this.el.querySelector('#stereoTrim');
    if (!trim) return;

    const reading = this.read();

    if (reading.values && reading.ready) {
      const { correlation, mono } = reading.values.whole;
      trim.textContent = `correlation ${correlation.toFixed(2)} · mono costs ${Math.abs(mono).toFixed(1)} dB`;
    } else {
      trim.textContent = reading.values ? 'measuring…' : '';
    }

    const parts = [
      `${Math.round(this.settings.low * 100)} / ${Math.round(this.settings.mid * 100)} / `
      + `${Math.round(this.settings.high * 100)}%`,
    ];
    if (reading.values && reading.ready) parts.push(`${reading.values.whole.width.toFixed(1)} dB wide`);
    if (this.settings.listen !== 'stereo') parts.push(`${this.settings.listen} only`);

    this.el.querySelector('#stereoRead').textContent = parts.join(' · ');
  }

  /* ---------- what the round does to it ---------- */

  setTarget(target) {
    this.player.setTarget(target);
  }

  /** Draw the answer over yours, or take it back off. */
  showTarget(target) {
    if (!target) {
      this.target = null;
      this.draw();
      return;
    }

    const sample = this.player.sample();
    if (sample) {
      this.target = stereoReading(sample.left, sample.right, sample.rate, target).values;
    }
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
    return this.el.querySelector('#stereoOther')?.textContent ?? null;
  }

  /** The pair a guess is read against, rendered and handed over. */
  async material() {
    await this.player.prepare().catch(() => null);
    return this.player.sample() ?? null;
  }

  /** The other side of the A/B, named for what it actually is. */
  nameAB(label) {
    const slot = this.el.querySelector('#stereoOther');
    if (slot) slot.textContent = label;
  }

  nameOther(label) {
    const slot = this.el.querySelector('#stereoOther');
    if (slot) slot.textContent = label;
  }

  lock() {
    this.interactive = false;
    this.el.querySelector('.stereo').classList.add('is-locked');
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
    this.el.querySelector('.stereo').classList.remove('is-locked');
  }

  destroy() {
    this.gone = true;
    clearTimeout(this.soon);
    cancelAnimationFrame(this.frame);
    this.unwatch?.();
    this.player.destroy();
  }
}
