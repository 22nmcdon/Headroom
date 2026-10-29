# Headroom — an audio production workbench

Six real audio plugins, the measurements behind them, and exercises that mark
you on the result rather than the settings. No accounts; everything stays in
the browser.

**It gives you the actual controls.** You dial an EQ band or a compressor, hear
your settings against the target as often as you like, and submit when you
think you are on it. Each reading tells you how far off and *which way* —
`2.8 oct high`, `3.5 dB shy`, `1.7× soft` — so the next attempt is an
adjustment rather than a guess. There is no limit on attempts and nothing to
run out of; when you are stuck, **Hint** says what kind of move it is and
roughly where, and **Show me** draws the answer on the tool and *leaves the
controls live*, so you can hear your way onto it. Every reading also carries
its own working — what was measured, what it came to, and how.

Every claim this app makes about audio was checked by rendering it offline and
measuring, which is also how a good number of its own bugs were found. Where a
number in the code came from a measurement, the comment beside it says what was
measured.

> **Mid-restructure.** This began as a Wordle with four music-theory modes
> alongside the plugins. Those are gone — naming a half-diminished seventh is
> musicianship, not production — and so are the guess ceiling and the share
> grid: a tool you can only touch four times is not a tool, and the whole
> content of the grid was "I did it in three". The daily and the streak have
> now gone after them, for the same reason: both are scarcity mechanics, and
> with nothing to run out of, a streak measured how recently you played rather
> than how well you hear. A daily *drill* — one short question a day, the same
> for everyone — is worth having and comes back on the drills. What replaces
> all of it is in: the identification drills, the analysis pillar and the
> guided path.

The app has two halves, on a switch above everything: **Tools**, which is all
of the below, and **Analysis**, which asks nothing and reads a track back.

Within the tools there are two ways to use any of them, on a pill: **work at
it**, or be **drilled** on it. Working at a tool is matching a target, curing a fault,
levelling a loop — you build the answer on the plugin. A drill puts the tool
away and asks instead: which octave moved, how much reduction is that, warm or
dirty, where is it, how big is the room, which note are the repeats on. The
pill survives changing tool, so a run of all six drills is one click each.

| Mode | What you work with | Exercises | The drill |
| --- | --- | --- | --- |
| **EQ** | **a channel EQ** — six bands you drag over a live spectrum, with the loop running | **Match** a target move · **Fix** a sample with a resonance in it | **Name the move**: which octave, and boosted or cut |
| **Compression** | **a compressor** — threshold, ratio, attack, release, knee, lookahead, a filtered sidechain and a key input | **Match** a target compressor · **Even out** a loop whose hits are all over the place · **Duck** one thing under another | **How much is it doing**: 0 to 12 dB of reduction, level-matched |
| **Stereo** | **an imager** — mid/side width in three bands, two movable crossovers, a pan, and mono and side monitoring | **Place** a sound · **Match** a target image · **Rescue** a low end somebody spread too wide to survive mono | **Where is it**: seven places across the field |
| **Reverb** | **a reverb** — five kinds of space, decay per band, pre-delay, size, early/late balance, a shimmer, a freeze and mix | **Match** a room · **Fit** the tail to the tempo | **How big, how long**: the space on chips, the tail on a dial |
| **Delay** | **a delay** — time or note division, feedback past unity, ping-pong, a filtered repeat path, diffusion, tape or bucket-brigade wow and flutter, ducking and mix | **Match** a delay · **Find** the note it is on | **Which note is it on**: five divisions at this tempo |
| **Saturation** | **a saturator** — drive, bias, hardness, tone and a parallel mix, run eight times oversampled | **Match** how much · **Match** the colour · Build a warmth that is **even and not odd** | **Warm or dirty**: even harmonics against odd, and how hard |

### The EQ is a plugin

It is not a question with an EQ drawn next to it. Six bands — high-pass, low
shelf, two peaks, high shelf, low-pass — sit on a log frequency display over a
live analyser. Drag a node to move it, wheel over it for Q, press a band button
to switch it out. The loop runs continuously while you work, and **Yours** and
**Target** are two chains fed by the same source, so flipping between them
changes the processing and nothing else.

