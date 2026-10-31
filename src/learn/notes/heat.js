// What saturation is, for somebody using it.
//
// The long version of what lives at the top of src/plugins/saturation/shape.js.

export const HEAT_NOTES = {
  tool: 'saturation',
  title: 'Saturation',
  sections: [
    {
      heading: 'It is the only one that makes something new',
      body: 'Every other tool here moves energy that was already there. An EQ turns a band '
        + 'up, a compressor turns a moment down, a reverb and a delay put copies of it '
        + 'somewhere else, an imager moves it across the room.\n\n'
        + 'A nonlinearity makes energy at frequencies that were never in the recording. '
        + 'Feed it 220 Hz and out come 440, 660, 880 and so on, and the recipe of that '
        + 'series is what people are hearing when they say warm, or edgy, or crunchy, or '
        + 'broken. That series is the entire subject.',
    },
    {
      heading: 'Even against odd is the whole ear skill',
      body: 'A curve that treats up and down alike can only make odd harmonics — the third, '
        + 'the fifth, the seventh. Those are fifths and their neighbours, and they sound '
        + 'like something going wrong.\n\n'
        + 'Tilt the curve so one half squashes before the other and the even harmonics '
        + 'appear — the second, the fourth. Those are octaves and their neighbours, and '
        + 'they sound like the note getting bigger. Even is warm; odd is dirty. That single '
        + 'fact is most of what an ear needs here, and it is why the bars are coloured '
        + 'rather than labelled.',
    },
    {
      heading: 'Drive decides how much, not which',
      body: 'Past a certain point everything sounds the same kind of broken: hit anything '
        + 'hard enough and it becomes a square wave, and a square wave is all odd. Warmth '
        + 'lives at the quiet end of the drive with the bias doing the work.\n\n'
        + 'Hardness decides when the colour arrives rather than how much of it there is. '
        + 'Measured: at a moderate drive a soft curve is already making a third harmonic '
        + 'while a hard one is still doing nothing at all — and at a high drive it is the '
        + 'other way round. A soft curve is always a little coloured; a hard one is clean '
        + "until it isn't, and then it is everything at once.",
    },
    {
      heading: 'Why it runs eight times faster than the signal',
      body: 'A nonlinearity makes harmonics without limit, and every one above half the '
        + 'sample rate folds back down to a frequency that is not a harmonic of anything. '
        + 'Inharmonic is the one thing real saturation never sounds like.\n\n'
        + 'Measured at the ordinary rate, a 220 Hz note is fine — the folded energy comes '
        + 'back 61 dB down. A hi-hat is not: at a high drive the junk lands 10 dB under the '
        + 'signal. A tool built on that would be teaching you to recognise a sound no piece '
        + 'of gear makes. So the curve runs at eight times the rate with a linear-phase '
        + 'filter either side of it, and the same hi-hat comes back 48 dB down.',
    },
    {
      heading: 'The difference between an effect and a fault',
      body: 'Three of the seven answers in the artefact drill are things this plugin does '
        + 'on purpose: hard clipping, soft clipping and quantising. The other four are '
        + 'nobody\'s idea of a good time — sample and hold, mains hum, a click, and a codec '
        + 'taking the ends off. They are in one drill because the difference between them '
        + 'is not in the signal. It is whether anybody meant it.\n\n'
        + 'What the ear has to do is sort them by kind rather than by how bad they are. '
        + 'Measured on the mix loop, each one against the same loop clean, as what it does '
        + 'to the spectrum and to the crest factor:\n\n'
        + '    what               spectrum    crest\n'
        + '    hard clipping           2.0      5.5\n'
        + '    soft clipping           3.2      8.5\n'
        + '    quantising              3.3      0.1\n'
        + '    sample and hold        12.5      0.0\n'
        + '    mains hum               5.9      0.1\n'
        + '    a click                 6.5      3.1\n'
        + '    band-limiting          10.8      0.1\n\n'
        + 'Two groups, and the table shows them. The ones that flatten peaks move the crest '
        + 'and hardly touch the spectrum; the ones that add something or take something '
        + 'away do the opposite. That is the first question to ask of a recording that '
        + 'sounds wrong: has something been flattened, has something been added, or has '
        + 'something gone?\n\n'
        + 'All seven are matched for loudness before you hear them, to a tenth of a decibel. '
        + 'Without that the drill would be answerable by which one got quieter, which is not '
        + 'a skill.',
    },
    {
      heading: 'Why there is no number for how bad it is',
      body: 'Total harmonic distortion is the number everybody reaches for, and it does not '
        + 'predict what anybody hears. Geddes and Lee went looking for a measure that '
        + 'correlated with perceived distortion and found that THD and IMD do not: a '
        + 'high-order artefact at a tenth of a per cent is more objectionable than soft '
        + 'clipping at ten per cent, because the ear cares what order the harmonics are and '
        + 'how they move, not how much energy is in them.\n\n'
        + 'So nothing here is scored on a percentage. The drill asks you to name what was '
        + 'done, which is the thing an ear can actually do and the thing that tells you what '
        + 'to go and fix.\n\n'
        + 'The one number that does mean something is the one for quantising, because '
        + 'quantising has a theory: a signal quantised to b bits should sit 6.02b + 1.76 dB '
        + 'above its own noise. Measured on a sine, this quantiser gives 50.0 dB at eight '
        + 'bits against the 49.9 the arithmetic says, 74.0 at twelve and 98.0 at sixteen. On '
        + 'music it is thirteen decibels worse even after normalising, and that gap is the '
        + 'crest factor: a sine sits at its peak and a drum loop spends most of its time a '
        + 'long way below one.',
    },
    {
      heading: 'Dither: paying a bit to stop the error following the music',
      body: 'Rounding every sample to the nearest rung of a ladder makes an error, and the '
        + 'problem with that error is not its size. It is that it is a function of the '
        + 'signal: a quiet passage gets an error that moves with it, which the ear hears as '
        + 'the sound going grainy rather than as a hiss underneath it. Fade something out '
        + 'at eight bits and the tail turns into a staircase and then into silence, several '
        + 'decibels before it should have gone.\n\n'
        + 'Adding noise before the rounding takes the error off the signal. One step of the '
        + 'ladder, made by adding two random draws together, is the amount everybody uses: '
        + 'a triangular shape rather than a flat one, because a flat one leaves the error’s '
        + 'loudness still moving with the signal even once the error itself has stopped.\n\n'
        + 'It costs a bit. Measured on a sine through the crusher:\n\n'
        + '    bits    no dither   half a step   one step   two steps\n'
        + '       4         26.2          24.5       21.1        16.3\n'
        + '       8         50.0          48.3       45.1        40.3\n'
        + '      12         74.0          72.2       69.3        64.4\n'
        + '      16         98.1          96.3       93.4        88.5\n\n'
        + 'One step costs 4.7 dB at sixteen bits and 4.8 at eight, against the 4.77 the '
        + 'theory says - four fifths of a bit, and the same whatever the ladder, because '
        + 'it is noise added rather than anything done to the rounding. Four bits is the '
        + 'one that misses, at 5.1, because there a step of noise is an eighth of the '
        + 'whole travel. That is the trade the knob is for: '
        + 'four fifths of a bit of hiss, bought to stop the last few bits turning the quiet '
        + 'parts to grit. At sixteen bits nobody can hear either; at eight you can hear '
        + 'both, which is why the control is on a crusher and not on a converter.',
    },
  ],
};
