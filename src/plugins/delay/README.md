# delay

    plugin.js   the face
    dsp.js      the loop itself: one sample in, one sample out
    line.js     the response, where the repeats land, and the readings

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

Times are written in beats, off `lib/tempo.js` rather than off the engine - a
plugin that has to import the engine to name a beat cannot be lifted out.
