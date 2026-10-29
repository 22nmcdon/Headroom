# stereo

    plugin.js   the face
    field.js    the width and placement maths, and comparing two readings
    shuffle.js  width that is not the same at every frequency
    widen.js    making side out of middle, which nothing else here can do
    coherence.js  and whether that width was made or recorded
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

## Making side out of middle

Every control in field.js is a ratio on side that is already there. Turn all
three widths up on a mono source and nothing happens, because two and a half
times nothing is nothing - measured, -333 dB of side, which is the
floating-point floor. That is the gap `widen.js` closes, and it is the only
thing in this folder that adds rather than scales.

Five kinds, measured through the real arithmetic at an amount of 0.8 and a
delay of 12 ms. `mono` and `one side` are how uneven the spectrum is - the
standard deviation in dB at a twelfth of an octave, so a comb's teeth are
resolved rather than averaged away:

    kind           width     mono    one side    lag      coherence
    Haas           -9.1 dB   2.85     6.01      11.6 ms   0.84-1.00
    comb           -1.9      0.00     6.01      -9.5      0.53-0.99
    all-pass       -1.9      0.00     5.99       9.5      1.00
    decorrelator   -1.1      0.00     4.13      -4.8      0.99-1.00
    micro-pitch    -6.6      5.86     6.45       0.0      0.19-0.73

**The mono column splits Haas from the three complementary kinds**, and no
width meter can see it. Sending the delayed copy to one side leaves nearly
three decibels of comb in the sum; putting it in the side leaves exactly none,
because L = M + D and R = M - D add back to M whatever D is.

**The coherence column splits micro-pitch from everything else**, and the
decorrelator was the surprise. A velvet-noise response is a linear
time-invariant filter like any other, so however diffuse it sounds, each
channel stays perfectly predictable from the other - it reads 0.99 to 1.00,
as coherent as a bare delay. Only the kind that moves reads low. So coherence
does not separate artificial width from natural. It separates time-invariant
from time-varying, and the only widener here that passes is the one that
drifts for ever.

**What does not separate is comb against all-pass.** The usual reason for
preferring the all-pass version is that it is "less comb-like", and measured
as unevenness that is simply not true: 5.99 against 6.01. Each channel is
1 +/- g times an all-pass, and an all-pass has unit magnitude everywhere, so
the sum swings between 1-g and 1+g exactly as a delay's does. What differs is
where the teeth are, not how deep - a delay puts nulls at odd multiples of one
over twice the delay, which an ear hears as a pitch, and a chain of all-passes
puts them wherever its phase crosses, which an ear hears as phasiness. No
reading here measures that, and saying so is better than implying these
numbers prove something they do not.

One asymmetry worth knowing, since the design looks symmetric: for the
all-pass kind the two channels are not equally uneven, 1.58 against 5.99,
because its phase does not sweep evenly and so 1 + g*AP and 1 - g*AP are not
mirror images the way they are for a delay.

**A measurement note that cost a test.** Comparing the mono sum's spectrum
against the raw input reads 1.14 dB of comb from a kind whose two additions
are exact negatives. The crossover's all-passes shift the output's phase
without changing its level, and a Goertzel over a window holding a
non-integer number of cycles reads a phase-shifted signal differently at the
edges. Measured directly, the mono sum deviates from the input by the same
4.543e-1 at the same sample with the widener on and off. The comparison has
to be against the imager's own output with the widener off.

## Whether the width was made or recorded

Every other reading here measures how much side there is. None of them can say
where it came from, and that is the more interesting question: a Haas delay, a
complementary comb, a velvet-noise decorrelator and two microphones two metres
apart can read the same width, the same correlation and the same fold-down
loss, and three of them are one signal filtered twice.

Coherence is what tells them apart, and not in the way it is usually
described. It is invariant to any linear time-invariant filtering - if one
channel is any filter of the other, however wild, coherence is one at every
frequency. So it does not separate artificial width from natural. It separates
a filter that stands still from two signals or something that moves.

    delay      Haas    comb   all-pass   velvet
     1 ms     0.000   0.001    0.084     0.012
    12 ms     0.016   0.041    0.084     0.012
    20 ms     0.035   0.135    0.084     0.012
    40 ms     0.081   0.327    0.084     0.012

    micro-pitch:  2 cents 0.635  9 cents 0.487  15 cents 0.511  25 cents 0.543

Swept rather than measured at one setting, which matters: at twelve
milliseconds the separation looks twelve to one and at the comb's longest
delay it is one and a half to one. Every static kind stays under 0.33 and the
moving one stays over 0.48, so 0.4 is the only line between them.

**The window has a trap at each end and the usable range is narrow.** Too
short and a delay reads as decorrelated, because the two channels' windows
hold different material. Too few frames and everything reads coherent, because
the floor for unrelated signals is about one over the frame count. Measured
over six seconds, 300 Hz to 5 kHz:

    window    ms   frames    1 ms   12 ms   40 ms   unrelated
      2048    43     280    0.993   0.349   0.004     0.0040
      4096    85     139    0.998   0.772   0.052     0.0077
      8192   171      69    1.000   0.938   0.489     0.0152
     16384   341      34    1.000   0.984   0.839     0.0304

Sixteen thousand is the only one that keeps the longest delay up at 0.84 while
the floor is still 0.03. The research this came from recommends frames of
twenty to fifty milliseconds alongside Haas delays of one to forty; those two
contradict each other, and at 43 ms a twelve-millisecond delay reads 0.349 -
the reading would call the most common widener setting "decorrelated".

**It must be averaged across a band's bins, not taken at one frequency.** One
bin's cross-spectrum is a sum of random phasors however many frames it is
averaged over, so its variance never comes down: a first attempt with one
Goertzel per band read two unrelated noises at 0.02, then 0.46, then 0.07 as
the frame count went 5, 12, 25.

**And the probe's noise generator is part of the measurement.** The first
version used the classic linear congruential generator and put the floor
thirteen times where it belonged - 0.5790 against an expected 0.0435 - because
an LCG of that form has lattice structure and a sixteen-thousand-point
transform is long enough to resolve it. Two streams from it are not unrelated,
they are related in a way only a long window can see. The estimator was fine
all along, checked against a known transform and against theory at 0.0024
where one in two hundred was expected.

It costs 229 ms a reading against the image reading's 49, so it belongs on a
submitted guess and not on a knob being turned.

## Notchiness is not a reading, and that is worth writing down

The obvious companion to coherence is how combed the mono sum is - it is what
separates Haas from the complementary kinds, measured at 2.85 dB against
exactly 0.00. It cannot be a reading of audio, because it needs the dry input
to compare against and a reading of somebody's mix has no dry input.

The reference-free version that suggests itself - the mono sum against the
stereo power at the same fine resolution - does not work. Measured:

    kind         against the input   against the stereo power
    Haas               2.67 dB                 1.21 dB
    comb               0.00                    2.15
    all-pass           0.00                    1.45
    velvet             0.00                    2.74
    micro              8.46                    1.71

The separation is gone and the order is scrambled - the comb reads higher than
Haas. The reason is that the mono-to-stereo power ratio is about one over one
plus the side-to-mid ratio, so it is a width measure wearing a comb measure's
name. So the mono notch stays where it works, in the widener's own tests,
where the dry signal exists.
