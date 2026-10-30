import { ModulationPlugin } from '../plugins/modulation/plugin.js';
import { MOD_DEFAULTS } from '../plugins/modulation/dsp.js';

/**
 * The modulation suite, as a thing you open rather than a question.
 *
 * The twelfth tool and the one that is six tools, which is the point of it.
 * Chorus, flanger, vibrato, phaser, tremolo and auto-pan are sold as six
 * pedals and are one oscillator wired to one of three places, and somebody
 * who has understood that can set all six from first principles instead of
 * learning six panels.
 *
 * It also pays a debt the delay left: the wander on a tape echo is this same
 * oscillator at this same job, which is why a flanger and a sick transport
 * sound like relatives.
 */
export const MODULATION_TOOL = {
  id: 'modulation',
  label: 'Modulation',
  blurb: 'One oscillator, six pedals',

  lede: 'Something slow moving something fast. Hear what the same oscillator '
      + 'does at a delay time, at an all-pass corner and at a gain, and learn '
      + 'to tell the six apart and to name what they are doing by ear.',
  advice: 'Find the rate before the depth. Rate is a tempo question and you can count it; depth is a taste question and there is no counting it, which is why everybody sets it too high.',
  help: [
    ['Six effects, three wires.',
     'A low-frequency oscillator at a delay time with the dry signal still there is a '
     + 'chorus at fourteen milliseconds and a flanger at three. The same oscillator at the '
     + 'same place with the dry signal gone is vibrato. At the corner of a chain of '
     + 'all-passes it is a phaser. At a gain it is tremolo, and at two gains pulling '
     + 'opposite ways it is an auto-pan. That is the whole table.'],
    ['Why fourteen milliseconds is a chorus and three is a flanger.',
     'Two copies of a signal t apart comb-filter each other: cancelling at 1/2t and every '
     + 'odd multiple, reinforcing halfway between. At fourteen milliseconds the first '
     + 'notch is at 36 Hz and the teeth are 71 Hz apart - too fine to hear as a filter, so '
     + 'what you get is thickening and detune. At three the first notch is at 167 Hz and '
     + 'the teeth are 333 apart, which is coarse enough to have a pitch, and sweeping that '
     + 'pitch is the flanger sound. Measured here on a frozen flanger: notches at 167, '
     + '500, 833, 1167 and 1500 Hz, which is the formula exactly.'],
    ['A phaser is not a flanger.',
     'A comb has teeth all the way up and they are evenly spaced in hertz. A phaser has as '
     + 'many notches as it has pairs of all-pass stages - six stages, three notches - and '
     + 'they are spread out in frequency rather than evenly spaced. Measured with the '
     + 'corner at 670 Hz: notches at 180, 669 and 2480. That is why a flanger sounds '
     + 'metallic and a phaser sounds like a filter sweeping.'],
    ['Feedback is the character, not the depth.',
     'On a flanger and a phaser the feedback sharpens what is already there, and which way '
     + 'round it is wired changes which part gets sharpened. Measured on a flanger at '
     + 'three milliseconds, with the first notch at 167 Hz and the first peak at 333: at '
     + '+0.8 the peak goes up nine decibels and the notch stays a notch, and at -0.8 the '
     + 'whole comb moves - what was a notch at 167 comes out five decibels up. One '
     + 'whistles, the other is hollow.'],
    ['Rate is a tempo question.',
     'Almost every modulation sounds better in time with the music, which is why the sync '
     + 'menu is there and why the drill asks for the rate as a note value. One cycle per '
     + 'note: on this loop at 96, eighths are 3.2 Hz and sixteenths are 6.4. The depth is '
     + 'the other half and there is no counting it - a quarter is usually plenty, and '
     + 'everybody who has just bought a chorus sets it to a half.'],
  ],

  open(el, { engine, onChange, source = null } = {}) {
    const settings = { ...MOD_DEFAULTS };
    return new ModulationPlugin(el, {
      engine, settings, onChange, source,
    });
  },
};
