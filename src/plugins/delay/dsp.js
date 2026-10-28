import { makeBiquad, setBiquad, runBiquad } from '../../lib/dsp.js';

// One delay, as arithmetic.
//
// What a delay is, for somebody using one, is in src/learn/notes/echo.js.
//
// Split out of `line.js` because the audio thread now needs it. A delay that
// only ever stood still could be written down as an impulse response and
// convolved, and for a long time this one was: linear, so everything it will
// ever do to anything is in what it does to one click. Wow and flutter end
// that. A response says "a click in, these repeats out" once and for all,
// and convolving with it puts the same displacement under every input sample
// - so a tape that wanders would come out detuned by a fixed amount instead
// of wandering. The modulation has to happen while the audio is going past.
//
// So this is the loop itself, and it is run two ways: by a worklet on the
// audio thread, and by `makeEcho` offline to get the response that is drawn
// and marked. One implementation, so what you hear is what you are scored
// on - the same arrangement the compressor has.
//
// One caveat on "a delay is linear", which is the claim the drawings and the
// marks rest on. It is exactly true of every response this app builds, because
// those are built from a unity click and the loudest sample in one is that
// click itself. It stops being true of loud sustained material, because the
// loop has a ceiling now - it has to, or a feedback over unity would have
// nowhere to stop. A sustained input builds to `level / (1 - feedback)` round
// the loop, so at the feedback this opens on the loop is exactly linear up to
// six tenths of full scale and at the old cap of 0.8 it bends from four
// tenths. What that costs is that a drawing understates how a loud, heavily
// fed-back delay compresses; what it buys is that such a delay stops getting
// louder, and that a delay can be made to howl at all.

/** Every knob, and where it starts. */
export const ECHO_DEFAULTS = {
  time: 375,         // ms between repeats
  feedback: 0.35,    // how much of each repeat goes round again
  tone: 6000,        // the low-pass inside the loop: repeats get darker
  lowCut: 120,       // the high-pass inside it: repeats get thinner
  pingPong: false,   // repeats alternating ears
  pingPongFrom: 'left', // which ear they start in
  offset: 0,         // ms the right side is behind the left, or in front of it
  heads: 'single',   // how many places the line is read from
  diffusion: 0,      // how smeared each pass is, 0 to 1
  machine: 'digital', // what the repeats are stored on
  wow: 0,            // slow pitch wander, in cents of peak deviation
  flutter: 0,        // fast pitch wander, the same way
  change: 'repitch', // what it does to what is already in the line when the time moves
  mix: 0.3,
};

/**
 * The all-passes diffusion is made of, as fractions of the loop.
 *
 * Three Schroeder all-passes, `y[n] = -a*x[n] + x[n-M] + a*y[n-M]`, in the
 * feedback path. Each one passes everything and delays it by frequency, so a
 * sharp repeat comes back as a short burst of itself - and because they are
 * in the loop, every pass is smeared once more than the one before. That
 * progression is the whole point: it is the road from an echo to a room, and
 * it is the only control here that crosses it.
 *
 * Fractions of the loop rather than fixed milliseconds, for two reasons. The
 * shortest delay on offer is twenty milliseconds and a fixed three-stage
 * chain in the range this wants - three to fifteen milliseconds a stage - is
 * longer than the whole loop. And measuring in fractions is what the loop
 * reading does, so diffusion looks the same to it at every time.
 *
 * Not round numbers, and not multiples of each other: all-passes at related
 * delays ring together and what should be a smear comes out as a pitch.
 *
 * Measured at 400 ms and 0.6 feedback, the middle ninety per cent of each
 * pass's energy, and where its centre of gravity sits:
 *
 *     diffusion   pass 1   pass 2   pass 3     centres
 *     0             0 ms     0 ms     0 ms     400 / 800 / 1200 ms
 *     0.5           0 ms    30 ms    68 ms     400 / 800 / 1200
 *     1             0 ms    80 ms   156 ms     400 / 800 / 1200
 *
 * Each pass wider than the last and every centre exactly on its slot. The
 * centres staying put is what shortening the line buys: without it the
 * repeats would drag later with every pass and a diffusion knob would be a
 * time knob wearing the wrong label.
 *
 * And the loop reading sees it, which is what makes it markable - 5.65 dB for
 * a tenth of diffusion against none, 15.86 for all of it, and about 5 dB
 * between adjacent quarters. Against the 6 dB the hard tier allows, that
 * resolves diffusion to roughly a third of its travel, which is about what
 * anybody can hear of it.
 */
export const DIFFUSE_AT = [0.0371, 0.0241, 0.0167];

/** The coefficient at the top of the knob. */
export const MOST_DIFFUSE = 0.7;

/**
 * The machines a delay can be, and what each one does to the tone.
 *
 * The one thing that tells these apart by ear is not how dark they are but
 * how their darkness moves with the time, so that is what is modelled and
 * the rest is left alone. A digital delay has the same bandwidth at every
 * setting. The other two do not, and for different reasons.
 *
 * A bucket brigade is a line of buckets clocked along, and the delay is the
 * number of stages over twice the clock - Raffel and Smith, DAFx-10. So the
 * clock is `N / 2*tau`, and a longer delay means a slower clock, which has
 * to be band-limited further down to keep its own sampling out of the audio.
 * A 4096-stage chip at 300 ms wants a 6,827 Hz clock and so a signal band-
 * limited to 3,413; the anti-alias and reconstruction filters in a real pedal
 * sit between a third and a half of the clock, which is where the corner
 * below comes from. Longer delay, darker repeats - the exact opposite of a
 * digital delay, and the tell.
 *
 * Tape with a fixed head and a variable speed is the same shape of story from
 * different physics. Every loss term on the playback side scales with
 * `k = 2*pi*f / v` (Chowdhury, DAFx-19), so halving the speed halves the
 * frequency everything happens at - and with the heads a fixed distance
 * apart, a longer delay is a slower tape. One constant in hertz-seconds
 * carries that, rather than four parameters whose values would be invented.
 * The head bump comes along with it: a head is a loop of wire that responds
 * where the wavelength on the tape matches it, so that moves with the speed
 * too, and it is what makes tape warm rather than only dark.
 *
 * Behavioural and not physical, on purpose. CHOW Tape solves a hysteresis ODE
 * at sixteen times oversampling; none of that is identifiable by ear once it
 * is inside an echo, and this runs in a browser on a phone.
 *
 * Marked by the reading that was already there, with no scoring change: the
 * decay curve reads three bands over time, and a machine that takes the top
 * off shows up in the top one. Measured, with the tolerances that decide a
 * pass being 2.6, 1.9 and 1.2 dB:
 *
 *     at 200 ms   digital vs tape   2.17 dB   digital vs bbd    4.87   tape vs bbd    4.47
 *     at 400 ms                     2.85                       12.33                 10.52
 *     at 800 ms                     6.32                       17.11                 11.37
 *
 * Further apart the longer the delay, which is the whole point of the model
 * rather than a convenience. The one weak pair is digital against tape at
 * 200 ms, which at 2.17 dB would pass the easy tier - and that is honest,
 * because a 200 ms tape delay is not very dark.
 */
