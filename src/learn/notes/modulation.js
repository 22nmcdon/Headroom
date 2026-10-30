// What a modulation is, for somebody using one.
//
// The long version of what lives at the top of
// src/plugins/modulation/dsp.js: six pedals, one oscillator, three wires.

export const MOD_NOTES = {
  tool: 'modulation',
  title: 'Modulation',
  sections: [
    {
      heading: 'Six effects, three wires',
      body: 'A low-frequency oscillator — something going round once every second or two — '
        + 'pointed at one of three places. At a delay time with the dry signal still there '
        + 'it is a chorus if the delay is long and a flanger if it is short. At the same '
        + 'place with the dry signal gone it is vibrato. At the corner of a chain of '
        + 'all-pass filters it is a phaser. At a gain it is tremolo, and at two gains '
        + 'pulling opposite ways it is an auto-pan.\n\n'
        + 'That is the whole table, and it is worth more than six panels: somebody who '
        + 'knows it can set any of the six from first principles, and can hear what an '
        + 'unfamiliar pedal is doing by asking which of three things is moving. Is the '
        + 'loudness moving? Is the pitch moving? Is the tone moving?',
    },
    {
      heading: 'Why fourteen milliseconds is a chorus and three is a flanger',
      body: 'Two copies of a signal a time t apart cancel wherever t is half a cycle, which '
        + 'is f = (2k+1)/2t, and reinforce halfway between. So the sum has a comb in it '
        + 'whose teeth are 1/t apart.\n\n'
        + 'At fourteen milliseconds the first notch is at 36 Hz and the teeth are 71 Hz '
        + 'apart. That is finer than the ear resolves anywhere but the very bottom, so '
        + 'nobody hears a filter — what they hear is two voices slightly out of tune with '
        + 'each other, which is a chorus. At three milliseconds the first notch is at 167 '
        + 'Hz and the teeth are 333 apart, which is coarse enough to have a pitch of its '
        + 'own, and sweeping that pitch is the whole of the flanger sound. Measured here '
        + 'on a frozen flanger at three milliseconds: notches at 167, 500, 833, 1167 and '
        + '1500 Hz, which is the formula exactly.\n\n'
        + 'Same oscillator, same wiring, one number different.',
    },
    {
      heading: 'A phaser is not a flanger',
      body: 'They are both "a filter sweeping" and they do not sound alike, and the '
        + 'difference is in how many notches there are and where.\n\n'
        + 'A comb has teeth all the way up, evenly spaced in hertz, which is why a flanger '
        + 'has that metallic jet-plane edge — the spacing is a frequency, so the whole '
        + 'thing is tuned. A phaser has as many notches as it has pairs of all-pass '
        + 'stages, and they are spread out across the spectrum rather than evenly spaced. '
        + 'Measured here with six stages and the corner at 670 Hz: notches at 180, 669 and '
        + '2480 Hz. Three holes, far apart, moving — which reads as a filter sweeping and '
        + 'not as a tuned resonance.\n\n'
        + 'This is also why a phaser survives on a whole mix where a flanger usually does '
        + 'not: three notches take out less than forty do.',
    },
    {
      heading: 'Feedback is the character, and it is not the depth',
      body: 'On a flanger and a phaser there is a path from the output back into the input, '
        + 'and what it does is sharpen what is already there rather than make more of it. '
        + 'Which way round it is wired decides what gets sharpened.\n\n'
        + 'Measured on a flanger at three milliseconds, where the comb has a notch at 167 '
        + 'Hz and a peak at 333:\n\n'
        + '    feedback     167 Hz     333 Hz\n'
        + '      -0.8        +5.7       -2.2\n'
        + '       0.0       -44.7       -0.0\n'
        + '      +0.8       -13.0       +9.1\n\n'
        + 'Positive feedback drives the peaks up — nine decibels where it was already '
        + 'adding — and that is the whistle. Negative feedback moves the comb: the teeth '
        + 'land where the peaks were, so what was a hole at 167 comes out five decibels up, '
        + 'and that is the hollow sound. Neither of them is a depth control, and turning '
        + 'the feedback up because the effect is too subtle is the commonest mistake on '
        + 'either device.',
    },
    {
      heading: 'Rate is a tempo question; depth is a taste question',
      body: 'Almost every modulation sounds better in time with the music, and the reason '
        + 'is that it stops being an effect and starts being part of the arrangement. One '
        + 'cycle per note is the convention: on this loop at 96, quarters are 1.6 Hz, '
        + 'eighths are 3.2 and sixteenths are 6.4.\n\n'
        + 'That is why the drill asks for the rate as a note value rather than in hertz, '
        + 'and why it is the same list of five the delay\'s division drill uses. Count the '
        + 'beat, then count how many times the modulation moves inside one. Nobody can '
        + 'name a speed in the abstract.\n\n'
        + 'The depth has no such answer. A quarter of the travel is usually plenty, half '
        + 'is a lot, and everybody who has just bought a chorus sets it to three quarters '
        + 'and wonders why the mix sounds seasick. The one rule worth having: if you can '
        + 'hear the effect while you are listening to the song, it is too deep.',
    },
    {
      heading: 'Where the sides are, and what happens in mono',
      body: 'Two channels can run the same oscillator at different points of its cycle, '
        + 'and that is where a stereo chorus comes from: the left is sharp while the right '
        + 'is flat, so the two disagree and the image widens. A quarter turn apart is the '
        + 'usual setting and opposite is the extreme.\n\n'
        + 'Which is worth knowing because of what folds down. An auto-pan is two gains '
        + 'exactly opposite, so summing the two sides puts it back where it started — in '
        + 'mono an auto-pan does not exist. A stereo chorus does not vanish in mono, but '
        + 'it does change: the two combs sum, and what was width becomes a different '
        + 'colour. If a mix has to work in mono, that is a thing to check rather than '
        + 'assume.',
    },
  ],
};
