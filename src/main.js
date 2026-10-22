import { TOOLS, TOOL_IDS, toolOf, exerciseOf } from './bench/registry.js';
import { bench } from './bench/session.js';
import {
  createGame, submitGuess, makePuzzle, roundSeed, reveal,
  settingsFor, startingGuess, hintFor, hintsLeft, takeHint, showAnswer,
} from './game.js';
import { Engine } from './audio.js';
import {
  getStats, recordGame, weakestKind, resetStats, ATTEMPT_BANDS,
  exportProgress, importProgress, notesRead, markRead,
} from './stats.js';
import { progress, where, PATH_TIER } from './bench/path.js';
import { engraveNote } from './engrave.js';
import { renderPicker, syncPicker, pickerState, dialValue } from './bench/picker.js';
import { makeLog } from './bench/log.js';
import { notesFor } from './notes/index.js';
import { AnalysisPage } from './analysis/page.js';
import { SketchPage } from './sketch/grid.js';
import { MixPage } from './mix/page.js';

const $ = (sel) => document.querySelector(sel);

/** A reading only ever needs its accidentals: "3.15k", "B♭", "−4.5 dB". */
const writeSymbol = (target, text) => engraveNote(target, text);

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
  // Which of the three this page is being used as. The top of the hierarchy:
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
  game: null,
  log: null, // what has been tried this round, newest first
};

const tool = () => toolOf(ui.mode);
const settings = () => settingsFor(ui.mode, ui.chosen[ui.mode] ?? {});

/**
 * The exercises this tool offers of the kind being practised.
 *
 * Two kinds, and they are different activities: working at a tool, and being
 * asked about one. Keeping them apart is what lets somebody run the drill on
 * all six in a sitting without going through the exercise dropdown six times.
 */
const exercisesOfKind = (id, kind) =>
  Object.values(TOOLS[id].exercises).filter((exercise) => !!exercise.drill === (kind === 'drill'));

/** Which kind an exercise id belongs to. */
const kindOf = (id, exercise) => (TOOLS[id].exercises[exercise]?.drill ? 'drill' : 'work');

/* ---------- setup row ---------- */

/** The tools, on the page rather than behind a click. */
function fillModes() {
  $('#modes').innerHTML = TOOL_IDS
    .map((id) => `<button class="mode-pill" type="button" role="radio" data-train="${id}"`
      + ` aria-checked="${id === ui.mode}" title="${TOOLS[id].blurb}">${TOOLS[id].label}</button>`)
    .join('');
}

function syncModes() {
  for (const pill of document.querySelectorAll('[data-train]')) {
    pill.setAttribute('aria-checked', pill.dataset.train === ui.mode ? 'true' : 'false');
  }
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

  $('#tier').innerHTML = Object.entries(spec.tiers)
    .map(([id, tier]) => `<option value="${id}">${tier.label} — ${tierBlurb(id)}</option>`)
    .join('');
  $('#tier').value = ui.tier;
}

/**
 * The settings row, with the exercise list narrowed to the kind on the pill.
 *
 * Narrowed rather than reordered: in drills the dropdown offers the drills
 * and nothing else, so the pill is the only thing deciding which activity
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
 * Put the chosen exercise inside the kind on the pill.
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

/** The three things this page is for. The ids match the sections and buttons. */
const VIEWS = ['tools', 'analysis', 'mix', 'sketch'];

/** What the chart's head says when the page is not a tool. */
const VIEW_HEAD = {
  analysis: { mark: 'Analysis', blurb: 'read a track back' },
  mix: { mark: 'Mix', blurb: 'four parts, one balance' },
  sketch: { mark: 'Sketch', blurb: 'get the idea down' },
};

