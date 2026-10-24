# eq

    plugin.js    the face
    filters.js   band maths, curves, the reading, and comparing two of them
    svf.js       the filter itself: one description, for drawing and for sound
    node.js      that filter on the audio thread, as a worklet
    sections.js  the worklet as a live Web Audio chain, with its auto gain
    spectrum.js  what is actually coming through, for the display
    player.js    auditioning it

`filters.js` and `sections.js` are split on purpose: the first is arithmetic
over arrays, the second makes Web Audio nodes. `tests/seams.test.js` holds the
line, and it caught them being merged within an hour of the split.

`svf.js` is on the arithmetic side of that line and is the reason the split is
worth holding. It is written once and read three times - drawn by
`sectionGainAt`, scored by `curveOf`, and run sample by sample by `svfRack`,
which `node.js` stringifies onto the audio thread. The EQ was the last of the
six tools to have two models of itself; it has one.

## The face

Four strips: the title, the displays, the deck, and the settings that belong
to the whole EQ rather than to one band. Everything a host does - Play, the
A/B against a target, the sample picker, the file button - is outside the
chassis, because none of it is an equaliser's.

The displays are the curve and a levels bay beside it. The curve carries the
spectrum behind it, the summed curve over that, and each band's own shape
drawn as **the curve as it would be without that band**. That edge meets the
curve wherever the band does nothing, so it is always attached to it, and the
gap between the two is exactly what the band is contributing there. Drawn
from the zero line instead - what a band does alone - nothing about it
touches the curve, and a cut draws a flat line along zero across the whole
display.

The deck is one band at a time: the rail picks it, Type and Slope say what it
is, and three knobs say what it is set to. The knob that does not apply is
dimmed where it stands, so the row never changes width under the pointer.

The headline is a measurement, not a restatement of the knobs: the most the
curve lifts and the most it cuts, with where. It was the single worst point
for a while, which reads well on paper and badly on a face - a high-pass
beats every boost an EQ will ever have, so what you got was the corner of the
high-pass, pinned to the bottom of the judged range, every time.
