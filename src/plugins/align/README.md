# align

    pair.js     the arithmetic: the second mic, the sum, the comb, the search
    player.js   two buffer sources, a delay and a polarity switch
    plugin.js   the face: the comb and the correlation

The only device here that processes nothing. Everything else in `plugins/`
takes a signal and shapes it; this takes two recordings of one event and
decides how to add them up, which is a delay, a polarity switch and a fader.

There is no `node.js` and there will not be one. A `DelayNode`, a `GainNode`
with a negative gain and an implicit sum are the whole processor, and a
worklet would be a reimplementation of three things the graph already does
correctly. What that costs is a promise: `pairSum` has to match
`delayTime`'s own fractional interpolation, or the numbers on the face are
about a different sum from the one in your ears. `tests/browser/align.mjs`
renders the pair through both and differences them - measured at 68 to 82 dB
below the sum's own level, and exactly zero when the delay is. A delay line
off by one sample would read -9.6 dB on the same material.

## What the second microphone is

A model, and `farMic` says what it leaves out. A real second mic has its own
capsule, its own axis and its own part of the instrument in front of it; this
one is the close mic down a path - later, quieter, and rolled off. What that
keeps is the part alignment is about, and what it loses is the part alignment
cannot fix.

The rolloff is load-bearing rather than decorative. It is why the reading
stops at four kilohertz: measured, the path is 6.0 dB down from 40 Hz to 640
and 15.2 down at 10 kHz, so above the band set's ceiling the far mic is too
quiet to comb with, and counting it would score a twentieth of a millisecond
as half of no alignment at all.

## Why the face does not print the lag

It draws the correlation curve and marks its peak, and prints no number. The
peak is the answer to the round, read off a curve at about a twelfth of a
millisecond per step - coarser than any tolerance here - so it points you at
the right millisecond and your ears do the rest. A numeric readout would be
an auto-align button, and a tool that answers the question teaches nothing
about it.
