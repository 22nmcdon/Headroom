# lib

What more than one of the folders above needs, and nothing else.

    dsp.js       biquads, and the level readings every tool takes
    fft.js       the transform
    loudness.js  BS.1770: LUFS, true peak, and the gates
    limiter.js   the lookahead ceiling, and the clipper beside it
    limiter-node.js  that, in a graph
    reduce.js    the frame and the stamp a reduction reading is taken on
    harmonics.js the sine probe, the series, and how to compare two
    targets.js   what each service asks of a master, and what it does to one
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

Four of these arrived the same way and for the same reason. `loudness.js`
moved here from `analysis/` when the level tool turned up; `reduce.js` and
`harmonics.js` were the compressor's and the saturator's until the limiter and
its clipper needed the same axis. A plugin may import `lib/` and its own
folder and nothing else, so the choice each time was to move the shared half
down or to write a second copy - and a second copy is worse than either
arrangement, because two readings would then claim the same axis having
computed it two ways and `comparable()` would wave them through.

`loudness.js` moved here from `analysis/` when the level tool turned up,
because a plugin may import `lib/` and its own folder and nothing else - and
the whole point of that tool is that it measures level the way the world does
rather than its own way, so it needs exactly this arithmetic. The seams test
caught the import the moment it was written.

**`lib/` imports only `lib/`.** It is the bottom of the tree or it is not a
library, and `tests/seams.test.js` holds that. `gap.js` used to be filed here
and dispatches to comparators living in six other folders, which made the
bottom layer depend on the whole tree; it is at `src/gap.js` now, where a
thing that depends on everything belongs.
