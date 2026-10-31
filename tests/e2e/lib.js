// Browser tests for both extensions, driven by Playwright with the real extensions loaded in Chromium.
//
//   node tests/e2e/run.js            run everything
//   node tests/e2e/run.js queue      run the files whose name contains "queue"
//
// Needs Playwright (npm i -D playwright, or set PLAYWRIGHT_PATH) and a Chromium build (set CHROME if it isn't
// found under PLAYWRIGHT_BROWSERS_PATH or ~/.cache/ms-playwright). These are not part of `node --test`.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function find(...candidates) {
  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  return null;
}

function loadPlaywright() {
  const tries = [process.env.PLAYWRIGHT_PATH, 'playwright', '/opt/node22/lib/node_modules/playwright'].filter(Boolean);
  for (const t of tries) {
    try {
      return require(t);
    } catch (_) {
      /* try the next */
    }
  }
  throw new Error('Playwright not found: install it or set PLAYWRIGHT_PATH');
}

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers', path.join(os.homedir(), '.cache/ms-playwright')].filter(Boolean);
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const d of fs.readdirSync(root).filter((n) => n.startsWith('chromium-')).sort().reverse()) {
      const hit = find(path.join(root, d, 'chrome-linux64/chrome'), path.join(root, d, 'chrome-linux/chrome'), path.join(root, d, 'chrome-mac/Chromium.app/Contents/MacOS/Chromium'));
      if (hit) return hit;
    }
  }
  throw new Error('Chromium not found: set CHROME');
}

const ROOT = path.join(__dirname, '..', '..');
const TC = path.join(ROOT, 'timecheck');
const INK = ROOT;
const TC_ID = 'dadagbofodnllhcohbhmjkdolklihcgn'; // fixed by the manifest key

// Open Chromium with these extensions loaded. Returns { ctx, ids: {dir → id}, sws: {id → service worker} }.
async function launchMany(dirs, { width = 380, height = 900, scheme = 'light' } = {}) {
  const { chromium } = loadPlaywright();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'inkpw-'));
  const list = dirs.join(',');
  const ctx = await chromium.launchPersistentContext(profile, {
    executablePath: findChrome(),
    headless: false,
    args: ['--headless=new', `--disable-extensions-except=${list}`, `--load-extension=${list}`, '--no-sandbox'],
    viewport: { width, height },
    colorScheme: scheme,
  });
  const sws = {};
  const t0 = Date.now();
  while (Object.keys(sws).length < dirs.length && Date.now() - t0 < 20000) {
    for (const w of ctx.serviceWorkers()) sws[w.url().split('/')[2]] = w;
    await new Promise((r) => setTimeout(r, 150));
  }
  const names = {};
  for (const [id, w] of Object.entries(sws)) {
    const manifest = await w.evaluate(() => chrome.runtime.getManifest().name);
    names[/Timecheck/.test(manifest) ? 'timecheck' : 'inkwell'] = id;
  }
  return { ctx, sws, ids: names };
}

// Wrap a page so any uncaught error or console.error is collected.
function watch(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return errors;
}

async function openTimecheck(opts = {}) {
  const { ctx, sws, ids } = await launchMany([TC], opts);
  const page = await ctx.newPage();
  const errors = watch(page);
  await page.goto(`chrome-extension://${ids.timecheck}/today.html?view=panel`);
  await page.waitForSelector('#arName');
  return { ctx, page, id: ids.timecheck, sw: sws[ids.timecheck], errors };
}

async function openInkwell(opts = {}) {
  const { ctx, sws, ids } = await launchMany([INK], { width: 1100, height: 900, ...opts });
  const page = await ctx.newPage();
  const errors = watch(page);
  await page.goto(`chrome-extension://${ids.inkwell}/app.html?tab=1`);
  await page.waitForTimeout(1000);
  return { ctx, page, id: ids.inkwell, sw: sws[ids.inkwell], errors };
}

// Poll until fn() is truthy.
async function until(fn, { timeout = 10000, every = 120, what = 'condition' } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, every));
  }
}

module.exports = { launchMany, openTimecheck, openInkwell, until, watch, TC, INK, TC_ID };
