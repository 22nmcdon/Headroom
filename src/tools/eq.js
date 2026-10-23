import { newStrip } from '../plugins/eq/filters.js';
import { EQPlugin } from '../plugins/eq/plugin.js';

/**
 * The EQ, as a thing you open rather than a question you are asked.
 *
 * This half used to be a `mount(el, { puzzle })` inside the exercise, which
 * meant a tool could not exist without a round to justify it - and that a
 * change of exercise tore the plugin down, stopped the audio, and built
 * another one. Here the tool knows nothing about a puzzle, an answer or a
 * tier. It opens, it runs, and an exercise is something that arrives later.
 *
 * What is left of the old mode in this file is the part that is true of the
 * EQ whatever you are doing with it: what it is called, what it is for, and
 * how to work it. The exercises are in src/learn/work/eq.js and the long prose is
 * in src/learn/notes/eq.js.
 */
export const EQ_TOOL = {
  id: 'eq',
  label: 'EQ',
  blurb: 'Shape it until it matches',

  lede: 'A channel EQ, and a loop running through it. Drag the bands until '
      + 'yours sounds like the target — or until the problem in the sample is gone.',

  help: [
    ['Play the loop, then shape the EQ.',
     'Drag a band to move it; the wheel over a band is its Q; the buttons under the '
     + 'display turn one on and off. Yours and the other side swap instantly, so you '
     + 'can flip while it runs.'],
    ['Any band can be any kind of band.',
     'Peak, shelf or cut, chosen under the display - and a cut can be 12, 24 or 48 dB '
     + 'an octave. Six bands that can each be anything is a parametric EQ rather than '
     + 'a tone control.'],
    ['It can be typed, and it can be nudged.',
     'The numbers under the sliders are fields: 3.15k, 3150 and 3k15 are all the same '
     + 'frequency. With the display focused, the arrow keys move the selected band a '
     + 'semitone and half a decibel at a time, shift makes them fine, and the bracket '
     + 'keys are Q.'],
    ['The analyser is a picture, not a reading.',
     'Tilt it three decibels an octave and a balanced mix reads level instead of '
     + 'sloping away, so what stands out is what actually stands out. Peak hold catches '
     + 'the resonance that only shows itself on one note of the bar. Neither changes '
     + 'the sound or the marking.'],
    ['You are judged on the curve, not the controls.',
     'Two different sets of bands that make the same shape are the same answer - what is '
     + 'compared is what comes out.'],
  ],

  /**
   * Open it.
   *
   * The strip is made here rather than handed in, because six bands that can
   * each be anything is what an EQ *is* - it is not a setting an exercise
   * chooses. Everything the round wants doing to it afterwards goes through
   * the lifecycle: setState, setSource, setFault, setTarget.
   */
  open(el, { engine, onChange, source = 'mix' } = {}) {
    const bands = newStrip();
    return new EQPlugin(el, { engine, bands, onChange, source });
  },
};
