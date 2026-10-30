import { LevelPlugin } from '../plugins/level/plugin.js';
import { LEVEL_DEFAULTS } from '../plugins/level/gain.js';

/**
 * The level, as a thing you open rather than a question you are asked.
 *
 * The seventh tool and the one with the least in it: a trim, and the meters
 * that make a trim mean something. There is no DSP here to speak of, which is
 * the point - what is being taught is a comparison, and the apparatus for a
 * comparison is a loop, two levels and an instant flip between them.
 */
export const LEVEL_TOOL = {
  id: 'level',
  label: 'Level',
  blurb: 'Hear a decibel',

  lede: 'A loop, a trim, and a proper loudness meter. Say how far apart two '
      + 'levels are, or put one back where it was - which is the skill every '
      + 'other comparison in mixing quietly depends on.',
  advice: 'Flip between the two often and in short bursts. A level is a comparison, and the moment you hold one of them in your head for more than a second or two you are comparing a memory.',
  help: [
    ['Louder sounds better, and that is the problem.',
     'Two settings of anything, at two different levels, will always seem to favour the '
     + 'louder one — a decibel is enough to swing it. So every A/B anybody makes about EQ '
     + 'or compression is partly an A/B about level, unless they took the level out first. '
     + 'That is why this is the first thing on the list rather than the last.'],
    ['The meters are the instrument here.',
     'Left is where the loudness sits: the long bar is the whole loop averaged the way a '
     + 'streaming service averages it, the short one is the last three seconds, and the '
     + 'line across is the true peak. Right is the same short-term reading over time, '
     + 'which is the half a single number cannot show.'],
    ['LUFS, not peaks.',
     'A peak meter says how close you are to the ceiling; it says almost nothing about how '
     + 'loud something sounds. The loudness reading here is ITU-R BS.1770 — frequency '
     + 'weighted, averaged over 400 ms blocks, with the quiet ones thrown out — which is '
     + 'what every delivery spec in the world is written in.'],
    ['You are judged on the output, not the knob.',
     'The trim is read off the audio that came out of it. If you got there by a route '
     + 'nobody expected and the level is right, the level is right.'],
  ],

  /** Open it, on its own defaults, with nothing imposed. */
  open(el, { engine, onChange, source = 'mix' } = {}) {
    const settings = { ...LEVEL_DEFAULTS };
    return new LevelPlugin(el, { engine, settings, onChange, source });
  },
};
