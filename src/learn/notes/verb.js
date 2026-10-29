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
      heading: 'Shimmer: the room going back round through itself',
      body: 'Send a room\u2019s output back into the room and you get a longer room. Send it '
        + 'back through a pitch shifter and you get something that climbs: every pass is a '
        + 'little higher than the one before, so the tail does not just last, it rises. '
        + 'That is the sound, and it is older than the gear \u2014 it was two tape machines '
        + 'and a reverb plate before anybody built a box for it.\n\n'
        + 'The pitch shift is not decoration, it is the only reason the thing is safe. A '
        + 'plain gain in a loop around a reverb does not make a longer reverb; it makes a '
        + 'resonator. A room\u2019s response is not flat, so some one frequency in it is '
        + 'loudest, and that is the frequency a feedback loop finds and holds. Measured '
        + 'here, a chord sent round at half gain came back as the room\u2019s own worst '
        + 'note and nothing else within six seconds. Shifting the pitch means the energy '
        + 'never returns to the frequency it left, so there is nothing for it to build on '
        + '\u2014 it climbs out of hearing instead.\n\n'
        + 'Which is why the interval can be set and cannot be set to \u201cnone\u201d. '
        + 'Everything else on this face is in the picture of the response; this one is not, '
        + 'because a thing that depends on what it has already produced has no single '
        + 'response to draw. The gate and the reverse do not have it at all: their whole '
        + 'point is that they stop.',
    },
    {
      heading: 'Freeze: holding what was there',
      body: 'A reverb that never ends sounds like a good idea and is harder than it '
        + 'looks. The obvious way - turn the feedback up to one - does not give you a '
        + 'room that goes on forever, it gives you a resonator: a room\u2019s response '
        + 'has a loudest frequency, and a loop at unity finds it and rings on it until '
        + 'that is all there is left. Measured here, six seconds was enough to turn a '
        + 'chord into one note.\n\n'
        + 'So this does not loop the reverb, it loops the sound. The last second of what '
        + 'the room produced is kept and played round, which holds exactly what was '
        + 'there rather than a filtered version of it. It is a sampler wearing a reverb '
        + 'control, and the thing that makes it work is what it is sampling: a reverb '
        + 'tail is noise, and noise is the one material a short loop can repeat without '
        + 'anybody hearing the repeat.\n\n'
        + 'Which is why you press it while something is sounding rather than after. '
        + 'Press it when the room has already finished and it holds silence, because '
        + 'silence is what was there. And you can play over the top of it \u2014 the held '
        + 'loop sits beside the room, not in place of it.',
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