export const MACHINES = [
  { id: 'digital', label: 'Digital' },
  { id: 'tape', label: 'Tape' },
  { id: 'bbd', label: 'Bucket brigade' },
];

/** The stages in the chip this is modelled on, an MN3005. */
export const BBD_STAGES = 4096;

/** Where the pedal's own filters sit, as a fraction of the clock. */
export const BBD_AT = 0.4;

/**
 * Tape's corner, in hertz-seconds.
 *
 * At 375 ms this puts it at 6 kHz, which is about where a worn quarter-inch
 * loop at a few inches a second gives out. Divided by the time, so half the
 * speed is half the corner.
 */
export const TAPE_AT = 2250;

/**
 * And its head bump: where, in hertz-seconds, how much, and how far it may go.
 *
 * Its own range, which is the bug this comment exists for. The corner's clamp
 * runs from 1500 Hz up, and reusing it here pinned the bump at 1500 at every
 * delay - a peak in the middle of the midrange wearing the name of something
 * that lives two octaves below it. A head bump is tens of hertz, so it gets
 * tens of hertz.
 */
export const TAPE_BUMP_AT = 45;
export const TAPE_BUMP_DB = 2.5;
export const BUMP_FLOOR = 35;
export const BUMP_CEILING = 160;

/**
 * The tone the medium's makeup is referenced to, in hertz.
 *
 * Three hundred: under the 1500 Hz floor the corner has, so it is always on
 * the flat part of the response, and well above the head bump's ceiling so
 * the bump is not what is being levelled.
 */
export const MEDIUM_REF = 300;

/** As dark and as bright as any machine is allowed to get. */
export const MACHINE_FLOOR = 1500;
export const MACHINE_CEILING = 18000;

/**
 * What a machine does to the tone at a given delay, or null for none.
 *
 * `stages` is how many cascaded low-passes it takes. Two for a bucket
 * brigade, because a pedal has an anti-alias filter going in and a
 * reconstruction filter coming out and the pair of them is steep; one for
 * tape, whose losses roll off gently. Cascaded rather than a designed
 * Butterworth: `setBiquad` holds Q at root-half, so two of them put the
 * corner 6 dB down rather than 3 - which is nearer what a cascade of
 * Sallen-Key stages in a real pedal does than a textbook fourth-order would
 * be, and the model is behavioural anyway.
 */
export function machineTone(id, ms) {
  const seconds = Math.max(ms, 1) / 1000;

  if (id === 'bbd') {
    const clock = BBD_STAGES / (2 * seconds);
    const corner = Math.min(MACHINE_CEILING, Math.max(MACHINE_FLOOR, clock * BBD_AT));
    return { corner, stages: 2, bump: 0, bumpAt: 0, clock };
  }

  if (id === 'tape') {
    return {
      corner: Math.min(MACHINE_CEILING, Math.max(MACHINE_FLOOR, TAPE_AT / seconds)),
      stages: 1,
      bump: TAPE_BUMP_DB,
      bumpAt: Math.min(BUMP_CEILING, Math.max(BUMP_FLOOR, TAPE_BUMP_AT / seconds)),
      clock: 0,
    };
  }

  return null;
}

/**
 * Wow and flutter: the two speeds at which a transport fails to hold time.
 *
 * The split is a standard, not a taste. IEC and DIN put the line at about
 * 6 Hz: a speed error slower than that is wow, faster is flutter, and they
 * are quoted separately because they are two different faults of two
 * different parts - wow is the capstan and the reels, flutter is the guides
 * and the tape rubbing past them. They are also two different sounds. Wow is
 * a pitch you can follow going up and down; flutter is a roughness on the
 * note that you cannot. So they are two controls, which is what a tape
 * machine's spec sheet has had for sixty years.
 *
 * Not round numbers and not a ratio of each other, for the same reason the
 * all-passes are not: periodic modulations at related rates line up every so
 * often and the sum has a beat in it that neither one has.
 */
export const WOW_RATE = 0.55;
export const FLUTTER_RATE = 7.9;

/**
 * And how far each may go, in cents of peak pitch deviation.
 *
 * Cents rather than per cent of speed, rather than milliseconds, and the
 * choice is worth the paragraph because all three are defensible and only one
 * of them is useful.
 *
 * A spec sheet quotes speed deviation: 0.1 per cent weighted RMS is a good
 * machine. The honest physical model of it is not a knob though, because what
 * you hear is not the speed error but the difference between the speed the
 * tape was recorded at and the speed it is played back at - which for a
 * deviation at rate `f` across a gap of `tau` comes out as `2*d*sin(pi*f*tau)`
 * (take v(t)/v(t-tau) for v = v0*(1 + d*sin), and the difference of two sines
 * is twice the sine of half their difference). That saturates: a slapback on a
 * wandering machine is steady and a long echo on the same machine warbles,
 * because at 20 ms the tape has not had time to be anywhere else and at a
 * second it has. True, audible, and no use on a control - the same number
 * would mean six cents at one setting and one at another, so a wow knob would
 * be unmarkable at every delay time but one.
 *
 * Milliseconds of displacement has the opposite problem and worse: pitch
 * deviation is displacement times rate, so a millisecond of wow and a
 * millisecond of flutter are fourteen times apart by ear.
 *
 * So the knob is the thing you hear - peak pitch deviation - and the
 * displacement is worked back out of it. Equal numbers sound equally deep
 * whatever the time and whichever of the two it is, which is what makes
 * either of them a question anybody can be asked. It is the same choice the
 * machine model makes two hundred lines up, and for the same reason:
 * behavioural, not physical, on purpose.
 *
 * The tops are set where the thing stops being a tape machine and starts
 * being a chorus. Real tape echo runs five to ten cents; fifty is a sick
 * transport, and past that the repeats are a different instrument.
 */
export const MOST_WOW = 50;
export const MOST_FLUTTER = 25;

