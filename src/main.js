import { TOOLS, TOOL_IDS, toolOf, exerciseOf } from './bench/registry.js';
import { bench } from './bench/session.js';
import {
  createGame, submitGuess, makePuzzle, roundSeed, reveal,
  settingsFor, startingGuess, hintFor, hintsLeft, takeHint, showAnswer,
} from './game.js';
import { Engine } from './audio.js';
import {
  getStats, recordGame, weakestKind, resetStats, ATTEMPT_BANDS,
  exportProgress, importProgress,
} from './stats.js';
import { engraveNote } from './engrave.js';
import { renderPicker, syncPicker, pickerState, dialValue } from './bench/picker.js';
import { makeLog } from './bench/log.js';
import { notesFor } from './notes/index.js';

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
  // What a drill has put in the material, so the clean A/B can take it out
  // and put it back. Null whenever the round is not a drill.
  fault: null,
  chosen: {}, // settings, per mode, so switching back finds them as you left them
  guess: {},
  game: null,
  log: null, // what has been tried this round, newest first
};

const tool = () => toolOf(ui.mode);
const settings = () => settingsFor(ui.mode, ui.chosen[ui.mode] ?? {});

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

function fillTiers() {
  const spec = tool();
  $('#tier').innerHTML = Object.entries(spec.tiers)
    .map(([id, tier]) => `<option value="${id}">${tier.label} — ${tier.blurb}</option>`)
    .join('');
  if (!spec.tiers[ui.tier]) ui.tier = Object.keys(spec.tiers)[0];
  $('#tier').value = ui.tier;
}

function fillSettings() {
  const chosen = settings();
  $('#settings').innerHTML = (tool().settings ?? []).map((setting) => `
    <label class="field">
      <span class="field-label">${setting.label}</span>
      <select data-setting="${setting.id}">${setting.options
        .map((option) => `<option value="${option.id}"`
          + `${option.id === chosen[setting.id] ? ' selected' : ''}>${option.label}</option>`)
        .join('')}</select>
    </label>`).join('');
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
  // The clean side is only offered where there is a fault to take out, which
  // is what makes it an A/B rather than a mute.
  ui.fault = drilling ? (exercise.faultOf?.(ui.game.puzzle) ?? null) : null;
  $('#drillClean').hidden = !ui.fault;
  setClean(false);

  await desk.put(await openTool(), exercise, ui.game.puzzle);
  syncAnswer();
  syncTransport();
}

/* ---------- the drill's transport ---------- */

/** Play and Stop, on a tool nobody can see. */
function syncTransport() {
  $('#drillPlay').textContent = ui.tool?.isPlaying?.() ? 'Stop' : 'Play';
}

/**
 * Hear it without the fault in it.
 *
 * Built out of `setFault`, which every tool already implements and which the
 * session already uses to put the fault there - so this is the same A/B the
 * fix exercises have, driven from outside the tool rather than from a button
 * on it. The loop never stops: the fault crossfades out and back, which is
 * the only way a comparison is worth anything.
 */
function setClean(on) {
  const button = $('#drillClean');
  button.setAttribute('aria-pressed', on ? 'true' : 'false');
  button.textContent = on ? 'Hear it again' : 'Hear it clean';
  if (ui.fault) ui.tool?.setFault(on ? null : ui.fault);
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
  const stats = getStats(ui.mode, ui.tier);
  const tier = tool().tiers[ui.tier];

  $('#statsMode').textContent = tool().label;
  $('#stats-scope').textContent = `${tier.label} · ${tier.blurb}`;

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

/* ---------- the cheat sheet ---------- */

function fillHelp() {
  $('#helpMode').textContent = tool().label;
  $('#helpLede').textContent = tool().lede;

  const tier = tool().tiers[ui.tier];

  // Every tool brings its own interface, and explains its own interface:
  // there is nothing useful the shell can say about a plugin it has not seen.
  const entries = tool().help.map((entry) => [...entry]);

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
  $('#modes').addEventListener('click', (e) => {
    const pill = e.target.closest('[data-train]');
    if (!pill || pill.dataset.train === ui.mode) return;

    ui.mode = pill.dataset.train;
    syncModes();
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
    if (e.code === 'Space') {
      e.preventDefault();
      // Space is the transport wherever a musician meets one.
      Promise.resolve(ui.tool?.toggle?.()).then(syncTransport);
    }
    if (e.key === 'Enter' && !$('#submit').disabled) onSubmit();
  });
}

fillModes();
fillTiers();
fillSettings();
wire();
startGame();

// A first visit gets the rules. Failing open is the right way round: a private
// window forgets and shows them again, where guessing "seen" would hide the one
// thing a first visitor needs.
function seenHelp() {
  try { return localStorage.getItem('headroom.seenHelp') === '1'; } catch { return false; }
}

if (!seenHelp()) {
  fillHelp();
  $('#help').showModal();
  try { localStorage.setItem('headroom.seenHelp', '1'); } catch { /* private window */ }
}
