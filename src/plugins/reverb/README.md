# reverb

    plugin.js   the face
    ir.js       the impulse response, built rather than sampled

Built rather than sampled because every parameter on the face has to move
something in the response, and a sampled tail can only be filtered and faded.
