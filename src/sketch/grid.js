// The clip grid: the sketchpad, as a page.
//
// Tracks across, scenes down, a clip in a slot - and the thing a tap does is
// launch it, quantised to the bar, which is the whole reason this shape of
// interface exists. Everything under it is already written and tested: the
// project is data, the launch is arithmetic, the stage is the audio, and what
// is here is the part that cannot be tested in node and is therefore kept as
// thin as it can be made.
//
// On the phone-versus-desktop question, which the plan left open and this is
// the file that has to answer:
//
//   The grid is the same at both sizes. Four tracks by four scenes is sixteen
//   buttons; at 430 px that is cells of about eighty, which is a comfortable
//   target and legible. Nothing about launching needs a desktop.
//
//   The depth is what moves. Editing a clip, choosing an instrument, putting
//   an insert on a track - those sit in one panel, which is a column beside
//   the grid when there is room for it and a block under the grid when there
//   is not. One panel and one set of markup, placed differently; the phone
//   does not get a second interface to maintain, it gets the same one a
//   scroll further down. A tap on a slot is a launch at both sizes, and the
//   panel it fills in is where the complexity is kept.
//
// A tap launches *and* selects, deliberately. While the clock is running, the
// clip you are about to edit is the one you want to hear, and a separate
// select would be a second tap for a thing nobody wants done separately. The
// one case it buys outright: tap an empty slot while playing and it comes in
// on the next bar with nothing in it, so every note you then draw arrives on
// the next pass round. That is the sketchpad working.

import {
  newProject, setClip, setTrack, setProject, setNotes, setLength,
  clipAt, trackAt, sceneOf, sceneHasAnything, barTicks, sceneToMidi, SCENES,
} from './project.js';
import {
  STEP_DIVISIONS, divisionOf, SCALES, SCALE_IDS, ROOT_NAMES,
  rowsFor, columnsOf, filled, toggleCell, clearRow,
} from './steps.js';
import { loadSketch, saveSketch, sketchFile, readSketchFile } from './store.js';
import { knobsFor, writeKnob, tidy } from './knobs.js';
import { makeStage } from './stage.js';
import { INSTRUMENT_IDS } from '../core/instrument.js';
import { EFFECT_IDS } from '../core/effects.js';
import { PPQ } from './midi.js';

/** How long a clip can be, in bars. A sketchpad, not an arranger. */
const LENGTHS = [1, 2, 4];

/** What each effect is called where there is room for four letters. */
const EFFECT_LABELS = {
  eq: 'EQ',
  compression: 'Comp',
  panning: 'Width',
  reverb: 'Verb',
  delay: 'Delay',
  saturation: 'Heat',
};

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/** One knob's spec, for reading a dragged value back out. */
const knobOf = (effect, id) => knobsFor(effect).find((knob) => knob.id === id) ?? { step: 0.1 };

/** An instrument's id, as a label. */
const titled = (id) => id.charAt(0).toUpperCase() + id.slice(1);

/**
 * A clip, in a few words: what is in it, not what it is called.
 *
 * The length is only said when it is not the usual one. A grid of sixteen
 * cells each ending in "· 1" is sixteen ones nobody reads.
 */
const clipSays = (clip, perBar) => {
  const bars = Math.max(1, Math.round(clip.length / perBar));
  const what = clip.notes.length ? plural(clip.notes.length, 'note', 'notes') : 'empty';
  return bars > 1 ? `${what} · ${bars} bars` : what;
};

/**
 * The line under a track's name.
 *
 * What is on it, when there is anything - a track with two inserts is worth
 * saying so about. Otherwise the instrument, but only when it is not simply
 * the name again: four tracks reading Piano/piano, Bass/bass is a second row
 * of the first one.
 */
const headSays = (track) => {
  if (track.inserts.length) {
    return track.inserts.map((id) => EFFECT_LABELS[id] ?? id).join(' · ');
  }
  return track.name.toLowerCase() === track.instrument ? '&nbsp;' : track.instrument;
};

const options = (list, chosen) => list
  .map(({ value, label }) =>
    `<option value="${value}"${String(value) === String(chosen) ? ' selected' : ''}>${label}</option>`)
  .join('');

