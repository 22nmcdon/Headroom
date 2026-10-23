import { HeatPlugin } from '../plugins/saturation/plugin.js';
import { HEAT_DEFAULTS } from '../plugins/saturation/shape.js';

/**
 * The saturation, as a thing you open rather than a question you are asked.
 *
 * This half used to be a `mount(el, { puzzle })` inside the exercise, which
 * meant a tool could not exist without a round to justify it - and that a
 * change of exercise tore the plugin down, stopped the audio, and built
 * another one. Here the tool knows nothing about a puzzle, an answer or a
 * tier. It opens, it runs, and an exercise is something that arrives later.
 */
export const SATURATION_TOOL = {
  id: 'saturation',
  label: 'Saturation',
  blurb: 'Even, odd, and how much',

  lede: 'A saturator, and a loop running through it. Match how much colour '
      + 'the target has, match the colour itself, or build a warmth that is '
      + 'all even harmonics and no grit.',
  advice: 'Auto gain is on, and leave it on — saturation makes things louder as well as richer, and louder always sounds better for about two seconds. Press “Only the heat” to hear what the curve is adding with nothing else in the way.',
  help: [
    ['Play the loop, then drive it.',
     'The square panel is the transfer curve: what comes out for everything that could '
     + 'go in. A straight line does nothing. A line that bends at the ends is saturating, '
     + 'and how sharply it bends is the Hardness.'],
    ['Bias is the one that matters.',
     'A curve that treats up and down alike can only make odd harmonics — the third, the '
     + 'fifth — and those sound like grit. Tilt it with Bias and the even ones appear, and '
     + 'those sound like the note getting bigger. Gold bars are even, pink are odd.'],
    ['Drive decides how much, not which.',
     'Past a certain point everything sounds the same kind of broken: hit anything hard '
     + 'enough and it becomes a square wave, which is all odd. Warmth lives at the quiet '
     + 'end of the drive, with the bias doing the work.'],
    ['You are judged on the harmonics, not the knobs.',
     'The series a sine comes out as, second to tenth. Two sets of settings that make the '
     + 'same series are the same answer.'],
  ],

  /** Open it, on its own defaults, with nothing imposed. */
  open(el, { engine, onChange, source = 'mix' } = {}) {
    const settings = { ...HEAT_DEFAULTS };
    return new HeatPlugin(el, { engine, settings, onChange, source });
  },
};
