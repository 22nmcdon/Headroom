# stereo

    plugin.js   the face
    field.js    the width and placement maths, and comparing two readings
    shuffle.js  width that is not the same at every frequency
    widen.js    making side out of middle, which nothing else here can do
    coherence.js  and whether that width was made or recorded
    pan.js      where a thing sits, and the two questions that hides
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

## Panning is two operations, and most desks only offer one

Panning a mono source is placing a point: one signal, two gains, and the only
decision is how those two gains add up in the middle. Panning a stereo source
is not that at all - there are two signals already in two places, and "pan"
can mean either moving the whole field or placing each side somewhere new.

Both modes are here, because the difference is a thing to be able to hear.
**Balance** is what a stereo channel on a desk does and what Web Audio's own
stereo panner does with two channels in: turn one side down and fold it
towards the other. **Dual pan** gives each input channel its own position,
which is the only way to narrow a stereo source to one part of the field.
Measured, as width in dB on an unrelated pair:

    both sides where they were (-1, +1)         0.03 dB
    both brought a quarter in (-0.25, +0.25)  -14.00
    both in the same place (0, 0)            -339

Balance cannot express the middle row at all, because balance only ever has
one number: the most it can do to a wide source is close one side. The last
row is mono to the last bit the arithmetic has, which is dual pan's other end
rather than a bug - and its first row is its rest, so selecting the mode moves
nothing: the matrix comes to exactly {1, 0, 0, 1} under two of the three laws
and 6.1e-17 off under the third, which is cos(pi/2) in binary.

**The pan law is the thing the choice is for, and it shows up in mono.** The
number in each law's name is how far down the centre is, and that is exactly
how far apart a centred part and a hard-panned one come out once the two
channels are summed. Measured through the imager, as the mono level of the
same mono source placed each way:

    law        centre - hard left
    -3 dB            3.01 dB
    -4.5 dB          1.51
    -6 dB            0.00

So under -6 a pan move costs nothing in mono and under -3 it costs three
decibels. Rooms add somewhere between coherently and in power, which is why
desks settled on -4.5 as a compromise and broadcast settled on -6.

**The law has no say over balance**, which is held to the sample in a test:
balance is a crossfade between two channels that are already placed, so there
is no centre to cost anything. The first version of the pan matrix had a
branch per mode and the two branches computed the same expression with the
operands in a different order - a branch that only looks like it is doing
something.

**The square-root law is left out on purpose.** It is the fourth law the
textbooks list and it is three decibels down in the middle like the first one,
so what differs is the shape between the ends: measured, 0.56 dB from the
cosine law a quarter of the way across and 2.32 the other side of centre, not
symmetric, because the square root puts more in the far channel and so reads
wider. It is a real difference and not the one this app teaches. Three laws
with three different centres is a question; four laws where two share an
answer is a trick.

**What balance costs at its extreme**, as what the surviving channel gains
over the input it came from, over four seconds at hard right:

    pair                           by peak    by energy
    correlated                      6.02 dB    6.02 dB
    unrelated, white noise          6.01       3.01
    unrelated, two sines            5.60       3.01
    unrelated, low-passed noise     3.41       3.00

Six decibels for correlated content is the figure usually quoted and it is
right, and it is the same by both measures. For unrelated content the two
measures disagree, and only one of them is a property of the pan: the energy
answer is 3.01 whatever the material, and the peak answer is anywhere between
2 and 6 depending on how often the two channels' peaks coincide. An engineer
reading an energy meter is told uncorrelated content is three decibels safer
here, and the peak may not agree.

**And the real headroom trap is not about correlation at all.** At hard right
the output is L + R, so its peak cannot exceed twice the louder channel's -
6.02 dB over that channel, and more than that over the other one. Balance
folds the channel you are turning away into the one you are keeping, so the
louder the side being folded, the further past six decibels the survivor goes.
Measured on an unrelated pair:

    left at the right's level    6.01 dB by peak
    left twice the right         9.53
    left four times the right   13.97

A first version of the table above read 9.41 dB for "uncorrelated", which was
this effect measured on an unequal pair and filed under correlation. It did
not reproduce when it was measured again, which is the only reason it was
caught.

## Raising the reading's ceiling needed a band, not a wider band

The image was read in six bands stopping at 14 kHz. The obvious way to take
that to 20 was to stretch the top band, and measured, that changes what the
reading says by 0.06 dB. In this app's own material 14 to 20 kHz runs thirty
decibels under 6 to 14, so a pooled 6-20 band is decided entirely by its
bottom end and reads to 20 kHz in name only. A ceiling can only be raised by
adding a band.

Added as a seventh, it earns its place and does not get in the way. Measured
as how far apart two imagers read, on a target and a guess that differ
somewhere other than the top:

    what is wrong             six bands        seven
    low end too wide        5.93 at sub     5.93 at sub
    mid slightly off        2.86 at mid     2.86 at mid
    a touch narrow all over 1.94 at himid   1.94 at himid
    top wide against flat   5.73 at high    6.01 at the new one

So a band with thirty decibels less in it than its neighbour does not hijack
the worst-band search - every error below the top reports the same band at the
same number - and an error at the top reads larger, which is the point of
going up there. No energy gate was needed, which is what this was expected to
need.

It earns its place against the band below it too. With the top width control
at zero and the upper crossover at 4 kHz, the new band reads -30.0 dB against
the band below it at -24.3: narrowing the top takes 14-20 kHz all the way to
mono while 6-14 keeps some side, and that is the distinction a pooled band
loses.

The band is narrower than the family - a ratio of 1.43 where the others are
2.3 to 3.0 - and that is Nyquist's doing rather than a choice. At 44.1 kHz
there is nowhere above 20 kHz for its top edge to go.

**And a band has to stop where it says, not where the sample rate does.**
`bandOf` skipped its low-pass above a flat 20 kHz, which was harmless while no
band reached that high and wrong the moment one did: a band declared to 20 kHz
got no low-pass at all and ran to Nyquist, so the same material read 14-22.05
kHz at 44.1 and 14-24 at 48. Measured then, a 21 kHz tone came out of that
band at -0.0 dB. The guard is Nyquist now, and the band is 6 dB down at its
own corner at both rates - 20 kHz reads -6.0 at 44.1 and -6.1 at 48. What
still differs between the rates is the skirt above the corner, 21 kHz reading
-24.0 against -12.7, because the same corner sits at a different fraction of
Nyquist. That is past the corner and past hearing, so there is nothing up
there for the two to disagree about.

The mix exercise reads placement in these same bands and its tolerances are
measured, so the seventh band was checked against them: an unchanged mix still
reads 0.00 on all five readings, and a pan move of 0.10, 0.20 and 0.35 still
reads 0.45, 0.89 and 1.52 on placement against the 0.42, 0.87 and 1.57 the
tolerances were set from.

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
