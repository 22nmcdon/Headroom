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
> all of it (identification drills, an analysis pillar, an optional guided
> path) is being built in stages.

| Mode | What you work with | Exercises |
| --- | --- | --- |
| **EQ** | **a channel EQ** — six bands you drag over a live spectrum, with the loop running | **Match** a target move · **Fix** a sample with a resonance in it |
| **Compression** | **a compressor** — threshold, ratio, attack, release, knee, lookahead, a filtered sidechain and a key input | **Match** a target compressor · **Even out** a loop whose hits are all over the place · **Duck** one thing under another |
| **Stereo** | **an imager** — mid/side width in three bands, two movable crossovers, a pan, and mono and side monitoring | **Place** a sound · **Match** a target image · **Rescue** a low end somebody spread too wide to survive mono |
| **Reverb** | **a reverb** — decay, pre-delay, damping, early/late balance and mix | **Match** a room · **Fit** the tail to the tempo |
| **Delay** | **a delay** — time or note division, feedback, ping-pong, a filtered repeat path and mix | **Match** a delay · **Find** the note it is on |
| **Saturation** | **a saturator** — drive, bias, hardness, tone and a parallel mix, run eight times oversampled | **Match** how much · **Match** the colour · Build a warmth that is **even and not odd** |

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

**What is not here any more.** Four modes used to sit alongside these: name
the chord, name the note, name the interval, name the figure. They were cut —
a producer can have a very good pair of ears and never name a half-diminished
seventh. What is coming in their place asks the same shape of question about
the right subject: which band is boosted, how much reduction is that, even
harmonics or odd.

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
- **Per-tool progress**, per tier, including which kind of answer keeps
  catching you out — and **Export** / **Import** in the stats dialog, because
  one key in one browser's storage is not a copy. An import *adds* to what is
  already there rather than replacing it, so the same person on a phone and on
  a laptop keeps both halves; each export carries an id, so importing the same
  file twice counts it once.

## Not built yet

- **Identification drills** — name the boosted band, judge the gain reduction,
  tell even harmonics from odd. The DSP for every one of them already exists;
  the exercises do not.
- **The analysis pillar** — loading your own audio and having it read back to
  you: loudness, crest factor, spectral balance, stereo correlation per band.
- **An optional guided path** through the material.
- **A mix exercise mode** — the six tools over a few stems, with a mixer, and
  scored on the whole master.
- Any server, account or automatic sync. Progress lives in `localStorage`, and
  the way it moves between browsers is the exported file.

## Adding a tool

A tool is three files, composed by `src/bench/registry.js`:

```
src/tools/eq.js     what it is, and open(el, {engine, onChange}) -> a live plugin
src/work/eq.js      exercises over it: makePuzzle, score, hints, reveal, weak
src/notes/eq.js     the long prose, for the person using it
```

**The tool knows nothing about a puzzle, an answer or a tier.** That is the
point of the split, not tidiness: a tool that knew about answers could not be
opened without a round, which is why changing an exercise used to tear the
plugin down and stop the audio. Now the tool is what stays and an exercise is
something that arrives, sets it up, and leaves.

`src/bench/session.js` does the arriving and leaving. An exercise is data — a
source, the A/B's name, `faultOf(puzzle)`, `targetOf(puzzle)` — and `attach`
applies it in an order that matters: remember what the tool was doing, put the
material on and **wait for it**, pin it to the puzzle, then fault, target,
label, and the starting settings last so `onChange` fires once at the end.
`detach` puts back everything the exercise imposed and nothing else: the drawn
answer, the lock, the fault, the A/B. Not where the controls ended up —
somebody may want to keep working from the curve they just built.

Every tool implements the same lifecycle: `state`/`setState`, `read`/`readNow`,
`setSource(id, opts)`, `loadFile`, `setFault`, `setTarget`, `showTarget` (null
clears), `nameAB`, `lock`/`unlock`, `source`, `abLabel`, `material`, `destroy`.
`tests/session.test.js` holds the decisions to account against a fake tool made
of nothing but promises — which is how attach → detach → attach gets tested at
all, given that nothing in this app had ever reused a plugin.

### The exercise contract, in older words

A tool's work is data and six functions. It says what it asks (`slots`), how to make a puzzle
(`makePuzzle`), how to read a guess (`score(state, puzzle)`), what to say when
somebody is stuck (`hints(puzzle)`), and what the answer was (`reveal`,
`weak`). Nothing else in the app knows which tool is showing — the log, the
picker and the stats are all built from what it returns.

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

Five kinds across six tools: `curve`, `reduction`, `decay`, `image`,
`harmonics`. The reverb and the delay share `decay` on purpose — each is
completely described by what it does to one click, so "is this delay as long as
that room" is a question that can be asked. `distance` on `harmonics` is
pairwise only: its masking floor is derived from both readings at once, so
three of them cannot be ranked.

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

All six are tools, so all six return no slots: a tool is answered on the tool.
Slots are for the identification drills, which ask with chips.

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
src/tools/          one file per tool: what it is, and how to open one
src/work/           one file per tool: the exercises over it, and the marking
src/bench/          the registry, the session, the picker, the attempt log
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