/**
 * Show one of the three things this app is.
 *
 * Everything above the sheet belongs to the tools, so all of it goes when the
 * page is not one: the tool strip, the work-or-drills pill, the difficulty
 * row, the status, and the dock with its submit button. Neither of the other
 * two has a round to submit.
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

  $('#modes').hidden = !working;
  $('#dock').hidden = !working;
  document.querySelector('.kind-switch').hidden = !working;
  document.querySelector('.setup').hidden = !working;
  $('#puzzleStatus').hidden = !working;

  $('#modeMark').textContent = working ? tool().label : VIEW_HEAD[view].mark;
  $('#modeBlurb').textContent = working
    ? tool().blurb.toLowerCase() : VIEW_HEAD[view].blurb;

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
}

function syncKind() {
  for (const button of document.querySelectorAll('[data-kind]')) {
    button.setAttribute('aria-checked', button.dataset.kind === ui.kind ? 'true' : 'false');
  }
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

  renderPicker(picker, tool().slots(ui.tier, chosen), ui.guess, { write: writeSymbol });

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

  ui.tool = toolOf(ui.mode).open(surface, { engine, onChange: () => syncAnswer() });
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
  const drilling = !!exercise.drill;

  // A drill puts the tool away and asks instead. The tool is still there and
  // still playing - it owns the audio, and a drill is a listening question -
  // but its display is not, because on every one of these tools the display
  // is the answer: the analyser draws the boost, the harmonic bars draw even
  // against odd. Hidden, every canvas reads as zero by zero and every draw is
  // a no-op, so nothing is spent on pictures nobody is looking at.
  $('#surface').hidden = drilling;
  $('#drill').hidden = !drilling;
  $('#picker').hidden = !drilling;
  $('#clue').hidden = true;
  // Not the advice. It is a line about the tool, and this used to hide all of
  // it, every time, in the same synchronous pass that buildClue had just
  // written it. Five paragraphs, set and never seen by anybody.

  $('#drillAsk').textContent = exercise.ask ?? '';

  await desk.put(await openTool(), exercise, ui.game.puzzle);

  // After the put, and it has to be. A drill that sets the tool's own
  // controls has only just set them, and what the clean A/B flips back to is
  // where they ended up - read before the put, it would be the last round's.
  ui.clean = drilling ? cleanWay(exercise, ui.game.puzzle) : null;
  $('#drillClean').hidden = !ui.clean;
  setClean(false);

  syncAnswer();
  syncTransport();
}

/* ---------- the drill's transport ---------- */

