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
    chain.js      what is on a part and in what order, which is named rather
                  than matched
    desk.js       what the controls move in and how far, which is true of the
                  desk whether or not anybody is being asked anything
    faults.js     what somebody did to this mix before you got to it
    ride.js       a fader that moves while the music is playing
    monitor.js    the monitor path: matching the two loudnesses, folding to
                  mono, and a small speaker - none of it near the marking
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

## What is on it: the round that is answered by naming it

A chain is in series, so its order is audible — and that is not a figure of
speech. A compressor and a saturator do not commute, because both are
nonlinear: the compressor decides what to do from how loud the signal is, and
the saturator changes how loud it is. Put the saturator first and the
compressor is reacting to peaks that have already been rounded off, so it
hardly works; put it second and it is colouring whatever the compressor has
already levelled, so the quiet hits get as much colour as the loud ones.

Measured on the kit, four arrangements of the same two effects, level-matched
to the plain part, each pair against each other:

    pair                            crest            balance
    compressor / saturator          12.45 and 8.18   9.53 and 9.53
    compressor / comp then sat       7.85 and 4.03  10.08 and 12.69
    compressor / sat then comp       6.74 and 3.46   6.84 and 11.57
    saturator / comp then sat        4.59 and 4.16   6.49 and 6.20
    saturator / sat then comp        5.71 and 4.73   6.16 and 5.78
    comp then sat / sat then comp    1.12 and 0.57   4.14 and 4.63

**But it cannot be asked by matching.** There are four answers, so a round you
could submit against is a round you could finish by pressing submit four
times — and a round somebody can brute-force in four goes teaches how to press
a button. So this one is asked the way the drills ask: hear it, name it, once.
The desk is not shown, because nothing on it would help. The near side of the
A/B is the same mix with nothing on that part, which is the comparison that
answers the question.

**The levels are baked in, and that is the whole reason it is fair.**
Saturation makes things louder and compression makes them quieter, so with
both plugins left at their defaults the four arrangements came out 19.6 dB
apart — a round where the loudest answer is the one with the saturator in it
is a round answered by loudness. Each arrangement is gain-staged instead, the
way an engineer gain-stages a chain, with the compressor's makeup and the
saturator's trim measured per arrangement. That brings the spread to 1.44 dB
and 1.42 on the two pieces, and `tests/browser/arrange.mjs` re-measures it every
run.

## What was measured and not built: parallel compression

The other half of this module was a parallel-compression round — a heavily
compressed copy of a part blended under it, with the blend as the answer. It
is not here, and the reason is a measurement. Blending in a compressed copy
reads, against the same mix at blend nought:

    blend    loudness   crest   levels   share
     0.20        0.64    0.55     1.11    1.18
     0.40        1.26    0.99     2.42    2.61
     0.60        1.80    1.36     4.01    4.40
     0.80        2.22    1.59     5.96    6.76
     1.00        2.50    1.63     8.20    9.82

Which looks markable until you read what is moving. The dominant effect is
that the part gets quieter — `levels` and `share` are doing all the work, and
both of those are just the fader. `crest`, the reading that ought to say what
parallel compression is for, moves 1.63 dB over the whole range on one piece
and on the other goes 0.19, 0.31, 0.29, 0.07, 0.05: up, then down. Not
monotonic, which is the same thing the tone tier found when it tried to mark a
compressor insert by its threshold.

So a parallel round would be marked on the part's level while claiming to be
about dynamics, and would be solvable with the fader. Left out, with the
numbers, rather than built on a reading that cannot see it.

## Listening somewhere else

A mix that only works on the thing it was made on is not finished, and the
two places it most often falls apart are a mono speaker and a small one. Both
are monitor paths, in the same place as the loudness trim and for the same
reason: what gets rendered and marked is the same audio whichever is on, and
`tests/browser/listen.mjs` renders the same mix twice to hold that — the four
readings come back 6.15e-9, 2.82e-7, 0 and 3.70e-9 apart, which is the
renderer's own floor.

**Mono** is a gain told to take one channel, which is how the specification
spells "down-mix": (L+R)/2. Measured, two channels that are each other's
opposite come back 194 dB down, and on full range they come back untouched.

**Small speaker** is two poles at 400 Hz and two at 8 kHz, which is a
caricature rather than a model of any particular handset — and the shape is
measured, not claimed:

    60 Hz    -33.0      800 Hz    -0.3     8 kHz    -3.0
    100 Hz   -24.1        2 kHz   -0.0    12 kHz   -10.0
    200 Hz   -12.3        6 kHz   -1.0    16 kHz   -19.1
    400 Hz    -3.0

Three decibels down at both corners and twelve an octave below the lower one,
which is what two poles is. It is also mono, because a phone speaker is.

**The Q cost two attempts and is worth writing down.** A `BiquadFilterNode`'s
Q is a plain quality factor for a bandpass or a notch and a figure *in
decibels* for a lowpass or a highpass: it is how far up the corner sits. Left
at its default of 1 the corner read +1.0 dB against the passband; set to
0.7071 — the Butterworth Q, in the units the other kind of filter uses — it
read +0.7, which is 0.7071 dB and is the giveaway. At −3.01 it reads −3.0.

