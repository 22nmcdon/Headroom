// The mix view: four stems, a desk, and a mix to match.
//
// The last of the four things this page can be, and the one that finally asks
// for everything the other three teach. A tool exercise asks you to hear one
// thing change; this asks you to hear four at once and decide which of them
// is wrong - which is what mixing is, and what no single-plugin exercise can
// ever get at.
//
// You are marked on the master. Not on the faders: there are many sets of
// positions that make one balance, and a round that compared your numbers
// with the answer's would be marking a route rather than a destination. So
// both mixes are rendered offline and read, and the five readings are what is
// put side by side.
//
// Mute and solo are not part of the mix. They are how you listen to it, the
// way they are on a desk, so the render that is marked has everything in it
// whatever is soloed at the time.

import { pieceOf, dress, STEMS, STEM_IDS } from './piece.js';
import {
  mixBrief, flatMix, movesIn, gainFor, dbOf, STEPS, TRIM,
  MIX_TIERS, MIX_TIER_IDS, ANCHOR,
} from './brief.js';
import { renderMix, readMaster } from './render.js';
import { markMix, mixAdvice, READING_NAMES } from './score.js';
import { makeStage } from '../sketch/stage.js';
import { roundSeed } from '../learn/game.js';
import { recordMix, mixStats } from '../learn/stats.js';
import { toStep } from '../learn/work/scoring.js';

/** What a fader reads, with its sign on it. */
const writeTrim = (db) => `${db > 0 ? '+' : db < 0 ? '−' : ''}${Math.abs(db).toFixed(1)}`;

/** And a pan, the way a desk writes one. */
const writeSide = (pan) => {
  const amount = Math.round(Math.abs(pan) * 100);
  if (amount < 3) return 'C';
  return `${pan < 0 ? 'L' : 'R'}${amount}`;
};

const writeApart = (off) => `${off.toFixed(2)} dB`;

export class MixPage {
  constructor(el, { engine }) {
    this.el = el;
    this.engine = engine;
    this.tier = 'easy';
    this.stage = null;
    this.building = null;

    this.round = null;     // { brief, piece, answer: readings|null }
    this.mine = flatMix(); // what the faders are on
    this.monitor = {};     // stem id -> 'mute' | 'solo' | null, which is not the mix
    this.listening = 'mine';
    this.attempts = 0;
    this.marked = null;
    this.over = false;
    this.busy = false;
    this.frame = null;

    this.build();
    this.wire();
    this.deal();
  }

  /* --- the shell ----------------------------------------------------------- */

  build() {
    this.el.innerHTML = `
      <div class="mixdesk">
        <div class="mix-head">
          <p class="eyebrow">A mix to match</p>
          <h2 class="mix-title" data-title></h2>
          <p class="lede" data-brief></p>
          <div class="mix-setup">
            <label class="field">
              <span class="field-label">Difficulty</span>
              <select data-tier>
                ${MIX_TIER_IDS.map((id) =>
                  `<option value="${id}">${MIX_TIERS[id].label}</option>`).join('')}
              </select>
            </label>
            <span class="fine" data-record></span>
          </div>
        </div>

        <div class="mix-bar">
          <button class="submit-btn" type="button" data-play>Play</button>
          <!-- The one control that matters most: hearing the two one after
               the other, without the clock stopping. -->
          <div class="ab-switch" role="radiogroup" aria-label="Which mix you are hearing">
            <button class="ab-option" type="button" data-ab="mine" role="radio" aria-checked="true">Yours</button>
            <button class="ab-option" type="button" data-ab="theirs" role="radio" aria-checked="false">The one to match</button>
          </div>
          <span class="mix-pos" data-pos>1.1</span>
        </div>

        <div class="strips" data-strips></div>

        <div class="mix-result" data-result hidden></div>
        <p class="advice" data-advice hidden></p>

        <div class="mix-foot">
          <span class="action-group">
            <button class="link-btn" type="button" data-show>Show me</button>
            <button class="link-btn" type="button" data-flat>Back to flat</button>
            <button class="link-btn" type="button" data-again>Another one</button>
          </span>
          <button class="submit-btn" type="button" data-submit>Submit the mix</button>
        </div>
      </div>`;

    const $ = (sel) => this.el.querySelector(sel);
    this.parts = {
      title: $('[data-title]'),
      brief: $('[data-brief]'),
      tier: $('[data-tier]'),
      record: $('[data-record]'),
      play: $('[data-play]'),
      pos: $('[data-pos]'),
      strips: $('[data-strips]'),
      result: $('[data-result]'),
      advice: $('[data-advice]'),
      submit: $('[data-submit]'),
    };
  }

