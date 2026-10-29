# stereo

    plugin.js   the face
    field.js    the width and placement maths, and comparing two readings
    shuffle.js  width that is not the same at every frequency
    node.js     the AudioWorklet
    player.js   auditioning it

This was `image/` until the tree was reorganised, and `IMAGE_` became
`STEREO_` with it - the only one of the four nicknames worth renaming, because
"image" in a codebase reads as a picture rather than as a stereo tool.

What stayed is "image" in prose wherever it means the stereo image, which is
the actual term for the thing this shapes.

## The three bands have to be added back in step

They were not. The split is a tree - the input is cut at the low corner and
the upper half is cut again at the top corner - so the low band had been
through one crossover where the other two had been through two, and the sum of
a Linkwitz-Riley pair is not a wire, it is an all-pass. Measured with every
width at one, where the tool should do nothing whatsoever, the worst error
across 40 Hz to 10 kHz:

    corners            before     after
    250 / 4000 Hz     -0.04 dB   0.01 dB
    800 / 4000        -0.45      0.02
    250 / 1500        -0.31     -0.01
    800 / 1500        -4.09      0.02

Four decibels out of the midrange from a tool asked to do nothing, and it hid
at the defaults because the corners are far enough apart there that the
all-pass has barely turned. The reading said it too: through the same
material, the whole-band width read -9.14 dB at the default corners and -8.91
at their closest, where a flat imager has to read the same wherever its
corners are. Both read -9.15 now.

## Frequency-dependent width

The band widths do this in steps. `shuffle.js` does the two things a step
cannot: take the side out from under a corner entirely, and lift it where a
record needs lifting. Both are older than any plugin that has them.

Neither can be heard in mono, and that is structural rather than lucky: mono
is the middle and both filters are on the side, so there is no setting of
either that a mono listener can detect. That is the whole reason somebody
reaches for the first of them.

**There is no phase compensation on the middle, and the textbook says there
should be.** The worry is real - a filter on the side alone changes when the
side arrives relative to the middle, and L = M + S decodes a late side as a
smeared image rather than a narrow one. Gerzon measured an eight-decibel side
shelf at about twenty-five degrees of lag around 600 Hz and called it
"phasiness"; this one measures thirty-six at the same place, which is the same
finding. But it cannot be fixed the way it is usually described. A high-pass
and a shelf are both minimum-phase: their phase is determined by their
magnitude, and no all-pass has that phase. What the classic compensators do is
approximate a shelf's phase over a narrow range, which is a smaller claim than
"matched". What makes it acceptable here is that the cost is confined to the
image in the transition band, and mono - the thing the control exists for - is
untouched by construction.

**Twenty-four decibels an octave is two biquads, not four.** The first version
used four and the label still said 24. Every biquad here is at a Q of one over
root two, which is twelve decibels an octave, so four of them is forty-eight
and twelve decibels down at the corner. Measured, which is how it was caught.

**The bottom of the Mono below knob means off**, rather than a zero beneath
it. A default has to sit inside its own limits or a saved file loads back
clamped into them, and a `monoBelow` of 0 would have come back as 40 with the
filter quietly on. An existing test caught that the moment the knob existed.