What this is for is a question about the material, and that is measured too:
on the flat mix of short-night the kit and the bass have all their weight
below 310 Hz, with shares of 9.61 and 9.24 against the pad's −17.27. A mix
balanced on its low end is a mix that loses both its anchors on a small
speaker, and that is the thing to go and hear.

## Fix the mix

Every other round starts from flat and asks you to build something. This one
starts from a mix that was right and has had one to three things done to it,
and asks two questions in order: what is wrong, and then put it back. Which is
the job rather than an exercise about the job — nobody is handed four flat
faders and told to make a record; they are handed something that nearly works
and asked why it does not.

**The mix underneath is not flat**, because a round whose answer is flat is a
round you win by zeroing everything. It is a whole mix — levels, places,
room — and the only way to the answer is the A/B.

**One fault per control, and never two of a kind.** Two of one kind could not
both be named, because the chips are kinds; two on one part would hide each
other, which is a fair thing for a mix to do and an unfair thing for a round
that asks you to name them. Measured, each fault on its own against the mix it
was done to:

    fault     on      hurts        loud  balance  place  width  crest  share  room
    too loud  bass    share        0.29     2.96   0.13   2.23   0.46   3.00  0.58
    off       keys    placement    0.00     0.62   1.26   5.11   0.00   0.63  0.00
    too wet   keys    room         0.23     1.36   0.12   3.02   0.22   0.00  6.74
    colour    bass    share        0.14     2.44   0.04   1.65   0.25   1.99  0.41

Every one of them is outside the tolerance of the reading it claims — 0.5 on
share, 0.6 on placement, 2.0 on room — and `tests/browser/fix.mjs` holds that
every run, along with the two ends of a round: the mix as it was left fails on
room at 18.22 and the mix put back passes at 0.00.

**The pan fault is only put on a part with the whole field to move in**, and
that was a measurement rather than a nicety. The bass gets a quarter of the
field, so the same fault on it is a pan move of 0.09 to 0.15 and reads 0.41
against a tolerance of 0.6: a fault nobody can mark, and one nobody can hear
is worse.

**How many are wrong is not said.** A round that always had the same number
would be a round you could count rather than hear — find two and stop
looking — and the number being unknown is half of what makes the naming a
question. Three is the ceiling because with four kinds in the library, four
faults has one answer.

**Being wrong about what is wrong does not stop you fixing it.** One guess at
the naming, then the round carries on and the fix is marked separately, which
is also the honest order: plenty of engineers fix things they could not have
named. What the record files the round under is the fault that was missed
rather than the reading that was worst — "the one that catches you out: too
much room" is worth knowing, where "how wide" is the same sentence about a
symptom.

## What moves: a fader that does not stay put

Everything else here is a mix — four settings that are true for the whole four
bars. A ride is the other half of mixing, and until now nothing could ask for
it, because a project's gain is one number.

**It is a swell and not a lift in one bar**, and that is a fact about the
material. A three decibel lift of one part in bar three moves the master's own
bar-by-bar shape by 0.53 dB on one piece and 0.42 on the other — while the
flat mix's shape already wanders by −0.73 to +0.42 between its own bars,
because it is music. Four bars of one riff has no sections for a lift to be
the chorus of. A swell has somewhere to go.

**It is read on the parts, not on the master.** Six decibels of swell against
seven is 0.07 dB of difference on the master's bar shape, so a tolerance that
forgave a decibel of depth would be about a fifteenth of one — a tenth of
anything else in `score.js`, and a number any future change to the material
would move by more than its own width. On the part itself, six decibels of
swell is six decibels of swell. Measured, a swell on the keys, read bar by
bar on the keys' own tap:

    swell   bar 1   bar 2   bar 3   bar 4    the other three parts
        4   -1.48   -0.50    0.49    1.49                    0.000
        6   -2.21   -0.76    0.73    2.24                    0.000
        9   -3.32   -1.14    1.10    3.36                    0.000
       -6    2.22    0.75   -0.74   -2.24                    0.000

Against the arithmetic's −2.25, −0.75, 0.75, 2.25 for a six, and nothing at
all on any part that is not riding. The same swell reads 0.39 dB on the
master.

**Half up and half down**, so a swell is not also a fader: its average over
the loop is nought, which keeps it out of `levels` and leaves `ride` the only
reading that sees it. And the two parts in a round swell opposite ways,
because two parts swelling together is the whole mix getting louder, which is
a fader again.

**A ride is handed to the stage, not set on the project.** A track's shape is
a whitelist in `sketch/project.js`, so putting automation on it would have
meant the save format, everything that validates a project, and the
sketchpad's own panels — for something only this exercise asks for. As an
option, nothing else changes and a stage with no rides behaves exactly as it
did. It is booked in the same scheduling window the notes are, which is why it
survives a clock driven by hand in an offline render.

It is a staircase rather than a ramp — sixteen steps a bar, a tenth of a
decibel at a time on a level that is already moving — because a real ramp
would have meant a new method on `core/track.js`, the file every instrument in
the app goes through.
