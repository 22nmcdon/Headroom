// What a delay is, for somebody using one.
//
// The long version of what lives at the top of src/plugins/delay/line.js.

export const ECHO_NOTES = {
  tool: 'delay',
  title: 'Delay',
  sections: [
    {
      heading: 'A repeat is an impulse response too',
      body: 'The same trick the reverb plays, for the same reason. A delay is linear, so '
        + 'everything it will ever do to anything is contained in what it does to one '
        + 'click. Written down that way, the repeats you see are the repeats you hear and '
        + 'the repeats a guess is marked against, and the tail lands exactly where the '
        + 'setting says rather than being retimed under a playhead.\n\n'
        + 'A room and a repeat are the same kind of object here, and they are measured by '
        + 'the same code.',
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
