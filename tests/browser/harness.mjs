// Running the app in a real browser, which is the only place some of this is
// true.
//
// `npm test` is 543 assertions about arithmetic and it has never once caught a
// layout fault, because layout is not arithmetic. These are what caught: a
// class name living inside a string that every rename missed, so the stereo
// plugin could not be put into an exercise while all 528 tests passed; a deck
// whose sixth button set the width of the whole chassis and pushed the knobs
// out through the side of it at 932x430; a knob stranded alone on a second
// row; a plugin that mounted a second copy of itself over the first.
//
// They lived outside the repository until now, which meant they ran when
// somebody remembered to run them and never otherwise. That is the same
// failure as not having them.
//
// Playwright is the one dependency this project has, it is a dev dependency,
// and nothing that ships touches it: `npm test` runs on a bare checkout with
// no node_modules at all, and so does the bundler. If it is missing these
// skip and say so rather than failing, so a checkout without it is not a
// checkout with a broken test suite.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
};

/**
 * The app, over HTTP, because ES modules will not load over file://.
 *
 * Its own server rather than one somebody starts first: a check that needs a
 * terminal prepared for it is a check that silently does not run.
 */
export async function serve() {
  const server = createServer(async (req, res) => {
    const asked = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const path = join(ROOT, normalize(asked === '/' ? '/index.html' : asked));
    if (!path.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(path);
      res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });

  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const { port } = server.address();
  return {
    at: `http://127.0.0.1:${port}/`,
    stop: () => new Promise((ok) => server.close(ok)),
  };
}

/**
 * A browser, or a reason there is not one.
 *
 * `executablePath` is only passed when something tells us where to look.
 * Hard-coding the one this machine happens to have would be a check that runs
 * nowhere else, which is most of why these were worth moving in.
 */
export async function launch() {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    return { skip: 'playwright is not installed — run `npm i` to enable the browser checks' };
  }

  const where = process.env.HEADROOM_CHROMIUM;
  try {
    const browser = await chromium.launch({
      ...(where ? { executablePath: where } : {}),
      args: ['--autoplay-policy=no-user-gesture-required'],
    });
    return { browser };
  } catch (err) {
    return {
      skip: `chromium would not start (${err.message.split('\n')[0]}). `
          + 'Set HEADROOM_CHROMIUM to a binary, or run `npx playwright install chromium`.',
    };
  }
}

/**
 * A page with the app loaded, the opening dialog shut, and anything it says
 * to the console collected.
 *
 * Console errors count as failures. Half of what these checks have caught
 * announced itself there first and nothing was listening.
 */
export async function open(browser, at, { width = 1280, height = 1000, view = null } = {}) {
  const page = await browser.newPage({ viewport: { width, height } });
  const noise = [];
  page.on('pageerror', (e) => noise.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') noise.push(`console: ${m.text()}`); });

  await page.goto(at, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
  if (view) {
    await page.click(`[data-view="${view}"]`);
    await page.waitForTimeout(250);
  }
  return { page, noise };
}

/**
 * A picture, if anybody wants one.
 *
 * Writes nothing unless HEADROOM_SHOTS names a directory. A check's job is to
 * answer a question; the pictures are for working out why the answer is no,
 * and a check that litters a repository with PNGs every run is a check people
 * stop running.
 */
export async function shot(page, name) {
  const into = process.env.HEADROOM_SHOTS;
  if (!into) return;
  await page.screenshot({ path: `${into}/${name}.png` });
}

/** Every face, by the class each one wears. */
export const FACES = '.eq, .comp, .heat, .stereo, .echo, .verb, .level, .limiter, .gate, .deess, .align';

/** And their names on the strip. */
export const TOOLS = [
  'EQ', 'Compression', 'Stereo', 'Reverb', 'Delay', 'Saturation', 'Level', 'Limiter',
  'Gate', 'De-esser', 'Align',
];

/** The three shapes the app has to work in. */
export const SIZES = [
  ['portrait', 430, 932],
  ['landscape', 932, 430],
  ['desktop', 1280, 1000],
];
