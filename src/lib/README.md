# lib

What more than one of the folders above needs, and nothing else.

    dsp.js       biquads, and the level readings every tool takes
    fft.js       the transform
    read.js      the envelope every measurement is wrapped in
    response.js  frequency and decay responses, for displays
    panel.js     canvas sizing, dials, resize watching, formatting a frequency
    knob.js      the knob control
    meter.js     the moving-coil meter
    player.js    the shared half of auditioning a loop
    worklet.js   installing an AudioWorklet, and the fallback
    tempo.js     the grid every loop in this app is cut to
    engrave.js   writing note names
    random.js    seeded randomness, so a puzzle is a function of its seed

**`lib/` imports only `lib/`.** It is the bottom of the tree or it is not a
library, and `tests/seams.test.js` holds that. `gap.js` used to be filed here
and dispatches to comparators living in six other folders, which made the
bottom layer depend on the whole tree; it is at `src/gap.js` now, where a
thing that depends on everything belongs.
