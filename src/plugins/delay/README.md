# delay

    plugin.js   the face
    line.js     the delay line, the feedback path, and the decay reading

The folder is Delay and the symbols are `ECHO_`, deliberately. A delay is the
device; an echo is what you hear when the delay is long enough to register as
a separate sound rather than as thickening. `line.js` has said so since it was
written: "What a delay is, for somebody using one, is in notes/echo.js".

Times are written in beats, off `lib/tempo.js` rather than off the engine - a
plugin that has to import the engine to name a beat cannot be lifted out.
