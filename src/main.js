import {
  TOOLS, TOOL_IDS, TOOL_GROUPS, toolOf, exerciseOf, groupOf, drillsOf,
} from './learn/bench/registry.js';
import { bench } from './learn/bench/session.js';
import {
  createGame, submitGuess, makePuzzle, roundSeed, roundKey, leftAt, reveal, isDrill,
  countsAsSolved, settingsFor, startingGuess, hintFor, hintsLeft, takeHint, showAnswer,
} from './learn/game.js';
import { Engine } from './core/audio.js';
import {
  getStats, recordGame, weakestKind, resetStats, solvesIn,
  exportProgress, importProgress, notesRead, markRead,
} from './learn/stats.js';
import { progress, PATH_TIER, TEACHING_ORDER } from './learn/bench/path.js';
import { drawHome } from './learn/bench/home.js';
import { drawReport } from './learn/bench/report-page.js';
import { reportRows, confusions, shadeOf, tiersOf } from './learn/report.js';
import { pickSet, setSummary } from './learn/set.js';
import { engrave } from './lib/engrave.js';
import { renderPicker, syncPicker, pickerState, dialValue } from './learn/bench/picker.js';
import { makeLog } from './learn/bench/log.js';
import { notesFor } from './learn/notes/index.js';
import { parseRoute, routeFor, sameRoute } from './route.js';
import { makeHistory } from './lib/history.js';
import { AnalysisPage } from './analysis/page.js';
import { SketchPage } from './sketch/grid.js';
import { MixPage } from './mix/page.js';

const $ = (sel) => document.querySelector(sel);

/* The webfonts, promoted only when this page is being served. `rel` is set with
   the href and never before: a stylesheet with no href counts as one still on
   its way, and stalls every script after it. */
(function loadWebfonts() {
  const link = document.getElementById('webfonts');
  if (link && location.protocol.startsWith('http')) {
    link.href = link.dataset.href;
    link.rel = 'stylesheet';
  }
}());

const engine = new Engine();

const desk = bench();

const ui = {
  // The tool, open, per id. Opened once and kept: the whole of this stage is
  // that an exercise arriving is not a reason to destroy one. Switching tools
  // still tears down, because six live plugins each holding a loop is six
  // loops of audio for five tools nobody is looking at.
  tool: null,
  toolId: null,
  mode: 'eq',
  tier: 'easy',
  // 'work' or 'drill'. Not per tool: it is how you are practising, not what
  // you are practising, and it survives switching tools on purpose.
  kind: 'work',
  // On the Learn tab: reading what the tool is for rather than doing a round.
  // Beside `kind` rather than one of its values, because the round underneath
  // carries on being work or drills - Learn is a page over it, not a third
  // way of marking one.
  learning: false,
  // Which of the four this page is being used as. The top of the hierarchy:
  // different things to do with this app rather than different ways of doing
  // one. Each is built the first time it is asked for and kept after that.
  view: 'tools',
  analysis: null,
  mix: null,
  sketch: null,
  // How this drill's clean A/B takes its subject out and puts it back. Null
  // whenever the round is not a drill, or has nothing to compare against.
  clean: null,
  chosen: {}, // settings, per mode, so switching back finds them as you left them
  guess: {},
  // Flipping the tool between what you dialled and the answer, once the
  // answer has been shown. Built by `ontoWay`, cleared on every new round.
  onto: null,
  game: null,
  // The seed of each round left unfinished, by tool, tier and exercise, so
  // that switching away and back finds it. See `leftAt` for what is kept.
  left: {},
  // A drill set in progress - its questions, which one is being asked and
  // how each went - or null. While one runs, the navigation steps back.
  set: null,
  // True while the shell puts the tools back after a set: a restore is not
  // somewhere you went, and must not leave a step in the history.
  holding: false,
  // The set Home is offering, made when Home is drawn so the page can say
  // what is in it; and the last one finished, for Home to say how it went.
  nextSet: null,
  lastSet: null,
  log: null, // what has been tried this round, newest first
  // Bumped by every startGame, so a round that is still awaiting its tool can
  // tell it has been overtaken and stop rather than finish over the new one.
  round: 0,
  // The round the surface is waiting on, and inert for until it arrives.
  arriving: 0,
};

const tool = () => toolOf(ui.mode);
const settings = () => settingsFor(ui.mode, ui.chosen[ui.mode] ?? {});

/**
 * The exercises this tool offers of the kind being practised.
 *
 * Two kinds, and they are different activities: working at a tool, and being
 * asked about one. Keeping them apart is what lets somebody run the drill on
 * every tool in a sitting without going through the exercise dropdown each time.
 */
const exercisesOfKind = (id, kind) =>
  Object.values(TOOLS[id].exercises).filter((exercise) => !!exercise.drill === (kind === 'drill'));

/** Which kind an exercise id belongs to. */
const kindOf = (id, exercise) => (TOOLS[id].exercises[exercise]?.drill ? 'drill' : 'work');

/* ---------- setup row ---------- */

/**
 * The tools, in their four families, down the side of the page.
 *
 * Each with three marks for its three steps on the path - read, drill, build
 * - so which tools have been touched is visible from anywhere on the bench,
 * not only from Home.
 */
function fillModes() {
  $('#modes').innerHTML = TOOL_GROUPS.map((group) => `
    <div class="tool-group" role="group" aria-label="${group.label}">
      <p class="tool-group-name">${group.label}</p>
      ${group.tools.filter((id) => TOOLS[id]).map((id) => `<button class="mode-pill" type="button"
        role="radio" data-train="${id}" aria-checked="${id === ui.mode}" title="${TOOLS[id].blurb}"
        >${TOOLS[id].label}<span class="tool-marks" aria-hidden="true"></span></button>`).join('')}
    </div>`).join('');
  syncModes();
}

/** The tools in the order the list shows them, for the arrow keys. */
const LISTED = TOOL_GROUPS.flatMap((group) => group.tools).filter((id) => TOOLS[id]);

function syncModes() {
  const steps = pathState().steps;
  for (const pill of document.querySelectorAll('[data-train]')) {
    const id = pill.dataset.train;
    pill.setAttribute('aria-checked', id === ui.mode ? 'true' : 'false');
    pill.querySelector('.tool-marks').innerHTML = steps.filter((step) => step.tool === id)
      .map((step) => `<i class="is-${step.done ? 'done' : step.solves > 0 ? 'started' : 'none'}"></i>`)
      .join('');
  }
  $('#toolName').textContent = tool().label;
  $('#toolBlurb').textContent = tool().blurb.toLowerCase();
}

/** Open or shut the tool list, where it is a sheet rather than a column. */
function pickTools(open) {
  $('#modes').classList.toggle('is-open', open);
  $('#modesScrim').hidden = !open;
  $('#toolPick').setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) $('#modes').querySelector('[aria-checked="true"]')?.focus();
}

/**
 * What a tier means, which is the exercise's to say before it is the tool's.
 *
 * A tier is not one thing. On the EQ it is how many bands you have to build;
 * in the EQ's drill it is which octaves are on the chips and how big the move
 * is. The dropdown said the first whichever you were doing, which made it
 * wrong half the time.
 */
const tierBlurb = (id) =>
  exerciseOf(ui.mode, settings()).tierBlurbs?.[id] ?? tool().tiers[id].blurb;

function fillTiers() {
  const spec = tool();
  if (!spec.tiers[ui.tier]) ui.tier = Object.keys(spec.tiers)[0];

  // Pills rather than a select: three states, every one of them visible, and
  // what each means on hover rather than in a dropdown that had to be opened
  // to be read.
  $('#tier').innerHTML = Object.entries(spec.tiers)
    .map(([id, tier]) => `<button class="tier-pill" type="button" role="radio" data-tier="${id}"`
      + ` aria-checked="${id === ui.tier}" title="${tierBlurb(id)}">${tier.label}</button>`)
    .join('');
}

/**
 * The settings row, with the exercise list narrowed to the kind on the tab.
 *
 * Narrowed rather than reordered: in drills the dropdown offers the drills
 * and nothing else, so the tab is the only thing deciding which activity
 * this is and the dropdown cannot quietly put you back in the other one.
 */
function fillSettings() {
  const chosen = settings();

  $('#settings').innerHTML = (tool().settings ?? []).map((setting) => {
    const options = setting.id === 'exercise'
      ? setting.options.filter((option) => kindOf(ui.mode, option.id) === ui.kind)
      : setting.options;

    return `
    <label class="field"${options.length < 2 ? ' hidden' : ''}>
      <span class="field-label">${setting.label}</span>
      <select data-setting="${setting.id}">${options
        .map((option) => `<option value="${option.id}"`
          + `${option.id === chosen[setting.id] ? ' selected' : ''}>${option.label}</option>`)
        .join('')}</select>
    </label>`;
  }).join('');
}

/**
 * Put the chosen exercise inside the kind on the tab.
 *
 * Called whenever either moves: switching to drills has to land on a drill,
 * and switching tool has to land on one of that tool's. Returns nothing - it
 * changes what `settings()` answers, and the caller restarts the round.
 */
function settleKind() {
  const current = settings().exercise;
  if (current && kindOf(ui.mode, current) === ui.kind) return;

  const [first] = exercisesOfKind(ui.mode, ui.kind);
  // A tool with no drill keeps you where you are rather than stranding you on
  // an empty dropdown. Every tool has one now; this is what happens the day
  // one does not.
  if (!first) {
    ui.kind = 'work';
    return settleKind();
  }
  ui.chosen[ui.mode] = { ...ui.chosen[ui.mode], exercise: first.id };
  return undefined;
}

/** The things this page is for. The ids match the sections and buttons. */
const VIEWS = ['home', 'tools', 'analysis', 'mix', 'sketch', 'progress'];