You are judged on **the curve, not the controls**. Two different sets of bands
that make the same shape are the same answer — a test pins that down with a
wide cut against the two narrow ones that add up to it — because an EQ trainer
that marked you down for arriving by a different route would be teaching the
plugin rather than the ear. The reading says how far apart the two curves get
at their worst point, and where: `3.1 dB out`, `450 Hz too hot`. When the round
ends the target is drawn over your curve, so you can see what you were chasing.

### The saturator runs faster than the signal

A nonlinearity makes harmonics without limit, and every one above half the
sample rate folds back down to a frequency that is not a harmonic of anything.
Measured at 48 kHz, a 220 Hz note is fine — the folded energy comes back 61 dB
down — but a hi-hat is not: at a high drive the junk lands **10 dB** under the
signal, and inharmonic is the one thing real saturation never sounds like. A
mode built on that would be teaching people to recognise a sound no piece of
gear makes. So the curve runs at **eight times the rate**, with a linear-phase
filter either side of it, and the same hi-hat comes back **48 dB** down.

You are judged on **the harmonics, not the controls**: the series a sine comes
out as, second to tenth, worst one counted. Two sets of settings that make the
same series are the same answer. The bars are gold for even and pink for odd,
because that division is the whole ear skill — even harmonics are octaves and
sound like the note getting larger, odd ones are fifths and sound like it
breaking, and *warm* and *dirty* are those two piles of numbers.

### Start here

A first visit used to open the help dialog and then drop you into the EQ's
match exercise — a six-band parametric, a target you cannot see, and nothing
saying there is an easier way in. **Start here** is the easier way in: six
tools, three steps each, in the order somebody would be taught them. Read what
the tool is for, be asked one question about it, then go and build one.

It is not new content and it is not a course. Every step is something that was
already there, and clicking one sets the tool, the tier and the work-or-drills
pill and takes you to it. **Nothing is locked** — an unlock would make this a
gate, and a gate is wrong for an app somebody might open knowing exactly what
they want to practise. Somebody who went and solved the delay first gets the
delay marked done *and* is still pointed back at the EQ, because the order is
the only thing the path is for.

A step is done at **three solves**, not three in a row. A streak would throw
away three rounds of work for one slip, which is what streaks were taken out
of this app for. The path keeps no record of its own: it counts the solves the
stats already hold, so importing somebody's progress file brings their place
in the path with it and nothing had to be written to make that true. The one
step that is not a round — reading the notes — is the one thing it does
record.

The auto-opening help dialog is gone, replaced by one line in the page with
both answers on it.

### The analysis view

The other half of the app, on the switch at the top. No tiers, no exercise, no
dock, nothing to submit: you put a piece of audio in front of it and it tells
you what is in there.

Two slots, because almost every real use of a meter is a comparison — yours
against a record you like is most of what a mastering engineer does with these
numbers. Either slot takes a file off your disk or one of the loops this app
synthesises, so there is something to look at before you load anything. What
comes back:

- **Loudness**, **range**, **true peak**, **crest**, the **tightest** moment
  anywhere in the track, and what a **fold to mono** would cost the bottom
  end — with the difference against the reference under each one, because
  working that out in your head is what the tile is meant to save.
- **Where the weight sits**: the long-term average spectrum, a third of an
  octave at a time, tilted so a balanced mix reads level.
- **How it moves**: short-term loudness and crest factor second by second, on
  one picture, because a loudness that holds while the crest drops is a
  limiter doing the holding.
- **How wide it is**: band by band, with what each band loses in mono.

The comparison line comes from the same `distance` every exercise in this app
is marked with, so "16.7 dB at 400 Hz" means the same thing in both places.

Measured, on a three-minute stereo file at 44.1 kHz: about seven seconds to
read, of which the loudness is three and the width two and a half. The page
says what it is doing and gets a chance to paint it before the main thread
stops answering — doing the work inside the frame callback blocks the very
paint it was waiting for, so the message would appear after it had finished
happening.

### The drills are calibrated, not guessed