export class SketchPage {
  constructor(el, { engine }) {
    this.el = el;
    this.engine = engine;
    this.project = loadSketch() ?? newProject();
    this.stage = null;
    this.building = null;
    this.at = null; // the slot being edited: { track, scene }
    this.frame = null;
    this.said = '';

    this.build();
    this.wire();
    this.draw();
  }

  /* --- the shell, written once --------------------------------------------- */

  build() {
    this.el.innerHTML = `
      <div class="sketch">
        <div class="sketch-head">
          <p class="eyebrow">A sketch</p>
          <div class="sketch-bar">
            <button class="submit-btn" type="button" data-play>Play</button>
            <span class="sketch-pos" data-pos>1.1</span>
            <button class="link-btn" type="button" data-stop-all>Stop the clips</button>
            <label class="field">
              <span class="field-label">Called</span>
              <input class="sketch-name" type="text" data-name maxlength="40">
            </label>
            <label class="field">
              <span class="field-label">Tempo</span>
              <input class="sketch-bpm" type="number" data-bpm min="40" max="220" step="1">
            </label>
            <label class="field">
              <span class="field-label">Key</span>
              <select data-root></select>
            </label>
            <label class="field">
              <span class="field-label">Scale</span>
              <select data-scale></select>
            </label>
          </div>
        </div>

        <div class="sketch-body">
          <div class="sketch-grid" data-grid></div>
          <div class="sketch-editor" data-editor></div>
        </div>

        <div class="sketch-foot">
          <span class="action-group">
            <button class="link-btn" type="button" data-export>Export the scene</button>
            <button class="link-btn" type="button" data-save>Save a copy</button>
            <button class="link-btn" type="button" data-open>Open one</button>
            <button class="link-btn" type="button" data-fresh>Start again</button>
            <input type="file" data-file accept="application/json,.json" hidden>
          </span>
          <span class="fine" data-said></span>
        </div>
      </div>`;

    const $ = (sel) => this.el.querySelector(sel);
    this.parts = {
      play: $('[data-play]'),
      pos: $('[data-pos]'),
      name: $('[data-name]'),
      bpm: $('[data-bpm]'),
      root: $('[data-root]'),
      scale: $('[data-scale]'),
      grid: $('[data-grid]'),
      editor: $('[data-editor]'),
      file: $('[data-file]'),
      note: $('[data-said]'),
    };

    this.parts.root.innerHTML = options(
      ROOT_NAMES.map((label, value) => ({ value, label })), this.project.key.root,
    );
    this.parts.scale.innerHTML = options(
      SCALE_IDS.map((value) => ({ value, label: SCALES[value].label })), this.project.key.scale,
    );
  }

  /* --- listeners ----------------------------------------------------------- */

  wire() {
    const { parts } = this;

    parts.play.addEventListener('click', () => this.toggle());
    this.el.querySelector('[data-stop-all]').addEventListener('click', () => {
      this.stage?.stopScene();
    });

    parts.name.addEventListener('input', () => this.change(
      setProject(this.project, { name: parts.name.value || 'Untitled' }), { quiet: true },
    ));
    parts.bpm.addEventListener('change', () => {
      const bpm = Math.max(40, Math.min(220, Number(parts.bpm.value) || this.project.bpm));
      parts.bpm.value = bpm;
      this.change(setProject(this.project, { bpm }));
    });
    parts.root.addEventListener('change', () => this.change(
      setProject(this.project, { key: { root: Number(parts.root.value) } }),
    ));
    parts.scale.addEventListener('change', () => this.change(
      setProject(this.project, { key: { scale: parts.scale.value } }),
    ));

    this.el.querySelector('[data-export]').addEventListener('click', () => this.exportScene());
    this.el.querySelector('[data-save]').addEventListener('click', () => this.saveCopy());
    this.el.querySelector('[data-open]').addEventListener('click', () => parts.file.click());
    this.el.querySelector('[data-fresh]').addEventListener('click', () => this.fresh());
    parts.file.addEventListener('change', (event) => this.openFile(event.target.files?.[0]));

    // One listener for the grid and one for the editor, because both are
    // redrawn whole and a listener per button would be a listener per redraw.
    parts.grid.addEventListener('click', (event) => this.gridClick(event));
    parts.editor.addEventListener('click', (event) => this.editorClick(event));
    // Ranges on `input` and everything else on `change`: a fader that only
    // moves when you let go of it is a fader you cannot hear yourself using.
    parts.editor.addEventListener('input', (event) => this.editorSlide(event));
    parts.editor.addEventListener('change', (event) => this.editorChange(event));
  }

