# core

The audio graph, and the engine that feeds it.

    audio.js       the engine: synthesised sources, rendered loops, no samples
                   - including the beds, and `room`, which is the drums with
                     ghost notes and a floor under them for a gate to decide
                     about, and `voice`, whose esses a de-esser is aimed at
    effect.js      what an effect is: `{ id, in, out, set, destroy }`
    effects.js     building one of the six insertable ones, live, for a track
    instrument.js  what an instrument is: `{ id, out, noteOn, noteOff, ... }`
    track.js       a track: instrument, inserts, fader, pan

`effects.js` imports the six plugins a sketchpad insert can be, which is the
right direction - the sketchpad's factory knows about devices, and a device
knows nothing about being put in a chain.

A bed is not decoration. Twice now a tool has been built against a bed that
could not show what it does: a gate over the `drums` bed was deciding how
much quieter to make digital silence, and a de-esser over the first `voice`
bed moved the loop so little that every tolerance it could have had would
have accepted a bypass. Both were found by measuring, both were fixed here
rather than in the tool, and the numbers are in `aimed.js` and in the two
work files.