Every drill asks something the ear can actually hear, and what counts as
"close" is a measurement rather than a judgement. The numbers are in the code
beside the constants they set.

- **Which octave moved.** The bed was rendered offline and read at the ten
  octave centres from 31.5 Hz to 16 kHz, then rendered again through a +9 dB
  octave-wide boost at each. **31.5 Hz and 16 kHz are not on the chips**: the
  bed holds −20.1 dB and −32.7 dB there against its loudest octave, and the
  same move lifts them 6.3 and 4.3 dB against 6.1–7.3 dB everywhere else. What
  "close" means comes off the same renders — a move shows up in the octave next
  door at about a third of its size and two octaves away at a tenth or less, so
  next door is a near miss and two along is not.
- **How much reduction.** "Gain reduction" has two meanings on a drum loop and
  only one is audible. The meter's deepest moment is a transient: the same
  compressor reads −16.5 dB with a 1 ms attack and −6.0 dB with a 60 ms one
  while doing the same work. So the drill means *how much quieter the loop
  got*, which is what auto-makeup puts back — and it puts it back, so the
  question is not "which is louder". The six amounts are told apart by crest
  factor, which climbs 21.6, 23.1, 24.9, 26.6, 28.8, 30.5 dB across them.
- **Warm or dirty.** The odd side is a symmetric curve, which makes **no even
  harmonics at all** — not few, 273 dB down — and the even side leads by at
  least 8 dB. The two questions are independent by construction: the amounts
  match across the colours to within 1.3 dB, or anybody would name the colour
  off the volume.
- **Where is it.** Seven places, 4 to 6 dB of balance apart, on a **mono**
  source — because on a stereo one a pan destroys the thing a width question
  would ask about: at hard left the width reads 0.00 dB whatever the controls
  say. How wide is the imager's own exercise, answered on the imager.
- **How big, how long.** The tail is marked on the **measured RT60** of the
  room, not the number on the decay control: a decay of 1.2 rings for 0.78 to
  1.04 s. Close is a ratio, because time is heard in ratios. Size is a separate
  question because it is a separate thing to hear — six metres answers at
  6.9 ms, eighteen at 20.7 and forty at 46.0.
- **Which note.** A quarter is 625.0 ms at this tempo, a dotted eighth 468.8,
  an eighth 312.5, a triplet 208.3, a sixteenth 156.3 — so neighbours sit 1.33
  or 1.50 apart wherever you are in the list, and the easy tier takes every
  other one for 4:2:1.

**What is not here any more.** Four modes used to sit alongside these: name
the chord, name the note, name the interval, name the figure. They were cut —
a producer can have a very good pair of ears and never name a half-diminished
seventh. What replaced them asks the same shape of question about the right
subject: which band is boosted, how much reduction is that, even harmonics or
odd.

## Run it

A static site with no build step and no dependencies:

```bash
npm start           # python3 -m http.server 8080
# then open http://localhost:8080
```

(Any static server works. Opening `index.html` straight off disk will not — the
app uses ES modules, which browsers refuse to load over `file://`.)

```bash
npm test            # node --test — the modes, the round, the readings, the stats
npm run artifact    # bundles the whole app into dist/headroom.html, one file
```

Pushed to the default branch, `.github/workflows/pages.yml` runs the tests and,
if they pass, publishes the repository as-is to GitHub Pages. There is no build
step to run first — what is in the repository *is* the site. It needs one
setting turned on by hand, once: **Settings → Pages → Build and deployment →
Source → GitHub Actions**.

`npm run artifact` folds the stylesheet and the ES modules into a single page so
it can be published or opened straight off disk. Nothing is minified and nothing
is rewritten beyond the module keywords, so the bundle reads as the source does.

Flattening seven modules into one scope has one hazard, and it shipped once: two
modules had each grown a `write`, which is nothing in separate scopes and a
SyntaxError in one — and a script that does not parse leaves a page whose every
control comes up empty. The bundler now refuses to emit a bundle whose modules
would collide, names both files when they do, and parses its own output before
writing it; `tests/bundle.test.js` runs the whole thing on every `npm test`.

