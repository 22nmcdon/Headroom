# reverb

    plugin.js   the face
    ir.js       the impulse response, built rather than sampled
    shimmer.js  the pitch shifter, which is the one part that is not a response
    node.js     that shifter on the audio thread, and the fallback behind it

Built rather than sampled because every parameter on the face has to move
something in the response, and a sampled tail can only be filtered and faded.

## Spaces

A space is not a preset. Each one says what it is made of and what it answers
to, and the deck is rebuilt when it changes - the way the saturator's curve
families work. A room has walls, so it has a size in metres and a level for
the reflections off them; a plate has neither, because a plate is a sheet of
steel with no far wall to come back off. Handing a plate a Size knob that
quietly did nothing would be a preset wearing a plugin's controls.

    room     walls at a distance, then a wash that closes over them
    plate    no walls, no build-up, and the highs arriving first
    gated    the same room, not decaying, then cut
    reverse  the same room, backwards
    spring   a chirp going round a wire, which is nothing like the others

Gated and reverse are the room's own generator with something done to the
envelope afterwards, which is why neither needed a second one. A gate is
three decay times of Infinity and a raised-cosine cut, so its decay knob says
how long it holds rather than how long it rings and the band multiples are
not on its deck - nothing decays for them to be multiples of. Reverse turns
the samples after the pre-delay around; everything the room does happens in
reverse order, and it ends with the room's own build-up played backwards,
which is a fade rather than the click a rising envelope would leave.

Neither can be read as a decay time, so neither is asked for one. The
headline measures what each space actually does - a gate holds and shuts, a
reverse swells - off the response, the same as everything else here.

The spring is the one that could not share any of it. A reverb tank is a
helical spring with a transducer at each end, and a torsional wave along a
wire is dispersive, hard: every traverse arrives as a chirp sweeping
downwards, then reflects and does it again. That is a feedback loop with a
stretched-allpass chain in it, not an envelope on noise. Measured over a fixed window, the gap between its loud tenth and its quiet
tenth is 9.6 dB where a room's is 5.5 - which is the difference between a
train of bounces and a wash.

Its decay knob is a request rather than a promise, and the reading on the
face is the measurement. A spring has no single decay time to hold it to: a
stretched allpass delays one frequency eighty times as long as another, so
the loop goes round at a different rate everywhere in the band. The knob is
reckoned at 500 Hz, which `QUOTED_AT` in ir.js shows is both the closest over
twenty-four settings and the right kind of wrong - a spring asked for two
seconds is never found ringing for three and a half.

Three of the four things that make a plate a plate are things it does not
have: no early reflections, no build-up, no size. The fourth is the only one
that is new arithmetic - a cascade of first-order allpasses, which holds the
bottom of a transient back further than the top, because that is what a
bending wave in steel does. `disperse` in ir.js has the measurements.

## Decay, per band

Three bands, and the decay knob names the middle one - which is the number
anybody means by "a one-point-eight second hall". The other two are multiples
of it: LF decay for the bass, HF decay for the top. A hall rings longer in
the bass than the mids, which this could not produce at all when there were
two bands and damping could only ever shorten the treble.

The crossovers are at 400 and 1500 Hz, and the asymmetry is measured rather
than chosen. A band has to be well clear of the skirt of the one below it by
the time the reading that measures it begins: the low reading is 60-400 and
ends where its crossover is, so 400 puts the whole of it inside the band the
knob moves; the high reading starts at 3000, so a crossover there sits in the
middle of the reading and the mid band's skirt takes the measurement over -
the damping knob went down and then back up. An octave early, at 1500, the
mid band is 24 dB down by 3000. `BAND_EDGES` in ir.js has the sweep.

## The shimmer, which is not a response

Everything above is one impulse response per setting, convolved, measured,
displayed and marked, and all five spaces still are. The shimmer is not: it is
the room's own output sent back into the room through a pitch shifter, and a
thing whose output depends on what it has already produced has no response to
be the truth of it. So it is a control and not a question - measured, the
reading that marks a reverb reads exactly 0.0000 dB for every shimmer setting,
where a decay moved three tenths of a second reads 1.63. Same category as the
delay's time-change modes.

With the knob down the node is not built and the graph is the graph it has
always been. All fifty-five responses are bit-identical with it in the file.

**A bare gain in a loop around a convolver does not work, and the measurement
is worth keeping because it is the first thing anybody tries.** These responses
are energy-normalised to -3.01 dB apiece, which looks like it should make a
loop gain of one marginally stable. Energy says nothing about it. What decides
whether a feedback loop runs away is the worst single frequency in the
response, and a noise-like tail of a hundred thousand taps is nowhere near
flat: the peak of |H| runs from 1.6 to 4.8 depending on the space and the
decay, so the gain that is safe is somewhere between 0.21 and 0.64 and depends
on knobs. Below that it does not do the job either - at a gain of 0.5 a chord
came back as the room's own worst frequency and nothing else, with the energy
at the chord's partials falling from -4.6 dB to -64 over six seconds. A gain in
a loop around a reverb is a resonator, not a reverb.

**The shift is what makes it safe.** Energy that comes back at a different
frequency cannot resonate with the frequency it left, and it climbs out of the
band instead. The control case says it plainly: a shifter set to leave the
pitch alone takes the same loop to +254 dB in ten seconds, where every real
interval stays bounded. Measured as the peak per four-second block over twenty
seconds, the loop is stable at a gain of 1.2 and away at 1.5, so the knob stops
at one with three and a half decibels in hand.

**It climbs, which is the thing it is named for.** The centroid of each second
of the tail, at a shimmer of 0.9, octave up: 346, 577, 1099, 1179 Hz. A fifth
up: 278, 460, 933, 1180. Turn it down and it climbs less far and ends sooner.

The shifter is a crossfaded delay line and crude - between two and twenty per
cent of its output lands within a semitone of the pitch asked for, and it
breathes four to six decibels on a bare tone. `SHIMMER_WINDOW` has those
numbers and the two measurement mistakes they cost: a single-tone probe of the
window length measures a coincidence rather than the window, and growing the
window with the interval to match the lap rate makes four of six intervals
worse. What rescues it is that its output is only ever heard through the room,
which smears it - the shimmer tail ripples 1.9 to 2.5 dB around its own slope.

The loop is high-passed at 120 Hz, because without one it silts up at the
bottom: a downward interval walks towards DC and an upward one leaves the
shifter's own low spray behind to accumulate. Octave up collapsed from 1241 Hz
to 47 and then 35; octave down reached 7 Hz by the third second. See
`SHIMMER_FLOOR`.

Gated and reverse do not get one. Both are the room with something done to
its envelope afterwards, and what is done is that it stops - a feedback path
is a thing that keeps going, so handing either of them one would hand it a
control that fights the only thing that makes it what it is. It is not that it
cannot be done; a gated reverb with an endless tail is a gated reverb with the
gate taken off.

Freeze is still not built.
