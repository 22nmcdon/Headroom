// A compression insert, and whether it still has two channels afterwards.
//
// This is a browser check and not a unit test because what broke here was not
// arithmetic anybody wrote down - it was Web Audio's own channel rules. A
// ChannelMerger's inputs are one channel wide, so a stereo track arriving at
// one is summed to (L+R)/2 before any code of ours sees it, and a one-channel
// output is copied back to both sides on the way out. Nothing in
// src/plugins/compressor/dsp.js is wrong in that story and nothing in
// tests/comp.test.js could have caught it.
//
// Measured before the fix, a 220 Hz tone through an insert at ratio 1:
//
//     position        in L        in R       out L       out R
//     hard left     -6.02 dB     silent   -12.04 dB   -12.04 dB
//     half left     -6.71 dB   -14.36 dB   -9.72 dB    -9.72 dB
//     centre        -9.03 dB   -9.03 dB    -9.03 dB    -9.03 dB
//     out of phase  -6.02 dB   -6.02 dB      silent      silent
//
// Three faults in four rows: the image gone, the level depending on where the
// signal sat, and an out-of-phase pair cancelling to nothing - all of it at
// ratio 1, where the compressor is a wire. The centre row passing is why it
// went unseen for as long as it did.
//
// It renders offline rather than driving the interface, because the question
// is about a graph and not about a face. Offline is also the only way to get
// a whole buffer back and look at every sample of it.

export const name = 'stereo';

/** Near enough for a render: a tenth of a decibel. */
const CLOSE = 0.1;

/**
 * How far off centre a hard-panned source has to read, in decibels.
 *
 * The placement reading clamps at MOST_OFF_CENTRE, which is 24, and all six
 * inserts measured exactly that on a source with nothing on the other side.
 * Twenty is the bar rather than twenty-four so that an insert which legally
 * pulls a little toward the middle - a room does - is not a failure, while
 * one that has collapsed to mono, which reads zero, is.
 */
const SIDED = 20;

/**
 * And how far off centre a centred source is allowed to come out.
 *
 * Half a decibel for five of the six. The reverb is the exception and it is
 * geometry rather than a fault: `imageSources` puts the source at 0.37 across
 * the room and the listener's two ears either side of 0.68, so the source is
 * off the median plane by nearly a third of the width and the left ear really
 * is nearer. Measured at 1.11 dB, which is what a room does and what a plate
 * would not - so it is allowed two and held to it, rather than waved through.
 */
const CENTRED = { reverb: 2 };
const CENTRED_ELSE = 0.5;

/** Below this an out-of-phase pair has been summed away rather than passed. */
const SURVIVED = 0.1;