## How a round works

1. Press play. The loop runs continuously while you work, and **Yours** and
   **Target** are two chains fed by the same source, so flipping between them
   changes the processing and nothing else.
2. Dial it in. Every control is one you would reach for in a session, with the
   same units written on it, and audible before you commit to it.
3. Submit when you think you are on it.

Every attempt comes back as coloured readings: 🟩 that is it, 🟨 close, 🟥 not
close. What "close" means is each tool's own business, and the reading spells
it out — `450 Hz too hot`, `1.4 dB out`, `too wide at 120`, `2 dB too dirty`,
`7.2 dB too much warmth`, `right depth, wrong timing`.

Nothing here tells you that you are wrong. "3 dB hot", "too far left" — the
reading names where the thing sits, which is both the useful answer and the
house style.

### The fix exercises

These are the ones that make it a tool rather than a quiz, and both are built so
that doing it right is audible rather than merely scored:

- **EQ → Fix the sample** bakes a resonance into the sample — mud, boxiness,
  honk, harshness — and the answer is its exact inverse. Dial the right cut and
  the problem simply goes away; the other side of the A/B is your EQ out of
  circuit, which is what a bypass button is for.
- **Compression → Even out the loop** hands you a loop whose hits alternate
  9–15 dB apart. Verified the same way: **10.1 dB** of unevenness untreated,
  **0.1 dB** with the reference settings, **6.0 dB** if the ratio is too gentle,
  **9.5 dB** if the threshold is too high.

## What's here

- **All six tools above**, each with three tiers and two or three exercises,
  and every one usable on **your own audio** — there is an *Open a file* button
  on every plugin.
- **Notes on each tool**: four sections apiece on what it is *for*, rather than
  which button does what. What mid/side actually is, why pre-delay is the
  control people miss, why even harmonics sound like an octave and odd ones
  like something breaking.
- **Every sound synthesised live** — no samples to host. A piano built from
  additive partials, a kit built from filtered noise, and a four-piece bed
  (kick, bass, chord, hats) for the exercises that need something broadband to
  judge a move against.
- **An identification drill on every tool**, on three tiers each, with the
  question, the chips and the tolerances all set by measurement rather than by
  taste — see below.
- **A guided path**: the six tools in a teaching order, three steps each —
  read what it is for, be asked one question about it, then build one — and
  then one last step that is not about a single tool at all: mix something.
  Nothing is locked. The path marks what is next; the next thing is a
  suggestion.
- **Per-tool progress**, per tier, and kept apart for work and for drills,
  because they are different activities and pooling them would report neither.
  It records which kind of answer keeps catching you out *and what you keep
  hearing it as*: "2k (honk) is the one to work on — solved 40% of 5. You
  usually hear it as 4k (presence)." Plus **Export** / **Import** in the stats
  dialog, because one key in one browser's storage is not a copy. An import *adds* to what is
  already there rather than replacing it, so the same person on a phone and on
  a laptop keeps both halves; each export carries an id, so importing the same
  file twice counts it once.

- **A mix exercise mode** — four stems, a desk, and a mix to match. Three
  tiers: levels, then levels and placement, then the whole desk including how
  much room each part is in. **You are marked on the master, not on the
  faders**: both mixes are rendered offline and read, and five measurements
  are put side by side — how loud, the tonal balance, where things sit, how
  wide, how dynamic. Any set of moves that arrives at the same balance is the
  answer. The A/B swaps which mix the clock is playing *without stopping the
  clock*, which is the only way anybody hears a difference this small. The
  drums never move: something has to be the level everything else is set
  against.
