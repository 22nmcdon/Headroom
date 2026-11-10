// Home: where a visit starts.
//
// A first visit used to land on the EQ's match exercise - a six-band
// parametric, a target you cannot see - with a line above it offering a path
// in a dialog. This is the path, on a page, with the one thing worth doing in
// a few minutes at the top of it: a set of ten drill questions.
//
// What is on it is all read off what the app already keeps. The set comes from
// the drill buckets, "pick up where you left off" is the path's next step,
// "worth working on" is the weakest answer and what it gets heard as. This file
// only draws it: the shell builds the model and handles the buttons, which
// carry `data-home` and say what they are for.

/** Text that came from somewhere, made safe to put in markup. */
const esc = (text) => String(text ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** "Tuesday 10 November", in the words a page would use. */
export const dayOf = (date) =>
  date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

/** The set about to be asked, before it starts. */
function today(model) {
  const { set, date } = model;
  return `
    <div class="today">
      <p class="today-eyebrow">Today · ${esc(dayOf(date))}</p>
      <h2 class="today-title">Ten questions, a few minutes</h2>
      <p class="today-lede">Mixed across the tools, and weighted toward what keeps
        catching you out. One answer each — the first one is the one that counts,
        and the answer comes straight back.</p>
      <ul class="today-mix" aria-label="What is in it">
        ${set.tools.map((tool) => `<li>${esc(tool.label)} ×${tool.count}</li>`).join('')}
      </ul>
      <div class="today-go">
        <button class="today-start" type="button" data-home="start">Start the set</button>
        <span class="today-fine">Skip any question · no streak to keep</span>
      </div>
    </div>`;
}

/** The set just finished, said plainly. */
function lastSet(model) {
  const { last } = model;
  const heard = last.misheard.slice(0, 3).map((miss) =>
    `<li>${esc(miss.label)}: it was ${esc(miss.answer)}, you heard ${esc(miss.heard)}</li>`).join('');

  return `
    <div class="today">
      <p class="today-eyebrow">That set</p>
      <h2 class="today-title">${last.right} of ${last.asked} right first time</h2>
      <ul class="today-mix" aria-label="By tool">
        ${last.byTool.map((tool) => `<li>${esc(tool.label)} ${tool.right} of ${tool.asked}</li>`).join('')}
      </ul>
      ${heard ? `<ul class="today-heard">${heard}</ul>` : ''}
      ${last.skipped ? `<p class="today-fine">${last.skipped} skipped, and not counted.</p>` : ''}
      <div class="today-go">
        <button class="today-start" type="button" data-home="start">Another set</button>
        <button class="today-link" type="button" data-home="done">Done</button>
      </div>
    </div>`;
}

function pickUp(model) {
  const { next } = model;
  if (!next) {
    return `
      <div class="home-card">
        <p class="home-label">Pick up where you left off</p>
        <p class="home-line">You have been through all of it.</p>
        <p class="home-fine">The path is a starting order, not a ceiling.</p>
      </div>`;
  }
  return `
    <div class="home-card">
      <p class="home-label">Pick up where you left off</p>
      <p class="home-line">${esc(next.label)}</p>
      <p class="home-fine">${esc(next.where)}</p>
      <button class="link-btn" type="button" data-home="continue">Continue</button>
    </div>`;
}

function weakSpot(model) {
  const { weak } = model;
  if (!weak) {
    return `
      <div class="home-card">
        <p class="home-label">Worth working on</p>
        <p class="home-fine">A few more drill questions and this will say which answer
          keeps catching you out, and what you hear it as.</p>
      </div>`;
  }
  return `
    <div class="home-card">
      <p class="home-label">Worth working on</p>
      <p class="home-line">${esc(weak.label)}</p>
      <p class="home-fine">${esc(weak.line)}</p>
      <button class="link-btn" type="button" data-home="weak">Drill it</button>
    </div>`;
}

/** One tool on the path: its three steps as three marks. */
function card(tool) {
  const marks = tool.marks.map((mark, i) =>
    `<span class="path-mark is-${mark}" title="${['Read', 'Drill', 'Build'][i]}: ${
      { done: 'done', started: 'started', none: 'not yet' }[mark]}"></span>`).join('');

  return `
    <li>
      <button class="path-card${tool.next ? ' is-next' : ''}" type="button" data-home-tool="${esc(tool.id)}">
        <span class="path-card-head">
          <span class="path-card-num">${esc(tool.num)} · ${esc(tool.group)}</span>
          <span class="path-card-status">${esc(tool.status)}</span>
        </span>
        <span class="path-card-name">${esc(tool.name)}</span>
        <span class="path-card-marks">${marks}<span class="path-card-note">${esc(tool.note)}</span></span>
      </button>
    </li>`;
}

/** Draw the whole page into `el`. */
export function drawHome(el, model) {
  el.innerHTML = `
    <div class="home">
      <section class="home-top" aria-label="Today">
        ${model.last ? lastSet(model) : today(model)}
        <div class="home-side">
          ${pickUp(model)}
          ${weakSpot(model)}
        </div>
      </section>

      <section class="home-path" aria-labelledby="home-path-title">
        <div class="home-path-head">
          <h2 id="home-path-title">The path</h2>
          <p>Twelve tools in teaching order, three steps each: read, drill, build.
            Nothing is locked — it is an order, not a gate.</p>
        </div>
        <ol class="path-cards">
          ${model.cards.map(card).join('')}
          <li>
            <button class="path-card is-mix${model.mix.next ? ' is-next' : ''}" type="button" data-home="mix">
              <span class="path-card-head">
                <span class="path-card-num">13 · All of them</span>
                <span class="path-card-status">${model.mix.done ? 'Done' : model.mix.next ? 'Next' : ''}</span>
              </span>
              <span class="path-card-name">Mix something</span>
              <span class="path-card-note">Four parts, one balance to match</span>
            </button>
          </li>
        </ol>
        <p class="path-key">
          <span><span class="path-mark is-done"></span> done</span>
          <span><span class="path-mark is-started"></span> started</span>
          <span><span class="path-mark is-none"></span> not yet</span>
        </p>
      </section>
    </div>`;
}
