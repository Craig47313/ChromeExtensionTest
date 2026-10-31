const assert = require('node:assert');
const { openTimecheck, until } = require('./lib');

async function seed(page) {
  await page.evaluate(async () => {
    const P = InkPlan;
    const now = Date.now();
    const D = 86400000;
    const mk = (title, course, o = {}) => P.makeTask({ title, course, plan: null, ...o });
    await P.addTasks([mk('CAD the claw', 'CAD', { estimate: 40, done: now - 2 * D }), mk('CAD mounting brackets', 'CAD', { due: P.dateKey(new Date(now + D)), kind: 'due', estimate: 30 })]);
    const claw = (await P.store.get('pl:activities', [])).find((a) => a.key === 'cad the claw');
    const s = (min, d, o = {}) => ({ id: P.newId(), title: 'CAD the claw', activityId: claw.id, course: 'CAD', kind: 'focus', minutes: min, planned: min, start: now - d * D - min * 60000, end: now - d * D, outcome: 'done', ...o });
    await P.store.set('pl:sessions', [s(40, 2), s(40, 5, { onitry: { onPct: 80 } })]);
  });
  // The page re-reads storage a moment later.
  await until(async () => {
    await page.fill('#arName', '');
    await page.fill('#arName', 'cad');
    return (await page.$$('#arSugg .sg')).length === 3;
  }, { what: 'suggestions to know the seeded activities', timeout: 12000, every: 400 });
}

module.exports = {
  async 'suggestions rank, show their detail, fill subject and length, and reuse an existing task'() {
    const { ctx, page, errors } = await openTimecheck();
    await seed(page);
    const rows = await page.$$eval('#arSugg .sg', (r) => r.map((x) => x.textContent.replace(/\s+/g, ' ')));
    assert.match(rows[0], /^CAD the claw\s*40m · last 2 days ago · 1h 20m total/);
    assert.match(rows[1], /CAD mounting brackets\s*Due tomorrow/);
    assert.match(rows[2], /CAD the dynamic claw\s*Free time/);
    // arrows pick: down ×1 then Enter fills the box, subject and usual length
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    assert.equal(await page.inputValue('#arName'), 'CAD mounting brackets');
    assert.equal(await page.inputValue('#arLen .tc-step-val'), '30');
    assert.match(await page.textContent('#arSubject'), /CAD/);
    assert.equal(await page.$('#arSugg:not([hidden])'), null, 'the list closes after picking');
    // Esc closes the list without touching the text
    await page.fill('#arName', 'cad');
    await page.waitForSelector('#arSugg .sg');
    await page.keyboard.press('Escape');
    assert.equal(await page.$('#arSugg:not([hidden])'), null);
    assert.equal(await page.inputValue('#arName'), 'cad');
    // picking a Free time project and adding moves that task into the queue (no duplicate)
    await page.fill('#arName', 'dynamic');
    await page.waitForSelector('#arSugg .sg');
    await page.click('#arSugg .sg');
    await page.click('#arAdd');
    await until(async () => (await page.$$eval('#queue .q-title', (r) => r.map((x) => x.textContent))).includes('CAD the dynamic claw'));
    const count = await page.evaluate(async () => (await chrome.storage.local.get('pl:tasks'))['pl:tasks'].filter((t) => t.title === 'CAD the dynamic claw').length);
    assert.equal(count, 1);
    assert.deepEqual(errors, []);
    await ctx.close();
  },

  async 'the activity page, reflections after a block (every / only Done / never) and the Log'() {
    const { ctx, page, errors } = await openTimecheck({ width: 420 });
    await page.evaluate(() => InkPlan.setSettings({ alarmSound: false }));
    await page.fill('#arName', 'Hinge work');
    await page.click('#arAdd');
    await page.fill('#arName', 'Second job');
    await page.click('#arAdd');
    await until(async () => (await page.$$('#queue .q-task')).length === 2);
    await page.waitForTimeout(800);
    // the activity page opens from the name, and a note written there is kept
    await page.click('#queue .q-task:nth-child(1) .q-title');
    await page.waitForSelector('#activityDialog[open]');
    assert.equal(await page.textContent('#actName'), 'Hinge work');
    await page.fill('#actNote', 'Need a stronger pin');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#actNotes .act-note');
    assert.equal(await page.textContent('#actNotes .act-text'), 'Need a stronger pin');
    await page.click('#actClose');
    // finish a block: the strip asks, Enter saves it on the activity and in the Log
    await page.click('#nowBar .btn.primary');
    await page.waitForSelector('#nowBar.running');
    await page.click('#nowBar .nb-actions >> text=Done');
    await page.waitForSelector('#reflectBar:not([hidden])');
    assert.match(await page.textContent('#reflectBar .rf-q'), /How did Hinge work go\?/);
    await page.fill('#reflectBar .rf-input', 'Pin holds now');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#reflectBar', { state: 'hidden' });
    const acts = await page.evaluate(async () => (await chrome.storage.local.get('pl:activities'))['pl:activities'].find((a) => a.key === 'hinge work').reflections.map((r) => r.text));
    assert.deepEqual(acts, ['Need a stronger pin', 'Pin holds now'], 'both reflections are kept on the activity, oldest first');
    await page.click('#tabs [data-tab=journal]');
    const log = await page.$$eval('#journalList .entry', (r) => r.map((x) => x.textContent));
    assert.ok(log.some((t) => t.includes('Pin holds now')), 'the reflection is in the Log');
    // "About" ties a note to an activity and it shows on that activity's page
    await page.click('#logAbout .tc-drop');
    await page.click('.tc-menu >> text=Hinge work');
    await page.fill('#logInput', 'tried a thicker pin');
    await page.keyboard.press('Enter');
    await until(async () => (await page.$$('#journalList .e-act')).length > 0);
    await page.click('#journalList .e-act >> nth=0');
    await page.waitForSelector('#activityDialog[open]');
    const texts = await page.$$eval('#actNotes .act-text', (n) => n.map((x) => x.textContent));
    assert.ok(texts.includes('tried a thicker pin') && texts.includes('Pin holds now'));
    await page.click('#actClose');
    // the next block runs meanwhile: "Skip" clears a pending prompt, "Only after Done" and "Never" hold it back
    await page.click('#tabs [data-tab=today]');
    await page.evaluate(() => InkPlan.setSettings({ reflect: 'done' }));
    await page.click('#nowBar .nb-actions >> text=Stop');
    await page.waitForTimeout(500);
    assert.equal(await page.$eval('#reflectBar', (b) => b.hidden), true, 'Stop doesn’t ask under "Only after Done"');
    await page.evaluate(() => InkPlan.setSettings({ reflect: 'never' }));
    await page.fill('#arName', 'Third job');
    await page.click('#arAdd');
    await page.waitForSelector('#nowBar .btn.primary');
    await page.click('#nowBar .btn.primary');
    await page.waitForSelector('#nowBar.running');
    await page.click('#nowBar .nb-actions >> text=Done');
    await page.waitForTimeout(800);
    assert.equal(await page.$eval('#reflectBar', (b) => b.hidden), true, '"Never" never asks');
    assert.deepEqual(errors, []);
    await ctx.close();
  },
};
