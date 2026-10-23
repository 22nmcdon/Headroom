// What a compressor is doing, for somebody using one.
//
// The long version of what lives at the top of src/plugins/compressor/dsp.js.

export const COMP_NOTES = {
  tool: 'compression',
  title: 'Compression',
  sections: [
    {
      heading: 'Three parts, and they are separable',
      body: 'A compressor is a detector, a curve and a smoother. The detector decides how '
        + 'loud the signal is right now. The curve decides how much quieter it should be '
        + 'at that loudness — that is threshold, ratio and knee. The smoother decides how '
        + 'fast to get there and how fast to come back, which is attack and release.\n\n'
        + 'Almost every confusing thing a compressor does is one of those three being '
        + 'blamed for another. A ratio that seems not to work is usually a threshold that '
        + 'nothing reaches; an attack that sounds wrong is usually a detector watching '
        + 'the wrong thing.',
    },
    {
      heading: 'The sidechain filter is the control nobody touches',
      body: 'The detector does not have to listen to the same signal you are compressing. '
        + 'Roll the bass off what it hears and the kick stops pulling the whole mix down '
        + 'every bar, while the compressor still works on the full-range signal.\n\n'
        + 'It is the same filter every engineer reaches for and it is usually hidden two '
        + 'menus deep. Here it is on the front.',
    },
    {
      heading: 'Peak and RMS are two different questions',
      body: 'A peak detector asks how tall the tallest sample is; an RMS detector asks how '
        + 'much energy went by. A snare is enormous to the first and modest to the second. '
        + 'Which one you pick changes what "over the threshold" even means, and it is why '
        + 'two compressors set to identical numbers can behave nothing alike.',
    },
    {
      heading: 'Why this is not the browser’s compressor',
      body: 'Web Audio ships a compressor node and this does not use it. That node cannot '
        + 'be fed a sidechain, has no RMS detector and no lookahead, its release curve is '
        + 'not the one written on it, and it applies a makeup gain of its own that lives '
        + 'in the implementation rather than in the arithmetic.\n\n'
        + 'A tool whose subject is compression cannot be built on a box whose behaviour '
        + 'has to be reverse-engineered. So the detector, the curve and the smoother are '
        + 'written out here, and the same code makes the sound, reads your settings and '
        + 'runs in the tests — which is the only way the three can be held to agree.',
    },
  ],
};
