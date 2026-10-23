// The analysis view: a track, read back.
//
// Everything else in this app asks you a question. This does not. You put a
// piece of audio in front of it and it tells you what is in there - how loud,
// how dynamic, where the weight sits, how wide, and what a fold to mono would
// cost. The measurements are in the four files beside this one; what is here
// is the page that shows them.
//
// Two slots rather than one, because almost every real use of a meter is a
// comparison. Yours against a record you like is the whole of what mastering
// engineers do with these numbers, and `distance` already knows how to put
// two readings side by side - so the second slot costs a dropdown and buys
// the only thing that makes the first one actionable.

import { loudnessReading } from './loudness.js';
import { crestReading } from './dynamics.js';
import { balanceReading, THIRDS, THIRD_NAMES, TILT } from './balance.js';
import { widthReading } from './width.js';
import { IMAGE_BANDS } from '../plugins/stereo/field.js';
import { readyCanvas } from '../lib/panel.js';
import { distance } from '../lib/gap.js';

/** The material this app can make, for when there is no file to hand. */
const OWN = [
  { id: 'mix', label: 'The four-piece bed' },
  { id: 'drums', label: 'Drums' },
  { id: 'instrument', label: 'Keys' },
  { id: 'noise', label: 'Pink noise' },
];

/** What a slot is called, and what colour it is drawn in. */
const SLOTS = [
  { id: 'yours', label: 'Yours', tint: '--charcoal' },
  { id: 'reference', label: 'Reference', tint: '--blush-deep' },
];

/** A difference, with its sign on it. Named for what it is used for here. */
const writeOff = (db, places = 1) =>
  (Number.isFinite(db) ? `${db > 0 ? '+' : ''}${db.toFixed(places)}` : '—');

const writeLufs = (lufs) => (Number.isFinite(lufs) ? `${lufs.toFixed(1)}` : '—');

/** The colours, read off the page so the view follows the analysisPalette. */
function analysisPalette(el) {
  const style = getComputedStyle(el);
  const read = (name) => style.getPropertyValue(name).trim();
  return {
    ink: read('--charcoal'),
    line: read('--line'),
    soft: read('--text-soft'),
    accent: read('--blush-deep'),
    blush: read('--blush'),
    sage: read('--sage'),
    gold: read('--gold'),
    rust: read('--rust'),
    paper: read('--paper'),
  };
}

/**
 * Everything worth saying about one piece of audio.
 *
 * All four readings at once, because they are read together: a loudness
 * without a crest factor beside it is the number that started the loudness
 * war, and a crest factor without a spectrum does not say where the energy
 * that is being squashed actually is.
 */
function readAll(channels, rate, source) {
  return {
    loudness: loudnessReading(channels, rate, { source }),
    crest: crestReading(channels, rate, { source }),
    balance: balanceReading(channels, rate, { source }),
    width: widthReading(channels, rate, { source }),
    seconds: Math.min(...channels.map((channel) => channel.length)) / rate,
    rate,
    channels: channels.length,
  };
}

/** An AudioBuffer as the plain arrays the readings take. */
const channelsOf = (buffer) =>
  Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));

export class AnalysisPage {
  constructor(el, { engine }) {
    this.el = el;
    this.engine = engine;
    this.slots = { yours: null, reference: null };
    this.names = { yours: '', reference: '' };
    this.gone = false;

    this.build();
    this.wire();
    this.resize = () => this.draw();
    window.addEventListener('resize', this.resize);
  }

  build() {
    this.el.innerHTML = `
      <div class="analysis">
        <div class="analysis-head">
          <p class="eyebrow">What you are reading</p>
          <div class="analysis-slots">
            ${SLOTS.map((slot) => `
              <div class="analysis-slot" data-slot="${slot.id}">
                <span class="slot-name">${slot.label}</span>
                <label class="field">
                  <span class="field-label">Material</span>
                  <select data-pick="${slot.id}">
                    <option value="">Nothing yet</option>
                    ${OWN.map((own) => `<option value="${own.id}">${own.label}</option>`).join('')}
                  </select>
                </label>
                <label class="file-btn">Open a file<input type="file" data-file="${slot.id}" accept="audio/*"></label>
                <span class="slot-what" data-what="${slot.id}"></span>
              </div>`).join('')}
          </div>
        </div>

        <p class="analysis-note" id="analysisNote"></p>

        <div class="analysis-figures" id="analysisFigures"></div>

        <h3 class="subhead">Where the weight sits</h3>
        <p class="fine">A third of an octave at a time, averaged over the whole thing and
          tilted ${TILT} dB an octave - so a balanced mix reads level and what stands out
          on the line is what stands out in the room.</p>
        <canvas class="analysis-canvas" id="analysisSpectrum"></canvas>

        <h3 class="subhead">How it moves</h3>
        <p class="fine">Short-term loudness and crest factor, second by second. A flat pair
          of lines is a track that has been held still.</p>
        <canvas class="analysis-canvas" id="analysisTime"></canvas>
        <div class="analysis-key">
          <span><i class="key-line"></i> your loudness</span>
          <span><i class="key-line is-crest"></i> your crest</span>
          <span><i class="key-line is-reference"></i> the reference's loudness</span>
          <span><i class="key-line is-crest is-reference"></i> the reference's crest</span>
        </div>

        <h3 class="subhead">How wide it is</h3>
        <p class="fine">Band by band, and what a fold to mono would take off the bottom.</p>
        <div class="analysis-bands" id="analysisBands"></div>
      </div>`;

    this.spectrum = this.el.querySelector('#analysisSpectrum');
    this.time = this.el.querySelector('#analysisTime');
  }

