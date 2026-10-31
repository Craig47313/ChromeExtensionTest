const assert = require('node:assert');
const { openTimecheck, until } = require('./lib');

const dnr = (page) => page.evaluate(async () => (await chrome.declarativeNetRequest.getDynamicRules()).map((r) => r.action.type));

module.exports = {
  async 'allowed pages: one video or a site gets through the gate while the block runs'() {
    const { ctx, page, id, errors } = await openTimecheck({ width: 420 });
    await page.evaluate(() => InkPlan.setSettings({ guardMode: 'always', alarmSound: false }));
    await page.fill('#arName', 'Watch the CAD tutorial');
    await page.click('#arAdd');
    await page.waitForSelector('#queue .q-task');
    await page.waitForTimeout(1500);
    // add from the row's menu, before starting
    await page.click('#queue .q-more');
    await page.click('.tc-menu >> text=Allowed pages');
    await page.fill('.tc-url', 'nonsense here');
    await page.keyboard.press('Enter');
    await until(async () => (await page.textContent('.tc-error')).length > 0);
    assert.match(await page.textContent('.tc-error'), /web address/);
    await page.fill('.tc-url', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=9s');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.tc-allow li b');
    assert.match(await page.textContent('.tc-allow'), /youtube\.com\/watch\?v=dQw4w9WgXcQ/);
    await page.keyboard.press('Escape');
    // Nothing is allowed until the block runs
    assert.equal((await dnr(page)).filter((t) => t === 'allow').length, 0);
    await page.click('#nowBar .btn.primary');
    await page.waitForSelector('#nowBar.running');
    await until(async () => (await dnr(page)).filter((t) => t === 'allow').length === 1, { what: 'the allow rule' });
    assert.match(await page.textContent('#nowBar .nb-hint'), /1 page allowed/);
    // real navigations: the allowed video isn't redirected, another video is
    const visit = async (url) => {
      const p = await ctx.newPage();
      await p.goto(url, { timeout: 8000 }).catch(() => {});
      const gated = p.url().startsWith(`chrome-extension://${id}/guard.html`);
      await p.close();
      return gated;
    };
    assert.equal(await visit('https://www.youtube.com/watch?v=OTHERvideo12'), true, 'another video is still gated');
    assert.equal(await visit('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=4'), false, 'the allowed video opens');
    // add a whole site from the top card while it runs
    await page.click('#nowBar .nb-hint button');
    await page.fill('.tc-url', 'desmos.com');
    await page.keyboard.press('Enter');
    await until(async () => (await dnr(page)).filter((t) => t === 'allow').length === 2);
    await page.keyboard.press('Escape');
    assert.equal(await visit('https://www.desmos.com/calculator'), false);
    // the gate page lists them and offers to keep a page for the block (strict pass: only when it can be allowed)
    const g = await ctx.newPage();
    await g.goto(`chrome-extension://${id}/guard.html#https://www.youtube.com/watch?v=OTHERvideo12`);
    assert.equal((await g.$$eval('#allowedList li', (l) => l.length)), 2);
    assert.equal(await g.$eval('#allowWrap', (e) => !e.hidden), true);
    // removing one drops its rule; stopping the block drops the rest
    await page.click('#nowBar .nb-hint button');
    await page.click('.tc-allow li >> nth=1 >> button');
    await until(async () => (await dnr(page)).filter((t) => t === 'allow').length === 1);
    await page.keyboard.press('Escape');
    await page.click('#nowBar .nb-actions >> text=Stop');
    await until(async () => (await dnr(page)).filter((t) => t === 'allow').length === 0);
    // kept on the activity for next time
    await page.click('#queue .q-title');
    await page.waitForSelector('#activityDialog[open]');
    assert.match(await page.textContent('#actAllow'), /youtube\.com\/watch\?v=dQw4w9WgXcQ/);
    assert.deepEqual(errors, []);
    await ctx.close();
  },
};
