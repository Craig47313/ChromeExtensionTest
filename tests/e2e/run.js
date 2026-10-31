// Runs the browser tests in this folder. See lib.js for what they need.
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const filter = process.argv[2] || '';
  const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('.e2e.js') && f.includes(filter)).sort();
  let failed = 0;
  for (const f of files) {
    const t0 = Date.now();
    const tests = require(path.join(__dirname, f));
    for (const [name, fn] of Object.entries(tests)) {
      try {
        await fn();
        console.log(`ok   ${f} · ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
      } catch (err) {
        failed++;
        console.log(`FAIL ${f} · ${name}\n     ${String(err.stack || err).split('\n').slice(0, 4).join('\n     ')}`);
      }
    }
  }
  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
