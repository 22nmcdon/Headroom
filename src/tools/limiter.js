import { LimiterPlugin } from '../plugins/limiter/plugin.js';
import { CEIL_DEFAULTS } from '../plugins/limiter/ceiling.js';

/**
 * The ceiling, as a thing you open rather than a question you are asked.
 *
 * The eighth tool, and the last one in the chain in both senses: it is what
 * goes on the end of a master, and it is the one whose lesson is about
 * knowing when to stop. Everything else here teaches a judgement about sound.
 * This one teaches a judgement about cost.
 */
export const LIMITER_TOOL = {
  id: 'limiter',
  label: 'Limiter',
  blurb: 'Loud, and what it cost',

  lede: 'A brickwall ceiling with something to push into it. Hear how much '
      + 'loudness a limiter can buy, see what it spends to buy it, and find '
      + 'the point where the next decibel is no longer worth having.',
  advice: 'Match the level before you judge anything. A limiter makes things louder and louder sounds better, so until the two sides are the same loudness you are not hearing the limiter at all — you are hearing the volume.',
  help: [
    ['A limiter is not a compressor turned up.',
     'A compressor has a knee and a ratio and lets things through; a limiter has a '
     + 'lookahead and a guarantee. It delays the signal by a few milliseconds so the gain '
     + 'can be moved before the peak it is for arrives, which is what makes the ceiling a '
     + 'promise rather than a target. The node this replaced was a compressor at a high '
     + 'ratio and it let transient material out 2.9 dB over its own ceiling.'],
    ['The drive is the threshold.',
     'A limiter\'s threshold IS its ceiling, so the only way to ask for more of it is to '
     + 'send more in. That is what every mastering limiter\'s input or drive control does. '
     + 'Below the point where the material\'s own peak reaches the ceiling, the drive is a '
     + 'volume knob and nothing else — the loudness follows it decibel for decibel and the '
     + 'peak-to-loudness ratio does not move at all.'],
    ['Watch the PLR, not the loudness.',
     'Peak-to-loudness ratio is how much room the music keeps between its average and its '
     + 'loudest moment. Once the ceiling is holding, every decibel of loudness you gain is '
     + 'a decibel of PLR you spend, and the exchange gets worse as you go: measured on the '
     + 'loop here, the last six decibels of drive buy nothing at all and cost six more '
     + 'decibels of reduction.'],
    ['True peak, because something downstream will reconstruct the waveform.',
     'The samples are points on a curve, not the curve. A ceiling held on the samples lets '
     + 'the curve between them go over — measured on this material, 0.9 dB over full scale '
     + 'with the ceiling set to −1, and 3.5 dB over on noise. The true-peak mode holds the '
     + 'curve itself, which is what an encoder sees. The sample mode is here so you can '
     + 'hear what the difference is worth.'],
    ['You are judged on the reduction, not the knob.',
     'The reading is how much the ceiling took off over the loop, framed at five '
     + 'milliseconds — the same reading, on the same axis, that the compressor is marked '
     + 'on. Two routes to the same reduction are the same answer.'],
  ],

  /** Open it, on its own defaults, with nothing imposed. */
  open(el, { engine, onChange, source = 'mix' } = {}) {
    const settings = { ...CEIL_DEFAULTS };
    return new LimiterPlugin(el, { engine, settings, onChange, source });
  },
};