/**
 * How much of the line the wander may use, less a few samples for the
 * interpolator's elbows.
 *
 * Fifty cents at 0.55 Hz wants ten milliseconds of displacement, which is
 * half of the shortest delay this offers - so at short times the line itself
 * is the limit, as it is on a tape loop.
 *
 * A quarter and not a half, because a line dragged to half its length is not
 * the delay the knob says it is any more. The two depths share the one
 * allowance rather than each getting it, since they are added together before
 * the line is read and it is their sum that has to fit. So asking for
 * everything at once at a short time gets both scaled back together - at
 * 20 ms on one head, 50 and 25 come out as 26.5 and 13.2.
 */
export const WANDER_SHARE = 0.25;

/**
 * And how close to the write head a wandering read may come, in samples.
 *
 * Three, which is what the interpolator needs: it reads one sample behind its
 * target and two in front, so a read three samples back from where the line
 * is being written still touches only what has been written.
 *
 * The depth is held against whichever head is nearest the write head, since
 * that is the one a deep enough wander would carry past it and into whatever
 * was there a loop ago. Measured off the core - asked for fifty cents of wow,
 * the most it will actually give:
 *
 *     time      one head   three heads   four heads
 *      20 ms      27.4 c       27.4 c       27.4 c
 *      30 ms      40.9         40.9         40.9
 *      40 ms      50.0         50.0         50.0
 *     375 ms      50.0         50.0         50.0
 *
 * The head pattern used to cost a quarter of the depth at the bottom of the
 * range - four heads at 20 ms got 20.1 cents where one got 27.4 - and it no
 * longer costs anything. That is the lag buffer's removal: the output used to
 * be read at the shortened line and delayed again, so every head sat closer to
 * the write head by what the all-passes hold. Read at the whole length
 * instead, the nearest head is further away than the line's own quarter, so
 * the line is the only thing left limiting it.
 *
 * Which leaves this a guard rather than a character: nothing is held back at
 * all above forty milliseconds, and flutter - whose displacement is fourteen
 * times smaller for the same pitch - is never held back anywhere.
 */
export const WANDER_EDGE = 3;

/**
 * What a delay does to the sound already in its line when the time moves.
 *
 * Three answers, and every delay ever built gives one of them. The question
 * only exists while the knob is moving, which is why it took until now to
 * notice that this one was answering it with a click: measured, moving the
 * time from 375 ms to 250 made the output jump 1.52 in a single sample, where
 * a 440 Hz tone at full scale moves 0.06. At 375 to 120 it jumped 2.81. Every
 * step of a drag, on every insert.
 *
 *     from -> to      the worst step between two samples
 *     375 -> 375      0.11      (two tones summing, not a discontinuity)
 *     375 -> 250      1.52
 *     375 -> 500      2.31
 *     375 -> 120      2.81
 *     250 -> 1000     1.82
 *
 * `repitch` is what a transport does, because it has no choice: the tape is
 * already recorded and playing it at a new speed is the only thing a new
 * speed can mean. The read head glides to its new place and what is in the
 * line bends as it goes. A bucket brigade does the same thing for the same
 * reason - the clock is the speed.
 *
 * `fade` is what most digital delays do: hold the old read head, start a new
 * one, and cross from one to the other too fast to follow. Nothing bends, and
 * for a moment you hear both.
 *
 * `jump` is the one this had by accident. Some hardware really does it, and
 * on small moves it is inaudible, which is why it survived - a drag is a
 * hundred small moves and each of them clicks.
 */
export const CHANGE_MODES = [
  { id: 'repitch', label: 'Repitch' },
  { id: 'fade', label: 'Fade' },
  { id: 'jump', label: 'Jump' },
];

/**
 * How fast a repitching head glides, and how far it is allowed to bend.
 *
 * A time constant rather than a speed, because a capstan has inertia: a big
 * change dives hard and settles, which is the sound of the thing. And a cap
 * on the bend, because the exponential's first sample of a large move asks
 * for a pitch nothing mechanical could reach - 375 ms to 250 is six thousand
 * samples of travel, and at this time constant the first sample of it would
 * be a fifth and a half.
 *
 * A third of an octave, which is about what a Space Echo's selector does
 * between neighbouring settings.
 */
export const REPITCH_TIME = 0.18;
export const REPITCH_MOST = 0.26;

/**
 * How long a fading head takes to hand over, in seconds.
 *
 * Thirty milliseconds: long enough that neither end of it is a click, short
 * enough that the pair of heads is a flicker rather than a chorus. Measured
 * against the other two, a 440 Hz tone through one repeat, the time moved by a
 * figure that is not a whole number of its periods:
 *
 *     mode       worst step between samples      pitch           level
 *     repitch              0.0726              400 cents, settling   held
 *     fade                 0.0576                none            dips to 0.27
 *     jump             0.3106 to 0.4257          none              held
 *
 * The tone itself steps 0.0576 a sample, so repitch's figure is that times the
 * 1.26 its bend is capped at - no discontinuity, just a faster wave - and
 * fade's is the tone exactly. Jump's is five to seven times the signal's own
 * slew, which is a click, and that is what this delay did on every step of
 * every drag until these modes existed.
 */
export const FADE_TIME = 0.03;

/**
 * How far past full scale the loop may be driven before the medium gives way.
 *
 * A delay whose feedback is over one is an oscillator, and an oscillator needs
 * something to stop it. Hardware has the medium: tape saturates, a bucket
 * brigade runs out of headroom, and the howl settles at whatever level the
 * medium stops accepting more. Without that, measured with the cap lifted and
 * nothing bounding the loop, the peak out in each of the first five seconds
 * after a fifty millisecond burst:
 *
 *     machine    feedback    1 s    2 s    3 s    4 s    5 s
 *     digital        1.00    0.48   0.48   0.44   0.42   0.40
 *     digital        1.20    0.58   0.94   1.29   2.09   3.40
 *     tape           1.20    0.68   1.52   2.57   5.49  12.38
 *     bbd            1.20    0.58   0.94   1.28   2.09   3.38
 *
 * Still climbing at five seconds and with nowhere to stop.
 *
 * Tape climbs fastest, and that is the model working rather than a fault: its
 * head bump is 2.5 dB of loop gain sitting at a frequency the makeup - which
 * is referenced to 300 Hz - does not take back, so a tape echo howls at its
 * head bump, which is what tape echoes do. And feedback at 1.00 decaying
 * rather than holding is the loop filters: with a 6 kHz low-pass and a 120 Hz
 * high-pass in the path, unity on the knob is under unity round the loop. So
 * where the howling starts depends on how open the tone controls are, which is
 * true of hardware and is the most musical thing about it.
 *
 * The curve is exactly linear to full scale and then bends: `1 + k*tanh(x/k)`
 * past one, which meets the straight line with the same slope as well as the
 * same value, so there is no corner at the join. `k` is both the headroom
 * above full scale and the asymptote, so the loop cannot hold more than 1.4
 * whatever is done to it. Linear below one is what keeps every response this
 * app has drawn bit-identical: the loudest thing in any of them is the
 * impulse's own first sample, which is exactly one and not more than one.
 *
 * On the way in, with the record level, rather than after the medium. A dark
 * medium's makeup gain sits outside the loop and would undo a ceiling placed
 * inside it - a bucket brigade's is 3.8 times at 400 ms, so a loop bounded at
 * 1.4 after the medium would come out at 5.3. Bounded before it, the makeup
 * puts the output back at about the ceiling for every machine, which is what
 * the makeup is for.
 */
