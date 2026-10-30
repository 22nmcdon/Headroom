// What a de-esser is, for somebody using one.
//
// The long version of the split-band half of src/plugins/compressor/dsp.js.

export const DEESS_NOTES = {
  tool: 'deess',
  title: 'De-essing',
  sections: [
    {
      heading: 'A detector does not have to listen to what it acts on',
      body: 'That is the whole idea, and a de-esser is the simplest case of it. The '
        + 'detector is filtered so that only sibilance sets it off, and the reduction is '
        + 'applied only to the band where sibilance lives. Take either half away and you '
        + 'have something else: a compressor with a filtered sidechain, or a dynamic EQ '
        + 'that fires on everything.\n\n'
        + 'Once you have seen it here, a multiband compressor is not a new idea — it is '
        + 'this, three or four times over, with the bands added back up at the end.',
    },
    {
      heading: 'Ducking a band against ducking a record',
      body: 'The switch on the face is the difference, and it is worth hearing rather '
        + 'than being told. Set to the whole signal, every S pulls the entire voice down '
        + 'and lets it back up — measured on the voice here, taking eight decibels off '
        + 'the esses, everything under a kilohertz comes down 1.51 dB under a broadband '
        + 'de-esser and 0.04 under a split one. You hear it as the voice lurching under '
        + 'every syllable, and once you have heard it you will recognise it on records.\n\n'
        + 'The split version does the same thing to the sibilance and nothing at all to '
        + 'the vowel. That is not a subtlety: it is the entire reason the tool exists.',
    },
    {
      heading: 'The two halves have to add back up',
      body: 'The band is split as "the low part" and "what is left when the low part is '
        + 'taken away", so the two sum to exactly the signal — measured at 8.7e-12 dB, '
        + 'which is arithmetic rather than a filter. A de-esser doing nothing has to do '
        + 'nothing, whatever the crossover is set to, or it is an EQ with a mood.\n\n'
        + 'How the low part is filtered turns out to matter more than it looks. A '
        + 'textbook second-order filter reconstructs perfectly at unity and fights itself '
        + 'as soon as the halves are scaled differently: ducking 14 dB with a 6 kHz '
        + 'crossover came out 21 dB down at 12 kHz, because the low half\'s phase lag '
        + 'partly cancels the scaled high half. Three gentle one-pole filters in series '
        + 'have no resonance to lag, and give a clean shelf instead — within a decibel of '
        + 'the amount asked for above the crossover, and a tenth of a decibel at 500 Hz.',
    },
    {
      heading: 'Aim it before you set it',
      body: 'The order people get wrong is to decide how much to take off and then go '
        + 'looking for the esses. Do it the other way. Listen to the band on its own, move '
        + 'the crossover until the sibilance is the loudest thing in it and the voice is '
        + 'not, and only then decide the amount.\n\n'
        + 'Aimed too low it takes the top of the voice with the S, which sounds like a '
        + 'blanket. Aimed too high it misses the S and ducks the air above it, which '
        + 'sounds like nothing at all and wastes everybody\'s afternoon. Somewhere between '
        + 'four and eight kilohertz is where most voices keep their esses, and the only '
        + 'way to find out where yours does is to listen to the band.',
    },
    {
      heading: 'Fast, shallow, and not for long',
      body: 'Sibilance is 50 to 100 ms of noise. An attack slow enough to miss it lets the '
        + 'S through and then ducks the vowel behind it, which is the worst of both; a '
        + 'release slow enough to hold on dulls everything after it. A millisecond and '
        + 'sixty is a starting point rather than a rule.\n\n'
        + 'And the failure mode is not subtle once you know it. Take fifteen decibels off '
        + 'every S and the voice sounds like it cannot say them — a lisp, put there on '
        + 'purpose by somebody trying to be helpful. The range knob is the ceiling on how '
        + 'far it can ever go, and setting it is the difference between a de-esser and a '
        + 'de-esser you can hear.',
    },
  ],
};