/**
 * Show one of the things this app is.
 *
 * The tool list, the tabs and the difficulty are on the tools' own page, so
 * they go with it; the answer bar is the round's, and goes when there is no
 * round showing - on another page, or on the Learn tab.
 *
 * Each page is built the first time it is asked for and kept after that, the
 * same bargain the tools get: the analysis page holds decoded audio and the
 * readings over it, the sketchpad holds a graph of four instruments, and
 * throwing either away because somebody looked at an EQ for a moment would
 * mean building it again.
 */
function syncView() {
  const { view } = ui;
  const working = view === 'tools';

  for (const button of document.querySelectorAll('[data-view]')) {
    button.setAttribute('aria-checked', button.dataset.view === view ? 'true' : 'false');
  }

  for (const id of VIEWS) $(`#${id}-view`).hidden = id !== view;

  $('#dock').hidden = !working || ui.learning;
  pickTools(false);

  // Whatever was sounding in the page being left stops: a page you cannot see
  // is not background music.
  if (!working && ui.tool?.isPlaying?.()) ui.tool.toggle?.();
  if (view !== 'sketch') ui.sketch?.hide();
  if (view !== 'mix') ui.mix?.hide();

  if (view === 'analysis') {
    if (!ui.analysis) ui.analysis = new AnalysisPage($('#analysisSheet'), { engine });
    ui.analysis.show();
  }

  if (view === 'mix') {
    if (!ui.mix) ui.mix = new MixPage($('#mixSheet'), { engine });
    ui.mix.show();
  }

  if (view === 'sketch') {
    if (!ui.sketch) ui.sketch = new SketchPage($('#sketchSheet'), { engine });
    ui.sketch.show();
  }

  if (view === 'home') renderHome();
  if (view === 'progress') {
    note('');
    renderProgress();
  }

  writeRoute();
}

/* ---------- where you are, as a URL ---------- */

/** The last place visited, for a visit that arrives with no hash. */
const ROUTE_KEY = 'headroom.route';

/**
 * The one step a set puts in the history, so that Back leaves the set and
 * stays in the app. Not a route: a set cannot be reloaded into, and a page
 * opened on it goes wherever this browser was last.
 */
const SET_HASH = '#/set';

function storedRoute() {
  try { return localStorage.getItem(ROUTE_KEY); } catch { return null; }
}

/**
 * Put where `ui` is into the address bar, and remember it.
 *
 * Assigned rather than replaced, so each move is a history entry and Back
 * goes back. The `hashchange` that assignment fires reads a route that is
 * already where the shell is, and does nothing. `replace` is for arriving,
 * which should not leave a step behind it.
 */
function writeRoute({ replace = false } = {}) {
  // A set is not a place: it moves through ten tools in a few minutes, and a
  // history entry for each would make Back walk through them. The address
  // stays where the set was started from, and Back leaves the set.
  if (ui.set || ui.holding) return;
  const next = routeFor(here());
  try { localStorage.setItem(ROUTE_KEY, next); } catch { /* private window */ }
  if (location.hash === next) return;
  try {
    if (replace) history.replaceState(null, '', next);
    else location.hash = next;
  } catch {
    /* a sandboxed frame may refuse; the page works the same without it */
  }
}

/** Where the shell is, in a route's fields: Learn is a kind, as far as a link goes. */
const here = () => ({
  view: ui.view, mode: ui.mode, kind: ui.learning ? 'learn' : ui.kind, tier: ui.tier,
});

/** Take the fields a route names onto `ui`, without doing anything about it. */
function takeRoute(route) {
  ui.view = route.view;
  if (route.view !== 'tools') return;
  ui.mode = route.mode ?? ui.mode;
  if (route.kind === 'learn') ui.learning = true;
  else if (route.kind) {
    ui.learning = false;
    ui.kind = route.kind;
  }
  ui.tier = route.tier ?? ui.tier;
}

/**
 * Go where a route says - Back, Forward, or a link somebody pasted.
 *
 * The same steps the tool list, the tabs and the difficulty take, because a
 * route is only a different way of pressing them.
 */
function applyRoute(route, { push = false } = {}) {
  if (ui.set) endSet({ home: false });
  if (!route) {
    // A hash that names nothing - a page not built yet, a typo - is put back
    // to where the shell actually is rather than left lying.
    writeRoute({ replace: true });
    return;
  }
  if (sameRoute(route, here())) return;

  // A new round only when the round would differ: moving between Learn and
  // the tab it sits over does not change what is being asked.
  const kind = route.kind && route.kind !== 'learn' ? route.kind : ui.kind;
  const tooling = route.view === 'tools' && (kind !== ui.kind
    || ['mode', 'tier'].some((key) => route[key] !== undefined && route[key] !== ui[key]));
  const moving = route.view !== ui.view;
  takeRoute(route);

  if (tooling) {
    syncModes();
    settleKind();
    syncKind();
    fillTiers();
    fillSettings();
  }
  // Settled first, and in place: a route that left a field out, or named a
  // tier the tool lacks, is written back whole without a second step in the
  // history for it. A jump from inside the app - a cell on Progress, a card
  // on Home - is a step of its own, so Back comes back to where it was made.
  writeRoute({ replace: !push });
  if (moving) syncView();
  syncLearn();
  if (tooling) startGame();
}

/**
 * Learn, Drill or Work.
 *
 * Learn opens over the round rather than replacing it, so leaving it for the
 * tab it was opened from starts nothing; leaving it for the other one, or
 * moving between Drill and Work, starts a round of that kind.
 */
function toTab(kind) {
  if (kind === 'learn') {
    if (ui.learning) return;
    ui.learning = true;
    syncLearn();
    writeRoute();
    return;
  }

  ui.learning = false;
  if (ui.kind === kind) {
    syncLearn();
    writeRoute();
    return;
  }
  ui.kind = kind;
  settleKind();
  syncLearn();
  // After settleKind, because a tier is described by the exercise and the
  // exercise has only just changed.
  fillTiers();
  fillSettings();
  startGame();
}

function syncKind() {
  // The tabs only: the sketchpad has `data-kind` chips of its own, and this
  // used to mark them as well.
  const on = ui.learning ? 'learn' : ui.kind;
  for (const button of document.querySelectorAll('.tool-tabs [data-kind]')) {
    button.setAttribute('aria-checked', button.dataset.kind === on ? 'true' : 'false');
  }
}

/**
 * The Learn tab, or the round.
 *
 * Learn is the notes, set to be read rather than tucked into a disclosure,
 * beside this tool's three steps on the path. The round goes on underneath -
 * the tool stays open and its round loaded - so going back to Drill or Work
 * is a switch rather than a reload.
 */
function syncLearn() {
  const learning = ui.learning;
  $('#learn').hidden = !learning;
  $('#round').hidden = learning;
  $('#toolSettings').hidden = learning;
  $('#dock').hidden = ui.view !== 'tools' || learning;
  syncKind();
  if (!learning) return;

  // A page you cannot see is not background music.
  if (ui.tool?.isPlaying?.()) ui.tool.toggle?.();
  markRead(ui.mode);
  syncModes();

  const steps = pathState().steps.filter((step) => step.tool === ui.mode);
  $('#learnSide').innerHTML = `
    <p class="learn-side-label">${tool().label} on the path</p>
    <ol class="learn-steps">${steps.map((step) => `
      <li class="${step.done ? 'is-done' : ''}">
        <span class="learn-step-what">${step.label}</span>
        <span class="learn-step-where">${step.done ? 'done'
          : step.step === 'read' ? '' : `${Math.min(step.solves, step.enough)} of ${step.enough}`}</span>
      </li>`).join('')}
    </ol>
    <button class="submit-btn" type="button" data-learn="drill">Go to the drill</button>`;
}

/* ---------- the picker ---------- */

function buildPicker() {
  const picker = $('#picker');

  // Chips are cleared between guesses; controls are not. A producer works from
  // where they got to last time, not from the middle of the range again.
  const chosen = settings();
  const dialled = startingGuess(ui.mode, ui.tier, chosen);
  ui.guess = { ...dialled, ...Object.fromEntries(
    Object.entries(ui.guess).filter(([id]) => id in dialled)) };

  renderPicker(picker, tool().slots(ui.tier, chosen), ui.guess, { write: engrave });

  syncAnswer();
}

/**
 * Repaint the controls, and the button under them.
 *
 * The picker draws itself; what is left here is the part that is about the
 * round rather than about the controls - whether there is anything left to
 * submit, and what the button should say.
 */
function syncAnswer() {
  const submit = $('#submit');

  const slots = tool().slots(ui.tier, settings());

  // A tool is answered on the tool. Only a drill asks with chips, and there
  // is no "out of guesses" any more - so the only thing that closes the
  // button is having got there.
  if (!slots.length) {
    const live = ui.game.status !== 'solved';
    submit.disabled = !live;
    submit.textContent = live ? 'Lock it in' : 'That is it';
    return;
  }

  syncPicker($('#picker'), slots, ui.guess);

  const { complete, dialling, summary } = pickerState(slots, ui.guess);
  const ready = complete && ui.game.status !== 'solved';

  submit.disabled = !ready;
  submit.textContent = ready
    ? `${dialling ? 'Lock in' : 'Guess'} ${summary}`
    : slots.length > 1 ? 'Pick one of each' : 'Submit guess';
}

/* ---------- the tool, and what is put on it ---------- */

/**
 * Open the tool, if it is not already open.
 *
 * This is the whole of the inversion, from the shell's side. What used to be
 * here destroyed the plugin and built a new one every time anything changed -
 * a new round, a new tier, a new exercise - which meant the audio stopped and
 * the controls went back to the middle several times a session, for reasons
 * that had nothing to do with the tool.
 *
 * Now it is opened once per tool and kept. Switching to a different tool
 * still tears the old one down: six live plugins each holding a rendered loop
 * is six loops of audio for five tools nobody is looking at.
 */
