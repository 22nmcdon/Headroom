import {
  CEIL_DEFAULTS, CEIL_DRIVE, CEIL_OUTPUT, CEIL_PEAKS, CEIL_RANGE, CEIL_RELEASE,
  ceilingReading, ceilingCost, matchOut,
} from './ceiling.js';
import { CeilingPlayer } from './player.js';
import { notReady, stampOf } from '../../lib/read.js';
import { dialOf, offDial, readyCanvas, watchSize, span, writeMs } from '../../lib/panel.js';
import { dressKnobs } from '../../lib/knob.js';

/**
 * The limiter, as a plugin.
 *
 * Four knobs and two pictures, and the pictures are doing the arguing. A
 * limiter is the one processor in this app whose whole purpose is a trade -
 * loudness against peak-to-loudness ratio - and a trade cannot be heard
 * without seeing both halves of it move. So one bay is what the ceiling is
 * taking off, over the loop, and the other is what the pass cost, in the
 * three figures a master is actually judged on, before against after.
 *
 * Which is also why the Match button is on the face rather than in a menu. A
 * limiter makes things louder and louder sounds better; until the level is
 * taken out of the comparison, every A/B here answers the wrong question.
 */

/** Where the reduction trace starts and stops, in dB. */
const CEIL_TOP = 0;
const CEIL_DEEP = -18;

const ceilY = (db, height) =>
  ((Math.max(CEIL_DEEP, Math.min(CEIL_TOP, db)) - CEIL_TOP) / (CEIL_DEEP - CEIL_TOP)) * height;

const signed = (db, places = 1) => `${db > 0 ? '+' : ''}${db.toFixed(places)} dB`;

/** How fast the live reduction meter comes back up, in dB a frame. */
const FALL_BACK = 0.25;

/**
 * The four knobs, and what each readout says.
 *
 * The drive reads as a signed gain because that is what it is - a trim in
 * front of a threshold that cannot move. The ceiling reads in dBTP rather
 * than dB, because which peak it is a ceiling for is the whole question the
 * picker next to it answers, and a unit that says so is one fewer thing to
 * remember.
 */
const CEIL_KNOBS = [
  {
    id: 'drive',
    name: 'Drive',
    ...span(CEIL_DRIVE),
    step: 0.1,
    write: (v) => signed(v),
  },
  {
    id: 'ceiling',
    name: 'Ceiling',
    ...span(CEIL_RANGE),
    step: 0.1,
    write: (v) => `${v.toFixed(1)} dBTP`,
  },
  {
    id: 'release',
    name: 'Release',
    ...span(CEIL_RELEASE),
    step: 1,
    write: writeMs,
  },
  {
    id: 'output',
    name: 'Output',
    ...span(CEIL_OUTPUT),
    step: 0.1,
    write: (v) => signed(v),
  },
];

const CEIL_SIDES = [
  { id: 'mine', label: 'Limited' },
  { id: 'theirs', label: 'Bypass' },
];