  gridClick(event) {
    const mute = event.target.closest('[data-mute]');
    if (mute) {
      const index = Number(mute.dataset.mute);
      const track = trackAt(this.project, index);
      this.change(setTrack(this.project, index, { muted: !track.muted }));
      return;
    }

    const scene = event.target.closest('[data-scene-go]');
    if (scene) {
      this.launchScene(Number(scene.dataset.sceneGo));
      return;
    }

    const cell = event.target.closest('[data-cell]');
    if (cell) {
      const [track, slot] = cell.dataset.cell.split(':').map(Number);
      this.press(track, slot);
    }
  }

  editorClick(event) {
    const step = event.target.closest('[data-step]');
    if (step && this.at) {
      const [pitch, column] = step.dataset.step.split(':').map(Number);
      const clip = this.clip();
      const division = divisionOf(clip.division).ticks;
      this.change(setNotes(
        this.project, this.at.track, this.at.scene,
        toggleCell(clip, pitch, column, division), clip.length,
      ));
      return;
    }

    const insert = event.target.closest('[data-insert]');
    if (insert && this.at) {
      const id = insert.dataset.insert;
      const track = trackAt(this.project, this.at.track);
      const inserts = track.inserts.includes(id)
        ? track.inserts.filter((effect) => effect !== id)
        : [...track.inserts, id];
      this.change(setTrack(this.project, this.at.track, { inserts }));
      return;
    }

    const bars = event.target.closest('[data-bars]');
    if (bars && this.at) {
      this.change(setLength(
        this.project, this.at.track, this.at.scene,
        Number(bars.dataset.bars) * barTicks(this.project),
      ));
      return;
    }

    const grid = event.target.closest('[data-division]');
    if (grid && this.at) {
      this.change(setClip(this.project, this.at.track, this.at.scene, {
        ...this.clip(), division: grid.dataset.division,
      }));
      return;
    }

    if (event.target.closest('[data-clear]') && this.at) {
      const clip = this.clip();
      this.change(setNotes(this.project, this.at.track, this.at.scene, [], clip.length));
      return;
    }

    const row = event.target.closest('[data-row-clear]');
    if (row && this.at) {
      const clip = this.clip();
      this.change(setNotes(
        this.project, this.at.track, this.at.scene,
        clearRow(clip, Number(row.dataset.rowClear)), clip.length,
      ));
      return;
    }

    if (event.target.closest('[data-drop]') && this.at) {
      const { track, scene } = this.at;
      this.at = null;
      this.stage?.launch(track, null);
      this.change(setClip(this.project, track, scene, null));
    }
  }

  /** A range being dragged: the fader, the pan, the send, an insert's knob. */
  editorSlide(event) {
    if (!this.at) return;
    const { track } = this.at;

    const dial = event.target.closest('[data-dial]');
    if (dial) {
      this.change(setTrack(this.project, track, { [dial.dataset.dial]: Number(dial.value) }),
        { keep: true });
      return;
    }

    const knob = event.target.closest('[data-knob]');
    if (!knob) return;

    const { knob: which, effect } = knob.dataset;
    const here = trackAt(this.project, track);
    const value = Number(knob.value);

    const read = knob.parentElement.querySelector('[data-knob-read]');
    if (read) read.textContent = writeKnob(knobOf(effect, which), value);

    this.change(setTrack(this.project, track, {
      settings: {
        ...here.settings,
        [effect]: { ...(here.settings[effect] ?? {}), [which]: value },
      },
    }), { keep: true });
  }

  editorChange(event) {
    if (!this.at) return;
    const { track } = this.at;

    const pick = event.target.closest('[data-instrument]');
    if (pick) {
      this.change(setTrack(this.project, track, { instrument: pick.value }));
      return;
    }

    const name = event.target.closest('[data-track-name]');
    if (name) this.change(setTrack(this.project, track, { name: name.value || 'Track' }));
  }

  /* --- the audio ----------------------------------------------------------- */

