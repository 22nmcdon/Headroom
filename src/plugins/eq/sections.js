// The EQ's filters, as a live chain.
//
// These were in core/effects.js, which is the sketchpad's effect factory, so
// an EQ could not build its own filters without importing the sketchpad.
// They are the EQ's. They are not in filters.js beside the arithmetic they
// are built from, because that file is maths over arrays and this one makes
// Web Audio nodes - and the line between those two is the whole of what
// makes the maths portable. tests/seams.test.js holds it.

import { MOST_SECTIONS, averageLift, sectionsOf } from './filters.js';

export function eqSections(ctx, bands) {
  // No bands is a wire, not an error. A track with an EQ slot and nothing in
  // it is the common case, and the alternative is every caller branching.
  if (!(bands > 0)) {
    const through = ctx.createGain();
    return { input: through, sections: [], trim: through, filters: [] };
  }

  const sections = Array.from({ length: bands }, () =>
    Array.from({ length: MOST_SECTIONS }, () => {
      const filter = ctx.createBiquadFilter();
      // A peak with no gain passes everything through.
      filter.type = 'peaking';
      filter.frequency.value = 1000;
      filter.Q.value = 1;
      filter.gain.value = 0;
      return filter;
    }));

  const filters = sections.flat();
  for (let i = 0; i < filters.length - 1; i += 1) filters[i].connect(filters[i + 1]);

  // Auto gain: whatever the curve adds overall, this takes back off.
  const trim = ctx.createGain();
  trim.gain.value = 1;
  filters[filters.length - 1].connect(trim);

  return { input: filters[0], sections, trim, filters };
}

/**
 * Tune a built chain to a set of bands, without interrupting the sound.
 *
 * Also lifted from the player, and the comment it came with is the reason it
 * is worth having in one place: a band that is off becomes a peak with no
 * gain, which is exactly nothing. Parking its corner at the end of the range
 * instead - the obvious thing to do - is not nothing. A low-pass sitting at
 * 18 kHz still takes three quarters of a decibel off 12 kHz and a high-pass
 * at 40 takes a decibel and a half off 60, and the drawn curve leaves an off
 * band out entirely, so the sound has to as well or the two stop agreeing.
 */
export function tuneSections(chain, bands, at, rate, weights) {
  const lift = averageLift(bands, rate, weights);
  chain.trim.gain.setTargetAtTime(10 ** (-lift / 20), at, 0.02);

  bands.forEach((band, i) => {
    const sections = band.on === false ? [] : sectionsOf(band);

    chain.sections[i].forEach((filter, s) => {
      const section = sections[s];
      if (!section) {
        filter.type = 'peaking';
        filter.gain.setTargetAtTime(0, at, 0.01);
        return;
      }
      filter.type = section.type;
      filter.frequency.setTargetAtTime(section.frequency, at, 0.01);
      filter.Q.setTargetAtTime(section.q, at, 0.01);
      filter.gain.setTargetAtTime(section.gain ?? 0, at, 0.01);
    });
  });
}
