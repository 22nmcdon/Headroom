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
  clipAt, trackAt, sceneOf, sceneHasAnything, barTicks, sceneToMidi, isTake,
  addScene, dropScene, MOST_SCENES, setFollow, MOST_PASSES,
  addTrack, dropTrack, MOST_TRACKS,
} from './project.js';
import {
  STEP_DIVISIONS, divisionOf, SCALES, SCALE_IDS, ROOT_NAMES,
  rowsFor, columnsOf, filled, toggleCell, clearRow, columnOf,
} from './steps.js';
import { loadSketch, saveSketch, sketchFile, readSketchFile } from './store.js';
import { knobsFor, writeKnob, tidy, optionsFor, fromTone } from './knobs.js';
import { insertPlayer } from './insert.js';
import { EQPlugin } from '../plugins/eq/plugin.js';
import { CompPlugin } from '../plugins/compressor/plugin.js';
import { HeatPlugin } from '../plugins/saturation/plugin.js';
import { ImagePlugin } from '../plugins/stereo/plugin.js';
import { EchoPlugin } from '../plugins/delay/plugin.js';
import { VerbPlugin } from '../plugins/reverb/plugin.js';
import { tapInto, drift, timing } from './tap.js';
import { Recorder, canRecord, barsFor, fitTo, loudestIn, SILENCE } from './record.js';
import {
  takeId, putTake, loadTake, dropTake, sweepTakes,
} from './takes.js';
import { KIT_ROWS } from './steps.js';
import { makeStage } from './stage.js';
import { zipStems } from './stems.js';
import { INSTRUMENT_IDS, isVoice } from '../core/instrument.js';
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
  panning: ImagePlugin,
  delay: EchoPlugin,
  reverb: VerbPlugin,
};

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
    // What is open on top of the grid: nothing, a clip, or a track. On a
    // phone the open thing replaces the grid; where there is room it sits
    // beside it. One piece of state either way, and the width decides the
    // placement rather than the code.
    this.open = null; // null | { kind: 'clip', track, scene } | { kind: 'track', track }
    this.frame = null;
    this.said = '';
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
      const cell = event.target.closest('[data-cell]');
      if (!cell || cell.dataset.full !== 'true') return;
      this.held = setTimeout(() => {
        this.held = null;
        this.removing = cell.dataset.cell;
        this.drawGrid();
        this.paint();
      }, 500);
    });
    for (const done of ['pointerup', 'pointercancel', 'pointerleave', 'pointermove']) {
      parts.grid.addEventListener(done, () => {
        if (this.held) { clearTimeout(this.held); this.held = null; }
      });
    }
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
    const track = this.owning;
    if (track === null) return;

    const pick = event.target.closest('[data-instrument]');
    if (pick) {
      this.change(setTrack(this.project, track, { instrument: pick.value }));
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

      if (!got) { this.draw(); this.tell('Nothing came back from the microphone.'); return; }
      if (loudestIn(got.channels) < SILENCE) {
        this.draw();
        this.tell('That was silence — check which input the browser is listening to.');
        return;
      }

      const bars = barsFor(got.seconds, this.project.bpm, this.project.beats, this.project.value);
      const seconds = bars * (60 / this.project.bpm) * this.project.beats
        * (4 / this.project.value);
      const channels = fitTo(got.channels, got.rate, seconds);

      const id = takeId();
      const kept = await putTake(id, channels, got.rate, { name: `${this.project.name} take` });

      // Playable now whether or not it could be stored: a browser that
      // refuses IndexedDB should still let somebody finish the idea.
      const buffer = this.engine.ctx.createBuffer(channels.length, channels[0].length, got.rate);
      channels.forEach((channel, i) => buffer.copyToChannel(channel, i));
      this.takes.set(id, buffer);

      const was = clipAt(this.project, this.at.track, this.at.scene);
      this.change(setClip(this.project, this.at.track, this.at.scene, {
        ...(was ?? {}), take: id, notes: [], chords: '', length: bars * barTicks(this.project),
      }));

      this.tell(kept
        ? `${bars === 1 ? 'A bar' : `${bars} bars`} recorded, and kept in this browser.`
        : `${bars === 1 ? 'A bar' : `${bars} bars`} recorded — but this browser would not `
          + 'store it, so it will be gone on a reload. Export the stems to keep it.');
      return;
    }

    if (!this.mic) this.mic = new Recorder(this.engine.ensure());
    this.tell('Asking for the microphone…');

    if (!await this.mic.ask()) {
      this.mic = null;
      this.tell('The microphone is not available — it may have been refused, '
        + 'or this page may not be on a secure connection.');
      return;
    }

    this.mic.start();
    this.recording = true;
    this.draw();
    this.tell('Recording. Press again to stop — it will be cut to the nearest whole bar.');
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
              : clip ? clipSays(clip, perBar) : '+'}</span>
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
  setupSays(clip, track) {
    const bars = Math.max(1, Math.round(clip.length / barTicks(this.project)));
    const parts = [];

    if (!isVoice(track.instrument) && !isTake(clip)) {
      parts.push(bars === 1 ? '1 bar' : `${bars} bars`);
      parts.push(divisionOf(clip.division).label);
    }

    parts.push(clip.follow
      ? `${clip.follow.after}× then ${FOLLOW_SAYS[clip.follow.then]}`
      : 'loops');

    if (!isVoice(track.instrument) && track.instrument !== 'kit') {
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

        ${isVoice(track.instrument) || isTake(clip) ? '' : `
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

        ${isVoice(track.instrument) || track.instrument === 'kit' ? '' : `
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

      ${isVoice(track.instrument) ? '' : isTake(clip) ? `
        <p class="take-note">A recording, ${bars === 1 ? 'a bar' : `${bars} bars`} long.
        There is nothing to draw on it — take it out and the slot is a clip of notes again.</p>
      ` : `<div class="steps" style="--cols: ${wide}">${rows}</div>`}

      ${!clip.chords ? '' : `
        <p class="fine">Made from “${clip.chords}”. The chords went in as notes and
        are yours to move now.</p>`}

      <div class="editor-row editor-outs">
        <button class="link-btn" type="button" data-clear>Clear the notes</button>
        ${canRecord() && isVoice(track.instrument) ? `
          <button class="link-btn" type="button" data-mic aria-pressed="${this.recording}">
            ${this.recording ? 'Stop recording'
              : isTake(clip) ? 'Record over it' : 'Record into this clip'}</button>` : ''}
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
            <button class="insert-name is-open" type="button" data-open-plugin="${effect}"
                    title="Open the ${EFFECT_LABELS[effect] ?? effect} itself">
              ${EFFECT_LABELS[effect] ?? effect} ↗
            </button>
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
    if (what) what.textContent = clip ? clipSays(clip, barTicks(this.project)) : '+';
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

    // Only once a context exists: asking for one before a gesture is what
    // browsers refuse, and the sketchpad is often the first thing opened.
    if (this.engine.ctx && !this.loaded) {
      this.loaded = true;
      this.loadTakes().then((missing) => {
        if (missing.length) {
          this.tell(`${plural(missing.length, 'recording', 'recordings')} in this sketch `
            + 'could not be found in this browser.');
        }
      });
    }
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
    this.closePlugin();
    this.mic?.close();
    this.mic = null;
    if (this.held) { clearTimeout(this.held); this.held = null; }
    this.stage?.destroy();
    this.stage = null;
  }
}