  /**
   * The stage, built on demand.
   *
   * On demand because a browser refuses audio before a gesture and because
   * four tracks of instruments and inserts is a graph nobody looking at the
   * grid for a moment should pay for. Built once and kept, like the tools.
   */
  async ready() {
    if (this.stage) return this.stage;
    if (!this.building) {
      const ctx = this.engine.ensure();
      this.building = makeStage(ctx, this.project, { out: this.engine.out })
        .then((stage) => { this.stage = stage; return stage; });
    }
    return this.building;
  }

  async toggle() {
    const stage = await this.ready();
    if (stage.playing) {
      stage.stop();
      this.watch(false);
    } else {
      // Something has to be on, or Play is a button that does nothing. The
      // first scene with anything in it is the obvious thing to mean.
      if (!stage.state.some((row) => row.scene !== null)) {
        const first = [...Array(SCENES).keys()].find((scene) => sceneHasAnything(this.project, scene));
        if (first !== undefined) stage.launchScene(first);
      }
      stage.play();
      this.watch(true);
    }
    this.paint();
  }

  async launchScene(scene) {
    const stage = await this.ready();
    stage.launchScene(scene);
    if (!stage.playing) { stage.play(); this.watch(true); }
    this.paint();
  }

  /** A slot pressed: launch it, select it, and make one if it was empty. */
  async press(track, scene) {
    this.at = { track, scene };

    if (!clipAt(this.project, track, scene)) {
      this.change(setNotes(this.project, track, scene, [], barTicks(this.project)));
    } else {
      this.draw();
    }

    // At a phone width the panel is under the grid rather than beside it, so
    // a tap on a slot has to bring it up: filling in a form nobody can see is
    // the one way this layout could fail. `nearest` makes it a no-op when the
    // panel is already on screen, which is every desktop case.
    this.parts.editor.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

    const stage = await this.ready();
    stage.launch(track, scene);
    this.paint();
  }

  /* --- what is on screen --------------------------------------------------- */

  clip() { return this.at ? clipAt(this.project, this.at.track, this.at.scene) : null; }

  /**
   * The project changed: keep it, tell the stage, redraw.
   *
   * `keep` is for a control that is being dragged - a fader - where redrawing
   * the panel under the finger would take the finger off it.
   */
  change(next, { quiet = false, keep = false } = {}) {
    this.project = next;
    saveSketch(next);
    this.stage?.setProject(next);
    if (keep) { this.paint(); return; }
    if (quiet) return;
    this.draw();
  }

  draw() {
    const { parts, project } = this;

    if (parts.name.value !== project.name) parts.name.value = project.name;
    if (Number(parts.bpm.value) !== project.bpm) parts.bpm.value = project.bpm;
    parts.root.value = String(project.key.root);
    parts.scale.value = project.key.scale;

    this.drawGrid();
    this.drawEditor();
    this.paint();
    parts.note.textContent = this.said;
  }

  drawGrid() {
    const { project } = this;
    const perBar = barTicks(project);

    const heads = project.tracks.map((track, index) => `
      <div class="grid-track">
        <span class="track-name">${track.name}</span>
        <span class="track-what">${headSays(track)}</span>
        <button class="track-mute" type="button" data-mute="${index}"
                aria-pressed="${track.muted}" title="Mute ${track.name}">M</button>
      </div>`).join('');

    const rows = project.scenes.map((scene, index) => `
      <button class="scene-launch" type="button" data-scene-go="${index}"
              title="Launch the whole of scene ${scene.name}">${scene.name}</button>
      ${project.tracks.map((track, column) => {
        const clip = clipAt(project, column, index);
        return `
          <button class="cell" type="button" data-cell="${column}:${index}" data-full="${Boolean(clip)}">
            <span class="cell-what">${clip ? clipSays(clip, perBar) : '+'}</span>
          </button>`;
      }).join('')}`).join('');

    this.parts.grid.style.setProperty('--tracks', project.tracks.length);
    this.parts.grid.innerHTML = `<span class="grid-corner"></span>${heads}${rows}`;
  }