async function openTool() {
  const surface = $('#surface');

  if (ui.toolId === ui.mode && ui.tool) return ui.tool;

  // Awaited, and the await is not decoration. Clearing the bench runs the
  // detach, which puts the exercise's impositions back - and a detach that
  // runs after the tool has been destroyed is writing to an element that is
  // no longer in the page. Tearing down first threw on the first tool switch.
  await desk.clear();
  ui.tool?.destroy();
  ui.tool = null;
  surface.textContent = '';

  // An element of its own, rather than the surface itself. Every plugin
  // listens on the element it is given, and none of them takes its listeners
  // off again - so when they were all given #surface, every tool ever opened
  // was still listening on it, and a click on Play played the loop once more
  // for each earlier visit to that tool, each through a graph its player had
  // just rebuilt. tests/browser/lifecycle.mjs is how that was found. A host
  // per tool takes its listeners with it when the next one replaces it.
  const host = document.createElement('div');
  host.className = 'tool-host';
  surface.append(host);
  ui.tool = toolOf(ui.mode).open(host, {
    engine,
    onChange: () => {
      syncAnswer();
      noteChange();
    },
  });
  ui.toolId = ui.mode;
  return ui.tool;
}

/**
 * Put this round's exercise on the tool.
 *
 * Awaited, and what is waited for is the material: what an answer is marked
 * against is rendered before the round begins rather than filled in from an
 * unawaited block while somebody is already dialling. Until this stage the
 * compressor could be marked against a synthetic probe because its loop had
 * not arrived yet, and nothing said so.
 */
async function putExercise() {
  const exercise = exerciseOf(ui.mode, settings());
  // This round and its puzzle, held: by the time the tool is open `ui.game`
  // may be a later round's.
  const { round } = ui;
  const { puzzle } = ui.game;
  const drilling = !!exercise.drill;

  // A drill puts the tool away and asks instead. The tool is still there and
  // still playing - it owns the audio, and a drill is a listening question -
  // but its display is not, because on every one of these tools the display
  // is the answer: the analyser draws the boost, the harmonic bars draw even
  // against odd. Hidden, every canvas reads as zero by zero and every draw is
  // a no-op, so nothing is spent on pictures nobody is looking at.
  $('#surface').hidden = drilling;
  // Undo and the A/B slots are for settings you dial, and a drill dials none.
  FACE_TOOLS.hidden = drilling;
  $('#drill').hidden = !drilling;
  $('#picker').hidden = !drilling;
  // Yours and the other side on work; on a drill the other side is the
  // answer, and Hear it clean is the comparison instead.
  $('#barAB').hidden = drilling;

  $('#drillAsk').textContent = exercise.ask ?? '';

  // Inert until the round has arrived. The face is on the page as soon as the
  // tool opens, but the round attaches after it - material rendered, fault
  // baked, and then its starting settings put on the face - and anything
  // done to the face in that moment, up to 0.8 s on the reverb, was put back
  // underneath whoever did it. The starting settings are the round's, so the
  // fix is not to keep the click but not to take it (tests/browser/arrive.mjs).
  // Released by whichever round marked it last, so a round overtaken by one
  // that never got this far cannot leave the face dead.
  const surface = $('#surface');
  ui.arriving = round;
  surface.inert = true;
  surface.classList.add('is-arriving');
  try {
    const opened = await openTool();
    if (round !== ui.round) return;
    await desk.put(opened, exercise, puzzle);
    if (round !== ui.round) return;
  } finally {
    if (ui.arriving === round) {
      surface.inert = false;
      surface.classList.remove('is-arriving');
    }
  }

  // After the put, and it has to be. A drill that sets the tool's own
  // controls has only just set them, and what the clean A/B flips back to is
  // where they ended up - read before the put, it would be the last round's.
  ui.clean = drilling ? cleanWay(exercise, puzzle) : null;
  $('#drillClean').hidden = !ui.clean;
  setClean(false);

  // A new round has no answer to put anywhere yet. Cleared rather than left,
  // or the button would flip the next round's tool onto the last one's
  // answer - which is a reveal of something nobody asked about.
  ui.onto = null;
  $('#onto').hidden = true;
  $('#onto').setAttribute('aria-pressed', 'false');
  $('#onto').textContent = 'Put it on the controls';

  syncAnswer();
  syncTransport();
}

/* ---------- undo, redo, and the A/B slots ---------- */

/**
 * The settings you dial, kept.
 *
 * Undo is a list of `state()` snapshots, and the slots are two of them you
 * can flip between - the A/B a plugin host has, for comparing two settings
 * of your own rather than yours against a target. Both are the shell's, built
 * on what every face already does, so no face had to change for them.
 *
 * A snapshot is taken when a change has settled rather than on every step of
 * a drag: one turn of a knob is one undo.
 */
// Held rather than looked up: while a face rebuilds its strip, the tools
// are out of the document for a moment, and a lookup by id finds nothing.
const FACE_TOOLS = document.querySelector('#faceTools');

const faceTools = {
  history: makeHistory(),
  slots: { on: 'A', A: null, B: null },
  // While the shell itself is putting a state on, the face's onChange is the
  // shell's own doing and is not a change to record.
  applying: false,
  settle: 0,
};

const SETTLE_MS = 350;

function resetFaceTools() {
  clearTimeout(faceTools.settle);
  // A new round starts in circuit.
  ui.tool?.setBypass?.(false);
  mountFaceTools();
  const state = ui.tool?.state?.();
  faceTools.history.reset(state);
  faceTools.slots = { on: 'A', A: null, B: null };
  syncFaceTools();
}

/**
 * Put undo, redo and the slots on the face's own title strip, where the
 * canvas draws them, beside the On switch and the summary.
 *
 * Moved rather than drawn there by each face: they are the host's, and the
 * twelve faces did not have to change for them. A face that rebuilds itself
 * - the compressor does, changing family - takes its strip with it, so the
 * surface is watched and they are put back.
 */
function mountFaceTools() {
  const tools = FACE_TOOLS;
  const head = $('#surface .plugin-head');
  if (head && tools.parentElement !== head) head.append(tools);
  if (!head && tools.parentElement !== $('.surface-wrap')) $('.surface-wrap').prepend(tools);
}

function noteChange() {
  if (faceTools.applying) return;
  clearTimeout(faceTools.settle);
  faceTools.settle = setTimeout(() => {
    const state = ui.tool?.state?.();
    if (state !== undefined && faceTools.history.record(state)) syncFaceTools();
  }, SETTLE_MS);
}

/** Put a state on the face without that counting as a change of its own. */
function applyState(state) {
  if (!state || !ui.tool?.setState) return;
  clearTimeout(faceTools.settle);
  faceTools.applying = true;
  try {
    ui.tool.setState(state);
  } finally {
    faceTools.applying = false;
  }
  syncAnswer();
}

/** Settings can only be moved while the round is still open. */
const settable = () => ui.game?.status !== 'solved' && !!ui.tool?.setState;

function undoStep() {
  if (!settable()) return;
  applyState(faceTools.history.undo());
  syncFaceTools();
}

function redoStep() {
  if (!settable()) return;
  applyState(faceTools.history.redo());
  syncFaceTools();
}

/**
 * Flip to the other slot. What is on the controls is kept in the slot being
 * left; the other slot's settings go on, or - the first time - it starts as a
 * copy of these, which is where somebody comparing two settings starts.
 */
function toSlot(slot) {
  const { slots } = faceTools;
  if (slot === slots.on || !settable()) return;
  slots[slots.on] = ui.tool.state();
  slots.on = slot;
  if (slots[slot]) {
    applyState(slots[slot]);
    faceTools.history.record(ui.tool.state());
  }
  syncFaceTools();
}

/** Copy what is on the controls into the other slot. */
function copySlot() {
  if (!settable()) return;
  const { slots } = faceTools;
  slots[slots.on === 'A' ? 'B' : 'A'] = ui.tool.state();
  syncFaceTools();
}

function syncFaceTools() {
  const open = settable();
  FACE_TOOLS.querySelector('#undo').disabled = !open || !faceTools.history.canUndo;
  FACE_TOOLS.querySelector('#redo').disabled = !open || !faceTools.history.canRedo;
  FACE_TOOLS.querySelector('#slotCopy').disabled = !open;
  FACE_TOOLS.querySelector('#slotCopy').textContent = faceTools.slots.on === 'A' ? 'A → B' : 'B → A';
  for (const button of FACE_TOOLS.querySelectorAll('[data-slot]')) {
    button.setAttribute('aria-checked', button.dataset.slot === faceTools.slots.on ? 'true' : 'false');
    button.disabled = !open;
  }
}

/* ---------- the transport ---------- */

/**
 * The bar's transport, from the face: playing or not, and which side of the
 * A/B is being heard and what each is called.
 *
 * Asked of the face rather than kept here, because the face can change it on
 * its own - a new sample restarts the loop, an exercise renames the other
 * side - and two records of one state are two answers to one question.
 */
function syncTransport() {
  const face = ui.tool;
  $('#play').textContent = face?.isPlaying?.() ? 'Stop' : 'Play';

  const heard = face?.heard?.() ?? 'mine';
  for (const button of document.querySelectorAll('#barAB [data-side]')) {
    const side = button.dataset.side;
    button.setAttribute('aria-checked', side === heard ? 'true' : 'false');
    const label = side === 'mine' ? face?.mineLabel?.() : face?.abLabel?.();
    if (label && button.textContent !== label) button.textContent = label;
  }
}

/**
 * How to take this drill's subject out and put it back.
 *
 * Two levers, because there are two kinds of drill. Some put the thing to be
 * named in the MATERIAL - the EQ drill moves an octave of the mix, and the EQ
 * itself is flat and innocent - and those come out with `setFault`. Others
 * put it on the TOOL, because a compressor doing 6 dB is a compressor and not
 * a faulty loop, and those go on and come off with `setState`.
 *
 * Both are methods the session already calls to set the exercise up; this is
 * the same two calls, driven by a button, with the loop never stopping. A
 * drill that offers neither has nothing worth comparing against - knowing
 * where a sound is panned does not need a reference - and gets no button.
 */
