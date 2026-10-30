# modulation

    dsp.js      the oscillator, the three wires, and the six rows
    trace.js    the path it takes, fitted for rate and depth, and compared
    node.js     the AudioWorklet, with a ScriptProcessor fallback
    player.js   two of them, to flip between
    plugin.js   the face: a path and a table

Six devices in one folder because they are one device. A low-frequency
oscillator at a delay time with the dry signal still there is a chorus at
fourteen milliseconds and a flanger at three; at the same place with the dry
signal gone it is vibrato; at the corner of a chain of all-passes it is a
phaser; at a gain it is tremolo, and at two gains pulling opposite ways it is
an auto-pan. `MOD_KINDS` is that table, and `modCore` is the three wires.

## Why there is a worklet

Three of the six could be built from the graph's own parts and the result
would be three implementations of one idea. The delay family is the reason it
would not do: a `DelayNode` interpolates its line linearly, and linear
interpolation of a line whose length is changing is a comb filter whose notch
moves with the sweep - so the top end breathes in time with the modulation,
which is a fault you only hear on the one device it matters for. The line
here is read with the same Catmull-Rom the delay reads its own line with.

What a worklet costs is that it can fail where nobody is listening: the
processor throws once, is torn down, and the node outputs silence for the rest
of the session with nothing on the face to say so - and because the reading is
the oscillator's path rather than a measurement of the audio, every round
still marks correctly over a device that has not made a sound since the page
loaded. `tests/mod.test.js` holds the worklet's source against the module's
core on this thread; `tests/browser/modulation.mjs` holds the installed
worklet against it, in a real graph, sample for sample.

It cannot be rendered offline either, the way the reverb and the delay
audition themselves. A rendered loop repeats, and an oscillator that is not a
whole number of cycles long inside the loop jumps at the splice: a chorus at
0.6 Hz over a five second loop is three cycles and a quarter.

## What the reading is, and what it cannot see

The oscillator's own path, in each family's unit, as a fraction of full
travel - not a measurement taken off the audio. The reason is in `trace.js`
and it is a measurement: no single probe sees all six. A tone through the
vibrato comes out with its spectrum unchanged to 0.00 dB, because a fully wet
delay is a pure delay, so anything watching the level is blind to it. A noise
probe sees a chorus and a phaser and is blind to the same vibrato. A tone
probe is blind to a phaser whose notches are nowhere near it: with the corner
at 670 Hz they sit at 180, 669 and 2480.

What that costs is the two controls downstream of the oscillator. Measured,
moving the feedback from -0.9 to +0.9 moves the reading by exactly 0.00, so
no round asks for it - what it does is in the notes, and the face lets you
hear it. The mix is not a control at all: a chorus at a hundred per cent wet
is vibrato, which is a different row of the table rather than a setting of the
same one.

## Why the rounds ask for note values

Both paths in a comparison start from the top of the sweep, so a rate error
reads as the two walking away from each other - which is sensitive. Measured
on a chorus at an eighth note, half a per cent of rate reads 6.4 per cent of
travel, and that is not a tolerance anybody could hit by turning a knob. So
the rate control has a sync menu off `lib/tempo.js`'s own division list, the
rounds are always on a note value, and the ear's job is to hear which one.
Free rates are still there to play with; they are not asked for.
