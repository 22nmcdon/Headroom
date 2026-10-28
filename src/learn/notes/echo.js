// What a delay is, for somebody using one.
//
// The long version of what lives at the top of src/plugins/delay/line.js.

export const ECHO_NOTES = {
  tool: 'delay',
  title: 'Delay',
  sections: [
    {
      heading: 'A repeat is a response, until the machine moves',
      body: 'A delay that holds still is linear, so everything it will ever do to anything '
        + 'is contained in what it does to one click. The repeats drawn on the panel are '
        + 'that click\u2019s response, and so are the repeats a guess is marked against: a '
        + 'room and a repeat are the same kind of object here, measured by the same code.\n\n'
        + 'What you hear is the loop itself, running a sample at a time. It used to be the '
        + 'response, convolved \u2014 which is the same sound for as long as nothing in the '
        + 'delay is moving. Wow and flutter end that. A response is one answer to \u201ca '
        + 'click in, what comes out\u201d, and convolving with it puts that same answer '
        + 'under every sample going past: a line whose length wanders would come back '
        + 'detuned by a fixed amount instead of wandering.',
    },
    {
      heading: 'The filters are inside the loop, not after it',
      body: 'The tone and low-cut controls sit in the feedback path. That is the difference '
        + 'between a delay that sounds like tape and one that sounds like a copy: they do '
        + 'not darken the repeat once, they darken it a little more every time round.\n\n'
        + 'Three repeats in, a signal has been through the filter three times. That '
        + 'compounding is most of the character.',
    },
    {
      heading: 'Wow is a pitch, flutter is a texture',
      body: 'A tape machine does not hold speed perfectly, and the two ways it fails have '
        + 'had separate names and separate lines on a spec sheet for sixty years. Slower '
        + 'than about six hertz is wow and comes from the capstan and the reels; faster is '
        + 'flutter and comes from the tape rubbing past the guides.\n\n'
        + 'They are two different sounds, which is why they are two controls. Wow is a '
        + 'pitch you can follow going up and down \u2014 the sound of a record played on a '
        + 'turntable with a bent spindle. Flutter is too fast to follow, so it does not '
        + 'bend the note, it roughens it.\n\n'
        + 'Both are set in cents of pitch, rather than in the per cent of speed a spec '
        + 'sheet quotes, because cents is the thing you hear. The honest physical model '
        + 'saturates with the delay time \u2014 a slapback on a wandering machine is steady '
        + 'and a long echo on the same machine warbles, because at twenty milliseconds the '
        + 'tape has not had time to be anywhere else \u2014 so the same number of per cent '
        + 'would mean six cents at one setting and one at another. Equal numbers here sound '
        + 'equally deep wherever the time is, which is what makes either of them something '
        + 'you can be asked about.',
    },
    {
      heading: 'Note values, and why these ones',
      body: 'Every adjacent pair of divisions offered here is at least a third apart, so '
        + 'telling one from the next is a question about the music rather than about a '
        + 'stopwatch.\n\n'
        + 'A dotted eighth and a quarter-note triplet are only twelve per cent apart. That '
        + 'is a difference you can measure and it is not one anybody names by ear, so '
        + 'asking you to would be testing patience rather than hearing.',
    },
    {
      heading: 'Right and wrong are about the track, not the number',
      body: 'A delay is right when the repeats fall in with what is playing and wrong when '
        + 'they walk through it. Matching a delay to a record nobody has told you the tempo '
        + 'of is the real version of the job — which is why one of the exercises here does '
        + 'not give you a tempo readout.',
    },
  ],
};
