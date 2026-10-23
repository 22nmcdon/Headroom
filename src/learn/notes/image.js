// What stereo width is, for somebody using an imager.
//
// The long version of what lives at the top of src/plugins/stereo/field.js.

export const IMAGE_NOTES = {
  tool: 'panning',
  title: 'The stereo field',
  sections: [
    {
      heading: 'A pair of channels is a middle and a side',
      body: 'Everything an imager does comes down to one identity. Left and right carry '
        + 'exactly the same information as a middle and a side, where the middle is what '
        + 'the two agree on and the side is how they differ, and you can go back the other '
        + 'way whenever you like.\n\n'
        + 'Turning the side up is what "wider" means. Turning it down to nothing is mono. '
        + 'There is no third thing.',
    },
    {
      heading: 'The low end and the top want opposite things',
      body: 'A bass spread across the field sounds enormous, and then disappears the moment '
        + 'anybody sums it to mono — a club rig, a phone, a radio. A top end left in the '
        + 'middle sounds like a phone call.\n\n'
        + 'Which is why width is worth having per band rather than as one knob: narrow '
        + 'underneath, wide above, and the crossover between them somewhere you chose.',
    },
    {
      heading: 'What summing to mono actually costs',
      body: 'Less than people think, and not where they think. A sound panned hard to one '
        + 'side has as much side as middle, and loses nothing at all when summed, because '
        + 'there is nothing on the other side to cancel with. Two identical channels lose '
        + 'nothing. Two opposite channels lose everything. Two unrelated ones lose three '
        + 'decibels.\n\n'
        + 'Read the obvious way — the middle against the middle and side together — a hard '
        + 'pan looks like a three-decibel problem it does not have, and monoing everything '
        + 'looks like a fix. This reads each band against the best those two channel levels '
        + 'could possibly give, which is what makes the number mean something.',
    },
    {
      heading: 'The goniometer, and what to look for',
      body: 'The round display draws the two channels against each other, turned so that '
        + 'what they agree on points up. A mono signal is a vertical line. A wide one is a '
        + 'cloud. Anything lying over towards the horizontal is two channels arguing — and '
        + 'the horizontal is exactly the axis that disappears when somebody sums them.',
    },
  ],
};
