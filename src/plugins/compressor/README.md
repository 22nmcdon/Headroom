# compressor

    plugin.js    the face, including the side chain
    dsp.js       the compressor itself: detector, curve, lookahead, auto gain
    reading.js   what it did to a loop, and comparing two of those
    node.js      the AudioWorklet, with a ScriptProcessor fallback
    player.js    auditioning it

Web Audio has a compressor node and this does not use it: that node cannot be
fed a sidechain, has no RMS detector and no lookahead, and applies a makeup
gain that lives in the implementation rather than in the arithmetic.

`dsp.js` used to hold the biquad helpers too, which is how thirteen modules
came to import the compressor. They are in `lib/dsp.js` now.
