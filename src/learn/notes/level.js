// What a level is, for somebody using a trim.
//
// The long version of what lives at the top of src/plugins/level/gain.js and
// src/lib/loudness.js.

export const LEVEL_NOTES = {
  tool: 'level',
  title: 'Level and loudness',
  sections: [
    {
      heading: 'Louder sounds better, and it is not a metaphor',
      body: 'Put the same piece of music in front of somebody twice, one copy a decibel '
        + 'louder, and they will prefer the louder one and tell you it sounds clearer, '
        + 'fuller or more open. They are not being careless. A level difference is '
        + 'genuinely audible as a quality difference, and the ear has no way to factor it '
        + 'out.\n\n'
        + 'Which is why this is the first skill rather than a footnote. Every comparison '
        + 'anybody makes while mixing — this EQ or that one, compressed or not, with the '
        + 'saturator or without — is partly a comparison of levels, unless the levels were '
        + 'matched first. A plugin that makes things a decibel louder will seem to improve '
        + 'everything it touches.',
    },
    {
      heading: 'A decibel, and what you can actually hear',
      body: 'The smallest level change most people can reliably detect on music is around '
        + 'one decibel. On a loud steady tone in the middle of the range it comes down to '
        + 'something like a quarter of a decibel, but music is neither loud nor steady nor '
        + 'in one place, so a decibel is the working figure.\n\n'
        + 'That is a useful number in both directions. It means half a decibel of mix '
        + 'move is below the threshold of argument and not worth having an opinion about. '
        + 'It also means three decibels is enormous — a doubling of power — and if two of '
        + 'your mixes are three decibels apart you are not comparing mixes.',
    },
    {
      heading: 'Peak is not loudness',
      body: 'A peak meter tells you how close the waveform came to the ceiling. That is '
        + 'worth knowing, because going past it clips. It tells you almost nothing about '
        + 'how loud the thing sounds: a sparse drum track and a dense wall of guitars can '
        + 'peak at exactly the same number and be fifteen decibels apart to the ear.\n\n'
        + 'Loudness needs a different measurement, and the one the world settled on is '
        + 'ITU-R BS.1770. It filters the signal to roughly match the ear\'s sensitivity '
        + 'across frequency, averages the power over 400 millisecond blocks, and throws '
        + 'away the blocks that are silence or nearly so, on the grounds that the gaps in '
        + 'a piece of music are not part of how loud it is. The answer comes out in LUFS, '
        + 'and a difference in LUFS is called LU.',
    },
    {
      heading: 'True peak, and why it is not the sample peak',
      body: 'The samples in a digital file are points on a curve, not the curve. Between '
        + 'two samples that both sit under the ceiling, the waveform they describe can go '
        + 'over it — and it will, as soon as anything converts the file back to analogue '
        + 'or re-encodes it as an MP3.\n\n'
        + 'So there are two peak readings here. The sample peak is the largest number in '
        + 'the file. The true peak reconstructs the curve between the samples — at four '
        + 'times the rate, which is what the standard asks for — and reports the largest '
        + 'value it actually reaches. The true peak is always the higher of the two, and '
        + 'it is the one a delivery spec means.',
    },
    {
      heading: 'What the two bars are for',
      body: 'The long bar is the integrated reading: the whole loop, averaged and gated. '
        + 'It is the number a streaming service compares against its target, and it moves '
        + 'slowly because it is an average of everything so far.\n\n'
        + 'The short one is the last three seconds. That is much closer to what your sense '
        + 'of "how loud is this right now" is running on, and it is the one that moves '
        + 'when the music does. Two masters at the same integrated loudness can be a '
        + 'steady one and a lurching one, and the trace on the right is where you see '
        + 'which.',
    },
  ],
};
