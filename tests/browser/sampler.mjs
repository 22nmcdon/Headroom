// A track that plays a recording back at a pitch, through the real stage.
//
// The instrument's own arithmetic is held without a browser - a 440 Hz sine
// recorded at middle C comes out exactly on the note it is handed, across two
// octaves, and the figures are in src/core/instrument.js. What needs a browser
// is everything between a project and a sound: that a track set to `sampler`
// with a take id on it gets handed the audio at all, that two different ids
// fetch two different recordings, and that the notes in a clip come out at
// the pitches they say.
//
// What it does not check is the live rebuild - that switching the take under
// a playing stage swaps the instrument rather than going on with the old one.
// That is a `graphStamp` question and these are separate renders, so it is
// held by the stamp carrying the sample and by nothing here.
//
// A buffer cannot live in a project file, so the project keeps the take's id
// and the stage turns it into audio from the map the grid holds. That seam is
// the thing this exists for: it is the one place in the app where the model
// and the audio are joined by a lookup rather than by a value.

export const name = 'sampler';

/** Middle C, which is what SAMPLE_ROOT is - repeated here because the
 * evaluate block's imports do not reach this side of the page boundary. */
const SAMPLE_ROOT_NOTE = 60;

export async function check({ browser, at, say }) {
  const problems = [];
  const page = await browser.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  await page.goto(at, { waitUntil: 'networkidle' });

  const got = await page.evaluate(async () => {
    const { makeStage } = await import('./src/sketch/stage.js');
    const { newProject, setTrack, setNotes } = await import('./src/sketch/project.js');
    // From midi.js, which is where it lives: project.js imports it and does
    // not pass it on, so asking project.js for it gives undefined and every
    // note length built from it is NaN.
    const { PPQ } = await import('./src/sketch/midi.js');
    const { SAMPLE_ROOT } = await import('./src/core/instrument.js');
    const { Transport } = await import('./src/sketch/transport.js');

    const RATE = 48000;
    const ROOT_HZ = 330;

    /** The frequency of whatever is sounding, by its zero crossings. */
    const freqOf = (samples, rate) => {
      let begins = -1;
      let ends = 0;
      for (let i = 0; i < samples.length; i += 1) {
        if (Math.abs(samples[i]) > 0.01) { if (begins < 0) begins = i; ends = i; }
      }
      if (begins < 0 || ends - begins < rate * 0.02) return 0;
      const from = begins + Math.floor((ends - begins) * 0.25);
      const to = begins + Math.floor((ends - begins) * 0.75);
      let first = -1;
      let last = -1;
      let crossings = 0;
      for (let i = from + 1; i < to; i += 1) {
        if (samples[i - 1] < 0 && samples[i] >= 0) {
          const t = i - samples[i] / (samples[i] - samples[i - 1]);
          if (first < 0) first = t; else last = t;
          crossings += 1;
        }
      }
      return crossings < 3 ? 0 : ((crossings - 1) * rate) / (last - first);
    };

    /** A take: half a second of a clean tone, as a recording would arrive. */
    const recording = (ctx, hz) => {
      const buf = ctx.createBuffer(1, Math.round(RATE * 0.5), RATE);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) {
        data[i] = Math.sin((2 * Math.PI * hz * i) / RATE) * 0.8;
      }
      return buf;
    };

    /** One note, rendered through a whole stage, and what came out of it. */
    const render = async ({ take, root, pitch, takes: which, hold = false }) => {
      const seconds = 2.2;
      const ctx = new OfflineAudioContext(2, Math.ceil(RATE * seconds), RATE);

      let project = newProject();
      // Every other track silent, so what comes out is this one.
      project.tracks.forEach((_, i) => {
        if (i > 0) project = setTrack(project, i, { muted: true });
      });
      project = setTrack(project, 0, { instrument: 'sampler', sample: { take, root, hold } });
      project = setNotes(project, 0, 0, [{ pitch, start: 0, length: PPQ * 2 }]);

      const takes = new Map(Object.entries(which));
      let clock = 0;
      const transport = new Transport({
        now: () => clock,
        every: () => null,
        clear: () => {},
        lookahead: 0,
        bpm: project.bpm,
        beats: project.beats,
        value: project.value,
      });

      const stage = await makeStage(ctx, project, { out: ctx.destination, transport, takes });
      stage.launchScene(0);
      stage.play();
      for (clock = 0; clock < seconds; clock = Math.min(seconds, clock + 0.05)) {
        transport.pass();
        if (clock === seconds) break;
      }
      const done = await ctx.startRendering();
      stage.destroy();

      const L = done.getChannelData(0);
      let peak = 0;
      for (let i = 0; i < L.length; i += 1) peak = Math.max(peak, Math.abs(L[i]));

      // How long it actually sounded for, which is the whole question the
      // held path exists to answer: resampling makes a sample shorter as it
      // goes up, and holding the length does not.
      let begins = -1;
      let ends = 0;
      for (let i = 0; i < L.length; i += 1) {
        if (Math.abs(L[i]) > peak * 0.05) { if (begins < 0) begins = i; ends = i; }
      }
      const lasted = begins < 0 ? 0 : (ends - begins) / RATE;

      return { hz: freqOf(L, RATE), peak, lasted };
    };

    // One context just to make the buffers in, since a buffer belongs to the
    // context that made it and these go into several renders.
    const holder = new OfflineAudioContext(1, 128, RATE);
    const takes = {
      'take-one': recording(holder, ROOT_HZ),
      'take-two': recording(holder, ROOT_HZ * 2),
    };

    const rows = [];
    for (const pitch of [SAMPLE_ROOT - 12, SAMPLE_ROOT, SAMPLE_ROOT + 7]) {
      const out = await render({ take: 'take-one', root: SAMPLE_ROOT, pitch, takes });
      rows.push({
        what: `take one at note ${pitch}`,
        want: ROOT_HZ * 2 ** ((pitch - SAMPLE_ROOT) / 12),
        ...out,
      });
    }

    // The other recording, same note: the seam between the id and the audio.
    rows.push({
      what: 'take two at the root',
      want: ROOT_HZ * 2,
      ...(await render({ take: 'take-two', root: SAMPLE_ROOT, pitch: SAMPLE_ROOT, takes })),
    });

    // And a root that says the recording is already a fifth up, so the same
    // note has to come out a fifth lower.
    rows.push({
      what: 'take one, root moved up a fifth',
      want: ROOT_HZ * 2 ** (-7 / 12),
      ...(await render({ take: 'take-one', root: SAMPLE_ROOT + 7, pitch: SAMPLE_ROOT, takes })),
    });

    // A take id nothing holds: silence, and not a crash.
    const missing = await render({ take: 'take-nope', root: SAMPLE_ROOT, pitch: 60, takes });
    // And no take at all, which is how every sampler track starts.
    const unset = await render({ take: null, root: SAMPLE_ROOT, pitch: 60, takes });

    /* --- and the same notes with the length held ----------------------- */

    // A longer recording, because what is being measured is how long the
    // sound lasts and half a second against a note of a beat and a quarter
    // leaves little room to tell the two behaviours apart.
    //
    // And at the frequency the root actually names, which the takes above
    // deliberately are not. Resampling does not care: it shifts by a ratio
    // and a wrong root only means the note comes out at the wrong absolute
    // pitch. Holding the length does care, because the period it cuts grains
    // on comes from the root - so a root that is a lie is grains landing at
    // random phases of the waveform. That is measured below rather than
    // avoided, because it is the reason the "Work it out" button beside the
    // root picker matters more on this setting than on the other one.
    const long = (ctx, hz) => {
      const buf = ctx.createBuffer(1, Math.round(RATE * 1.0), RATE);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) {
        data[i] = Math.sin((2 * Math.PI * hz * i) / RATE) * 0.8;
      }
      return buf;
    };
    const TRUE_HZ = 440 * 2 ** ((SAMPLE_ROOT - 69) / 12);
    const held = {
      ...takes,
      'take-long': long(holder, TRUE_HZ),
      // The same recording, by a root that is a fifth out.
      'take-lying': long(holder, TRUE_HZ),
    };

    const heldRows = [];
    for (const pitch of [SAMPLE_ROOT - 12, SAMPLE_ROOT - 5, SAMPLE_ROOT, SAMPLE_ROOT + 7]) {
      const want = TRUE_HZ * 2 ** ((pitch - SAMPLE_ROOT) / 12);
      heldRows.push({
        pitch,
        want,
        free: await render({ take: 'take-long', root: SAMPLE_ROOT, pitch, takes: held }),
        kept: await render({ take: 'take-long', root: SAMPLE_ROOT, pitch, takes: held, hold: true }),
      });
    }

    // Two octaves up is outside what the shifter will take, and the sampler
    // is supposed to fall back to resampling rather than go quiet.
    const past = await render({
      take: 'take-long', root: SAMPLE_ROOT, pitch: SAMPLE_ROOT + 36, takes: held, hold: true,
    });

    // What a wrong root costs each of the two paths, at an octave down.
    // The recording sounds at the root; the track is told it sounds a fifth
    // higher. Both paths are then asked for an octave below that lie, so
    // both are shifting by a half - and resampling gets a clean half while
    // the held path is cutting grains on a period that is not the
    // recording's.
    const LIE = 7;
    const lying = {
      free: await render({
        take: 'take-lying', root: SAMPLE_ROOT + LIE, pitch: SAMPLE_ROOT + LIE - 12, takes: held,
      }),
      kept: await render({
        take: 'take-lying', root: SAMPLE_ROOT + LIE, pitch: SAMPLE_ROOT + LIE - 12, takes: held, hold: true,
      }),
      // Half of what the recording really sounds at, which is what a shift
      // by a half means whatever the root is called.
      want: TRUE_HZ / 2,
    };

    return { rows, missing, unset, heldRows, past, lying };
  });

  say('  what                              asked       got    out by     peak');
  for (const r of got.rows) {
    const off = r.want ? ((r.hz - r.want) / r.want) * 100 : 0;
    say(`  ${r.what.padEnd(32)} ${r.want.toFixed(2).padStart(7)} `
      + `${r.hz.toFixed(2).padStart(9)} ${off.toFixed(3).padStart(8)} % `
      + `${r.peak.toFixed(3).padStart(7)}`);
  }
  say('');
  say(`  a take id nothing holds: peak ${got.missing.peak.toExponential(2)}`);
  say(`  no take chosen at all:   peak ${got.unset.peak.toExponential(2)}`);

  // Resampling against holding the length, on a one-second recording. The
  // pitch has to be the same either way and the length must not be.
  say('\n  the same notes, resampled and with the length held\n');
  say('  note    asked        resampled            length held');
  say('                        got   lasted         got   lasted');
  for (const r of got.heldRows) {
    say(`  ${String(r.pitch).padStart(4)} ${r.want.toFixed(1).padStart(8)}`
      + ` ${r.free.hz.toFixed(1).padStart(10)} ${r.free.lasted.toFixed(3).padStart(8)} s`
      + ` ${r.kept.hz.toFixed(1).padStart(10)} ${r.kept.lasted.toFixed(3).padStart(8)} s`);

    const want = (got_, what) => {
      const off = Math.abs((got_.hz - r.want) / r.want) * 100;
      if (got_.peak < 0.01) problems.push(`note ${r.pitch} ${what}: nothing came out`);
      // Wider than the 0.1 % the resampled path is held to: the shifter is
      // measured to within ten cents in tests/psola.test.js, and a zero
      // crossing count over a grained signal is looser again.
      else if (off > 1) {
        problems.push(`note ${r.pitch} ${what}: asked ${r.want.toFixed(1)} Hz, got ${got_.hz.toFixed(1)}`);
      }
    };
    want(r.free, 'resampled');
    want(r.kept, 'with the length held');

    if (r.pitch === SAMPLE_ROOT_NOTE) continue;
    // The thing itself. Resampling moves the length with the pitch and
    // holding it does not, and the gap between them is the feature.
    const moved = Math.abs(r.free.lasted - r.kept.lasted);
    if (moved < 0.05) {
      problems.push(`note ${r.pitch}: resampled lasted ${r.free.lasted.toFixed(3)} s and held`
        + ` ${r.kept.lasted.toFixed(3)}, which is the same - the held path is not being taken`);
    }
  }

  // Held, every note should last about as long as every other one.
  const lengths = got.heldRows.map((r) => r.kept.lasted);
  const spread = Math.max(...lengths) - Math.min(...lengths);
  say(`\n  held, the four notes lasted within ${spread.toFixed(3)} s of each other`);
  if (spread > 0.1) {
    problems.push(`held, the notes lasted ${lengths.map((l) => l.toFixed(2)).join(', ')} s,`
      + ' which is not a length being held');
  }

  say(`  three octaves up, past what the shifter takes: ${got.past.hz.toFixed(1)} Hz,`
    + ` ${got.past.lasted.toFixed(3)} s, peak ${got.past.peak.toFixed(3)}`);
  if (got.past.peak < 0.01) {
    problems.push('a note past the shifter range went silent rather than falling back to resampling');
  }

  // A root that is a fifth out, shifting down an octave. Resampling does not
  // care what the root is called - it shifts by the ratio between the note
  // and the root, and an octave is an octave. Holding the length does care,
  // because the root is also where its grain period comes from, and grains
  // cut on the wrong period land at arbitrary phases of the waveform.
  //
  // This is the reason the "Work it out" button beside the root picker
  // matters more on this setting than on the other one, and it is measured
  // here rather than asserted in a comment.
  const lie = got.lying;
  const off = (hz) => Math.abs(1200 * Math.log2(hz / lie.want));
  say(`\n  a root a fifth out, shifted down an octave, against ${lie.want.toFixed(1)} Hz:`);
  say(`    resampled ${lie.free.hz.toFixed(1)} Hz (${off(lie.free.hz).toFixed(0)} cents out)`);
  say(`    held      ${lie.kept.hz.toFixed(1)} Hz (${off(lie.kept.hz).toFixed(0)} cents out)`);

  if (off(lie.free.hz) > 20) {
    problems.push(`resampling is supposed to be indifferent to a wrong root and came out`
      + ` ${off(lie.free.hz).toFixed(0)} cents from the octave it was asked for`);
  }
  if (lie.kept.peak < 0.01) problems.push('a wrong root made the held path silent');
  if (off(lie.kept.hz) < 20) {
    say('    (the held path survived a wrong root at this interval)');
  }

  for (const r of got.rows) {
    if (r.peak < 0.01) {
      problems.push(`${r.what}: nothing came out of the stage at all`);
      continue;
    }
    const off = Math.abs((r.hz - r.want) / r.want) * 100;
    // A tenth of a per cent is well under a cent, and far tighter than the
    // zero-crossing count can be wrong by on a clean tone.
    if (off > 0.1) {
      problems.push(`${r.what}: asked for ${r.want.toFixed(2)} Hz and got `
        + `${r.hz.toFixed(2)}, which is ${off.toFixed(2)} % out`);
    }
  }

  // Both half-set states have to be silence rather than a throw - the console
  // listener above would have caught the throw, so this is about the audio.
  if (got.missing.peak > 1e-4) {
    problems.push(`a take id nothing holds made a sound: peak ${got.missing.peak.toExponential(2)}`);
  }
  if (got.unset.peak > 1e-4) {
    problems.push(`a track with no take chosen made a sound: peak ${got.unset.peak.toExponential(2)}`);
  }

  await page.close();

  // Then the panel, because the audio above was reached by building a project
  // by hand and the controls are the only way anybody else will.
  const editor = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  editor.on('pageerror', (e) => problems.push(`editor pageerror: ${e.message}`));
  editor.on('console', (m) => {
    if (m.type() === 'error') problems.push(`editor console: ${m.text()}`);
  });
  await editor.goto(at, { waitUntil: 'networkidle' });
  await editor.waitForTimeout(350);
  await editor.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
  await editor.click('[data-view="sketch"]');
  await editor.waitForTimeout(350);
  await editor.click('.track-name >> nth=0');
  await editor.waitForTimeout(400);

  // A piano track has nothing to say about recordings, and should not say it.
  if ((await editor.$$('[data-sample-take]')).length) {
    problems.push('a track that is not a sampler is showing the sampler controls');
  }

  await editor.selectOption('[data-instrument]', 'sampler');
  await editor.waitForTimeout(450);

  const panel = await editor.evaluate(() => {
    const take = document.querySelector('[data-sample-take]');
    const root = document.querySelector('[data-sample-root]');
    return {
      take: !!take,
      root: !!root,
      // With nothing recorded there is nothing to choose, and the one option
      // has to say so rather than sitting there blank.
      says: take?.options?.[0]?.textContent?.trim() ?? null,
      rootStart: root?.value ?? null,
      roots: root?.options?.length ?? 0,
    };
  });

  say('');
  say(`  the panel offers a recording picker: ${panel.take}, reading "${panel.says}"`);
  say(`  and a root of ${panel.rootStart} out of ${panel.roots} notes`);

  if (!panel.take) problems.push('a sampler track has no recording picker');
  if (!panel.root) problems.push('a sampler track has no root control');
  if (panel.says !== 'Record one first') {
    problems.push(`with nothing recorded the picker reads "${panel.says}" rather than saying so`);
  }
  if (Number(panel.rootStart) !== 60) {
    problems.push(`the root opens on ${panel.rootStart} rather than middle C`);
  }

  // The root has to stick, which is the half of the wiring the audio test
  // above cannot see - it built its projects by hand.
  await editor.selectOption('[data-sample-root]', '48');
  await editor.waitForTimeout(400);
  const stuck = await editor.evaluate(() => document.querySelector('[data-sample-root]')?.value);
  if (Number(stuck) !== 48) {
    problems.push(`the root was set to 48 and came back as ${stuck}`);
  }

  await editor.close();
  return problems;
}