  wire() {
    const on = (sel, event, fn) => this.el.querySelector(sel).addEventListener(event, fn);

    on('[data-tier]', 'change', (e) => { this.tier = e.target.value; this.deal(); });
    on('[data-play]', 'click', () => this.toggle());
    on('[data-again]', 'click', () => this.deal());
    on('[data-flat]', 'click', () => { this.mine = flatMix(); this.push(); this.drawStrips(); });
    on('[data-show]', 'click', () => this.reveal());
    on('[data-submit]', 'click', () => this.submit());

    for (const button of this.el.querySelectorAll('[data-ab]')) {
      button.addEventListener('click', () => this.hear(button.dataset.ab));
    }

    // One listener for the desk, because the strips are redrawn whole.
    this.parts.strips.addEventListener('input', (e) => this.moved(e));
    this.parts.strips.addEventListener('click', (e) => this.pressed(e));
  }

  /* --- a round ------------------------------------------------------------- */

  deal() {
    const brief = mixBrief(this.tier, roundSeed('mix', this.tier, Math.random()));

    this.round = { brief, piece: pieceOf(brief.piece), answer: null, stamp: null };
    this.mine = flatMix();
    this.monitor = {};
    this.listening = 'mine';
    this.attempts = 0;
    this.marked = null;
    this.over = false;

    this.parts.tier.value = this.tier;
    this.parts.title.textContent = MIX_TIERS[this.tier].label;
    this.parts.brief.textContent = `${MIX_TIERS[this.tier].blurb} `
      + `${this.round.piece.name}, four bars, going round.`;
    this.parts.result.hidden = true;
    this.parts.advice.hidden = true;
    this.parts.submit.disabled = false;
    this.parts.submit.textContent = 'Submit the mix';

    this.drawStrips();
    this.drawRecord();
    this.push();
    this.hear('mine');
  }

  /** What the faders say, as a mix. */
  get mix() { return this.mine; }

  /**
   * What the stage should be playing: a mix, with the monitoring on top.
   *
   * Solo wins over mute, and soloing anything mutes everything else - which
   * is what a solo button does and the only behaviour nobody has to learn.
   */
  monitored(mix) {
    const soloed = STEM_IDS.filter((id) => this.monitor[id] === 'solo');
    return Object.fromEntries(STEM_IDS.map((id) => [id, {
      ...mix[id],
      muted: soloed.length ? !soloed.includes(id) : this.monitor[id] === 'mute',
    }]));
  }

  /* --- the desk ------------------------------------------------------------ */

