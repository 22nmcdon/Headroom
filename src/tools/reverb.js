import { VerbPlugin } from '../plugins/reverb/plugin.js';
import { VERB_DEFAULTS } from '../plugins/reverb/ir.js';

/**
 * The reverb, as a thing you open rather than a question you are asked.
 *
 * This half used to be a `mount(el, { puzzle })` inside the exercise, which
 * meant a tool could not exist without a round to justify it - and that a
 * change of exercise tore the plugin down, stopped the audio, and built
 * another one. Here the tool knows nothing about a puzzle, an answer or a
 * tier. It opens, it runs, and an exercise is something that arrives later.
 */
export const REVERB_TOOL = {
  id: 'reverb',
  label: 'Reverb',
  blurb: 'Build the room',

  lede: 'A reverb, and a loop running through it. Build the same room you can '
      + 'hear on the target — or a room that belongs to the track, answering on '
      + 'the beat and gone before the next one.',
  advice: 'Decay is the easy half. What people miss is the gap before the room answers, and how much shorter the top decays than the bottom.',
  help: [
    ['Play the loop, then build the room.',
     'The left panel is the room itself: the gap before it answers, the walls arriving '
     + 'one at a time, and the wash closing over them. The right panel is how it decays, '
     + 'band by band, which is also exactly what your guess is marked against.'],
    ['Pre-delay is the one to listen for.',
     'It is the gap between the sound and the room, and it is what keeps a source in '
     + 'front of its own reverb. People hear decay easily and pre-delay hardly at all, '
     + 'which is why it is on the display.'],
    ['HF decay is the other one.',
     'Real rooms lose their top before they lose their bottom, and how much shorter the '
     + 'highs ring is most of what makes a room sound like stone or like curtains. The '
     + 'three curves pulling apart is that, on the screen.'],
    ['You are judged on the decay, not the controls.',
     'Two sets of settings that decay the same way are the same room. Auto gain is on, '
     + 'so moving the mix does not change how loud it is - otherwise the wetter side of '
     + 'the A/B would win every time.'],
  ],

  /** Open it, on its own defaults, with nothing imposed. */
  open(el, { engine, onChange, source = 'instrument' } = {}) {
    const settings = { ...VERB_DEFAULTS };
    return new VerbPlugin(el, { engine, settings, onChange, source });
  },
};