function cleanWay(exercise, puzzle) {
  const fault = exercise.faultOf?.(puzzle) ?? null;
  if (fault) return { on: () => ui.tool?.setFault(null), off: () => ui.tool?.setFault(fault) };

  const clean = exercise.cleanOf?.(puzzle) ?? null;
  if (!clean) return null;

  // Taken once, because `startOf` may have solved for it against the loop and
  // asking twice would solve it twice.
  const working = ui.tool?.state();
  return {
    on: () => ui.tool?.setState(clean),
    off: () => ui.tool?.setState(working),
  };
}

/**
 * Flipping the tool between what you dialled and the answer.
 *
 * The other half of being shown a target. Showing one leaves the controls
 * alone on purpose - the point is to work your way onto it - and this is for
 * when what you want is the other thing: hear where you were headed, then
 * hear where you are, with the loop never stopping. It is `cleanWay`'s two
 * calls against a different pair.
 *
 * The target is `targetOf` and not the puzzle's answer, which matters and is
 * not obvious. Several exercises here measure their answer against the loop
 * the round is actually played on rather than against the probe it was made
 * with - the limiter's `ceilSettle` re-solves a drive for the real material -
 * and `targetOf` is the one the scoring compares a guess against. Put the raw
 * answer on the tool instead and you get settings that do not hit the target
 * on this loop, which is a reveal that reveals the wrong thing.
 *
 * Offered only where the exercise says its target IS the settings that win,
 * which is `ontoTool` and which is not something that can be worked out from
 * here. The first version of this offered it wherever a `targetOf` existed,
 * and five rounds out of twenty-two then put something on the controls that
 * could not win:
 *
 *   - `limiter/deliver` returns a delivery spec - a loudness and a ceiling
 *     and a service's name - rather than knob positions. Set that on a
 *     limiter and nothing it names is a control it has.
 *   - `eq/fix`, `compression/duck`, `reverb/tempo` and `saturation/even` are
 *     marked on a reading derived from what came out, not on matching a
 *     settings object, so their target is a thing to be judged against and
 *     not a thing to be dialled.
 *
 * Every one of those was found by a check pressing the button and locking in,
 * which is the only way to tell "the target" from "the answer" - they look
 * identical from here and are not the same object.
 *
 * A drill never gets it: its answer is a chip, and a drill that has set the
 * tool's controls has set them to the question rather than the answer.
 */
function ontoWay(exercise, puzzle) {
  if (exercise.drill || !exercise.ontoTool) return null;
  const target = exercise.targetOf?.(puzzle) ?? exercise.answerOf?.(puzzle) ?? puzzle.answer ?? null;
  if (!target || !ui.tool?.setState) return null;

  // Taken at the moment of showing, which is what "yours" means here: where
  // the controls were when you asked. Taken once, because `targetOf` may
  // have solved against the loop and asking twice would solve it twice.
  const yours = ui.tool.state();
  return {
    on: () => ui.tool?.setState(target),
    off: () => ui.tool?.setState(yours),
  };
}

/** Put the answer on the controls, or put yours back. */
function setOnto(on) {
  const button = $('#onto');
  button.setAttribute('aria-pressed', on ? 'true' : 'false');
  button.textContent = on ? 'Put mine back' : 'Put it on the controls';
  if (on) ui.onto?.on();
  else ui.onto?.off();
}

/** Hear it without whatever is being asked about, and back. */
function setClean(on) {
  const button = $('#drillClean');
  button.setAttribute('aria-pressed', on ? 'true' : 'false');
  button.textContent = on ? 'Hear it again' : 'Hear it clean';
  if (on) ui.clean?.on();
  else ui.clean?.off();
}

/**
 * The two lines above the tool: what it is, and the one thing worth saying
 * before you touch it.
 *
 * What was here also built a row of clue buttons. Every tool returned an
 * empty list of clues - has done since they all became surfaces - so the row,
 * the play counter and `mode.play()` were unreachable for three stages. The
 * split settled the question the last stage left open: the work modules carry
 * no transport at all, because a drill on a tool plays through the tool.
 */
function buildHead() {
  const advice = tool().advice;
  $('#advice').hidden = !advice;
  $('#advice').textContent = advice ?? '';
  // A drill brings its own, because the tool's says to drag the bands and a
  // drill has no bands to drag. Everything else gets the tool's.
  $('#lede').textContent = exerciseOf(ui.mode, settings()).lede ?? tool().lede;
  buildNotes();
}

/**
 * What the tool is for, as opposed to how to work it.
 *
 * The Learn tab. The help dialog says which button does what; this says
 * what a pre-delay is, why even harmonics sound like an octave, and what
 * summing to mono actually costs - the half of this project that was written
 * down years' worth of commits ago and addressed only to whoever was next to
 * change the code.
 */
function buildNotes() {
  const notes = notesFor(ui.mode);
  const panel = $('#notes');

  panel.hidden = !notes;
  if (!notes) return;

  $('#notesTitle').textContent = notes.title;
  $('#notesBody').innerHTML = notes.sections
    .map((section) => `<section><h3>${section.heading}</h3>${section.body
      .split('\n\n').map((line) => `<p>${line}</p>`).join('')}</section>`)
    .join('');
}

/* ---------- lifecycle ---------- */

async function startGame({ fresh = false } = {}) {
  ui.round += 1;
  writeRoute();
  const round = ui.round;
  // Caught here rather than at each caller: most of them fire and forget.
  try {
    await playRound(round, fresh);
  } catch (error) {
    console.error(error);
    if (round === ui.round) say('That round did not load. Try another one.');
  }
}

async function playRound(round, fresh) {
  const chosen = settings();
  // Switching tool, tier or exercise and coming back finds the round you
  // left, if you left one unfinished. `fresh` is "another one" - a new puzzle
  // of the same shape, whatever was left.
  const before = ui.game;
  if (before) {
    const { mode, tier, settings: was } = before.puzzle;
    ui.left[roundKey(mode, tier, was)] = leftAt(before);
  }
  const kept = fresh ? null : ui.left[roundKey(ui.mode, ui.tier, chosen)];
  const seed = kept ?? roundSeed(ui.mode, ui.tier);

  const puzzle = makePuzzle({ mode: ui.mode, tier: ui.tier, settings: chosen, seed });
  ui.game = createGame(puzzle);

  buildHead();
  buildPicker();
  buildLog();

  // Note what is NOT here any more: `engine.stop()`. Starting a round used to
  // silence everything, because the plugin was about to be destroyed anyway.
  // The tool now outlives the round, so a new exercise arrives as a crossfade
  // on a loop that never stopped - which is the whole of what this stage is
  // for, heard rather than read.
  await putExercise();
  if (round !== ui.round) return;
  // After the round has put its starting settings on: those are where undo
  // goes back to, not whatever the last round left.
  resetFaceTools();

  // Nothing is restored into a round. What this replaces re-ran the scoring
  // over stored guesses and could print different text than had been shown,
  // because the audio it marks against loads after the board does.
  render();
  // A tool is not answered by naming anything; a drill is answered by nothing
  // else. Which is what the fallback had backwards: three work rounds - the
  // level's match, the limiter's match and its delivery round - carry no
  // opening of their own and were being told to name what they heard on a
  // round answered by dialling. The rule was already written here; the line
  // under it just did not follow it.
  const asking = tool().slots(ui.tier, chosen).length > 0;
  say(exerciseOf(ui.mode, chosen).opening ?? tool().opening
    ?? (asking ? 'Play it, then name what you heard.' : 'Play it, then work the tool.'));
}

/**
 * The log, sized to whatever this tool's readings are called.
 *
 * Rebuilt per round rather than cleared, because a different tool has
 * different columns - and the headings are for a screen reader only: with one
 * attempt per line and the units inside every cell, a head row would be a
 * third thing to size and would say what the cells already say.
 */
function buildLog() {
  const slots = tool().slots(ui.tier, settings());
  ui.log = makeLog($('#log'), {
    write: engrave,
    headings: slots.length
      ? slots.map((slot) => slot.heading ?? slot.id)
      : ['how close', 'where'],
  });
}

function say(text, { matched = false } = {}) {
  const verdict = $('#verdict');
  verdict.textContent = text;
  verdict.classList.toggle('matches', matched);
}

function onSubmit() {
  const slots = tool().slots(ui.tier, settings());
  const onTool = !slots.length;
  if (!onTool && !slots.every((slot) => ui.guess[slot.id] !== undefined)) return;

  const before = ui.game;
  const next = submitGuess(before, onTool ? ui.tool.state() : { ...ui.guess });
  ui.game = next;

  if (next.error) {
    say(next.error);
    return;
  }
  if (next.guesses.length === before.guesses.length) return;

  // Chips start again; controls stay where they were put, because the next
  // attempt is an adjustment of this one.
  ui.guess = Object.fromEntries(
    Object.entries(ui.guess).filter(([id]) =>
      slots.find((slot) => slot.id === id)?.kind === 'range'));

  const attempt = next.guesses[next.guesses.length - 1];
  const n = ui.log.add(attempt.score);

  if (next.status === 'solved') {
    recordGame(next);
    noteSetResult(next);
    finish(next);
  } else if (before.status === 'playing' && next.status === 'shown') {
    // A drill, answered wrong. The first answer is the one that counts, so
    // the round is over and the answer goes up - and the controls stay live,
    // so the right one can be heard against the one you picked.
    recordGame(next);
    noteSetResult(next);
    say('Not that one — the first answer is the one that counts.');
    finish(next);
  } else if (attempt.score.correct) {
    // Arrived, but with the answer already in front of you. The reading is
    // still true and still worth saying; what it is not is a solve.
    say('That is it — with the answer up.', { matched: true });
  } else {
    say(`Attempt ${n}. ${closeness(attempt.score)}`);
  }
  render();
}

