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
      heading: 'Normalisation, and why the loudness war is over',
      body: 'Every service a record is played on measures its loudness and applies a gain '
        + 'so that it plays at the same level as everything else. Spotify normalises to '
        + '-14 LUFS; Apple\'s Sound Check is reported at -16; YouTube and the rest are '
        + 'around -14 too. A master delivered at -8 LUFS is not played at -8. It is turned '
        + 'down six decibels and played at -14, exactly like a master that arrived at -14.\n\n'
        + 'So the thing people spent twenty years fighting over cannot be won any more. '
        + 'What a loud master buys you is not loudness — the service takes that straight '
        + 'back — it is everything it spent getting there. Normalisation is a gain, and a '
        + 'gain moves the peak and the loudness together, so the gap between them survives '
        + 'untouched. The squashed master and the open one play at the same volume and the '
        + 'squashed one is flatter. That is the whole trade, and it is now a trade with '
        + 'nothing on one side of it.\n\n'
        + 'There are two real exceptions and both are worth knowing. Some services only '
        + 'turn things down — a master quieter than their target is simply left quiet next '
        + 'to everything else, and that is loudness given away for nothing. And a service '
        + 'that turns a quiet master UP takes its true peak up with it: six decibels of '
        + 'lift on a master peaking at -1 dBTP puts the waveform five decibels over full '
        + 'scale, which is why the ones that do it have a limiter of their own in the way.',
    },
    {
      heading: 'What a delivery spec actually asks for',
      body: 'Two numbers, and they are different kinds of number. The loudness is a target '
        + 'to land on — and at a normalising service it barely matters, because they are '
        + 'going to move you to it anyway. The true-peak ceiling is a limit, and it is the '
        + 'one that is really being asked of you: it is there so that what happens after '
        + 'you — the encode, the conversion, the gain the service applies — does not end '
        + 'up over full scale.\n\n'
        + 'Spotify\'s is conditional and worth copying exactly: keep the true peak under '
        + '-1 dBTP, and under -2 if the master is louder than -14 LUFS. The reasoning is '
        + 'the arithmetic above. A loud master is about to be turned down and then encoded, '
        + 'and a lossy encoder reconstructs a waveform the samples only imply, which can '
        + 'overshoot where the samples did not.\n\n'
        + 'Broadcast works the other way round. EBU R 128 asks for -23 LUFS with a -1 dBTP '
        + 'ceiling and expects the file to arrive on the number rather than be moved to '
        + 'it, which is why it has a tolerance and the streaming services do not. For most '
        + 'material that is reached by turning down rather than by limiting at all.',
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
