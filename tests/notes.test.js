import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { NOTES, notesFor } from '../src/learn/notes/index.js';
import { TOOLS as MODES } from '../src/learn/bench/registry.js';
import { MODULES } from '../scripts/modules.mjs';

// Prose that nobody can reach is prose nobody wrote.
//
// This project shipped five paragraphs of coaching that were rendered into the
// page and hidden again in the same synchronous pass, for months, because
// nothing ever asserted that what was written could be read. These are the
// assertions that were missing.

const TOOLS = Object.keys(NOTES);

test('every tool has notes, and every note says something', () => {
  for (const id of TOOLS) {
    const notes = notesFor(id);
    assert.ok(notes, `${id} has no notes`);
    assert.ok(notes.title?.trim(), `${id} has no title`);
    assert.ok(notes.sections.length >= 3, `${id} has only ${notes.sections.length} sections`);

    for (const section of notes.sections) {
      assert.ok(section.heading?.trim(), `${id} has a section with no heading`);
      // Long enough to be an explanation rather than a label. The shortest
      // real one here is about forty words.
      const words = section.body.trim().split(/\s+/).length;
      assert.ok(words >= 30, `${id} / "${section.heading}" is only ${words} words`);
    }
  }
});

test('the notes cover every tool the app offers, and nothing it does not', () => {
  const surfaces = Object.entries(MODES)
    .filter(([, spec]) => spec.surface)
    .map(([id]) => id);

  for (const id of surfaces) {
    assert.ok(notesFor(id), `${id} is a tool with no notes`);
  }
  for (const id of TOOLS) {
    assert.ok(MODES[id], `notes exist for ${id}, which is not a mode`);
  }
});

test('nothing reaches across and hides what another function owns', () => {
  // The specific bug, as a guard. mountSurface used to do
  //
  //     $('#advice').hidden = $('#advice').hidden || !!own
  //
  // reaching past buildClue, which had written that element three lines
  // earlier, and hiding it for exactly the modes that had anything to put in
  // it. Five paragraphs, dark for months, because nothing ever asserted that
  // what was written could be read.
  //
  // So: whatever puts an exercise on the tool may hide the things it owns,
  // and nothing else. The function has been renamed twice since - it was
  // mountSurface, and mounting is exactly what no longer happens - but the
  // rule it is held to has not changed.
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

  const from = main.indexOf('async function putExercise()');
  const to = main.indexOf('function buildHead()');
  assert.ok(from > 0 && to > from, 'putExercise is no longer where this test looks');

  const hidden = [...main.slice(from, to).matchAll(/\$\('(#[\w-]+)'\)\.hidden\s*=/g)]
    .map((m) => m[1])
    .sort();

  // What it owns is the choice between a tool and a drill: the tool's
  // surface, the drill's panel and its clean A/B, the chips, and the clue row
  // that neither uses any more. The list grew when drills arrived, and it
  // grew for a reason - but it is still a list, and the two below are what it
  // must never grow to include.
  assert.deepEqual(hidden, ['#clue', '#drill', '#drillClean', '#picker', '#surface'],
    `putExercise writes .hidden on ${hidden.join(', ') || 'nothing'}`);

  // The two it must never grow to include. `#advice` is the specific bug
  // above; `#notes` is the same shape of thing waiting to happen.
  for (const other of ['#advice', '#notes']) {
    assert.ok(!hidden.includes(other), `putExercise hides ${other}, which buildHead owns`);
  }
});

test('each tool’s DSP points at the notes that explain it', () => {
  // The two are different documents for different readers, and they are meant
  // to stay that way - but somebody arriving at the code should be told the
  // other one exists.
  const pairs = [
    ['src/plugins/eq/filters.js', 'src/learn/notes/eq.js'],
    ['src/plugins/compressor/dsp.js', 'src/learn/notes/comp.js'],
    ['src/plugins/stereo/field.js', 'src/learn/notes/stereo.js'],
    ['src/plugins/reverb/ir.js', 'src/learn/notes/verb.js'],
    ['src/plugins/delay/line.js', 'src/learn/notes/echo.js'],
    ['src/plugins/saturation/shape.js', 'src/learn/notes/heat.js'],
  ];

  for (const [code, notes] of pairs) {
    const source = readFileSync(new URL(`../${code}`, import.meta.url), 'utf8');
    assert.ok(source.includes(notes), `${code} does not point at ${notes}`);
  }
});

test('every notes file is in the bundle', () => {
  // The list is derived from what main.js imports now, so a file can no longer
  // be left out by hand - but it can be left unimported, which comes to the
  // same thing: a page where that tool silently has no notes.
  for (const file of readdirSync(new URL('../src/learn/notes', import.meta.url))) {
    const at = `learn/notes/${file}`;
    assert.ok(MODULES.includes(at), `${at} is not reachable from main.js`);
  }
});