/**
 * A word for how the last attempt went, now that there is no count to report.
 *
 * What was here said "two guesses left", which was the only thing the dock had
 * to say and was about the game rather than about the audio. The cells carry
 * the number; this carries the direction of travel.
 */
function closeness(score) {
  const worst = score.cells.map((cell) => cell.state);
  if (worst.every((state) => state === 'hit')) return 'Very close.';
  if (worst.includes('hit') || worst.includes('near')) return 'Getting there.';
  return 'Not there yet.';
}

/** The dock's answer: name the thing, never mark the player. */
function finish(game) {
  const solved = game.status === 'solved';
  const count = game.guesses.length;
  const answer = reveal(game.puzzle);

  if (solved && isDrill(game.puzzle)) {
    say(countsAsSolved(game)
      ? 'That is it — first time.'
      : 'That is it — with a hint, so it is not counted as a solve.', { matched: true });
  } else if (solved) {
    say(`That is it — in ${count} ${count === 1 ? 'attempt' : 'attempts'}.`, { matched: true });
  }

  const played = $('#played');
  played.textContent = '';
  // A drill's answer was named, not built.
  const built = solved && !isDrill(game.puzzle);
  played.appendChild(document.createTextNode(built ? 'You built ' : 'It was '));

  const symbol = document.createElement('span');
  symbol.className = 'symbol';
  engrave(symbol, answer.symbol);
  played.appendChild(symbol);
  played.appendChild(document.createTextNode(answer.name ? ` — ${answer.name}.` : '.'));

  // A mode with its own interface shows the answer on it - the curve you were
  // chasing, drawn over the one you built. Asked for rather than arrived at,
  // the controls stay live: the point of being shown a target is to be able to
  // move onto it and hear what closing the gap sounds like.
  // The answer, drawn on the tool. Asked for rather than arrived at, the
  // controls stay live: the point of being shown a target is to be able to
  // move onto it and hear what closing the gap sounds like.
  const exercise = exerciseOf(ui.mode, settings());
  // The window the round is marked to travels with the answer, so the page can
  // say which of the gaps counted without keeping its own copy of a number
  // that lives in the exercise. Most rounds are not marked harmonic by
  // harmonic and say so by not answering.
  ui.tool?.showTarget(
    exercise.answerOf?.(game.puzzle) ?? game.puzzle.answer ?? null,
    { close: exercise.closeOf?.(ui.tier) ?? null },
  );
  if (solved) ui.tool?.lock();
}

/* ---------- the way out ---------- */

/**
 * A rung of the ladder, on request.
 *
 * Unbounded attempts removed the only thing that ever revealed an answer, so
 * something has to take its place - and two things, rather than one, because
 * being stuck and wanting to be finished are different states. A hint says
 * what kind of move it is and roughly where; it does not say the number.
 */
function onHint() {
  const line = hintFor(ui.game);
  if (!line) return;

  ui.game = takeHint(ui.game);
  const hint = $('#hint-line');
  hint.hidden = false;
  hint.textContent = line;
  render();
}

/** Show me: the answer drawn on the tool, and the controls left alive. */
function onShow() {
  if (ui.game.status !== 'playing') return;

  ui.game = showAnswer(ui.game);
  recordGame(ui.game);
  noteSetResult(ui.game);

  const exercise = exerciseOf(ui.mode, settings());
  ui.onto = ontoWay(exercise, ui.game.puzzle);
  $('#onto').hidden = !ui.onto;

  say(ui.onto
    ? 'There it is. The controls are still live — work your way onto it, or '
      + 'put it on them and hear where you were headed.'
    : 'There it is. The controls are still live — work your way onto it.');
  finish(ui.game);
  render();
}

/* ---------- rendering ---------- */

/**
 * Everything on the page that is about the round rather than the readings.
 *
 * The readings are the log's, and the log is append-only: `render` no longer
 * draws them and never redraws them. What went with that is an entire
 * apparatus for sizing an empty board - a head row, a preview cell, a column
 * count, a chip-or-dial branch to decide how many readings a row would carry -
 * all of it in service of drawing four rows of nothing before anything had
 * been played. A log has nothing to draw until there is something to draw.
 */
function render() {
  const game = ui.game;

  // The marks on the tool list move as rounds are recorded.
  syncModes();
  // And settings stop moving once the round is solved.
  syncFaceTools();

  const solved = game.status === 'solved';
  $('#picker').classList.toggle('done', solved);
  $('#dock').classList.toggle('done', solved);
  $('#again').hidden = !solved && game.status !== 'shown';
  $('#again').textContent = !ui.set ? 'Another one'
    : ui.set.at + 1 < ui.set.questions.length ? 'Next question' : 'See how it went';
  if (game.status === 'playing') $('#played').textContent = '';

  // Both ways out are there from the first attempt and stay there. Hiding them
  // until somebody has struggled enough would be the ceiling again, wearing a
  // different hat.
  const left = hintsLeft(game);
  const hint = $('#hint');
  hint.hidden = left === 0 || solved;
  // On a drill a hint costs the solve, so the button says so before it is
  // pressed rather than after.
  const costs = isDrill(game.puzzle) ? ' — not counted' : '';
  hint.textContent = game.hinted === 0 ? `Hint${costs}` : `Another hint (${left} left)`;
  $('#hint-line').hidden = game.hinted === 0;

  const show = $('#show');
  show.hidden = game.status !== 'playing';

  syncAnswer();
}

/* ---------- progress ---------- */

/** The tools as the Progress table lists them: in teaching order. */
const REPORTED = () => TEACHING_ORDER.filter((id) => TOOL_IDS.includes(id))
  .map((id) => ({ id, tiers: Object.keys(TOOLS[id].tiers) }));

/** Everything the Progress page shows, read off the buckets. */
function progressModel() {
  const tools = REPORTED();
  const statsOf = (id, tier, kind) => getStats(id, tier, kind);
  const tiers = tiersOf(tools).map((id) => ({
    id, label: tools.map((tool) => TOOLS[tool.id].tiers[id]?.label).find(Boolean) ?? id,
  }));
  const rows = reportRows({ tools, statsOf }).map((row) => ({
    ...row,
    name: TOOLS[row.id].label,
    group: groupOf(row.id)?.label ?? '',
    cells: row.cells.map((entry) => entry && { ...entry, shade: shadeOf(entry.rate) }),
  }));
  const confused = confusions({ tools, statsOf }).map((item) => ({
    tool: item.tool,
    tier: item.tier,
    what: `${TOOLS[item.tool].label} · ${item.label}`,
    as: `Heard as ${item.heard} ${item.n === 2 ? 'twice' : `${item.n} times`} out of ${item.seen}.`,
  }));
  const played = rows.some((row) => row.cells.some((entry) => entry?.played));
  return { tiers, rows, confused, played };
}

function renderProgress() {
  drawReport($('#progressSheet'), progressModel());
}

function onProgress(e) {
  const button = e.target.closest('[data-report]');
  if (!button) return;
  const what = button.dataset.report;

  if (what === 'go') {
    const { tool, kind, tier } = button.dataset;
    applyRoute({ view: 'tools', mode: tool, kind, tier }, { push: true });
  }
  if (what === 'export') downloadProgress();
  if (what === 'import') $('#import-file').click();
  if (what === 'clear') {
    // The one thing on this page that cannot be undone, so it asks. Export
    // first is the way back, and it says so.
    if (!window.confirm('Clear all progress in this browser? Export it first if you might want it back.')) return;
    resetStats();
    renderProgress();
    note('Progress cleared.');
  }
}

/* ---------- progress, as a file ---------- */

/** The line under the buttons: what just happened to the progress. */
function note(text) {
  const line = $('#reportNote');
  line.textContent = text;
  line.hidden = !text;
}

/**
 * Write the progress out as a file.
 *
 * Everything this app remembers is one key in one browser's storage, and
 * clearing site data takes it with it. There is no account to sync to, so the
 * backup is a file you keep where you keep files.
 */
function downloadProgress() {
  const file = exportProgress();
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }));

  const link = document.createElement('a');
  link.href = url;
  link.download = `headroom-progress-${file.exported.slice(0, 10)}.json`;
  link.click();
  // Not revoked on the next line: the click starts the download and some
  // browsers have not read the blob by the time the statement after it runs,
  // which gives an empty file. A tick is enough, and the url is dead either
  // way the moment this page goes.
  setTimeout(() => URL.revokeObjectURL(url), 0);

  const buckets = Object.keys(file.buckets).length;
  note(buckets
    ? `Saved ${buckets} ${buckets === 1 ? 'set' : 'sets'} of progress as ${link.download}.`
    : 'Saved — though there is nothing in it yet.');
}

/** Read a progress file back in, adding it to whatever is here. */
async function uploadProgress(input) {
  const [file] = input.files ?? [];
  // The picker is reset either way, so picking the same file twice in a row
  // still fires a change event and still gets an answer.
  input.value = '';
  if (!file) return;

  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    note(`${file.name} is not readable as JSON.`);
    return;
  }

  const result = importProgress(parsed);
  if (!result.ok) {
    note(result.reason);
    return;
  }

  renderProgress();
  note(`Added ${result.buckets} ${result.buckets === 1 ? 'set' : 'sets'} of progress from `
    + `${file.name}. Nothing already here was replaced.`);
}

/* ---------- the path ---------- */

/**
 * Where somebody is, read off the progress that is already kept.
 *
 * The path counts solves rather than keeping a record of its own: a step is
 * done when the bucket behind it says so, which means importing somebody's
 * progress file brings their place in the path with it and nothing had to be
 * written to make that true.
 */
const pathState = () => progress({
  // A drill step counts rounds right first time; see `solvesIn`.
  solvesOf: (tool, tier, kind) => solvesIn(getStats(tool, tier, kind), kind),
  hasRead: (tool) => notesRead().includes(tool),
});

/**
 * Go to a step.
 *
 * Which is all a step is: a tool, a tier and which of the two kinds - the
 * shell already knows how to be in any of those states, so the path sets
 * them and gets out of the way. The reading step opens the notes, which is
 * also what marks it done.
 */
