// What a limiter is, for somebody using one.
//
// The long version of what lives at the top of src/lib/limiter.js and
// src/plugins/limiter/ceiling.js.

export const CEIL_NOTES = {
  tool: 'limiter',
  title: 'Limiting and loudness',
  sections: [
    {
      heading: 'A ceiling is a promise, and that is what makes it different',
      body: 'A compressor has a knee and a ratio. It starts working gently as the signal '
        + 'approaches the threshold, and even well past it a ratio of twenty still lets '
        + 'one part in twenty through. Which is fine — being gentle about it is the whole '
        + 'point of a compressor — and useless if what you need is a guarantee.\n\n'
        + 'A limiter guarantees. It does it by looking ahead: the audio is delayed by a few '
        + 'milliseconds, the gain each sample is going to need is worked out before that '
        + 'sample comes out, and the smallest of those gains is held across the window. So '
        + 'the gain is already down by the time the peak arrives, rather than starting to '
        + 'come down when it hears it.\n\n'
        + 'The difference is not academic. The safety limiter in this app used to be a '
        + 'compressor at a ratio of twenty with a three-millisecond attack, which is the '
        + 'standard way of faking one. Measured, it let drum transients out 2.9 dB above '
        + 'its own ceiling — anything faster than three milliseconds was past before the '
        + 'gain had moved.',
    },
    {
      heading: 'The drive is the threshold, and under the knee it is a volume knob',
      body: 'There is no threshold control on a limiter, because the ceiling is the '
        + 'threshold. The only way to ask for more limiting is to send more signal in, '
        + 'which is what the drive does — and what every mastering limiter\'s input, drive '
        + 'or gain control does, whatever it is called.\n\n'
        + 'Which means the first stretch of the drive\'s travel does nothing but turn the '
        + 'music up. If the loudest moment in your mix sits six decibels under the ceiling, '
        + 'the first six decibels of drive are a volume knob: the loudness rises decibel '
        + 'for decibel and the peak-to-loudness ratio does not move. That is worth knowing '
        + 'because it is where people think they are mastering and are not.\n\n'
        + 'And where that stretch ends is not a property of the limiter. It is wherever '
        + 'your material happened to peak, which is why two mixes need different drive '
        + 'settings for the same amount of work.',
    },
    {
      heading: 'What loudness costs, in the only currency there is',
      body: 'Past that point the trade starts, and it is a real trade rather than a figure '
        + 'of speech. Peak-to-loudness ratio — the gap between the average level and the '
        + 'loudest moment — is what a limiter spends. Once the peak is pinned at the '
        + 'ceiling it cannot rise, so every decibel of loudness you gain comes out of that '
        + 'gap.\n\n'
        + 'Measured on the loop in this tool, which starts with nearly fourteen decibels '
        + 'of PLR to give away: nine decibels of drive past the knee buy six decibels of '
        + 'loudness and spend six and a half decibels of PLR. The next six decibels of '
        + 'drive buy nothing at all — the output is already a wall at the ceiling — and '
        + 'cost six more decibels of gain reduction for the privilege.\n\n'
        + 'That shape is the whole lesson. There is a stretch where limiting is nearly '
        + 'free, a stretch where it is an honest exchange, and a stretch where it is only '
        + 'destruction. Nobody can tell you where on that curve your music should sit, but '
        + 'you can see which part of it you are on.',
    },
    {
      heading: 'Level-matched bypass, or you are testing the wrong thing',
      body: 'A limiter makes things louder. Louder sounds better — reliably, measurably, '
        + 'to everybody, and a decibel is enough to swing it. So an A/B between limited and '
        + 'unlimited is an A/B about level, and it will tell you the limiter helped no '
        + 'matter what the limiter did.\n\n'
        + 'The fix is the one mastering engineers have used for decades: turn the limited '
        + 'side down until the two are the same loudness, then compare. That is what the '
        + 'output trim and the Match button here are for. Match measures the two sides and '
        + 'sets the trim so they are within a twentieth of a decibel of each other, and '
        + 'from then on anything you can hear is the limiting.\n\n'
        + 'Almost always, what you hear once the level is matched is that the limited '
        + 'version is smaller. That is the correct and useful discovery.',
    },
    {
      heading: 'Sample peak and true peak',
      body: 'The samples in a file are points on a waveform, not the waveform. Between two '
        + 'samples that both sit under the ceiling, the curve they describe can go over it, '
        + 'and it will as soon as anything reconstructs that curve — a converter on the way '
        + 'to a speaker, or an encoder on the way to a streaming service.\n\n'
        + 'A limiter watching only the samples is a perfectly good ceiling for a converter '
        + 'and not a ceiling at all for an encoder. Measured here, with the ceiling asked '
        + 'to hold −1: on the drum loop the waveform came out 0.9 dB above full scale, on a '
        + 'square wave 1.9 dB, on noise 3.5 dB. In true-peak mode the same material comes '
        + 'out at −1.000.\n\n'
        + 'The cost is arithmetic: true-peak detection reconstructs the waveform at four '
        + 'times the sample rate on every sample, which is why the sketchpad\'s own safety '
        + 'limiter does not bother — nothing is downstream of it but your speakers. A '
        + 'master is a different job, so the default here is the other way round.',
    },
    {
      heading: 'The release, and why down is instant',
      body: 'A limiter\'s gain goes down immediately and comes back slowly, and the '
        + 'asymmetry is not a choice. Down is already paid for: the lookahead has made room '
        + 'for it, so the gain can be where it needs to be before the peak lands, with no '
        + 'attack time to speak of. Up is where the taste is.\n\n'
        + 'A fast release comes all the way back between the hits, so the gain is moving '
        + 'with every transient. That keeps the quiet parts where they were and makes the '
        + 'loud parts work for their living, and taken too far it is what pumping is. A '
        + 'slow release never comes back at all between hits, so it holds the whole passage '
        + 'down behind one loud moment — which sounds smoother and quietly throws away '
        + 'everything that happened in the meantime.\n\n'
        + 'Measured at a fixed six decibels of deepest reduction, the gain between hits '
        + 'reads essentially zero at a 10 ms release and three and a half decibels at 500. '
        + 'Same reduction on the meter, completely different thing being done to the music.',
    },
  ],
};
