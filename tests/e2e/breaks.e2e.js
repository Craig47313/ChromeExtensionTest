const assert = require('node:assert');
const { openTimecheck, until } = require('./lib');

const rules = (page) => page.evaluate(async () => (await chrome.declarativeNetRequest.getDynamicRules()).filter((r) => r.action.type === 'redirect').length);
const focus = (page) => page.evaluate(async () => (await chrome.storage.local.get('pl:focus'))['pl:focus'] || null);
const endNow = async (page, sw) => {
  // Make the running block's time run out now and fire the alarm.
  await page.evaluate(async () => {
    const f = (await chrome.storage.local.get('pl:focus'))['pl:focus'];
    f.endsAt = Date.now() - 2000;
    await chrome.storage.local.set({ 'pl:focus': f });
  });
  await sw.evaluate(() => chrome.alarms.create('plan-focus-end', { when: Date.now() + 300 }));
};
async function setup(page) {
  await page.evaluate(() => InkPlan.setSettings({ guardMode: 'always', alarmSound: false }));
  await until(async () => (await rules(page)) > 0, { what: 'the gate to go up' });
}
async function add(page, ...names) {
  for (const n of names) {
    await page.fill('#arName', n);
    await page.click('#arAdd');
  }
  await until(async () => (await page.$$('#queue .q-task')).length === names.length);
}

