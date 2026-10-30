import { AlignPlugin } from '../plugins/align/plugin.js';
import { ALIGN_DEFAULTS } from '../plugins/align/pair.js';

/**
 * Two mics on one source, as a thing you open rather than a question.
 *
 * The eleventh tool and the only one that does not process anything. What it
 * decides is how two recordings of the same event are added together, which
 * is the first decision of every multi-mic recording ever made and the one
 * most likely to have been got wrong before anybody reached for an EQ.
 *
 * It is here because of what it teaches about the rest of the app: that a
 * hollow-sounding source is not always an EQ problem, and that the fix for a
 * notch at 500 Hz is sometimes a delay of a millisecond rather than a boost
 * nobody can make work.
 */
export const ALIGN_TOOL = {
  id: 'align',
  label: 'Align',
  blurb: 'Two mics, one source',

  lede: 'A delay and a polarity switch, which is all it takes to add two '
      + 'microphones together properly. Hear what a fraction of a millisecond '
      + 'does to a drum, and learn to read the two displays that tell you how '
      + 'far out it is and which way to move.',
  advice: 'Flip first, then time. Polarity is one button and either right or wrong; the delay is a search, and searching it with the polarity wrong means searching for the wrong peak.',
  help: [
    ['Two copies a time apart are a comb.',
     'Add a signal to a delayed copy of itself and they cancel wherever the delay is '
     + 'half a cycle, which is f = (2k+1)/2t - so the notches are at 1/2t, 3/2t, 5/2t and '
     + 'on up, and the peaks are halfway between. Measured here: a path of 0.25 ms notched '
     + 'at 2032 Hz against a predicted 2000, 0.5 ms at 1016 against 1000, 1 ms at 508 '
     + 'against 500 and 4 ms at 127 against 125. It is not an effect; it is arithmetic.'],
    ['A millisecond is 34 cm.',
     'Sound covers 34.3 centimetres per millisecond, so a mic a foot further back is 0.89 '
     + 'ms later and notches its pair at about 560 Hz. That is the conversion worth '
     + 'knowing by heart, because it turns a hollow-sounding pair into a distance you can '
     + 'measure with your hands.'],
    ['The delay goes on the mic that heard it first.',
     'You cannot make a microphone hear something earlier. What you can do is hold the '
     + 'close one until the far one catches up, which is why there is one delay here and '
     + 'it is on the close mic. Every DAW does the same thing under the name delay '
     + 'compensation, and on a multi-mic session it is doing it to dozens of tracks.'],
    ['The correlation meter does not tell you about polarity.',
     'It is the figure every desk has had since the sixties and the one people read '
     + 'wrong. It reports the agreement at zero delay, and on a spaced pair that is '
     + 'mostly a report about the spacing: measured here on a pair eight milliseconds '
     + 'apart, it reads -0.82 when the two are the same way up and +0.82 when one of them '
     + 'is inverted. Exactly backwards, and perfectly honest about what it was asked.'],
    ['Nobody can hear absolute polarity.',
     'One signal on its own, inverted or not, with nothing to compare it to: 780 trials '
     + 'came out at 49.87 per cent, which is a coin. Relative polarity between two '
     + 'correlated signals is a different question entirely, because the two cancel - and '
     + 'that is the only question this tool ever asks you.'],
  ],

  open(el, { engine, onChange, source = null } = {}) {
    const settings = { ...ALIGN_DEFAULTS };
    return new AlignPlugin(el, { engine, settings, onChange, source });
  },
};
