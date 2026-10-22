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

4. ~~**A clip grid.**~~ **Done**, in `src/sketch/`. A project is data
   (`project.js`), a launch is arithmetic (`launch.js`), the step editor is
   arithmetic (`steps.js`), the graph is `stage.js`, and the page is
   `grid.js`. The stage takes its transport as an option, so the same code
   that plays can be driven by hand through an `OfflineAudioContext` — which
   is how it is measured, and what stem export will use.

5. ~~**Stem export.**~~ **Done**, in `src/sketch/stems.js`, with a WAV
   writer and a ZIP writer beside it. One render, not one a track: every
   stem is a tap on the same graph at the same moment, so they line up by
   construction. Measured on a four-track scene - the four stems plus the
   room sum back to the mix stem to within **−141.8 dBFS** on the worst
   sample, every file is exactly 14.000 s at 48 kHz and 24 bits, all of them
   start together, and `unzip -t` and Python's `wave` and `mido` all read
   the archive.

6. ~~**Recording.**~~ **Done**, in `src/sketch/record.js` and `takes.js`.
   Captured on the audio thread through a worklet rather than with
   `MediaRecorder`, because a take has to begin on a bar line to be any use
   in a loop and a bar line is an audio time. Cut to the nearest whole bar,
   stored as WAV bytes in IndexedDB - four bars of audio is a hundred times
   what localStorage is for - and played by the stage as a buffer a pass,
   through the track's own inserts and fader. Verified with Chromium's fake
   microphone: five seconds in, two bars out, 44.1 kHz 24-bit 220500 frames,
   surviving a reload and launching again.

## What is left

7. **A sample player**, behind the instrument interface.
8. **The other five plugins as inserts.** The EQ is mountable on a track's
   insert; the rest are not yet. The seam is cut and the EQ is the template,
   which is how everything else in this repository got built.
9. **Reordering a track's inserts.** They go on in the order they are
   pressed and come off by name; a chain is in series, so the order is
   audible, and there is no way to change it but to take them all off.
10. **Insert settings on a mix-exercise strip.** The sketchpad's tracks have
   them; the mix desk's four stems are still level, pan and send only.

## Questions this survey raised, and what they came to

- **Where the master limiter goes.** Settled: on the sketchpad's own bus, in
  `stage.js`, after the mixer and before `engine.out`. A limiter on the
  engine's master would change what every existing reading is taken through.
  It is a compressor at 20:1 a decibel under full scale — a safety net, not a
  mastering limiter. Measured: four tracks of a scene render at −8.1 dBFS,
  so on anything like normal material it never engages at all.

- **Phone versus desktop.** Settled, in `grid.js`, and the answer is that the
  *grid* is the same at both sizes and the *depth* moves. Four tracks by four
  scenes is sixteen buttons; at 430 px those are cells of about eighty, which
  is a comfortable target. The clip editor, the instrument and the inserts
  live in one panel, which CSS places as a column beside the grid above
  900 px and as a block under it below — one set of markup, two placements,
  and a `scrollIntoView` on a slot press so that the panel comes up when it
  is the thing below rather than the thing beside. Checked at 430 and 1280:
  no sideways scroll at either.

- **Whether the worklets survive going offline.** They do, and they very
  nearly did not. All three sent their opening settings with
  `port.postMessage` straight after constructing the node, and a port message
  is delivered when the main thread next gets a turn - which an offline
  render does not wait for. Measured: the imager rendered at an offline
  context with its width at 0.2 and at 2.2 produced *identical* audio, and
  putting a 60 ms pause before `startRendering` made the same two renders
  read 20 dB apart. The settings now go in through `processorOptions`, which
  arrives with the node, and the two renders agree with the paused ones to
  the last decimal. It was invisible live, where the message always wins,
  and it would have been invisible in a stem export too: every track would
  have rendered at its defaults.

  The *instruments* needed help as well: `onended` never fires during an
  offline render, so nothing was ever forgotten, and the voice cap silenced
  a bass part after sixteen notes. `base.hold` now sweeps voices whose tails
  ended before the note being added starts, which is true on either clock.

- **An EQ insert was a wire.** `eqEffect` built its filters transparent and
  never put the bands it was handed on them, so a track with a +9 dB low
  shelf rendered bit-identical to the same track with no insert at all. It
  applies them at construction now. The six tools were never affected - the
  EQ player calls `tuneSections` itself - which is why nothing caught it
  until a track insert was given something to do.

## Should the DSP be C++?

Asked, measured, and the answer for now is no - but the reasoning that
matters is narrower than it first looks.

**Most of this backend is already C++.** Web Audio's own nodes are C++ inside
the browser: the EQ is `BiquadFilterNode`s, the reverb and delay are a
`ConvolverNode`, and the faders, pans, splitters, buffer sources and safety
limiter are all native. Exactly three processors run this project's own JS on
the audio thread - the compressor, the saturator and the imager - plus a
capture worklet that only exists while something is recording. So the
question is not C++ against JS. It is whether those three should be
WebAssembly.

