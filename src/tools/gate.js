import { AimedPlugin, GATE_FACE } from '../plugins/compressor/aimed.js';

/**
 * The gate, as a thing you open rather than a question you are asked.
 *
 * The ninth tool and the compressor's mirror image. Everything else in this
 * app does something to the loud parts of a signal; this is the one that does
 * something to the quiet parts, and what it is really teaching is that the
 * quiet parts are where the room, the bleed and the noise live - which is to
 * say, where most of what makes a recording sound like a place lives.
 */
export const GATE_TOOL = {
  id: 'gate',
  label: 'Gate',
  blurb: 'What to do with the quiet',

  lede: 'A threshold with the curve the other way up. Hear what a gate keeps '
      + 'and what it throws away, and find the setting that takes the room off '
      + 'a drum without taking the end of the drum with it.',
  advice: 'Find the threshold with the range all the way up, so you can hear what the gate is opening on — then set the range back. A gate shut all the way is a gate you can hear closing, and most of the time what you want is four or five decibels of it rather than silence.',
  help: [
    ['It is the compressor, mirrored.',
     'Same detector, same attack and release, same knee — the only difference is which '
     + 'side of the threshold the curve bends on. A compressor turns the loud parts down; '
     + 'an expander turns the quiet parts further down. A gate is an expander with a steep '
     + 'enough ratio and a deep enough range that "further down" means "gone".'],
    ['The knobs mean the opposite of what they mean next door.',
     'A gate\'s reduction goes up when the signal gets quieter, so its attack is how fast '
     + 'it opens and its release is how fast it closes. Measured here, so the numbers read '
     + 'true: an attack of 1 ms opens in 0.85, 20 ms opens in 16, and a release of 200 ms '
     + 'closes in 200.'],
    ['Range, not silence.',
     'The depth control is the one people leave alone and the one that matters most. A '
     + 'gate closing to nothing is audible as a gate; closing four or five decibels takes '
     + 'the bleed down without announcing itself. The whole skill is choosing how much of '
     + 'the room to keep.'],
    ['Hold and hysteresis are what stop it chattering.',
     'Hold keeps it open for a fixed time after the signal drops, so the release can be '
     + 'fast without cutting tails off. Hysteresis closes it at a lower threshold than it '
     + 'opens at, so something hovering at the line does not flutter — measured, a tone '
     + 'wobbling two decibels across the threshold opens 28 times in two seconds with no '
     + 'hysteresis and once with three decibels of it.'],
    ['Listen to the detector.',
     'The most useful button here and the one nobody finds on a real gate. If it is '
     + 'triggering on the wrong thing you will hear why in a second, and you will almost '
     + 'never work it out from the output.'],
  ],

  open(el, { engine, onChange, source = null } = {}) {
    const settings = { ...GATE_FACE.defaults };
    return new AimedPlugin(el, { engine, settings, onChange, spec: GATE_FACE, source });
  },
};
