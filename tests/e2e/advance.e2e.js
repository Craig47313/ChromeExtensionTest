const assert = require('node:assert');
const { openTimecheck, until } = require('./lib');

const focus = (page) => page.evaluate(async () => (await chrome.storage.local.get('pl:focus'))['pl:focus'] || null);
const endNow = async (page, sw) => {
  await page.evaluate(async () => {
    const f = (await chrome.storage.local.get('pl:focus'))['pl:focus'];
    f.endsAt = Date.now() - 2000;
    await chrome.storage.local.set({ 'pl:focus': f });
  });
  await sw.evaluate(() => chrome.alarms.create('plan-focus-end', { when: Date.now() + 300 }));
};
async function add(page, ...names) {
  for (const n of names) {
    await page.fill('#arName', n);
    await page.click('#arAdd');
  }
  await until(async () => (await page.$$('#queue .q-task')).length === names.length);
}

module.exports = {
  async 'when time runs out and the next block starts, the page asks if the first was finished'() {
    const { ctx, page, sw, errors } = await openTimecheck({ width: 420 });
    await page.evaluate(() => InkPlan.setSettings({ alarmSound: false, autoAdvance: true }));
    await add(page, 'Alpha', 'Beta', 'Gamma');
    await page.click('#nowBar .btn.primary');
    await page.waitForSelector('#nowBar.running');
    assert.equal(await page.textContent('#nowBar .nb-title'), 'Alpha');
    assert.equal(await page.isVisible('#advBar'), false);
    await endNow(page, sw);
    await until(async () => (await focus(page))?.title === 'Beta', { what: 'Beta to start by itself' });
    await page.waitForSelector('#advBar:not([hidden])');
    assert.match(await page.textContent('#advBar'), /Time ran out on Alpha/);
    // Done marks Alpha finished and the prompt goes away
    await page.click('#advBar >> text=Done');
    await page.waitForSelector('#advBar', { state: 'hidden' });
    const alpha = await page.evaluate(async () => (await chrome.storage.local.get('pl:tasks'))['pl:tasks'].find((t) => t.title === 'Alpha').done);
    assert.ok(alpha, 'Alpha is done');
    // The Done-today row says how long it took
    await page.click('#doneToday summary');
    const row = await page.textContent('#doneList .task');
    assert.match(row, /Alpha/);
    assert.match(row, /took \d+m|took 1m/);
    // Again with Gamma following Beta: "Back in the queue" keeps Beta undone, and the prompt is gone for good
    await endNow(page, sw);
    await until(async () => (await focus(page))?.title === 'Gamma', { what: 'Gamma to start' });
    await page.waitForSelector('#advBar:not([hidden])');
    assert.match(await page.textContent('#advBar'), /Time ran out on Beta/);
    await page.click('#advBar >> text=Back in the queue');
    await page.waitForSelector('#advBar', { state: 'hidden' });
    const beta = await page.evaluate(async () => (await chrome.storage.local.get('pl:tasks'))['pl:tasks'].find((t) => t.title === 'Beta'));
    assert.equal(beta.done, null);
    // A block started by hand afterwards never brings the old prompt back
    await page.click('#nowBar .nb-actions >> text=Stop');
    await page.waitForSelector('#nowBar:not(.running)');
    await page.click('#nowBar .btn.primary');
    await page.waitForSelector('#nowBar.running');
    assert.equal(await page.isVisible('#advBar'), false);
    assert.deepEqual(errors, []);
    await ctx.close();
  },
};
