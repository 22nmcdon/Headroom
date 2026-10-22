import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TOOL_IDS as MODE_IDS } from '../src/bench/registry.js';
import { MODULES, moduleOrder, stranded, allSources } from '../scripts/modules.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = promisify(execFile);

/**
 * The published page is the bundle, not the modules - so the bundle is what
 * has to be known-good. It went out broken once: two modules had grown a
 * function of the same name, which is nothing in separate scopes and a
 * SyntaxError in one, and a script that does not parse leaves a page whose
 * every control is empty. Nothing about that is visible in the source.
 */
test('the bundle builds, parses, and carries the whole app', async () => {
  await run(process.execPath, [join(root, 'scripts', 'build-artifact.mjs')]);
  const page = await readFile(join(root, 'dist', 'headroom.html'), 'utf8');

  assert.match(page, /<title>Headroom<\/title>/, 'the artifact keeps its name');
  assert.ok(!/<!doctype|<html|<body/i.test(page), 'an artifact brings its own skeleton');
  assert.ok(!/^import\s|^export\s/m.test(page), 'module keywords cannot survive into one scope');

  // Named exports, all the way down. `export default X` flattens to
  // `const <basename> = X`, which is how src/tools/eq.js, src/work/eq.js and
  // src/notes/eq.js would have collided three ways on `const eq` - so nothing
  // in this tree has a default export any more, and the names are explicit.
  for (const name of ['EQ_TOOL', 'EQ_WORK', 'EQ_NOTES', 'COMP_WORK', 'HEAT_EXERCISES']) {
    assert.match(page, new RegExp(`const ${name} = `), `${name} is missing from the bundle`);
  }
  for (const id of MODE_IDS) {
    assert.ok(page.includes(`src/tools/${id}.js`), `${id} has no tool in the bundle`);
  }
  assert.ok(!/^export default /m.test(page), 'a default export would flatten to its basename');
}, { timeout: 30000 });

test('no two modules declare the same top-level name', async () => {
  // The same check the bundler runs, asserted here so the failure arrives with
  // the test suite rather than at publishing time.
  // Every module the bundle carries, not a copy of the list. A hand-kept copy
  // goes stale the moment a file moves, and then this check quietly stops
  // checking the files it was written for.
  const sources = await Promise.all(
    MODULES.map(async (path) => [path, await readFile(join(root, 'src', path), 'utf8')]),
  );

  const owner = new Map();
  for (const [path, source] of sources) {
    for (const [, name] of source.matchAll(/^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)) {
      assert.ok(!owner.has(name) || owner.get(name) === path,
        `${name} is declared in both ${owner.get(name)} and ${path}`);
      owner.set(name, path);
    }
  }
});

/* --- the module list ------------------------------------------------------ */

test('the order is the one the imports say it is', async () => {
  // It used to be hand-written, and a hand-written order of nearly fifty files
  // has two silent failure modes: leave a file out and the page dies at run
  // time on the first name nothing declared; put one in the wrong place and
  // it is not an error at all, it is a control that comes up empty.
  const order = await moduleOrder();
  const at = new Map(order.map((path, i) => [path, i]));

  for (const path of order) {
    const source = await readFile(join(root, 'src', path), 'utf8');
    const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';

    for (const [, target] of source.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
      const parts = (folder ? folder.split('/') : []).concat(target.split('/'));
      const out = [];
      for (const part of parts) {
        if (part === '.' || part === '') continue;
        if (part === '..') out.pop();
        else out.push(part);
      }
      const wanted = out.join('/');

      assert.ok(at.has(wanted), `${path} imports ${wanted}, which is not in the bundle`);
      assert.ok(at.get(wanted) < at.get(path),
        `${wanted} is flattened after ${path}, which imports it`);
    }
  }

  assert.equal(order.at(-1), 'main.js', 'the entry point is flattened last');
  assert.equal(new Set(order).size, order.length, 'a module appears once');
});

/**
 * Files that are written and not yet wired in, named one at a time.
 *
 * The sketchpad is being built before it has anywhere to appear: the MIDI
 * exporter is finished, tested and reachable from nothing, which is the one
 * case this check cannot tell from somebody forgetting. So it is listed here
 * rather than waved through by a pattern, and the list is checked exactly -
 * a new stranded file somewhere else still fails, and wiring one of these in
 * without taking it off the list fails too.
 *
 * Every line here is a promise to come back. Delete it when the sketchpad has
 * a page.
 */
const NOT_WIRED_IN_YET = [
  'core/instrument.js',
  'core/track.js',
  'sketch/midi.js',
  'sketch/project.js',
  'sketch/transport.js',
];

test('nothing under src/ is stranded, except what is named as unfinished', async () => {
  // The inverse of the old check, and the one it could never make: the list is
  // now the closure of what main.js imports, so "you forgot to add it" cannot
  // happen - but "you wrote it and never wired it up" still can, and used to
  // look exactly like a file that was deliberately left out.
  assert.deepEqual(await stranded(), NOT_WIRED_IN_YET,
    'these files are not reachable from main.js');

  const every = await allSources();
  assert.equal(MODULES.length + NOT_WIRED_IN_YET.length, every.length);
  assert.deepEqual(
    [...MODULES, ...NOT_WIRED_IN_YET].sort(), every,
    'the bundle carries every source file but the ones named above',
  );
});

test('the bundle builds from an order derived fresh, not a cached one', async () => {
  // MODULES is computed at import time. If the derivation were somehow
  // order-dependent - on the filesystem's directory order, say - two runs
  // would disagree, and the one that disagreed would be the published one.
  assert.deepEqual(await moduleOrder(), MODULES);
  assert.deepEqual(await moduleOrder(), await moduleOrder());
});

test('the bundle says what encoding it is in', async () => {
  const page = await readFile(join(root, 'dist', 'headroom.html'), 'utf8');

  // It has to be inside the first kilobyte or the parser has already guessed,
  // and the page is full of em dashes and middle dots to guess wrong about.
  const at = page.indexOf('<meta charset="utf-8">');
  assert.ok(at >= 0, 'the bundle declares no character set');
  assert.ok(at < 1024, `the declaration is ${at} bytes in, which is too late to count`);
});
