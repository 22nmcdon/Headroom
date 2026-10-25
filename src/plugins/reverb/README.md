# reverb

    plugin.js   the face
    ir.js       the impulse response, built rather than sampled

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

Everything here is still one impulse response per setting, convolved,
measured, displayed and marked. That is what rules out shimmer and freeze: a
pitch shifter inside a feedback loop and a loop gain of one are not linear
time-invariant, so neither has an impulse response to be the truth.
