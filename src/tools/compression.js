import { CompPlugin } from '../plugins/compressor/plugin.js';
import { COMP_DEFAULTS } from '../plugins/compressor/dsp.js';

/**
 * The compression, as a thing you open rather than a question you are asked.
 *
 * This half used to be a `mount(el, { puzzle })` inside the exercise, which
 * meant a tool could not exist without a round to justify it - and that a
 * change of exercise tore the plugin down, stopped the audio, and built
 * another one. Here the tool knows nothing about a puzzle, an answer or a
 * tier. It opens, it runs, and an exercise is something that arrives later.
 */
export const COMPRESSION_TOOL = {
  id: 'compression',
  label: 'Compression',
  blurb: 'Work the compressor',

  lede: 'A compressor, and a loop running through it. Match the one on the '
      + 'target, level out a loop that will not sit still, or key it off the '
      + 'kick and get out of the way.',
  advice: 'The hardest thing here, and the plan says so: this is difficult even for people who do it for a living. Listen to the transients, and to what happens between the hits.',
  help: [
    ['Play the loop, then work the compressor.',
     'Drag the display sideways to move the threshold, or drag the handle at the top '
     + 'of the curve to set the ratio. The trace beside it is what the compressor is '
     + 'doing to this loop, hit by hit, and it follows the knobs whether or not '
     + 'anything is playing.'],
    ['The detector is the half nobody touches.',
     'Peak hears transients and RMS hears loudness. The key filters decide what the '
     + 'detector is allowed to hear, which is how you stop a kick pulling a whole mix '
     + 'down every bar - press listen to hear what it is reacting to.'],
    ['Auto gain is on, and it is not being polite.',
     'A compressor changes loudness, so without it the louder side of the A/B would win '
     + 'every time and you would never hear the compression at all.'],
    ['You are judged on what it did, not on where the knobs are.',
     'Two settings that treat the loop the same way are the same answer. Evening out a '
     + 'loop has no one answer at all: it is done when the loop sits still, and '
     + 'flattening it is not the same thing as levelling it.'],
  ],

  /** Open it, on its own defaults, with nothing imposed. */
  open(el, { engine, onChange, source = 'drums' } = {}) {
    const settings = { ...COMP_DEFAULTS };
    return new CompPlugin(el, { engine, settings, onChange, source });
  },
};