- **A sketchpad** — a clip grid: tracks down the left, clips running right,
  where a tap launches a clip on the next bar line and the panel under it is where you
  draw the notes. A kit
  track gets three **pads** instead: press Record, play, and every hit lands
  on the nearest line of the grid — the nearest, not the one before, because
  a hit a hair early is a hit on the beat played by somebody with good time.
  And when the idea is not notes at all — a hummed line, a guitar part —
  **Record into this slot** takes whatever the microphone hears, cuts it to
  the nearest whole bar, and puts it in the slot as a clip that loops with
  everything else, runs through that track's inserts and fader, and comes out
  in the stems. A sketch opens with a **Voice** track for exactly that — no
  step grid, no chords, just Record — because the reason to have a sketchpad
  on a phone at all is that the idea arrives when the phone is the only thing
  to hand.

  A clip **loops until you press something else**, which is what a clip grid
  is for — but it can also be told to hand over: *2× then the next one*, or
  *back to 1*, or *stop*. Set a few and the sketch plays itself through. A
  press always beats a follow. Measured, rendering three scenes at three
  octaves offline: *2× then next* all the way reads C2 C2 C3 C3 C4 C4 and
  then silence, and *1× then next, 1× then back to 1* alternates for as long
  as you let it. Recordings live in this browser's IndexedDB beside the
  sketch, because four bars of audio is a hundred times what localStorage is
  for. The six tools are the inserts. It keeps itself in this
  browser as you work, and there are two ways out: a **Type 1 MIDI file** of
  the scene you are on, looped to four bars, with a track per part and the
  drums on channel 10 — so it opens in Logic named and in the right places —
  or the **stems**, as an archive of 24-bit wavs, one a track plus the shared
  room and the mix, with that same MIDI file alongside them. Everything in it
  starts together and is the same length, so it all drops onto bar one.

## Not built yet
- **Pitch that holds its length.** The sampler resamples, so a recording an
  octave up is half as long — the classic behaviour, and the honest one.
  Holding the length while moving the pitch wants a phase vocoder or a
  granular engine, which is a different instrument.
- **Detecting a recording's root note.** The sampler is told what note a
  recording already sounds at, and the default is middle C. The analysis view
  already has the FFT it would take to work it out.
- **The rest of the inserts on a mix-exercise strip.** The desk has a tone
  tier now - an EQ on every stem, three bands at fixed frequencies, marked on
  the master's balance reading. The other five inserts are not there, and the
  measurements say why: a compressor insert cannot be marked on a four-part
  sum, because sixteen decibels of reduction on one stem moves the master's
  crest reading by half a decibel, and the imager and its relatives have
  nothing to act on, since the stems are mono parts and the pan is applied
  after the inserts. Any of them arriving needs a reading that can see it
  first.
- A compander on the bucket brigade, which is the most-named part of a BBD
  delay. Built as a throwaway and measured: it works, pushing a -66 dB noise
  floor down to -96.7, which is what a compander is for. But the noise is the
  only reason it exists and this delay has none, so adding one in order to take
  it back off is adding a defect to hide it. And either half on its own moves
  the bucket brigade 17 dB on the reading that marks which machine it is,
  against tolerances of 2.6, 1.9 and 1.2 - because a compander's gain comes
  from the signal's envelope and an impulse has none, so the response would
  stop describing the device. No reference level fixes that; moving it to full
  scale makes it worse. See `src/plugins/delay/dsp.js` beside `BBD_AT`.
- Any server, account or automatic sync. Progress lives in `localStorage`, and
  the way it moves between browsers is the exported file.

## What this device can run

`dev/load.html` renders Headroom's own DSP offline and times it, which is the
only load measurement that means the same thing on every device — on a real
one the audio clock belongs to the sound card and keeps perfect time whether
or not the thread managed to fill the buffer. Open it on a phone and it says
what that phone can hold. On a 2.10 GHz Xeon, all six effects on all four tracks costs 0.73 of a core;
on a phone it costs **0.21**, and that phone runs about 36 saturators at once
before the DSP stops fitting in real time. See `docs/audio-core.md` for why
the saturator is the one to watch, and why that measurement closed the
question of moving the DSP out of JS.

## Adding a tool

A tool is three files, composed by `src/bench/registry.js`:

```
src/tools/eq.js     what it is, and open(el, {engine, onChange}) -> a live plugin
src/work/eq.js      exercises and drills over it: makePuzzle, score, hints,
                    reveal, weak, heard
src/notes/eq.js     the long prose, for the person using it
```

