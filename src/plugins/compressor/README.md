# compressor

    plugin.js    the face, including the side chain
    aimed.js     the gate's face and the de-esser's, which are the same face
    dsp.js       the core: detector, curve both ways up, lookahead, auto gain
    reading.js   what it did to a loop, and comparing two of those
    node.js      the AudioWorklet, with a ScriptProcessor fallback
    player.js    auditioning it

Three tools out of one core. A compressor turns the gain down when the signal
gets loud; a gate turns it down when the signal gets quiet, which is the same
curve mirrored about the threshold and the same ballistics mirrored with it; a
de-esser is a compressor whose detector and whose gain are pointed at a band
rather than at the record. So `dsp.js` holds one `compressorCore` with
`shape`, `hold`, `hysteresis`, `split` and `crossover` on it, and `aimed.js`
is one face that the gate and the de-esser each hand a knob list and a
default.

What that bought, measured: the gate needed about forty lines of arithmetic
on top of what was already there, and the three share one reading, one
worklet and one player. What it cost is that a change to the core now has
three tools to be right for, which is what `tests/comp.test.js` is long for.

Web Audio has a compressor node and this does not use it: that node cannot be
fed a sidechain, has no RMS detector and no lookahead, and applies a makeup
gain that lives in the implementation rather than in the arithmetic.

`dsp.js` used to hold the biquad helpers too, which is how thirteen modules
came to import the compressor. They are in `lib/dsp.js` now.