export const LOOP_CEILING = 0.4;

/** Which side a ping-pong may be started from. */
export const PING_FROM = ['left', 'right'];

/**
 * The heads a delay can be read with, as fractions of the time on the knob.
 *
 * Fractions and not multiples, so the knob always means the longest repeat.
 * Multiples would put the last head of a four-head pattern four times further
 * out than the number on the control, and off the end of the range at
 * anything past a third of it.
 *
 * The feedback is taken from the longest head, so what goes round is the
 * whole pattern rather than one tap of it - which is what a tape loop with
 * three heads on it does.
 *
 * `heads3` is the RE-201's three playback heads. UA's model of the unit gives
 * head ranges of 69-177 ms, 131-337 and 189-489, which is 1 : 1.90 : 2.75 at
 * either end of the sweep; as fractions of the longest that is what these are.
 * The ratio repeated in guides is 1 : 2 : 3, and the hardware is not that -
 * so the measured figures win and the folklore is noted rather than used.
 *
 * `heads4` is Binson's drum: four heads equally spaced around it. With the
 * longest on a quarter note the others land on a sixteenth, an eighth and a
 * dotted eighth, which is where the dotted-eighth guitar idiom came from.
 *
 * What these cannot be is marked, and that is worth saying here rather than
 * discovering while writing an exercise. Read the way a delay guess is read -
 * as an energy decay curve - the patterns are almost the same thing:
 *
 *                 single    heads3    heads4
 *     single        0.00      1.16      1.32
 *     heads3        1.16      0.00      0.45
 *     heads4        1.32      0.45      0.00
 *
 * The tolerances that decide a pass are 2.6, 1.9 and 1.2 dB, so three heads
 * against four is a hit at every tier and one head against four is a hit at
 * two of the three. A decay curve says how the energy falls away and adding
 * earlier heads barely changes that - they fill in between the repeats while
 * the slope stays the feedback's. The positions are in the response and the
 * reading is not looking at them.
 *
 * Worse for an exercise, a time error swamps a pattern error: one head at
 * 300 ms against four at 400 reads 3.76 dB, so somebody could use the wrong
 * pattern and pass by getting the time right.
 *
 * So these are a sound to use and not yet a question to be asked. "Which
 * pattern?" wants a reading that looks at where the repeats are rather than
 * at how the energy goes - which is what `repeatsOf` below already describes,
 * and what diffusion would need too.
 */
export const HEAD_PATTERNS = [
  { id: 'single', label: 'One head', taps: [1] },
  { id: 'heads3', label: 'Three heads', taps: [1 / 2.75, 1.9 / 2.75, 1] },
  { id: 'heads4', label: 'Four heads', taps: [0.25, 0.5, 0.75, 1] },
];

/** One pattern, by id, and one head for anything that is not a pattern. */
export function headsOf(id) {
  return HEAD_PATTERNS.find((pattern) => pattern.id === id) ?? HEAD_PATTERNS[0];
}

/** As long as a repeat may be, and as much of it as may go round again. */
export const LONGEST_TIME = 1500;
export const SHORTEST_TIME = 20;
/**
 * As much of each repeat as may go round again.
 *
 * Past unity, which is the point: a delay whose feedback is over one is an
 * oscillator, and a tape echo ridden into howling is one of the sounds the
 * device is for. It was 0.8, which is as far as you can go while a response is
 * still something that dies away on its own.
 *
 * What stops it is LOOP_CEILING below, not this. Where the howling actually
 * starts depends on the loop filters as well as this knob - with the defaults
 * in the path, unity on the knob still decays - which is true of hardware too.
 */
export const MOST_FEEDBACK = 1.2;

/**
 * How far the two sides may be pulled apart, in milliseconds.
 *
 * A hundred and fifty covers both things an offset is for. Under about thirty
 * the two sides fuse and what you hear is width rather than two echoes - the
 * precedence effect, whose threshold is five to ten milliseconds on clicks
 * and nearer fifty on music, which is why this tool's beds are music. Above
 * that they come apart into two echoes on two sides, and a hundred and fifty
 * against the shortest delay on offer is as far apart as they need to go to
 * be plainly two.
 */
export const MOST_OFFSET = 150;

/**
 * How far each of those may be moved, which is where a plugin's knob ends.
 *
 * Here rather than in the plugin because two things now need it: the plugin,
 * to lay out a slider, and the sketchpad, which stores an insert's settings
 * and has to put a loaded file's numbers back inside the range the processor
 * expects. Two tables would be two tables to keep in step, and the day they
 * drift is the day a saved sketch loads as a different sound.
 */
export const ECHO_LIMITS = {
  time: [SHORTEST_TIME, LONGEST_TIME],
  feedback: [0, MOST_FEEDBACK],
  tone: [500, 20000],
  lowCut: [20, 800],
  offset: [-MOST_OFFSET, MOST_OFFSET],
  diffusion: [0, 1],
  wow: [0, MOST_WOW],
  flutter: [0, MOST_FLUTTER],
  mix: [0, 1],
};

/**
 * The two sides' times, in milliseconds, from one setting.
 *
 * The left is the time on the knob and the right is that plus the offset,
 * clamped back into the range a delay is allowed to be - otherwise a 1500 ms
 * delay with a positive offset would ask for a line longer than anything
 * else in this app renders.
 */
export function sidesOf(settings) {
  const left = Math.min(LONGEST_TIME, Math.max(SHORTEST_TIME, settings.time));
  const offset = Math.min(MOST_OFFSET, Math.max(-MOST_OFFSET, settings.offset ?? 0));
  const right = Math.min(LONGEST_TIME, Math.max(SHORTEST_TIME, left + offset));
  return [left, right];
}

