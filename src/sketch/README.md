# sketch

The sketchpad: somewhere to make something rather than be asked about it.

Clips and a grid, a transport with lookahead scheduling, tracks with
instruments and inserts, chord and step entry, recording, and export to MIDI,
stems and a zip.

`insert.js` is the seam worth knowing: it opens the **real plugin** on a
track, the same class the exercises use, and gives it a player that meters
what is passing through. In an exercise that player is absent, which is why a
levels bay reads "no meter" there rather than disappearing.
