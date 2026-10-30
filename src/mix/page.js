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
  MIX_TIERS, MIX_TIER_IDS, ANCHOR, TONE_BANDS, colouring, CARVES, CARVE_NAMES,
} from './brief.js';
import { EQ_REST } from '../sketch/knobs.js';
import { readMix } from './render.js';
import { markMix, mixAdvice, READING_NAMES } from './score.js';
import { anchorOf, matchTrim, staleFor, gainOfTrim } from './monitor.js';
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

/**
 * What was done to one stem, for the reveal.
 *
 * A level of nothing is left out rather than printed as "0.0", which a tone
 * round made necessary: every stem on one sits at its flat level, so the old
 * line read "Bass 0.0; Keys 0.0" and said nothing about the only thing that
 * had moved.
 */
const tellMove = (stem) => [
  stem.name,
  stem.db ? writeTrim(stem.db) : null,
  stem.pan ? writeSide(stem.pan) : null,
  stem.tone ? `${BAND_NAMES[stem.tone.band].toLowerCase()} ${writeTrim(stem.tone.db)}` : null,
  stem.send ? `${Math.round(stem.send * 100)} in the room` : null,
].filter(Boolean).join(' ');

/** What a tone control reads. Zero is flat and says so rather than "0.0". */
const writeTone = (db) => (db === 0 ? 'flat' : writeTrim(db));

/** What each band is called where somebody has to read it. */
const BAND_NAMES = { low: 'Low', mid: 'Mid', high: 'High' };

