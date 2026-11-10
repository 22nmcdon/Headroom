# Redesign spec: navigation, screens and plugin faces

This document is for whoever builds the redesign. Every screen it describes is
drawn on the design canvas, and that canvas is the reference for layout:

**Canvas:** https://claude.ai/artifact/LRPtn76WiQ8PFksaHpEsTr (private; ask the
owner for access)

It covers the shell, the screens and the twelve plugin faces, on desktop and on
a phone. It does **not** cover the work already under way elsewhere: the three
bugs (stereo reveal, `roundSeed`, `.cell`), dead imports, the Kalam font, README
counts and paths, and first-try drill scoring. Where this spec depends on that
work, it says so.

Nothing here changes what a plugin measures or how a round is marked. It
changes how they are shown and reached.

---

## 1. Principles

These are the rules the canvas was drawn to. When a case isn't covered below,
decide it with these.

1. **One way in.** A first visit lands on Home, not on the EQ's match
   exercise.
2. **The chassis is the same on every face.** Bypass, A/B, undo and the
   summary line are always in the same place. What differs between devices is
   the displays and the named control groups.
3. **The exercise draws outside the chassis.** This is `src/plugins/README.md`
   rule three, and it is unchanged. Targets, verdicts and hints go on the paper
   or in the answer bar, never on the face.
4. **The answer bar never scrolls away.** Play, Yours/Target, the verdict,
   Hint, Show me and Lock it in are fixed to the bottom of the window on every
   width.
5. **Nothing is too small to read.** No text under 12px. Every text pair passes
   4.5:1. Every touch target is at least 44px on a phone.
6. **No streaks, no locks.** The redesign keeps the app's stance: the path is an
   order, not a gate, and nothing counts how recently you played.

---

## 2. Tokens

### 2.1 Paper (the page)

The existing tokens stay, with one change: text that is a label or a link
accent moves off blush and gold, which fail contrast on cream.

| Token | Value | Use | Contrast on `--cream` |
|---|---|---|---|
| `--text` | `#3a332f` | body | 11.5:1 |
| `--text-soft` | `#6b615a` | secondary text | 5.5:1 |
| `--label` **(new)** | `#9a4a40` | uppercase section labels (replaces `--blush-deep` for text) | 5.6:1 |
| `--blush-deep` | `#c07f79` | borders and decoration only, never text | 2.9:1 |
| `--gold` | `#b08d57` | fills only, with charcoal text on top | — |

### 2.2 The three readings

| Reading | Fill | Text on it | Contrast |
|---|---|---|---|
| That is it | `#5c6b51` **(was `--sage` `#6f7f63`)** | white | 5.7:1 |
| Close | `#b08d57` | `#241f1d` | 5.2:1 |
| Not close | `#a4553f` | white | 5.3:1 |

`--sage` with white text is 4.3:1, which fails. Darken the fill used behind text;
the lighter sage can stay for meters.

### 2.3 The face (`.plugin`, `styles.css:990`)

| Token | Now | New | Contrast on `--face` `#3c3531` |
|---|---|---|---|
| `--ink` | cream | unchanged | 12:1 |
| `--ink-soft` | `rgba(250,246,240,.44)` (≈3.5:1, fails) | `#c8beb5` | 6.7:1 |
| `--ink-faint` | `rgba(250,246,240,.30)` (≈2.4:1, fails) | `#aba198` | 4.8:1 |
| accent | `--blush` `#d9a6a0` | unchanged | 5.8:1 |

On the display background `#1d1917`, both new values pass at roughly 9:1 and
7:1.

### 2.4 Type sizes

- **Minimum 12px everywhere**, on the face and on paper. About 60 rules in
  `styles.css` set 6.5–11px today; the smallest are the face tokens
  `--tag: 8.5px` (`:1016`) and `--tag: 7.5px` under 560px (`:1437`). Both
  become 12px.
- Face labels: 12px Jost 600, uppercase, letter-spacing 0.08–0.14em.
- Values: 15px Playfair, tabular figures. The summary line is 16px desktop and
  15px phone.
- The help and gesture lines in the face's foot strip: 12px, `--ink-soft`.

### 2.5 Sizes and spacing

- Touch targets on phone: 44px minimum. Segmented controls are 36px on desktop
  and 44px on phone.
- Knob diameter: 52–60px on desktop, 56px on phone. At the shared tablet-and-
  phone breakpoint the knob does not shrink below 52px; the grid wraps instead.
- Radii: keep the three existing meanings (1px paper, pill for a state, 50% for
  a dot).

---

## 3. The shell

### 3.1 Top bar (desktop)

