# src

One folder per piece, and the pieces point one way.

    main.js       the entry
    gap.js        comparing two readings without knowing what kind they are,
                  which needs every comparator and so sits above everything
    plugins/      the nine devices: eq, compressor, saturation, stereo,
                  delay, reverb, level, limiter, align - and the gate and the
                  de-esser, which are the compressor's core with a second
                  face on it rather than folders of their own
    learn/        everything that asks a question - the exercises, the
                  marking, the written explanations, the session
    tools/        opening a plugin with no round to justify it
    sketch/       the sketchpad: clips, tracks, transport, inserts, export
    mix/          the mix exercise
    analysis/     the analysis view's readings
    core/         the audio graph and the engine that feeds it
    lib/          what more than one of the above needs

The arrows that matter, all held by `tests/seams.test.js`:

- **A plugin imports `lib/` and its own folder, nothing else.** Not `learn/`,
  not `sketch/`, not `core/`. That one rule is the whole of whether a device
  here could ever be lifted out and built somewhere that is not a browser.
- **`lib/` imports only `lib/`.** It is the bottom or it is not a library.
- **The maths a plugin is built on names no Web Audio type.** Web Audio
  belongs to `node.js` and `player.js`, which are the parts a port replaces.

The folder-to-folder graph is written down in that test too. A new edge
between two folders should be a decision, not an import somebody typed.

## Checking it

`npm test` is arithmetic: no browser, no dependencies, runs on a bare
checkout. `npm run check:browser` is the other half - the app in a real
Chromium, at 430, 932 and 1280 - and it is where every layout fault and every
class-name-in-a-string has been caught. It needs playwright, which is this
project's one dev dependency and ships in nothing; without it the checks skip
and say so. See `tests/browser/harness.mjs`.

Three of these were already broken when the test was written, which is why
there is a test: `lib/` imported upward into four plugins, five of the six
plugins reached into the compressor for a biquad, and the EQ could not build
its own filters without importing the sketchpad.
