# mix

The mix exercise: a piece, a brief, and a score for how close the balance is.

    brief.js      what a round asks for: the tiers, the target, the grid
    piece.js      the four stems and the pieces they play
    render.js     the project as audio, and the six readings taken off it
    score.js      the tolerances, the marking, and the advice
    placement.js  where each part sits, which a width reading is blind to
    levels.js     how loud each part is, which the master cannot say
    monitor.js    hearing the two at the same loudness, which is a monitor
                  control and is nowhere near the marking
    page.js       the strips, the transport and the result

Marked on readings rather than on fader positions, the same way every other
mode here marks on what came out rather than on what was set.

## Five readings of the master, and one of the parts

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
