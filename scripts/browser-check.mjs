// The browser checks, all of them, against a server this starts itself.
//
//   npm run check:browser                      every check
//   npm run check:browser -- faces eq-curve    only those
//   npm run check:browser -- --shard=2/4       the second of four even shares,
//                                              which is how CI runs them
//
// Exits non-zero on a problem, and zero with a message if there is no browser
// to run in - a checkout without playwright is not a checkout with a broken
// test suite. The list, and how it is split, are in scripts/checks.mjs.

import { serve, launch } from '../tests/browser/harness.mjs';
import { CHECKS, PENDING, shardsOf, shardArgument } from './checks.mjs';

const args = process.argv.slice(2);
const asked = args.filter((a) => !a.startsWith('-'));
const unknown = asked.filter((a) => !CHECKS.includes(a) && !PENDING.includes(a));
if (unknown.length) {
  console.error(`no such check: ${unknown.join(', ')}\nthere is: ${CHECKS.join(', ')}`);
  process.exit(2);
}

let shard;
try {
  shard = shardArgument(args);
} catch (err) {
  console.error(err.message);
  process.exit(2);
}
if (shard && asked.length) {
  console.error('--shard splits the whole list; it cannot be given checks by name as well');
  process.exit(2);
}

const share = shard ? shardsOf(CHECKS, shard.count)[shard.index] : null;
const wanted = asked.length ? [...CHECKS, ...PENDING].filter((c) => asked.includes(c))
  : share ? CHECKS.filter((c) => share.checks.includes(c))
    : CHECKS;
if (share) {
  console.log(`shard ${shard.index + 1} of ${shard.count}: ${wanted.length} checks, `
    + `about ${Math.round(share.seconds / 60)} min on a GitHub runner`);
}

// A skip is the right answer on a bare checkout and the wrong one in CI,
// where it would be a green tick for a run that checked nothing - so with
// CI set (GitHub sets it on every run) a missing browser is a failure.
const { browser, skip } = await launch();
if (skip) {
  console.log(`skipped — ${skip}`);
  process.exit(process.env.CI ? 1 : 0);
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