A single row replaces the four stacked rows that take 284px today:

`HEADROOM · Home · Tools · Mix · Sketch · Analysis ······ Progress · ?`

- **Start here** and **Stats** leave the header. Start here becomes the Home
  page; Stats becomes Progress.
- The `EASY` status pill (`#puzzleStatus`) is removed. Difficulty is shown once,
  with the round's settings.

### 3.2 Routing and memory

- Hash routes: `#/home`, `#/tools/<tool>/<learn|drill|work>/<tier>`, `#/mix`,
  `#/sketch`, `#/analysis`, `#/progress`. A reload returns to the same place,
  and a link can point at "the reverb drill, medium".
- Remember the last route in `localStorage` (as `headroom.seenHelp` does now)
  and restore it when the URL has no hash. A first visit goes to `#/home`.
- `main.js`'s `ui` object is the source of state today. The router writes
  `ui.view`, `ui.mode`, `ui.kind` and `ui.tier` and calls the existing
  `syncView` / `fillTiers` / `startGame` path. Back and forward work through
  `hashchange`.

### 3.3 Tool page layout (desktop)

- **Left:** a grouped tool list, about 220px wide. The groups and order are
  **Tone** (EQ, Saturation), **Dynamics** (Level, Compression, Gate, De-esser,
  Limiter), **Space** (Reverb, Delay, Modulation) and **Image** (Stereo, Align).
  Each row carries three small bars for read / drill / build progress.
- **Header of the main column:** the tool's name and its one-line blurb, then
  **Learn · Drill · Work** tabs, then the difficulty pills (Easy / Medium /
  Hard) and the exercise select on the same row.
- **Above the face, on paper:** the sample select and Open a file. These are
  the round's material, not the device's.
- **Below the face, on paper:** "Your attempts" (the log), unchanged in
  content.
- Under about 900px the left list collapses into the tool-name button
  (section 6).

### 3.4 The answer bar

Fixed to the bottom of the window on every view that has a round: Tools in
Drill or Work, and Mix.

Desktop row: `Play/Stop · Yours | Target · verdict ······ Hint · Show me · Lock it in`

