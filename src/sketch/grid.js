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
  clipAt, trackAt, sceneOf, sceneHasAnything, barTicks, sceneToMidi, isTake, setFit,
  clipKindOf, setKind, setTrim, takeWindow, setNudge, MOST_NUDGE, trimStep,
  setFade, fadeAt, fadeSlide, fadeFor, saidFade,
  addScene, dropScene, MOST_SCENES, setFollow, MOST_PASSES,
  addTrack, dropTrack, MOST_TRACKS, moveInsert,
} from './project.js';
import {
  STEP_DIVISIONS, divisionOf, SCALES, SCALE_IDS, ROOT_NAMES,
  rowsFor, columnsOf, filled, toggleCell, clearRow, columnOf, pitchName,
} from './steps.js';
import { loadSketch, saveSketch, sketchFile, readSketchFile } from './store.js';
import { knobsFor, writeKnob, tidy, optionsFor, fromTone } from './knobs.js';
import { insertPlayer } from './insert.js';
import { EQPlugin } from '../plugins/eq/plugin.js';
import { CompPlugin } from '../plugins/compressor/plugin.js';
import { HeatPlugin } from '../plugins/saturation/plugin.js';
import { StereoPlugin } from '../plugins/stereo/plugin.js';
import { EchoPlugin } from '../plugins/delay/plugin.js';
import { VerbPlugin } from '../plugins/reverb/plugin.js';
import { tapInto, drift, timing } from './tap.js';
import { nextBar } from './transport.js';
import { waveOf, rescaleWave, spreadWave, WAVE_COLUMNS } from '../lib/wave.js';
import { readyCanvas, watchSize } from '../lib/panel.js';
import { peakAt, fallenTo, clockOf, PEAK_FLOOR, PEAK_HOT } from '../lib/meter.js';
import { floorOf, saidFloor } from '../lib/loudness.js';
import {
  Recorder, canRecord, barsFor, fitTo, loudestIn, SILENCE,
  ticksFor, freeSeconds, MOST_SECONDS, saidLength, barSeconds, oversIn,
  inputsOf, saidInput, PROCESSING_SAYS, COUNT_INS,
} from './record.js';
import {
  takeId, putTake, loadTake, dropTake, sweepTakes,
} from './takes.js';

/**
 * The notes a recording may be said to sound at.
 *
 * Five octaves either side of middle C rather than all 128: the root is what
 * a hummed line or a plucked string already sounds at, and nothing anybody
 * records is at the very bottom or top of a MIDI keyboard. A shorter list is
 * a select somebody can actually find their note in.
 */
const SAMPLE_NOTES = Array.from({ length: 61 }, (_, i) => i + 30);
import { KIT_ROWS } from './steps.js';
import { makeStage } from './stage.js';
import { zipStems } from './stems.js';
import { INSTRUMENT_IDS, isMic } from '../core/instrument.js';
import { rootOf, rootSaid } from '../lib/root.js';
import { EFFECT_IDS } from '../core/effects.js';
import { PPQ } from './midi.js';

/**
 * The six interfaces, by the ids their effects already go under.
 *
 * Every one of them takes `player`, so every one of them can be pointed at
 * an insert in a track's chain instead of at a loop of its own.
 */
const PLUGINS = {
  eq: EQPlugin,
  compression: CompPlugin,
  saturation: HeatPlugin,
  panning: StereoPlugin,
  delay: EchoPlugin,
  reverb: VerbPlugin,
};

/** How long a clip can be, in bars. A sketchpad, not an arranger. */
const LENGTHS = [1, 2, 4];

/**
 * How far a finger may drift and still be holding still, in CSS pixels.
 *
 * Ten, which is roughly a millimetre on a phone: enough that nobody holding
 * a cell has to hold it like a clamp, and short enough that a deliberate
 * drag up the grid still cancels. The press used to cancel on any movement
 * at all, which meant it never fired for a real hand - three pixels of drift
 * over half a second is somebody holding still, and it read as a drag.
 */
const HOLD_SLOP = 10;

/**
 * How far an arrow key moves a trim handle, in seconds.
 *
 * (Named for the edge rather than the trim because `plugins/level/gain.js`
 * already has a `TRIM_STEP`, about a gain trim. The artifact build refuses
 * two modules declaring one top-level name, which is how that was found.)
 *
 * Fifty milliseconds, which is about two and a half pixels of a desktop
 * waveform - fine enough to place an edge against a transient and coarse
 * enough that crossing a ten-second take does not take two hundred presses.
 * Shift is ten times that, for getting across one.
 */
const EDGE_STEP = 0.05;
const EDGE_COARSE = 0.5;

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

/** What a follow action does, in a word and in a glyph. */
const FOLLOW_SAYS = { next: 'the next one', first: 'back to scene 1', stop: 'stop' };
const FOLLOW_MARK = { next: '→', first: '↺', stop: '■' };

