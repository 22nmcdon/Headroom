# mix

The mix exercise: a piece, a brief, and a score for how close the balance is.

    brief.js      what a round asks for: the tiers, the target, the grid
    piece.js      the four stems and the pieces they play
    render.js     the project as audio, and the six readings taken off it
    score.js      the tolerances, the marking, and the advice
    placement.js  where each part sits, which a width reading is blind to
    levels.js     how loud each part is, which the master cannot say
    share.js      which part owns which register, which is what masking is
    room.js       how much room there is and what is in it, which is distance
    monitor.js    hearing the two at the same loudness, which is a monitor
                  control and is nowhere near the marking
    page.js       the strips, the transport and the result

Marked on readings rather than on fader positions, the same way every other
mode here marks on what came out rather than on what was set.

## Five readings of the master, and two of the parts

The five read the sum, which is right: two sets of moves that come out
sounding the same are the same answer. What it leaves is advice that cannot
name a fader. "There is too much around 120 Hz" is true and is not an
instruction.

`levels.js` reads each track post-fader instead, so the advice can say "the
bass is 2.5 dB too hot". Not the fader positions - a stem's output level is
its fader AND whatever its inserts did to it, and the tone tier puts an EQ on
two of them, so reading the knob would be wrong exactly where the exercise is
most interesting.

**It reads each part against the mean of the parts**, so the overall level is
taken out and what is left is the shape of the balance. Measured, moving all
four faders by a step reads 0.000 exactly; the loudness reading is what
catches that. A mix perfectly balanced two decibels down should fail on one
reading, not on five.

**That makes the number not a fader position, and the first version of this
got it wrong.** It claimed a reading of X meant 4X/3 of fader, which holds
when exactly one fader is out - a quarter of a single move goes into the mean -
and is false with two. The advice built on it said "the keys are 2.3 dB too
hot" about a fader nobody had touched. Removing the mean is lossy on purpose:
any set of moves and that set plus a constant read the same, so no reading of
it can recover an absolute fader error. The advice says "against the rest of
the parts" now, which is exactly what the number is.

The anchors the tolerances are set from, measured against an answer:

    one fader out by one step (0.5 dB)      0.375
    one fader out by two steps              0.750
    one fader out by four steps (2 dB)      1.500
    two faders out by a step, same way      0.250
    two faders out by a step, opposite      0.500
    all four out by a step                  0.000

## Two renders a submit, and why it is not one

A submit renders twice: the master through `renderMix`, and the parts through
`sketch/stems.js`, which taps every track in a single pass. Measured, 1947 ms
one after the other against 886 for the master alone, and running them
together saves nothing - two offline renders of the same project contend
completely, at 1934 ms. So a submit roughly doubles.

It could be one. The stems pass already taps everything, and tapping the
limiter's output alongside would give all six readings for one render's
price. That was built and taken out again, because the two renders do not
produce the same master:

    renderMix     632023 samples, first sound at 2867, energy -30.168
    stems tap     627613 samples, first sound at  221, energy -29.512

Both causes are small and in plain sight - `renderMix` adds a tenth of a
second to its context and calls `stage.play()`, which starts a breath after
zero, where the stems pass calls `play(0)`. Almost certainly alignable. Not
aligned here, because the five master readings carry tolerances measured on
that exact signal, and a near-miss at aligning them would silently re-mark
every tier rather than fail loudly.

## The stems carry their own ids

`pieceOf` used to overwrite each starter track's name and instrument and
leave its id alone, so track 0 was called Drums and carried `id: 'piano'`
while track 2 was called Keys and carried `id: 'kit'` - the sketchpad's
starter ids, in the starter's order, contradicting what the tracks held.
Nothing read them, so nothing was broken. What it cost was that a per-stem
reading had no honest key to file itself under.

## Matching the levels, and the one number the control will not print

Louder sounds better. Put the same mix up by a decibel and a half and people
report more punch, a better low end and a wider image — about a difference
they could not name if you asked them what had changed. So an A/B between two
mixes at two levels compares the levels, with the mixes along for the ride,
and this exercise hands somebody exactly that: measured, the answer sits 0.19
to 2.30 LU from the flat mix a round opens on, depending on the tier and the
seed.

`monitor.js` trims the reference to the level of the mix being worked on. The
reference, not yours — your level is part of what is being decided, and a
monitor that moved it would be moving the work. The trim is a GainNode between
the stage and the engine's output, which is the only place it can go and be
honest: everything the marking reads is rendered from the project, and the
project ends at the stage.

**It never prints the trim.** The trim is the difference between your loudness
and the reference's, which is the `loudness` reading the round is marked on —
so a readout of it would hand over a sixth of the answer in exchange for a
tidier display. The note under the bar explains what matching is for instead,
which is the part worth knowing.

**The estimate is an approximation and says so.** Knowing a mix's loudness
honestly means rendering it, and a render is 886 ms of main thread with the
music playing through it, so re-rendering on every fader move would stutter
the thing the control exists to let you hear. Instead one mix is rendered and
read for real — on demand, and again free with every submit — and the fader
moves since are applied to the parts' own loudnesses and added back up as
energy. Measured against real renders, in decibels off:

    move                      anchored on the answer   anchored on flat
    one fader by 1 dB                      0.00, 0.00       0.01, 0.01
    two faders 3 dB apart            0.05, 0.09, 0.12       0.13, 0.13
    all three by 4 dB                     -0.25, -0.25     -0.16, -0.16

A single fader is exact to a hundredth. Only moving everything at once drifts,
and then by a quarter of a decibel against the one to two it is removing.

