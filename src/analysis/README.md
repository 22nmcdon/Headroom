# analysis

The analysis view's readings: loudness, dynamics, balance, width.

Each is a measurement with a comparator beside it, wrapped in the envelope
from `lib/read.js`, so `src/gap.js` can compare two of them without knowing
which kind it has.