/** And what it is, for the label a screen reader gets. */
const BAND_AT = { low: '120 hertz', mid: '800 hertz', high: '6 kilohertz' };

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

    // The monitor's own state, which is not part of any mix: whether the
    // reference is being trimmed to your level, the one mix that has been
    // rendered and read for real, and what the reference measured.
    this.matching = false;
    this.anchor = null;
    this.reference = null;
    this.measuring = false;

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
          <!-- The reference, brought down to your level. Its own button
               rather than something the A/B does silently, because what it
               hides is one of the six things you are marked on. -->
          <button class="match-btn" type="button" data-match aria-pressed="false">Match loudness</button>
          <span class="mix-pos" data-pos>1.1</span>
        </div>

        <p class="fine mix-note">
          <span data-match-note></span>
          <button class="link-btn" type="button" data-rematch hidden>Measure it again</button>
        </p>

        <div class="strips" data-strips></div>

        <!-- Its own section rather than three more dials on every strip.
             Four columns like the desk above it, so at phone width it becomes
             the next thing down instead of making each strip tall enough to
             push its own knobs out of the chassis. Hidden on the tiers that
             do not ask for it, because a control that does nothing is worse
             than no control. -->
        <div class="tone-desk" data-tone hidden>
          <div class="tone-head">
            <span class="tone-cap">Tone</span>
            <span class="fine">120 Hz · 800 Hz · 6 kHz, fixed</span>
          </div>
          <div class="tone-strips" data-tone-strips></div>
        </div>

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
      tone: $('[data-tone]'),
      toneStrips: $('[data-tone-strips]'),
      match: $('[data-match]'),
      matchNote: $('[data-match-note]'),
      rematch: $('[data-rematch]'),
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
    on('[data-flat]', 'click', () => { this.mine = this.start(); this.push(); this.drawDesk(); });
    on('[data-show]', 'click', () => this.reveal());
    on('[data-submit]', 'click', () => this.submit());
    on('[data-match]', 'click', () => this.toggleMatch());
    on('[data-rematch]', 'click', () => this.measureMatch());

    for (const button of this.el.querySelectorAll('[data-ab]')) {
      button.addEventListener('click', () => this.hear(button.dataset.ab));
    }

    // One listener for the desk, because the strips are redrawn whole.
    this.parts.strips.addEventListener('input', (e) => this.moved(e));
    this.parts.strips.addEventListener('click', (e) => this.pressed(e));
    this.parts.toneStrips.addEventListener('input', (e) => this.toned(e));
  }

  /* --- a round ------------------------------------------------------------- */

  deal() {
    const brief = mixBrief(this.tier, roundSeed('mix', this.tier, Math.random()));

    this.round = { brief, piece: pieceOf(brief.piece), answer: null, stamp: null };
    this.mine = this.start();
    this.monitor = {};
    this.listening = 'mine';
    this.attempts = 0;
    this.marked = null;
    this.over = false;

    // A match is a measurement of one particular pair of mixes, and a new
    // round is a new pair. Carrying the switch over would carry a claim that
    // is no longer true, so the switch goes off with the anchor.
    this.matching = false;
    this.anchor = null;
    this.reference = null;

    this.parts.tier.value = this.tier;
    this.parts.title.textContent = MIX_TIERS[this.tier].label;
    this.parts.brief.textContent = `${MIX_TIERS[this.tier].blurb} `
      + `${this.whichPairs()}${this.round.piece.name}, four bars, going round.`;
    this.parts.result.hidden = true;
    this.parts.advice.hidden = true;
    this.parts.submit.disabled = false;
    this.parts.submit.textContent = 'Submit the mix';

    this.drawDesk();
    this.drawRecord();
    this.drawMatch();
    this.push();
    this.hear('mine');
  }

  /**
   * Which parts are in each other's way, on the round that is about that.
   *
   * Said out loud rather than left to be worked out. Hearing that two parts
   * are fighting is a skill and it is not this round's skill: what is being
   * practised is how much to take out, and a round that hid which pair it
   * meant would be two exercises stacked, failed on the first.
   */
  whichPairs() {
    if (!MIX_TIERS[this.tier]?.carves) return '';
    // "In the way of" rather than "over", because measured they are not over:
    // on short-night the bass's share of the low is 9.24 and the kick's is
    // 9.61, which is the same place rather than on top of it, and that is
    // exactly the problem.
    const say = ({ masker, masked }) =>
      `the ${CARVE_NAMES[masker].name} is in the ${CARVE_NAMES[masked].own} way`;
    const said = CARVES.map(say).join(' and ');
    return `${said[0].toUpperCase()}${said.slice(1)} — cut what is covering, `
      + 'not what is covered. ';
  }

  /**
   * The mix a round opens on.
   *
   * Flat, and on a tone round that includes a resting EQ on every stem - the
   * same insert the answer has, so the two renders differ in what the EQ is
   * set to and in nothing else. Measured, a resting one is a wire to within
   * 6.33e-8 of a sample, so this costs the other tiers nothing it could be
   * blamed for and it keeps the graph from being rebuilt under a moving
   * slider.
   */
  start() {
    const mix = flatMix();
    if (!this.colours.length) return mix;
    return Object.fromEntries(STEM_IDS.map((id) => [id, {
      ...mix[id], inserts: ['eq'], settings: { eq: { ...EQ_REST } },
    }]));
  }

  /** What the faders say, as a mix. */
  get mix() { return this.mine; }

  /** Which stems this tier lets you colour, and in which band. */
  get colours() { return colouring(this.tier); }

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

  /** The whole desk: the strips, and the tone of them when a round asks. */
  drawDesk() {
    this.drawStrips();

    const wanted = this.colours.length > 0;
    this.parts.tone.hidden = !wanted;
    this.parts.toneStrips.innerHTML = wanted ? this.toneStrips() : '';
  }

  /**
   * One column a stem, three bands each - except the drums.
   *
   * The kit is the reference here for the reason its fader is: something has
   * to be the thing the others are heard against, and a round where every
   * part can be any colour is a round with no reference tone in it. Said on
   * the column rather than left as three disabled sliders nobody can explain.
   */
  toneStrips() {
    const live = (id, band) => this.colours.some((one) => one.id === id && one.band === band);

    return STEMS.map((stem) => {
      const eq = this.mine[stem.id]?.settings?.eq ?? EQ_REST;
      const toned = this.colours.some((one) => one.id === stem.id);

      const band = (id) => `
        <label class="tone-band">
          <span class="tone-band-name">${BAND_NAMES[id]}</span>
          <input type="range" data-tone-band="${id}" data-stem="${stem.id}"
                 min="-12" max="12" step="${STEPS.tone}" value="${eq[id] ?? 0}"
                 aria-label="${stem.name}, ${BAND_NAMES[id].toLowerCase()} at ${BAND_AT[id]}"
                 ${live(stem.id, id) ? '' : 'disabled'}>
          <span class="tone-read" data-tone-read="${id}">${writeTone(eq[id] ?? 0)}</span>
        </label>`;

      return `
        <div class="tone-strip" data-tone-stem="${stem.id}">
          <span class="tone-name">${stem.name}${toned ? '' : ` <span class="fine">· ${this.whyFixed(stem.id)}</span>`}</span>
          ${['low', 'mid', 'high'].map(band).join('')}
        </div>`;
    }).join('');
  }

  /**
   * Why a column's sliders are not live, said on the column.
   *
   * A disabled control with no explanation is worse than no control, and the
   * two tiers that show this desk have two different reasons: on a tone round
   * the kit is the reference everything else is heard against, and on a carve
   * round the part being masked is not the part to reach for - the whole
   * lesson is that you move what is covering the sound, not the sound.
   */
  whyFixed(id) {
    if (!MIX_TIERS[this.tier]?.carves) return 'reference';
    const pair = CARVES.find((one) => one.masked === id);
    return pair ? 'the one being covered' : 'not in the way';
  }

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

    // The trim follows the fader: a match that was measured and then left
    // behind by the desk is a match in name only. See `monitor.js` for what
    // following it costs, which is measured and is not nothing.
    this.applyTrim();
  }

  /**
   * A tone control moved.
   *
   * Its own handler rather than a branch inside `moved`, because what it
   * writes is a different shape: a band inside an insert's settings rather
   * than one of the three numbers a strip holds.
   */
  toned(event) {
    // The attribute is `data-tone-band`, not the obvious short name, which
    // the EQ plugin's own six band buttons already use. Nothing broke -
    // this listener is on the tone section and those buttons are in another
    // view - but a selector that means two things in one document is a bug
    // with a date on it. The browser check that found it was counting
    // eighteen sliders where there are twelve.
    const input = event.target.closest('[data-tone-band]');
    if (!input) return;

    const { toneBand: band, stem } = input.dataset;
    const value = Number(input.value);
    const was = this.mine[stem]?.settings?.eq ?? EQ_REST;

    this.mine = {
      ...this.mine,
      [stem]: {
        ...this.mine[stem],
        inserts: ['eq'],
        settings: { ...this.mine[stem]?.settings, eq: { ...was, [band]: value } },
      },
    };

    const read = input.closest('.tone-strip')?.querySelector(`[data-tone-read="${band}"]`);
    if (read) read.textContent = writeTone(value);

    // Same rule as a fader: moving one while listening to the answer means
    // you meant to move yours.
    if (this.listening !== 'mine') this.hear('mine');
    else this.push();

    // Unlike a fader, this one the trim cannot follow - a colour move changes
    // how loud its own part is, which is what the estimate adds up. So the
    // readout says the match is out of date rather than carrying on.
    this.applyTrim();
    this.drawMatch();
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
      // The monitor trim sits between the desk and the output, which is the
      // only place it can go and be honest: everything the marking reads is
      // rendered from the project, and the project ends at the stage.
      this.trim = ctx.createGain();
      this.trim.connect(this.engine.out);
      this.building = makeStage(ctx, this.dressed(), { out: this.trim })
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
    this.applyTrim();
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

  /* --- matching the levels -------------------------------------------------- */

  /**
   * What the monitor is doing, which is nothing unless two things are true.
   *
   * The trim only goes on while the reference is the thing being heard. Your
   * own mix always plays at its own level, because its level is part of what
   * is being decided and a monitor that moved it would be moving the work.
   */
  applyTrim() {
    if (!this.trim) return;
    const db = this.matching && this.listening === 'theirs'
      ? matchTrim(this.anchor, this.mine, this.reference)
      : 0;
    const at = this.engine.ctx?.currentTime ?? 0;
    this.trim.gain.setTargetAtTime(gainOfTrim(db), at, 0.01);
  }

  async toggleMatch() {
    if (this.measuring) return;
    if (this.matching) {
      this.matching = false;
      this.applyTrim();
      this.drawMatch();
      return;
    }
    await this.measureMatch();
  }

  /**
   * Both mixes, rendered and read, so the trim is a measurement.
   *
   * Two renders, the same two a submit pays for, and it is deliberately not a
   * submit: nothing is marked, nothing is recorded and the attempt count does
   * not move. Pressing a monitoring control cannot cost somebody a go.
   */
  async measureMatch() {
    if (this.measuring || this.busy) return;
    this.measuring = true;
    this.drawMatch();

    try {
      const theirs = await this.answerRead();
      const mine = await readMix(dress(this.round.piece, this.mine), 'yours');
      this.reference = theirs.loudness.values.integrated;
      this.anchor = anchorOf(this.mine, mine);
      this.matching = true;
    } catch (why) {
      this.matching = false;
      this.anchor = null;
      this.parts.advice.hidden = false;
      this.parts.advice.textContent = `The levels could not be measured: ${why.message}`;
    } finally {
      this.measuring = false;
      this.applyTrim();
      this.drawMatch();
    }
  }

  /**
   * What the control says, and the one number it does not say.
   *
   * Never the trim. The trim is the difference between your loudness and the
   * reference's, which is the `loudness` reading this round is marked on - so
   * printing it would hand over a sixth of the answer in exchange for a
   * tidier readout. The explanation is there instead, which is the part worth
   * knowing anyway.
   */
  drawMatch() {
    const stale = this.matching ? staleFor(this.anchor, this.mine) : null;

    this.parts.match.setAttribute('aria-pressed', String(this.matching));
    this.parts.match.disabled = this.measuring;
    this.parts.match.textContent = this.measuring ? 'Measuring…' : 'Match loudness';
    this.parts.rematch.hidden = !stale;

    this.parts.matchNote.textContent = this.measuring
      ? 'Rendering both of them, which takes a moment.'
      : this.matching
        ? (stale
          ? `The reference is playing at your level, but ${stale}.`
          : 'The reference is playing at your level, so what is left to hear is '
            + 'the mix. Switch it off to hear whether the whole thing is in the right place.')
        : 'Louder sounds better, so two mixes at two levels cannot be compared. '
          + 'This trims the reference to your level.';
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
      this.round.answer = await readMix(theirs, 'answer');
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
      const mine = await readMix(dress(this.round.piece, this.mine), 'yours');

      this.attempts += 1;
      this.marked = markMix(mine, theirs, this.tier);
      this.drawResult();

      // A submit has just rendered both of them, so the anchor is free and is
      // exact. Which is the right way round: by the time somebody is
      // submitting they are close, and close is where the estimate's error
      // would have mattered most.
      this.reference = theirs.loudness.values.integrated;
      this.anchor = anchorOf(this.mine, mine);
      this.applyTrim();
      this.drawMatch();

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
    this.drawDesk();
    this.applyTrim();
    this.drawMatch();
    this.push();

    this.parts.submit.disabled = true;
    this.parts.submit.textContent = 'Shown';
    this.parts.advice.hidden = false;
    this.parts.advice.textContent = `That is where it was: ${movesIn(this.round.brief.target)
      .filter((stem) => stem.db || stem.pan || stem.send || stem.tone)
      .map((stem) => tellMove(stem))
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
    try { this.trim?.disconnect(); } catch { /* already gone */ }
    this.trim = null;
  }
}
