# core

The audio graph, and the engine that feeds it.

    audio.js       the engine: synthesised sources, rendered loops, no samples
    effect.js      what an effect is: `{ id, in, out, set, destroy }`
    effects.js     building one of the six, live, for a track
    instrument.js  what an instrument is: `{ id, out, noteOn, noteOff, ... }`
    track.js       a track: instrument, inserts, fader, pan

`effects.js` imports all six plugins, which is the right direction - the
sketchpad's factory knows about devices, and a device knows nothing about
being put in a chain.