/**
 * A depth in cents, as a displacement in samples.
 *
 * A line read at `tau + A*sin(2*pi*f*t)` is read at a rate of
 * `1 - A*2*pi*f*cos(2*pi*f*t)` samples a sample, so the peak pitch ratio is
 * `1 + A*2*pi*f` and the cents follow. Inverted here, which is all this is.
 */
export function wanderOf(cents, hz, rate) {
  const asked = Math.max(0, cents);
  if (asked <= 0) return 0;
  const ratio = 2 ** (asked / 1200) - 1;
  return (ratio / (2 * Math.PI * hz)) * rate;
}

/** And back the other way, so the depth a line actually allows can be read. */
export function centsOf(samples, hz, rate) {
  if (samples <= 0) return 0;
  return 1200 * Math.log2(1 + (samples / rate) * 2 * Math.PI * hz);
}

/* ---------- the loop itself ---------- */

/**
 * One delay, as state and a step.
 *
 * `set(settings)` then `stereo(left, right)` a sample at a time, which leaves
 * what came out on `left` and `right`. The same shape the compressor's core
 * has, and for the same reason: the audio thread drives it live, `makeEcho`
 * drives it offline over an impulse, and neither of them is a second
 * implementation of a delay.
 *
 * Every buffer is allocated once, for the longest line this delay is allowed
 * to be, and the read offsets move instead. Three things come of that. The
 * audio thread never allocates on a knob move. A time change becomes a move
 * of the read head, which is what a real delay does and what the time-change
 * modes will need. And the arithmetic is unchanged: a read `d` samples back
 * out of a long circular buffer is the same number as a read at the same
 * index of a buffer exactly `d` long, which is how the version this came out
 * of was written.
 *
 * What it does not do is clear the line when the time changes. Neither does
 * hardware - what you hear is the old contents at the new speed - and the
 * offline runs each build a core of their own, so nothing stale reaches a
 * reading.
 */