function ceilPalette(el) {
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

export class LimiterPlugin {
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
    this.cost = null;
    // What the audio thread is doing right now, as opposed to what the
    // offline pass measured. Held between frames so a reduction that happened
    // between two of them is not lost.
    this.live = 0;

    this.player = player ?? new CeilingPlayer(engine, { source });
    this.player.setFault(fault);

    this.build();
    this.draw();

    if (this.role === 'insert') this.playing(true);

    this.player.prepare()
      .then(() => { this.measure(); this.draw(); })
      .catch(() => { /* no audio yet; the knobs still work */ });
  }

  /* ---------- the furniture ---------- */

  build() {
    const host = this.role === 'insert' ? '' : `
      <div class="eq-transport host-row">
        <button class="play-btn" type="button" data-ceil="play">Play</button>
        <div class="eq-ab" role="group" aria-label="What you are hearing">
          ${CEIL_SIDES.map((l) => `<button class="ab-btn${l.id === 'mine' ? ' is-on' : ''}" type="button" data-hear="${l.id}">${l.label}</button>`).join('')}
        </div>
        <label class="field">
          <span class="field-label">Sample</span>
          <select id="ceilSource">
            <option value="mix">Full mix</option>
            <option value="instrument">Keys</option>
            <option value="drums">Drums</option>
            <option value="yours" id="ceilYours" hidden>Your own</option>
          </select>
        </label>
        <label class="file-btn">Open a file<input type="file" id="ceilFile" accept="audio/*"></label>
      </div>`;

    this.el.innerHTML = `${host}
      <div class="plugin limiter${this.role === 'insert' ? ' is-insert' : ''}">
        <div class="plugin-head">
          <span class="plugin-lamp"></span>
          <span class="plugin-name">Limiter</span>
          <span class="plugin-trim" id="ceilLive"></span>
          <span class="plugin-trim" id="ceilAgainst"></span>
          <span class="plugin-read" id="ceilRead"></span>
        </div>

        <div class="stereo-display">
          <div class="plugin-bay">
            <span class="panel-name">Gain reduction</span>
            <div class="plugin-panel"><canvas id="ceilTrace"></canvas></div>
          </div>
          <div class="plugin-bay">
            <span class="panel-name">What it cost</span>
            <div class="plugin-panel"><canvas id="ceilCost"></canvas></div>
          </div>
        </div>

        <div class="plugin-controls" id="ceilKnobs"></div>

        <div class="stereo-routing">
          <label class="field">
            <span class="field-label">Ceiling for</span>
            <select id="ceilPeak">
              ${CEIL_PEAKS.map((p) => `<option value="${p.id}">${p.label}</option>`).join('')}
            </select>
          </label>
          <button class="ab-btn" type="button" data-ceil="match">Match</button>
          <span class="eq-hint" id="ceilHint">match the level before you judge it — a limiter that made it louder will always seem to have helped</span>
        </div>
      </div>`;

    this.trace = this.el.querySelector('#ceilTrace');
    this.costPanel = this.el.querySelector('#ceilCost');
    const sample = this.el.querySelector('#ceilSource');
    if (sample) sample.value = this.player.source;
    const peak = this.el.querySelector('#ceilPeak');
    if (peak) peak.value = this.settings.peak ?? 'true';

    this.buildKnobs();
    this.wire();
  }

  buildKnobs() {
    this.el.querySelector('#ceilKnobs').innerHTML = CEIL_KNOBS.map((knob) => {
      const dial = dialOf(knob, this.settings[knob.id]);
      return `
        <div class="knob">
          <label class="knob-name" for="ceil-${knob.id}">${knob.name}</label>
          <output class="knob-value" id="ceil-${knob.id}-value">${knob.write(this.settings[knob.id])}</output>
          <input class="knob-dial" type="range" id="ceil-${knob.id}" data-dial="${knob.id}"
                 min="${dial.min}" max="${dial.max}" step="${dial.step}" value="${dial.at}"
                 data-rest="${dialOf(knob, CEIL_DEFAULTS[knob.id] ?? dial.at).at}"
                 aria-label="${knob.name}">
        </div>`;
    }).join('');
    this.syncKnobs();
  }

  wire() {
    this.el.querySelector('#ceilKnobs').addEventListener('input', (e) => {
      const dial = e.target.closest('[data-dial]');
      if (!dial || !this.interactive) return;
      const knob = CEIL_KNOBS.find((k) => k.id === dial.dataset.dial);
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
      if (e.target.closest('[data-ceil="play"]')) this.toggle();
      if (e.target.closest('[data-ceil="match"]')) this.match();
    });

    this.el.querySelector('#ceilPeak')?.addEventListener('change', (e) => {
      if (!this.interactive) return;
      this.settings.peak = e.target.value;
      this.changed();
    });
    this.el.querySelector('#ceilSource')
      ?.addEventListener('change', (e) => this.setSource(e.target.value));
    this.el.querySelector('#ceilFile')
      ?.addEventListener('change', (e) => this.loadFile(e.target.files?.[0]));

    this.resize = () => this.draw();
    this.unwatch = watchSize(this.el, this.resize);
  }

  changed() {
    this.syncKnobs();
    this.player.setSettings(this.settings);
    this.soonMeasure();
    this.draw();
    this.onChange?.(this.settings);
  }

  syncKnobs() {
    for (const knob of CEIL_KNOBS) {
      const readout = this.el.querySelector(`#ceil-${knob.id}-value`);
      const dial = this.el.querySelector(`#ceil-${knob.id}`);
      if (readout) readout.textContent = knob.write(this.settings[knob.id]);
      if (dial && document.activeElement !== dial) {
        dial.value = dialOf(knob, this.settings[knob.id]).at;
      }
    }
    const peak = this.el.querySelector('#ceilPeak');
    if (peak) peak.value = this.settings.peak ?? 'true';
    dressKnobs(this.el);
  }

  /**
   * Put the output where the two sides are the same loudness.
   *
   * The measurement, not an estimate: `matchOut` runs the pass and reads both
   * sides. It costs a pass, which is why it is a button rather than something
   * that happens on every move of the drive - and a button is the right shape
   * anyway, because deciding when to level-match is part of the skill.
   */
  match() {
    const material = this.player.sample();
    if (!material || !this.interactive) return;
    this.settings.output = Math.round(
      matchOut(material, material.rate, this.settings) * 10,
    ) / 10;
    this.buildKnobs();
    this.changed();
  }

  /* ---------- the reading ---------- */

  /**
   * Debounced, unlike the level tool's.
   *
   * A trim's reading is one K-weighting pass. This is a whole limiter over
   * three seconds of stereo with a true-peak detector on every sample, which
   * measures at about 100 ms - so measuring on every step of a dragged knob
   * would drop the knob. The imager pays the same cost for the same reason
   * and settles the same way.
   */
  soonMeasure() {
    clearTimeout(this.soon);
    this.soon = setTimeout(() => { this.measure(); this.draw(); }, 120);
  }

  measure() {
    const material = this.player.sample();
    if (!material) return;

    const done = ceilingReading(material, material.rate, this.settings);
    this.reading = done.reading;
    // The framed trace rather than the per-sample one. Three seconds at
    // 44.1 kHz is 132 000 numbers and the panel is a few hundred pixels wide,
    // so drawing the raw trace would be five hundred points a pixel - at
    // sixty frames a second, while a knob is being dragged. The reading's own
    // five-millisecond frames are 600 points and are what everything else
    // compares at anyway.
    this.frames = done.reading.values.gr;
    // The pass the reading was taken from, rather than a second one: the cost
    // figures are two loudness readings and two peak searches over audio that
    // has already been rendered once, and rendering it twice would double the
    // most expensive thing on the face.
    this.cost = ceilingCost(material, done.audio, material.rate);
  }

  read() {
    const of = {
      state: stampOf({ ...this.settings, rate: this.engine?.ctx?.sampleRate ?? null }),
      source: this.player.source,
      axis: this.reading?.of?.axis ?? null,
    };
    if (!this.reading) return notReady({ tool: 'limiter', kind: 'reduction', of });
    return this.reading;
  }

  async readNow() {
    await this.player.prepare().catch(() => {});
    this.measure();
    return this.read();
  }

  /* ---------- the pictures ---------- */

  draw() {
    const ink = ceilPalette(this.el);
    this.drawTrace(ink);
    this.drawCost(ink);
    this.writeReadout();
  }

  drawTrace(ink) {
    const stage = readyCanvas(this.trace);
    if (!stage) return;
    const { c, width, height } = stage;

    // The live meter down the right, so the offline trace and the audio
    // thread's own reduction sit side by side and can be seen to agree.
    const lane = 16;
    const plot = Math.max(40, width - 30 - lane - 8);

    c.font = '9.5px system-ui, sans-serif';
    c.strokeStyle = ink.grid;
    c.lineWidth = 1;
    c.textAlign = 'right';
    c.fillStyle = ink.soft;
    for (let db = CEIL_TOP; db >= CEIL_DEEP; db -= 6) {
      const y = ceilY(db, height);
      c.beginPath(); c.moveTo(0, y); c.lineTo(plot, y); c.stroke();
      c.fillText(`${db}`, plot + 24, Math.max(9, y + 10));
    }

    const frames = this.frames;
    if (!frames?.length) {
      c.textAlign = 'left';
      c.fillStyle = ink.soft;
      c.fillText(this.role === 'insert' ? 'play the sketch' : 'press play', 6, height - 6);
      return;
    }

    // Filled rather than a line, because reduction is an amount taken off and
    // not a level: the quantity is the area between zero and the trace.
    c.fillStyle = ink.blush;
    c.globalAlpha = 0.5;
    c.beginPath();
    c.moveTo(0, ceilY(0, height));
    for (let i = 0; i < frames.length; i += 1) {
      c.lineTo((i / (frames.length - 1 || 1)) * plot, ceilY(frames[i], height));
    }
    c.lineTo(plot, ceilY(0, height));
    c.closePath();
    c.fill();
    c.globalAlpha = 1;

    c.strokeStyle = ink.accent || ink.blush;
    c.lineWidth = 1.2;
    c.beginPath();
    for (let i = 0; i < frames.length; i += 1) {
      const x = (i / (frames.length - 1 || 1)) * plot;
      const y = ceilY(frames[i], height);
      if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.stroke();

    // The answer, when somebody has asked to be shown it: the depth the
    // target reaches on this loop, as a line to get the trace down to.
    if (Number.isFinite(this.shown)) {
      const y = ceilY(this.shown, height);
      c.strokeStyle = ink.sage;
      c.lineWidth = 1;
      c.setLineDash([3, 3]);
      c.beginPath(); c.moveTo(0, y); c.lineTo(plot, y); c.stroke();
      c.setLineDash([]);
    }

    // And the live one: a bar hanging from the top at whatever the audio
    // thread last reported.
    const at = width - lane;
    c.strokeStyle = ink.grid;
    c.strokeRect(at, 0, lane, height);
    if (this.live < -0.01) {
      c.fillStyle = this.live < -12 ? ink.rust : ink.gold;
      c.globalAlpha = 0.8;
      c.fillRect(at + 1, 0, lane - 2, ceilY(this.live, height));
      c.globalAlpha = 1;
    }
  }

  /**
   * The three figures, before against after.
   *
   * A table rather than a picture, and that is the right form for once: these
   * are the numbers a delivery spec is written in, and the thing being taught
   * is to read them off and compare. The loudness and the peak are what the
   * spec asks for; the peak-to-loudness ratio is what was spent to get there,
   * and seeing it fall as the other two rise is the whole lesson of the tool.
   */
  drawCost(ink) {
    const stage = readyCanvas(this.costPanel);
    if (!stage) return;
    const { c, width, height } = stage;

    c.font = '9.5px system-ui, sans-serif';

    if (!this.cost) {
      c.textAlign = 'left';
      c.fillStyle = ink.soft;
      c.fillText('loudness, peak and what the trade cost', 6, height - 6);
      return;
    }

    const { before, after } = this.cost;
    const values = this.reading?.values;
    const figure = (db, unit = '') => (Number.isFinite(db) ? `${db.toFixed(2)}${unit}` : '--');

    const rows = [
      ['loudness', figure(before.lufs), figure(after.lufs), 'LUFS'],
      ['true peak', figure(before.peak), figure(after.peak), 'dBTP'],
      ['PLR', figure(before.plr), figure(after.plr), 'LU'],
      ['deepest', '', figure(values?.deepest ?? 0), 'dB'],
      ['average', '', figure(values?.average ?? 0), 'dB'],
    ];

    const line = Math.min(18, (height - 50) / (rows.length + 1));
    // Proportional rather than fixed offsets from the right edge, because
    // this panel is half a phone's width in portrait and a fixed 150px name
    // column started at x = 30 there.
    const columns = [2, Math.round(width * 0.68), width - 4];

    c.textAlign = 'right';
    c.fillStyle = ink.soft;
    c.fillText('in', columns[1], 10);
    c.fillText('out', columns[2], 10);

    rows.forEach(([name, from, to, unit], i) => {
      const y = 10 + (i + 1) * line;
      c.textAlign = 'left';
      c.fillStyle = ink.soft;
      c.fillText(`${name} ${unit}`, columns[0], y);
      c.textAlign = 'right';
      c.fillStyle = ink.soft;
      c.fillText(from, columns[1], y);
      // The out column is the one being dialled, so it is the one in ink.
      c.fillStyle = name === 'true peak' && after.peak > -0.9 ? ink.rust : ink.blush;
      c.fillText(to, columns[2], y);
    });

    // Down at the foot of the panel rather than tucked under the table, so
    // the bay reads as two things - the figures and the proportion - instead
    // of one short list with a lot of room under it.
    this.drawSpend(c, ink, width, height, Math.max(
      10 + (rows.length + 1) * line + 10, height - 32,
    ));
    this.drawAsked(c, ink, width, height - 56, after);
  }

  /**
   * What the round asked for, against what came out.
   *
   * Only on a delivery round, where there is a spec to be held to. Two
   * conditions and both have to hold, so both are drawn and each is coloured
   * on its own - a master on the number that is over the ceiling has got one
   * of the two right and should be able to see which.
   */
  drawAsked(c, ink, width, top, after) {
    const asked = this.asked();
    if (!asked || top < 14) return;

    const off = after.lufs - asked.lufs;
    const over = after.peak - asked.peak;

    c.textAlign = 'left';
    c.fillStyle = ink.soft;
    c.fillText(`${asked.service ?? 'Asked'} wants`, 2, top);

    c.textAlign = 'right';
    // Said as a direction rather than as a signed number. "-7.1" against a
    // target is a figure half the people reading it will take the wrong way
    // round, and this is the one line on the face that has to be read fast.
    c.fillStyle = Math.abs(off) < 0.5 ? ink.sage : ink.gold;
    c.fillText(
      `${asked.lufs.toFixed(1)} LUFS · ${Math.abs(off) < 0.05 ? 'on it'
        : `${Math.abs(off).toFixed(1)} ${off > 0 ? 'over' : 'under'}`}`,
      Math.round(width * 0.68), top,
    );
    c.fillStyle = over <= 0 ? ink.sage : ink.rust;
    c.fillText(
      `${asked.peak.toFixed(1)} dBTP · ${over > 0 ? `${over.toFixed(2)} over` : 'under'}`,
      width - 4, top,
    );
  }

  /**
   * What is left of the peak-to-loudness ratio, and what has been spent.
   *
   * The table says it in numbers and this says it as a length, because the
   * thing being taught is a proportion: a master that started with fourteen
   * decibels of PLR and has four left has spent most of what it had, and
   * "10.67" does not say that at a glance.
   *
   * The bar is the ratio the material arrived with, so it does not rescale as
   * the drive moves - the shaded part grows into a fixed length rather than
   * both ends moving, which is the difference between a picture of a trade
   * and a picture of nothing in particular.
   */
  drawSpend(c, ink, width, height, top) {
    const { before, after } = this.cost;
    if (!Number.isFinite(before.plr) || !Number.isFinite(after.plr)) return;
    if (top + 26 > height) return;

    const bar = Math.max(40, width - 8);
    const spent = Math.max(0, Math.min(1, (before.plr - after.plr) / Math.max(1e-6, before.plr)));

    c.fillStyle = ink.sage;
    c.globalAlpha = 0.45;
    c.fillRect(2, top, bar, 8);
    c.globalAlpha = 1;
    c.fillStyle = ink.rust;
    c.fillRect(2, top, bar * spent, 8);

    c.textAlign = 'left';
    c.fillStyle = ink.soft;
    c.fillText(
      `${(before.plr - after.plr).toFixed(2)} LU of ${before.plr.toFixed(2)} spent`,
      2, top + 21,
    );
  }

  writeReadout() {
    const read = this.el.querySelector('#ceilRead');
    const against = this.el.querySelector('#ceilAgainst');

    // What the audio thread is doing, as a figure as well as a bar. A
    // gain-reduction meter's number is what anybody actually quotes, and it
    // is also the only part of this face a check without a canvas can read.
    const live = this.el.querySelector('#ceilLive');
    if (live) {
      live.textContent = this.isPlaying() && this.live < -0.05
        ? `holding ${(-this.live).toFixed(1)} dB`
        : '';
    }

    if (read) {
      const after = this.cost?.after;
      read.textContent = after && Number.isFinite(after.lufs)
        ? `${after.lufs.toFixed(1)} LUFS · peak ${after.peak.toFixed(1)} dBTP`
        : '';
    }

    if (!against) return;
    const match = this.cost?.match;
    if (match === undefined || !Number.isFinite(match)) {
      against.textContent = '';
    } else if (Math.abs(match) < 0.05) {
      against.textContent = 'level-matched';
    } else {
      against.textContent = `${Math.abs(match).toFixed(1)} LU ${match < 0 ? 'louder' : 'quieter'} than the bypass`;
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
    const button = this.el.querySelector('[data-ceil="play"]');
    if (button) button.textContent = on ? 'Stop' : 'Play';
    cancelAnimationFrame(this.frame);
    this.frame = null;
    if (!on) { this.live = 0; this.draw(); return; }
    const tick = () => {
      // The deepest since the last frame, falling back slowly rather than
      // being reset to it. A gain-reduction meter that tracked the audio
      // thread exactly would read zero most frames and full on the rest: the
      // loop's hits are a quarter of a second apart and the limiter is back
      // up between them, so what you would see is a strobe.
      //
      // Measured: at eighteen decibels of drive the audio thread reports
      // around -13 dB at the hits, so the fall-back is set to clear that in
      // about a second - which is what a meter with a hold on it looks like.
      const now = this.player.reduction();
      this.live = now < this.live ? now : Math.min(0, this.live + FALL_BACK);
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

  /** What the knobs are set to. */
  state() {
    return { ...this.settings };
  }

  /**
   * What the round is chasing, remembered and not drawn.
   *
   * Nothing on this face has to be hidden while a round is on, which is
   * unusual here and worth saying. The level tool hides its comparison
   * against the untreated loop because that comparison IS the answer to
   * matching a level; the imager hides the target's width for the same
   * reason. What a limiter round asks for is an amount of reduction, and the
   * only thing on screen that would give that away is the target's own depth
   * - which is `showTarget`'s business and is drawn when it is asked for.
   *
   * The drill does not need this either way: the shell hides the whole face
   * for a drill and asks with chips.
   */
  setTarget(settings) {
    this.target = settings ?? null;
    this.writeSpec();
    this.draw();
  }

  /**
   * The brief, where the hint usually is.
   *
   * A delivery round hands over two numbers - a loudness and a ceiling - and
   * those are the brief rather than the answer, so they go on the face. The
   * knob fields of a target are never drawn, which is the distinction: a spec
   * is what you were asked for and the knob positions are what you worked
   * out. A target with no `lufs` on it is a matching round, and that one has
   * nothing to say here.
   */
  writeSpec() {
    const hint = this.el.querySelector('#ceilHint');
    if (!hint) return;

    // The opening line, kept the first time so it can be put back. Read off
    // the element rather than held as a constant, so the two cannot drift.
    if (this.opening === undefined) this.opening = hint.textContent;

    const asked = this.asked();
    hint.textContent = asked
      ? `${asked.service ?? 'The brief'}: ${asked.lufs.toFixed(1)} LUFS, `
        + `true peak under ${asked.peak.toFixed(1)} dBTP`
      : this.opening;
  }

  /** What the round asked for, or null. */
  asked() {
    const target = this.target;
    if (!Number.isFinite(target?.lufs) || !Number.isFinite(target?.peak)) return null;
    return target;
  }

  /**
   * Draw the answer, or take it back off.
   *
   * What a limiter's answer is, is an amount of reduction - so what is shown
   * is the target's deepest, as a line across the trace. Measured on the same
   * material, because a reduction read off two different loops is two
   * different measurements.
   */
  showTarget(target) {
    if (!target) { this.shown = null; this.draw(); return; }
    const material = this.player.sample();
    this.shown = material
      ? ceilingReading(material, material.rate, target).reading.values.deepest
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
    this.el.querySelector('.limiter')?.classList.add('is-locked');
  }

  unlock() {
    this.interactive = true;
    this.el.querySelector('.limiter')?.classList.remove('is-locked');
  }

  async setSource(id) {
    this.player.source = id;
    const picker = this.el.querySelector('#ceilSource');
    if (picker) picker.value = id;
    await this.player.prepare().catch(() => {});
    this.measure();
    this.draw();
  }

  async loadFile(file) {
    if (!file) return;
    await this.player.load(file);
    const option = this.el.querySelector('#ceilYours');
    if (option) option.hidden = false;
    await this.setSource('yours');
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    clearTimeout(this.soon);
    this.unwatch?.();
    this.player.stop();
  }
}