A pan and a send are safe to move afterwards and a tone control is not, which
is also measured: two parts panned to 0.7 moved the master's loudness by 0.03
dB and two sends up to 0.6 and 0.4 by 0.19, where a tone move of eight
decibels on the bass moved it by 1.08. So a colour move says the match is out
of date rather than carrying on with it.

## Making room, and the fault that is in the material

Every other tier puts something wrong and asks for it to be put right. This
one puts nothing wrong. Measured on the flat mix the round opens on, as each
part's share of each register against the mean of the parts:

    short-night        low     mid    high        late-room      low     mid    high
    kit               9.61   -3.35   13.41        kit          10.67   -8.19   15.24
    bass              9.24  -11.61  -20.42        bass          7.26   -2.28  -14.67
    keys             -1.58    6.04   -8.52        keys          2.72   -1.07  -17.73
    pad             -17.27    8.93   15.53        pad          -20.65   11.54   17.16

The kick and the bass are within three and a half decibels of each other in
the low on both pieces — on short-night, within a third of one. At 125 Hz they
read 23.6 and 23.1. Everything the kick does down there the bass is doing too,
so whichever is louder at any instant is the only one anybody hears, and the
answer is the carve that makes room.

**`balance` cannot see it**, and that is why `share.js` exists. By the time
the master is read, 23.6 and 23.1 have been added together and what is left is
a low end — a perfectly reasonable one. `levels.js` cannot see it either: it
reads each part, but broadband, so a bass that is the right loudness and all
of it below 160 Hz reads correct. What is missing is each part's own spread.

**The masker moves, never the part being masked.** The buried part's tone
controls are off and the column says why: the thing to reach for is the
control on whatever is covering the sound you cannot hear, not the control on
the sound you cannot hear. A boost on the buried part puts two things in one
place louder.

**The floor is a measurement that looked like a bug.** Cutting the pad's high
shelf moved the pad's reading in the *low* register, and cutting the keys' low
shelf moved the keys' reading in the *high* — both a register the control does
not touch, and both reading the same number on two different pieces of music,
which is not what a measurement of two different pieces does. Those are
registers where the part has almost nothing (the pad's share of the low is
−17 dB), so what the spectrum reports there is not the part but what leaks in
from the part's own loud bands. Twelve decibels below the average part is
where the comparison stops, which is also the honest line for what the reading
is for: a part that far down is neither masking nor masked, because nobody can
hear it there.

**The tolerance is 0.4 and it is measured.** The reading moves 0.48 dB per
decibel of the bass's low shelf and 0.19 per decibel of the pad's bell, so the
allowance is about four fifths of a decibel on the first carve and two on the
second. `tests/browser/carve.mjs` prints the justification every run: flat
reads 1.82 to 2.97 from the answer and fails, the answer passes, half a
decibel of slip is forgiven, and two decibels off the first carve or three off
the second is not.

**A tier is marked on the readings it has tolerances for.** `carve` has no
`levels` entry at all, because an EQ move changes the part's own loudness and
marking that would be marking the carve twice. The tone tier's way of saying
the same thing was a tolerance written loose enough never to fire, which is a
row in the result nobody can learn anything from.

## Front to back, and the room that says who is in it

Distance has four classic cues — quieter, duller, more reverb, and the
reflections arriving sooner after the direct sound. The fourth is not a
per-part control here: there is one reverb and everything shares it, so its
pre-delay is a property of the room rather than of any part in it, and moving
it moves everybody at once. That is a different question (how big is the room)
from this one (how far back is this part).

The other three are measured, and `DEPTHS` sets them in proportion, because
that is the lesson: far away is quieter AND duller AND wetter, all at once. A
part that is only quiet is a part that is turned down; a part that is only wet
is a part with an effect on it.

**A shared reverb cannot be divided up, so the room is read whole** — and it
turns out to say who is in it anyway. Measured, the return's own spread across
the three registers with one part sent to it at a time:

    what is in it        low     mid    high
    the keys           12.89   14.26  -27.15
    the pad            -8.88   13.73   -4.85
    the bass           28.42    2.12  -30.55

Three completely different rooms, 22.30 dB apart in colour, and mixtures land
in between in proportion. So putting the right amount of reverb on the wrong
part is a thing this reading catches and nothing else does: `width` reads the
same two mixes 9.94 apart and cannot say which part moved.

**Only the pad loses air, and that is a measurement.** Rolling the top off is
a distance cue only where there is top to lose, and as each part's share of
the register above 2.2 kHz the four read kit 13.41, pad 15.53, keys −8.52,
bass −20.42. Two have a top end and one of those is the reference. On the keys
a high shelf is not an air control at all — six decibels off it moves that
part's loudness by 0.50 dB and its share of the top by the same, which is a
fader with extra steps.

**The air had to be pushed to be worth marking.** At −3 and −7 dB a learner
could leave it flat and still pass: seven decibels off the pad's top reads
0.54 where the tolerance has to forgive a step of fader at 0.38. So the back
of the room rolls off twelve, which reads 0.72 and cannot be ignored. Twelve
is also where the slider stops, so there was nowhere further to go — if the
pad had less top end than it has, this tier would have no air cue and would
have to say so.

**`levels` is left out again, and this time because it is a duplicate.** A
fader moves a part broadband, which shifts all three of its registers by the
same amount, so `levels` and `share` read 0.38 and 0.38 for a step and 2.25
and 2.25 for a part at the wrong distance. One mistake, reported twice.
`share` is the one kept, because it also sees the air.
