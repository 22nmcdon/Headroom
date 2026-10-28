# delay

    plugin.js   the face
    dsp.js      the loop itself: one sample in, one sample out
    node.js     that loop on the audio thread, and the fallback behind it
    line.js     the response, where the repeats land, and three readings

The folder is Delay and the symbols are `ECHO_`, deliberately. A delay is the
device; an echo is what you hear when the delay is long enough to register as
a separate sound rather than as thickening. `line.js` has said so since it was
written: "What a delay is, for somebody using one, is in notes/echo.js".

The loop is in `dsp.js` and `line.js` runs it offline over one click to get
the response that is drawn and marked. They were one file, because a delay
written down as a response is a delay: it is linear, so everything it will
ever do to anything is in what it does to one click, and a `ConvolverNode`
over that is the whole device. Wow and flutter end that - convolution puts one
answer under every input sample, and a line whose length wanders needs a new
one each time - so the loop had to become something that could be run while
the audio goes past.

Three readings, and each is deliberately deaf to the other two's subject. The
decay curve says how the repeats fade and is blind to where in the loop they
land. The loop shape says where they land and is blind to how long the loop
is - and is taken with the transport held still, because a frame has edges and
three samples of flutter read seven decibels through it. The wander says how
badly the transport holds time and is blind to everything else, measured to
exactly zero for the time, the feedback, the tone, the heads, the diffusion,
the medium, the routing and the mix.

Three readings and one thing with no reading at all. What a delay does to the
sound already in its line when the time moves - repitch, fade or jump - is
audible only while the knob is moving, and every reading here is taken of a
delay standing still. So it is a control and not a question, and there is a
test asserting that it cannot change a response, because if it ever could then
every mark in the delay would depend on something nobody is being asked about.

The feedback goes past unity, where a delay stops being a delay and becomes an
oscillator. What stops it is `LOOP_CEILING` - the medium running out of
headroom - and that is also the one thing in here that makes the delay depend
on how loud the signal is, so the note above about a response being everything
has a caveat on it now. Measured in the sketchpad: four tape delays howling on
four tracks come out of the master at exactly -1.00 dB, which is the limiter's
ceiling, with nothing non-finite anywhere.

Times are written in beats, off `lib/tempo.js` rather than off the engine - a
plugin that has to import the engine to name a beat cannot be lifted out.
