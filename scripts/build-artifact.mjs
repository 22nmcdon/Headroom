// Bundles the app into one self-contained HTML page.
//
// The same page, with the stylesheet and the ES modules folded in: an artifact
// is published as a single file, and a page that fetched ./src/learn/game.js from
// somewhere it is not would simply do nothing. Nothing is minified and nothing
// is rewritten beyond the module keywords, so the bundle is the source read
// top to bottom.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { MODULES } from './modules.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');


/**
 * Strips the module keywords, so that files written to import and export each
 * other's names can share one scope instead.
 *
 * A default export has no name of its own, so it takes its file's - which is
 * exactly the name the importing file already uses for it, and is why nothing
 * in this tree imports anything under an alias.
 */
function flatten(source, name) {
  return source
    .replace(/^export\s*\{[^}]*\}\s*from\s*['"][^'"]+['"];\s*$/gm, '')
    .replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];\s*$/gm, '')
    .replace(/^export\s+default\s+/gm, `const ${name} = `)
    .replace(/^export\s+/gm, '')
    .trim();
}

/**
 * Every name a module declares at its top level.
 *
 * Flattening is only safe while no two modules declare the same one, and the
 * day that stopped being true the bundle did not fail loudly - it failed as a
 * page whose every control came up empty, because one SyntaxError takes the
 * whole script with it. `stats.js` had a `write` and `main.js` grew one.
 */
function topLevelNames(source) {
  const names = [];
  const declaration = /^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm;
  for (const [, name] of source.matchAll(declaration)) names.push(name);
  return names;
}

/**
 * Refuses to emit a bundle that is missing a file the app imports.
 *
 * A name that is never declared is not a syntax error, so the parse check at
 * the end of this script sails straight past it and the page dies at run time
 * on the first line that uses it. The module list above has to be complete,
 * and the imports are what say whether it is.
 */
function checkComplete(paths) {
  const missing = new Set();

  for (const { path, source } of paths) {
    const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';

    for (const [, target] of source.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
      // Resolve "./x.js" and "../y/z.js" against the importing file's folder.
      const parts = (folder ? folder.split('/') : []).concat(target.split('/'));
      const resolved = [];
      for (const part of parts) {
        if (part === '.' || part === '') continue;
        if (part === '..') resolved.pop();
        else resolved.push(part);
      }
      const wanted = resolved.join('/');
      if (!MODULES.includes(wanted)) missing.add(`${wanted} (imported by ${path})`);
    }
  }

  if (missing.size) {
    throw new Error(
      `these files are imported but not in the bundle's module list:\n  `
      + [...missing].join('\n  ')
      + '\nAdd them to MODULES, in dependency order.');
  }
}

/** Refuses to emit a bundle whose modules would collide once flattened. */
function checkNames(modules) {
  const seen = new Map();
  const clashes = [];

  for (const { path, code } of modules) {
    for (const name of topLevelNames(code)) {
      if (seen.has(name) && seen.get(name) !== path) {
        clashes.push(`${name} (${seen.get(name)} and ${path})`);
      } else {
        seen.set(name, path);
      }
    }
  }

  if (clashes.length) {
    throw new Error(
      `these names are declared in more than one module, and one scope cannot hold both:\n  `
      + clashes.join('\n  ')
      + '\nRename one of each pair.');
  }
}

const page = await readFile(join(root, 'index.html'), 'utf8');
const styles = await readFile(join(root, 'styles.css'), 'utf8');

const body = page
  .slice(page.indexOf('<body>') + '<body>'.length, page.indexOf('</body>'))
  .replace(/<script type="module"[\s\S]*?<\/script>/, '')
  .trim();

const fonts = /<link id="webfonts"[\s\S]*?>/.exec(page)[0];

// The name alone. In a gallery the title is how the page is picked out, and
// the half after the dash is an explainer - which belongs in the description
// the gallery card already prints underneath.
const title = 'Headroom';

const modules = [];
for (const path of MODULES) {
  const source = await readFile(join(root, 'src', path), 'utf8');
  const name = path.split('/').pop().replace(/\.js$/, '');
  modules.push({ path, source, code: flatten(source, name) });
}

checkComplete(modules);
checkNames(modules);

const code = modules.map(({ path, code: source }) => `/* ---- src/${path} ---- */\n${source}`);

// One scope, so the bundle cannot leak names into the host page.
const script = `<script type="module">\n(function () {\n${code.join('\n\n')}\n}());\n</script>`;

// No <!doctype>, <html>, <head> or <body>: an artifact is wrapped in its own
// skeleton at publish time, and a second one nested inside it is not a page.
//
// The charset is the exception, and it has to come first. Published, the
// wrapper declares one and this is ignored; opened as a file, or served by
// anything that does not name a charset in the header, nothing declares one
// at all and the browser falls back to Latin-1 - which turned every em dash
// and middle dot in the page into a pair of accented letters.
const bundle = `<meta charset="utf-8">
<title>${title}</title>
${fonts}
<style>
${styles.trim()}
</style>

${body}

${script}
`;

// And then read back what was written. A bundle is only worth having if it
// runs, and the way it fails is silent: the page renders its markup, the script
// dies on the first line, and every control that JavaScript fills comes up
// empty. Cheaper to find here than in a published artifact.
const emitted = bundle.slice(bundle.indexOf('<script type="module">') + '<script type="module">'.length,
                             bundle.lastIndexOf('</script>'));
const checkFile = join(tmpdir(), 'headroom-bundle-check.mjs');
await writeFile(checkFile, emitted);
await promisify(execFile)(process.execPath, ['--check', checkFile]);

// dist/ is gitignored, so a fresh clone does not have one and the write fails
// with ENOENT - which is what both bundle tests were failing on.
await mkdir(join(root, 'dist'), { recursive: true });
await writeFile(join(root, 'dist', 'headroom.html'), bundle);
console.log(`dist/headroom.html — ${(bundle.length / 1024).toFixed(1)} KB, parses clean`);
