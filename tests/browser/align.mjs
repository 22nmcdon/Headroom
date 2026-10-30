// The pair, added up two ways: by the graph that plays it and by the
// arithmetic that marks it.
//
// This is a browser check rather than a unit test because the two halves it
// compares live on opposite sides of the Web Audio boundary. `pairSum` delays
// the close mic by interpolating between two samples; a `DelayNode` with a
// fractional delay does the same thing, and "does the same thing" is a claim
// about an implementation nobody here wrote. If the two disagree, every
// number this tool shows is about a different sum from the one in your ears -
// and nothing in tests/align.test.js could tell.
//
// It also checks the thing the whole tool is for: that dialling the delay the
// pair is apart actually flattens the comb.

export const name = 'align';

/**
 * How closely the graph has to match the arithmetic.
 *
 * In decibels of residual against the sum's own level, because an absolute
 * sample difference means nothing without knowing how loud the thing is.
 * Measured on this material, a delay line off by one sample reads -9.6 dB and
 * one off by half a sample - which is what an interpolator that rounded
 * instead of interpolating would be, at worst - reads -15.6. So anything
 * under -60 is agreement rather than luck.
 */
const AGREED = -60;

export async function check({ browser, at, say }) {
  const problems = [];
  const page = await browser.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  await page.goto(at, { waitUntil: 'networkidle' });

  const out = await page.evaluate(async () => {
    const { Engine } = await import('./src/core/audio.js');
    const {
      farMic, pairSum, pairBands, crossLag, ALIGN_HZ,
    } = await import('./src/plugins/align/pair.js');

    const engine = new Engine();
    engine.ensure();
    const loop = await engine.renderLoop('drums');
    const rate = loop.sampleRate;
    const close = loop.getChannelData(0).slice(0, Math.round(rate * 2));

    /** The same sum, built as the player builds it: two sources and a delay. */
    const throughGraph = async (far, { delay, blend, flip }) => {
      const ctx = new OfflineAudioContext(1, close.length, rate);

      const closeBuf = ctx.createBuffer(1, close.length, rate);
      closeBuf.copyToChannel(close, 0);
      const farBuf = ctx.createBuffer(1, far.length, rate);
      farBuf.copyToChannel(far, 0);

      const line = ctx.createDelay(1);
      line.delayTime.value = delay / 1000;
      const fader = ctx.createGain();
      fader.gain.value = 10 ** (blend / 20) * (flip ? -1 : 1);

      const a = ctx.createBufferSource();
      a.buffer = closeBuf;
      a.connect(line).connect(ctx.destination);
      const b = ctx.createBufferSource();
      b.buffer = farBuf;
      b.connect(fader).connect(ctx.destination);
      a.start(0);
      b.start(0);

      return (await ctx.startRendering()).getChannelData(0);
    };

    const rows = [];
    for (const path of [{ ms: 0.6, level: -2 }, { ms: 3.5, level: -4 }, { ms: 9.44, level: -6 }]) {
      const far = farMic(close, rate, path);
      for (const settings of [
        { delay: 0, blend: 0, flip: false },
        { delay: path.ms, blend: 0, flip: false },
        { delay: path.ms, blend: -6, flip: true },
      ]) {
        const graph = await throughGraph(far, settings);
        const mine = pairSum(close, far, rate, settings);

        // Past the first few samples, where the graph's delay line is still
        // filling and the arithmetic has already decided the answer is zero.
        const from = Math.round(rate * 0.05);
        let residual = 0;
        let energy = 0;
        for (let i = from; i < mine.length; i += 1) {
          const off = graph[i] - mine[i];
          residual += off * off;
          energy += mine[i] * mine[i];
        }
        rows.push({
          path: path.ms,
          delay: settings.delay,
          flip: settings.flip,
          agreement: 10 * Math.log10(Math.max(1e-30, residual / Math.max(1e-30, energy))),
        });
      }
    }

    // And what alignment is for: the comb, flattened.
    const far = farMic(close, rate, { ms: 3.5, level: -4 });
    const dry = pairBands(close, rate);
    const spread = (settings) => {
      const bands = pairBands(pairSum(close, far, rate, settings), rate);
      let worst = 0;
      let low = 0;
      let n = 0;
      bands.forEach((db, i) => {
        const off = db - dry[i];
        if (Math.abs(off) > Math.abs(worst)) worst = off;
        if (ALIGN_HZ[i] <= 200) { low += off; n += 1; }
      });
      return { worst, low: low / Math.max(1, n) };
    };

    const found = crossLag(close, far, rate);
    return {
      rate,
      rows,
      lagMs: found.lagMs,
      sign: found.sign,
      unaligned: spread({ delay: 0, blend: 0, flip: false }),
      aligned: spread({ delay: 3.5, blend: 0, flip: false }),
      inverted: spread({ delay: 3.5, blend: 0, flip: true }),
    };
  });

  say(`the graph against the arithmetic, on the drums loop at ${out.rate} Hz\n`);
  say('  pair apart   delay in   polarity   residual');
  for (const r of out.rows) {
    say(`  ${`${r.path} ms`.padStart(10)}   ${`${r.delay} ms`.padStart(8)}   `
      + `${(r.flip ? 'flipped' : 'as is').padStart(8)}   ${r.agreement.toFixed(1).padStart(8)} dB`);
    if (r.agreement > AGREED) {
      problems.push(`the graph and the arithmetic disagree by ${r.agreement.toFixed(1)} dB`
        + ` at ${r.path} ms apart with ${r.delay} ms dialled in`);
    }
  }

  say('\n  what the second mic does to the close mic, in dB');
  say('                       worst band   under 200 Hz');
  for (const [what, r] of [['unaligned', out.unaligned], ['aligned', out.aligned],
    ['aligned, flipped', out.inverted]]) {
    say(`  ${what.padEnd(20)} ${r.worst.toFixed(1).padStart(10)} ${r.low.toFixed(1).padStart(14)}`);
  }
  say(`\n  the search found the pair ${out.lagMs.toFixed(3)} ms apart, sign ${out.sign > 0 ? '+' : '-'}`);

  if (Math.abs(out.lagMs - 3.5) > 0.05) {
    problems.push(`the search put a 3.5 ms pair at ${out.lagMs.toFixed(3)} ms`);
  }
  // Aligned, the pair should add up rather than cancel: the low end comes up
  // and no band is dug out. Unaligned it has to be doing something, or the
  // exercise is asking about nothing.
  if (out.aligned.low < 2) problems.push(`aligning the pair recovered only ${out.aligned.low.toFixed(1)} dB of low end`);
  if (out.unaligned.worst > -6) problems.push(`an unaligned pair only notched by ${out.unaligned.worst.toFixed(1)} dB`);
  if (out.inverted.low > -3) problems.push(`a flipped pair kept its low end: ${out.inverted.low.toFixed(1)} dB`);

  await page.close();
  return problems;
}
