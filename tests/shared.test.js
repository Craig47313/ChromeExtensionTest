// Run with: node --test tests/*.test.js
// Every file in shared/ must be byte-identical in both extensions' lib/ folders. Fix drift with scripts/sync-shared.sh.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const shared = fs.readdirSync(path.join(root, 'shared'));
const copies = ['lib', 'timecheck/lib'];

test('shared/ has the files both extensions rely on', () => {
  for (const f of ['icons.js', 'palettes.js', 'stepper.js', 'menu.js', 'controls.css', 'dates.js']) assert.ok(shared.includes(f), `${f} is in shared/`);
});

for (const dir of copies) {
  test(`${dir}/ carries an identical copy of every shared file`, () => {
    for (const f of shared) {
      const want = fs.readFileSync(path.join(root, 'shared', f));
      const file = path.join(root, dir, f);
      assert.ok(fs.existsSync(file), `${dir}/${f} is missing: run scripts/sync-shared.sh`);
      assert.ok(want.equals(fs.readFileSync(file)), `${dir}/${f} differs from shared/${f}: edit shared/ and run scripts/sync-shared.sh`);
    }
  });
}

test('dates helpers', () => {
  const D = require('../shared/dates.js');
  assert.equal(D.addDays('2026-10-30', 3), '2026-11-02');
  assert.equal(D.weekStart('2026-10-22'), '2026-10-19'); // Monday
  assert.equal(D.daysBetween('2026-10-01', '2026-10-22'), 21);
  assert.equal(D.fmtMinutes(80), '1h 20m');
});
