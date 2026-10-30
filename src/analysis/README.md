# analysis

The analysis view's readings: dynamics, balance, width, and the loudness one
that now lives in `lib/loudness.js` because the level tool reads it too.

Each is a measurement with a comparator beside it, wrapped in the envelope
from `lib/read.js`, so `src/gap.js` can compare two of them without knowing
which kind it has.