/** Play and Stop, on a tool nobody can see. */
function syncTransport() {
  $('#drillPlay').textContent = ui.tool?.isPlaying?.() ? 'Stop' : 'Play';
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
 * Closed until asked for. The help dialog says which button does what; this
 * says what a pre-delay is, why even harmonics sound like an octave, and what
 * summing to mono actually costs - the half of this project that was written
 * down years' worth of commits ago and addressed only to whoever was next to
 * change the code.
 */
function buildNotes() {
  const notes = notesFor(ui.mode);
  const panel = $('#notes');

  panel.hidden = !notes;
  if (!notes) return;

  panel.open = false;
  $('#notesOpen').textContent = `Notes on ${notes.title.toLowerCase()}`;
  $('#notesBody').innerHTML = notes.sections
    .map((section) => `<section><h3>${section.heading}</h3>${section.body
      .split('\n\n').map((line) => `<p>${line}</p>`).join('')}</section>`)
    .join('');
}

/* ---------- lifecycle ---------- */

async function startGame({ fresh = false } = {}) {
  const chosen = settings();
  // `fresh` is "another one" - a new puzzle of the same shape. Without it the
  // salt is the tier, so switching tool, tier or exercise and coming back
  // finds the round you left rather than a different one.
  const seed = roundSeed(ui.mode, ui.tier, fresh ? Math.random() : ui.tier);

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

  // Nothing is restored into a round. What this replaces re-ran the scoring
  // over stored guesses and could print different text than had been shown,
  // because the audio it marks against loads after the board does.
  render();
  // A tool is not answered by naming anything; a drill is answered by nothing
  // else, so it gets the first word.
  say(exerciseOf(ui.mode, chosen).opening ?? tool().opening ?? 'Play it, then name what you heard.');
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
    write: writeSymbol,
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

  if (solved) {
    say(`That is it — in ${count} ${count === 1 ? 'attempt' : 'attempts'}.`, { matched: true });
  }

  const played = $('#played');
  played.textContent = '';
  played.appendChild(document.createTextNode(solved ? 'You built ' : 'It was '));

  const symbol = document.createElement('span');
  symbol.className = 'symbol';
  writeSymbol(symbol, answer.symbol);
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
  ui.tool?.showTarget(exercise.answerOf?.(game.puzzle) ?? game.puzzle.answer ?? null);
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
  say('There it is. The controls are still live — work your way onto it.');
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

  // The tier, and nothing else. What was here was `Daily #294 · Easy`, and
  // with the daily gone the number names nothing - every round is its own.
  // The exercise is already a control in the setup row and the tool is already
  // in the sheet head, so repeating either here would be furniture.
  const status = $('#puzzleStatus');
  status.textContent = tool().tiers[game.puzzle.tier].label;
  status.dataset.state = game.status === 'playing' ? 'playing' : 'done';

  $('#modeMark').textContent = tool().label;
  $('#modeBlurb').textContent = tool().blurb.toLowerCase();

  const solved = game.status === 'solved';
  $('#picker').classList.toggle('done', solved);
  $('#dock').classList.toggle('done', solved);
  $('#again').hidden = !solved && game.status !== 'shown';
  $('#again').textContent = 'Another one';
  if (game.status === 'playing') $('#played').textContent = '';

  // Both ways out are there from the first attempt and stay there. Hiding them
  // until somebody has struggled enough would be the ceiling again, wearing a
  // different hat.
  const left = hintsLeft(game);
  const hint = $('#hint');
  hint.hidden = left === 0 || solved;
  hint.textContent = game.hinted === 0 ? 'Hint' : `Another hint (${left} left)`;
  $('#hint-line').hidden = game.hinted === 0;

  const show = $('#show');
  show.hidden = game.status !== 'playing';

  syncAnswer();
}

/* ---------- stats ---------- */

function showStats() {
  const stats = getStats(ui.mode, ui.tier, ui.kind);
  const tier = tool().tiers[ui.tier];

  $('#statsMode').textContent = tool().label;
  // Which bucket this is. Working at a tool and being asked about one are
  // different activities and kept apart, so the dialog has to say which of
  // them it is showing or the numbers mean nothing.
  $('#stats-scope').textContent =
    `${ui.kind === 'drill' ? 'Drills' : 'Work'} · ${tier.label} · ${tierBlurb(ui.tier)}`;

  // Three readings, not five. The streak and the best streak that were here
  // measured how recently you played rather than how well you hear, and with
  // the daily gone there was nothing to break a streak at all.
  const solved = stats.played ? Math.round((stats.won / stats.played) * 100) : 0;
  // Which band most solves land in - the one thing the distribution below
  // says that is worth having at a glance, and the honest version of what the
  // streak was pretending to measure.
  const typical = stats.won
    ? ATTEMPT_BANDS.reduce((best, band) =>
        (stats.attempts[band.id] ?? 0) > (stats.attempts[best.id] ?? 0) ? band : best)
    : null;
  $('#stats-summary').innerHTML = [
    ['Played', stats.played],
    ['Solved %', solved],
    ['Usually in', typical ? typical.label : '—'],
  ].map(([text, value]) => `<div><strong>${value}</strong><span>${text}</span></div>`).join('');

  // Six bands, always all six. What was here sliced the rows to the tier's
  // guess ceiling, which no longer exists - and converging in two rather than
  // nine is the clearest signal of improvement this app has, so the bands stay
  // fixed and comparable rather than shifting with the tool.
  const counts = ATTEMPT_BANDS.map((band) => stats.attempts[band.id] ?? 0);
  const max = Math.max(1, ...counts);
  $('#stats-dist').innerHTML = ATTEMPT_BANDS.map((band, i) => {
    const width = Math.max(7, Math.round((counts[i] / max) * 100));
    return `<div class="dist-row"><span>${band.label}</span>`
      + `<div class="bar" style="width:${width}%">${counts[i]}</div></div>`;
  }).join('');

  const weak = weakestKind(stats);
  $('#stats-weak').textContent = weak
    ? `${weak.label} is the one to work on — solved ${Math.round(weak.rate * 100)}% of ${weak.seen}.`
      + (weak.confusedWith ? ` You usually hear it as ${weak.confusedWith.label}.` : '')
    : 'A few more rounds and this will say which one is worth working on.';

  note('');
  $('#stats').showModal();
}

/* ---------- progress, as a file ---------- */

/** The line under the buttons: what just happened to the progress. */
function note(text) {
  const line = $('#stats-note');
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

  showStats();
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
  solvesOf: (tool, tier, kind) => getStats(tool, tier, kind).won,
  hasRead: (tool) => notesRead().includes(tool),
});