/** A number, without the trailing zeroes nobody reads. */
const trim = (value) => String(Number(value.toFixed(2)));

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
const clipSays = (clip, perBar, perBarSeconds = 0) => {
  const bars = Math.max(1, Math.round(clip.length / perBar));
  // A recording first, because a clip holding one has no notes to count and
  // counting them said "empty". Which is what the grid read after every
  // recording ever made in this app: the panel said "2 bars recorded" and
  // the cell beside it said the cell was empty, in the same breath. The one
  // place a person looks to see whether it worked was the one place saying
  // it had not.
  // "take" rather than "recording", which is the word the rest of this file
  // uses anyway and the only one of the two that fits: a cell is about seven
  // characters wide and "recording · 5s" came out as "recording…", which is
  // a cell saying nothing again by a different route.
  const what = isTake(clip) ? 'take'
    : clip.notes.length ? plural(clip.notes.length, 'note', 'notes') : 'empty';

  // A take kept at its own length is measured in seconds, not bars. Rounding
  // it to bars to print it is how a six-second take comes to read "2 bars" -
  // true of the number in the clip and not of anything a person played.
  if (isTake(clip) && clip.fit === 'free' && perBarSeconds > 0) {
    return `${what} · ${Math.round((clip.length / perBar) * perBarSeconds)}s`;
  }
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
    // What is open on top of the grid: nothing, a clip, or a track. On a
    // phone the open thing replaces the grid; where there is room it sits
    // beside it. One piece of state either way, and the width decides the
    // placement rather than the code.
    this.open = null; // null | { kind: 'clip', track, scene } | { kind: 'track', track }
    this.frame = null;
    this.said = '';
    // A take's drawn shape, summarised once and kept. Cleared for one id
    // when that id is recorded over, so the picture never belongs to a take
    // that is gone.
    this.peaks = new Map();
    // The inputs this browser offers. Empty until the microphone has been
    // allowed once, because a browser will not say what hardware is attached
    // before that - so the picker appears after a first take rather than
    // before one, and there is nothing to be done about that.
    this.inputs = [];
    // What the root detector last reported, which belongs to the panel and
    // not to the project: it is a reading of a recording, and reopening the
    // sketch should not bring back a sentence about a button nobody pressed.
    this.heard = '';
    // Whether a pad press is being written down as well as heard, and the
    // run of how far out the last few were.
    this.arming = false;
    this.taps = [];
    // The microphone, opened on first use and kept; and the recordings this
    // sketch can play, by id, shared with the stage so it reads them live.
    this.mic = null;
    // The plugin interface currently open on an insert, if any. One at a
    // time: each holds an analyser, and eight of them reading FFTs for
    // pages nobody is looking at is a sketchpad that gets slower the more
    // you work on it.
    this.plugin = null;
    this.mounted = null;
    // A clip the grid is offering to take out: `track:scene`, set by a long
    // press and cleared by anything else. Taking a clip out belongs here
    // rather than inside the clip, where it was a destructive button sitting
    // next to the controls you use all the time.
    this.removing = null;
    // Whether the clip's set-up is folded away. Folded by default: not one
    // of those controls is touched while notes are going in, and four rows
    // of them above the grid is most of a phone screen spent on settings.
    this.setupOpen = false;
    this.held = null;
    this.recording = false;
    this.takes = new Map();

    this.build();
    this.wire();
    this.draw();
  }

  /* --- the shell, written once --------------------------------------------- */

  build() {
    this.el.innerHTML = `
      <div class="sketch">
        <div class="sketch-bar">
          <span class="bar-left">
            <button class="submit-btn" type="button" data-play>Play</button>
            <span class="sketch-pos" data-pos>1.1</span>
            <label class="sketch-tempo">
              <input class="sketch-bpm" type="number" data-bpm min="40" max="220" step="1">
              <span>bpm</span>
            </label>
          </span>
          <span class="sketch-called" data-called></span>
          <button class="menu-btn" type="button" data-menu aria-label="This sketch">☰</button>
        </div>

        <div class="sketch-body">
          <div class="grid-scroll"><div class="sketch-grid" data-grid></div></div>
          <div class="sketch-editor" data-editor></div>
        </div>

        <p class="fine sketch-said" data-said></p>
      </div>

      <dialog class="sketch-menu" data-sheet>
        <div class="dialog-head">
          <div>
            <div class="bar-label">This sketch</div>
            <div class="dialog-title" data-menu-title>Untitled</div>
          </div>
          <button class="close-btn" type="button" data-shut aria-label="Close">&times;</button>
        </div>

        <div class="dialog-body">
          <div class="editor-row">
            <label class="field">
              <span class="field-label">Called</span>
              <input class="sketch-name" type="text" data-name maxlength="40">
            </label>
          </div>

          <h3 class="subhead">Out of here</h3>
          <div class="menu-outs">
            <button class="link-btn" type="button" data-export>Export the scene as MIDI</button>
            <button class="link-btn" type="button" data-stems>Export the stems</button>
            <button class="link-btn" type="button" data-save>Save a copy of the sketch</button>
            <button class="link-btn" type="button" data-open>Open one</button>
            <button class="link-btn" type="button" data-fresh>Start again</button>
            <input type="file" data-file accept="application/json,.json" hidden>
          </div>

          <p class="fine" data-menu-said></p>

          <div class="dialog-actions">
            <span></span>
            <button class="submit-btn" type="button" data-shut>Done</button>
          </div>
        </div>
      </dialog>`;

    const $ = (sel) => this.el.querySelector(sel);
    this.parts = {
      play: $('[data-play]'),
      pos: $('[data-pos]'),
      name: $('[data-name]'),
      bpm: $('[data-bpm]'),
      called: $('[data-called]'),
      menu: $('[data-sheet]'),
      menuTitle: $('[data-menu-title]'),
      menuSaid: $('[data-menu-said]'),
      body: $('.sketch-body'),
      grid: $('[data-grid]'),
      editor: $('[data-editor]'),
      file: $('[data-file]'),
      note: $('[data-said]'),
    };

  }

  /* --- listeners ----------------------------------------------------------- */

  wire() {
    const { parts } = this;

    this.watchWave();
    parts.play.addEventListener('click', () => this.toggle());

    this.el.querySelector('[data-menu]').addEventListener('click', () => {
      parts.menuTitle.textContent = this.project.name || 'Untitled';
      parts.menuSaid.textContent = this.said;
      parts.menu.showModal();
    });
    for (const shut of this.el.querySelectorAll('[data-shut]')) {
      shut.addEventListener('click', () => parts.menu.close());
    }
    parts.menu.addEventListener('click', (event) => {
      if (event.target === parts.menu) parts.menu.close();
    });

    parts.name.addEventListener('input', () => this.change(
      setProject(this.project, { name: parts.name.value || 'Untitled' }), { quiet: true },
    ));
    parts.bpm.addEventListener('change', () => {
      const bpm = Math.max(40, Math.min(220, Number(parts.bpm.value) || this.project.bpm));
      parts.bpm.value = bpm;
      this.change(setProject(this.project, { bpm }));
    });

    this.el.querySelector('[data-export]').addEventListener('click', () => this.exportScene());
    this.el.querySelector('[data-stems]').addEventListener('click', () => this.exportStems());
    this.el.querySelector('[data-save]').addEventListener('click', () => this.saveCopy());
    this.el.querySelector('[data-open]').addEventListener('click', () => parts.file.click());
    this.el.querySelector('[data-fresh]').addEventListener('click', () => this.fresh());
    parts.file.addEventListener('change', (event) => this.openFile(event.target.files?.[0]));

    // One listener for the grid and one for the editor, because both are
    // redrawn whole and a listener per button would be a listener per redraw.
    parts.grid.addEventListener('click', (event) => this.gridClick(event));

    // A long press on a clip offers to take it out. Long press rather than a
    // button on every cell, because twenty cells with a cross in the corner
    // is twenty chances to delete a part while reaching for it - and it asks
    // before it acts, so the gesture never destroys anything on its own.
    parts.grid.addEventListener('pointerdown', (event) => {
      // Every press starts clean. `asked` has to be cleared here rather than
      // on the click, because a press by a mouse produces no click at all -
      // `drawGrid` replaces the cell mid-press, so there is no element the
      // down and the up share - and a flag left standing would swallow the
      // next real tap instead of the one it was set for.
      this.asked = false;

      const cell = event.target.closest('[data-cell]');
      if (!cell || cell.dataset.full !== 'true') return;

      this.heldAt = { x: event.clientX, y: event.clientY };
      this.held = setTimeout(() => {
        this.held = null;
        this.removing = cell.dataset.cell;
        // The press that asks must not also answer. On touch the browser
        // synthesises a click when the finger lifts, and that click used to
        // land on the branch that takes the clip out - so a long press
        // deleted on release with nothing confirmed, and the tap meant to
        // confirm it landed on an empty cell and put a fresh clip there. The
        // cell still looked full and the gesture read as doing nothing, when
        // it had in fact done everything, twice.
        this.asked = true;
        this.drawGrid();
        this.paint();
      }, 500);
    });

    // A finger is not a clamp. Cancelling on any movement at all meant the
    // press never fired for a real hand: three pixels of drift over half a
    // second is somebody holding still, and it read as somebody dragging.
    parts.grid.addEventListener('pointermove', (event) => {
      if (!this.held || !this.heldAt) return;
      const far = Math.hypot(event.clientX - this.heldAt.x, event.clientY - this.heldAt.y);
      if (far > HOLD_SLOP) { clearTimeout(this.held); this.held = null; }
    });
    for (const done of ['pointerup', 'pointercancel', 'pointerleave']) {
      parts.grid.addEventListener(done, () => {
        if (this.held) { clearTimeout(this.held); this.held = null; }
      });
    }
    // Dragging a trim handle. On the editor rather than on the handles,
    // because the panel is rebuilt from a string and a listener on a handle
    // would be a listener on an element that has already been replaced.
    parts.editor.addEventListener('pointerdown', (event) => {
      const grab = event.target.closest('[data-grab]');
      if (!grab) return;
      // The pointer is captured so the drag survives the finger leaving the
      // handle, which it does immediately - a handle is a few pixels wide and
      // a trim is most of the panel.
      grab.setPointerCapture?.(event.pointerId);
      this.grabbing = grab.dataset.grab;
      event.preventDefault();
    });
    parts.editor.addEventListener('pointermove', (event) => {
      if (this.grabbing) this.dragTrim(event);
    });
    for (const done of ['pointerup', 'pointercancel']) {
      parts.editor.addEventListener(done, () => {
        if (!this.grabbing) return;
        this.grabbing = null;
        // Written to the project on release rather than on every move: a drag
        // is sixty changes a second and each one would be an undo step and a
        // save.
        this.commitTrim();
      });
    }

    // And by key, because a handle that can only be dragged is a handle
    // nobody without a pointer can use. It took focus and did nothing: arrow
    // keys inert, Enter inert, announced as a button with no value.
    parts.editor.addEventListener('keydown', (event) => {
      const grab = event.target.closest('[data-grab]');
      if (!grab) return;

      const clip = this.clip();
      const whole = this.takes.get(clip?.take)?.duration ?? 0;
      if (!(whole > 0)) return;

      // Fine by default and coarse with shift, which is the way round every
      // other control in this app works and the way round somebody trimming
      // wants: the small move is the one made most often.
      const step = event.shiftKey ? EDGE_COARSE : EDGE_STEP;
      const by = { ArrowLeft: -step, ArrowRight: step, ArrowDown: -step, ArrowUp: step }[event.key];

      let next = null;
      if (by !== undefined) next = trimStep(clip.trim, whole, grab.dataset.grab, by);
      else if (event.key === 'Home') next = trimStep(clip.trim, whole, grab.dataset.grab, -whole);
      else if (event.key === 'End') next = trimStep(clip.trim, whole, grab.dataset.grab, whole);
      if (!next) return;

      event.preventDefault();
      this.dragged = next;
      this.commitTrim();
      // Focus follows the handle through the redraw, or one arrow key is all
      // anybody gets before the panel takes the control out from under them.
      this.parts.editor.querySelector(`[data-grab="${grab.dataset.grab}"]`)?.focus();
    });

    parts.editor.addEventListener('click', (event) => this.editorClick(event));
    // Ranges on `input` and everything else on `change`: a fader that only
    // moves when you let go of it is a fader you cannot hear yourself using.
    parts.editor.addEventListener('input', (event) => this.editorSlide(event));
    parts.editor.addEventListener('change', (event) => this.editorChange(event));
  }

  gridClick(event) {
    if (event.target.closest('[data-add-track]')) {
      const next = addTrack(this.project);
      if (next === this.project) return;
      // Straight into its panel, because the thing to do with a new track
      // is say what it is, and that is where it is said.
      this.open = { kind: 'track', track: next.tracks.length - 1 };
      this.change(next);
      this.tell('A track. Say what it is.');
      return;
    }

    if (event.target.closest('[data-drop-track]')) {
      const next = dropTrack(this.project);
      if (next === this.project) return;
      if (this.open?.track >= next.tracks.length) this.open = null;
      this.change(next);
      return;
    }

    const mute = event.target.closest('[data-mute]');
    if (mute) {
      const index = Number(mute.dataset.mute);
      const track = trackAt(this.project, index);
      this.change(setTrack(this.project, index, { muted: !track.muted }));
      return;
    }

    const open = event.target.closest('[data-open-track]');
    if (open) {
      this.open = { kind: 'track', track: Number(open.dataset.openTrack) };
      this.draw();
      this.parts.editor.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return;
    }

    if (event.target.closest('[data-add-scene]')) {
      this.change(addScene(this.project));
      // Straight to the new one, which is off the right-hand edge and the
      // whole reason it scrolls.
      this.parts.grid.parentElement?.scrollTo({
        left: this.parts.grid.scrollWidth, behavior: 'smooth',
      });
      return;
    }

    if (event.target.closest('[data-drop-scene]')) {
      const gone = dropScene(this.project);
      if (gone === this.project) { this.tell('There is still a clip in that scene.'); return; }
      if (this.open?.scene >= gone.scenes.length) this.open = null;
      this.change(gone);
      return;
    }

    const scene = event.target.closest('[data-scene-go]');
    if (scene) {
      this.launchScene(Number(scene.dataset.sceneGo));
      return;
    }

    const cell = event.target.closest('[data-cell]');
    if (!cell) { this.unask(); return; }

    // The click the asking press itself produced. Swallowed, so that letting
    // go of a long press leaves the question on screen rather than answering
    // it - see the `pointerdown` handler for what this cost.
    if (this.asked) { this.asked = false; return; }

    // The second tap of a long press, which is the one that acts.
    if (this.removing === cell.dataset.cell) {
      const [track, slot] = cell.dataset.cell.split(':').map(Number);
      this.removing = null;
      if (this.open?.track === track && this.open?.scene === slot) this.open = null;
      this.stage?.launch(track, null);
      this.change(setClip(this.project, track, slot, null));
      this.tell('Taken out.');
      return;
    }

    if (this.removing) { this.unask(); return; }

    const [track, slot] = cell.dataset.cell.split(':').map(Number);
    this.press(track, slot);
  }

  editorClick(event) {
    if (event.target.closest('[data-back]')) {
      this.open = null;
      this.draw();
      return;
    }

    const toTrack = event.target.closest('[data-to-track]');
    if (toTrack) {
      this.open = { kind: 'track', track: Number(toTrack.dataset.toTrack) };
      this.draw();
      return;
    }

    const pad = event.target.closest('[data-pad]');
    if (pad) { this.hitPad(Number(pad.dataset.pad)); return; }

    if (event.target.closest('[data-arm]') && this.at) {
      this.arming = !this.arming;
      this.taps = [];
      event.target.closest('[data-arm]').setAttribute('aria-pressed', String(this.arming));
      this.sayTap(this.arming
        ? 'Armed. Press play and tap — every hit lands on the nearest line of the grid.'
        : '');
      return;
    }

    const step = event.target.closest('[data-step]');
    if (step && this.at) {
      const [pitch, column] = step.dataset.step.split(':').map(Number);
      const clip = this.clip();
      const division = divisionOf(clip.division).ticks;
      const notes = toggleCell(clip, pitch, column, division);
      const on = notes.length > (clip.notes?.length ?? 0);

      // Heard, not just drawn. Somebody sketching knows the sound they are
      // after and not that it is called B flat, so a grid that only lights
      // up is a grid you have to decode - and the note a tap just put down
      // is the one thing nobody should have to press play to hear. Only on
      // the way in: taking a note out should not play it.
      if (on) this.sound(pitch);

      // One attribute, not a redraw. Rebuilding the panel replaced every
      // step button on the page - nine hundred and sixty of them on a
      // four-bar clip in sixteenths - which cost several milliseconds a tap
      // and, worse, destroyed the button under the finger while the finger
      // was still on it. Measured before this: every one of twelve taps
      // rebuilt the whole grid, at 7.2 ms a tap on a desktop.
      step.dataset.on = String(on);
      this.change(setNotes(
        this.project, this.at.track, this.at.scene,
        notes, clip.length,
      ), { keep: true });
      this.markCell(this.at.track, this.at.scene);
      return;
    }

    const plugin = event.target.closest('[data-open-plugin]');
    if (plugin && this.owning !== null) {
      this.open = { kind: 'plugin', track: this.owning, effect: plugin.dataset.openPlugin };
      this.draw();
      return;
    }

    // Before the insert chips, because a move button lives inside an insert
    // row and the chips are the row above - two different questions that
    // would otherwise both be answered by whichever closest() ran first.
    const move = event.target.closest('[data-move]');
    if (move && this.owning !== null) {
      this.change(moveInsert(
        this.project, this.owning, move.dataset.move, Number(move.dataset.by),
      ));
      return;
    }

    const heard = event.target.closest('[data-sample-hear]');
    if (heard && this.owning !== null) {
      this.workOutRoot(this.owning);
      return;
    }

    const hold = event.target.closest('[data-sample-hold]');
    if (hold && this.owning !== null) {
      const sample = this.project.tracks[this.owning].sample;
      this.change(setTrack(this.project, this.owning, {
        sample: { ...sample, hold: !sample.hold },
      }));
      return;
    }

    const insert = event.target.closest('[data-insert]');
    if (insert && this.owning !== null) {
      const id = insert.dataset.insert;
      const track = trackAt(this.project, this.owning);
      const inserts = track.inserts.includes(id)
        ? track.inserts.filter((effect) => effect !== id)
        : [...track.inserts, id];
      this.change(setTrack(this.project, this.owning, { inserts }));
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

    const passes = event.target.closest('[data-passes]');
    if (passes && this.at) {
      const count = Number(passes.dataset.passes);
      this.change(setFollow(this.project, this.at.track, this.at.scene,
        count ? { after: count, then: this.clip().follow?.then ?? 'next' } : null));
      return;
    }

    const then = event.target.closest('[data-then]');
    if (then && this.at) {
      const was = this.clip().follow;
      this.change(setFollow(this.project, this.at.track, this.at.scene,
        { after: was?.after ?? 1, then: then.dataset.then }));
      return;
    }

    const grid = event.target.closest('[data-division]');
    if (grid && this.at) {
      this.change(setClip(this.project, this.at.track, this.at.scene, {
        ...this.clip(), division: grid.dataset.division,
      }));
      return;
    }

    const nudge = event.target.closest('[data-nudge]');
    if (nudge && this.at) {
      const ticks = Number(nudge.dataset.nudge);
      this.change(setNudge(this.project, this.at.track, this.at.scene, ticks));
      this.tell(ticks === 0
        ? 'Back on the line.'
        : `${Math.abs(ticks)} ticks ${ticks < 0 ? 'early' : 'late'}.`
          + (ticks < 0 ? ' A loop moves every pass; a one-shot only its later ones.' : ''));
      return;
    }

    if (event.target.closest('[data-untrim]') && this.at) {
      this.change(setTrim(this.project, this.at.track, this.at.scene, null));
      this.tell('Back to the whole take — nothing was ever thrown away.');
      return;
    }

    const countIn = event.target.closest('[data-countin]');
    if (countIn) {
      this.countIn = Number(countIn.dataset.countin);
      this.drawPanel();
      this.tell(this.countIn
        ? `${plural(this.countIn, 'bar', 'bars')} of count-in, then the take begins.`
        : 'The take begins on the next bar line.');
      return;
    }

    const kind = event.target.closest('[data-kind]');
    if (kind && this.at) {
      const want = kind.dataset.kind;
      const track = trackAt(this.project, this.at.track);
      // Back to null when the choice matches what the track is for, so a clip
      // that was never steered does not carry an override that says nothing.
      const fallback = isMic(track.instrument) ? 'mic' : 'notes';
      this.change(setKind(this.project, this.at.track, this.at.scene,
        want === fallback ? null : want));
      this.tell(want === 'mic'
        ? 'This slot is for a recording. Press record when you are ready.'
        : 'This slot is for notes. Draw them in, or play them in.');
      return;
    }

    const fit = event.target.closest('[data-fit]');
    if (fit && this.at) {
      const want = fit.dataset.fit;
      const clip = this.clip();

      // Before there is a take, this is a choice about the next one and lives
      // on the grid. Once there is one, it is a property of that clip and
      // lives in the project, so it saves with the sketch.
      if (!isTake(clip)) {
        this.keepFree = want === 'free';
        this.draw();
        return;
      }

      // The stored take is whole in both modes, so this is a switch and not a
      // decision: what changes is the length the clip claims and therefore
      // where the stage stops the source.
      const buffer = this.takes.get(clip.take);
      const seconds = buffer?.duration ?? 0;
      const length = want === 'free'
        ? ticksFor(seconds, this.project.bpm, this.project.beats, this.project.value)
        : barsFor(seconds, this.project.bpm, this.project.beats, this.project.value)
          * barTicks(this.project);

      this.change(setFit(this.project, this.at.track, this.at.scene, want, length));
      this.tell(want === 'free'
        ? `Kept at its own length — ${saidLength(seconds)}, played once when the scene starts.`
        : 'Looping on the bar line. Everything you played is still stored, so you can '
          + 'put it back to its own length whenever.');
      return;
    }

    if (event.target.closest('[data-mic]')) { this.record(); return; }

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

  }

  /** A range being dragged: the fader, the pan, the send, an insert's knob. */
  /** Which track the panel's controls belong to, clip panel or track panel. */
  get owning() {
    if (this.open?.kind === 'track') return this.open.track;
    return this.at ? this.at.track : null;
  }

  editorSlide(event) {
    // Before the guard below: this one belongs to a clip panel, which has no
    // owning track, so reading `this.owning` first would drop every one.
    const fade = event.target.closest('[data-fade]');
    if (fade && this.at) {
      const edge = fade.dataset.fade;
      const seconds = fadeAt(Number(fade.value));
      const read = fade.parentElement.querySelector('[data-fade-read]');
      // Written straight to the readout rather than through a redraw: the
      // panel is rebuilt from a string, and rebuilding it under a finger
      // that is still dragging takes the slider out from under it.
      if (read) read.textContent = saidFade(seconds);
      fade.setAttribute('aria-label',
        `${edge === 'in' ? 'Fade in' : 'Fade out'}, ${saidFade(seconds)}`);
      this.change(setFade(this.project, this.at.track, this.at.scene, { [edge]: seconds }),
        { keep: true });
      this.drawWave();
      return;
    }

    const track = this.owning;
    if (track === null) return;

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
    // Before the guard below, because this one belongs to a clip panel rather
    // than to a track's, and `owning` is null there.
    const input = event.target.closest('[data-input]');
    if (input) {
      this.pickInput(input.value);
      return;
    }

    const track = this.owning;
    if (track === null) return;

    const pick = event.target.closest('[data-instrument]');
    if (pick) {
      this.change(setTrack(this.project, track, { instrument: pick.value }));
      return;
    }

    const take = event.target.closest('[data-sample-take]');
    if (take) {
      const sample = { ...this.project.tracks[track].sample, take: take.value || null };
      // A different recording makes the last reading a sentence about a
      // recording nobody is looking at. Caught by the browser check, which
      // was written to report what happened here and reported this.
      this.heard = '';
      this.change(setTrack(this.project, track, { sample }));
      return;
    }

    const plays = event.target.closest('[data-sample-root]');
    if (plays) {
      const sample = { ...this.project.tracks[track].sample, root: Number(plays.value) };
      // Set by hand, so whatever the detector last said about this track is
      // no longer what the picker says. Leaving it up would be the face
      // claiming a reading for a note somebody has since overruled.
      this.heard = '';
      this.change(setTrack(this.project, track, { sample }));
      return;
    }

    const root = event.target.closest('[data-root]');
    if (root) {
      this.change(setProject(this.project, { key: { root: Number(root.value) } }));
      return;
    }

    const scale = event.target.closest('[data-scale]');
    if (scale) {
      this.change(setProject(this.project, { key: { scale: scale.value } }));
      return;
    }

    const name = event.target.closest('[data-track-name]');
    if (name) this.change(setTrack(this.project, track, { name: name.value || 'Track' }));
  }

  /**
   * One note, now, on whichever track the panel belongs to.
   *
   * Through the track's own instrument and its inserts, so what a tap
   * auditions is what the clip will sound like rather than a different
   * piano with nothing on it.
   */
  async sound(pitch, velocity = 96, seconds = 0.35) {
    const stage = await this.ready();
    const track = stage.rowAt(this.owning ?? 0);
    track?.instrument?.play(pitch, velocity, this.engine.ctx.currentTime + 0.01, seconds);
  }

  /**
   * A pad pressed: heard now, and written down if the clip is armed.
   *
   * Heard either way. A pad that only works while recording is a pad nobody
   * can find the sound of, and hearing the kit is half of why anybody taps
   * rather than draws.
   */
  async hitPad(pitch) {
    await this.sound(pitch, 110, 0.2);
    const stage = await this.ready();

    if (!this.arming || !this.at || !stage.playing) {
      if (this.arming && !stage.playing) this.sayTap('Press play first — a tap needs a clock.');
      return;
    }

    const clip = this.clip();
    const step = divisionOf(clip.division).ticks;
    const at = stage.tick;

    this.taps = [...this.taps, drift(at, step, clip.length)].slice(-8);
    const notes = tapInto(clip, pitch, at, step);

    this.change(setNotes(
      this.project, this.at.track, this.at.scene,
      notes, clip.length,
    ), { keep: true });

    // The one cell the hit landed on, lit without rebuilding the rest -
    // which matters most here, where the taps come in a rhythm.
    const landed = notes.find((note) => !clip.notes.includes(note));
    if (landed) {
      const button = this.parts.editor
        .querySelector(`[data-step="${landed.pitch}:${columnOf(landed.start, step)}"]`);
      if (button) button.dataset.on = 'true';
    }
    this.markCell(this.at.track, this.at.scene);

    const off = timing(this.taps);
    const beats = Math.abs(off) / PPQ;
    this.sayTap(Math.abs(beats) < 0.04
      ? `${plural(this.taps.length, 'hit', 'hits')} in, and your time is good.`
      : `${plural(this.taps.length, 'hit', 'hits')} in — you are running `
        + `${off < 0 ? 'ahead of' : 'behind'} the grid by about `
        + `${Math.round(Math.abs(off))} ticks. They are on the lines anyway.`);
  }

  /**
   * Record into the slot being edited.
   *
   * Press once to start and once to stop. What comes back is rounded to the
   * nearest whole bar and cut or padded to it, because a take is going to
   * loop and a loop three and a bit bars long falls over on its second pass.
   */
  async record() {
    if (!this.at) return;

    if (this.recording) {
      const got = this.mic?.stop();
      this.recording = false;
      this.recordingFrom = null;
      this.watchLevel(false);
      clearTimeout(this.capping);
      this.capping = null;

      if (!got) { this.draw(); this.tell('Nothing came back from the microphone.'); return; }
      if (loudestIn(got.channels) < SILENCE) {
        this.draw();
        this.tell('That was silence — check which input the browser is listening to.');
        return;
      }

      // Recording over a take keeps how that take was kept; a fresh one takes
      // whatever the panel is set to.
      const was = clipAt(this.project, this.at.track, this.at.scene);
      const fit = this.fitOf(was);

      // Stored whole, in both modes. Nothing is cut on the way in - which is
      // the whole of what was wrong before. `fitTo` here only enforces the
      // ten-minute cap, which the recorder has already stopped itself at, so
      // below the cap this copies and changes nothing.
      //
      // A loop no longer needs the samples trimmed to its bar line, because
      // the stage stops the source there instead. That is what makes the two
      // modes a switch rather than a decision: the take in the store is
      // always everything that was played, and a loop is a window onto it.
      const channels = fitTo(got.channels, got.rate, freeSeconds(got.seconds));
      const seconds = channels[0].length / got.rate;

      const bars = barsFor(seconds, this.project.bpm, this.project.beats, this.project.value);
      const length = fit === 'free'
        ? ticksFor(seconds, this.project.bpm, this.project.beats, this.project.value)
        : bars * barTicks(this.project);

      const id = takeId();
      const kept = await putTake(id, channels, got.rate, { name: `${this.project.name} take` });

      // Recording over a clip leaves the old take's drawn shape in the cache
      // under the old id. Harmless while that id is still pointed at by
      // something, and a lie the moment it is not.
      if (isTake(was) && was.take !== id) this.peaks.delete(was.take);

      // Playable now whether or not it could be stored: a browser that
      // refuses IndexedDB should still let somebody finish the idea.
      const buffer = this.engine.ctx.createBuffer(channels.length, channels[0].length, got.rate);
      channels.forEach((channel, i) => buffer.copyToChannel(channel, i));
      this.takes.set(id, buffer);

      this.change(setClip(this.project, this.at.track, this.at.scene, {
        ...(was ?? {}), take: id, notes: [], chords: '', fit, length, kind: 'mic',
      }));

      // What is under it. Kept on the grid rather than in the project: it is a
      // reading of a recording, and reopening a sketch should not bring back
      // a sentence about a measurement nobody took this time.
      this.floorRead = { ...floorOf(channels, got.rate), take: id };

      // What it did to the ceiling, which is the one thing about a take that
      // cannot be undone. 24-bit storage clamps at full scale and Web Audio's
      // floats do not, so a hot input arrives already flattened - and until
      // the meter existed there was nothing anywhere that said so.
      const over = oversIn(channels);
      const peak = loudestIn(channels);
      const peakDb = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
      const ceiling = over
        ? ` ${over} sample${over === 1 ? '' : 's'} came back at or over the ceiling`
          + ' and were flattened — turn the input down and go again.'
        : ` Peak ${peakDb > -0.05 ? '0.0' : peakDb.toFixed(1)} dB.`;

      // What the bar line cost, said rather than left as a mystery. A take
      // that began a bar and a half after the press is a take whose first
      // second and a half is not in it, and somebody who played into that
      // gap deserves to know why it is gone.
      const cut = got.leadIn > 0.05
        ? ` The first ${saidLength(got.leadIn)} before the bar line was trimmed.`
        : '';

      const how = fit === 'free'
        ? `${saidLength(seconds)} recorded, kept whole and playing once`
        : `${bars === 1 ? 'A bar' : `${bars} bars`} recorded, looping`;
      // The sentence, which is the part worth having: a number says what the
      // noise is and this says what to do about it, including when the answer
      // is that nothing in software will help.
      const under = this.floorRead.enough ? ` ${saidFloor(this.floorRead, peakDb)}` : '';

      this.tell(kept
        ? `${how}, and kept in this browser.${cut}${ceiling}${under}`
        : `${how} — but this browser would not store it, so it will be gone on a `
          + `reload. Export the stems to keep it.${cut}${ceiling}${under}`);
      return;
    }

    if (!this.mic) this.mic = new Recorder(this.engine.ensure());
    this.tell('Asking for the microphone…');

    if (!await this.mic.ask({ deviceId: this.input })) {
      this.mic = null;
      this.tell('The microphone is not available — it may have been refused, '
        + 'or this page may not be on a secure connection.');
      return;
    }

    // Now that the microphone has been allowed, the browser will name the
    // hardware. Asked for every time rather than once, because a device can
    // be plugged in between one take and the next.
    inputsOf().then((all) => {
      this.inputs = all;
      if (all.length > 1 && this.open?.kind === 'clip') this.drawPanel();
    });

    // Where the take is meant to begin. With the transport running, the next
    // bar line plus the count-in - this is what the block stamps were always
    // for and what nothing used to collect. With it stopped there is no bar
    // line to begin on, so the take begins now: a sketchpad on a phone exists
    // because an idea arrives when the phone is the only thing to hand, and
    // making somebody press play first would cost the idea.
    const clock = this.stage?.transport;
    const counting = this.countIn ?? 0;
    const from = clock?.playing
      ? clock.timeOf(nextBar(clock.tick, clock.perBar) + counting * clock.perBar)
      : 0;

    this.mic.start({ from });
    this.meterShown = PEAK_FLOOR;
    this.meterAt = 0;
    this.recording = true;
    this.recordingFrom = Date.now();
    this.draw();
    this.watchLevel(true);

    // Stopped rather than trimmed. The cap is storage - ten minutes of a
    // mono 24-bit take is 82 MB in IndexedDB - and the honest way to enforce
    // it is to stop while somebody is watching, not to cut what they played
    // after they have finished playing it.
    clearTimeout(this.capping);
    this.capping = setTimeout(() => {
      if (this.recording) {
        this.record();
        this.tell(`That is the longest one take can be — ${saidLength(MOST_SECONDS)} — so it `
          + 'stopped there and kept everything up to it.');
      }
    }, MOST_SECONDS * 1000);

    const kept = this.fitOf(clipAt(this.project, this.at.track, this.at.scene)) === 'free'
      ? 'it is kept at whatever length you play'
      : 'it will be cut to the nearest whole bar';
    this.tell(from
      ? `Recording from the next bar line${counting ? ` after ${plural(counting, 'bar', 'bars')} of count-in` : ''}`
        + ` — press again to stop, and ${kept}.`
      : `Recording. Press again to stop — ${kept}.`);
  }

  sayTap(line) {
    const where = this.parts.editor.querySelector('[data-tap-said]');
    if (where) where.textContent = line;
  }

  /* --- the audio ----------------------------------------------------------- */

  /**
   * The stage, built on demand.
   *
   * On demand because a browser refuses audio before a gesture and because
   * four tracks of instruments and inserts is a graph nobody looking at the
   * grid for a moment should pay for. Built once and kept, like the tools.
   */
  /**
   * Every recording this project points at, decoded and ready.
   *
   * On opening, because a clip whose take has not been loaded is a clip that
   * plays nothing - and the first time anybody notices that is the first
   * time they press play after a reload.
   */
  async loadTakes() {
    const ctx = this.engine.ensure();
    const wanted = new Set();
    for (const track of this.project.tracks) {
      for (const slot of track.slots) if (slot?.take) wanted.add(slot.take);
    }

    const missing = [];
    for (const id of wanted) {
      if (this.takes.has(id)) continue;
      const buffer = await loadTake(ctx, id);
      if (buffer) this.takes.set(id, buffer);
      else missing.push(id);
    }
    return missing;
  }

  async ready() {
    if (this.stage) return this.stage;
    if (!this.building) {
      const ctx = this.engine.ensure();
      // A context exists as of this line, which on a reload is the first
      // moment one ever has. The stage is handed `this.takes` by reference,
      // so filling it now fills what the stage will read.
      this.warmTakes();
      this.building = makeStage(ctx, this.project, { out: this.engine.out, takes: this.takes })
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
        const first = [...this.project.scenes.keys()].find((scene) => sceneHasAnything(this.project, scene));
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
    this.open = { kind: 'clip', track, scene };

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

  /** The open clip's slot, or null - which is what everything below asks for. */
  get at() { return this.open?.kind === 'clip' ? this.open : null; }

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

    // Whether the clip's set-up is folded open is read off the page it is
    // about to replace, rather than tracked through an event. `toggle` does
    // not bubble, and a redraw that forgets the fold closes it under
    // somebody who opened it to change two things.
    const setup = parts.editor.querySelector('[data-setup]');
    if (setup) this.setupOpen = setup.open;

    if (parts.name.value !== project.name) parts.name.value = project.name;
    if (Number(parts.bpm.value) !== project.bpm) parts.bpm.value = project.bpm;
    parts.called.textContent = project.name || 'Untitled';

    this.drawGrid();
    this.drawPanel();
    this.paint();
    parts.note.textContent = this.said;
  }

  /**
   * Tracks down the left, clips running right.
   *
   * The other way round - tracks across the top - is what a desktop session
   * view does, and it is wrong on a phone twice over. A phone is tall, so
   * columns are the scarce direction while tracks are the thing there will
   * be more of; and a track's name is the one label worth reading, which
   * wants width rather than an eighty-pixel column.
   *
   * A column is still a scene. The head of it launches the lot, so firing a
   * whole set of parts and firing one clip are both one tap and neither has
   * to be learned from the other.
   */
  drawGrid() {
    const { project } = this;
    const perBar = barTicks(project);
    const perBarSeconds = barSeconds(project.bpm, project.beats, project.value);

    const last = project.scenes.length - 1;
    const canDrop = project.scenes.length > 1 && !sceneHasAnything(project, last);

    const heads = `${project.scenes.map((scene, index) => `
      <button class="scene-head" type="button" data-scene-go="${index}"
              title="Launch everything in scene ${scene.name}">${scene.name}</button>`).join('')}
      <span class="scene-edit">
        <button class="scene-more" type="button" data-add-scene
                ${project.scenes.length >= MOST_SCENES ? 'disabled' : ''}
                title="Another scene">+</button>
        <button class="scene-more" type="button" data-drop-scene
                ${canDrop ? '' : 'disabled'}
                title="${canDrop ? 'Take the last scene away' : 'Empty the last scene first'}">−</button>
      </span>`;

    const rows = project.tracks.map((track, index) => `
      <div class="grid-track">
        <button class="track-open" type="button" data-open-track="${index}"
                title="${track.name}: instrument, inserts and level">
          <span class="track-name">${track.name}</span>
          <span class="track-what">${headSays(track)}</span>
        </button>
        <button class="track-mute" type="button" data-mute="${index}"
                aria-pressed="${track.muted}" title="Mute ${track.name}">M</button>
      </div>
      ${project.scenes.map((scene, column) => {
        const clip = clipAt(project, index, column);
        return `
          <button class="cell" type="button" data-cell="${index}:${column}"
                  data-full="${Boolean(clip)}" data-follows="${clip?.follow?.then ?? ''}"
                  data-asking="${this.removing === `${index}:${column}`}"
                  ${clip?.follow ? `title="${clip.follow.after}× then ${FOLLOW_SAYS[clip.follow.then]}"` : ''}>
            <span class="cell-what">${this.removing === `${index}:${column}` ? 'Take out?'
              : clip ? clipSays(clip, perBar, perBarSeconds) : '+'}</span>
            ${clip?.follow ? `<span class="cell-follow">${clip.follow.after}×${FOLLOW_MARK[clip.follow.then]}</span>` : ''}
          </button>`;
      }).join('')}
      <span class="scene-edit"></span>`).join('');

    // One more track, or one fewer - under the names, because that is the
    // column they are a column of.
    const spare = project.tracks.at(-1);
    const canDropTrack = project.tracks.length > 1 && !spare.slots.some(Boolean);
    const foot = `
      <span class="track-edit">
        <button class="scene-more" type="button" data-add-track
                ${project.tracks.length >= MOST_TRACKS ? 'disabled' : ''}
                title="Another track">+</button>
        <button class="scene-more" type="button" data-drop-track
                ${canDropTrack ? '' : 'disabled'}
                title="${canDropTrack ? `Take ${spare.name} away` : 'Empty the last track first'}">−</button>
      </span>`;

    this.parts.grid.style.setProperty('--scenes', project.scenes.length);
    this.parts.grid.innerHTML = `<span class="grid-corner"></span>${heads}${rows}${foot}`;
  }

  /**
   * Whatever is open on top of the grid.
   *
   * Three things can be: nothing, a clip, or a track. The track's settings
   * used to sit at the bottom of the clip editor, which was always wrong -
   * an instrument and a chain of inserts belong to the track, not to
   * whichever of its clips happens to be open - and on a phone it meant
   * scrolling past a step grid to reach a fader.
   */
  /**
   * A take's shape, summarised once.
   *
   * Cached on the id rather than recomputed per draw, because the panel is
   * rebuilt from a string every time anything changes and a ten-minute take
   * costs about 45 ms to summarise - measured. Once is a dropped frame; once
   * per redraw is a sketchpad that stutters whenever a knob moves.
   *
   * Summarised wide, at `WAVE_COLUMNS`, and cut down to the canvas when it
   * is drawn. So a resize is a rescale and never a re-measure.
   */
  peaksFor(id) {
    if (this.peaks.has(id)) return this.peaks.get(id);

    const buffer = this.takes.get(id);
    if (!buffer) return null;

    const channels = Array.from({ length: buffer.numberOfChannels },
      (_, i) => buffer.getChannelData(i));
    const summary = waveOf(channels, WAVE_COLUMNS);
    this.peaks.set(id, summary);
    return summary;
  }

  /**
   * The open clip's recording, drawn.
   *
   * A recording was an invisible object until this: a cell that said it held
   * one, a length in the corner, and no way to see whether the take began
   * with four seconds of somebody finding the microphone. Two half-waves
   * about a centre line, which is what every editor draws and what a person
   * reads without being told.
   *
   * Separate from `drawPanel` because the panel is innerHTML and a canvas
   * cannot be. It is called after the markup lands and again on a resize.
   */
  drawWave() {
    const canvas = this.parts.editor.querySelector('[data-wave]');
    if (!canvas) return;

    const ready = readyCanvas(canvas);
    if (!ready) return;
    const { c, width, height } = ready;

    // Off the theme rather than written in here, so the waveform belongs to
    // whatever the page is wearing - the same thing every plugin face does.
    const style = getComputedStyle(canvas);
    const line = style.getPropertyValue('--blush-deep').trim() || '#b4655a';
    const faint = style.getPropertyValue('--line').trim() || 'rgba(0, 0, 0, 0.16)';

    const clip = this.clip();
    const wide = Math.max(1, Math.floor(width));

    // A take being made is drawn from the pairs the recorder is collecting;
    // one that exists is drawn from its stored summary. The live one wins
    // while it is running, so recording over a take shows what is arriving
    // rather than what is about to be replaced.
    //
    // `spreadWave` rather than `rescaleWave` for the live one: a second into
    // a take there are fewer blocks than pixels, and drawing those few wide
    // is the correct picture of a short take rather than invented detail.
    // Both fill the width, so the live waveform becomes the stored one
    // without jumping.
    const live = this.recording && this.mic?.live?.length
      ? spreadWave(Float32Array.from(this.mic.live), wide)
      : null;
    const peaks = live ?? (clip?.take ? this.peaksFor(clip.take) : null);

    // Nothing to draw: a take that has not finished loading, which is every
    // take for the moment between opening a sketch and the audio context
    // existing, or a mic clip with nothing recorded into it yet. Said as a
    // centre line rather than drawn as an empty box.
    if (!peaks?.length) {
      c.fillStyle = faint;
      c.fillRect(0, height / 2 - 0.5, width, 1);
      return;
    }

    const columns = live ?? rescaleWave(peaks, wide);
    const count = columns.length / 2;
    const mid = height / 2;
    // Short of the full half-height, so a take that hits full scale is not
    // drawn touching the edges of its own box.
    const reach = mid * 0.92;

    c.fillStyle = line;
    for (let i = 0; i < count; i += 1) {
      const lo = Math.max(-1, Math.min(1, columns[i * 2]));
      const hi = Math.max(-1, Math.min(1, columns[i * 2 + 1]));
      const top = mid - hi * reach;
      const bottom = mid - lo * reach;
      // At least a pixel, or silence between two notes is a gap in the
      // waveform rather than a quiet stretch of it.
      c.fillRect(i * (width / count), top, Math.max(1, width / count), Math.max(1, bottom - top));
    }

    this.drawFades(c, { width, height, mid, reach, line });

    // After the fades, because they take the waveform away outside their
    // envelope and would take the centre line with it.
    c.fillStyle = faint;
    c.fillRect(0, mid - 0.5, width, 1);
  }

  /**
   * The two fades, drawn over the take they shape.
   *
   * Mirrored about the centre line rather than drawn as one diagonal, because
   * the waveform is centred: a fade is an envelope on both halves of it, and
   * one line across the top is a picture of something else.
   *
   * Drawn where the audio is actually cut, which for a loop is its bar line
   * and not the end of the take. The stage works that out the same way, and
   * a picture that put the fade-out at the end of a take the loop never
   * reaches would be a picture of a fade nobody hears - which is exactly the
   * bug the stage had.
   */
  drawFades(c, { width, height, mid, reach, line }) {
    const clip = this.clip();
    if (!clip?.take || this.recording) return;

    const whole = this.takes.get(clip.take)?.duration ?? 0;
    if (!(whole > 0)) return;

    const { offset, length } = takeWindow(clip, whole);
    // What is audible: a free take runs to the end of its window, a loop
    // stops at its bar line. Seconds from ticks the way the clock does it.
    const barsLong = (clip.length / PPQ) * (60 / this.project.bpm);
    const heard = this.fitOf(clip) === 'free' ? length : Math.min(length, barsLong);
    const fade = fadeFor(clip.fade, heard);

    const at = (seconds) => (seconds / whole) * width;
    const steps = 32;
    const gainAt = (t, rising) => 0.5 - 0.5 * Math.cos(Math.PI * (rising ? t : 1 - t));

    // Taken out of the waveform rather than drawn over it. The audio really
    // is quieter there, so the picture of it should be shorter there - and a
    // curve in the same ink as the waveform, over a waveform, is a curve
    // nobody can see. Erased rather than painted over in the background
    // colour, so it works whatever the page is wearing.
    const taper = (from, seconds, rising) => {
      if (!(seconds > 0)) return;
      c.save();
      c.globalCompositeOperation = 'destination-out';
      for (const above of [true, false]) {
        c.beginPath();
        c.moveTo(at(from), above ? 0 : height);
        for (let i = 0; i <= steps; i += 1) {
          const t = i / steps;
          const gain = gainAt(t, rising);
          c.lineTo(at(from + seconds * t), above ? mid - gain * reach : mid + gain * reach);
        }
        c.lineTo(at(from + seconds), above ? 0 : height);
        c.closePath();
        c.fill();
      }
      c.restore();
    };

    // And the envelope itself over the top, so a fade across silence is
    // still visible as a shape rather than as nothing at all.
    const curve = (from, seconds, rising) => {
      if (!(seconds > 0)) return;
      for (const above of [true, false]) {
        c.beginPath();
        for (let i = 0; i <= steps; i += 1) {
          const t = i / steps;
          const gain = gainAt(t, rising);
          const x = at(from + seconds * t);
          const y = above ? mid - gain * reach : mid + gain * reach;
          if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
        }
        c.stroke();
      }
    };

    taper(offset, fade.in, true);
    taper(offset + heard - fade.out, fade.out, false);

    c.strokeStyle = line;
    c.lineWidth = 1.25;
    curve(offset, fade.in, true);
    curve(offset + heard - fade.out, fade.out, false);

    // And the bar line itself, where a loop is cut, so that a fade-out
    // sitting in the middle of a long take reads as deliberate rather than
    // as a drawing error.
    if (heard < length - 0.001) {
      c.save();
      c.strokeStyle = line;
      c.globalAlpha = 0.5;
      c.setLineDash([3, 3]);
      c.beginPath();
      c.moveTo(at(offset + heard), 0);
      c.lineTo(at(offset + heard), height);
      c.stroke();
      c.restore();
    }
  }

  /**
   * The input meter, painted from what the recorder last heard.
   *
   * Written straight to the elements rather than through `draw`, because the
   * panel is rebuilt from a string and a meter that rebuilt its own markup
   * sixty times a second would be a panel nobody could press a button on.
   *
   * Paced by animation frames rather than by blocks. The worklet hands over
   * 375 of those a second at 48 kHz, and a bar cannot be seen to move more
   * often than the screen draws.
   */
  paintMeter() {
    const mic = this.mic;
    const fill = this.parts.editor.querySelector('[data-meter-fill]');
    if (!fill || !mic) return;

    const hold = this.parts.editor.querySelector('[data-meter-hold]');
    const read = this.parts.editor.querySelector('[data-meter-read]');

    const db = (amp) => (amp > 0 ? 20 * Math.log10(amp) : -Infinity);
    const worst = db(mic.held);

    // Up instantly, down at a fixed rate. Without the fall the bar follows
    // the per-block peak exactly, and anything with gaps in it - a word, a
    // plucked note, a beep - drives that to nothing between transients, so
    // the bar reads as no signal at almost every frame it is looked at.
    const at = performance.now();
    const since = this.meterAt ? (at - this.meterAt) / 1000 : 0;
    this.meterAt = at;
    this.meterShown = fallenTo(db(mic.peak), this.meterShown ?? PEAK_FLOOR, since);
    const now = this.meterShown;

    fill.style.width = `${peakAt(now) * 100}%`;
    // Three states rather than a gradient: under, close, and over. A colour
    // that slides continuously tells you where you are and not whether you
    // are in trouble, which is the only thing this meter is for.
    fill.dataset.how = mic.overs || worst >= 0 ? 'over'
      : now >= PEAK_HOT ? 'hot' : 'fine';

    if (hold) {
      const at = peakAt(worst);
      hold.hidden = !(mic.held > 0);
      hold.style.left = `${at * 100}%`;
    }

    if (read) {
      read.textContent = mic.held <= 0
        ? 'nothing in yet'
        : `peak ${worst > -0.05 ? '0.0' : worst.toFixed(1)} dB`
          + (mic.overs ? ` · ${mic.overs} over` : '');
      read.dataset.how = mic.overs ? 'over' : worst >= PEAK_HOT ? 'hot' : 'fine';
    }
  }

  /**
   * Record from a different input.
   *
   * Refused mid-take rather than swapped under one: the blocks already kept
   * came from the old device, and splicing a second one onto them would make
   * a take that changes microphone halfway through with nothing saying so.
   */
  async pickInput(deviceId) {
    if (this.recording) {
      this.tell('Stop the take first — the input cannot change part way through one.');
      this.drawPanel();
      return;
    }
    if (!this.mic) return;

    const got = await this.mic.use(deviceId);
    if (!got) {
      this.mic = null;
      this.tell('That input would not open. Try another, or allow the microphone again.');
      this.drawPanel();
      return;
    }

    this.input = deviceId;
    this.inputs = await inputsOf();
    this.drawPanel();
    const named = this.inputs.find((one) => one.id === deviceId);
    this.tell(`Listening to ${named?.label ?? 'that input'} — ${saidInput(this.mic.settings)}.`);
  }

  /**
   * A trim handle under a finger.
   *
   * Moved on the element rather than through the project, so a drag is a
   * style change and not sixty rebuilds of the panel a second - which would
   * also take the handle out from under the finger holding it.
   */
  dragTrim(event) {
    const box = this.parts.editor.querySelector('[data-trimmable]');
    const clip = this.clip();
    if (!box || !clip?.take) return;

    const whole = this.takes.get(clip.take)?.duration ?? 0;
    if (!(whole > 0)) return;

    const rect = box.getBoundingClientRect();
    const part = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const want = part * whole;

    const now = takeWindow(clip, whole);
    // Never past each other, and never shorter than the fades need. A window
    // of nothing is a clip that plays nothing while still looking like a take.
    const least = TRIM_FADE * 4;
    const from = this.grabbing === 'from'
      ? Math.min(want, now.offset + now.length - least)
      : now.offset;
    const to = this.grabbing === 'to'
      ? Math.max(want, from + least)
      : now.offset + now.length;

    this.dragged = { from: Math.max(0, from), to: Math.min(whole, to) };

    const at = (t) => `${(t / whole) * 100}%`;
    box.querySelector('[data-grab="from"]').style.left = at(this.dragged.from);
    box.querySelector('[data-grab="to"]').style.left = at(this.dragged.to);
    box.querySelector('.wave-out').style.width = at(this.dragged.from);
    box.querySelector('.wave-out.is-after').style.left = at(this.dragged.to);
  }

  /** The drag, written down once the finger is off it. */
  commitTrim() {
    if (!this.dragged || !this.at) return;
    const trim = this.dragged;
    this.dragged = null;

    const clip = this.clip();
    const whole = this.takes.get(clip?.take)?.duration ?? 0;
    // A trim that is the whole take is no trim: it should not sit in the
    // project as a window that happens to match, or a take re-recorded over
    // it inherits a window that was never meant for it.
    const all = trim.from <= 0.001 && trim.to >= whole - 0.001;

    this.change(setTrim(this.project, this.at.track, this.at.scene, all ? null : trim));
    this.tell(all
      ? 'Back to the whole take.'
      : `Keeping ${saidLength(trim.to - trim.from)} of ${saidLength(whole)},`
        + ` from ${trim.from.toFixed(2)}s. The rest is still in the recording.`);
  }

  /** The take's clock, while one is running. */
  paintClock() {
    const clock = this.parts.editor.querySelector('[data-rec-clock]');
    if (!clock) return;
    const was = clock.querySelector('small')?.outerHTML ?? '';
    const run = this.recording && this.recordingFrom
      ? clockOf((Date.now() - this.recordingFrom) / 1000)
      : '—';
    clock.innerHTML = `${run}${was}`;
  }

  /**
   * Keep the meter moving while the microphone is open.
   *
   * Its own frame loop rather than the transport's, because an input level is
   * worth watching when nothing is playing - which is most of the time
   * somebody spends setting one.
   */
  watchLevel(on) {
    if (on && !this.levelFrame) {
      const step = () => {
        if (!this.mic?.open) { this.levelFrame = null; return; }
        this.paintMeter();
        this.paintClock();
        this.drawWave();
        this.levelFrame = requestAnimationFrame(step);
      };
      this.levelFrame = requestAnimationFrame(step);
      return;
    }
    if (!on && this.levelFrame) {
      cancelAnimationFrame(this.levelFrame);
      this.levelFrame = null;
    }
  }

  drawPanel() {
    const kind = this.open?.kind ?? 'none';

    // Whatever was open before this is not open now. A plugin holds an
    // analyser and a redraw loop, and a second one left running behind the
    // page is the kind of leak that only shows up as a flat battery.
    if (kind !== 'plugin') this.closePlugin();

    if (kind === 'plugin') {
      this.parts.body.dataset.open = 'plugin';
      this.drawPlugin();
      return;
    }

    if (kind === 'track') {
      this.parts.body.dataset.open = 'track';
      this.parts.editor.innerHTML = this.trackPanel(this.open.track);
      return;
    }

    if (kind === 'clip' && this.clip()) {
      this.parts.body.dataset.open = 'clip';
      this.parts.editor.innerHTML = this.clipPanel();
      this.drawWave();
      return;
    }

    this.open = null;
    this.parts.body.dataset.open = 'none';
    this.parts.editor.innerHTML = `
      <p class="editor-empty">
        Tap a slot to put a clip in it. A column is a scene: everything in one
        plays together, and the number at the top launches the lot. Tap a
        track's name on the left for its instrument, its inserts and its level.
      </p>`;
  }

  /**
   * The real plugin, on a track's insert.
   *
   * It is mounted against the live effect in that track's chain, so moving
   * a band moves the sound coming out of the track - there is no copy and
   * nothing to apply. What is saved is the same few numbers the knobs use,
   * so a sketch written by somebody who never opened this reads the same.
   */
  async drawPlugin() {
    const { track: index, effect } = this.open;
    const track = trackAt(this.project, index);
    const here = `${index}:${effect}`;

    // Already mounted on this insert, so leave it alone. A redraw that is
    // about something else - a mute, a fader, a clip - used to take a
    // working plugin apart and build another one on top of it, which left
    // the first one's redraw loop and analysers running behind the page.
    // Two of them reading the same reduction counter, which is cleared by
    // being read, is also how a keyed compressor came to show no reduction
    // at all the moment anything else on the page changed.
    if (this.plugin && this.mounted === here) {
      const named = this.parts.editor.querySelector('[data-to-track]');
      if (named) named.textContent = track.name;
      return;
    }

    this.closePlugin();
    this.mounted = here;

    this.parts.editor.innerHTML = `
      ${this.back()}
      <p class="panel-where">
        <button class="link-btn" type="button" data-to-track="${index}">${track.name}</button>
        <span>· ${EFFECT_LABELS[effect] ?? effect}</span>
      </p>
      <div class="plugin-host" data-plugin-host></div>`;

    const host = this.parts.editor.querySelector('[data-plugin-host]');
    const stage = await this.ready();

    // Between the await and here somebody may have gone somewhere else.
    if (this.open?.kind !== 'plugin' || this.open.effect !== effect) return;

    const chain = stage.rowAt(index)?.chain;
    const live = chain?.effects.find((each) => each.id === effect);
    const Plugin = PLUGINS[effect];
    if (!live || !Plugin) {
      host.innerHTML = '<p class="editor-empty">That insert is not on this track.</p>';
      return;
    }

    const player = insertPlayer(this.engine.ctx, live, {
      transport: stage.transport,
      // What is in front of it in the chain, which is the only thing that
      // knows what went into this insert - a compressor's meter shows both
      // sides and an effect can only see its own output.
      before: chain.feeding(effect),
    });

    this.plugin = new Plugin(host, {
      engine: this.engine,
      ...optionsFor(effect, track.settings[effect]),
      role: 'insert',
      player,
      // What this one's detector could listen to: every other track in the
      // sketch. A compressor keyed from the kit is the thing worth
      // practising here, and it is the one control a plugin cannot invent
      // for itself - only the sketch knows what else there is.
      keys: this.project.tracks
        .filter((each) => each.id !== track.id)
        .map((each) => ({ id: each.id, name: each.name })),
      onChange: () => this.fromPlugin(index, effect),
    });
  }

  /**
   * A move made on the plugin, written back to the project.
   *
   * The plugin is the authority while it is open - it is pointed at the
   * live effect - so this only has to keep the stored settings in step, and
   * does it without a redraw: rebuilding the panel under a drag would take
   * the band out from under the finger.
   */
  fromPlugin(index, effect) {
    // The EQ is the one whose interface does not work in the shape the
    // project stores - a strip of bands against four numbers - so it is the
    // one that needs translating. Everything else edits the effect's own
    // settings object, which is what is kept.
    const settings = effect === 'eq' ? fromTone(this.plugin?.bands) : this.plugin?.settings;
    if (!settings) return;

    const track = trackAt(this.project, index);
    this.change(setTrack(this.project, index, {
      settings: { ...track.settings, [effect]: { ...settings } },
    }), { keep: true });
  }

  /** The open plugin, closed. Its effect stays on the track. */
  closePlugin() {
    this.plugin?.destroy?.();
    this.plugin = null;
    this.mounted = null;
  }

  /**
   * A clip's set-up, in one line.
   *
   * Read rather than operated, which is the point of folding the controls
   * away: none of bars, grid, repeat or key is touched while notes are
   * going in, but all four are worth knowing at a glance.
   */
  /**
   * How this clip is kept, or how the next recording into it will be.
   *
   * One answer in one place, because three callers want it - the toggle that
   * shows it, the recorder that obeys it, and the line that says what the
   * clip is - and three copies of the same conditional is how they drift
   * apart. A clip with a take carries its own; an empty one borrows whatever
   * the panel is set to, which starts free because that is the thing a sung
   * idea needs and the thing the bars-only version could not do.
   */
  /**
   * What the open clip is: notes, or a recording.
   *
   * One answer in one place, because the panel asks it eight times - which
   * rows to show, what the summary says, whether there is a waveform, whether
   * there is a record button - and eight copies of a conditional is how a
   * panel comes to contradict itself. Which is exactly what it used to do:
   * every one of those read the TRACK, so a recording dropped on a piano
   * track got a step grid drawn over it and no way to play it back.
   */
  kindHere(clip, track) {
    return clipKindOf(clip, track);
  }

  /**
   * Whether this clip can still be told what it is.
   *
   * Only while it is empty. Once there are notes in it or a take on it, the
   * clip has been answered by its contents, and a chip that silently threw
   * either away would be a delete button wearing a label that does not say
   * delete.
   */
  canSwap(clip) {
    return Boolean(clip) && !clip.take && !clip.notes.length;
  }

  fitOf(clip) {
    if (isTake(clip)) return clip.fit === 'bars' ? 'bars' : 'free';
    return this.keepFree === false ? 'bars' : 'free';
  }

  setupSays(clip, track) {
    const bars = Math.max(1, Math.round(clip.length / barTicks(this.project)));
    const parts = [];

    if (this.kindHere(clip, track) === 'notes') {
      parts.push(bars === 1 ? '1 bar' : `${bars} bars`);
      parts.push(divisionOf(clip.division).label);
    }

    // A free take does not loop, so saying "loops" about one is the summary
    // contradicting the toggle three rows above it. Read through `fitOf`
    // rather than off the take, because a mic clip with nothing in it yet
    // still has a choice showing - and summarising it as "loops" while the
    // chip beside it reads "at its length" is the same contradiction one step
    // earlier.
    const loops = clip.follow
      ? `${clip.follow.after}× then ${FOLLOW_SAYS[clip.follow.then]}`
      : this.kindHere(clip, track) === 'mic' && this.fitOf(clip) === 'free' ? 'plays once'
        : 'loops';
    parts.push(loops);

    if (this.kindHere(clip, track) === 'notes' && track.instrument !== 'kit') {
      parts.push(`${ROOT_NAMES[this.project.key.root]} ${SCALES[this.project.key.scale].label.toLowerCase()}`);
    }

    return parts.join(' · ');
  }

  /** The way back to the grid. On screen only at a width that hides it. */
  back() {
    return '<button class="panel-back" type="button" data-back>&larr; All the clips</button>';
  }

  clipPanel() {
    const clip = this.clip();
    const { track: index, scene } = this.at;
    const track = trackAt(this.project, index);
    const step = divisionOf(clip.division).ticks;
    const wide = columnsOf(clip, step);
    const on = filled(clip, step);
    const bars = Math.max(1, Math.round(clip.length / barTicks(this.project)));
    const beat = PPQ / step;

    // Low to high, which is the reverse of the grid's rows: a column of rows
    // runs downwards like a stave, and a row of pads runs upwards like a
    // keyboard. The same pitches either way, so what can be drawn can be
    // played and the two never disagree about what the track is.
    const pads = [...rowsFor(track, this.project.key)].reverse();

    const rows = rowsFor(track, this.project.key).map((row) => `
      <button class="step-name${row.root ? ' is-root' : ''}" type="button"
              data-row-clear="${row.pitch}" title="Clear ${row.label}">${row.label}</button>
      ${Array.from({ length: wide }, (_, column) => `
        <button class="step" type="button" data-step="${row.pitch}:${column}"
                data-on="${on.has(`${row.pitch}:${column}`)}"
                data-beat="${column % beat === 0}"
                aria-label="${row.label}, step ${column + 1}"></button>`).join('')}`).join('');

    return `
      ${this.back()}
      <h3 class="editor-title">
        <button class="link-btn" type="button" data-to-track="${index}">${track.name}</button>
        <span class="editor-scene">· scene ${this.project.scenes[scene].name}</span>
      </h3>

      <details class="clip-setup"${this.setupOpen ? ' open' : ''} data-setup>
        <summary class="clip-sums">${this.setupSays(clip, track)}</summary>

        ${this.kindHere(clip, track) === 'mic' ? '' : `
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
        </div>`}

        <div class="editor-row">
          <span class="editor-label">Repeat</span>
          <span class="chips">
            <button class="chip" type="button" data-passes="0"
                    aria-pressed="${!clip.follow}" title="Loop until you press something else">∞</button>
            ${[1, 2, 4, MOST_PASSES].map((count) => `
              <button class="chip" type="button" data-passes="${count}"
                      aria-pressed="${clip.follow?.after === count}">${count}×</button>`).join('')}
          </span>
        </div>

        ${!clip.follow ? '' : `
        <div class="editor-row">
          <span class="editor-label">Then</span>
          <span class="chips">
            ${[['next', 'the next one'], ['first', 'back to 1'], ['stop', 'stop']].map(([id, what]) => `
              <button class="chip" type="button" data-then="${id}"
                      aria-pressed="${clip.follow.then === id}">${what}</button>`).join('')}
          </span>
        </div>`}

        ${this.kindHere(clip, track) === 'mic' || track.instrument === 'kit' ? '' : `
        <div class="editor-row">
          <span class="editor-label">Rows</span>
          <span class="chips">
            <select class="row-key" data-root>
              ${options(ROOT_NAMES.map((label, value) => ({ value, label })), this.project.key.root)}
            </select>
            <select class="row-key" data-scale>
              ${options(SCALE_IDS.map((value) => ({ value, label: SCALES[value].label })),
                this.project.key.scale)}
            </select>
          </span>
        </div>`}
      </details>

      ${this.kindHere(clip, track) === 'mic' ? '' : `
        <div class="steps" style="--cols: ${wide}">${rows}</div>

        ${!pads.length ? '' : `
          <div class="editor-row pad-row">
            <button class="link-btn" type="button" data-arm
                    aria-pressed="${Boolean(this.arming)}"
              >${this.arming ? 'Stop recording' : 'Record into this clip'}</button>
            <span class="fine" data-tap-said>${this.arming
              ? 'Armed. Press play and tap — every hit lands on the nearest line of the grid.'
              : 'Tap to hear it, or record and play the part in.'}</span>
          </div>
          <div class="pads">
            ${pads.map((one) => `
              <button class="pad" type="button" data-pad="${one.pitch}"
                >${one.label}</button>`).join('')}
          </div>`}`}

      ${!clip.chords ? '' : `
        <p class="fine">Made from “${clip.chords}”. The chords went in as notes and
        are yours to move now.</p>`}

      ${this.kindHere(clip, track) !== 'mic' ? '' : `
        <div class="clip-wave"${isTake(clip) ? ' data-trimmable' : ''}>
          <canvas data-wave aria-label="${isTake(clip)
            ? 'The shape of this recording' : 'What the microphone is hearing'}"></canvas>
          ${!isTake(clip) ? '' : (() => {
            const whole = this.takes.get(clip.take)?.duration ?? 0;
            const { offset, length } = takeWindow(clip, whole);
            const at = (t) => (whole > 0 ? (t / whole) * 100 : 0);
            return `
              <span class="wave-out" style="width: ${at(offset)}%"></span>
              <span class="wave-out is-after" style="right: 0; left: ${at(offset + length)}%"></span>
              ${[['from', offset, 'Where it starts', 0, offset + length],
                 ['to', offset + length, 'Where it ends', offset, whole]]
                .map(([edge, where, label, least, most]) => `
                  <button class="wave-grab" type="button" data-grab="${edge}"
                          style="left: ${at(where)}%"
                          role="slider" aria-label="${label}"
                          aria-valuemin="${least.toFixed(2)}"
                          aria-valuemax="${most.toFixed(2)}"
                          aria-valuenow="${where.toFixed(2)}"
                          aria-valuetext="${where.toFixed(2)} seconds"></button>`).join('')}`;
          })()}
        </div>`}

      ${!isTake(clip) ? '' : `
        <div class="editor-row">
          <span class="editor-label">Nudge</span>
          <span class="chips">
            ${[-PPQ / 2, -PPQ / 8, 0, PPQ / 8, PPQ / 2].map((ticks) => `
              <button class="chip" type="button" data-nudge="${ticks}"
                      aria-pressed="${(clip.nudge ?? 0) === ticks}"
                      title="${ticks === 0 ? 'On the line'
                        : `${Math.abs(ticks) === PPQ / 2 ? 'Half a beat' : 'An eighth of a beat'}`
                          + ` ${ticks < 0 ? 'early' : 'late'}`}"
                >${ticks === 0 ? 'on the line'
                  : `${ticks < 0 ? '−' : '+'}${Math.abs(ticks) === PPQ / 2 ? '½' : '⅛'}`}</button>`).join('')}
          </span>
          ${!clip.nudge ? '' : `<span class="fine">${Math.abs(clip.nudge)} ticks
            ${clip.nudge < 0 ? 'early' : 'late'}</span>`}
        </div>`}

      ${!(isTake(clip) && clip.trim) ? '' : `
        <div class="editor-row">
          <span class="editor-label">Trimmed</span>
          <span class="fine">${(() => {
            const whole = this.takes.get(clip.take)?.duration ?? 0;
            const { offset, length } = takeWindow(clip, whole);
            return `${saidLength(length)} of ${saidLength(whole)}, from ${offset.toFixed(2)}s`;
          })()}</span>
          <button class="link-btn" type="button" data-untrim>Use all of it</button>
        </div>`}

      ${!(canRecord() && this.kindHere(clip, track) === 'mic') ? '' : `
        <div class="rec-head">
          <span class="rec-clock" data-rec-clock>${this.recording ? '0:00' : '—'}<small> / ${clockOf(MOST_SECONDS)}</small></span>
          <span class="in-read" data-meter-read>nothing in yet</span>
        </div>
        <div class="in-meter" data-meter>
          <i class="in-fill" data-meter-fill></i>
          <span class="in-hold" data-meter-hold hidden></span>
        </div>
        <div class="in-scale">
          ${[PEAK_FLOOR, PEAK_FLOOR * 0.75, PEAK_FLOOR * 0.5, PEAK_FLOOR * 0.25, 0]
            .map((db) => `<span>${Math.round(db)}</span>`).join('')}
        </div>`}

      ${!(canRecord() && this.kindHere(clip, track) === 'mic') ? '' : `
        <div class="editor-row">
          <span class="editor-label">Count in</span>
          <span class="chips">
            ${COUNT_INS.map((bars) => `
              <button class="chip" type="button" data-countin="${bars}"
                      aria-pressed="${(this.countIn ?? 0) === bars}"
                      title="${bars ? `${bars} bar${bars === 1 ? '' : 's'} before the take begins`
                        : 'Begin on the next bar line'}"
                >${bars ? `${bars} bar${bars === 1 ? '' : 's'}` : 'none'}</button>`).join('')}
          </span>
        </div>`}

      ${!(isTake(clip) || (canRecord() && this.kindHere(clip, track) === 'mic')) ? '' : `
        <div class="editor-row">
          <span class="editor-label">Keep it</span>
          <span class="chips">
            <button class="chip" type="button" data-fit="free"
                    aria-pressed="${this.fitOf(clip) === 'free'}"
                    title="Any length, played once when the scene starts">at its length</button>
            <button class="chip" type="button" data-fit="bars"
                    aria-pressed="${this.fitOf(clip) === 'bars'}"
                    title="On the bar line, looping every pass">as a loop</button>
          </span>
        </div>`}

      ${!isTake(clip) ? '' : (() => {
        // Both edges, on the one row, because they are the same question
        // asked twice and a fade-in without its fade-out beside it is a
        // control somebody sets once and never finds again.
        const fade = clip.fade ?? {};
        return `
        <div class="editor-row editor-fades">
          <span class="editor-label">Edges</span>
          ${[['in', 'Fade in'], ['out', 'Fade out']].map(([edge, label]) => `
            <label class="field fade-field">
              <span class="field-label">${label}</span>
              <input type="range" data-fade="${edge}" min="0" max="1" step="0.001"
                     value="${fadeSlide(fade[edge]).toFixed(3)}"
                     aria-label="${label}, ${saidFade(fade[edge] ?? 0)}">
              <span class="fade-read" data-fade-read="${edge}">${saidFade(fade[edge] ?? 0)}</span>
            </label>`).join('')}
        </div>`;
      })()}

      ${!this.canSwap(clip) ? '' : `
        <div class="editor-row">
          <span class="editor-label">This clip</span>
          <span class="chips">
            <button class="chip" type="button" data-kind="notes"
                    aria-pressed="${this.kindHere(clip, track) === 'notes'}"
                    title="A part you draw or play in">notes</button>
            <button class="chip" type="button" data-kind="mic"
                    aria-pressed="${this.kindHere(clip, track) === 'mic'}"
                    title="Something recorded through the microphone">a recording</button>
          </span>
        </div>`}

      ${!(canRecord() && this.kindHere(clip, track) === 'mic') ? '' : `
        <dl class="rec-about">
          ${this.inputs.length < 2 ? '' : `
            <dt>Input</dt>
            <dd><select class="in-pick" data-input>
              ${this.inputs.map((one) => `
                <option value="${one.id}"${one.id === this.mic?.deviceId ? ' selected' : ''}
                  >${one.label}</option>`).join('')}
            </select></dd>`}
          <dt>Giving</dt><dd>${this.mic?.open
            ? saidInput(this.mic.settings)
            : 'not open yet — press record'}</dd>
          ${!(this.floorRead && this.floorRead.take === clip.take) ? '' : `
            <dt>Floor</dt><dd${this.floorRead.mostlySilent ? ' class="warn"' : ''}>${
              !this.floorRead.enough ? 'too short to read'
                // The row has to agree with the sentence under it. Reporting
                // "0.0 dB of range" from the handful of windows that were not
                // digital silence, while the line below says there is no floor
                // to read, is a panel contradicting itself one row apart.
                : this.floorRead.mostlySilent ? 'mostly digital silence — nothing to read'
                  : `${this.floorRead.floor.toFixed(1)} dB · ${this.floorRead.range.toFixed(1)} dB of range`
            }</dd>`}
          ${!this.mic?.open ? '' : (() => {
            const over = this.mic.overridden;
            return `<dt>Processing</dt><dd${over.length ? ' class="warn"' : ''}>${over.length
              ? `${over.map((one) => PROCESSING_SAYS[one]).join(' and ')} `
                + `${over.length === 1 ? 'is' : 'are'} ON — the browser ignored the request`
              : 'off, as asked'}</dd>`;
          })()}
        </dl>`}

      <div class="editor-row editor-outs">
        ${this.kindHere(clip, track) === 'mic' ? '' : `
          <button class="link-btn" type="button" data-clear>Clear the notes</button>`}
        ${!(canRecord() && this.kindHere(clip, track) === 'mic') ? '' : `
          <button class="link-btn" type="button" data-mic aria-pressed="${this.recording}">
            ${this.recording ? 'Stop recording'
              : isTake(clip) ? 'Record over it' : 'Record into this clip'}</button>`}
      </div>`;
  }

  trackPanel(index) {
    const track = trackAt(this.project, index);

    return `
      ${this.back()}
      <div class="editor-head">
        <p class="eyebrow">The track</p>
        <h3 class="editor-title">${track.name}</h3>
        <p class="fine">What it plays with, and where it sits. Shared by all
          ${this.project.scenes.length} of its clips.</p>
      </div>

      <div class="editor-track">
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

        <!-- Only the sampler has anything to say here, and only the sampler
             shows it: two selects that do nothing on a piano track would be
             two controls to explain. -->
        ${track.instrument !== 'sampler' ? '' : `
        <div class="editor-row editor-fields">
          <label class="field">
            <span class="field-label">Recording</span>
            <select data-sample-take>
              ${options([{ value: '', label: this.takes.size ? 'Choose one' : 'Record one first' },
                ...this.takeChoices()], track.sample.take ?? '')}
            </select>
          </label>
          <label class="field">
            <!-- The attribute is data-sample-root and not the obvious short
                 name, which is already the key the sketch is in. Nothing
                 broke on it, but one attribute meaning two things in one
                 panel is a bug with a date on it. -->
            <span class="field-label">Plays at</span>
            <select data-sample-root>
              ${options(SAMPLE_NOTES.map((pitch) => ({ value: pitch, label: pitchName(pitch) })),
                track.sample.root)}
            </select>
          </label>
          <!-- Beside the picker rather than instead of it. What a recording
               sounds at can be read off it (see lib/root.js), but it can
               also be a chord, or a drum, or three notes - and a picker that
               had been replaced by a detector would leave nowhere to say so
               and nowhere to correct it. -->
          <button class="chip" type="button" data-sample-hear
                  ${track.sample.take ? '' : 'disabled'}>Work it out</button>
          <!-- A chip rather than a picker with two entries, because it is
               one question with a yes and a no. What it changes is which of
               two shifters plays the note: off resamples, which is what a
               sampler does and makes a sample shorter as it goes up; on
               keeps the length, at about five decibels more junk. The
               numbers are in lib/psola.js. -->
          <button class="chip" type="button" data-sample-hold
                  aria-pressed="${track.sample.hold}">Keep the length</button>
        </div>
        <p class="fine sketch-heard" data-sample-heard>${this.heard || this.holdNote(track)}</p>`}

        <div class="editor-row">
          <span class="editor-label">Inserts</span>
          <span class="chips">
            ${EFFECT_IDS.map((id) => `
              <button class="chip" type="button" data-insert="${id}"
                      aria-pressed="${track.inserts.includes(id)}">${EFFECT_LABELS[id] ?? id}</button>`).join('')}
          </span>
        </div>

        ${track.inserts.map((effect, where) => {
          // Through `tidy`, not straight off the track: an insert just
          // switched on has nothing stored yet, and reading a missing value
          // as the knob's minimum drew every control at the bottom of its
          // range while the effect itself ran at its defaults.
          const set = tidy(effect, track.settings[effect]);
          return `
          <div class="insert">
            <div class="insert-head">
              <button class="insert-name is-open" type="button" data-open-plugin="${effect}"
                      title="Open the ${EFFECT_LABELS[effect] ?? effect} itself">
                ${EFFECT_LABELS[effect] ?? effect} ↗
              </button>
              <!-- The chain is in series, so this is the order the signal
                   goes through them in, and it is audible: the same two
                   effects the other way round measured 8.30 dB apart on the
                   balance reading at the worst of three pairs tried. Before
                   this the only way to change it was to take them all off
                   and put them back. -->
              <span class="insert-move">
                <button class="insert-nudge" type="button" data-move="${effect}" data-by="-1"
                        ${where === 0 ? 'disabled' : ''}
                        aria-label="Move ${EFFECT_LABELS[effect] ?? effect} earlier in the chain"
                        title="Earlier in the chain">↑</button>
                <button class="insert-nudge" type="button" data-move="${effect}" data-by="1"
                        ${where === track.inserts.length - 1 ? 'disabled' : ''}
                        aria-label="Move ${EFFECT_LABELS[effect] ?? effect} later in the chain"
                        title="Later in the chain">↓</button>
              </span>
            </div>
            <div class="insert-knobs">
              ${knobsFor(effect).map((knob) => {
                const value = set[knob.id];
                return `
                  <label class="insert-knob">
                    <span class="insert-knob-name">${knob.label}</span>
                    <input type="range" data-knob="${knob.id}" data-effect="${effect}"
                           min="${knob.min}" max="${knob.max}" step="${knob.step}" value="${value}">
                    <span class="insert-knob-read" data-knob-read>${writeKnob(knob, value)}</span>
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
   * The standing note under the sampler's fields when nothing has been read.
   *
   * Only when the length is being held, because that is the setting where
   * the root has to be true. Resampling shifts by the interval between the
   * note and the root, so a root that is wrong only moves everything by the
   * same amount and a player transposes around it without noticing. Holding
   * the length cuts grains on the period the root names, so a wrong root is
   * grains landing at arbitrary phases of the waveform.
   *
   * Measured through the real stage, with a root a fifth out and an octave
   * down asked for: resampling comes out 0 cents from the octave and the
   * held path comes out 938. That is the sentence this line exists to stop
   * somebody discovering on their own.
   */
  holdNote(track) {
    return track.sample.hold
      ? 'The length is kept — which only works if "plays at" is right.'
      : '';
  }

  /**
   * Read the chosen recording and set the root to what it sounds at.
   *
   * The reading is `lib/root.js` and the arguments for how it works are
   * there. What is here is what to do with an answer, which is three
   * different things:
   *
   * A note it is sure of sets the picker and says what it found, including
   * how far off the note the recording is - "G3, 31 cents flat" is worth
   * knowing by itself, and it is also the sentence that explains why a
   * sample played back at G3 still sounds wrong.
   *
   * A note it is not sure of sets the picker anyway and says so. Somebody
   * who recorded the note knows whether it is right, and a reading they can
   * check beats no reading.
   *
   * No note at all - a drum, a chord, a room - changes nothing and says why.
   * A detector that moved the picker to middle C on a snare would be worse
   * than one that stayed quiet, because the picker would then be wrong and
   * look deliberate.
   */
  workOutRoot(track) {
    const sample = this.project.tracks[track]?.sample;
    const buffer = sample?.take ? this.takes.get(sample.take) : null;
    if (!buffer) {
      this.heard = 'no recording chosen';
      this.draw();
      return;
    }

    // One channel rather than the sum. A take is normally mono, and where it
    // is not, summing two channels that disagree can cancel the very thing
    // being looked for - which is a silent failure, and the one kind this
    // detector has no way to notice.
    const found = rootOf(buffer.getChannelData(0), buffer.sampleRate);
    if (!found.found) {
      this.heard = `could not tell: ${found.why}`;
      this.draw();
      return;
    }

    this.heard = `${pitchName(found.pitch)} — ${rootSaid(found)}`;
    this.change(setTrack(this.project, track, {
      sample: { ...sample, root: found.pitch },
    }));
  }

  /**
   * The recordings a sampler track can be pointed at, named by where they are.
   *
   * By their place in the grid rather than by their id, because an id is
   * `take-m8x2k1-9f3a` and a place is "Voice, scene 2" - and the place is the
   * only thing anybody remembers about a recording they made four minutes
   * ago. A take that no clip holds any more gets its id, shortened: it can
   * only have arrived that way by being chosen before the clip was cleared,
   * and a row that disappeared would be worse than an ugly one.
   */
  takeChoices() {
    const where = new Map();
    this.project.tracks.forEach((track, index) => {
      track.slots.forEach((clip, scene) => {
        if (clip?.take && !where.has(clip.take)) {
          where.set(clip.take, `${track.name}, ${this.sceneName(scene)}`);
        }
      });
    });

    return [...this.takes.keys()].map((id) => ({
      value: id,
      label: where.get(id) ?? id.replace(/^take-/, ''),
    }));
  }

  /** What a scene is called, for anywhere that has to name one. */
  sceneName(scene) {
    return this.project.scenes[scene]?.name
      ? `scene ${this.project.scenes[scene].name}`
      : `scene ${scene + 1}`;
  }

  /** Whatever the grid was offering to take out, it is not any more. */
  unask() {
    if (!this.removing) return;
    this.removing = null;
    this.drawGrid();
    this.paint();
  }

  /**
   * One cell of the grid, brought up to date without redrawing the grid.
   *
   * What a cell says is how many notes are in it, which changes on every
   * tap - and the grid is behind the panel at a phone width, so redrawing
   * all of it to change one word is work nobody can even see.
   */
  markCell(track, scene) {
    const cell = this.parts.grid.querySelector(`[data-cell="${track}:${scene}"]`);
    if (!cell) return;

    const clip = clipAt(this.project, track, scene);
    cell.dataset.full = String(Boolean(clip));
    cell.dataset.follows = clip?.follow?.then ?? '';

    const what = cell.querySelector('.cell-what');
    if (what) {
      what.textContent = clip
        ? clipSays(clip, barTicks(this.project),
          barSeconds(this.project.bpm, this.project.beats, this.project.value))
        : '+';
    }
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
  /**
   * Keep the waveform the width of its box.
   *
   * Bound once to the editor rather than to the canvas, because the panel is
   * rebuilt from a string on every redraw and a watcher on the canvas would
   * be watching an element that is already gone.
   */
  watchWave() {
    this.unwatchWave?.();
    this.unwatchWave = watchSize(this.parts.editor, () => this.drawWave());
  }

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
    // Most of what is worth saying something about is started from the
    // menu, and a dialog over the page hides the line underneath it.
    if (this.parts.menuSaid) this.parts.menuSaid.textContent = line;
  }

  exportScene() {
    const scene = this.whichScene();

    if (!sceneHasAnything(this.project, scene)) {
      this.tell('There is nothing in that scene yet.');
      return;
    }

    // A MIDI file carries notes, and a recording has none. A scene that is
    // only recordings would export as a file with nothing in it, which is
    // worse than being told why.
    const written = sceneOf(this.project, scene)
      .filter(({ clip }) => !isTake(clip) && clip.notes.length);
    if (!written.length) {
      this.tell('There is nothing in that scene but recordings, and MIDI carries '
        + 'notes. Export the stems instead — they have the audio in them.');
      return;
    }

    const bytes = sceneToMidi(this.project, scene, { bars: 4 });
    const name = `${this.project.name.replace(/[^\w-]+/g, '-').toLowerCase() || 'sketch'}-scene-${scene + 1}.mid`;
    this.give(new Blob([bytes], { type: 'audio/midi' }), name);

    this.tell(`Saved ${plural(written.length, 'track', 'tracks')} as ${name} `
      + `— four bars at ${this.project.bpm} bpm.`);
  }

  /** Which scene an export means: the one being edited, else the first with anything in it. */
  whichScene() {
    return this.at?.scene
      ?? [...this.project.scenes.keys()].find((index) => sceneHasAnything(this.project, index))
      ?? 0;
  }

  /**
   * The same scene as audio: a wav a track, the room, the mix, and the MIDI.
   *
   * It takes a second or two and the page cannot say much while it does - an
   * offline render holds the thread - so the button says what is happening
   * and comes back when it is done.
   */
  async exportStems() {
    const scene = this.whichScene();
    if (!sceneHasAnything(this.project, scene)) {
      this.tell('There is nothing in that scene yet.');
      return;
    }

    const button = this.el.querySelector('[data-stems]');
    if (button.disabled) return;
    button.disabled = true;
    button.textContent = 'Rendering…';
    this.tell('Rendering the stems — a second or two.');

    try {
      const made = await zipStems(this.project, scene, { bars: 4, takes: this.takes });
      if (!made) { this.tell('There is nothing in that scene yet.'); return; }

      this.give(new Blob([made.bytes], { type: 'application/zip' }), made.name);
      const parts = made.stems.filter((stem) => stem.kind === 'track').length;
      const megs = Math.round(made.bytes.length / 1e6);
      this.tell(`Saved ${made.name} — ${plural(parts, 'stem', 'stems')}, the room, the mix and `
        + `the MIDI, every one of them ${made.stems[0].seconds} seconds long and starting `
        + `together. ${megs} MB: twenty-four bit, which is what a stem should be.`);
    } catch (why) {
      this.tell(`The stems could not be rendered: ${why.message}`);
    } finally {
      button.disabled = false;
      button.textContent = 'Export the stems';
    }
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

    this.open = null;
    this.stage?.stopScene();
    this.change(next);
    this.tell(`Opened ${file.name}.`);
  }

  fresh() {
    this.open = null;
    this.stage?.stop();
    this.watch(false);
    this.takes.clear();
    this.change(newProject());
    // The recordings go too, or they sit in this browser for ever with
    // nothing left that could ever play them.
    sweepTakes(this.project);
    this.tell('A new sketch. The old one, and its recordings, are gone from this browser.');
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
    this.warmTakes();
  }

  /**
   * Fetch this sketch's recordings out of storage, once a context exists.
   *
   * Asked at every point where one might have just appeared, rather than only
   * on the way into the view. It used to be inside `show()` alone, guarded on
   * `this.engine.ctx` - and on a reload there is no context, because a
   * browser will not make one before a gesture. So the guard failed, nothing
   * loaded, and nothing asked again: pressing play builds the stage without
   * calling `show`, so a reloaded sketch played no recordings and drew no
   * waveforms until somebody left the view and came back.
   *
   * Found by looking at a screenshot. The check that was meant to catch it
   * counted lit pixels on the canvas and passed on 974 of them, every one of
   * which was the centre line `drawWave` lays down when it has nothing to
   * draw.
   */
  warmTakes() {
    if (!this.engine.ctx || this.loaded) return;
    this.loaded = true;
    this.loadTakes().then((missing) => {
      // Whatever arrived is drawn now rather than at the next redraw, or a
      // panel that was already open keeps its empty box.
      this.drawWave();
      if (missing.length) {
        this.tell(`${plural(missing.length, 'recording', 'recordings')} in this sketch `
          + 'could not be found in this browser.');
      }
    });
  }

  /** Left for another view: the clock stops, because it is not background music. */
  hide() {
    this.watch(false);
    this.closePlugin();
    if (this.recording) { this.mic?.stop(); this.recording = false; }
    this.stage?.stop();
    this.paint();
  }

  destroy() {
    this.watch(false);
    this.watchLevel(false);
    this.unwatchWave?.();
    this.unwatchWave = null;
    this.closePlugin();
    this.mic?.close();
    this.mic = null;
    if (this.held) { clearTimeout(this.held); this.held = null; }
    this.stage?.destroy();
    this.stage = null;
  }
}
