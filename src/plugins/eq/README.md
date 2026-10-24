# eq

    plugin.js    the face
    filters.js   band maths, curves, the reading, and comparing two of them
    svf.js       the filter itself: one description, for drawing and for sound
    node.js      that filter on the audio thread, as a worklet
    sections.js  the worklet as a live Web Audio chain, with its auto gain
    spectrum.js  what is actually coming through, for the display
    player.js    auditioning it

`filters.js` and `sections.js` are split on purpose: the first is arithmetic
over arrays, the second makes Web Audio nodes. `tests/seams.test.js` holds the
line, and it caught them being merged within an hour of the split.

`svf.js` is on the arithmetic side of that line and is the reason the split is
worth holding. It is written once and read three times - drawn by
`sectionGainAt`, scored by `curveOf`, and run sample by sample by `svfRack`,
which `node.js` stringifies onto the audio thread. The EQ was the last of the
six tools to have two models of itself; it has one.