  wire() {
    this.el.addEventListener('change', async (e) => {
      const pick = e.target.closest('[data-pick]');
      if (pick) {
        await this.putOwn(pick.dataset.pick, pick.value);
        return;
      }

      const file = e.target.closest('[data-file]');
      if (file) await this.putFile(file.dataset.file, file.files?.[0]);
    });
  }

  /** Say what is happening, because rendering a four-minute track is not instant. */
  note(text) {
    const line = this.el.querySelector('#analysisNote');
    if (line) line.textContent = text;
  }

  /** One of this app's own loops, rendered and read. */
  async putOwn(id, which) {
    if (!which) {
      this.slots[id] = null;
      this.names[id] = '';
      this.show();
      return;
    }

    const own = OWN.find((o) => o.id === which);
    this.note(`Rendering ${own.label.toLowerCase()}…`);
    const buffer = await this.engine.renderLoop(which, { spread: true });
    this.take(id, buffer, own.label);
  }

  /** Something off somebody's disk, decoded and read. */
  async putFile(id, file) {
    if (!file) return;

    this.note(`Reading ${file.name}…`);
    try {
      const ctx = this.engine.ensure();
      const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
      this.take(id, buffer, file.name);
      // The dropdown no longer describes what is loaded, so it stops claiming to.
      const pick = this.el.querySelector(`[data-pick="${id}"]`);
      if (pick) pick.value = '';
    } catch {
      this.note(`${file.name} could not be decoded. A wav, an mp3 or an m4a will work.`);
    }
  }

  /**
   * Read a buffer into a slot.
   *
   * The readings are synchronous and a long track is a lot of arithmetic.
   * Measured, on a three-minute stereo file at 44.1 kHz: about seven seconds,
   * of which the loudness is three and the width two and a half. So the page
   * is told what is happening, and given a chance to paint it, before the
   * main thread stops answering.
   */
  take(id, buffer, name) {
    // A frame to lay the message out, then a turn of the loop to paint it,
    // and only then the arithmetic. Doing the work inside the frame callback
    // blocks the very paint it was waiting for, and the message that says
    // what is happening appears after it has finished happening.
    requestAnimationFrame(() => setTimeout(() => {
      if (this.gone) return;
      this.slots[id] = readAll(channelsOf(buffer), buffer.sampleRate, name);
      this.names[id] = name;
      this.show();
    }, 0));
  }

  /** Everything, redrawn. */
  show() {
    if (this.gone) return;

    for (const slot of SLOTS) {
      const what = this.el.querySelector(`[data-what="${slot.id}"]`);
      const read = this.slots[slot.id];
      what.textContent = read
        ? `${this.names[slot.id]} · ${read.seconds.toFixed(1)} s · `
          + `${read.channels > 1 ? 'stereo' : 'mono'} · ${(read.rate / 1000).toFixed(1)} kHz`
        : '';
    }

    this.note(this.say());
    this.figures();
    this.bands();
    this.draw();
  }

