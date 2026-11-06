// Bundles the app into one self-contained HTML page.
//
// The same page, with the stylesheet and the ES modules folded in: an artifact
// is published as a single file, and a page that fetched ./src/learn/game.js from
// somewhere it is not would simply do nothing. Nothing is minified and nothing
// is rewritten beyond the module statements, so the bundle is the source read
// top to bottom.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { MODULES } from './modules.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');


const NAME = '[A-Za-z_$][\\w$]*';

/** `a, b as c` as [[a, a], [b, c]]: what is read, and the name it goes by. */
const specifiers = (list) => list.split(',').map((s) => s.trim()).filter(Boolean)
  .map((s) => { const [from, as = from] = s.split(/\s+as\s+/); return [from, as]; });

/**
 * What a module exports, as exported name -> the name it has once flattened.
 *
 * Needed for `import * as x`, which is an object of them: the worklet files
 * read their dsp module's constants that way, by enumerating it.
 */
function exportsOf(source, name) {
  const out = new Map();
  for (const [, n] of source.matchAll(new RegExp(`^export\\s+(?:async\\s+)?(?:function\\*?|class|const|let|var)\\s+(${NAME})`, 'gm'))) out.set(n, n);
  for (const [, list] of source.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const [, as] of specifiers(list)) out.set(as, as);
  }
  if (/^export\s+default\s+/m.test(source)) out.set('default', name);
  if (/^export\s*\*/m.test(source)) throw new Error(`export * is not flattened (${name})`);
  return out;
}

/**
 * Strips the module keywords, so that files written to import and export each
 * other's names can share one scope instead.
 *
 * A default export has no name of its own, so it takes its file's - which is
 * the name the importing file uses for it. A name that changes on the way in
 * (`import * as x`, `import { a as b }`) is declared as a local, and the
 * module is then wrapped in a function so that two files' `dsp` cannot
 * collide; only its exports come back out. A renamed export
 * (`export { a as b }`) is a `const b = a` at the top level, where the
 * duplicate-name check below can see it.
 */
function flatten(source, path, exported) {
  const name = path.split('/').pop().replace(/\.js$/, '');
  const locals = [];

  const code = source
    .replace(/^export\s*\{([^}]*)\}\s*(?:from\s*['"][^'"]+['"])?;?[ \t]*$/gm, (_, list) =>
      specifiers(list).filter(([from, as]) => from !== as)
        .map(([from, as]) => `const ${as} = ${from};`).join('\n'))
    .replace(/^import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];[ \t]*$/gm, (_, clause, target) => {
      const from = resolve(path, target);
      const base = from.split('/').pop().replace(/\.js$/, '');
      const list = /\{([^}]*)\}/.exec(clause);
      const star = new RegExp(`\\*\\s*as\\s+(${NAME})`).exec(clause);
      const fallback = new RegExp(`^(${NAME})\\s*(?:,|$)`).exec(clause.trim());

      if (fallback && fallback[1] !== base) locals.push(`const ${fallback[1]} = ${base};`);
      if (list) {
        for (const [from, as] of specifiers(list[1])) if (from !== as) locals.push(`const ${as} = ${from};`);
      }
      if (star) {
        const names = [...(exported.get(from) ?? [])].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        const fields = names.map(([key, local]) => (key === local ? key : `${key}: ${local}`));
        locals.push(`const ${star[1]} = Object.freeze({ ${fields.join(', ')} });`);
      }
      return '';
    })
    .replace(/^export\s+default\s+/gm, `const ${name} = `)
    .replace(/^export\s+/gm, '')
    .trim();

  if (!locals.length) return code;
  const out = [...exported.get(path).values()].join(', ');
  // The locals are indented so that checkNames, which reads column 0, does
  // not count them: they are this module's own, and cannot collide.
  const head = locals.map((line) => `  ${line}`).join('\n');
  return `const { ${out} } = (() => {\n${head}\n${code}\nreturn { ${out} };\n})();`;
}

/** Where a relative import lands, as a path under `src/`. */
function resolve(from, target) {
  const folder = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '';
  const parts = (folder ? folder.split('/') : []).concat(target.split('/'));
  const out = [];
  for (const part of parts) {
    if (part === '.' || part === '') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
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

const sources = [];
for (const path of MODULES) sources.push({ path, source: await readFile(join(root, 'src', path), 'utf8') });

const exported = new Map(sources.map(({ path, source }) =>
  [path, exportsOf(source, path.split('/').pop().replace(/\.js$/, ''))]));
const modules = sources.map(({ path, source }) => ({ path, source, code: flatten(source, path, exported) }));

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