**The tool knows nothing about a puzzle, an answer or a tier.** That is the
point of the split, not tidiness: a tool that knew about answers could not be
opened without a round, which is why changing an exercise used to tear the
plugin down and stop the audio. Now the tool is what stays and an exercise is
something that arrives, sets it up, and leaves.

`src/bench/session.js` does the arriving and leaving. An exercise is data — a
source, the A/B's name, `faultOf(puzzle)`, `targetOf(puzzle)`, `startOf(puzzle)`
— and `attach` applies it in an order that matters: remember what the tool was
doing, put the material on and **wait for it**, pin it to the puzzle, then
fault, target, label, and the starting settings last so `onChange` fires once
at the end. `startOf` is deliberately after the material: a drill that asks how
much a compressor is doing has to set a compressor that does that much to
*this* loop, which cannot be worked out until the loop exists. An exercise that
drives the tool's own controls says `restores: true`, and `detach` puts them
back — otherwise the next exercise opens with the last drill's answer on the
knobs.
`detach` puts back everything the exercise imposed and nothing else: the drawn
answer, the lock, the fault, the A/B. Not where the controls ended up —
somebody may want to keep working from the curve they just built.

Every tool implements the same lifecycle: `state`/`setState`, `read`/`readNow`,
`setSource(id, opts)`, `loadFile`, `setFault`, `setTarget`, `showTarget` (null
clears), `nameAB`, `lock`/`unlock`, `source`, `abLabel`, `material`, `toggle`,
`isPlaying`, `destroy`. The last two are the transport, and the shell needs
them because a drill hides the tool and drives it from outside — the clean A/B
a drill offers is `setFault(null)` and back, or `setState(clean)` and back,
with the loop never stopping.
`tests/session.test.js` holds the decisions to account against a fake tool made
of nothing but promises — which is how attach → detach → attach gets tested at
all, given that nothing in this app had ever reused a plugin.

### The exercise contract, in older words