async function goTo(id) {
  const step = pathState().steps.find((one) => one.id === id);
  if (!step) return;

  // The last step is not a tool, and taking somebody to the EQ for it would
  // be the path pointing at the wrong half of the app.
  if (step.step === 'mix') {
    ui.view = 'mix';
    syncView();
    if (ui.mix && ui.mix.tier !== step.tier) {
      ui.mix.tier = step.tier;
      ui.mix.deal();
    }
    return;
  }

  if (ui.view !== 'tools') {
    ui.view = 'tools';
    syncView();
  }

  ui.mode = step.tool;
  ui.learning = step.step === 'read';
  if (step.kind) {
    ui.kind = step.kind;
    ui.tier = step.tier ?? PATH_TIER;
  }

  syncModes();
  settleKind();
  syncKind();
  fillTiers();
  fillSettings();
  syncLearn();
  await startGame();
}

/* ---------- home ---------- */

/** How a tool's drills have gone, across every tier, for picking a set. */
function drillRecord(id) {
  let played = 0;
  let right = 0;
  let tier = 'easy';
  let most = 0;
  for (const at of Object.keys(TOOLS[id].tiers)) {
    const stats = getStats(id, at, 'drill');
    played += stats.played;
    right += solvesIn(stats, 'drill');
    // Asked at the tier it has been drilled at most - the one somebody
    // chose - and on the first of them when nothing has been.
    if (stats.played > most) { most = stats.played; tier = at; }
  }
  return { played, right, tier };
}

/** A set to offer, with what the page says about it. */
function prepareSet() {
  const set = pickSet({ record: drillRecord, seed: `set:${Date.now()}:${Math.random()}` });
  const tools = set.tools.map(({ tool, count }) => {
    const drills = drillsOf(tool);
    const label = drills.length === 1 ? `${TOOLS[tool].label} · ${drills[0].label}` : TOOLS[tool].label;
    return { tool, count, label };
  });
  return { ...set, tools };
}

/**
 * The answer worth working on: the weakest kind of answer in any drill bucket,
 * once there is enough behind it to mean anything.
 */
function weakestDrill() {
  let worst = null;
  for (const id of TOOL_IDS) {
    for (const tier of Object.keys(TOOLS[id].tiers)) {
      const weak = weakestKind(getStats(id, tier, 'drill'));
      if (!weak) continue;
      if (!worst || weak.rate < worst.weak.rate
        || (weak.rate === worst.weak.rate && weak.seen > worst.weak.seen)) {
        worst = { id, tier, weak };
      }
    }
  }
  if (!worst) return null;

  const { id, tier, weak } = worst;
  return {
    tool: id,
    tier,
    label: `${TOOLS[id].label} · ${weak.label}`,
    line: `${Math.round(weak.rate * 100)}% right first time over ${weak.seen}.`
      + (weak.confusedWith ? ` You usually hear it as ${weak.confusedWith.label}.` : ''),
  };
}

/** Everything Home shows, read off what is already kept. */
function homeModel() {
  const state = pathState();
  const { next } = state;

  const marks = (step) => (step.done ? 'done' : step.solves > 0 ? 'started' : 'none');
  const cards = TEACHING_ORDER.filter((id) => TOOL_IDS.includes(id)).map((id, i) => {
    const steps = state.steps.filter((step) => step.tool === id);
    const mine = next?.tool === id;
    return {
      id,
      num: String(i + 1).padStart(2, '0'),
      group: groupOf(id)?.label ?? '',
      name: TOOLS[id].label,
      marks: steps.map(marks),
      next: mine,
      status: steps.every((step) => step.done) ? 'Done' : mine ? 'Next' : '',
      note: mine && next.step !== 'read' ? `${Math.min(next.solves, next.enough)} of ${next.enough}` : '',
    };
  });
  const mix = state.steps.find((step) => step.step === 'mix');

  ui.nextSet = prepareSet();
  return {
    date: new Date(),
    set: ui.nextSet,
    last: ui.lastSet,
    next: next && {
      label: next.tool ? `${TOOLS[next.tool].label} — ${next.label}` : next.label,
      where: `Step ${state.steps.indexOf(next) + 1} of ${state.total}`
        + (next.step === 'read' ? ''
          : ` · ${Math.min(next.solves, next.enough)} of ${next.enough} `
            + (next.kind === 'drill' ? 'right first time' : next.kind === 'mix' ? 'mixed' : 'solved')),
    },
    weak: weakestDrill(),
    cards,
    mix: { done: !!mix?.done, next: next?.step === 'mix' },
  };
}

function renderHome() {
  drawHome($('#homeSheet'), homeModel());
}

/** Go to a tool's drills at a tier, the way a route would. */
function drillAt(tool, tier) {
  applyRoute({ view: 'tools', mode: tool, kind: 'drill', tier }, { push: true });
}

function onHome(e) {
  const tool = e.target.closest('[data-home-tool]')?.dataset.homeTool;
  if (tool) {
    // A tool's card goes to its next step, or to building one once all three
    // are done: the path suggests, it does not finish.
    const steps = pathState().steps.filter((step) => step.tool === tool);
    goTo((steps.find((step) => !step.done) ?? steps[steps.length - 1]).id);
    return;
  }

  const what = e.target.closest('[data-home]')?.dataset.home;
  if (what === 'start') startSet();
  if (what === 'done') { ui.lastSet = null; renderHome(); }
  if (what === 'continue') {
    const { next } = pathState();
    if (next) goTo(next.id);
  }
  if (what === 'weak') {
    const weak = weakestDrill();
    if (weak) drillAt(weak.tool, weak.tier);
  }
  if (what === 'mix') goTo('mix:match');
}

/* ---------- a set ---------- */

/**
 * Start the set Home is offering.
 *
 * The tools view does the asking - a set question is an ordinary drill round,
 * recorded the ordinary way, so it counts toward the stats and the path like
 * any other. What the set adds is the order, the bar that says where you are
 * in it, and the summary at the end. Where the tools were before it started
 * is kept, so the Tools tab is where you left it afterwards.
 */
function startSet() {
  const set = ui.nextSet ?? prepareSet();
  ui.set = {
    questions: set.questions,
    at: 0,
    results: [],
    was: { mode: ui.mode, kind: ui.kind, tier: ui.tier, learning: ui.learning, chosen: { ...ui.chosen } },
  };
  ui.lastSet = null;
  document.body.classList.add('in-set');
  try { location.hash = SET_HASH; } catch { /* a sandboxed frame */ }
  ui.view = 'tools';
  syncView();
  askQuestion();
}

function askQuestion() {
  const question = ui.set.questions[ui.set.at];
  ui.mode = question.tool;
  ui.kind = 'drill';
  ui.learning = false;
  syncLearn();
  ui.tier = question.tier;
  ui.chosen[question.tool] = { ...ui.chosen[question.tool], exercise: question.exercise };
  syncModes();
  syncKind();
  fillTiers();
  fillSettings();
  syncSetBar();
  startGame({ fresh: true });
}

/**
 * How the question being asked went, once it is over.
 *
 * Right means what the stats mean by it: first time, no hint. What was heard
 * instead is said in the drill's own words, the same ones the confusion
 * record uses, so the summary can say "it was 2k, you heard 4k".
 */
function noteSetResult(game) {
  if (!ui.set || ui.set.results[ui.set.at]) return;
  const { tool } = ui.set.questions[ui.set.at];
  const spec = toolOf(tool);
  const first = game.guesses[0]?.guess;
  const answer = spec.weak(game.puzzle).label;
  const heard = first === undefined ? null : spec.heard?.(first, game.puzzle)?.label ?? null;
  ui.set.results[ui.set.at] = {
    tool,
    outcome: countsAsSolved(game) ? 'right' : 'wrong',
    answer,
    // The right octave the wrong way round was not heard as something else:
    // it was heard right and named wrong, and the summary should not say
    // "it was 63, you heard 63".
    heard: heard === answer ? null : heard,
  };
  syncSetBar();
}

function nextQuestion() {
  ui.set.at += 1;
  if (ui.set.at < ui.set.questions.length) askQuestion();
  else endSet();
}

/** Move on without answering. Not a wrong answer: not counted at all. */
function skipQuestion() {
  if (!ui.set) return;
  if (!ui.set.results[ui.set.at]) {
    ui.set.results[ui.set.at] = { tool: ui.set.questions[ui.set.at].tool, outcome: 'skipped' };
  }
  nextQuestion();
}

/**
 * Finish a set - at the end, or by leaving it - and say how it went.
 *
 * Leaving part way still says how the answered part went: those rounds are
 * already in the stats, and pretending otherwise would only hide them.
 * `home: false` is for leaving by Back, which is already on its way
 * somewhere.
 */
function endSet({ home = true } = {}) {
  if (!ui.set) return;
  const { results, was } = ui.set;
  const answered = results.filter(Boolean);
  const summary = setSummary(answered);
  const label = (id) => TOOLS[id].label;
  ui.lastSet = summary.asked ? {
    ...summary,
    byTool: summary.byTool.map((entry) => ({ ...entry, label: label(entry.tool) })),
    misheard: summary.misheard.map((miss) => ({ ...miss, label: label(miss.tool) })),
  } : null;

  ui.set = null;
  document.body.classList.remove('in-set');
  syncSetBar();

  if (home) {
    ui.view = 'home';
    // In place of the set's own step, so Back from Home does not land on it.
    writeRoute({ replace: true });
    syncView();
  }

  // The tools go back to where they were before the set, out of sight.
  ui.holding = true;
  Object.assign(ui, {
    mode: was.mode, kind: was.kind, tier: was.tier, learning: was.learning, chosen: was.chosen,
  });
  syncLearn();
  syncModes();
  syncKind();
  fillTiers();
  fillSettings();
  startGame();
  ui.holding = false;
}

