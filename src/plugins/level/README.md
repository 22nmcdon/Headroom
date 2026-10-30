# level

    plugin.js   the face: two meters and one knob
    gain.js     the trim, and the reading seam
    player.js   auditioning it against the untreated loop

The smallest device here by a long way, and the only one with no `node.js`: a
trim is `y = x * g`, so a GainNode and the arithmetic are the same thing and
there is nothing for a worklet to do.

## The reading is somebody else's

`lib/loudness.js`, unchanged - the same K-weighting, the same 400 ms blocks,
the same two gates, the same four-times-oversampled true peak. A level tool
that measured level its own way would be teaching its own arithmetic instead
of the one every delivery spec in the world is written in.

That file used to live in `analysis/`. It moved when this tool needed it,
because a plugin may import `lib/` and its own folder and nothing else -
`tests/seams.test.js` caught the import the moment it was written, which is
what that test is for.

## A trim moves the loudness by exactly the trim

Held to the decimal, because every exercise here marks a trim by reading the
output rather than by trusting the knob. Measured at every step from -12 to
+12, both the integrated loudness and the true peak move by exactly the trim.

It stops being true at the bottom. Integrated loudness throws away any 400 ms
block under -70 LUFS, so a deep enough trim starts losing blocks and the
relationship comes apart. Measured on the bed in `tests/level.test.js`, which
reads -21.633 LUFS:

    trim     integrated   out by   blocks kept
     -24       -45.633    0.0000       36
     -30       -51.633    0.0000       36
     -40       -61.174    0.4582       32
     -44       -64.441    1.1919       26
     -50       -69.063    2.5697       12
     -55      -Infinity      -           0

Where exactly it starts depends on the material rather than on the trim: the
same table over a quieter bed read 0.6997 out at -40 rather than 0.4582, which
is the same effect arriving sooner. That is why the range is +/-24 dB - at both
ends of it the trim is still exact on anything at a normal mix level - and why
the figure is stated against a named piece of material rather than as a
constant.

## The tolerances are a judgement, and say so

Unusually for this app, the numbers here are not set by what the measurement
can resolve. A gain is exact and the trim moves in tenths, so the floor is
0.05 LU of rounding and nothing else. They are set instead from the published
difference limen for level - about 1 dB on music, falling to 0.25-0.4 dB for
loud mid-frequency tones - so easy (1.5 LU) sits above a trained listener's
threshold, medium (0.8) about at it, and hard (0.4) below it. The hard tier is
reachable only because the A/B is instant and gapless.

The drill's chips never go under half a decibel for the same reason. Asking
for a quarter and marking somebody wrong would be marking them wrong for being
human.

## The comparison hides while a round is on

The meters stay up - a meter that hides what you are doing is not a meter -
but the dashed line at the untreated loop's level and the "3.4 LU louder"
readout come off, because those are literally the answer to the matching
exercise. Leaving them up would turn a listening question into a reading
question, which is the same mistake as printing the target's width on the
imager.

## Gain staging is not here

It is the third thing the curriculum asks for after naming a level and
matching one, and it needs a chain rather than a plugin: a saturator whose
drive is level-dependent followed by a compressor whose threshold is, with a
trim in front of each, scored on the level each stage sees and on the
resulting reduction and harmonics. That is the sketchpad's shape, not a
face's, so it belongs with the mix-craft modules and not in this folder.
