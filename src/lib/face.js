// What every plugin face has in common, written once.
//
// Twelve faces had grown the same dozen lines each: is it playing, start and
// stop it, what is the monitor on, what are the settings, put these settings
// on it, hear one side of the A/B or the other, what is the other side called,
// lock it, unlock it. Copied rather than shared, they drifted - one face read
// its root by its own class and threw when the class was renamed, one forgot
// the guard every other one had - and a change to how any of them worked was
// twelve changes.
//
// A face extends this and keeps what is its own: its markup, its drawing, its
// knobs, and any of these it genuinely does differently (the EQ's state is a
// list of bands, not a settings object). What it must provide is `this.el`,
// `this.player`, and - for the defaults below - `this.settings`, `buildKnobs`
// and `changed`.
//
// The A/B is the host's, not the device's: which side you hear is a thing the
// round asks for, and the bar it lives in is the shell's. So the face keeps the
// answer - which side, and what the other side is called - and draws a switch
// for it only where it still has one of its own.

export class PluginFace {
  /**
   * `mine` and `other` are what the two sides of the A/B are called - Yours
   * and Target, mostly, and the other until an exercise names it Untreated
   * or Bypass. `hearAttr` is the attribute the face's own switch carries, for
   * the faces that keep one: most use `data-hear`, and the three that already
   * had a `data-hear` meaning something else on the face used their own.
   */
  constructor({ mine = 'Yours', other = 'Target', hearAttr = 'hear' } = {}) {
    this.mineName = mine;
    this.otherName = other;
    this.hearAttr = hearAttr;
    this.hearing = 'mine';
    this.bypassed = false;
  }

  /* ---------- the On switch ---------- */

  /**
   * The lamp on the title strip, as a switch: on is in circuit, off is the
   * loop heard with nothing done to it. The device's own control - a bypass
   * compares yours with nothing, where the A/B compares yours with somebody
   * else's.
   *
   * A face on the sketchpad keeps a plain lamp: a track's insert has its own
   * on/off beside the chip that adds it, and two switches for one thing is
   * one too many.
   */
  lamp() {
    if (this.role === 'insert') return '<span class="plugin-lamp"></span>';
    if (!this.bypassWired) {
      this.bypassWired = true;
      this.el.addEventListener('click', (event) => {
        if (event.target.closest('[data-bypass]')) this.setBypass(!this.bypassed);
      });
    }
    return `<button class="plugin-onoff${this.bypassed ? ' is-off' : ''}" type="button" data-bypass`
      + ` aria-pressed="${!this.bypassed}" title="On: in circuit. Press to bypass it.">`
      + `<span class="plugin-lamp"></span><span class="plugin-onoff-word">${this.bypassed ? 'Off' : 'On'}</span></button>`;
  }

  /** In circuit, or bypassed. */
  setBypass(on) {
    this.bypassed = !!on;
    this.player?.setBypass?.(this.bypassed);
    for (const button of this.el.querySelectorAll('[data-bypass]')) {
      button.classList.toggle('is-off', this.bypassed);
      button.setAttribute('aria-pressed', String(!this.bypassed));
      const word = button.querySelector('.plugin-onoff-word');
      if (word) word.textContent = this.bypassed ? 'Off' : 'On';
    }
  }

  /** The element the whole face is drawn in, inside `this.el`. */
  get root() {
    return this.el?.querySelector('.plugin') ?? null;
  }

  /**
   * Whether the loop is going. Asked of the face rather than of its player:
   * reaching through `tool.player.playing` from the shell worked and was a
   * hole in the contract.
   */
  isPlaying() {
    return !!this.player?.playing;
  }

  async toggle() {
    if (this.player.playing) {
      this.player.stop();
      this.playing(false);
      return;
    }
    await this.player.play();
    this.playing(true);
  }

  /**
   * What the transport is showing. The face's own drawing hangs off this -
   * a loop of frames while it plays - so a face overrides it and the shell
   * only ever calls `toggle`.
   */
  playing() {}

  /** What the monitor is set to. */
  source() {
    return this.player?.source ?? null;
  }

  /** What the controls are set to. Copied, so a caller cannot move them by holding it. */
  state() {
    return { ...this.settings };
  }

  /** Put settings on the controls, and on everything that hangs off them. */
  setState(next) {
    Object.assign(this.settings, next);
    this.buildKnobs();
    this.changed();
  }

  /** Hear one side of the A/B: 'mine' or 'theirs'. */
  hear(which) {
    this.player.hear(which);
    this.hearing = which;
    for (const button of this.el.querySelectorAll(`[data-${this.hearAttr}]`)) {
      button.classList.toggle('is-on', button.getAttribute(`data-${this.hearAttr}`) === which);
    }
  }

  /** Which side is being heard. */
  heard() {
    return this.hearing;
  }

  /** What this side of the A/B is called. */
  mineLabel() {
    return this.mineName;
  }

  /** What the other side of the A/B is currently called. */
  abLabel() {
    return this.otherName;
  }

  /** The other side of the A/B, named for what it actually is. */
  nameAB(label) {
    this.otherName = label;
    const slot = this.el.querySelector(`[data-${this.hearAttr}="theirs"]`);
    if (slot) slot.textContent = label;
  }

  /** Stop taking input: the round is over and the answer is on the face. */
  lock() {
    this.interactive = false;
    this.root?.classList.add('is-locked');
  }

  unlock() {
    this.interactive = true;
    this.root?.classList.remove('is-locked');
  }
}
