import { AimedPlugin, DEESS_FACE } from '../plugins/compressor/aimed.js';

/**
 * The de-esser, as a thing you open rather than a question you are asked.
 *
 * The tenth tool and the narrowest: one problem, one band, one decision about
 * how much of it to take. What it teaches beyond itself is the idea a
 * multiband compressor is built on - that a detector and the thing it acts on
 * do not have to be the same signal - and it teaches it on the one case where
 * the answer is unambiguous.
 */
export const DEESS_TOOL = {
  id: 'deess',
  label: 'De-esser',
  blurb: 'One band, ducked',

  lede: 'A compressor listening to the top of the spectrum and working only '
      + 'there. Hear the difference between ducking a band and ducking a '
      + 'record, and find the amount that takes the hiss off a voice without '
      + 'taking the voice with it.',
  advice: 'Aim it before you set it. Hear the band on its own, move the crossover until the esses are the loudest thing in it and the voice is not, and only then decide how much to take off.',
  help: [
    ['A detector does not have to listen to what it acts on.',
     'That is the whole idea, and a de-esser is the simplest case of it. The detector is '
     + 'high-passed so that only sibilance sets it off, and the reduction is applied to '
     + 'the band above the crossover so that only sibilance is affected. Take either half '
     + 'away and it stops being a de-esser.'],
    ['Band only against whole signal.',
     'The switch on the face is the difference between a de-esser and a compressor with a '
     + 'filtered sidechain. Measured on the voice here, taking eight decibels off the '
     + 'esses: ducking the whole signal pulls everything under a kilohertz down 1.51 dB, '
     + 'where the split leaves it at 0.04. You can hear it as the voice lurching under '
     + 'every syllable.'],
    ['The split adds back up.',
     'The two halves are the low band and what is left when the low band is taken away, so '
     + 'they sum to exactly the signal — measured at 8.7e-12 dB. A de-esser doing nothing '
     + 'has to do nothing, whatever the crossover is set to, or it is an EQ with a mood.'],
    ['Fast, and not for long.',
     'Sibilance is 50 to 100 ms of noise. An attack slow enough to miss it lets the S '
     + 'through and ducks the vowel behind it, which is the worst of both; a release slow '
     + 'enough to hold on dulls everything after it. A millisecond and sixty is a starting '
     + 'point, not a rule.'],
    ['Too much is a lisp.',
     'The failure mode is not subtle once you know it: take fifteen decibels off every S '
     + 'and the voice sounds like it cannot say them. The range knob is the limit on how '
     + 'far it can ever go, and setting it is the difference between a de-esser and a '
     + 'de-esser you can hear.'],
  ],

  open(el, { engine, onChange, source = null } = {}) {
    const settings = { ...DEESS_FACE.defaults };
    return new AimedPlugin(el, { engine, settings, onChange, spec: DEESS_FACE, source });
  },
};
