// What two microphones on one source do to each other, for somebody using
// two microphones.
//
// The long version of what lives at the top of src/plugins/align/pair.js.

export const ALIGN_NOTES = {
  tool: 'align',
  title: 'Two mics, one source',
  sections: [
    {
      heading: 'It is not an effect. It is arithmetic',
      body: 'Add a signal to a copy of itself a time t later and the two cancel wherever '
        + 'that time is half a cycle, which is f = (2k+1)/2t. So the notches land at 1/2t, '
        + '3/2t, 5/2t and on up, with peaks halfway between, and the result is the shape '
        + 'everybody calls a comb filter. Nobody chose it; it is what addition does.\n\n'
        + 'Measured on the pair here, as the deepest dip found rather than predicted: a '
        + 'path of 0.25 ms notched at 2032 Hz against a predicted 2000, 0.5 ms at 1016 '
        + 'against 1000, 1 ms at 508 against 500, 2 ms at 254 against 250 and 4 ms at 127 '
        + 'against 125. The formula to the resolution of the band set it was read in.\n\n'
        + 'Which is why this is the first thing to check on a hollow-sounding source and '
        + 'not the last. A notch at 500 Hz that arithmetic put there cannot be EQ\'d out: '
        + 'you would be boosting a frequency that has been cancelled, and all that comes '
        + 'up is whatever else was there.',
    },
    {
      heading: 'A millisecond is 34 centimetres',
      body: 'Sound covers 34.3 cm per millisecond in dry air, so the conversion between '
        + 'where a microphone is and what it does to its neighbour is a multiplication you '
        + 'can do in your head. A mic a foot further back is 0.89 ms later and notches the '
        + 'pair at about 560 Hz. Two mics 20 cm apart notch at about 860 Hz. An overhead a '
        + 'metre and a bit above a snare is 3.5 ms late and notches at 143.\n\n'
        + 'That is the number this tool is really teaching, because it runs both ways. '
        + 'Hearing where a pair is hollow tells you how far apart the mics are, and knowing '
        + 'how far apart they are tells you where it will be hollow before you put them up.',
    },
    {
      heading: 'The delay goes on the mic that heard it first',
      body: 'You cannot make a microphone hear something earlier, so there is only one '
        + 'direction a fix can go: hold the close one until the far one catches up. On a '
        + 'session that means the close mic gets the delay and everything downstream of it '
        + 'moves too, which is why consoles and DAWs do this with a single number per '
        + 'track and call it delay compensation.\n\n'
        + 'It also means a pair can be aligned for exactly one point on the source. Align '
        + 'the overheads to the snare and the kick is now wrong by the difference between '
        + 'the two distances. There is no setting that fixes a kit; there is a setting that '
        + 'decides which part of it you are fixing, and choosing is the job.',
    },
    {
      heading: 'The correlation meter is not a polarity meter',
      body: 'Every desk has had one since the sixties and most people have been told it '
        + 'reads polarity. It does not. It reads the agreement between two signals at zero '
        + 'delay, and on a spaced pair that is mostly a report about the spacing.\n\n'
        + 'Measured here on a pair eight milliseconds apart: the meter reads -0.82 when the '
        + 'two microphones are the same way up and +0.82 when one of them is inverted. '
        + 'Exactly backwards, and perfectly honest about what it was asked - at eight '
        + 'milliseconds the two waveforms genuinely do disagree at zero lag, because the '
        + 'low end has had time to go round half a cycle.\n\n'
        + 'What tells you the truth is where the agreement peaks rather than what it is at '
        + 'nought, which is what the second display on this face draws. The peak says how '
        + 'far apart they are and its sign says which way up they are, and those are two '
        + 'different facts that one number was never going to carry.',
    },
    {
      heading: 'Nobody can hear absolute polarity',
      body: 'One signal, inverted or not, with nothing to compare it against: listeners get '
        + 'it right 49.87 per cent of the time over 780 trials, which is a coin with an '
        + 'opinion. There are real effects of absolute polarity on asymmetric waveforms - a '
        + 'trumpet, a kick drum, a voice - but they are small, they depend on playback '
        + 'level and room, and they are nothing like the thing people claim to hear when '
        + 'they flip a phase button on a single track.\n\n'
        + 'Relative polarity between two correlated signals is a completely different '
        + 'question, because the two cancel. That is not subtle, it is not a matter of '
        + 'taste, and it is audible to anybody: the low end either fills in or falls '
        + 'away.\n\n'
        + 'So every question this tool asks is about a pair, and the way to answer one is '
        + 'always the same - bring the second microphone in and out and listen to what the '
        + 'bottom does. If it gets smaller when the second mic arrives, something is the '
        + 'wrong way round.',
    },
    {
      heading: 'When alignment cannot win',
      body: 'Two microphones at different distances are not two copies of one signal. They '
        + 'hear different parts of the instrument, from different angles, with different '
        + 'amounts of room on them - so even perfectly in time they do not cancel to '
        + 'nothing or add to double. Alignment fixes the part that is a delay, and the rest '
        + 'is a mix decision.\n\n'
        + 'Which is why the fader is the other half of the answer. A pair that will not sit '
        + 'together at any delay is a pair where the second mic should be quieter: the '
        + 'comb\'s depth follows the level difference, so a far mic ten decibels down ripples '
        + 'by a couple of decibels instead of notching by fifteen. The detection work on '
        + 'reflections puts the threshold of audibility around 13 to 18 dB down, worst at '
        + 'about 0.8 ms - which is the same arithmetic from the other end, and a useful '
        + 'number for deciding how much of a room mic you can afford.',
    },
  ],
};
