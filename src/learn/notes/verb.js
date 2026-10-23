// What a reverb is, for somebody using one.
//
// The long version of what lives at the top of src/plugins/reverb/ir.js and
// src/lib/response.js.

export const VERB_NOTES = {
  tool: 'reverb',
  title: 'Reverb',
  sections: [
    {
      heading: 'A room is an impulse response',
      body: 'Clap once in a room and what comes back — the gap before the first wall '
        + 'answers, the early reflections arriving one at a time, the wash closing over '
        + 'them — is a complete description of that room. Anything else played in it will '
        + 'sound like itself smeared through that same answer.\n\n'
        + 'This reverb works that way round: the settings build an impulse response and '
        + 'the loop is convolved with it. That is more work than an algorithmic reverb and '
        + 'it buys one thing — the picture on the display is not a drawing of what the '
        + 'reverb is doing, it is the reverb. The same array is convolved, measured, drawn '
        + 'and marked, so there is nothing for the four of them to disagree about.',
    },
    {
      heading: 'Pre-delay is the control people miss',
      body: 'Decay is easy to hear. Pre-delay is the gap between the sound and the room '
        + 'answering, and it is what keeps a source in front of its own reverb instead of '
        + 'inside it. A vocal with twenty milliseconds of pre-delay sits forward of a big '
        + 'hall; the same hall with none swallows it.\n\n'
        + 'People hear decay immediately and pre-delay hardly at all, which is exactly why '
        + 'it is worth putting on a display.',
    },
    {
      heading: 'Stone or curtains is a question about the top end',
      body: 'How much shorter the highs ring than the lows is most of what makes a room '
        + 'sound like tile or like a soft furnished space. Damping is that control.\n\n'
        + 'Measuring it honestly needs a crossover that sums flat. A gentle first-order '
        + 'split leaves a fifth of the slow band sitting up in the fast band’s range, so '
        + 'once the fast part has died the leakage takes over: a room set to decay five '
        + 'times faster up top measured only one and a half times faster. A Linkwitz-Riley '
        + 'crossover — the kind a loudspeaker uses — puts the bands thirty decibels apart '
        + 'where the reading is taken.',
    },
    {
      heading: 'How a decay time is measured',
      body: 'Not by watching the tail and guessing. The response is integrated backwards '
        + 'from its end, which turns a noisy decay into a smooth curve, and the time is '
        + 'fitted over the part of that curve between five and twenty-five decibels down — '
        + 'then extrapolated to sixty. That is how an acoustician measures a hall, and it '
        + 'is why the number here is a real number rather than whatever a feedback '
        + 'coefficient happened to produce.',
    },
  ],
};
