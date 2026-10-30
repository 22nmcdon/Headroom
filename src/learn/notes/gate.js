// What a gate is, for somebody using one.
//
// The long version of what lives at the top of src/plugins/compressor/dsp.js,
// from the other side of the threshold.

export const GATE_NOTES = {
  tool: 'gate',
  title: 'Gates and expanders',
  sections: [
    {
      heading: 'It is the compressor, mirrored',
      body: 'Same detector, same attack and release, same knee. The only difference is '
        + 'which side of the threshold the curve bends on: a compressor turns down what is '
        + 'above it, an expander turns further down what is below it. Everything you know '
        + 'about one transfers, including the parts that are annoying.\n\n'
        + 'A gate is not a separate device either. It is an expander with a steep enough '
        + 'ratio and a deep enough range that "further down" amounts to "gone" — and the '
        + 'word gate is really a description of a setting rather than of a circuit.',
    },
    {
      heading: 'The knobs mean the opposite of what they mean next door',
      body: 'This is the part that catches people. A compressor\'s reduction goes up when '
        + 'the signal gets louder, so its attack governs the rise. A gate\'s goes up when '
        + 'the signal gets quieter — so if you wired the same smoother in unchanged, the '
        + 'knob marked attack would be controlling how fast the gate closed.\n\n'
        + 'It does not, here or on any real gate: attack is how fast it opens and release '
        + 'is how fast it closes. Measured on this one, at the same 63 per cent convention '
        + 'the compressor\'s knobs are stated in: an attack of 1 ms opens in 0.85, 5 opens '
        + 'in 4.2, 20 opens in 16.2; a release of 50 ms closes in 50.7, 200 in 199.8, 500 '
        + 'in 498.',
    },
    {
      heading: 'The threshold is a decision about the part, not about the noise',
      body: 'Everybody sets a gate\'s threshold by finding the gap between the floor and '
        + 'the hits and putting it in there. That is the easy half. The hard half is that '
        + 'a drummer plays quietly as well as loudly, and a threshold high enough to be '
        + 'safely clear of the room is often high enough to take the ghost notes out with '
        + 'it — and what you get is not a cleaner part but a squarer one.\n\n'
        + 'Measured on the loop here, whose kicks peak at -6 dBFS, snares at -10, ghost '
        + 'notes at -25 and room floor at -46. How far the gate gets from doing nothing at '
        + 'all, with 24 dB of range and a 120 ms release:\n\n'
        + '    threshold   -40    -38    -34    -24    -20    -16\n'
        + '    reads      0.00   0.07   1.66  15.32  18.73  18.96\n\n'
        + 'Which is a cliff with a plateau at each end. Under about -38 it never shuts, '
        + 'because six decibels of hysteresis puts its closing point down in the floor. '
        + 'From -29 to -22 it is a real control. Over about -21 it has stopped opening on '
        + 'the ghost notes and there is nothing left for it to do: four more decibels of '
        + 'threshold, from -22 to -18, moves it 1.21 where one decibel in the middle of '
        + 'the range moves it three.\n\n'
        + 'So a gate\'s threshold is not a dial you turn until it sounds right by degrees. '
        + 'It has plateaus and cliffs, and the cliffs are wherever something the drummer '
        + 'played happens to live. Find them by listening to what stops getting through, '
        + 'not by watching the meter.',
    },
    {
      heading: 'Range is the control that matters, and the one people leave alone',
      body: 'A gate closing all the way is audible as a gate. The silence between the hits '
        + 'is a different silence from the room that was there before, and the ear hears '
        + 'the switch rather than the cleanup. Almost every time, what you actually want is '
        + 'four to eight decibels — enough that the bleed drops out of the way, not enough '
        + 'that anybody notices a door.\n\n'
        + 'Measured on the drum loop here, the floor between the hits comes down about '
        + 'two thirds of whatever the range is set to: 2.2 dB at a range of 3, 8.7 at 12, '
        + '27.3 at 40. Short of the number on the knob because the release is still on its '
        + 'way down when the next hit arrives — which is worth knowing, because it means '
        + 'the knob is not a promise.',
    },
    {
      heading: 'Hold, and why the release cannot do its job',
      body: 'Without a hold, the release is doing two things at once: how long to wait '
        + 'before closing, and how fast to close. Those want different answers. A snare '
        + 'with a tail needs the gate to stay open for a while and then shut briskly; one '
        + 'knob cannot say that, and the compromise is either a chopped tail or a gate that '
        + 'never really shuts.\n\n'
        + 'Hold splits them. It reloads while the signal is above the threshold and keeps '
        + 'the gate fully open until it runs out — measured here at 0.8, 50.8 and 200.8 ms '
        + 'for settings of 0, 50 and 200. Then the release does the one job it is good at.',
    },
    {
      heading: 'Hysteresis, or why gates chatter',
      body: 'A signal sitting near the threshold crosses it over and over — a decaying '
        + 'note, a room tone with somebody moving in it, anything with a tremolo. A gate '
        + 'that opens and closes on each crossing flutters, and the flutter is far more '
        + 'audible than whatever it was trying to remove.\n\n'
        + 'Hysteresis fixes it by making the gate open at one level and close at a lower '
        + 'one, so a crossing in one direction does not immediately undo itself. Measured '
        + 'here on a tone wobbling two decibels across the threshold: 28 openings in two '
        + 'seconds with no hysteresis, and none at all with three decibels of it.\n\n'
        + 'There is a lesson underneath that one about building this sort of thing. The '
        + 'first version read the signal\'s level sample by sample, and the magnitude of a '
        + 'tone falls to zero twice a cycle — so the trigger flipped at the signal\'s own '
        + 'frequency and the hysteresis did nothing whatsoever. It reads a held level now.',
    },
    {
      heading: 'Listen to the detector',
      body: 'The most useful button on the face and the one nobody finds on a real gate. A '
        + 'gate triggering off the wrong thing — the kick through the snare mic, a hum, the '
        + 'tail of the thing before — is instantly obvious when you listen to what the '
        + 'detector is hearing, and nearly impossible to diagnose from the output.\n\n'
        + 'It is also how you learn to use the sidechain filters. High-pass the detector '
        + 'until the kick stops opening the snare gate; the gate does not change what it '
        + 'passes, only what it decides on.',
    },
  ],
};
