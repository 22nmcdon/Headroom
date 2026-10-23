# learn

Everything that asks a question.

    bench/   the session: the registry of tools, the path, the picker, the log
    work/    one file per mode, holding its exercises and its marking
    notes/   the written half - what each tool is, for somebody using one
    game.js  reading a guess against an answer
    stats.js what has been attempted and how it went

A `work/` filename is the **mode id**, which is what a saved sketch stores, so
those names are data and not nicknames: `work/panning.js` stays `panning.js`
even though the tool is called Stereo. A `notes/` filename is not, which is
why `notes/image.js` became `notes/stereo.js`.

The arrow runs one way: this folder imports plugins, and no plugin imports
this folder. `tests/seams.test.js` holds it, and
`src/plugins/README.md` says what it is for.

Tolerances live here, next to the marking that uses them. When a face needs
one - the saturation drill draws the window it is being marked to - it travels
out with the answer through `showTarget`, rather than being copied into the
plugin where it would quietly drift.