export function echoCore(rate) {
  const state = { ...ECHO_DEFAULTS };

  // The longest line, in samples, with room for the interpolator's elbows on
  // top. The eight is not spare: the output head reads at the whole length of
  // the loop and the interpolator reads two samples in front of wherever it is
  // pointed, so a buffer only as long as the loop puts the longest delay's
  // output head past the end of it. Measured as a hash that changed at 1500 ms
  // and nowhere else.
  const longest = Math.ceil((LONGEST_TIME / 1000) * rate) + 8;
  const lines = [new Float32Array(longest), new Float32Array(longest)];
  const ats = [0, 0];

  // The all-passes diffusion is made of, and the lag that compensates for
  // what they hold. Each allocated for its own widest case.
  const apBuf = [0, 1].map(() => DIFFUSE_AT.map(
    (f) => new Float32Array(Math.ceil(f * longest) + 2),
  ));
  const apAt = [[0, 0, 0], [0, 0, 0]];
  // Room for the three stages' own rounding on top of the sum of fractions.
  // One float32 a channel, which is all that is left of the lag buffer the
  // output used to come out of. It is not storage: the heads are summed into a
  // single-precision slot because each addition has to round the way it has
  // always rounded, and a double would be a different number from the one in
  // every response this app has drawn.
  const rounding = new Float32Array(2);

  const tone = [setBiquad(makeBiquad(), 'lowpass', ECHO_DEFAULTS.tone, rate),
    setBiquad(makeBiquad(), 'lowpass', ECHO_DEFAULTS.tone, rate)];
  const cut = [setBiquad(makeBiquad(), 'highpass', ECHO_DEFAULTS.lowCut, rate),
    setBiquad(makeBiquad(), 'highpass', ECHO_DEFAULTS.lowCut, rate)];
  // Up to two cascaded low-passes a channel for the medium, plus its bump.
  const mediumLp = [[makeBiquad(), makeBiquad()], [makeBiquad(), makeBiquad()]];
  const mediumBump = [makeBiquad(), makeBiquad()];

  // Everything retune() works out, held where the step can read it.
  let feedback = 0;
  let smear = 0;
  let from = 0;
  let stages = 0;
  let bumping = false;
  let mediumGain = 1;
  let madeFor = null;   // the medium the makeup above was worked out for
  let wowAt = 0;        // the wander's two depths, in samples
  let flutterAt = 0;
  let moving = false;   // whether there is any wander to work out at all
  let turned = 0;       // samples since the transport started, for the phase
  // How far along the line every head is reading, as a multiple of where it
  // belongs. One at rest; away from one while the time has moved and the tape
  // has not caught up. A scale rather than a place, because a transport that
  // changes speed moves every head on it by the same factor - which is also
  // what makes this exact at rest, since multiplying an integer offset by 1 is
  // the integer offset.
  const scale = [1, 1];
  const leaving = [1, 1];   // the scale a fading head is handing over from
  let handover = 0;         // samples of fade left to go
  let fadeSpan = 1;
  let glide = 0;
  let settled = false;      // whether the first tune has happened yet
  const steps = [0, 0];
  const spans = [0, 0];
  const holds = [0, 0];
  const spread = [[0, 0, 0], [0, 0, 0]];
  const taps = [[], []];

  function retune() {
    const was = [steps[0], steps[1]];
    const times = sidesOf(state);
    feedback = Math.min(MOST_FEEDBACK, Math.max(0, state.feedback));
    from = state.pingPongFrom === 'right' ? 1 : 0;

    // Diffusion's all-passes sit in the feedback path and add their own delay
    // to the loop, so the line is shortened by exactly as much and the loop
    // comes out at the time on the knob whatever the diffusion is. In integer
    // samples on both sides of that subtraction, or the compensation would be
    // a sample or two out and the repeats would drift.
    smear = Math.min(1, Math.max(0, state.diffusion ?? 0)) * MOST_DIFFUSE;
    for (let c = 0; c < 2; c += 1) {
      steps[c] = Math.max(1, Math.round((times[c] / 1000) * rate));
      let held = 0;
      for (let k = 0; k < DIFFUSE_AT.length; k += 1) {
        spread[c][k] = Math.max(1, Math.round(steps[c] * DIFFUSE_AT[k]));
        held += spread[c][k];
      }
      holds[c] = Math.max(1, held);
      spans[c] = Math.max(1, steps[c] - held);

      // Where each shorter head reads, in samples back from the write head.
      // A head at a fraction of the loop has to come out at that fraction of
      // the time, and everything read here goes out through the lag - so the
      // offset into the line is the fraction of the whole loop less what the
      // all-passes hold. Measured against the full step and not the shortened
      // line, which is the mistake that put four heads at 76, 152, 228 ms
      // instead of 100, 200, 300.
      // Fractions of the whole loop, which is what they are: a head at a
      // quarter of the time comes out a quarter of the time back. The filter
      // is on what the shortened line can carry, because that is where the
      // longest head reads and the shorter ones have to be inside it.
      taps[c] = headsOf(state.heads).taps
        .slice(0, -1)
        .map((tap) => Math.round(steps[c] * tap))
        .filter((d) => d - held >= 1 && d - held < spans[c]);

      setBiquad(tone[c], 'lowpass', state.tone, rate);
      setBiquad(cut[c], 'highpass', state.lowCut, rate);
    }

    // What to do about a line that has just changed length under whatever is
    // already in it. Nothing, on the first tune: there is no sound in the line
    // to protect and a head gliding in from nowhere would make the response
    // this delay is drawn and marked from depend on where it started.
    glide = 1 - Math.exp(-1 / Math.max(1, REPITCH_TIME * rate));
    fadeSpan = Math.max(1, Math.round(FADE_TIME * rate));
    const how = CHANGE_MODES.some((mode) => mode.id === state.change) ? state.change : 'repitch';
    for (let c = 0; c < 2; c += 1) {
      if (!settled || how === 'jump' || was[c] === steps[c]) {
        scale[c] = 1;
      } else if (how === 'fade') {
        // A head at the old place and a head at the new one, for long enough
        // to cross between them and no longer.
        leaving[c] = (was[c] * scale[c]) / steps[c];
        scale[c] = 1;
        handover = fadeSpan;
      } else {
        // Repitch: the heads stay exactly where they are and the step walks
        // the scale home, so what is already on the tape bends on its way.
        scale[c] = (was[c] * scale[c]) / steps[c];
      }
    }
    settled = true;

    // How far the wander may go, in samples. Two limits, and the tighter one
    // wins: a quarter of the line, so the loop cannot be dragged to a length
    // that is not a delay any more, and far enough in front of the write head
    // that the nearest head still reads something that has been written.
    //
    // Taken over both sides together, so the two stay the same transport
    // rather than one of them being allowed a deeper wobble because it happens
    // to be the longer line.
    let room = Infinity;
    for (let c = 0; c < 2; c += 1) {
      let nearest = spans[c];
      for (let t = 0; t < taps[c].length; t += 1) nearest = Math.min(nearest, taps[c][t]);
      room = Math.min(room, spans[c] * WANDER_SHARE, nearest - WANDER_EDGE);
    }
    room = Math.max(0, room);

    // Both depths share the one allowance rather than each getting it, because
    // they are added together before the line is read and it is their sum that
    // has to stay inside it.
    const wowWant = wanderOf(Math.min(MOST_WOW, state.wow ?? 0), WOW_RATE, rate);
    const flutterWant = wanderOf(Math.min(MOST_FLUTTER, state.flutter ?? 0), FLUTTER_RATE, rate);
    const wanted = wowWant + flutterWant;
    const fits = wanted > room && wanted > 0 ? room / wanted : 1;
    wowAt = wowWant * fits;
    flutterAt = flutterWant * fits;
    moving = wowAt > 0 || flutterAt > 0;

    // The machine's own response, which is not a knob: its corner comes from
    // the delay time and the medium, and it sits on the way into the line
    // rather than in the feedback path with the user's filters. That is the
    // difference between a medium and an EQ - a signal goes through a bucket
    // brigade once to come back once, so the first repeat is already dark,
    // where the tone knob leaves it alone by design.
    const medium = machineTone(state.machine, times[0]);
    stages = medium ? medium.stages : 0;
    bumping = !!medium && medium.bump > 0;
    for (let c = 0; c < 2; c += 1) {
      for (let k = 0; k < stages; k += 1) {
        setBiquad(mediumLp[c][k], 'lowpass', medium.corner, rate);
      }
      if (bumping) setBiquad(mediumBump[c], 'peaking', medium.bumpAt, rate, medium.bump);
    }
    // The makeup costs a quarter of a second of filtered tone to work out,
    // and `set` is called on every knob move - including the mix, which the
    // medium does not depend on. So it is worked out when the medium itself
    // changes and remembered otherwise. The number is the same number.
    const asked = medium
      ? `${medium.stages}|${medium.corner}|${medium.bump}|${medium.bumpAt}`
      : '';
    if (asked !== madeFor) {
      madeFor = asked;
      mediumGain = medium ? makeupFor(medium, rate) : 1;
    }
  }

  /**
   * The record level, with the medium's headroom on it.
   *
   * Exactly the input below full scale - the comparison is strict, so a sample
   * at exactly one goes through untouched and the impulse responses are what
   * they were.
   */
  function record(x) {
    const size = x < 0 ? -x : x;
    if (size <= 1) return x;
    const held = 1 + LOOP_CEILING * Math.tanh((size - 1) / LOOP_CEILING);
    return x < 0 ? -held : held;
  }

  /** One pass through the medium, if there is one. No gain: see makeupFor. */
  function through(c, x) {
    let value = x;
    for (let k = 0; k < stages; k += 1) value = runBiquad(mediumLp[c][k], value);
    if (bumping) value = runBiquad(mediumBump[c], value);
    return value;
  }

  /**
   * The line, read somewhere between two samples.
   *
   * Four-point Catmull-Rom, which is the cheapest interpolator that does not
   * audibly dull a delay the moment it starts moving: linear interpolation of
   * a line whose length is changing is a comb filter whose notch moves with
   * it, and what you hear is the top end breathing in time with the wow.
   *
   * At a whole number it is exactly the sample, with no arithmetic left in
   * it - the cubic's three other terms are multiplied by a fraction of zero -
   * so a delay with no wander on it reads exactly what it read before there
   * was any such thing as wander. Checked rather than asserted: the twenty
   * settings that fingerprint this delay are unchanged to the bit.
   */
  function readAt(c, at) {
    const buf = lines[c];
    const whole = Math.floor(at);
    const part = at - whole;
    // Wrapped with a comparison rather than two modulos. Everything handed to
    // this is built as `ats[c] - back + longest` with `ats` inside the buffer
    // and `back` no larger than it, so the index is in [0, 2 * longest) and one
    // subtraction is the whole of the arithmetic a modulo would do.
    const i = whole >= longest ? whole - longest : whole;
    if (part === 0) return buf[i];

    const m1 = buf[(i - 1 + longest) % longest];
    const p0 = buf[i];
    const p1 = buf[(i + 1) % longest];
    const p2 = buf[(i + 2) % longest];
    const a1 = 0.5 * (p1 - m1);
    const a2 = m1 - 2.5 * p0 + 2 * p1 - 0.5 * p2;
    const a3 = 0.5 * (p2 - m1) + 1.5 * (p0 - p1);
    return ((a3 * part + a2) * part + a1) * part + p0;
  }

  /**
   * The line, read a given number of samples back.
   *
   * Held clear of the write head by the interpolator's own margin, because
   * everything that can move a head - the wander, a glide, a shorter head
   * under either of them - can move it toward the sample about to be written.
   */
  function pull(c, back) {
    const held = Math.min(longest - 3, Math.max(WANDER_EDGE, back));
    return readAt(c, ats[c] - held + longest);
  }

  /** One all-pass stage, in place. */
  function allpass(c, k, x) {
    const buf = apBuf[c][k];
    const at = apAt[c][k];
    const was = buf[(at - spread[c][k] + buf.length) % buf.length];
    const out = was - smear * x;
    buf[at] = x + smear * out;
    apAt[c][k] = (at + 1) % buf.length;
    return out;
  }

  const core = {
    left: 0,
    right: 0,

    set(next) {
      Object.assign(state, next);
      retune();
      return core;
    },

    params() { return { ...state }; },

    /**
     * How deep the wander actually is, in cents, once the line has had its
     * say. Asked for by the measurements that set the limits above, and the
     * only way to know the answer exactly - reading it back off the audio
     * means tracking the pitch of a sum of several heads, which comb-filter
     * each other and send a zero-crossing tracker somewhere silly.
     */
    wander() {
      return {
        wow: centsOf(wowAt, WOW_RATE, rate),
        flutter: centsOf(flutterAt, FLUTTER_RATE, rate),
      };
    },

    /** One sample in on each side, one sample out on each. */
    stereo(inL, inR) {
      const feedIn = [inL, inR];

      // Where the heads are reading, in samples further back than they would
      // be on a transport that held time. One number for both sides and every
      // head on them: wow and flutter move the tape, and everything touching
      // it is displaced by the same amount at the same moment.
      let mod = 0;
      if (moving) {
        const t = turned / rate;
        mod = wowAt * Math.sin(2 * Math.PI * WOW_RATE * t)
          + flutterAt * Math.sin(2 * Math.PI * FLUTTER_RATE * t);
      }
      // Counted whether or not anything is wandering, so the transport has one
      // clock. Otherwise turning the wow off and on again would start the
      // wander from its own beginning, and a knob at zero would be a knob that
      // reset the machine.
      turned += 1;

      // And where the tape has got to, if the time has moved and it has not
      // caught up. A time constant rather than a speed, so a big change dives
      // and settles the way a capstan does, with a cap on how far it may bend
      // in one sample - the first sample of a six-thousand-sample move would
      // otherwise ask for a pitch nothing mechanical could reach.
      for (let c = 0; c < 2; c += 1) {
        if (scale[c] === 1) continue;
        const toGo = (1 - scale[c]) * steps[c];
        let move = toGo * glide;
        if (move > REPITCH_MOST) move = REPITCH_MOST;
        else if (move < -REPITCH_MOST) move = -REPITCH_MOST;
        scale[c] += move / steps[c];
        if (Math.abs(1 - scale[c]) * steps[c] < 0.01) scale[c] = 1;
      }

      // Every head, read off one scale. The longest is both an output and the
      // only thing that goes round again - and it is read twice, in front of
      // the all-passes for the loop and behind them for the ears, because the
      // first repeat is the sound that went in and not a smeared copy of it.
      //
      // `heard` used to come out of a lag buffer: the line was read at the
      // shortened length and delayed again by what the all-passes hold, so the
      // repeat landed on the time. Reading the line at the whole length comes
      // to the same sample and is one buffer and one read fewer - and it is
      // what makes a head's offset literally the fraction of the loop it is
      // documented as. It also has to be this way for a time change to be
      // smooth: a lag whose length is a fraction of the delay jumps when the
      // delay does, and measured, that jump was a step of 1.768 in the output
      // where the signal itself moves 0.11 - a click in every mode, including
      // the one whose whole job is not to click.
      const heard = [0, 0];
      const taken = [0, 0];
      // `crossed` rather than the obvious word for it: `through` is already the
      // medium's name in this scope, and a shadowed function is a silent fault
      // rather than a loud one.
      const crossed = handover > 0 ? 1 - handover / fadeSpan : 1;
      // Crossed in equal power rather than equal gain, which is the better of
      // the two by measurement and not by theory. A fade between two places on
      // a line is a fade between two copies of the same sound at two phases,
      // and where those phases oppose they cancel whatever law is used: on a
      // steady tone the level dips to 0.27 of itself crossing in equal power
      // and to 0.19 crossing in equal gain. The dip is the cost of fading a
      // delay at all, and it is why `repitch` is what this opens on.
      const into = handover > 0 ? Math.sqrt(crossed) : 1;
      const outOf = handover > 0 ? Math.sqrt(1 - crossed) : 0;
      if (handover > 0) handover -= 1;

      // Written out rather than put behind a closure taking the head's place.
      // A function built per channel per sample is an allocation in the
      // hottest loop in the app, and it cost more than the lag buffer this
      // whole rearrangement removed: measured, four delays with four heads
      // went from 0.117 of a core to 0.151 and back to 0.117 when it came out.
      for (let c = 0; c < 2; c += 1) {
        const sc = scale[c];
        const lv = leaving[c];
        if (outOf > 0) {
          taken[c] = pull(c, spans[c] * sc + mod) * into
            + pull(c, spans[c] * lv + mod) * outOf;
          // Summed into a float32 and not into a double, which is not the
          // indirection it looks like: each head added rounds to single
          // precision, and the one in every response this app has drawn and
          // marked is the rounded one. Visible only with diffusion on -
          // without it the response is sparse spikes and the heads rarely
          // carry anything at the same sample, so there is nothing to round.
          rounding[c] = pull(c, steps[c] * sc + mod) * into
            + pull(c, steps[c] * lv + mod) * outOf;
          for (let t = 0; t < taps[c].length; t += 1) {
            rounding[c] += pull(c, taps[c][t] * sc + mod) * into
              + pull(c, taps[c][t] * lv + mod) * outOf;
          }
        } else {
          taken[c] = pull(c, spans[c] * sc + mod);
          rounding[c] = pull(c, steps[c] * sc + mod);
          for (let t = 0; t < taps[c].length; t += 1) {
            rounding[c] += pull(c, taps[c][t] * sc + mod);
          }
        }
        heard[c] = rounding[c];
      }

      // Each side is filtered once a sample, and then routed. Filtering it
      // again on the way past the other channel would be running one
      // filter's state forward twice in a sample, which is a different
      // filter.
      const rounded = [0, 0];
      for (let c = 0; c < 2; c += 1) {
        let value = taken[c];
        if (state.tone < 20000) value = runBiquad(tone[c], value);
        if (state.lowCut > 20) value = runBiquad(cut[c], value);
        // The all-passes last, so what gets smeared is what is going round
        // again rather than what is coming out. At a coefficient of nothing
        // each one is `x[n-M]` exactly, with no arithmetic left in it, so the
        // whole chain is a pure delay and no diffusion is bit-identical to a
        // delay that never had any.
        for (let k = 0; k < apBuf[c].length; k += 1) value = allpass(c, k, value);
        rounded[c] = value;
      }

      for (let c = 0; c < 2; c += 1) {
        // Ping-pong sends what came out of one ear into the other, so the
        // repeats walk across rather than sitting on top of each other - and
        // the input lands in one line alone, because that is what starts them
        // alternating. Which one is a setting.
        //
        // Summed to the middle on the way in, which is both what a ping-pong
        // pedal does and the end of a bug this delay carried for as long as
        // it was a response. A two-channel convolver pairs channel with
        // channel, so a source already hard on one side had nothing on the
        // other for the crossed half of the response to act on - it came out
        // as a plain delay on one side and silence on the other. Measured,
        // repeats only, 375 ms at half feedback:
        //
        //     source       plain delay      convolved        this
        //     centred     -34.81/-34.81   -35.74/-41.97   -35.74/-41.97
        //     hard left   -31.80/silent   -32.73/silent   -38.75/-44.98
        //     hard right  silent/-31.80   silent/-38.96   -38.75/-44.98
        //
        // The two hard rows now agree with each other, which is the test of
        // it: where a mono source was panned is not supposed to decide which
        // ear its echoes start in. It cost 6 dB, which is what summing two of
        // anything to the middle costs, and nothing at all on the material
        // this app actually has - the beds are mono and a track's pan is
        // applied after its inserts, so the two sides are the same signal and
        // their mean is it. Checked that way too: a mono bed through both
        // paths differs by -88 dB.
        const feeds = state.pingPong ? 1 - c : c;
        const feed = state.pingPong
          ? (c === from ? (inL + inR) / 2 : 0)
          : feedIn[c];
        lines[c][ats[c]] = through(c, record(feed + rounded[feeds] * feedback));
      }

      ats[0] = (ats[0] + 1) % longest;
      ats[1] = (ats[1] + 1) % longest;

      core.left = heard[0] * mediumGain;
      core.right = heard[1] * mediumGain;
      return core;
    },
  };

  retune();
  // Tuned, but not settled: the constructor's tune is on the defaults, so
  // whatever is set next is this core's first real configuration and not a
  // change to be glided or faded into. Without this line `makeEcho` built its
  // response with the head travelling in from 375 ms, and the response is what
  // every delay in this app is drawn and marked from.
  settled = false;
  return core;
}