  drawEditor() {
    const clip = this.clip();

    if (!clip) {
      this.parts.editor.innerHTML = `
        <p class="editor-empty">
          Tap a slot to put a clip in it. Scenes are the rows: everything in one
          row plays together, and the number on the left launches the lot.
        </p>`;
      return;
    }

    const { track: index, scene } = this.at;
    const track = trackAt(this.project, index);
    const step = divisionOf(clip.division).ticks;
    const wide = columnsOf(clip, step);
    const on = filled(clip, step);
    const bars = Math.max(1, Math.round(clip.length / barTicks(this.project)));
    const beat = PPQ / step;

    const rows = rowsFor(track, this.project.key).map((row) => `
      <button class="step-name${row.root ? ' is-root' : ''}" type="button"
              data-row-clear="${row.pitch}" title="Clear ${row.label}">${row.label}</button>
      ${Array.from({ length: wide }, (_, column) => `
        <button class="step" type="button" data-step="${row.pitch}:${column}"
                data-on="${on.has(`${row.pitch}:${column}`)}"
                data-beat="${column % beat === 0}"
                aria-label="${row.label}, step ${column + 1}"></button>`).join('')}`).join('');

    this.parts.editor.innerHTML = `
      <div class="editor-head">
        <p class="eyebrow">The clip</p>
        <h3 class="editor-title">${track.name} · scene ${this.project.scenes[scene].name}</h3>
        <div class="editor-row">
          <span class="editor-label">Bars</span>
          <span class="chips">
            ${LENGTHS.map((count) => `
              <button class="chip" type="button" data-bars="${count}"
                      aria-pressed="${count === bars}">${count}</button>`).join('')}
          </span>
        </div>
        <div class="editor-row">
          <span class="editor-label">Grid</span>
          <span class="chips">
            ${STEP_DIVISIONS.map((division) => `
              <button class="chip" type="button" data-division="${division.id}"
                      aria-pressed="${division.id === clip.division}">${division.label}</button>`).join('')}
          </span>
        </div>
      </div>

      <div class="steps" style="--cols: ${wide}">${rows}</div>

      <div class="editor-row editor-outs">
        <button class="link-btn" type="button" data-clear>Clear the clip</button>
        <button class="link-btn" type="button" data-drop>Take the clip out</button>
      </div>

      <div class="editor-track">
        <p class="eyebrow">The track it is on</p>
        <div class="editor-row">
          <label class="field">
            <span class="field-label">Called</span>
            <input class="track-rename" type="text" data-track-name value="${track.name}" maxlength="18">
          </label>
          <label class="field">
            <span class="field-label">Instrument</span>
            <select data-instrument>
              ${options(INSTRUMENT_IDS.map((id) => ({ value: id, label: titled(id) })), track.instrument)}
            </select>
          </label>
        </div>

        <div class="editor-row">
          <span class="editor-label">Inserts</span>
          <span class="chips">
            ${EFFECT_IDS.map((id) => `
              <button class="chip" type="button" data-insert="${id}"
                      aria-pressed="${track.inserts.includes(id)}">${EFFECT_LABELS[id] ?? id}</button>`).join('')}
          </span>
        </div>

        ${track.inserts.map((effect) => {
          // Through `tidy`, not straight off the track: an insert just
          // switched on has nothing stored yet, and reading a missing value
          // as the knob's minimum drew every control at the bottom of its
          // range while the effect itself ran at its defaults.
          const set = tidy(effect, track.settings[effect]);
          return `
          <div class="insert">
            <span class="insert-name">${EFFECT_LABELS[effect] ?? effect}</span>
            <div class="insert-knobs">
              ${knobsFor(effect).map((knob) => {
                const value = set[knob.id];
                return `
                  <label class="knob">
                    <span class="knob-label">${knob.label}</span>
                    <input type="range" data-knob="${knob.id}" data-effect="${effect}"
                           min="${knob.min}" max="${knob.max}" step="${knob.step}" value="${value}">
                    <span class="knob-read" data-knob-read>${writeKnob(knob, value)}</span>
                  </label>`;
              }).join('')}
            </div>
          </div>`;
        }).join('')}

        <div class="editor-row editor-dials">
          ${[
            { id: 'gain', label: 'Level', min: 0, max: 1.2, step: 0.01 },
            { id: 'pan', label: 'Pan', min: -1, max: 1, step: 0.02 },
            { id: 'send', label: 'Room', min: 0, max: 1, step: 0.02 },
          ].map((dial) => `
            <label class="field">
              <span class="field-label">${dial.label}</span>
              <input type="range" data-dial="${dial.id}" min="${dial.min}" max="${dial.max}"
                     step="${dial.step}" value="${track[dial.id]}">
            </label>`).join('')}
        </div>
      </div>`;
  }