  /**
   * The numbers, as a row of tiles.
   *
   * With the difference against the reference under each one where there is a
   * reference, because the difference is the thing somebody is looking for
   * and working it out in their head is what the tile is meant to save.
   */
  figures() {
    const mine = this.slots.yours;
    const theirs = this.slots.reference;
    const box = this.el.querySelector('#analysisFigures');

    if (!mine) {
      box.innerHTML = '';
      return;
    }

    const rows = [
      ['Loudness', `${writeLufs(mine.loudness.values.integrated)} LUFS`,
        theirs && writeOff(mine.loudness.values.integrated - theirs.loudness.values.integrated)],
      ['Range', `${mine.loudness.values.range.toFixed(1)} LU`,
        theirs && writeOff(mine.loudness.values.range - theirs.loudness.values.range)],
      ['True peak', `${writeOff(mine.loudness.values.truePeak)} dBTP`,
        theirs && writeOff(mine.loudness.values.truePeak - theirs.loudness.values.truePeak)],
      ['Crest', `${mine.crest.values.crest.toFixed(1)} dB`,
        theirs && writeOff(mine.crest.values.crest - theirs.crest.values.crest)],
      ['Tightest', `${mine.crest.values.tightest.toFixed(1)} dB`,
        theirs && writeOff(mine.crest.values.tightest - theirs.crest.values.tightest)],
      ['Mono costs', mine.width.values.mono ? 'mono already'
        : `${mine.width.values.lowCost.toFixed(1)} dB`,
        theirs && !mine.width.values.mono && !theirs.width.values.mono
          && writeOff(mine.width.values.lowCost - theirs.width.values.lowCost)],
    ];

    box.innerHTML = rows.map(([label, value, off]) => `
      <div class="figure">
        <strong>${value}</strong>
        <span>${label}</span>
        ${off ? `<em class="figure-off">${off} vs reference</em>` : ''}
      </div>`).join('');

  }

  /**
   * The line under the slots: what to do next, or what the comparison found.
   *
   * The comparison comes from `distance` rather than from arithmetic written
   * out here, which is the same comparator every exercise in this app is
   * marked with - so "16.7 dB at 400 Hz" means the same thing in both places.
   */
  say() {
    const mine = this.slots.yours;
    const theirs = this.slots.reference;

    if (!mine) return 'Open a file, or pick something this app can make.';
    if (!theirs) return 'Load a reference into the second slot to compare against it.';

    const gap = distance(mine.balance, theirs.balance);
    const loud = mine.loudness.values.integrated - theirs.loudness.values.integrated;

    return `Yours is ${Math.abs(loud).toFixed(1)} LU ${loud > 0 ? 'louder' : 'quieter'}. `
      + `The furthest apart the two spectra get is ${gap.off.toFixed(1)} dB at `
      + `${gap.where}, where yours is the ${gap.detail.hotter > 0 ? 'hotter' : 'quieter'}.`;
  }

  /** The width, band by band, as bars rather than a curve. */
  bands() {
    const mine = this.slots.yours;
    const box = this.el.querySelector('#analysisBands');

    if (!mine) {
      box.innerHTML = '';
      return;
    }
    if (mine.width.values.mono) {
      box.innerHTML = '<p class="fine">This is a mono file. There is no image to read.</p>';
      return;
    }

    const theirs = this.slots.reference;
    box.innerHTML = IMAGE_BANDS.map((band) => {
      const here = mine.width.values.bands[band.id];
      // Width runs from mono at the floor to very wide at the top; drawn as a
      // share of that range rather than of a decibel scale nobody reads.
      const share = Math.max(0, Math.min(1, (here.width + 30) / 36));
      const other = theirs && !theirs.width.values.mono
        ? theirs.width.values.bands[band.id] : null;

      return `
        <div class="band-row">
          <span class="band-name">${band.label}</span>
          <div class="band-track">
            <div class="band-fill" style="width:${(share * 100).toFixed(1)}%"></div>
            ${other ? `<div class="band-mark" style="left:${(Math.max(0, Math.min(1, (other.width + 30) / 36)) * 100).toFixed(1)}%"></div>` : ''}
          </div>
          <span class="band-read">${here.width.toFixed(1)} dB</span>
          <span class="band-read band-mono">${here.mono.toFixed(1)} in mono</span>
        </div>`;
    }).join('');
  }

  /* ---------- the two pictures ---------- */

  draw() {
    if (this.gone) return;
    const ink = analysisPalette(this.el);
    this.drawSpectrum(ink);
    this.drawTime(ink);
  }

