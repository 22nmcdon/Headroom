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

  await page.close();
  return problems;
}