- The verdict is `aria-live="polite"`.
- "Put it on the controls" (today's `#onto`) appears in the bar after Show me.
- On Learn, the bar is replaced by one line: "Go to the drill".

---

## 4. Screens

### 4.1 Home (new)

- **Today:** a ten-question mixed drill set, weighted toward weak spots, with
  one button to start it. It shows which tools are in the set ("EQ · which
  octave ×3"). There is no streak and no day count.
- **Pick up where you left off:** the next path step and its progress.
- **Worth working on:** the weakest answer and what it gets mistaken for, from
  `weakestKind` and the `confused` record in `src/learn/stats.js`.
- **The path:** the twelve tools as cards in `TEACHING_ORDER`
  (`src/learn/bench/path.js:48`), each with read / drill / build bars, then a
  "Mix something" card. This replaces the 37-row path dialog.

The weighting for Today's set is new logic. A first version can be: take the
three tools with the lowest first-try rate, add one at random, and draw
questions from the drills that already exist. **This depends on first-try
scoring** landing first.

### 4.2 Learn tab

- The notes (`src/learn/notes/*.js`) become the tab's content, at 17px body
  with a 680px measure. They are no longer a collapsed `<details>`.
- Each section gets **Hear it** buttons: two short A/B examples rendered by the
  tool's own player. Examples for the compressor: "20:1, threshold nothing
  reaches" against "2:1 at −24 dB"; key unfiltered against key high-passed at
  150 Hz; peak against RMS detector.
- Sections about how the code is built (e.g. the compressor's "Why this is not
  the browser's compressor") move into a collapsed "About this plugin" at the
  end.
- A side panel shows the three steps for this tool and links to the drill.

The Hear it examples are new content and need a small amount of new data per
section: two settings objects and a sample id. The player and the settings
format already exist.

### 4.3 Drill set

- **One guess per question, then the answer.** The result states it plainly
  ("It was 4k, cut") and offers three buttons: Hear it clean, Hear the answer,
  Hear yours.
- **No directional reading that names the answer** (no "6 octaves low"). This
  is the other agent's scoring change; the screen is drawn to match it.
- A strip in the header shows the ten questions, coloured by first-try result.
- "Leave the set" is the only way out while a set is running; the main nav is
  hidden.

### 4.4 Progress (replaces the Stats dialog)

- One table with tools down the side and Drill Easy / Medium / Hard plus Work
  Easy / Medium / Hard across the top.
- Each cell shows first-try % (drills) or % solved without Show me (work), and
  the count. Fills are dark sage at 80% and above, light sage from 50%, pale
  rose under 50%, and dashed when untried. The fills differ in lightness as
  well as colour.
- A side panel shows "What you hear things as", with the top three confusions,
  each with a "Drill these two" link.
- Export and Import move here.
- The "Attempts to get there" bar chart (`ATTEMPT_BANDS`) is dropped.

The "% solved without Show me" rule for work rounds is a proposal and needs
agreeing alongside the scoring change.

### 4.5 Analysis

- **Load two built-in loops by default** so the page never opens on four empty
  charts.
- Each slot is a card showing the file name, its length, the read time, Open a
  file, and drop-to-replace.
- **Six number tiles come first**: loudness, range, true peak, crest, tightest
  and mono fold. Each states the difference from the reference in words ("2.4
  quieter than the reference").
- The charts follow (spectrum, how it moves, width), each with a one-line
  reading written on the chart.
- The service table gains "▶ As it plays there" per row.
- Play, Yours/Reference and Played as move into a fixed bottom bar.

### 4.6 Mix

- The difficulty select becomes a **list of briefs** down the left: Levels,
  Levels and placement, The whole desk, Tone, Front to back, Making room, What
  moves, Fix the mix, What is on it (from `src/mix/brief.js`). This removes the
  "Nothing at this difficulty yet" state.
- **The desk is vertical:** fader, meter, pan and room knobs, a level field you
  can type into, and Mute and Solo per strip, plus a Master strip showing LUFS
  and peak. Drums are labelled "the fixed point".
- After a submit, the five readings appear as coloured cards: how loud, tonal
  balance, where things sit, how wide, how dynamic.
- Monitoring (Full range / Mono / Small speaker) and Match loudness stay above
  the desk.

### 4.7 Sketch

- Every action gets a name: the ☰ menu becomes **Sketches ▾** and **Export ▾**,
  and +/− become **+ Add a track** and **+ Add a scene**.
- The transport gains Record, Click and "Launch on: next bar". The sketch name
  can be edited in place.
- Scene launchers become buttons labelled **▶ Scene 1**, and each row gets a
  stop button.
- **Clip states are visible:** playing (filled, ▶), starts next bar (dashed,
  ◷), and what happens after the clip (loop, 2× then next, stop).
- A clip editor sits under the grid. A track inspector on the right shows the
  instrument, the inserts by name (each opens its face), and level and pan.
- Rename the **Mic** track to **Voice**, as the README already calls it.

---

## 5. The plugin chassis

Every face is built from the same five parts, in this order.

### 5.1 Head strip

`[● On] NAME [preset ▾] ········· summary line ······ [A|B] [↶] [↷] [Gain match ±x.x]`

- **On** is bypass. The light is green when the device is in circuit. Bypass is
  the device's own control and is separate from Yours/Target, which belongs to
  the round.
- **The summary line** is the device's current state in one sentence, in
  Playfair 16px ("4:1 over −18 dB · 10 / 120 ms · −7.6 dB deepest"). Most faces
  already compute this string; it moves here from wherever it sits today.
- **A | B** are two settings slots, with "A→B" to copy. A shell-level feature:
  it stores `tool.state()` and applies it with `tool.setState()`, which every
  tool already implements. No plugin changes are needed.
- **Undo and redo** are a shell-level history of `tool.state()` snapshots,
  pushed on each `change` event (not `input`), with a cap of 50 steps. No plugin
  changes are needed.
- **Presets** are named `state()` objects. A small built-in set per tool, plus
  user presets saved to `localStorage`. Saving the target as a preset during a
  round must not be possible, because the target is not on the face.
- **Gain match** compares at equal loudness. The EQ and compressor have auto
  gain already; the other tools need a loudness reading on `LoopPlayer`
  (`src/lib/loop-player.js`), which is new engine work. Show the applied trim
  on the button.

### 5.2 Displays

- Each panel has a 12px uppercase title in `--ink-soft`.
- Axis labels are 12px, `--ink-faint` (`#aba198`), on `#1d1917`.
- A display can be draggable (EQ dots, the compressor's threshold dot, the
  de-esser's crossover line). Say so in the foot strip.

### 5.3 Control groups

- Controls sit in **named groups**, each a card (`#342e2a`, 1px `#2d2724`
  border) with a title such as "Curve · how much" or "When it opens", an
  optional note, and its knobs.
- A control that doesn't apply in the current mode is **dimmed in place**
  (opacity 0.45), never removed. This is rule three.
- Rarely used controls go behind a **More** row that shows their current
  values ("More · lookahead, range, RMS window"). On Hard it is open by default.

### 5.4 Knobs (`src/lib/knob.js`)

What exists already: vertical drag, Shift for fine (`KNOB_FINE`), and
double-click to reset (`:137`).

What to add:

- **Click (tap) the value to type it.** The value above each knob becomes an
  `<input type="text">`. It accepts units ("400", "400 Hz", "0.4k", "−18",
  "4:1"), commits on Enter or blur, and cancels on Escape.
- **Alt/Option-click** also resets (the Logic and Pro Tools convention).
- **The knob being held gets a 3px gold ring** (`rgba(226,196,143,.55)`).
- The range input stays the source of truth and the screen-reader control,
  exactly as now.

### 5.5 Mode switches

Segmented buttons, 36px tall on desktop and 44px on phone. The selected
segment is a blush fill with charcoal text. On a phone they scroll sideways and
never wrap.

### 5.6 Foot strip

The gestures, in 12px: "Click a value to type it · Shift for fine ·
Double-click to reset". Add the one line about this device that matters most
("Judge it level-matched — a limiter that made it louder will always seem to
have helped").

Remove anything written for developers, for example the compressor's advice
"…and the plan says so".

---

## 6. Phone (under ~600px)

### 6.1 Screen layout (844px tall)

| Part | Height |
|---|---|
| Header: ☰ · tool name ▾ (opens a grouped picker sheet) · Progress | 56 |
| Round chips: `Work ▾` · `Easy · Match ▾` · `Drums ▾` | 56 |
| Face head: On · name · ↶ · A\|B · ⋯ (the ⋯ holds preset, redo, gain match) | 52 |
| **Display \| Knobs toggle**, plus the device's live reading | 52 |
| The view | ~484 |
| Answer bar: verdict, Hint, Show me, then Play · Yours\|Target · Lock it in | 132 |

### 6.2 The toggle (instead of scrolling)

- **Display** shows the summary line, display tabs (one display at a time), a
  tall display, and the mode switch.
- **Knobs** shows the control groups.
- The live reading in the toggle row is the one number to watch while turning
  knobs, so neither view hides the effect of a change:

| Tool | Live reading |
|---|---|
| Compressor, gate, de-esser | gain reduction |
| Limiter | gain reduction |
| Level | integrated LUFS |
| Stereo | mono cost and correlation |
| EQ | output level |
| Saturation | harmonic total |
| Reverb, delay | decay |
| Modulation | rate |
| Align | correlation at zero |

- The toggle remembers its state per tool. Above 600px both views sit together
  and the toggle isn't shown.

### 6.3 Busy faces get group tabs

**A face with more than nine controls** gets tabs inside its Knobs view, one
group at a time and at most five knobs plus one selector per tab. Measured on
the Stereo face, its 15 knobs and 3 selectors need about 680px against the
484px available.

| Face | Tabs |
|---|---|
| Stereo | Width · Bottom · Side · Place |
| Reverb | Time · Tone · Character |
| Delay | When · Path · Machine · Stereo |
| Saturation | Drive · Curve · Out |

- **A gold dot on a tab** means something in that group is off its default.
- **Changed values are drawn in gold.**
- A compact live display stays above the tabs (Stereo: a seven-band width
  strip).

Faces with nine or fewer controls stay flat. The compressor's nine fit in the
484px.

---

## 7. Face by face

What is shown, how it's grouped, and what is new. "New" means the face doesn't
have it today and it needs work beyond layout.

| Face | Displays | Groups | New |
|---|---|---|---|
| **EQ** | Curve over analyser (tilt, speed); in/out level | Six band buttons; selected band: type, slope (dimmed unless it's a cut), freq, gain, Q; Listen: solo band, band off | Band buttons 44px with state ("+4.0", "off") |
| **Saturation** | Transfer; harmonic series 2–10 (Output / Only the heat); in/out | Into the curve (drive); the curve's own knobs (soft clip: bias, hardness · tape: speed, bias · tube: bias, bloom · transformer: core · rectify: amount · fold: folds · crush: bits, hold, dither); Out of it (tone, mix) | **E/O under each bar**; even = light gold `#e2c48f`, odd = rose `#c07f79` (differ in lightness, not hue alone) |
| **Level** | Meter column I / S / M with a numbers table; short-term LUFS over time (before and after) | Trim (large) | Window 10 s / 30 s / All; **nudge buttons** ±0.5 and ±1 dB |
| **Compressor** | GR meter; in → out with a draggable threshold dot; GR over the loop with hits marked; in/out | Curve (threshold, ratio, knee); Timing (attack, release, auto release); Output (makeup, mix, auto gain); Side chain row (key, HP, LP, peak/RMS, listen to the key); More (lookahead, range, RMS window) | Family moves into the head strip |
| **Gate** | Open and shut over the loop (with floor); in → out; what it did | When it opens (threshold, hysteresis); How far it shuts (range, ratio); How fast (attack, hold, release) | — |
| **De-esser** | **Where it listens** (spectrum with the band shaded, draggable crossover); reduction word by word; what it did | Where (crossover); How much (threshold, ratio, range); How fast (attack, release); Turns down: band only / whole voice; Hear the band | **The spectrum display** |
| **Limiter** | **Waveform with shaved peaks** and GR above; what it cost (in/out table) with a PLR-spent bar | Into it (drive); How it holds (ceiling, release, knee); Out (output); Held by: limiter / clipper / clip → limit; Ceiling counts: true peak / sample | **The waveform display** |
| **Reverb** | The room (impulse response labelled pre-delay / early / late); decay low / mid / high | Space (Room, Plate, Gated, Reverse, Spring) + Freeze; Time (pre-delay, decay, size); Blend (mix); Tone (LF decay, HF decay, low cut, high cut); Character (early, spread, tension, shimmer) | Foot shows the knob setting against the measured value ("1.80 s set, 1.70 s measured") |
| **Delay** | Repeats over one bar with the note grid dashed, L up / R down; dies away low / mid / high | When (note select, time, feedback, mix); The repeat path (tone, low cut, diffusion); Machine (kind, wow, flutter, duck; time moves); Stereo (heads, offset, ping-pong) | — |
| **Modulation** | What is moving (L/R over 4 s); **Where it is wired** as a small Oscillator → target → out diagram | The six effects as buttons saying what each moves (read head / all-pass corner / a gain); The oscillator (rate, depth, feedback dimmed unless flanger or phaser); Shape and timing (sync, shape, sides) | Replaces the mostly-empty "wired" panel |
| **Stereo** | The field (vectorscope plus a correlation strip); width by band with mono cost under each band | Width, three bands (low, mid, high, low ends, top starts, slope); The bottom (mono below, bass width); Make side from middle (kind, widen, time, detune); Where it sits (pan law, pan, width lean); Listen: Stereo / Mono / Side only | Mono cost per band |
| **Align** | The two added up (comb, first notch marked); where they line up (cross-correlation, peak marked) | Delay (ms, with samples and cm under it); Far mic level; Flip the far mic (Ø); Listen to: both / close / far | — |

**Deliberately left out:** an auto-align button on Align, because it would
solve the exercise.

---

## 8. What needs more than layout

Plan these as their own pieces of work, roughly smallest first.

1. **Tokens and type sizes** (section 2). CSS only.
2. **Typed values and Alt-click reset in `knob.js`** (5.4). One file, applies
   everywhere.
3. **Undo/redo and A/B slots** at shell level (5.1). Built on `state()` and
   `setState()`; no plugin changes.
4. **Hash routing and remembered state** (3.2).
5. **Shell layout:** top bar, tool sidebar, Learn/Drill/Work tabs, fixed answer
   bar (3.1, 3.3, 3.4).
6. **The chassis:** head strip, named groups and foot strip for all twelve
   faces (section 5). This overlaps with the planned `PluginFace` base class from
   the code review, and should be done together with it.
7. **Phone:** the toggle and group tabs (section 6).
8. **Progress page** (4.4).
9. **Home and Today's set** (4.1). Depends on first-try scoring.
10. **Presets** (5.1).
11. **Gain match on every tool** (5.1). New loudness reading on `LoopPlayer`.
12. **New displays:** de-esser spectrum, limiter waveform, stereo per-band mono
    cost (section 7).
13. **Learn tab Hear it examples** (4.2). New data per notes section.
14. **Analysis, Mix and Sketch screen changes** (4.5–4.7).

Items 1–2 are small, don't touch scoring, and are safe to start alongside the
other agent's work. Items 6 and 7 touch every `plugin.js`, so they should wait
until the bug fixes in those files have merged.

---

## 9. Open questions

- **Gain match: global or per tool?** The canvas draws it per tool in the head
  strip.
- **Work-round progress:** should a round solved after Show me count? The
  Progress page assumes it doesn't.
- **Today's set:** the same ten questions for everyone (the README's planned
  "daily drill") or weighted per person (as drawn)? They could be two separate
  things.
- **Hard tier and "More":** should Hard open the More row by default, as
  proposed, or should it stay a user choice?
