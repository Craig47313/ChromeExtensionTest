const assert = require('node:assert');
const { launchMany, until, TC, INK, TC_ID } = require('./lib');

module.exports = {
  async 'Timecheck and Inkwell: connect, open, reflect, start a block, add to queue, disconnect'() {
    const { ctx, ids } = await launchMany([TC, INK], { width: 420, height: 900 });
    assert.equal(ids.timecheck, TC_ID, 'Timecheck keeps its fixed extension ID');
    const errors = [];
    const mk = async (url) => {
      const p = await ctx.newPage();
      p.on('pageerror', (e) => errors.push(String(e)));
      await p.goto(url);
      return p;
    };
    const ink = await mk(`chrome-extension://${ids.inkwell}/app.html?tab=1`);
    await ink.waitForTimeout(1200);
    const tc = await mk(`chrome-extension://${TC_ID}/today.html?view=panel`);
    await tc.waitForSelector('#connectBar:not([hidden])', { timeout: 8000 });
    assert.match(await tc.textContent('#connectBar'), /Connect to Inkwell\?/);
    await tc.click('#connectBar .btn.primary');
    await tc.waitForSelector('#connectBar', { state: 'hidden' });
    assert.equal(await tc.evaluate(async () => (await InkPlan.getSettings()).inkwell.id), ids.inkwell);

    // a reflection written on an activity page lands at the bottom of its Inkwell note
    await tc.fill('#arName', 'CAD the claw');
    await tc.click('#arAdd');
    await tc.waitForSelector('#queue .q-task');
    await tc.waitForTimeout(1200);
    await tc.click('#queue .q-title');
    await tc.waitForSelector('#activityDialog[open]');
    assert.equal(await tc.$eval('#actInk', (e) => !e.hidden), true, 'Open in Inkwell shows once connected');
    await tc.fill('#actNote', 'Hinge needs a stronger pin');
    await tc.keyboard.press('Enter');
    await tc.waitForSelector('#actNotes .act-note');
    const note = async () =>
      ink.evaluate(async () => {
        const n = (await Store.all()).find((x) => x.title === 'CAD the claw');
        return n ? { html: n.html, link: n.timecheck && n.timecheck.activityId } : null;
      });
    const found = await until(async () => {
      const n = await note();
      return n && /Hinge needs a stronger pin/.test(n.html) ? n : null;
    }, { what: 'the reflection in Inkwell' });
    assert.match(found.html, /<p><strong>[A-Z][a-z]{2} \d+<\/strong><\/p><p>Hinge needs a stronger pin/, 'a dated entry, then the sentence');
    assert.ok(found.link, 'the note is linked to the activity');

    // Open in Inkwell reuses the open Inkwell tab
    const before = ctx.pages().filter((p) => p.url().includes('app.html')).length;
    await tc.click('#actInkBtn');
    await tc.waitForTimeout(1500);
    assert.equal(ctx.pages().filter((p) => p.url().includes('app.html')).length, before, 'no second Inkwell tab');
    await tc.click('#actClose');

    // the Timecheck strip on the linked note, and ▶ Start a block
    await ink.setViewportSize({ width: 1100, height: 800 });
    await ink.reload();
    await ink.waitForTimeout(1500);
    await ink.evaluate(async () => {
      const n = (await Store.all()).find((x) => x.title === 'CAD the claw');
      await Store.requestOpen(n.id);
    });
    await ink.waitForSelector('#tcStrip:not([hidden])', { timeout: 8000 });
    assert.match(await ink.textContent('#tcStrip'), /Timecheck/);
    await ink.click('#tcStrip .btn');
    await until(async () => tc.evaluate(async () => (await chrome.storage.local.get('pl:focus'))['pl:focus']?.title === 'CAD the claw'), { what: 'the block to start in Timecheck' });
    await tc.evaluate(() => chrome.runtime.sendMessage({ type: 'plan:focus', action: 'stop' }));

    // Add to Timecheck queue from another note
    await ink.evaluate(async () => {
      const n = Store.createNote({ type: 'text', title: 'Read the Strandbeest paper', html: '<p>x</p>', text: 'x' });
      await Store.put(n);
      await Store.requestOpen(n.id);
    });
    await ink.waitForTimeout(1500);
    await ink.click('#noteMenuBtn');
    await ink.click('.menu >> text=Add to Timecheck queue');
    await until(async () => (await tc.$$eval('#queue .q-title', (r) => r.map((x) => x.textContent))).includes('Read the Strandbeest paper'), { what: 'the block in the queue' });

    // disconnect: Inkwell's messages are refused
    await tc.click('#settingsBtn');
    await tc.click('#inkBtns >> text=Disconnect');
    await tc.waitForTimeout(500);
    const refused = await ink.evaluate(async (id) => chrome.runtime.sendMessage(id, { type: 'inkwell:add-block', title: 'sneaky' }), TC_ID);
    assert.deepEqual(refused, { ok: false, error: 'not connected' });
    assert.equal(await tc.evaluate(async () => ((await chrome.storage.local.get('pl:tasks'))['pl:tasks'] || []).filter((t) => t.title === 'sneaky').length), 0);
    assert.deepEqual(errors, []);
    await ctx.close();
  },
};
