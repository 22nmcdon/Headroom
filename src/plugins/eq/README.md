# eq

    plugin.js    the face
    filters.js   band maths, curves, the reading, and comparing two of them
    sections.js  the same filters as a live Web Audio chain
    spectrum.js  what is actually coming through, for the display
    player.js    auditioning it

`filters.js` and `sections.js` are split on purpose: the first is arithmetic
over arrays, the second makes Web Audio nodes. `tests/seams.test.js` holds the
line, and it caught them being merged within an hour of the split.