/** The bar a set shows instead of the navigation. */
function syncSetBar() {
  const bar = $('#setBar');
  bar.hidden = !ui.set;
  if (!ui.set) return;

  const { questions, at, results } = ui.set;
  $('#setCount').textContent = `Question ${at + 1} of ${questions.length}`;
  $('#setStrip').innerHTML = questions.map((question, i) => {
    const outcome = results[i]?.outcome ?? (i === at ? 'now' : 'todo');
    const said = { right: 'right first time', wrong: 'not this time', skipped: 'skipped',
      now: 'this one', todo: 'to come' }[outcome];
    return `<li class="is-${outcome}" title="${TOOLS[question.tool].label}: ${said}"></li>`;
  }).join('');
  $('#setSkip').hidden = !!results[at];
}

/* ---------- the cheat sheet ---------- */

function fillHelp() {
  // The analysis view is not a tool and the tool's help does not describe it.
  // Pressing ? there used to explain the EQ.
  if (ui.view === 'analysis') {
    $('#helpMode').textContent = 'Analysis';
    $('#helpLede').textContent = 'The half of this app that asks nothing. Put a piece of '
      + 'audio in front of it and it tells you what is in there.';
    $('#helpList').innerHTML = [
      ['Two slots, because a meter is for comparing.',
       'Yours in the first, something you like the sound of in the second. Every '
       + 'number then carries the difference between them underneath it.'],
      ['Your own files, or something this app can make.',
       'A wav, an mp3 or an m4a off your disk - nothing is uploaded, it is decoded '
       + 'in this browser - or one of the loops the tools use, so there is '
       + 'something to look at before you load anything.'],
      ['Loudness is measured the way a broadcaster measures it.',
       'ITU-R BS.1770, gated: silence and the quiet ends of a piece are thrown '
       + 'away so the number describes how loud the thing sounds when it is '
       + 'sounding. True peak is read between the samples, because a file that '
       + 'reads -0.1 dBFS can still clip a converter.'],
      ['Crest factor is the one that shows limiting.',
       'Peak over RMS. The figure for a whole track averages its loud parts with '
       + 'its quiet ones, so the tightest moment anywhere in it is printed beside '
       + 'the overall - that is where the limiter was working hardest.'],
      ['The spectrum is tilted, and that is on purpose.',
       'Three decibels an octave, so a balanced mix reads level and what stands '
       + 'out on the line is what stands out in the room. It is normalised to '
       + 'itself, so two mixes with the same tonality at different levels draw '
       + 'the same line.'],
      ['A long track takes a moment.',
       'About seven seconds for three minutes of stereo. Nothing leaves this '
       + 'browser while it does.'],
    ].map(([lead, detail]) => `<li><b>${lead}</b><span>${detail}</span></li>`).join('');
    return;
  }

  if (ui.view === 'progress') {
    $('#helpMode').textContent = 'Progress';
    $('#helpLede').textContent = 'Every tool at once: how the drills and the work have gone, '
      + 'at every difficulty.';
    $('#helpList').innerHTML = [
      ['Drills count the first answer; work counts solved.',
       'A drill is right when the first answer was, with no hint. A round of work is '
       + 'solved when you got there yourself - a round you pressed Show me on is played '
       + 'and not solved.'],
      ['The shade is how it is going.',
       'Darkest from 80%, lighter from 50%, rose under that, dashed where you have not '
       + 'tried it. Press any cell to go and play it.'],
      ['What you hear things as.',
       'When a drill answer keeps being heard as the same other thing, it is listed '
       + 'beside the table - the thing worth listening for next time.'],
      ['It lives in this browser.',
       'Export saves it as a file. Import adds a file to what is here - from your '
       + 'phone to your laptop, say - and never replaces anything.'],
    ].map(([lead, detail]) => `<li><b>${lead}</b><span>${detail}</span></li>`).join('');
    return;
  }

  if (ui.view === 'home') {
    $('#helpMode').textContent = 'Home';
    $('#helpLede').textContent = 'Where a visit starts: a short set of questions, '
      + 'where you are on the path, and the path itself.';
    $('#helpList').innerHTML = [
      ['A set is ten drill questions.',
       'Mixed across the tools and weighted toward the ones you get wrong most. '
       + 'One answer each, and the first is the one that counts. Skip anything; '
       + 'a skip is not counted against you.'],
      ['The path is an order, not a gate.',
       'Twelve tools, three steps each - read what it is for, be asked about it, '
       + 'then build one - and a mix at the end. Press any tool to go to its next '
       + 'step. Nothing is locked.'],
      ['Nothing counts days.',
       'There is no streak to keep and nothing to lose by stopping. Progress '
       + 'stays in this browser; Progress can save it to a file.'],
    ].map(([lead, detail]) => `<li><b>${lead}</b><span>${detail}</span></li>`).join('');
    return;
  }

  // The mix exercise is all six tools at once over several parts, so none of
  // the six helps describes it either.
  if (ui.view === 'mix') {
    $('#helpMode').textContent = 'Mix';
    $('#helpLede').textContent = 'Four parts, one balance, and a mix to match. '
      + 'Everything the six tools teach, asked at once.';
    $('#helpList').innerHTML = [
      ['You are marked on the master, not on the faders.',
       'Both mixes are rendered and read, and the five readings are put side by '
       + 'side. Any set of moves that arrives at the same balance is the answer — '
       + 'there is no single set of positions to find.'],
      ['Yours, then the one to match, without stopping.',
       'The A/B swaps which mix the clock is playing and leaves the clock running, '
       + 'which is the only way anybody has ever heard a difference this small. '
       + 'Moving a fader brings you back to yours.'],
      ['The drums do not move.',
       'Something has to be the level everything else is set against, and on every '
       + 'desk in the world it is the drums. Without one, the right mix at the '
       + 'wrong loudness would come back every time.'],
      ['Mute and solo are how you listen, not part of the mix.',
       'What gets rendered and marked has everything in it, whatever is soloed '
       + 'when you press submit.'],
      ['Five readings, each with its own address.',
       'How loud, the tonal balance, where things sit, how wide, how dynamic. The '
       + 'tolerance beside each one is what counts as a match at this difficulty, '
       + 'and every one of them has to be inside it.'],
      ['It takes a moment.',
       'A submit renders four bars of four parts twice over and reads five '
       + 'measurements off each. About a second and a half, in this browser, with '
       + 'nothing leaving it.'],
    ].map(([lead, detail]) => `<li><b>${lead}</b><span>${detail}</span></li>`).join('');
    return;
  }

  // Nor does the tool's help describe the sketchpad, which is the one part of
  // this app that does not mark you on anything.
  if (ui.view === 'sketch') {
    $('#helpMode').textContent = 'Sketch';
    $('#helpLede').textContent = 'Somewhere to put an idea before it goes. It is a '
      + 'sketchpad, not a DAW: four tracks, four scenes, and a way out to Logic.';
    $('#helpList').innerHTML = [
      ['Tracks down the left, clips running right.',
       'A column is a scene — everything in one plays together, and the number at '
       + 'the top launches the lot. Tap a slot and it comes in on the next bar, '
       + 'which is why parts land together rather than wherever your finger '
       + 'happened to be. Tap a track\'s name for its instrument, its inserts '
       + 'and its level. The + at the end of the numbers adds a scene, up to '
       + 'eight, and the clips scroll sideways while the names stay put. Press '
       + 'and hold a clip to take it out; it asks first.'],
      ['Tap an empty slot and there is a clip in it.',
       'The panel then shows the grid you draw on: rows are the notes of the key '
       + 'you are in, columns are a division of the bar, and a tap is a note — '
       + 'and you hear each one as you put it down, because knowing the sound you '
       + 'are after is not the same as knowing it is called B flat. With the '
       + 'clock running, what you draw is heard on the next pass as well.'],
      ['Or tap the drums in, which is faster than drawing them.',
       'Three pads on a kit track. They make a sound whether or not you are '
       + 'recording; press Record and play, and every hit lands on the nearest '
       + 'line of the grid — the nearest, not the one before, because a hit a '
       + 'hair early is a hit on the beat.'],
      ['The six tools are the inserts.',
       'The same EQ, compressor, imager, room, delay and saturator the exercises '
       + 'are about, on a track, in series — so what you learned on the bench is '
       + 'what is on the sketch. Each gets a few controls on the track page, and '
       + 'the EQ\'s name opens the whole plugin: the same curve and the same drag '
       + 'as the exercise, pointed at the effect in that track\'s signal path. The '
       + 'other five will follow.'],
      ['Out of here as a MIDI file, or as the stems.',
       'The MIDI is the scene you are on, looped to four bars, as a Type 1 file '
       + 'with a track per part and the drums on channel 10. The stems are the '
       + 'same thing as audio - a 24-bit wav a track, plus the shared room and '
       + 'the mix, with the MIDI alongside them. Everything in the archive starts '
       + 'together and is the same length, so it all drops onto bar one.'],
      ['Everything else is behind the ☰.',
       'The name, the tempo, and the four ways out — the MIDI, the stems, a copy '
       + 'of the sketch, and opening one. None of them are things anybody reaches '
       + 'for while drawing a part, and a row of them across the page is a row of '
       + 'them in the way.'],
      ['It keeps itself in this browser.',
       'Saved on every edit, so a reload does not cost you the idea. There is no '
       + 'account and no server, so Save a copy is the only backup there is.'],
      ['Space plays and stops.',
       'As it does everywhere a musician meets a transport.'],
    ].map(([lead, detail]) => `<li><b>${lead}</b><span>${detail}</span></li>`).join('');
    return;
  }

  $('#helpMode').textContent = tool().label;
  $('#helpLede').textContent = tool().lede;

  // Every tool brings its own interface, and explains its own interface:
  // there is nothing useful the shell can say about a plugin it has not seen.
  const entries = tool().help.map((entry) => [...entry]);

  // Except this, which is about the shell: the pill is the one control that
  // changes what kind of question you are being asked rather than how hard
  // it is, and it is new enough to be worth saying out loud.
  entries.unshift([
    ui.kind === 'drill' ? 'You are on the drills.' : 'Learn it, be drilled on it, or work it.',
    'The tabs under the tool\'s name: Learn is what the tool is for, Drill asks you '
    + 'about it with the plugin put away, and Work has you build the answer on the '
    + 'plugin. The tab stays where you put it when you change tool, so a run of '
    + 'drills across every tool is one click each.',
  ]);

  // The knobs, which work the same on every face.
  entries.push([
    'Every knob: drag it, type it, put it back.',
    'Drag up or down; hold Shift for fine. Click the number above a knob - or press '
    + 'Enter on it - to type a value: 400, 0.4k and 400 Hz are the same frequency, 1.2 s '
    + 'and 1200 ms the same time. Double-click or Alt-click a knob to put it back where '
    + 'it rests. On the face\'s title strip: On, which takes the device out of circuit '
    + 'so you hear the loop with nothing done to it; Undo and Redo; and two slots, A and '
    + 'B, for comparing two settings of your own.',
  ]);

  for (const spec of tool().settings ?? []) {
    entries.push([`${spec.label}: ${spec.options.map((o) => o.label).join(', ')}.`,
      spec.id === 'exercise'
        ? `${spec.options.length} different exercises, not ${spec.options.length} views of one `
          + '- each asks its own question, over the same tool.'
        : 'Up in the setup row, and it changes what you are listening to rather than how hard it is.']);
  }

  $('#helpList').innerHTML = entries
    .map(([lead, detail]) => `<li><b>${lead}</b><span>${detail}</span></li>`)
    .join('');
}