  drawStrips() {
    this.parts.strips.innerHTML = STEMS.map((stem) => {
      const set = this.mine[stem.id];
      const anchored = stem.id === ANCHOR;
      const state = this.monitor[stem.id];

      return `
        <div class="strip" data-stem="${stem.id}">
          <div class="strip-head">
            <span class="strip-name">${stem.name}</span>
            <span class="strip-db" data-read="gain">${anchored ? 'ref' : writeTrim(dbOf(set.gain))}</span>
          </div>

          <label class="strip-dial">
            <span class="strip-label">Level</span>
            <input type="range" data-dial="gain" data-stem="${stem.id}"
                   min="${TRIM.low}" max="${TRIM.high}" step="${STEPS.gain}"
                   value="${toStep(dbOf(set.gain), STEPS.gain)}" ${anchored ? 'disabled' : ''}>
          </label>

          <label class="strip-dial">
            <span class="strip-label">Pan</span>
            <input type="range" data-dial="pan" data-stem="${stem.id}"
                   min="-1" max="1" step="${STEPS.pan}" value="${set.pan}">
            <span class="strip-read" data-read="pan">${writeSide(set.pan)}</span>
          </label>

          <label class="strip-dial">
            <span class="strip-label">Room</span>
            <input type="range" data-dial="send" data-stem="${stem.id}"
                   min="0" max="1" step="${STEPS.send}" value="${set.send}">
            <span class="strip-read" data-read="send">${Math.round(set.send * 100)}</span>
          </label>

          <div class="strip-outs">
            <button class="strip-btn" type="button" data-hear="mute" data-stem="${stem.id}"
                    aria-pressed="${state === 'mute'}">Mute</button>
            <button class="strip-btn" type="button" data-hear="solo" data-stem="${stem.id}"
                    aria-pressed="${state === 'solo'}">Solo</button>
          </div>
        </div>`;
    }).join('');

    // The drums' fader is the one thing on this desk that does not move. Said
    // on the strip rather than left as a disabled control nobody can explain.
    const anchor = this.parts.strips.querySelector(`[data-stem="${ANCHOR}"] .strip-db`);
    if (anchor) anchor.title = 'The drums are the level everything else is set against.';
  }

  moved(event) {
    const input = event.target.closest('[data-dial]');
    if (!input) return;

    const { dial, stem } = input.dataset;
    const value = Number(input.value);
    const strip = input.closest('.strip');

    this.mine = {
      ...this.mine,
      [stem]: { ...this.mine[stem], [dial]: dial === 'gain' ? gainFor(value) : value },
    };

    const read = strip.querySelector(`[data-read="${dial}"]`);
    if (read) {
      read.textContent = dial === 'gain' ? writeTrim(value)
        : dial === 'pan' ? writeSide(value)
          : String(Math.round(value * 100));
    }

    // Moving a fader while listening to the answer means you meant to move
    // yours. Anything else is a control that silently does nothing.
    if (this.listening !== 'mine') this.hear('mine');
    else this.push();
  }

  pressed(event) {
    const button = event.target.closest('[data-hear]');
    if (!button) return;

    const { hear, stem } = button.dataset;
    this.monitor = { ...this.monitor, [stem]: this.monitor[stem] === hear ? null : hear };

    for (const other of this.parts.strips.querySelectorAll('[data-hear]')) {
      other.setAttribute('aria-pressed', String(this.monitor[other.dataset.stem] === other.dataset.hear));
    }
    this.push();
  }

  /* --- the sound ----------------------------------------------------------- */

  async ready() {
    if (this.stage) return this.stage;
    if (!this.building) {
      const ctx = this.engine.ensure();
      this.building = makeStage(ctx, this.dressed(), { out: this.engine.out })
        .then((stage) => { this.stage = stage; return stage; });
    }
    return this.building;
  }

  /** The piece with whichever mix is being listened to on it. */
  dressed() {
    const mix = this.listening === 'theirs' ? this.round.brief.target : this.mine;
    return dress(this.round.piece, this.monitored(mix));
  }

  push() {
    this.stage?.setProject(this.dressed());
  }

  async toggle() {
    const stage = await this.ready();
    if (stage.playing) {
      stage.stop();
      this.watch(false);
    } else {
      this.push();
      stage.launchScene(0);
      stage.play();
      this.watch(true);
    }
    this.paint();
  }

