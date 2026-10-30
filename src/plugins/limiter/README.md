# limiter

    plugin.js    the face: a reduction trace and a before-and-after
    ceiling.js   the drive, the trim, and the two readings
    player.js    auditioning it against a level-matched bypass

No `node.js`, which is unusual for a plugin with a worklet in it: the limiter
itself is `lib/limiter.js` and the node is `lib/limiter-node.js`, because the
sketchpad has had the same limiter on its bus as a safety ceiling since it had
a bus. What is in this folder is the half that makes it an instrument rather
than a seatbelt - something to push into it, somewhere to put the ceiling, a
trim to take the level back out, and a reading of what it did.

## The drive is the threshold

A limiter's threshold IS its ceiling, so the only way to ask for more of it is
to send more in. That is what every mastering limiter's input or drive control
does, and saying so is clearer than giving the ceiling a second name.

Which means the first stretch of the drive does nothing but turn the music up.
Measured on the bed-with-hits in `tests/ceiling.test.js`, which reads -20.41
LUFS and -6.76 dBTP:

    drive   loudness   true peak    PLR    deepest GR   average GR
       0     -20.41      -6.761    13.65      0.00         0.00
       2     -18.41      -4.761    13.65      0.00         0.00
       4     -16.41      -2.761    13.65      0.00         0.00
       6     -14.42      -1.000    13.42     -0.24        -0.01
       9     -12.06      -1.000    11.06     -3.24        -0.44
      12      -9.79      -1.000     8.79     -6.24        -1.05
      15      -8.21      -1.000     7.21     -9.24        -2.53
      18      -8.12      -1.000     7.12    -12.24        -5.43
      24      -8.12      -1.000     7.12    -18.24       -11.42

Three stretches. Up to four decibels nothing is limited and the loudness
follows the drive exactly - which is not mastering, it is turning it up, and
where it stops is wherever the material's own peak was rather than anything
about the limiter. From six to fifteen the trade runs: nine decibels of drive
buy six of loudness and spend six and a half of peak-to-loudness ratio. Past
eighteen there is nothing left - the last six decibels buy 0.00 dB and cost
six more of reduction.

That shape is the whole tool. It is also far easier to believe from a meter
than from an argument, which is why the second bay is a table of figures
rather than a picture.

## Deepest reduction is a closed form, and it was a search first

`driveFor` turns a wanted amount of reduction into a drive, and the drive a
limiter needs depends on the material rather than on the knob - so it started
as a twelve-round bisection over the drive range, at 1900 ms a call on four
seconds of stereo.

It came out exactly 1:1 at every step of a nine-decibel sweep, which is not a
coincidence to be smoothed over by a search. The gain the limiter applies is
`min(smoothed, lowest)` where `lowest` is the sliding minimum of what each
sample asked for, so the applied gain reaches the smallest ask exactly, and
the smallest ask is `roof / peak`. Driving by a constant scales that peak by
the same constant, so

    deepest reduction = drive + (peak - ceiling)

once the peak is over the ceiling at all. One pass measures the bracket; the
drive falls out.

The bracket is measured rather than read off `truePeakOf`, and the difference
is small and real. The meter's true-peak search is an optimised one - it
reconstructs only around local maxima within a few decibels of the sample
peak, at two output positions each. The limiter's is exhaustive: every phase
of every sample. On noise the meter comes out 0.058 dB under the limiter,
which asked for one decibel of reduction and got 1.058. So the drive is set
from the limiter's own reckoning of where the peak is, which is the one that
decides what it does.

## The output trim goes after, and only down

A gain after a brickwall is a gain the brickwall does not know about, so the
trim can only attenuate - `CEIL_OUTPUT` is `[-24, 0]`. A positive one would
put the output back over the ceiling that the whole of `lib/limiter.js` exists
to hold, and turning down cannot.

What it is for is the comparison. A limiter's output is louder than its input
and louder sounds better, so an A/B between limited and not answers "which
one is louder" unless the level is taken out first. The Match button measures
both sides and sets the trim: measured, it lands within 0.000 LU on every
material and drive the tests try.

Almost always what you then hear is that the limited version is smaller.
That is the correct and useful discovery, and it is unavailable without the
trim.

## The reading is the compressor's kind, deliberately

`kind: 'reduction'`, on the same five-millisecond frame axis, so a limiter
reading and a compressor reading of the same loop compare - "how much is this
reducing" is one question however the thing answering it is built, and
`tests/ceiling.test.js` holds that they do.

Getting there moved `FRAME_MS`, `materialStamp` and `meanFrames` out of the
compressor and into `lib/reduce.js`. A plugin may not import another plugin,
and the alternative was a second stamp and a second framer - which is worse
than either arrangement, because two readings would then claim the same axis
having computed it two ways and `comparable()` would wave them through.

The first version of the axis stamped the wrong thing: `materialStamp` takes a
buffer or a list of them and it was handed `{ left, right, rate }`, which
stamped as `'none'`. Every reading matched every other one, and two readings
over completely different loops compared happily. A test caught it, which is
the only reason it is not still true.

## What is not here

The clipper. A hard clipper is the other way of making something loud - no
lookahead, no release, just a line the waveform is not allowed to cross - and
what it costs is distortion rather than dynamics, which is a different lesson
and wants the saturator's harmonic reading rather than this folder's reduction
one.

A track insert. `core/effects.js` does not offer one and `sketch/insert.js`
has no tap for this face to read, which is the same place the level tool was
left. It is less of a gap here than it looks: the sketchpad bus already has
this exact limiter on it as a safety ceiling, and a limiter is a master-bus
device by habit. A per-track one is still a real thing somebody would want,
and it wants the insert's live-tap half rather than anything in this folder.

And the delivery targets: get this to -14 LUFS with the peak under -1 dBTP.
That wants a table of what each service asks for, a date on that table, and
the loudness-matched preview that shows what a service does to a master which
ignored it. It belongs with the Loudness and Master module.
