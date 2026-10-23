// What an equaliser is, for somebody using one.
//
// The long version of what lives at the top of src/plugins/eq/filters.js and
// src/plugins/eq/spectrum.js. The code keeps the decisions; this keeps the subject.

export const EQ_NOTES = {
  tool: 'eq',
  title: 'Equalisation',
  sections: [
    {
      heading: 'A band is a filter, and the picture is the filter',
      body: 'Every band here is a biquad — the same second-order filter Web Audio '
        + 'builds, with the same coefficients out of the same cookbook. That matters '
        + 'more than it sounds like it should. The curve drawn on the display is not an '
        + 'illustration of roughly what the EQ is doing; it is computed from the '
        + 'coefficients the audio is actually running, and checked against the '
        + "browser's own answer to within a hundredth of a decibel.\n\n"
        + 'A drawing that drifts from the sound is worse than no drawing at all, '
        + 'because you learn to trust it and then it lies to you once.',
    },
    {
      heading: 'The handle sits on the curve because every band contributes something known',
      body: 'Drag a handle up and down and it sets whatever that band contributes at its '
        + 'own corner frequency. For a peak that is its gain, exactly. For a shelf it is '
        + 'half its gain, because a shelf is halfway up at its corner. For a high-pass or '
        + 'low-pass it is its resonance.\n\n'
        + 'So the same gesture means the same thing on all five kinds, and the handle is '
        + 'never floating beside the line it belongs to.',
    },
    {
      heading: 'Why there is no 6 dB per octave',
      body: 'A 6 dB/oct filter is first order, and every filter the browser will build is '
        + 'second — there is no one-pole biquad. It could be had from a filter you hand '
        + 'raw coefficients to, but those are fixed when the node is made, so moving the '
        + 'corner would mean building a new one under a dragging finger sixty times a '
        + 'second, each starting from no state. That is a click per frame.\n\n'
        + 'The three slopes here — 12, 24 and 48 — are the ones a desk actually gives '
        + 'you, and they are exact. A cascade of Butterworth sections has the useful '
        + 'property that its section resonances multiply to the same number at every even '
        + 'order, so a cut is 3 dB down at its corner whether it is gentle or brutal.',
    },
    {
      heading: 'Why turning a band up makes everything louder, and what to do about it',
      body: 'Louder sounds better for about two seconds, which is long enough to pick the '
        + 'wrong EQ. Auto gain takes the loudness change back out so you are judging the '
        + 'shape and not the level.\n\n'
        + 'Doing that honestly needs to know where the material keeps its energy: a low '
        + 'shelf on a bass-heavy loop is a large move and the same shelf on a hi-hat is '
        + 'nearly nothing. Assuming energy is spread evenly across the octaves — the easy '
        + 'thing to do, and what this did first — was out by as much as five decibels on '
        + 'the material this app plays.',
    },
  ],
};
