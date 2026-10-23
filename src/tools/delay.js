import { EchoPlugin } from '../plugins/delay/plugin.js';
import { ECHO_DEFAULTS } from '../plugins/delay/line.js';

/**
 * The delay, as a thing you open rather than a question you are asked.
 *
 * This half used to be a `mount(el, { puzzle })` inside the exercise, which
 * meant a tool could not exist without a round to justify it - and that a
 * change of exercise tore the plugin down, stopped the audio, and built
 * another one. Here the tool knows nothing about a puzzle, an answer or a
 * tier. It opens, it runs, and an exercise is something that arrives later.
 */
export const DELAY_TOOL = {
  id: 'delay',
  label: 'Delay',
  blurb: 'Lock the repeats',

  lede: 'A delay, and a loop running through it. Build the same one you can '
      + 'hear on the target — or find the time by ear, with nothing telling '
      + 'you the tempo.',
  advice: 'A delay is right when the repeats fall in with the track and wrong when they walk through it. That is the thing to listen for, and it is easier to hear on drums than on anything else.',
  help: [
    ['Play the loop, then set the repeats.',
     'The left panel is the repeats against one bar of the track: left goes up, right '
     + 'goes down, so a ping-pong reads as repeats stepping from one side to the other. '
     + 'The right panel is how the whole thing dies away.'],
    ['Finding the time is the point.',
     'In that exercise there is no tempo readout and no grid, because matching a delay '
     + 'to a record nobody has told you the tempo of is the real version of the job. '
     + 'Listen for the repeats falling in with the track rather than walking through it.'],
    ['The filters are inside the loop.',
     'Tone and low cut are applied to each repeat on its way round again, so they do not '
     + 'darken the delay once - they darken it a little more every time. That is what '
     + 'keeps a long feedback from turning into mud.'],
    ['You are judged on what comes out, not on the knobs.',
     'Two delays that die away the same way are the same delay. Auto gain is on, so more '
     + 'feedback is more repeats rather than more level.'],
  ],

  /** Open it, on its own defaults, with nothing imposed. */
  open(el, { engine, onChange, source = 'instrument' } = {}) {
    const settings = { ...ECHO_DEFAULTS };
    return new EchoPlugin(el, { engine, settings, onChange, source });
  },
};