  drawSpectrum(ink) {
    const stage = readyCanvas(this.spectrum);
    if (!stage) return;
    const { c, width, height } = stage;

    const pad = { left: 34, right: 10, top: 10, bottom: 18 };
    const plot = { w: width - pad.left - pad.right, h: height - pad.top - pad.bottom };
    const x = (i) => pad.left + (i / (THIRDS.length - 1)) * plot.w;
    // Fifteen decibels either side of the average, which is where a mix lives
    // once it has been tilted - and clamped, so that a band with nothing in
    // it pins to the bottom of the picture rather than drawing a line off
    // the edge of it.
    const y = (db) => pad.top
      + ((15 - Math.max(-15, Math.min(15, db))) / 30) * plot.h;

    c.strokeStyle = ink.line;
    c.lineWidth = 1;
    for (const db of [-10, 0, 10]) {
      c.beginPath();
      c.moveTo(pad.left, y(db));
      c.lineTo(width - pad.right, y(db));
      c.stroke();

      c.fillStyle = ink.soft;
      c.font = '10px ui-sans-serif, system-ui, sans-serif';
      c.textAlign = 'right';
      c.fillText(db === 0 ? '0' : `${db > 0 ? '+' : ''}${db}`, pad.left - 6, y(db) + 3);
    }

    // Every fourth band, by its name rather than by its centre: the band at
    // 396.85 Hz is called 400 by everybody who works on one.
    c.textAlign = 'center';
    for (let i = 2; i < THIRDS.length; i += 4) {
      c.fillStyle = ink.soft;
      c.fillText(THIRD_NAMES[i], x(i), height - 5);
    }

    for (const slot of [...SLOTS].reverse()) {
      const read = this.slots[slot.id];
      if (!read) continue;

      c.strokeStyle = slot.id === 'yours' ? ink.ink : ink.accent;
      c.lineWidth = slot.id === 'yours' ? 2 : 1.5;
      c.setLineDash(slot.id === 'yours' ? [] : [5, 4]);
      c.beginPath();
      THIRDS.forEach((hz, i) => {
        const db = read.balance.values.bands[hz];
        if (i === 0) c.moveTo(x(i), y(db));
        else c.lineTo(x(i), y(db));
      });
      c.stroke();
      c.setLineDash([]);
    }
  }

  drawTime(ink) {
    const stage = readyCanvas(this.time);
    if (!stage) return;
    const { c, width, height } = stage;

    const mine = this.slots.yours;
    if (!mine) return;

    const pad = { left: 34, right: 34, top: 10, bottom: 18 };
    const plot = { w: width - pad.left - pad.right, h: height - pad.top - pad.bottom };
    const span = Math.max(mine.seconds, 1);
    const x = (t) => pad.left + (t / span) * plot.w;

    // Loudness on the left at a fixed -40 to 0, crest on the right at 0 to 30.
    // Two scales on one picture, because the shape of each against the other
    // is the whole point - a loudness that holds while the crest drops is a
    // limiter doing the holding.
    const loudY = (lufs) => pad.top + ((0 - Math.max(-40, lufs)) / 40) * plot.h;
    const crestY = (db) => pad.top + ((30 - Math.max(0, Math.min(30, db))) / 30) * plot.h;

    c.strokeStyle = ink.line;
    c.lineWidth = 1;
    for (const lufs of [-10, -20, -30]) {
      c.beginPath();
      c.moveTo(pad.left, loudY(lufs));
      c.lineTo(width - pad.right, loudY(lufs));
      c.stroke();
      c.fillStyle = ink.soft;
      c.font = '10px ui-sans-serif, system-ui, sans-serif';
      c.textAlign = 'right';
      c.fillText(String(lufs), pad.left - 6, loudY(lufs) + 3);
    }

    c.textAlign = 'left';
    for (const db of [10, 20]) {
      c.fillStyle = ink.soft;
      c.fillText(`${db}`, width - pad.right + 6, crestY(db) + 3);
    }

    const line = (points, at, colour, dash) => {
      c.strokeStyle = colour;
      c.lineWidth = 1.6;
      c.setLineDash(dash);
      c.beginPath();
      points.forEach((point, i) => {
        const px = x(point.at);
        const py = at(point);
        if (i === 0) c.moveTo(px, py);
        else c.lineTo(px, py);
      });
      c.stroke();
      c.setLineDash([]);
    };

    for (const slot of [...SLOTS].reverse()) {
      const read = this.slots[slot.id];
      if (!read) continue;
      const dash = slot.id === 'yours' ? [] : [5, 4];

      line(read.loudness.values.short.filter((p) => Number.isFinite(p.lufs)),
        (p) => loudY(p.lufs), slot.id === 'yours' ? ink.ink : ink.accent, dash);
      line(read.crest.values.over, (p) => crestY(p.crest), ink.gold, dash);
    }

    c.fillStyle = ink.soft;
    c.textAlign = 'left';
    c.fillText('LUFS', pad.left, height - 5);
    c.textAlign = 'right';
    c.fillText('crest, dB', width - pad.right, height - 5);
  }

  destroy() {
    this.gone = true;
    window.removeEventListener('resize', this.resize);
    this.el.textContent = '';
  }
}