A tool's work is data and seven functions. It says what it asks (`slots(tier,
settings)`), how to make a puzzle (`makePuzzle`), how to read a guess
(`score(state, puzzle)`), what to say when somebody is stuck (`hints(puzzle)`),
what the answer was (`reveal`, `weak`), and — for a drill — what a guess says
it *heard* (`heard(guess, puzzle)`), in the same words `weak` uses for what was
played. That last one is what lets the stats say "you keep hearing 2k as 4k":
two keys in one namespace, compared. Nothing else in the app knows which tool
is showing — the log, the picker and the stats are all built from what it
returns.

`score` takes two arguments where it took four: the answer and the tier both
live on the puzzle already, and every scorer had grown a defensive
`puzzle?.settings?.exercise ?? '…'` to find the third thing it needed.

### Readings

Every measurement in this app arrives in one envelope:

```js
{ tool: 'panning', kind: 'image', ready: true,
  of: { state, source, axis },      // WHAT this is a reading of
  values: <the tool's own shape, verbatim> }
```

The payloads are **not** unified — they are calibrated and tested, and
translating an EQ curve, a gain-reduction series and a harmonic spectrum into
one shape would be lossy for no gain. What is unified is the envelope and the
operations: `read()` (synchronous, never null, `ready: false` when the controls
have moved since), `readNow()` (awaited, guaranteed current), and
`distance(a, b)` (`src/gap.js`), which refuses to compare two readings of
different kinds, on different axes, or over different material rather than
returning a plausible number nothing downstream could question.

Eight kinds across six tools: `curve`, `reduction`, `decay`, `arrivals`,
`wander`, `ducking`, `image`, `harmonics`. The reverb and the delay share
`decay` on purpose — each is completely described by what it does to one
click, so "is this delay as long as that room" is a question that can be
asked. `distance` on `harmonics` is pairwise only: its masking floor is derived
from both readings at once, so three of them cannot be ranked.

Four of the eight are the delay's, which is not a design — it is what a
device that stopped being linear costs. Each is deliberately deaf to the
others' subject: `decay` says how the repeats fade and is blind to where in
the loop they land, `arrivals` says where they land and is blind to how long
the loop is, `wander` says how badly the transport holds time and is blind to
both, and `ducking` says how far the repeats get out of the way and is blind
to all twelve of the other controls.

The first two are read off a response. The last two cannot be: a wandering
line needs a new response every sample, and a ducker's gain comes from a
detector, which a click gives nothing to integrate — measured, 24 dB of duck
moves the response 0.35 dB and every reading taken from it 0.005. So both run
the loop over a probe instead, `wander` over a tone and `ducking` over two
phrases and the gap between them, and read the thing being taught directly:
the pitch in one case, the gain in the other.

Four more belong to no tool: `loudness`, `crest`, `balance` and `width`, in
`src/analysis/`. They are readings of a piece of audio rather than of a
setting, which is what the analysis pillar is — and they go in the same
envelope so that two of them can be put side by side by something that does
not know which kind it is holding.

**The loudness meter is held to somebody else's answer**, which nothing else
here can be. ITU-R BS.1770-4 prints its K-weighting coefficients at 48 kHz and
EBU Tech 3341 prints signals and the readings a compliant meter must give for
them; `tests/loudness.test.js` checks both. The filters reproduce the printed
coefficients to ten decimal places and are derived rather than transcribed, so
they are right at 44.1 kHz too — which matters, because the browser picks the
rate. All five of the Tech 3341 cases pass inside the document's ±0.1 LU: a
−23 dBFS sine reads −23.0, the gated cases read −23.0 with their quiet ends
thrown away, and the one that averages −26 and −20 reads −23.0 rather than the
−24 that averaging decibels instead of power would give.

Two details in there look like mistakes and are not: the shelf's midpoint gain
is `Vh ** 0.4996667741545416` rather than `sqrt(Vh)`, and the high-pass
numerator is a plain `1, −2, 1` that leaves about 0.005 of gain in the filter.
The −0.691 offset in the loudness equation was calibrated against exactly
those, so correcting either one gives a meter that no longer agrees with
anybody else's. The comment above them says so.

True peak is read at four times the sample rate through a 49-tap windowed
sinc, because a sample peak is not the peak — a file that reads −0.1 dBFS can
still clip a converter. Interpolating every sample of a four-minute track is
two billion multiplications, so only samples within 9 dB of the loudest are
looked at: the overshoot between two samples is bounded at about 3 dB for a
band-limited signal, and nine is three times that margin.

`of.state` is what fixed three bugs that were shipping: the imager painted a
live goniometer beside band bars up to a debounce old *in the same frame*, the
saturator did the same with its curve and its harmonics under a comment
promising they redrew together, and the compressor went on drawing a
gain-reduction trace for a loop that was no longer loaded. Nothing was wrong
with any of the arithmetic; nothing could say which picture was current.

A `score` may also return `why`: an ordered list of `{label, value, how}`, shown
under the attempt in the log. Every scorer here already worked out more than
the two cells it printed — the frequency two curves part company at, how much
of a compressor's gap is depth and how much is timing, what summing to mono
costs down low — and then discarded it. `how` is drawn from the
measured-justification comment already sitting above the tolerance constant.

A slot is one of two kinds. `choice` gives a list of options and renders as
chips; `range` gives `min`, `max`, a `format` for writing the value down, and
the tolerances that decide right from close — and renders as a control, with
its value read back live and audible through `Play yours` before it is
committed.

`slots` takes the settings, because which controls a round asks with is the
exercise's business. A tool exercise returns none — a tool is answered on the
tool — and a drill returns the chips, or in the reverb's case chips and a
control. A drill also declares `drill: true`, which is how the shell knows to
put the tool away: on every one of these the display *is* the answer, so the
analyser would be drawing the boost and the harmonic bars even against odd.

`tests/modes.test.js` holds every mode to that contract: that its own answer
scores green in every cell, that every answer it can generate is answerable from
the chips on screen, that it says something beyond repeating the guess back, and
that each of its clues actually makes a sound.

## The look

A Real Book page that answers back. The design system is `styles.css`, which is
commented as one — two comments used to cite a `BRANDING.md`, and there has
never been one in this repository. Cream paper, charcoal ink, blush and gold
accents, Playfair / Cormorant / Jost.

- **The five meaning colours do not move between tools.** Sage is "that is it",
  gold is "close", rust is "not close" — the same three readings whether the
  thing being read is a curve, a decay or a harmonic series.
- **One palette.** There was a second, under `body.practice`, for the half of
  the app that was not the daily: tokens only, with no component knowing the
  page had changed colour. The daily went and it went with it — the mechanism
  is in the history if a light/dark pair ever wants it.
- **Three radii, each meaning something.** `1px` is paper (inputs, filled
  buttons), a pill is a state you are in, `50%` is a dot (the help `?`).
- **Readings are set in the serif, on the line, with tabular figures**, so a
  column of decibels lines up. There used to be a hand-lettered face for chord
  symbols; it went with the chords.
- **Webfonts never block rendering.** The `<link>` carries `data-href` and is
  promoted by script only when the page is served; every family has a real
  fallback, so the page reads the same offline in the fallback faces.

Checked at 430px as well as 1280px, and with the webfonts both loaded and
blocked.

## Layout

```
index.html          shell and markup
styles.css          the design system, as tokens and components
src/audio.js        the whole suite's sound: piano, kit, bed, loops
src/eq/  comp/      one directory per tool: the DSP, the A/B player, the plugin
src/image/ verb/
src/echo/ heat/
src/fx/             what more than one tool needs: FFT, impulse response
                    reading, the shared panel furniture, worklet stringifying
src/notes/          what each tool is for, in prose, for the person using it
src/read.js         the reading envelope: what a measurement is, and of what
src/gap.js          comparing two readings without knowing their kind
src/analysis/       the other half: loudness, crest, balance, width, and the
                    page that shows them
src/tools/          one file per tool: what it is, and how to open one
src/work/           one file per tool: the exercises over it, and the marking
src/bench/          the registry, the session, the picker, the attempt log,
                    and the guided path's order
src/random.js       seeded PRNG, so a puzzle is a function of its seed
src/game.js         the round, over whichever tool is asking (pure, no DOM)
src/stats.js        localStorage persistence per tool and tier, and the
                    export/import that is the only way off this browser
src/engrave.js      accidentals, set properly
src/main.js         DOM wiring
scripts/            the single-file bundler, and the module order it derives
tests/              node:test coverage of all of the above
```

Game logic is deliberately DOM-free, which is what let one shell serve seven
modes — and what lets the modes be tested without a browser.

**The EQ curve is checked against the audio itself.** A drawn curve that drifts
from the sound is worse than no curve, so every band type is compared with
`BiquadFilterNode.getFrequencyResponse`, and the whole chain is measured by
rendering tones through the player's own graph offline. Both agree to
**0.000 dB**. Two real faults came out of that check: Web Audio reads `Q` as
*decibels of resonance* on a low-pass or high-pass where it is a plain Q on a
peak (3.7 dB of error at the corner), and a band switched off was parked at its
corner frequency rather than taken out of circuit, so an "off" low-pass was
still taking three quarters of a decibel off 12 kHz that the curve did not show.

The rest of the audio is checked the same way — by rendering it, not by
listening hopefully. That is how the fix exercises above were confirmed to
work, how the stereo mode was confirmed to be a real image rather than a level
difference, and how a long list of genuine bugs were found: an attack knob that
measured 32 ms when set to 20, because the detector was fed a rectified level
that falls to zero twice a cycle; a reverb whose early/late control measured
0.00 dB, because taps set by amplitude are one sample against a tail of a
hundred thousand; a mono-compatibility reading that charged a hard-panned
sound three decibels it does not lose; and a saturator that put inharmonic
junk 10 dB under a hi-hat until it was made to run eight times faster than the
signal.

Where a number in this codebase came from a measurement rather than from
arithmetic, the comment above it says what was measured. The compressor's
tolerances record what a two-decibel threshold error reads as against the drum
bed; the reverb's record what a decay fifteen per cent too long reads as; the
saturator's record how much drive it takes before a given curve is audible at
all. Those paragraphs are for whoever changes the number, and they stay in the
code beside it.
