# analysis

The analysis view's readings: dynamics, balance, width, and the loudness one
that now lives in `lib/loudness.js` because the level tool reads it too.

    page.js       the view: two slots, the figures, the pictures
    dynamics.js   crest factor, over time
    balance.js    where the weight sits, a third of an octave at a time
    width.js      how wide it is, band by band, and what mono costs
    delivery.js   what a service will do with it, and how to hear that

Each reading is a measurement with a comparator beside it, wrapped in the
envelope from `lib/read.js`, so `src/gap.js` can compare two of them without
knowing which kind it has.

## The delivery panel is the one place a number is not measured

Every figure in `lib/targets.js` is somebody's published policy: what Spotify
normalises to, what EBU R 128 asks for. Policy changes without telling anybody
and cannot be measured from here, so each row carries where it came from and
how direct that source is, and the table carries the date it was last looked
at. Two rows are published standards, one is a company's own guidance to the
people delivering to it, and the other five are widely reported with no
first-party source anybody has been able to point at - which is a real finding
about those figures rather than a disclaimer.

Everything to the right of the figures is arithmetic on your own file and is
tested: the gain a service applies, where that leaves the true peak, and what
two masters of the same music come out at once both have been normalised.

## It keeps the buffer now

The page used to read a file and drop it. That was right while nothing here
could play; the delivery panel can, because the argument it is making needs
sound. Two masters at the same playback loudness with one of them audibly
flatter is a demonstration. "Normalisation makes mastering loud pointless" is
an argument, and nobody has ever been convinced by one.
