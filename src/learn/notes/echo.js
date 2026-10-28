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
      heading: 'Diffusion is the road from an echo to a room',
      body: 'Three all-pass filters sit in the feedback path. Each one passes everything '
        + 'and delays it by frequency, so a sharp repeat comes back as a short burst of '
        + 'itself rather than as a copy \u2014 and because they are inside the loop, every '
        + 'pass is smeared once more than the one before.\n\n'
        + 'That progression is the whole point, and it is the only control here that '
        + 'crosses from one kind of effect into another: turn it up and the repeats stop '
        + 'being echoes and start being a room.\n\n'
        + 'It does nothing to a slapback, and that is not a limitation. The first repeat '
        + 'is read before the all-passes, so it is always clean, and the smearing is '
        + 'something that accumulates over passes. A delay with two audible repeats has '
        + 'almost nothing for it to act on \u2014 which is why you are only asked to match '
        + 'it on a delay with a tail.',
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
      heading: 'Over unity, a delay is an oscillator',
      body: 'Feedback is how much of each repeat goes round again. Under one, each pass is '
        + 'quieter than the last and the tail dies. At one it holds. Over one it builds, and '
        + 'what you have is not a delay any more but an oscillator with a note in it '
        + '\u2014 the howl a dub engineer rides the feedback knob into.\n\n'
        + 'Something has to stop it, and on hardware that something is the medium: tape '
        + 'saturates, a bucket brigade runs out of headroom, and the howl settles wherever '
        + 'the medium stops accepting more. The same thing happens here, and it is why the '
        + 'knob can go past a hundred per cent at all.\n\n'
        + 'Where the howling starts is not the number on the knob, and that is the most '
        + 'musical thing about it. The tone and low-cut filters are inside the loop, so they '
        + 'take something off every pass: with them where they open, a hundred per cent '
        + 'still dies away slowly. Open them up and it does not. A tape machine with its head '
        + 'bump howls at the bump \u2014 a particular low note, every time \u2014 and that is '
        + 'true here too.',
    },
    {
      heading: 'What a delay does while you move the time',
      body: 'There is already sound in the line when the knob moves, and what happens to it '
        + 'is the one thing every delay ever built has had to decide. There are three '
        + 'answers and you can pick any of them here.\n\n'
        + '\u201cRepitch\u201d is what a transport does, because it has no choice: the tape '
        + 'is already recorded, and playing it at a new speed is the only thing a new speed '
        + 'can mean. The read head glides to its new place and what is on the way there '
        + 'bends \u2014 up when you shorten the delay, down when you lengthen it. A bucket '
        + 'brigade does the same for the same reason, since its clock is its speed. It is '
        + 'the sound of a dub engineer riding the time knob.\n\n'
        + '\u201cFade\u201d is what most digital delays do: hold the old read head, start a '
        + 'new one, and cross between them too fast to follow. Nothing bends. For a moment '
        + 'you hear both, and where their phases oppose they cancel \u2014 which is why a '
        + 'fade on a sustained note dips, and why there is no fade law that avoids it.\n\n'
        + '\u201cJump\u201d moves the head and takes the click. Some hardware really does, '
        + 'and on small moves you cannot hear it; a drag is a hundred small moves, and you '
        + 'can hear that.',
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