  /**
   * The parts that change while the clock runs: which cell is playing, which
   * is waiting for a bar line, and where the bar line is.
   *
   * Attributes only. A redraw here would replace the button under the finger
   * sixty times a second.
   */
  paint() {
    const stage = this.stage;
    const state = stage?.state ?? [];

    for (const cell of this.parts.grid.querySelectorAll('[data-cell]')) {
      const [track, scene] = cell.dataset.cell.split(':').map(Number);
      const here = state[track];
      const chosen = this.at && this.at.track === track && this.at.scene === scene;

      cell.dataset.live = String(Boolean(stage?.playing) && here?.scene === scene);
      cell.dataset.queued = String(here?.next?.scene === scene);
      cell.dataset.chosen = String(Boolean(chosen));
    }

    this.parts.play.textContent = stage?.playing ? 'Stop' : 'Play';
    this.parts.pos.textContent = stage?.playing ? this.where(stage) : '1.1';
  }

  /** Bar and beat, counting from one, which is how everybody says it. */
  where(stage) {
    const beats = Math.max(1, this.project.beats);
    const beat = Math.floor((stage.tick % stage.transport.perBar) / PPQ) + 1;
    return `${stage.bar}.${Math.min(beats, beat)}`;
  }

  /** The repaint loop, on only while something is moving. */
  watch(on) {
    if (on && !this.frame) {
      const step = () => {
        if (!this.stage?.playing) { this.frame = null; this.paint(); return; }
        this.paint();
        this.frame = requestAnimationFrame(step);
      };
      this.frame = requestAnimationFrame(step);
      return;
    }
    if (!on && this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
    }
  }

  /* --- in and out ---------------------------------------------------------- */

  tell(line) {
    this.said = line;
    this.parts.note.textContent = line;
  }

  exportScene() {
    const scene = this.at?.scene
      ?? [...Array(SCENES).keys()].find((index) => sceneHasAnything(this.project, index))
      ?? 0;

    if (!sceneHasAnything(this.project, scene)) {
      this.tell('There is nothing in that scene yet.');
      return;
    }

    const bytes = sceneToMidi(this.project, scene, { bars: 4 });
    const name = `${this.project.name.replace(/[^\w-]+/g, '-').toLowerCase() || 'sketch'}-scene-${scene + 1}.mid`;
    this.give(new Blob([bytes], { type: 'audio/midi' }), name);

    const parts = sceneOf(this.project, scene).length;
    this.tell(`Saved ${plural(parts, 'track', 'tracks')} as ${name} — four bars at ${this.project.bpm} bpm.`);
  }

  saveCopy() {
    const file = sketchFile(this.project);
    this.give(new Blob([file.text], { type: 'application/json' }), file.name);
    this.tell(`Saved this sketch as ${file.name}.`);
  }

  async openFile(file) {
    if (!file) return;
    const next = readSketchFile(await file.text());
    this.parts.file.value = '';

    if (!next) {
      this.tell('That file is not a sketch this version can open.');
      return;
    }

    this.at = null;
    this.stage?.stopScene();
    this.change(next);
    this.tell(`Opened ${file.name}.`);
  }

  fresh() {
    this.at = null;
    this.stage?.stop();
    this.watch(false);
    this.change(newProject());
    this.tell('A new sketch. The old one is gone from this browser.');
  }

  /**
   * A file, handed over.
   *
   * The URL is not revoked on the next line: some browsers have not started
   * the download by then, and a revoked URL is a download that silently
   * fails. The same bargain the progress export makes.
   */
  give(blob, name) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 20000);
  }

  /* --- the view's own lifecycle -------------------------------------------- */

  show() {
    this.draw();
    if (this.stage?.playing) this.watch(true);
  }

  /** Left for another view: the clock stops, because it is not background music. */
  hide() {
    this.watch(false);
    this.stage?.stop();
    this.paint();
  }

  destroy() {
    this.watch(false);
    this.stage?.destroy();
    this.stage = null;
  }
}