module.exports = {
  async 'a break opens the gate, ends by itself, and goes back to the block it interrupted'() {
    const { ctx, page, sw, errors } = await openTimecheck({ width: 420 });
    await setup(page);
    await add(page, 'Alpha', 'Beta');
    await page.click('#nowBar .btn.primary');
    await page.waitForSelector('#nowBar.running');
    await page.click('#nowBar .nb-actions >> text=Break');
    assert.match((await page.$$eval('.tc-form .tc-note', (n) => n.map((x) => x.textContent))).join(' '), /0 of 45 min used today/);
    await page.click('.tc-form .tc-step-btn.tc-up');
    await page.click('.tc-form >> text=Start break');
    await page.waitForSelector('#nowBar.break');
    const f = await focus(page);
    assert.deepEqual([f.kind, f.minutes, f.runAfter], ['break', 15, true]);
    await until(async () => (await rules(page)) === 0, { what: 'the gate to open for the break' });
    assert.deepEqual(await page.$$eval('#nowBar .nb-actions button', (b) => b.map((x) => x.textContent.trim())), ['Pause', 'End break', '+5', 'Stop'], 'no Break button during a break');
    await endNow(page, sw);
    await until(async () => (await focus(page))?.kind === 'focus', { what: 'the interrupted block to restart' });
    assert.equal((await focus(page)).title, 'Alpha');
    await until(async () => (await rules(page)) > 0, { what: 'the gate to come back' });
    const sessions = await page.evaluate(async () => (await chrome.storage.local.get('pl:sessions'))['pl:sessions'].map((s) => [s.title, s.kind, s.outcome]));
    assert.deepEqual(sessions, [['Alpha', 'focus', 'switched'], ['Break', 'break', 'done']]);
    // With nothing running, a break just ends, and the gate returns.
    await page.click('#nowBar .nb-actions >> text=Stop');
    await page.waitForTimeout(500);
    await page.click('#nowBar .nb-actions >> text=Break');
    await page.click('.tc-form >> text=Start break');
    await page.waitForSelector('#nowBar.break');
    assert.equal((await focus(page)).runAfter, false);
    await endNow(page, sw);
    await until(async () => (await focus(page)) === null, { what: 'the idle break to end' });
    await until(async () => (await rules(page)) > 0);
    assert.deepEqual(errors, []);
    await ctx.close();
  },

  async 'past the daily budget a break needs the code; queued breaks are skipped'() {
    const { ctx, page, sw, errors } = await openTimecheck({ width: 420 });
    await setup(page);
    await page.evaluate(async () => {
      const P = InkPlan;
      const t = Date.now();
      await P.setSettings({ breakBudget: 20, offCode: await P.makeOffCode('4321') });
      await P.store.update('pl:sessions', [], (a) => a.concat([{ id: 'x', title: 'Break', kind: 'break', start: t - 1e6, end: t - 1000, minutes: 25, outcome: 'done' }]));
    });
    await page.waitForTimeout(600);
    await page.click('#nowBar .nb-actions >> text=Break');
    assert.match((await page.$$eval('.tc-form .tc-note', (n) => n.map((x) => x.textContent))).join(' '), /25 of 20 min used today: the budget is spent/);
    assert.ok(await page.$('.tc-code'), 'a code box appears');
    await page.click('.tc-form >> text=Start break');
    await until(async () => (await page.textContent('.tc-error')).length > 0);
    assert.match(await page.textContent('.tc-error'), /Enter your off-switch code/);
    await page.fill('.tc-code', '1111');
    await page.click('.tc-form >> text=Start break');
    await until(async () => /isn’t right/.test(await page.textContent('.tc-error')));
    assert.equal(await focus(page), null, 'a wrong code starts nothing');
    await page.fill('.tc-code', '4321');
    await page.click('.tc-form >> text=Start break');
    await page.waitForSelector('#nowBar.break');
    await page.click('#nowBar .nb-actions >> text=End break');
    await until(async () => (await focus(page)) === null);

    // A queued break is skipped by the run once the budget is spent (and still asks for the code if you start it).
    await page.evaluate(async () => {
      const P = InkPlan;
      const mk = (title, o) => P.makeTask({ title, plan: P.dateKey(), estimate: 10, ...o });
      await P.store.set('pl:tasks', []);
      await P.addTasks([mk('Work one', { order: 1 }), mk('Rest', { order: 2, kind: 'break' }), mk('Work two', { order: 3 })]);
    });
    await until(async () => (await page.$$('#queue .q-task')).length === 3);
    await page.click('#nowBar .btn.primary');
    await page.waitForSelector('#nowBar.running');
    assert.equal(await page.textContent('#nowBar .nb-title'), 'Work one');
    await page.click('#nowBar .nb-actions >> text=Done');
    await until(async () => (await page.textContent('#nowBar .nb-title')) !== 'Work one');
    assert.equal(await page.textContent('#nowBar .nb-title'), 'Work two', 'the break was skipped');
    assert.deepEqual(errors, []);
    await ctx.close();
  },

  async 'the off switch: set, change and use the code in settings and on the gate page'() {
    const { ctx, page, id, errors } = await openTimecheck({ width: 420 });
    await setup(page);
    await page.click('#settingsBtn');
    await page.fill('#offNew', '12');
    await page.click('#offSet');
    assert.match(await page.textContent('#offMsg'), /4 to 6 digits/);
    await page.fill('#offNew', '4321');
    await page.click('#offSet');
    await until(async () => /Code set/.test(await page.textContent('#offMsg')));
    // wrong code is refused, right code turns the gate off for 15 minutes
    await page.fill('#offUse', '0000');
    await page.click('#offChoices >> text=15 minutes');
    await until(async () => /isn’t right/.test(await page.textContent('#offMsg')));
    assert.ok((await rules(page)) > 0);
    await page.fill('#offUse', '4321');
    await page.click('#offChoices >> text=15 minutes');
    await until(async () => (await rules(page)) === 0, { what: 'the gate to turn off' });
    await until(async () => /off until/.test(await page.textContent('#offStatus')), { what: 'the status line' });
    await page.click('#offStatus .chip');
    await until(async () => (await rules(page)) > 0, { what: 'the gate to come back' });
    // changing needs the old code
    await page.fill('#offOld', '9999');
    await page.fill('#offNew', '5555');
    await page.click('#offSet');
    await until(async () => /current code isn’t right/.test(await page.textContent('#offMsg')));
    await page.fill('#offOld', '4321');
    await page.click('#offSet');
    await until(async () => /Code changed/.test(await page.textContent('#offMsg')));
    await page.click('#settingsDialog [value=cancel]');
    // the stored form is a hash, never the code
    const stored = await page.evaluate(async () => JSON.stringify((await InkPlan.getSettings()).offCode));
    assert.ok(!stored.includes('5555') && !stored.includes('4321'));
    // the gate page offers it, and a right code lets you through
    const g = await ctx.newPage();
    await g.goto(`chrome-extension://${id}/guard.html#https://youtube.com/`);
    await g.waitForSelector('#offBox:not([hidden])');
    await g.click('#offBox summary');
    await g.fill('#offCode', '1');
    await g.click('#offChoices >> text=1 hour');
    await until(async () => /isn’t right/.test(await g.textContent('#offMsg')));
    await g.fill('#offCode', '5555');
    await g.click('#offChoices >> text=1 hour');
    await until(async () => (await rules(page)) === 0, { what: 'the gate to turn off from the gate page' });
    const log = await page.evaluate(async () => Object.values((await chrome.storage.local.get('pl:journal'))['pl:journal']).flat().map((e) => e.text));
    assert.ok(log.some((t) => /Off switch: 1 hour/.test(t)), 'the use is logged');
    assert.deepEqual(errors, []);
    await ctx.close();
  },
};
