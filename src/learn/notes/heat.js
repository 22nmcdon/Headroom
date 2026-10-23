// What saturation is, for somebody using it.
//
// The long version of what lives at the top of src/plugins/saturation/shape.js.

export const HEAT_NOTES = {
  tool: 'saturation',
  title: 'Saturation',
  sections: [
    {
      heading: 'It is the only one that makes something new',
      body: 'Every other tool here moves energy that was already there. An EQ turns a band '
        + 'up, a compressor turns a moment down, a reverb and a delay put copies of it '
        + 'somewhere else, an imager moves it across the room.\n\n'
        + 'A nonlinearity makes energy at frequencies that were never in the recording. '
        + 'Feed it 220 Hz and out come 440, 660, 880 and so on, and the recipe of that '
        + 'series is what people are hearing when they say warm, or edgy, or crunchy, or '
        + 'broken. That series is the entire subject.',
    },
    {
      heading: 'Even against odd is the whole ear skill',
      body: 'A curve that treats up and down alike can only make odd harmonics — the third, '
        + 'the fifth, the seventh. Those are fifths and their neighbours, and they sound '
        + 'like something going wrong.\n\n'
        + 'Tilt the curve so one half squashes before the other and the even harmonics '
        + 'appear — the second, the fourth. Those are octaves and their neighbours, and '
        + 'they sound like the note getting bigger. Even is warm; odd is dirty. That single '
        + 'fact is most of what an ear needs here, and it is why the bars are coloured '
        + 'rather than labelled.',
    },
    {
      heading: 'Drive decides how much, not which',
      body: 'Past a certain point everything sounds the same kind of broken: hit anything '
        + 'hard enough and it becomes a square wave, and a square wave is all odd. Warmth '
        + 'lives at the quiet end of the drive with the bias doing the work.\n\n'
        + 'Hardness decides when the colour arrives rather than how much of it there is. '
        + 'Measured: at a moderate drive a soft curve is already making a third harmonic '
        + 'while a hard one is still doing nothing at all — and at a high drive it is the '
        + 'other way round. A soft curve is always a little coloured; a hard one is clean '
        + "until it isn't, and then it is everything at once.",
    },
    {
      heading: 'Why it runs eight times faster than the signal',
      body: 'A nonlinearity makes harmonics without limit, and every one above half the '
        + 'sample rate folds back down to a frequency that is not a harmonic of anything. '
        + 'Inharmonic is the one thing real saturation never sounds like.\n\n'
        + 'Measured at the ordinary rate, a 220 Hz note is fine — the folded energy comes '
        + 'back 61 dB down. A hi-hat is not: at a high drive the junk lands 10 dB under the '
        + 'signal. A tool built on that would be teaching you to recognise a sound no piece '
        + 'of gear makes. So the curve runs at eight times the rate with a linear-phase '
        + 'filter either side of it, and the same hi-hat comes back 48 dB down.',
    },
  ],
};