  hear(which) {
    this.listening = which;
    for (const button of this.el.querySelectorAll('[data-ab]')) {
      button.setAttribute('aria-checked', String(button.dataset.ab === which));
    }
    this.push();
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

  paint() {
    const stage = this.stage;
    this.parts.play.textContent = stage?.playing ? 'Stop' : 'Play';
    this.parts.pos.textContent = stage?.playing
      ? `${((stage.bar - 1) % 4) + 1}.${Math.min(4, Math.floor((stage.tick % stage.transport.perBar) / 480) + 1)}`
      : '1.1';
  }

  /* --- marking ------------------------------------------------------------- */

  /**
   * The answer, rendered and read.
   *
   * Once a round, because neither the stems nor the answer change within one,
   * and a render is a second and a half nobody should pay for twice.
   */
  async answerRead() {
    if (!this.round.answer) {
      const theirs = dress(this.round.piece, this.round.brief.target);
      this.round.answer = readMaster(await renderMix(theirs), 'answer');
    }
    return this.round.answer;
  }

  async submit() {
    if (this.busy || this.over) return;
    this.busy = true;
    this.parts.submit.disabled = true;
    this.parts.submit.textContent = 'Listening to it…';

    try {
      const theirs = await this.answerRead();
      const mine = readMaster(await renderMix(dress(this.round.piece, this.mine)), 'yours');

      this.attempts += 1;
      this.marked = markMix(mine, theirs, this.tier);
      this.drawResult();

      if (this.marked.solved) {
        this.over = true;
        recordMix({
          tier: this.tier,
          attempts: this.attempts,
          solved: true,
          worst: this.marked.worst.kind,
          label: READING_NAMES[this.marked.worst.kind].label,
        });
        this.drawRecord();
      }
    } catch (why) {
      this.parts.advice.hidden = false;
      this.parts.advice.textContent = `That could not be measured: ${why.message}`;
    } finally {
      this.busy = false;
      this.parts.submit.disabled = this.over;
      this.parts.submit.textContent = this.over ? 'That is the mix' : 'Submit the mix';
    }
  }

  drawResult() {
    const { readings, solved } = this.marked;

    this.parts.result.hidden = false;
    this.parts.result.innerHTML = `
      <p class="eyebrow">${solved ? 'That is it' : `Attempt ${this.attempts}`}</p>
      <div class="marks">
        ${readings.map((reading) => `
          <div class="mark" data-mark="${reading.mark}">
            <span class="mark-name">${reading.label}</span>
            <span class="mark-off">${writeApart(reading.off)}</span>
            <span class="mark-where">${reading.off < 0.005 ? 'as it should be'
              : `${reading.where ? `${reading.where} · ` : ''}${reading.allowed} is a match`}</span>
          </div>`).join('')}
      </div>
      <p class="fine">You are marked on the master, not on the faders: any set of
         moves that gets there is the answer.</p>`;

    this.parts.advice.hidden = false;
    this.parts.advice.textContent = mixAdvice(this.marked);
  }

  /** The answer, on the faders, with the round closed. */
  reveal() {
    this.mine = Object.fromEntries(STEM_IDS.map((id) => [id, { ...this.round.brief.target[id] }]));
    this.over = true;
    this.drawStrips();
    this.push();

    this.parts.submit.disabled = true;
    this.parts.submit.textContent = 'Shown';
    this.parts.advice.hidden = false;
    this.parts.advice.textContent = `That is where it was: ${movesIn(this.round.brief.target)
      .filter((stem) => stem.db || stem.pan || stem.send)
      .map((stem) => `${stem.name} ${writeTrim(stem.db)}${stem.pan ? ` ${writeSide(stem.pan)}` : ''}${stem.send ? `, ${Math.round(stem.send * 100)} in the room` : ''}`)
      .join('; ')}.`;

    if (this.attempts) {
      recordMix({
        tier: this.tier,
        attempts: this.attempts,
        solved: false,
        worst: this.marked?.worst.kind ?? 'balance',
        label: READING_NAMES[this.marked?.worst.kind ?? 'balance'].label,
      });
      this.drawRecord();
    }
  }

  drawRecord() {
    const stats = mixStats(this.tier);
    if (!stats.played) {
      this.parts.record.textContent = 'Nothing at this difficulty yet.';
      return;
    }

    const worst = Object.entries(stats.byAnswer)
      .map(([key, seen]) => ({ key, ...seen }))
      .sort((a, b) => (a.solved / a.seen) - (b.solved / b.seen))[0];

    this.parts.record.textContent = `${stats.played} mixed, ${stats.won} matched.`
      + (worst ? ` The one that catches you out: ${worst.label.toLowerCase()}.` : '');
  }

  /* --- the view's lifecycle ------------------------------------------------- */

  show() { this.paint(); }

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
