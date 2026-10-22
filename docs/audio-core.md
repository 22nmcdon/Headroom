# The audio core, as it stands

*Answering the sketchpad plan's first open question: what is Headroom's stack,
and does it already share an audio engine across the six plugins?*

**Short answer: yes, one context and one output — and no, nothing else.** The
six tools share a clock and a destination and agree on almost nothing else
about how a sound gets made. That is not a fault; it is what six tools built
one at a time look like, and each one is calibrated and tested as it stands.
But it is why the sketchpad cannot simply reuse them yet, and this document is
the survey that says what has to change.

## The stack

No framework, no build step, no dependencies. Plain ES modules served as
files, the Web Audio API, and `node --test` for everything that is not
drawing. `npm run artifact` flattens the modules into a single HTML file for
publishing; that bundler is also the thing that refuses two modules declaring
the same top-level name, because one flattened scope cannot hold both.

```
index.html      the shell
styles.css      the design system, as tokens and components
src/            ES modules, no transpilation
scripts/        the single-file bundler and the module order it derives
tests/          node:test, no browser
```

## What is already shared

**One `AudioContext`, and exactly one.** `src/audio.js` holds an `Engine`
class with a lazily created context (`ensure()`, because browsers refuse audio
before a gesture) and a master gain at 0.7 feeding the destination. Every
player takes the engine in its constructor and calls `engine.ensure()` rather
than making a context of its own. Nothing in the app ever constructs a second
one.

**One output.** Every tool's chain ends at `engine.out`, which is that master
gain.

**One source of material.** `Engine.renderLoop(kind, opts)` renders a few bars
into a buffer offline and caches it by a key covering everything that makes it
a different recording — the kind, the bars, the tempo, how uneven it is, and
whether it is spread across the field. The four-piece bed, the drums, the keys
and the pink noise all come from there, and the loop is a buffer rather than a
live schedule because a tool is judged by moving a control and hearing the
same material change under your hands.

**One lifecycle.** Every plugin implements the same contract — `state` /
`setState`, `read` / `readNow`, `setSource`, `loadFile`, `setFault`,
`setTarget`, `showTarget`, `nameAB`, `lock` / `unlock`, `source`, `abLabel`,
`material`, `toggle`, `isPlaying`, `destroy` — and `src/bench/session.js`
drives it without knowing which tool it is holding.

**One shape of measurement.** `src/read.js` is the envelope every reading
arrives in, and `src/gap.js` compares two of them without knowing the kind.

## What is not shared

**There is no instrument.** Nothing in this app plays a note. `Engine` has
`note()`, `drum()` and `playBed()`, which synthesise directly into the graph
at a scheduled time, but there is no object you can hand a pitch and a
velocity to and ask for a voice. The sketchpad needs exactly that, and it is
the largest missing piece.

**There is no effect interface.** Each tool's audio lives in its own player,
and the five of them are five different shapes:

| Tool | Player | What it is |
| --- | --- | --- |
| EQ | `src/eq/player.js` | Six `BiquadFilterNode`s, plus a fault filter and an analyser |
| Compression | `src/comp/player.js` | An `AudioWorklet`, stringified from `src/comp/node.js`, with two parallel chains for the A/B and a key input |
| Stereo | `src/image/player.js` | A mid/side network split three ways, with a channel splitter and two analysers for the goniometer |
| Reverb | `src/fx/player.js` | A `ConvolverNode` fed an impulse built from numbers in `src/verb/ir.js` |
| Delay | `src/fx/player.js` | The same `ImpulsePlayer`, fed an impulse from `src/echo/line.js` |
| Saturation | `src/heat/player.js` | An `AudioWorklet` from `src/heat/node.js`, running eight times oversampled |

The reverb and the delay already share one player, which is the proof that
this is possible: both are completely described by what they do to one click,
so one convolver serves both.

None of the five can be put in series with another. Each builds its own chain
from the source to `engine.out` in one piece, so there is no "in" and "out" to
connect — which is what an insert chain is.

**There is no transport.** Loops are `AudioBufferSourceNode`s with `loop =
true`, started once and left running. There is no position, no bar, no tempo
the app can read, and nothing is scheduled against a grid. The practice side
does not need one; the sketchpad is nothing without one.

**There is no concept of a track.** Material goes in one end and the master
comes out the other. There are no stems, no per-part gain or pan, and no way
to run two sources at once.

## What already exists that the sketchpad can take

- **One context, one master, one cache of rendered material.**
- **The six tools' DSP**, which is the part worth keeping: `eq/filters.js`,
  `comp/dsp.js`, `image/field.js`, `verb/ir.js`, `echo/line.js`,
  `heat/shape.js` are all pure and all tested against measurements.
- **The worklet stringifying** in `src/fx/worklet.js`, which is how the
  compressor and the saturator run their maths on the audio thread without a
  separate build step.
- **The analysis readings** in `src/analysis/`, which will read a sketch back
  as happily as they read a file.
- **The transport** in `src/sketch/transport.js` — new, and the first piece of
  the shared core that did not exist before.
- **The exporter** in `src/sketch/midi.js` — also new.

## What has to be built

In the order the sketchpad plan wants them:

1. ~~**An effect interface.**~~ **Done**, in `src/core/`. An effect is `{ id,
   in, out, set, destroy }` and `chainOf` puts several in series and hands
   back the same shape, so a chain is itself an effect. Four of the six were
   already live worklet nodes with an input and an output and are wrapped
   as-is; the EQ's chain of biquads moved into `core/effects.js` and the EQ
   player now calls it, so there is one of those rather than two. The reverb
   and the delay needed a live `ConvolverNode`, because their players
   pre-render the wet signal rather than convolving — same impulse builder,
   different place.
2. ~~**An instrument interface.**~~ **Done**, in `src/core/instrument.js`.
   `{ id, out, noteOn, noteOff, play, destroy }`, with four synthesised
   instruments behind it — a piano, a bass, a kit on the General MIDI drum
   map, and a synth that actually sustains. Times are audio times, so the
   transport books a bar ahead and nothing has to be awake when a note
   sounds. A sample player goes behind the same interface later; writing the
   interface first is what stops the second engine inventing its own shape.
3. ~~**A track.**~~ **Done**, in `src/core/track.js`. An instrument, a chain
   of inserts, a fader, an equal-power pan and a post-fader send, into a bus
   — which is a sketchpad track and a mix-mode stem and the same object.
   `notesIn` is the pure arithmetic between a clip and the transport's
   windows, and it is where the loop-point off-by-one lives.

## What is left

4. **A clip grid.** Scenes, launch, and somewhere to put all of the above.
5. **A sample player**, behind the instrument interface.
6. **Stem export**, which is an offline render of each track.

## Open questions this survey does not settle

- **Where the master limiter goes.** The plan asks for a safety limiter on the
  output. Headroom's master is a plain gain at 0.7 and the practice side has
  never needed one; adding it changes what every existing reading is taken
  through, so it belongs after the mixer rather than on `engine.out`.
- **Whether the worklets survive going offline.** Stem export renders each
  track through an `OfflineAudioContext`, and a worklet has to be added to
  that context's module list too. The saturator's eight-times oversampling is
  the one most likely to be expensive at render time.
- **Phone versus desktop.** Still open, and it is not only a layout question:
  a clip grid wide enough to be useful and a set of insert chains are
  different amounts of screen, and the plan's own Phase 3 gate is a phone one.
  The working assumption is desktop-first with the grid and launch reachable
  on a phone and the editing depth a tap further away, but that is an
  assumption and not a decision.