/**
 * What the medium costs, to be taken back off it.
 *
 * A machine that changed the level would make choosing one a loudness test,
 * which is the one comparison this app refuses to leave in. Measured on an
 * impulse at 400 ms, before this:
 *
 *     digital   peak   0.00 dB   energy   3.77 dB
 *     tape      peak  -9.03 dB   energy  -1.04 dB
 *     bbd       peak -20.97 dB   energy  -7.86 dB
 *
 * Five decibels of energy for tape and twelve for a bucket brigade, which is
 * a volume knob wearing a machine's name. Hardware does not do that either: a
 * BBD pedal has a compander across the chip and 0 to 2 dB of insertion gain,
 * and a tape machine has a record level.
 *
 * So the chain's gain is measured once, here, and divided out on the way to
 * the ears - on the output and not inside the loop, which is the whole of
 * what makes this safe. Putting it in the loop multiplies the feedback by it:
 * at 400 ms a bucket brigade's chain wants 3.8 times gain, so a feedback of
 * 0.4 became a loop gain of 1.52 and the thing ran away. Measured as it did,
 * the response came out at +27.78 dB of energy against digital's +3.77.
 *
 * Outside the loop it corrects the first repeat and leaves the compounding
 * alone, which is right: a pass through a bucket brigade costs top end, so
 * each repeat really is darker and shorter-lived than the last, and a machine
 * with fewer usable repeats than a digital delay is a machine behaving. What
 * is taken out is the insertion loss - the 0 to 2 dB a real pedal makes up
 * with a compander - and not the medium itself.
 *
 * Referenced to a tone in the body of the sound rather than to the whole
 * impulse's energy, which was the first thing tried and is wrong in a way
 * that reads as a feature. Matching total energy gives a dark machine all of
 * its lost energy back across whatever bandwidth it has left, so it comes out
 * bassier than a digital delay rather than merely duller - measured, a bucket
 * brigade read 12.8 dB hotter than digital over 60 to 400 Hz. Matching one
 * tone below every corner this allows leaves the body where it was and lets
 * the top go, which is what a machine takes.
 *
 * A tone run until it settles rather than the filters' magnitude worked out
 * in closed form, which would be exact and free. The probe samples a
 * sinusoid at whole samples and so reads a hair under its true peak, and that
 * hair is in every delay this app has ever drawn or marked. Keeping it is
 * keeping those numbers.
 */
export function makeupFor(medium, rate) {
  const probe = [makeBiquad(), makeBiquad()];
  for (let k = 0; k < medium.stages; k += 1) {
    setBiquad(probe[k], 'lowpass', medium.corner, rate);
  }
  const bump = medium.bump > 0
    ? setBiquad(makeBiquad(), 'peaking', medium.bumpAt, rate, medium.bump)
    : null;

  // A tone at MEDIUM_REF, run until it settles, and the amplitude of what
  // comes out. Below every corner a machine is allowed and above every head
  // bump, so it is measuring the flat part of the response rather than any of
  // the shape.
  const settle = Math.ceil(rate * 0.25);
  let loudest = 0;
  for (let i = 0; i < settle; i += 1) {
    let value = Math.sin((2 * Math.PI * MEDIUM_REF * i) / rate);
    for (let k = 0; k < medium.stages; k += 1) value = runBiquad(probe[k], value);
    if (bump) value = runBiquad(bump, value);
    // The last tenth, by which time the filters have forgotten their start.
    if (i > settle * 0.9) loudest = Math.max(loudest, Math.abs(value));
  }
  return loudest > 1e-6 ? 1 / loudest : 1;
}
