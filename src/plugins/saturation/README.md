# saturation

    plugin.js   the face
    shape.js    the curve, the oversampling, and the harmonic reading
    node.js     the AudioWorklet, built by stringifying shape.js
    player.js   auditioning it

The folder is Saturation and the symbols are `HEAT_`, which is not an
oversight. Saturation is the device; heat is what it makes - the face has a
button that says "only the heat". The device is named by the folder, what it
produces is named by the code.

Worth knowing before changing anything in `shape.js`:

- The curve runs at **eight times the rate**. Measured: a hi-hat whose folded
  energy came back 10 dB under the signal comes back 48 dB under instead.
- The output is **uncoupled at 5 Hz**. Subtracting `shape(bias)` removes what
  the curve does to silence, not what it does to a signal, and the offset left
  behind grows with the drive - 9.6 dB under the peak at the far corner.
- The probe runs the core with that filter **bypassed**, which is not dodging
  it: settled, it is 0.0006 dB at 440 Hz, but unsettled it leaks across every
  bin and buries the aliasing reading. Both halves have a test.
