# saturation

    plugin.js   the face
    shape.js    the curve, the oversampling, and the harmonic reading
    node.js     the AudioWorklet, built by stringifying shape.js
    player.js   auditioning it

The probe, the series and the comparator are no longer here. They moved to
`lib/harmonics.js` when the limiter grew a clipper, because a plugin may not
import another plugin and the alternative was a second probe measuring the
same thing a second way. What is left is the part that is the saturator's:
the curve, the oversampled round trip, and the core being probed.

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
- The crusher runs **after** the round trip, at the signal's own rate, because
  the aliasing is the subject and the decimation filter would take it away.
  That also puts a floor under what you can measure through the whole shaper:
  sixteen bits and twelve bits both read 45.7 dB of signal to noise end to
  end, because what that figure is measuring is the filters either side of the
  curve and not the ladder at all. The saturator is entitled to that floor -
  the harmonics it exists to make are forty decibels louder - but it is why
  the head readout measures `crushTo` on a sine by itself, where sixteen bits
  reads 98 and twelve reads 74.