export async function check({ browser, at, say }) {
  const problems = [];
  const page = await browser.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  await page.goto(at, { waitUntil: 'networkidle' });

  const rows = await page.evaluate(async () => {
    const { makeEffect } = await import('./src/core/effects.js');
    const RATE = 48000;
    const N = RATE / 4;
    const db = (v) => (v > 1e-7 ? 20 * Math.log10(v) : null);

    // Positions, as the amplitude pair an equal-power panner would make, plus
    // the two that are not positions at all: a mono source, and a pair that
    // sums to nothing.
    const WHERE = {
      'hard left': [0.5, 0],
      'half left': [0.5 * Math.cos(Math.PI / 8), 0.5 * Math.sin(Math.PI / 8)],
      centre: [0.5 * Math.SQRT1_2, 0.5 * Math.SQRT1_2],
      'hard right': [0, 0.5],
      'out of phase': [0.5, -0.5],
    };

    const out = [];
    for (const [name, [gl, gr]] of Object.entries(WHERE)) {
      for (const channels of [1, 2]) {
        // A mono source is the case the splitter in front would get wrong on
        // its own: discrete interpretation leaves channel two silent, so a
        // mono synth would come out hard left. Only worth asking once.
        if (channels === 1 && name !== 'centre') continue;

        const ctx = new OfflineAudioContext(2, N, RATE);
        const buf = ctx.createBuffer(channels, N, RATE);
        for (let i = 0; i < N; i += 1) {
          const s = Math.sin((2 * Math.PI * 220 * i) / RATE);
          if (channels === 1) buf.getChannelData(0)[i] = s * 0.5;
          else { buf.getChannelData(0)[i] = s * gl; buf.getChannelData(1)[i] = s * gr; }
        }

        const src = ctx.createBufferSource();
        src.buffer = buf;
        // Ratio 1 with the threshold out of the way: the compressor is a
        // wire, so anything that comes out different is the channels and not
        // the compression.
        const comp = await makeEffect(ctx, 'compression', {
          settings: { threshold: 0, ratio: 1, knee: 0, makeup: 0, mix: 1 },
        });
        src.connect(comp.in);
        comp.out.connect(ctx.destination);
        src.start();

        const done = await ctx.startRendering();
        const peak = (ch) => {
          let p = 0;
          for (const v of done.getChannelData(ch)) p = Math.max(p, Math.abs(v));
          return p;
        };
        // Signed, at a sample where the tone is near its crest, so a side
        // that came back inverted reads as inverted rather than as equal.
        const crest = Math.round(RATE / 220 / 4);
        out.push({
          name: channels === 1 ? 'mono source' : name,
          inL: channels === 1 ? db(0.5) : db(Math.abs(gl)),
          inR: channels === 1 ? db(0.5) : db(Math.abs(gr)),
          outL: db(peak(0)),
          outR: db(peak(1)),
          signL: Math.sign(done.getChannelData(0)[crest]),
          signR: Math.sign(done.getChannelData(1)[crest]),
        });
      }
    }
    return out;
  });

  const show = (v) => (v === null ? 'silent' : `${v.toFixed(2)} dB`);
  say('a 220 Hz tone through a compression insert at ratio 1 - a wire\n');
  say('  position        in L        in R       out L       out R');
  for (const r of rows) {
    say(`  ${r.name.padEnd(14)} ${show(r.inL).padStart(9)} ${show(r.inR).padStart(11)}`
      + ` ${show(r.outL).padStart(11)} ${show(r.outR).padStart(11)}`);
  }

  for (const r of rows) {
    // Each side has to come out at the level it went in. A wire that changes
    // the level is the down-mix, and the row it shows up on tells you which
    // way: hard-panned loses 6 dB where centred loses none.
    for (const [which, went, came] of [['left', r.inL, r.outL], ['right', r.inR, r.outR]]) {
      if (went === null && came === null) continue;
      if (went === null) {
        problems.push(`${r.name}: the ${which} went in silent and came out at ${show(came)}`);
        continue;
      }
      if (came === null) {
        problems.push(`${r.name}: the ${which} went in at ${show(went)} and came out silent`);
        continue;
      }
      if (Math.abs(came - went) > CLOSE) {
        problems.push(`${r.name}: the ${which} went in at ${show(went)} and came out at `
          + `${show(came)}`);
      }
    }
  }

  // And the polarity, which is the half of an image that a level cannot see:
  // the out-of-phase pair has to still be out of phase.
  const flipped = rows.find((r) => r.name === 'out of phase');
  if (flipped && flipped.signL === flipped.signR) {
    problems.push('out of phase: the two sides came out the same way up');
  }

  // Then the same question with the compressor doing its job, which is the
  // one the rows above cannot ask: a wire that keeps two channels might still
  // be a compressor that works them by different amounts, and that would
  // swing the image in time with the music. Through the graph rather than
  // through runStereo, because the point is the whole path.
  const bite = await page.evaluate(async () => {
    const { makeEffect } = await import('./src/core/effects.js');
    const RATE = 48000;
    const N = RATE / 4;

    const ctx = new OfflineAudioContext(2, N, RATE);
    const buf = ctx.createBuffer(2, N, RATE);
    // Eighteen to one between the sides, which is what the image is here.
    for (let i = 0; i < N; i += 1) {
      const s = Math.sin((2 * Math.PI * 220 * i) / RATE);
      buf.getChannelData(0)[i] = s * 0.9;
      buf.getChannelData(1)[i] = s * 0.05;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const comp = await makeEffect(ctx, 'compression', {
      settings: {
        threshold: -24, ratio: 8, knee: 0, attack: 1, release: 50, makeup: 0, mix: 1,
      },
    });
    src.connect(comp.in);
    comp.out.connect(ctx.destination);
    src.start();

    const done = await ctx.startRendering();
    const L = done.getChannelData(0);
    const R = done.getChannelData(1);
    let peak = 0;
    let worst = 0;
    // Past the attack, so this is the settled gain and not the way in.
    for (let i = Math.round(RATE / 50); i < N; i += 1) {
      peak = Math.max(peak, Math.abs(L[i]));
      if (Math.abs(R[i]) < 1e-5) continue;
      worst = Math.max(worst, Math.abs(Math.abs(L[i] / R[i]) - 18));
    }
    return { worked: 20 * Math.log10(0.9) - 20 * Math.log10(peak), drift: worst };
  });

  say('');
  say(`  compressing hard: ${bite.worked.toFixed(2)} dB of reduction, and the sides`
    + ` came out within ${bite.drift.toFixed(3)} of 18:1`);

  if (bite.worked < 6) {
    problems.push(`the compressor only reduced ${bite.worked.toFixed(2)} dB, which is too `
      + 'little to tell whether it keeps the image');
  }
  if (bite.drift > 0.05) {
    problems.push(`compressing hard moved the image: the sides drifted ${bite.drift.toFixed(3)} `
      + 'away from the 18:1 they went in at');
  }

  // Then every insert, not only this one.
  //
  // The fault above was the compressor's, and its two siblings that are built
  // the same way declare themselves two in and two out - but four of the six
  // are not worklets at all. The EQ is a chain of biquads, the reverb is a
  // ConvolverNode fed an impulse, the delay is a line of its own, and the
  // panner is the imager. None of them had ever been asked.
  //
  // What is asked is not "is it a wire", because a reverb is not and should
  // not be. It is whether the channels survive at all, and the test that
  // works for every effect regardless of what it does is this: a source hard
  // left and the same source hard right have to come out as different
  // pictures. An insert that has collapsed to mono gives the same answer to
  // both, and that is true whatever processing sits in front of the collapse.
  //
  // Measured, at each insert's own default settings:
  //
  //     insert        hard left   hard right   centred   out of phase, peak
  //     eq               24.00       -24.00      0.00   4.97e-1
  //     compression      24.00       -24.00      0.00   4.72e-1
  //     panning          24.00       -24.00      0.00   5.01e-1
  //     reverb           24.00       -24.00      1.11   4.85e-1
  //     delay            24.00       -24.00      0.00   4.85e-1
  //     saturation       24.00       -24.00      0.00   4.47e-1
  //
  // All six clean, which is the result this was written to get rather than
  // the one it was expecting. It stays because the contract it holds is one
  // the compressor already broke once, and nothing else was watching.
  const every = await page.evaluate(async () => {
    const { makeEffect, EFFECT_IDS } = await import('./src/core/effects.js');
    const { optionsFor } = await import('./src/sketch/knobs.js');
    const { placementOf } = await import('./src/mix/placement.js');

    const RATE = 48000;
    const N = Math.round(RATE * 0.8);

    // A burst rather than a steady tone, so the two inserts that work in time
    // - the reverb and the delay - have an edge to act on.
    const make = (ctx, gl, gr) => {
      const buf = ctx.createBuffer(2, N, RATE);
      for (let i = 0; i < N; i += 1) {
        const t = i / RATE;
        const env = t < 0.25 ? Math.exp(-t * 8) : 0;
        const s = Math.sin((2 * Math.PI * 300 * i) / RATE) * env;
        buf.getChannelData(0)[i] = s * gl;
        buf.getChannelData(1)[i] = s * gr;
      }
      return buf;
    };

    const through = async (id, gl, gr) => {
      const ctx = new OfflineAudioContext(2, N, RATE);
      const src = ctx.createBufferSource();
      src.buffer = make(ctx, gl, gr);
      const fx = await makeEffect(ctx, id, optionsFor(id, {}));
      src.connect(fx.in);
      fx.out.connect(ctx.destination);
      src.start();
      const done = await ctx.startRendering();
      const L = done.getChannelData(0);
      const R = done.getChannelData(1);
      let peak = 0;
      for (let i = 0; i < N; i += 1) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
      return { side: placementOf(L, R, RATE).whole, peak };
    };

    const out = [];
    for (const id of EFFECT_IDS) {
      out.push({
        id,
        left: (await through(id, 0.6, 0)).side,
        right: (await through(id, 0, 0.6)).side,
        centred: (await through(id, 0.45, 0.45)).side,
        flipped: (await through(id, 0.5, -0.5)).peak,
      });
    }
    return out;
  });

  say('');
  say('  every insert at its defaults, fed four stereo pictures');
  say('');
  say('  insert        hard left   hard right   centred   out of phase, peak');
  for (const r of every) {
    say(`  ${r.id.padEnd(12)} ${r.left.toFixed(2).padStart(9)} `
      + `${r.right.toFixed(2).padStart(12)} ${r.centred.toFixed(2).padStart(9)}   `
      + `${r.flipped.toExponential(2)}`);
  }

  for (const r of every) {
    if (r.left < SIDED) {
      problems.push(`${r.id}: a source hard left came out ${r.left.toFixed(2)} dB off centre, `
        + `and anything under ${SIDED} is an insert that has lost a channel`);
    }
    if (r.right > -SIDED) {
      problems.push(`${r.id}: a source hard right came out ${r.right.toFixed(2)} dB off centre`);
    }
    // Mirrored, or the insert has a side it prefers - which the reverb is
    // allowed to have and the other five are not.
    const allowed = CENTRED[r.id] ?? CENTRED_ELSE;
    if (Math.abs(r.left + r.right) > allowed * 2) {
      problems.push(`${r.id}: hard left reads ${r.left.toFixed(2)} and hard right `
        + `${r.right.toFixed(2)}, which are not the same picture either way round`);
    }
    if (Math.abs(r.centred) > allowed) {
      problems.push(`${r.id}: a centred source came out ${r.centred.toFixed(2)} dB off centre, `
        + `and it is allowed ${allowed}`);
    }
    if (r.flipped < SURVIVED) {
      problems.push(`${r.id}: an out-of-phase pair came out at ${r.flipped.toExponential(2)}, `
        + 'which is the two sides having been summed rather than passed');
    }
  }

  await page.close();
  return problems;
}
