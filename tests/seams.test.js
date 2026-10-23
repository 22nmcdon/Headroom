import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// The shape of the tree, held by something other than good intentions.
//
// Every rule here was true when it was written and none of them were enforced,
// which is how three of them had already been broken: lib/ imported upward
// into four plugins, five of the six plugins imported the compressor to get a
// biquad, and the EQ could not build its own filters without importing the
// sketchpad. A seam nothing checks is a seam that closes.

const SRC = new URL('../src/', import.meta.url);

/** Every source file, as a path under `src/`. */
async function sources(at = '') {
  const found = [];
  for (const entry of await readdir(new URL(at, SRC), { withFileTypes: true })) {
    const path = at + entry.name;
    if (entry.isDirectory()) found.push(...await sources(`${path}/`));
    else if (entry.name.endsWith('.js')) found.push(path);
  }
  return found.sort();
}

/** What one file imports, as paths under `src/`. */
async function importsOf(path) {
  const source = await readFile(new URL(path, SRC), 'utf8');
  const here = path.includes('/') ? path.slice(0, path.lastIndexOf('/')).split('/') : [];
  return [...source.matchAll(/from\s+['"](\.[^'"]+)['"]/g)].map((m) => {
    const out = [];
    for (const part of here.concat(m[1].split('/'))) {
      if (part === '.' || part === '') continue;
      if (part === '..') out.pop();
      else out.push(part);
    }
    return out.join('/');
  });
}

const folder = (path) => (path.includes('/') ? path.slice(0, path.indexOf('/')) : '');

test('a plugin imports nothing but lib', async () => {
  // The whole of the standalone question is this one rule. A face may reach
  // for a knob, a meter, a transform; it may not reach for the thing that
  // opened it. The day one of them imports learn/ is the day lifting a plugin
  // out of this app stops being a port and starts being a rewrite.
  //
  // Which is also rule two on the face, from the other side: the plugin shows
  // what is, the exercise shows what should be, and the exercise is the one
  // that knows about the plugin.
  const wrong = [];
  for (const path of await sources()) {
    if (folder(path) !== 'plugins') continue;
    const mine = path.split('/').slice(0, 2).join('/');
    for (const target of await importsOf(path)) {
      const to = folder(target);
      const ok = to === 'lib' || target.startsWith(`${mine}/`);
      if (!ok) wrong.push(`${path} -> ${target}`);
    }
  }
  assert.deepEqual(wrong, [], 'plugins may import lib/ and their own folder, nothing else');
});

test('lib is the bottom of the tree', async () => {
  // It is only a library if nothing in it needs anything above it. gap.js was
  // filed here and dispatches to comparators that live in six other folders,
  // which made the bottom layer depend on the whole tree; it sits at the root
  // now, where a thing that depends on everything belongs.
  const wrong = [];
  for (const path of await sources()) {
    if (folder(path) !== 'lib') continue;
    for (const target of await importsOf(path)) {
      if (folder(target) !== 'lib') wrong.push(`${path} -> ${target}`);
    }
  }
  assert.deepEqual(wrong, [], 'lib/ may import only lib/');
});

test('the DSP a plugin is built on knows nothing about a browser', async () => {
  // The other half of the standalone question, and the cheaper half to keep:
  // the maths is plain functions over plain arrays. Web Audio belongs to the
  // node and the player, which are the parts a port would replace anyway.
  const CORES = [
    'plugins/saturation/shape.js',
    'plugins/compressor/dsp.js',
    'plugins/eq/filters.js',
    'plugins/stereo/field.js',
    'plugins/delay/line.js',
    'plugins/reverb/ir.js',
    'lib/fft.js',
    'lib/dsp.js',
  ];
  const BROWSER = /\b(AudioContext|OfflineAudioContext|AudioNode|AudioParam|AudioBuffer|AudioWorklet|createGain|document|window|navigator)\b/;

  for (const path of CORES) {
    const source = await readFile(new URL(path, SRC), 'utf8');
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    const hit = code.match(BROWSER);
    assert.equal(hit, null, `${path} names ${hit?.[0]}`);
  }
});

test('every folder says what it is', async () => {
  // The README is orientation, not law - anything in one that reads like a
  // rule is either enforced by a test named in it or does not belong there.
  // This only checks that each one exists, which is the part that rots.
  const WANT = [
    '', 'plugins', 'plugins/eq', 'plugins/compressor', 'plugins/saturation',
    'plugins/stereo', 'plugins/delay', 'plugins/reverb',
    'learn', 'lib', 'core', 'sketch', 'mix', 'analysis', 'tools',
  ];
  for (const at of WANT) {
    const names = await readdir(new URL(at ? `${at}/` : '', SRC));
    assert.ok(names.includes('README.md'), `src/${at} has no README.md`);
  }
});

test('the folder graph is the one that is written down', async () => {
  // Not a rule so much as a tripwire: if a new edge appears between two
  // folders, it should be a decision somebody made rather than an import
  // somebody typed. Update this and the README in the same commit.
  const ALLOWED = {
    '': ['analysis', 'core', 'learn', 'lib', 'mix', 'plugins', 'sketch'],
    analysis: ['', 'lib', 'plugins'],
    core: ['lib', 'plugins', 'sketch'],
    learn: ['', 'core', 'lib', 'plugins', 'tools'],
    lib: ['lib'],
    mix: ['', 'analysis', 'learn', 'lib', 'plugins', 'sketch'],
    plugins: ['lib', 'plugins'],
    sketch: ['core', 'lib', 'plugins'],
    tools: ['plugins'],
  };
  const seen = {};
  for (const path of await sources()) {
    const from = folder(path);
    for (const target of await importsOf(path)) {
      const to = folder(target);
      if (to === from && from !== 'plugins') continue;
      (seen[from] ??= new Set()).add(to);
    }
  }
  for (const [from, tos] of Object.entries(seen)) {
    const extra = [...tos].filter((t) => !(ALLOWED[from] ?? []).includes(t)).sort();
    assert.deepEqual(extra, [], `src/${from} now imports from ${extra.join(', ')}`);
  }
});
