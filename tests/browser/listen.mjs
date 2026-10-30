// Listening somewhere else: that the mono fold really sums, that the small
// speaker really takes the ends off, and that neither of them touches what
// gets marked.
//
// A browser check because all three are claims about a graph. The fold is a
// gain told to take one channel, which is the specification's own way of
// saying "down-mix" and is therefore exactly the kind of thing that works
// until a browser decides otherwise; the small speaker is four poles of
// biquad whose response nobody can read off the source; and "touches nothing
// that is marked" is a claim about two code paths not meeting, which only
// shows up when both are run.
//
// The last of those is the one that would fail quietly. A monitor mode wired
// into the render would mark somebody on what their laptop speakers do, and
// the only symptom would be that the tolerances had all got harder.

import { open } from './harness.mjs';

export const name = 'listen';

export async function check({ browser, at, say }) {
  const problems = [];
  const { page, noise } = await open(browser, at, { view: 'mix' });
  problems.push(...noise);

  const out = await page.evaluate(async () => {
    const { makeMonitor, SMALL_SPEAKER, LISTEN_IDS } = await import('./src/mix/monitor.js');

    const RATE = 48000;
    const N = RATE; // a second, which is long enough for the filters to settle

    /**
     * The monitor's own response, measured by running something through it.
     *
     * Two channels that are each other's opposite for the fold, and a tone at
     * a frequency for the filters: between them they say whether each mode is
     * doing the thing it is named after.
     */
    const through = async (mode, make) => {
      const ctx = new OfflineAudioContext(2, N, RATE);
      const buf = ctx.createBuffer(2, N, RATE);
      make(buf.getChannelData(0), buf.getChannelData(1));

      const monitor = makeMonitor(ctx, ctx.destination);
      monitor.setListen(mode, 0);

      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(monitor.input);
      src.start(0);

      const done = await ctx.startRendering();
      // The second half only: the filters ring at the start and the
      // crossfade takes twenty milliseconds.
      const from = Math.round(N / 2);
      let energy = 0;
      let sides = 0;
      for (let i = from; i < N; i += 1) {
        const l = done.getChannelData(0)[i];
        const r = done.getChannelData(1)[i];
        energy += l * l + r * r;
        sides += (l - r) * (l - r);
      }
      const n = N - from;
      return {
        level: 10 * Math.log10(Math.max(energy / n, 1e-20)),
        sides: 10 * Math.log10(Math.max(sides / n, 1e-20)),
      };
    };

    const tone = (hz, flip = false) => (left, right) => {
      for (let i = 0; i < left.length; i += 1) {
        const x = Math.sin((2 * Math.PI * hz * i) / RATE) * 0.5;
        left[i] = x;
        right[i] = flip ? -x : x;
      }
    };

    /* --- what each mode does to a signal that is nothing but sides -------- */

    const folds = [];
    for (const mode of LISTEN_IDS) {
      const same = await through(mode, tone(1000));
      const opposite = await through(mode, tone(1000, true));
      folds.push({ mode, same: same.level, opposite: opposite.level, sides: same.sides });
    }

    /* --- and the small speaker's own corners ------------------------------ */

    const hz = [60, 100, 200, 400, 800, 2000, 6000, 8000, 12000, 16000];
    const response = [];
    for (const one of hz) {
      const full = await through('full', tone(one));
      const small = await through('phone', tone(one));
      response.push({ hz: one, by: small.level - full.level });
    }

    return { folds, response, corners: SMALL_SPEAKER };
  });

  say('two channels that agree, and two that are each other\'s opposite\n');
  say('  mode     the same   opposite   what is left of the sides');
  for (const row of out.folds) {
    say(`  ${row.mode.padEnd(8)} ${row.same.toFixed(1).padStart(8)} ${row.opposite.toFixed(1).padStart(10)}`
      + ` ${row.sides.toFixed(1).padStart(27)}`);
  }

  const by = (mode) => out.folds.find((row) => row.mode === mode);
  // A fold sums, so two channels that are each other's opposite cancel to
  // nothing. If they do not, nothing is being summed.
  for (const mode of ['mono', 'phone']) {
    const row = by(mode);
    if (row.opposite > row.same - 40) {
      problems.push(`on ${mode}, two opposite channels came back only`
        + ` ${(row.same - row.opposite).toFixed(1)} dB down, so nothing is being summed`);
    }
  }
  if (by('full').opposite < by('full').same - 1) {
    problems.push('the full-range path is summing to mono, which is the one thing it must not do');
  }

  say(`\n  the small speaker, against full range, with corners at`
    + ` ${out.corners.from} Hz and ${out.corners.to} Hz\n`);
  say('  frequency        by');
  for (const row of out.response) {
    say(`  ${`${row.hz} Hz`.padStart(9)} ${row.by.toFixed(1).padStart(9)} dB`);
  }

  const lost = (hz) => out.response.find((row) => row.hz === hz)?.by ?? 0;
  // A corner is where it is three decibels down, and two poles is twelve
  // decibels an octave below that.
  if (lost(400) > -2 || lost(400) < -4.5) {
    problems.push(`the corner at 400 Hz reads ${lost(400).toFixed(1)} dB, which is not a corner`);
  }
  if (lost(100) > -20) problems.push(`100 Hz survived the small speaker at ${lost(100).toFixed(1)} dB`);
  if (lost(60) > -28) problems.push(`60 Hz survived the small speaker at ${lost(60).toFixed(1)} dB`);
  if (lost(16000) > -18) problems.push(`16 kHz survived the small speaker at ${lost(16000).toFixed(1)} dB`);
  if (Math.abs(lost(2000)) > 1.5) {
    problems.push(`the middle is ${lost(2000).toFixed(1)} dB off, so the small speaker is not flat where it should be`);
  }

  /* --- and that none of it reaches what is marked ------------------------- */

  const marked = await page.evaluate(async () => {
    const { Engine } = await import('./src/core/audio.js');
    const { MixPage } = await import('./src/mix/page.js');
    const { readMix } = await import('./src/mix/render.js');
    const { dress } = await import('./src/mix/piece.js');
    const { distance } = await import('./src/gap.js');

    const el = document.createElement('div');
    el.style.display = 'none';
    document.body.append(el);

    const engine = new Engine();
    engine.ensure();
    const view = new MixPage(el, { engine });
    view.tier = 'medium';
    view.deal();
    await view.ready();

    // The same mix read twice, with the monitor set two different ways. If
    // any of this were in the render, the two would differ.
    view.listenOn('full');
    const a = await readMix(dress(view.round.piece, view.mine), 'yours');
    view.listenOn('phone');
    const b = await readMix(dress(view.round.piece, view.mine), 'yours');

    const off = {};
    for (const kind of ['loudness', 'balance', 'width', 'crest']) {
      off[kind] = distance(a[kind], b[kind]).off;
    }

    const listening = view.speakers.listening;
    view.destroy();
    el.remove();
    return { off, listening };
  });

  say(`\n  the same mix rendered with the monitor on "${marked.listening}", against full range\n`);
  for (const [kind, off] of Object.entries(marked.off)) {
    say(`  ${kind.padEnd(10)} ${off.toExponential(2)}`);
    // Not `=== 0`: two renders of one project agree to about a part in ten
    // million rather than exactly, and that is the renderer's own floor
    // rather than anything this is doing.
    if (off > 1e-6) {
      problems.push(`a monitor mode moved the ${kind} reading by ${off.toExponential(2)},`
        + ' so it is in the render and not in the monitor');
    }
  }

  await page.close();
  return problems;
}