/* ---------- events ---------- */

function wire() {
  // Back, Forward, and a hash typed or pasted into the address bar.
  window.addEventListener('hashchange', () => {
    // The step a set put in the history, arriving: nothing to do.
    if (ui.set && location.hash === SET_HASH) return;
    applyRoute(parseRoute(location.hash, TOOLS));
  });

  for (const button of document.querySelectorAll('[data-view]')) {
    button.addEventListener('click', () => {
      if (ui.view === button.dataset.view) return;
      ui.view = button.dataset.view;
      syncView();
    });
  }

  for (const button of document.querySelectorAll('.tool-tabs [data-kind]')) {
    button.addEventListener('click', () => toTab(button.dataset.kind));
  }
  $('#learnSide').addEventListener('click', (e) => {
    if (e.target.closest('[data-learn="drill"]')) toTab('drill');
  });

  $('#modes').addEventListener('click', (e) => {
    const pill = e.target.closest('[data-train]');
    if (!pill) return;
    pickTools(false);
    if (pill.dataset.train === ui.mode) return;

    ui.mode = pill.dataset.train;
    syncModes();
    syncLearn();
    // The pill stays where it was and the exercise moves to match it, which
    // is what makes a run of drills across all six one click each.
    settleKind();
    fillTiers();
    fillSettings();
    startGame();
  });

  // Arrow keys walk the list, the way a radio group is expected to - down and
  // up now that it is a column, and across as well for anybody used to it.
  $('#modes').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { pickTools(false); $('#toolPick').focus(); return; }
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    e.preventDefault();

    const next = LISTED[(LISTED.indexOf(ui.mode) + step + LISTED.length) % LISTED.length];
    ui.mode = next;
    syncModes();
    syncLearn();
    settleKind();
    fillTiers();
    fillSettings();
    startGame();
    document.querySelector(`[data-train="${next}"]`).focus();
  });
  $('#tier').addEventListener('click', (e) => {
    const pill = e.target.closest('[data-tier]');
    if (!pill || pill.dataset.tier === ui.tier) return;
    ui.tier = pill.dataset.tier;
    fillTiers();
    startGame();
  });
  $('#toolPick').addEventListener('click', () => pickTools(!$('#modes').classList.contains('is-open')));
  $('#modesScrim').addEventListener('click', () => pickTools(false));
  $('#settings').addEventListener('change', (e) => {
    const select = e.target.closest('[data-setting]');
    if (!select) return;

    ui.chosen[ui.mode] = { ...ui.chosen[ui.mode], [select.dataset.setting]: select.value };
    // A setting is part of what the clue sounds like - and an exercise is part
    // of what the answer is - so the round starts again rather than changing
    // under a board that was scored against the old one.
    fillTiers();
    fillSettings();
    startGame();
  });

  $('#picker').addEventListener('click', (e) => {
    const chosen = e.target.closest('[data-option]');
    if (!chosen) return;
    // The option's own id, not the string the DOM kept of it. A chip whose
    // id is the number 3 comes back out of `dataset` as "3", and a scorer
    // that does arithmetic on it - every drill whose answer is an amount -
    // gets a string. The limiter's gain-reduction drill threw on every
    // guess for exactly this reason, from the day it shipped until a browser
    // check pressed one of its chips: `3.0 dB` has no `toFixed`.
    //
    // Looked up rather than coerced, so a slot whose ids really are strings
    // keeps them. `String(option.id)` is how the attribute was written, so
    // it is how to find the way back.
    const slot = tool().slots(ui.tier, settings()).find((one) => one.id === chosen.dataset.slot);
    const option = slot?.options?.find((one) => String(one.id) === chosen.dataset.option);
    ui.guess[chosen.dataset.slot] = option ? option.id : chosen.dataset.option;
    syncAnswer();
  });

  $('#picker').addEventListener('input', (e) => {
    const dial = e.target.closest('[data-dial]');
    if (!dial) return;

    const slot = tool().slots(ui.tier, settings()).find((s) => s.id === dial.dataset.dial);
    ui.guess[slot.id] = dialValue(slot, dial.value);
    syncAnswer();
  });

  $('#submit').addEventListener('click', onSubmit);

  $('#again').addEventListener('click', () => (ui.set ? nextQuestion() : startGame({ fresh: true })));

  $('#play').addEventListener('click', async () => {
    await ui.tool?.toggle?.();
    syncTransport();
  });
  new MutationObserver(() => {
    if (!FACE_TOOLS.isConnected || !FACE_TOOLS.closest('.plugin-head')) mountFaceTools();
  }).observe($('#surface'), { childList: true, subtree: true });
  FACE_TOOLS.querySelector('#undo').addEventListener('click', undoStep);
  FACE_TOOLS.querySelector('#redo').addEventListener('click', redoStep);
  FACE_TOOLS.querySelector('#slotCopy').addEventListener('click', copySlot);
  FACE_TOOLS.addEventListener('click', (e) => {
    const slot = e.target.closest('[data-slot]')?.dataset.slot;
    if (slot) toSlot(slot);
  });
  $('#barAB').addEventListener('click', (e) => {
    const side = e.target.closest('[data-side]')?.dataset.side;
    if (!side || !ui.tool?.hear) return;
    ui.tool.hear(side);
    syncTransport();
  });
  // The face can start, stop and rename on its own, so the bar looks again a
  // few times a second while it is showing. Cheap: two reads and no writes
  // unless something moved.
  setInterval(() => {
    if (ui.view === 'tools' && !ui.learning && !document.hidden) syncTransport();
  }, 300);
  $('#drillClean').addEventListener('click', (e) => {
    setClean(e.currentTarget.getAttribute('aria-pressed') !== 'true');
  });

  $('#hint').addEventListener('click', onHint);
  $('#show').addEventListener('click', onShow);

  $('#onto').addEventListener('click', (e) => {
    setOnto(e.currentTarget.getAttribute('aria-pressed') !== 'true');
  });

  $('#homeSheet').addEventListener('click', onHome);
  $('#setLeave').addEventListener('click', () => endSet());
  $('#setSkip').addEventListener('click', skipQuestion);

  $('#help-btn').addEventListener('click', () => { fillHelp(); $('#help').showModal(); });
  $('#help-close').addEventListener('click', () => $('#help').close());
  $('#help-ok').addEventListener('click', () => $('#help').close());
  $('#progressSheet').addEventListener('click', onProgress);
  $('#import-file').addEventListener('change', (e) => uploadProgress(e.target));

  for (const dialog of document.querySelectorAll('dialog')) {
    // A click on the backdrop lands on the dialog element itself.
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  }

  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea') || document.querySelector('dialog[open]')) return;
    // Space is the transport wherever a musician meets one - including on the
    // sketchpad, where it is the clock rather than a loop.
    if (ui.view === 'sketch' || ui.view === 'mix') {
      if (e.code === 'Space') { e.preventDefault(); ui[ui.view]?.toggle?.(); }
      return;
    }
    // The submit belongs to a round, and neither the analysis view nor the
    // Learn tab has one showing.
    if (ui.view !== 'tools' || ui.learning) return;
    // Undo and redo, the way every editor has them.
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z' || e.key === 'y')) {
      if (FACE_TOOLS.hidden) return;
      e.preventDefault();
      if (e.key === 'y' || e.shiftKey) redoStep();
      else undoStep();
      return;
    }
    if (e.code === 'Space') {
      e.preventDefault();
      Promise.resolve(ui.tool?.toggle?.()).then(syncTransport);
    }
    // A focused control answers Enter itself; submitting as well would submit
    // twice from #submit, and by accident from #hint or #again.
    const answers = e.target.closest('button, a, select, textarea, [role=radio], [contenteditable]');
    if (e.key === 'Enter' && !answers && !$('#submit').disabled) onSubmit();
  });
}

// Where to start: the address if it names somewhere, else wherever this
// browser was last, else Home - which is what a first visit gets, rather
// than the EQ's match exercise cold.
const arrived = parseRoute(location.hash, TOOLS) ?? parseRoute(storedRoute(), TOOLS)
  ?? { view: 'home' };
takeRoute(arrived);

fillModes();
settleKind();
syncKind();
fillTiers();
fillSettings();
wire();
writeRoute({ replace: true });
syncView();
syncLearn();
startGame();

