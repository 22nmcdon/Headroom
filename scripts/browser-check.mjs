// The browser checks, all of them, against a server this starts itself.
//
//   npm run check:browser               every check
//   npm run check:browser -- faces eq-curve    only those
//
// Exits non-zero on a problem, and zero with a message if there is no browser
// to run in - a checkout without playwright is not a checkout with a broken
// test suite.

import { serve, launch } from '../tests/browser/harness.mjs';

const CHECKS = ['faces', 'inserts', 'chain', 'tracks', 'wide', 'shape', 'knobs', 'decks',
  'eq-curve', 'stereo', 'tone', 'order'];

const asked = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const wanted = asked.length ? CHECKS.filter((c) => asked.includes(c)) : CHECKS;
const unknown = asked.filter((a) => !CHECKS.includes(a));
if (unknown.length) {
  console.error(`no such check: ${unknown.join(', ')}\nthere is: ${CHECKS.join(', ')}`);
  process.exit(2);
}

const { browser, skip } = await launch();
if (skip) {
  console.log(`skipped — ${skip}`);
  process.exit(0);
}

const server = await serve();
console.log(`serving ${server.at}\n`);

let failed = 0;
for (const name of wanted) {
  const lines = [];
  const say = (...parts) => lines.push(`   ${parts.join(" ")}`);
  let problems;
  try {
    const module = await import(`../tests/browser/${name}.mjs`);
    problems = await module.check({ browser, at: server.at, say });
  } catch (err) {
    problems = [`threw: ${err.message}`];
  }

  const quiet = problems.length === 0;
  console.log(`${quiet ? '  ok' : 'FAIL'}  ${name}`);
  // The working is only interesting when something is wrong, or when somebody
  // asked for one check by name and wants to see what it saw.
  if (!quiet || asked.length) for (const line of lines) console.log(line);
  for (const problem of problems) console.log(`      ${problem}`);
  if (!quiet) failed += 1;
}

await browser.close();
await server.stop();

console.log(failed ? `\n${failed} of ${wanted.length} failed` : `\nall ${wanted.length} clean`);
process.exit(failed ? 1 : 0);
