// The mix exercise's tone tier, end to end.
//
// Two questions a unit test cannot ask, because both of them need a render:
// that the answer to a tone round actually marks as solved, and that being
// wrong about the tone marks as wrong. Everything between the brief and the
// mark - dress, the stage, the render, the five readings, the tolerances - is
// only exercised together here.
//
// It also holds the thing the whole tier rests on: that a resting EQ insert
// on every stem is a wire. If that ever stops being true, every tone round
// becomes a round where the material itself has changed, and the measurement
// the tolerances were set from goes with it.
//
// Marked by the app's own marker at the tone tier, not by a number chosen
// here, so the check cannot drift away from what a player would be told.

export const name = 'tone';

export async function check({ browser, at, say }) {
  const problems = [];
  const page = await browser.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  await page.goto(at, { waitUntil: 'networkidle' });

  const got = await page.evaluate(async () => {
    const { pieceOf, dress, STEM_IDS } = await import('./src/mix/piece.js');
    const {
      mixBrief, flatMix, movesIn, MIX_TIERS, TONE_BANDS, TONE_LEAST, STEPS,
    } = await import('./src/mix/brief.js');
    const { renderMix, readMaster, channelsIn } = await import('./src/mix/render.js');
    const { markMix } = await import('./src/mix/score.js');
    const { EQ_REST } = await import('./src/sketch/knobs.js');

    const opening = () => Object.fromEntries(STEM_IDS.map((id) => [id, {
      ...flatMix()[id], inserts: ['eq'], settings: { eq: { ...EQ_REST } },
    }]));

    const rows = [];
    for (const seed of [11, 2027, 48271, 90001]) {
      const brief = mixBrief('tone', seed);
      const piece = pieceOf(brief.piece);

      const answer = readMaster(await renderMix(dress(piece, brief.target)), 'theirs');
      const flat = readMaster(await renderMix(dress(piece, opening())), 'mine');

      // One step off the answer, on the band the round moved, which is the
      // smallest wrong answer the control can express.
      const nearly = Object.fromEntries(STEM_IDS.map((id) => [id, {
        ...brief.target[id], settings: { eq: { ...brief.target[id].settings.eq } },
      }]));
      const moved = movesIn(brief.target).filter((stem) => stem.tone);
      for (const stem of moved) {
        const band = TONE_BANDS[stem.id];
        nearly[stem.id].settings.eq[band] -= Math.sign(stem.tone.db) * TONE_LEAST;
      }
      const close = readMaster(await renderMix(dress(piece, nearly)), 'mine');

      rows.push({
        seed,
        piece: brief.piece,
        moves: moved.map((stem) => `${stem.name} ${band(stem)}`).join(', '),
        right: markMix(answer, answer, 'tone'),
        flat: markMix(flat, answer, 'tone'),
        near: markMix(close, answer, 'tone'),
      });

      function band(stem) {
        return `${TONE_BANDS[stem.id]} ${stem.tone.db > 0 ? '+' : ''}${stem.tone.db}`;
      }
    }

    // And the resting insert, against no inserts at all.
    const piece = pieceOf(mixBrief('tone', 7).piece);
    const bare = channelsIn(await renderMix(dress(piece, flatMix())));
    const rest = channelsIn(await renderMix(dress(piece, opening())));
    let wire = 0;
    for (let c = 0; c < rest.length; c += 1) {
      for (let i = 0; i < rest[c].length; i += 1) {
        wire = Math.max(wire, Math.abs(rest[c][i] - bare[c][i]));
      }
    }

    return { rows, wire, step: STEPS.tone, tones: MIX_TIERS.tone.tones };
  });

  say(`a resting EQ on every stem differs from no inserts by ${got.wire.toExponential(2)}`);
  say('');
  say('  seed    piece         what moved                  answer   flat     3 dB off');
  for (const r of got.rows) {
    const show = (m) => `${m.solved ? 'solved' : m.worst.kind.slice(0, 7)}`.padEnd(8);
    say(`  ${String(r.seed).padEnd(7)} ${r.piece.padEnd(13)} ${r.moves.padEnd(26)} `
      + `${show(r.right)} ${show(r.flat)} ${show(r.near)}`);
  }

  // A resting insert that is not a wire makes the material itself different.
  if (got.wire > 1e-6) {
    problems.push(`a resting EQ insert is not a wire: it moves a sample by ${got.wire.toExponential(2)}`);
  }

  for (const r of got.rows) {
    if (!r.right.solved) {
      problems.push(`seed ${r.seed}: the answer itself did not mark as solved `
        + `(worst: ${r.right.worst.kind} at ${r.right.worst.off.toFixed(2)} of `
        + `${r.right.worst.allowed})`);
    }
    // Flat is where a round starts, so a round that marks solved from flat is
    // a round that was already won.
    if (r.flat.solved) {
      problems.push(`seed ${r.seed}: the opening mix already marks as solved`);
    }
    if (r.flat.worst.kind !== 'balance') {
      problems.push(`seed ${r.seed}: being wrong about the tone showed up as `
        + `${r.flat.worst.kind} rather than balance`);
    }
    // And the floor has to mean something: three decibels out is the smallest
    // wrong answer a round can be, and it has to be caught.
    if (r.near.solved) {
      problems.push(`seed ${r.seed}: three decibels off the answer still marks as solved, `
        + 'so the tolerance is wider than the floor');
    }
  }

  await page.close();

  // Then the layout, at the two widths this app is built for. A tone section
  // that overflows at 430 is the same fault as a knob deck pushed out through
  // the bottom of a chassis, and the reason that one is a browser check is the
  // reason this is: nothing about it is arithmetic anybody wrote down.
  for (const [width, columns] of [[430, 1], [1280, 4]]) {
    const view = await browser.newPage({ viewport: { width, height: 1000 } });
    view.on('pageerror', (e) => problems.push(`${width}px pageerror: ${e.message}`));
    view.on('console', (m) => {
      if (m.type() === 'error') problems.push(`${width}px console: ${m.text()}`);
    });
    await view.goto(at, { waitUntil: 'networkidle' });
    await view.waitForTimeout(350);
    await view.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
    await view.click('[data-view="mix"]');
    await view.waitForTimeout(350);

    await view.selectOption('[data-tier]', 'tone');
    await view.waitForTimeout(500);

    const laid = await view.evaluate(() => {
      {
        // Scoped to the mix sheet, not the document. Every view is in the
        // page at once with the others hidden, so a bare selector reaches
        // into them - which is how `data-band` was found to mean the EQ's
        // own band buttons as well as these sliders.
        const sheet = document.querySelector('#mixSheet');
        const desk = sheet.querySelector('[data-tone]');
        const strips = sheet.querySelector('[data-tone-strips]');
        const columns = strips
          ? new Set([...strips.children].map((kid) => Math.round(kid.getBoundingClientRect().left)))
          : new Set();
        const over = [...sheet.querySelectorAll('.tone-desk, .tone-strip, .tone-band')]
          .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
          .map((el) => el.className);
        // The two sections are one desk or they are not: at a width where
        // both are four across, the columns have to start in the same places.
        const stripAt = [...sheet.querySelectorAll('.strip')]
          .map((el) => Math.round(el.getBoundingClientRect().left));
        const toneAt = [...(strips?.children ?? [])]
          .map((el) => Math.round(el.getBoundingClientRect().left));
        return {
          shown: desk ? !desk.hidden : false,
          columns: columns.size,
          over,
          aligned: stripAt.length === toneAt.length
            && stripAt.every((x, i) => Math.abs(x - toneAt[i]) <= 1),
          sliders: sheet.querySelectorAll('[data-tone-band]').length,
          live: sheet.querySelectorAll('[data-tone-band]:not(:disabled)').length,
        };
      }
    });

    say('');
    say(`  ${width}px: ${laid.columns} column${laid.columns === 1 ? '' : 's'}, `
      + `${laid.sliders} tone sliders, ${laid.live} of them live`
      + `${laid.aligned ? ', lined up with the strips' : ''}`);

    if (!laid.shown) problems.push(`${width}px: the tone tier did not show its tone section`);
    if (laid.columns !== columns) {
      problems.push(`${width}px: the tone section came out ${laid.columns} columns `
        + `across and the strips above it are ${columns}`);
    }
    for (const which of laid.over) problems.push(`${width}px: ${which} runs off the side`);
    // Twelve sliders, four stems by three bands, and the only live ones are
    // the band each stem lives in - three of the four, the kit being the
    // reference.
    if (laid.sliders !== 12) {
      problems.push(`${width}px: ${laid.sliders} tone sliders rather than twelve`);
    }
    if (laid.live !== 3) {
      problems.push(`${width}px: ${laid.live} tone sliders are live rather than three`);
    }
    if (width >= 720 && !laid.aligned) {
      problems.push(`${width}px: the tone columns do not line up with the strips above them`);
    }
    await view.close();
  }

  return problems;
}
