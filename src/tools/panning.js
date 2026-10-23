import { ImagePlugin } from '../plugins/stereo/plugin.js';
import { IMAGE_DEFAULTS } from '../plugins/stereo/field.js';

/**
 * The stereo, as a thing you open rather than a question you are asked.
 *
 * This half used to be a `mount(el, { puzzle })` inside the exercise, which
 * meant a tool could not exist without a round to justify it - and that a
 * change of exercise tore the plugin down, stopped the audio, and built
 * another one. Here the tool knows nothing about a puzzle, an answer or a
 * tier. It opens, it runs, and an exercise is something that arrives later.
 */
export const PANNING_TOOL = {
  id: 'panning',
  label: 'Stereo',
  blurb: 'Place it, and size it',

  lede: 'A stereo imager, and a loop running through it. Put the sound where '
      + 'the target sits, build the same width the target has, or rescue a low '
      + 'end that somebody has spread so wide it disappears in mono.',
  advice: 'Headphones for this one — a laptop speaker has almost no stereo field to point at. And press Mono often: it is the check that decides what everybody else hears.',
  help: [
    ['Play the loop, then work the image.',
     'The round display is the two channels drawn against each other. Straight up and '
     + 'down is mono, a cloud is wide, and anything lying over towards the horizontal is '
     + 'two channels arguing — which is exactly what will not survive being summed.'],
    ['Width is one idea applied three times.',
     'A pair of channels is the same information as a middle and a side, and width is '
     + 'what the side gets multiplied by. Doing it per band is the whole point: a low end '
     + 'wants to be narrow and a top end usually does not.'],
    ['Mono is the check that matters.',
     'Most of what a record is played on sums to mono somewhere. The bars go red when the '
     + 'two channels of a band are arguing, and the readout says what a fold to mono is '
     + 'costing you.'],
    ['You are judged on the image, not the knobs.',
     'Width band by band, and where the whole thing is sitting left to right. Two sets of '
     + 'settings that come out the same width are the same answer.'],
  ],

  /** Open it, on its own defaults, with nothing imposed. */
  open(el, { engine, onChange, source = 'mix' } = {}) {
    const settings = { ...IMAGE_DEFAULTS };
    return new ImagePlugin(el, { engine, settings, onChange, source });
  },
};
