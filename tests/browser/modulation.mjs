// The modulation, as the audio thread actually runs it.
//
// This is a browser check rather than a unit test because of what the worklet
// is. `tests/mod.test.js` already runs the string `modSource()` builds and
// holds its core against the module's, sample for sample - but it runs it in
// a `new Function`, on this thread, where a missing part throws somewhere a
// test can see. The real path is different in three ways that no test without
// a browser touches: `registerProcessor` has to accept the class body,
// `processorOptions` has to arrive before the first block, and the whole
// thing has to come back to the graph through a node whose channel counts
// were set by hand.
//
// Any one of those failing gives the same symptom, and it is the worst one
// available: the processor throws once, is torn down, and the node outputs
// silence for the rest of the session. Nothing on the face says so. The
// readings do not notice either, because the reading is the oscillator's own
// path rather than a measurement of the audio - see `trace.js` - so a
// modulation that has been silent since the page loaded still marks every
// round correctly and still draws its sweep.
//
// So this holds the live worklet against `modCore` on the same input, sample
// for sample, and separately asks whether each of the six did anything at
// all. Measured: with the worklet installed every kind agrees to exactly 0,
// and dropping `apCoef` from the parts list - which is the fault this is for
// - fails on the phaser with the worklet silent.

export const name = 'modulation';

export async function check({ browser, at, say }) {
  const problems = [];
  const page = await browser.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  await page.goto(at, { waitUntil: 'networkidle' });

  const out = await page.evaluate(async () => {
    const { MOD_DEFAULTS, MOD_IDS, modCore } = await import('./src/plugins/modulation/dsp.js');
    const { LiveModulation } = await import('./src/plugins/modulation/node.js');

    const RATE = 48000;
    const N = RATE; // one second, which is several cycles of everything here

    /** Two channels of something with content all the way up, and not the same. */
    const feed = (ctx) => {
      const buf = ctx.createBuffer(2, N, RATE);
      const L = buf.getChannelData(0);
      const R = buf.getChannelData(1);
      let state = 0x2f6e2b1;
      for (let i = 0; i < N; i += 1) {
        state = (state * 1664525 + 1013904223) >>> 0;
        const noise = (state / 0x100000000) * 2 - 1;
        const tone = Math.sin((2 * Math.PI * 220 * i) / RATE);
        L[i] = (tone * 0.6 + noise * 0.25) * 0.8;
        R[i] = (Math.sin((2 * Math.PI * 330 * i) / RATE) * 0.6 + noise * 0.25) * 0.8;
      }
      return buf;
    };

    const rows = [];
    let worklet = null;

    for (const id of MOD_IDS) {
      const settings = {
        ...MOD_DEFAULTS, kind: id, rate: 3.2, depth: 0.7, feedback: 0.6, spread: 90,
      };

      const ctx = new OfflineAudioContext(2, N, RATE);
      const buf = feed(ctx);

      const live = new LiveModulation(ctx);
      live.set(settings);
      await live.start();
      if (worklet === null) worklet = Boolean(live.node?.port);

      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(live.input);
      live.connect(ctx.destination);
      src.start(0);

      const done = await ctx.startRendering();
      const outL = done.getChannelData(0);
      const outR = done.getChannelData(1);
      const inL = buf.getChannelData(0);
      const inR = buf.getChannelData(1);

      // The same settings through the module's own core, on this thread.
      // Against `Math.fround` of it, because the rendered buffer is a
      // Float32Array and the core on this thread adds up in double. Without
      // that the whole table reads 3.0e-8 of disagreement, which is one
      // float32 ulp at this amplitude and is the storage rather than the
      // arithmetic. With it, every row is exactly 0.
      const mine = modCore(RATE).set(settings).reset();
      let worst = 0;
      let moved = 0;
      let dry = 0;
      for (let i = 0; i < N; i += 1) {
        mine.stereo(inL[i], inR[i]);
        worst = Math.max(worst,
          Math.abs(Math.fround(mine.left) - outL[i]),
          Math.abs(Math.fround(mine.right) - outR[i]));
        const dl = outL[i] - inL[i];
        const dr = outR[i] - inR[i];
        moved += dl * dl + dr * dr;
        dry += inL[i] * inL[i] + inR[i] * inR[i];
      }

      rows.push({
        id,
        worst,
        // How much of the signal the device changed, in dB against the input.
        // A silent node reads 0.0 dB - it removed all of it - and a node doing
        // nothing reads nothing at all, so this tells the two apart.
        moved: 10 * Math.log10(Math.max(1e-30, moved / Math.max(1e-30, dry))),
      });

      live.destroy();
    }

    return { worklet, rows };
  });

  say(`the live ${out.worklet ? 'worklet' : 'ScriptProcessor'} against the module's own core`
    + ', on a tone and noise at 48000 Hz\n');
  say('  effect      worst sample   changed');
  for (const r of out.rows) {
    say(`  ${r.id.padEnd(10)}   ${r.worst.toExponential(1).padStart(10)}   ${r.moved.toFixed(1).padStart(7)} dB`);
    if (r.worst > 0) {
      problems.push(`${r.id}: the audio thread and the module disagree by ${r.worst.toExponential(2)}`);
    }
    // Measured on these settings: chorus -3.2, flanger -2.0, vibrato +2.5,
    // phaser -2.1, tremolo -7.6 and autopan -8.4, so -20 is well clear of all
    // six and nowhere near a device that is doing nothing.
    if (r.moved < -20) problems.push(`${r.id} changed almost nothing: ${r.moved.toFixed(1)} dB`);
  }

  if (!out.worklet) {
    problems.push('the worklet did not install, so this checked the fallback instead');
  }

  await page.close();
  return problems;
}