Two arguments that sound good and are not:

- *"Wasm means two implementations."* It need not. Node runs WebAssembly, so
  one compiled kernel could be loaded by the worklet and by `node --test`
  alike, and `heat/shape.js` being simultaneously the sound, the scoring and
  the test would survive. The real cost is a C++ toolchain and a build step
  in a project whose README says there is neither - which is a simplicity
  argument, not a correctness one.
- *"Base64 inflates the artifact by a third."* A third of the wasm, not of
  the app. These kernels are tens of kilobytes; it would add perhaps 20-40 KB
  to 957 KB.

The argument that actually decides it is headroom, and headroom is a
measurement. Rendering offline and timing it - wall time over audio time, so
1.0 means a second of DSP a second and nothing left over - on this
repository's own machine, an Intel Xeon at 2.10 GHz:

| what | load |
| --- | --- |
| a four-track sketch, no inserts | 0.07 |
| an EQ on each track | 0.12 |
| EQ and compressor on each | 0.16 |
| EQ, compressor and saturator on each | 0.42 |
| **all six effects on all four tracks** | **0.73** |

And the saturator alone, which is the one worth watching - eight times
oversampled through a 257-tap filter, about 392 multiply-adds per sample per
channel:

| instances | 1 | 2 | 4 | 8 | 12 | 16 | 24 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| load | 0.08 | 0.14 | 0.32 | 0.52 | 0.86 | 1.09 | 1.73 |

Twelve saturators at once is the ceiling on this machine. A realistic mix
sits at 0.42, which is a little over twice the headroom it needs. The
compressor and the imager cost about a twelfth of what the saturator does:
twelve of either reads 0.08.

One thing that is already right and would have been a reason to move: **the
processors do not allocate while running.** Every buffer in `shaperCore` -
the polyphase table, both ring buffers, the dry delay, the biquad state - is
built once in the closure, and `step()` contains no `new`, no `push` and no
`slice`. Garbage collection pauses are what usually glitches browser audio
before raw arithmetic does, and a large part of why wasm *feels* faster is
that it cannot allocate behind your back. That advantage is already taken.

**The phone, measured.** Chrome's CPU throttling (`Emulation.
setCPUThrottlingRate`) does not reach the Web Audio render thread - the
numbers at 4x are identical to the numbers at 1x - so the device had to run
the test itself. `dev/load.html` is that test, and it has been run:

| | this Xeon | the phone |
| --- | --- | --- |
| all six effects on all four tracks | 0.73 | **0.21** |
| 32 saturators | 2.30 | 0.89 |
| 48 saturators | - | 1.35 |
| crosses 1.0 at | ~15 saturators | **~36 saturators** |

So the phone is 2.65x this machine per saturator, and the worst case the
sketchpad can be put in - every one of the six tools on every one of the four
tracks - costs a fifth of a core there. **Nearly five times the headroom it
needs. The question is closed: stay in JS.**

Two things that figure does not capture, and neither changes it. A phone
sustains well below its burst speed, and a forty-second test may run entirely
in boost. And the audio thread shares the device with the UI, which redraws
at `requestAnimationFrame` while the grid plays, where the offline render has
the machine to itself. Halve it for both and there is still well over twice
the room needed.

One number leans the other way and belongs in the record. All six scaled 3.48x
between the two machines while saturators alone scaled 2.65x: the native nodes
- the convolvers and the biquads - gain more on ARM than this project's JS
does, so the three worklets are a *larger* share of the total on the phone
than they are here. At a fifth of a core it is academic. It would stop being
academic if the scope changed - inserts per clip rather than per track, or
many more tracks - which is the thing to re-measure if that ever happens.

The linearity is worth recording too: the phone's two points fit a straight
line at 0.0284 of a core per saturator to three decimals, with no cliff and no
fall-off. That is what a processor that does not allocate looks like under
load, and it means the ceiling can be extrapolated rather than hunted for.

The rule if that ever changes: port **only** the saturator kernel,
behind the `{ id, in, out, set, destroy }` interface `core/effect.js` already
fixes, and run the same wasm in the tests so there is still one
implementation. Nothing else is close enough to the limit to be worth a
toolchain.

## What the sketchpad is measured at

Rendered offline, at 48 kHz, through `makeStage` with its transport driven by
hand:

- **No drift.** A kick on every beat at 96 bpm lands at 0.065 s and then every
  0.625 s to 11.940 s — nineteen hits, and the last is as exact as the first.
- **A launch lands on the bar line.** A clip pressed at 3.30 s, a third of the
  way through the second bar, is queued for tick 3840 and the note at 4.435 s
  is still the old clip while the note at 5.060 s is the new one. 5.060 is the
  bar line.
- **Four tracks peak at −8.1 dBFS**, so nothing is working the limiter.
- **The export is what Logic opens.** A scene with a bass and a kit comes out
  as a Type 1 file, 480 ppq, 10.00 s, the bass on channel 1 with program 33
  and the kit on channel 10, each one-bar clip looped to four bars.