function showPath() {
  const state = pathState();
  $('#path-where').textContent = where(state);

  $('#path-list').innerHTML = state.steps.map((step) => {
    const here = step.done ? 'is-done' : step === state.next ? 'is-next' : '';
    const mark = step.done ? '✓' : step === state.next ? '→' : '';
    const count = step.step === 'read' ? ''
      : `${Math.min(step.solves, 3)} of 3`;

    return `<li><button class="path-step ${here}" type="button" data-step="${step.id}">
      <span class="path-mark">${mark}</span>
      <span class="path-what">
        <span class="path-label">${TOOLS[step.tool].label} — ${step.label}</span>
        <span class="path-detail">${step.detail}</span>
      </span>
      <span class="path-where">${count}</span>
    </button></li>`;
  }).join('');

  $('#path').showModal();
}

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

  $('#path').close();
  if (ui.view !== 'tools') {
    ui.view = 'tools';
    syncView();
  }

  ui.mode = step.tool;
  if (step.kind) {
    ui.kind = step.kind;
    ui.tier = step.tier ?? PATH_TIER;
  }

  syncModes();
  settleKind();
  syncKind();
  fillTiers();
  fillSettings();
  await startGame();

  if (step.step !== 'read') return;

  // Open the notes and put them on screen, which is the step itself.
  const notes = $('#notes');
  notes.open = true;
  notes.scrollIntoView({ block: 'center', behavior: 'smooth' });
  markRead(step.tool);
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
      ['Tracks across, scenes down.',
       'A row is a scene - everything in one row plays together, and the number '
       + 'on the left launches the lot. Tap a slot and it comes in on the next '
       + 'bar, which is why parts land together rather than wherever your finger '
       + 'happened to be.'],
      ['Tap an empty slot and there is a clip in it.',
       'The panel then shows the grid you draw on: rows are the notes of the key '
       + 'you are in, columns are a division of the bar, and a tap is a note. '
       + 'With the clock running, what you draw is heard on the next pass.'],
      ['Or type the chords, which is faster than drawing them.',
       'A line like "Cm7 | A♭maj7 | E♭ | B♭" fills the clip, one chord a bar, '
       + 'voiced to move as little as possible from the chord before it — so four '
       + 'symbols sound like a progression rather than four separate chords. The '
       + 'line is kept with the clip, so you can come back and change a symbol.'],
      ['The six tools are the inserts.',
       'The same EQ, compressor, imager, room, delay and saturator the exercises '
       + 'are about, on a track, in series - so what you learned on the bench is '
       + 'what is on the sketch.'],
      ['Out of here as a MIDI file, or as the stems.',
       'The MIDI is the scene you are on, looped to four bars, as a Type 1 file '
       + 'with a track per part and the drums on channel 10. The stems are the '
       + 'same thing as audio - a 24-bit wav a track, plus the shared room and '
       + 'the mix, with the MIDI alongside them. Everything in the archive starts '
       + 'together and is the same length, so it all drops onto bar one.'],
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

  const tier = tool().tiers[ui.tier];

  // Every tool brings its own interface, and explains its own interface:
  // there is nothing useful the shell can say about a plugin it has not seen.
  const entries = tool().help.map((entry) => [...entry]);

  // Except this, which is about the shell: the pill is the one control that
  // changes what kind of question you are being asked rather than how hard
  // it is, and it is new enough to be worth saying out loud.
  entries.unshift([
    ui.kind === 'drill' ? 'You are on the drills.' : 'Work at it, or be drilled on it.',
    'The pill under the tools switches between building the answer on the plugin '
    + 'and being asked about it with the plugin put away. It stays where you put '
    + 'it when you change tool, so a run of all six drills is one click each.',
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
  for (const button of document.querySelectorAll('[data-view]')) {
    button.addEventListener('click', () => {
      if (ui.view === button.dataset.view) return;
      ui.view = button.dataset.view;
      syncView();
    });
  }

  for (const button of document.querySelectorAll('[data-kind]')) {
    button.addEventListener('click', () => {
      if (ui.kind === button.dataset.kind) return;
      ui.kind = button.dataset.kind;
      settleKind();
      syncKind();
      // After settleKind, because a tier is described by the exercise and
      // the exercise has only just changed.
      fillTiers();
      fillSettings();
      startGame();
    });
  }

  $('#modes').addEventListener('click', (e) => {
    const pill = e.target.closest('[data-train]');
    if (!pill || pill.dataset.train === ui.mode) return;

    ui.mode = pill.dataset.train;
    syncModes();
    // The pill stays where it was and the exercise moves to match it, which
    // is what makes a run of drills across all six one click each.
    settleKind();
    fillTiers();
    fillSettings();
    startGame();
  });

  // Arrow keys walk the strip, the way a radio group is expected to.
  $('#modes').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();

    const step = e.key === 'ArrowRight' ? 1 : -1;
    const next = TOOL_IDS[(TOOL_IDS.indexOf(ui.mode) + step + TOOL_IDS.length) % TOOL_IDS.length];
    ui.mode = next;
    syncModes();
    settleKind();
    fillTiers();
    fillSettings();
    startGame();
    document.querySelector(`[data-train="${next}"]`).focus();
  });
  $('#tier').addEventListener('change', (e) => { ui.tier = e.target.value; startGame(); });
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
    ui.guess[chosen.dataset.slot] = chosen.dataset.option;
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

  $('#again').addEventListener('click', () => startGame({ fresh: true }));

  $('#drillPlay').addEventListener('click', async () => {
    await ui.tool?.toggle?.();
    syncTransport();
  });
  $('#drillClean').addEventListener('click', (e) => {
    setClean(e.currentTarget.getAttribute('aria-pressed') !== 'true');
  });

  $('#hint').addEventListener('click', onHint);
  $('#show').addEventListener('click', onShow);

  $('#path-btn').addEventListener('click', showPath);
  $('#path-close').addEventListener('click', () => $('#path').close());
  $('#path-ok').addEventListener('click', () => $('#path').close());
  $('#path-list').addEventListener('click', (e) => {
    const step = e.target.closest('[data-step]');
    if (step) goTo(step.dataset.step);
  });

  $('#firstStart').addEventListener('click', () => { dismissFirst(); showPath(); });
  $('#firstDismiss').addEventListener('click', dismissFirst);

  // Opening the notes is the path's reading step, wherever it is opened from.
  $('#notes').addEventListener('toggle', () => {
    if ($('#notes').open) markRead(ui.mode);
  });

  $('#help-btn').addEventListener('click', () => { fillHelp(); $('#help').showModal(); });
  $('#help-close').addEventListener('click', () => $('#help').close());
  $('#help-ok').addEventListener('click', () => $('#help').close());
  $('#stats-btn').addEventListener('click', showStats);
  $('#stats-close').addEventListener('click', () => $('#stats').close());
  $('#stats-ok').addEventListener('click', () => $('#stats').close());
  $('#reset-stats').addEventListener('click', () => {
    resetStats();
    showStats();
    note('Progress cleared.');
  });
  $('#export-stats').addEventListener('click', downloadProgress);
  $('#import-stats').addEventListener('click', () => $('#import-file').click());
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
    // The submit belongs to a round, and the analysis view does not have one.
    if (ui.view === 'analysis') return;
    if (e.code === 'Space') {
      e.preventDefault();
      Promise.resolve(ui.tool?.toggle?.()).then(syncTransport);
    }
    if (e.key === 'Enter' && !$('#submit').disabled) onSubmit();
  });
}

fillModes();
settleKind();
syncKind();
fillTiers();
fillSettings();
wire();
syncView();
startGame();

/* ---------- a first visit ---------- */

// One line in the page rather than a dialog over it. What was here opened the
// help the moment somebody arrived - a thing to dismiss before seeing the app
// at all, explaining the EQ, which is the hardest thing in here to arrive at
// cold. The line offers the path instead, and takes no for an answer.
//
// Failing open is still the right way round: a private window forgets and
// offers again, where guessing "seen" would hide the one thing a first
// visitor needs.
function seenHelp() {
  try { return localStorage.getItem('headroom.seenHelp') === '1'; } catch { return false; }
}

function dismissFirst() {
  $('#firstLine').hidden = true;
  try { localStorage.setItem('headroom.seenHelp', '1'); } catch { /* private window */ }
}

$('#firstLine').hidden = seenHelp();
