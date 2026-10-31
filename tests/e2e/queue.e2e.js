const assert = require('node:assert');
const { openTimecheck, until } = require('./lib');

const titles = (page) => page.$$eval('#queue .q-task .q-title', (r) => r.map((x) => x.textContent));
async function add(page, name, { ups = 0 } = {}) {
  await page.fill('#arName', name);
  for (let i = 0; i < ups; i++) await page.click('#arLen .tc-step-btn.tc-up');
  await page.click('#arAdd');
}
async function addAll(page, names) {
  for (const n of names) await add(page, n);
  await until(async () => (await titles(page)).length === names.length, { what: `${names.length} rows` });
}

module.exports = {
  async 'adding by mouse and controls only; the name is never decoded'() {
    const { ctx, page, errors } = await openTimecheck();
    await add(page, 'econ practice 40m');
    await add(page, 'due tmrw at 4pm ~ next B', { ups: 2 });
    await page.fill('#arName', 'snack');
    await page.click('#arType .tc-drop');
    await page.click('.tc-menu >> text=Break');
    assert.equal(await page.inputValue('#arLen .tc-step-val'), '10', 'a break defaults to 10 minutes');
    await page.click('#arAdd');
    await until(async () => (await titles(page)).length === 3);
    assert.deepEqual(await titles(page), ['econ practice 40m', 'due tmrw at 4pm ~ next B', 'snack']);
    const rows = await page.$$eval('#queue .q-task', (r) => r.map((x) => [x.querySelector('.tc-step-val').value, !!x.querySelector('.q-pin'), !!x.querySelector('.due')]));
    assert.deepEqual(rows.map((r) => r[1]), [false, false, false], 'nothing was pinned from the text');
    assert.equal(rows[1][2], false, 'no due date was read from the text');
    assert.equal(rows[1][0], String(Number(rows[0][0]) + 10), 'the stepper changed the length by 5 per click');
    // the times run back to back
    const times = await page.$$eval('#queue .q-time', (t) => t.map((x) => x.textContent));
    assert.equal(times.length, 3);
    assert.deepEqual(errors, []);
    await ctx.close();
  },

  async 'stepper: arrow keys, wheel, typing and the add row defaults'() {
    const { ctx, page, errors } = await openTimecheck();
    await add(page, 'A');
    await until(async () => (await titles(page)).length === 1);
    const input = '#queue .q-task .tc-step-val';
    const before = Number(await page.inputValue(input));
    await page.focus(input);
    await page.keyboard.press('ArrowUp');
    assert.equal(Number(await page.inputValue(input)), before + 5);
    await page.hover('#queue .q-step');
    await page.mouse.wheel(0, -100);
    assert.equal(Number(await page.inputValue(input)), before + 10);
    await page.keyboard.press('ArrowDown');
    await page.fill(input, '33');
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowUp'); // 33 → the next multiple of 5
    assert.equal(await page.inputValue(input), '35');
    await page.fill(input, '9999');
    await page.keyboard.press('Enter');
    assert.equal(await page.inputValue(input), '240', 'clamped to the maximum');
    await page.waitForTimeout(600);
    const saved = await page.evaluate(async () => (await chrome.storage.local.get('pl:tasks'))['pl:tasks'].find((t) => t.title === 'A').estimate);
    assert.equal(saved, 240, 'the new length is saved');
    assert.deepEqual(errors, []);
    await ctx.close();
  },

  async 'reorder by drag, by keys and by the menu; duplicate, remove, set a time'() {
    const { ctx, page, errors } = await openTimecheck();
    await addAll(page, ['A', 'B', 'C']);
    const g = await (await page.$('#queue .q-task:nth-child(1) .q-grip')).boundingBox();
    const c = await (await page.$('#queue .q-task:nth-child(3)')).boundingBox();
    await page.mouse.move(g.x + 5, g.y + 10);
    await page.mouse.down();
    await page.mouse.move(g.x + 5, g.y + 40, { steps: 4 });
    await page.mouse.move(g.x + 5, c.y + c.height - 2, { steps: 8 });
    await page.mouse.up();
    await until(async () => (await titles(page))[0] === 'B');
    assert.deepEqual(await titles(page), ['B', 'C', 'A'], 'drag A to the bottom');

    await page.focus('#queue .q-task:nth-child(3) .q-grip');
    await page.keyboard.press('ArrowUp');
    await until(async () => (await titles(page))[1] === 'A');
    assert.deepEqual(await titles(page), ['B', 'A', 'C'], 'ArrowUp on the handle moves a row up');

    const pick = async (row, label) => {
      await page.click(`#queue .q-task:nth-child(${row}) .q-more`);
      await page.click(`.tc-menu >> text=${label}`);
    };
    await pick(3, 'Move to top');
    await until(async () => (await titles(page))[0] === 'C');
    await pick(1, 'Move to bottom');
    await until(async () => (await titles(page))[2] === 'C');
    await pick(1, 'Duplicate');
    await until(async () => (await titles(page)).length === 4);
    assert.deepEqual(await titles(page), ['B', 'B', 'A', 'C'], 'the copy sits right after its original');
    await pick(2, 'Remove');
    await until(async () => (await titles(page)).length === 3);
    await page.click('.toast button'); // undo
    await until(async () => (await titles(page)).length === 4);
    await pick(2, 'Remove');
    await until(async () => (await titles(page)).length === 3);

    // the menu: Esc closes, and the menu ends up with the right items
    await page.click('#queue .q-task:nth-child(1) .q-more');
    const items = await page.$$eval('.tc-menu .tc-item', (b) => b.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
    assert.deepEqual(items, ['Edit', 'Start now', 'Move to top', 'Move to bottom', 'Start at a set time…', 'Allowed pages…', 'Duplicate', 'Remove']);
    assert.equal(await page.$eval('.tc-menu .tc-item:has-text("Move to top")', (b) => b.disabled), true, 'the top row can’t move up');
    await page.keyboard.press('Escape');
    assert.equal(await page.$('.tc-menu'), null);

    // set a time: the row is pinned and keeps its place in time
    await pick(2, 'Start at a set time');
    await page.fill('.tc-form .tc-step-val', '23:00');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#queue .q-pin');
    const pinned = await page.$$eval('#queue .q-task', (r) => r.map((x) => [x.querySelector('.q-title').textContent, !!x.querySelector('.q-pin'), x.querySelector('.q-time').textContent]));
    assert.equal(pinned.filter((r) => r[1]).length, 1);
    assert.match(pinned.find((r) => r[1])[2], /11:00/);
    assert.equal(pinned[pinned.length - 1][1], true, 'a block at 11 PM comes last');
    assert.deepEqual(errors, []);
    await ctx.close();
  },

  async 'paste lines, Shift+Enter, week click, due dates, more options'() {
    const { ctx, page, errors } = await openTimecheck();
    await add(page, 'first');
    await until(async () => (await titles(page)).length === 1);
    await page.focus('#arName');
    await page.evaluate(() => {
      const d = new DataTransfer();
      d.setData('text', 'one 20m\ntwo at 4pm\n\nthree');
      document.querySelector('#arName').dispatchEvent(new ClipboardEvent('paste', { clipboardData: d, bubbles: true, cancelable: true }));
    });
    await until(async () => (await titles(page)).length === 4);
    assert.deepEqual((await titles(page)).slice(1), ['one 20m', 'two at 4pm', 'three'], 'one block per non-empty line, names untouched');
    await page.fill('#arName', 'NEXT');
    await page.keyboard.press('Shift+Enter');
    await until(async () => (await titles(page))[0] === 'NEXT');
    await page.fill('#arName', 'LAST');
    await page.keyboard.press('Enter');
    await until(async () => (await titles(page)).at(-1) === 'LAST');

    // a day in Week opens the add row with its date
    await page.click('#tabs [data-tab=week]');
    await page.click('.wk-day:nth-child(3) .wk-head');
    assert.equal(await page.evaluate(() => document.body.dataset.tab), 'today');
    const tags = await page.$$eval('#arTags .ar-tag', (t) => t.map((x) => x.textContent));
    assert.equal(tags.length, 1);
    assert.match(tags[0], /^Due /);
    await page.fill('#arName', 'homework');
    await page.click('#arAdd');
    await page.waitForTimeout(500);
    const hw = await page.evaluate(async () => (await chrome.storage.local.get('pl:tasks'))['pl:tasks'].find((t) => t.title === 'homework'));
    assert.ok(hw.due, 'the due date was kept');
    assert.equal(hw.kind, 'due');
    assert.equal(await page.$$eval('#arTags .ar-tag', (t) => t.length), 0, 'the tags reset after adding');

    // More: free time puts it on the Free time list, not the queue
    await page.fill('#arName', 'someday thing');
    await page.click('#arMore');
    await page.check('.tc-form .tc-check input');
    await page.keyboard.press('Escape');
    assert.match((await page.textContent('#arTags')).trim(), /Free time/);
    await page.click('#arAdd');
    await page.waitForTimeout(500);
    const free = await page.evaluate(async () => (await chrome.storage.local.get('pl:tasks'))['pl:tasks'].find((t) => t.title === 'someday thing'));
    assert.equal(free.someday, true);
    assert.ok(!(await titles(page)).includes('someday thing'));
    assert.deepEqual(errors, []);
    await ctx.close();
  },

  async 'classes and set-time blocks route the times; Start runs the queue'() {
    const { ctx, page, errors } = await openTimecheck();
    await page.evaluate(async () => {
      const P = InkPlan;
      const d = new Date();
      const m = d.getHours() * 60 + d.getMinutes();
      const f = (x) => `${String(Math.floor(((x % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}:${String(((x % 60) + 60) % 60).padStart(2, '0')}`;
      const b = (await P.getSettings()).blocks;
      const blk = [{ start: f(m + 40), end: f(m + 70), label: 'Physics' }];
      // Make today a lettered school day whatever the weekday, so the test runs any day of the week.
      await P.setSettings({ alarmSound: false, blocks: { ...b, enabled: true, days: [0, 1, 2, 3, 4, 5, 6], skip: [], anchorDate: P.dateKey(), anchorLetter: 'A', schedule: { ...b.schedule, A: blk, B: blk, C: blk, D: blk, Other: blk } } });
      const mk = (title, est, o = {}) => P.makeTask({ title, plan: P.dateKey(), estimate: est, order: Date.now() + Math.random() * 100, ...o });
      await P.addTasks([mk('first', 30, { order: 1 }), mk('second', 30, { order: 2 }), mk('third', 20, { order: 3, at: f(m + 120) }), mk('snack', 10, { kind: 'break', order: 4 })]);
    });
    await page.waitForSelector('.q-class');
    const rows = await page.$$eval('#queue > li', (r) => r.map((x) => (x.className.includes('q-class') ? 'CLASS' : x.querySelector('.q-title').textContent)));
    assert.equal(rows[1], 'CLASS', 'the class sits between first and second, where it falls in time');
    assert.deepEqual(rows.filter((r) => r !== 'CLASS'), ['first', 'second', 'snack', 'third']);
    const times = await page.$$eval('#queue .q-task', (r) => r.map((x) => [x.querySelector('.q-title').textContent, x.querySelector('.q-time').textContent]));
    const toMin = (t) => {
      const m = /(\d+):(\d+)\s*(AM|PM)/i.exec(t);
      return (Number(m[1]) % 12) * 60 + Number(m[2]) + (/pm/i.test(m[3]) ? 720 : 0);
    };
    const span = (t) => t.split('–').map(toMin);
    const [f1, f2] = [span(times[0][1]), span(times[1][1])];
    assert.ok(f2[0] >= f1[1] + 30 - 1, 'second starts after the 30-minute class');
    // Start runs the whole queue, and Done moves to the next block by itself
    await page.click('#nowBar .btn.primary');
    await page.waitForSelector('#nowBar.running');
    assert.equal(await page.textContent('#nowBar .nb-title'), 'first');
    assert.deepEqual(await page.$$eval('#nowBar .nb-actions button', (b) => b.filter((x) => !x.hidden).map((x) => x.textContent.trim())), ['Pause', 'Done', '+5', 'Skip', 'Stop', 'Break']);
    await page.click('#nowBar .nb-actions >> text=Done');
    await until(async () => (await page.textContent('#nowBar .nb-title')) === 'second', { what: 'the next block to start' });
    await page.click('#nowBar .nb-actions >> text=Pause');
    await page.waitForSelector('#nowBar.paused');
    await page.click('#nowBar .nb-actions >> text=Resume');
    await page.waitForSelector('#nowBar.running');
    await page.click('#nowBar .nb-actions >> text=Skip');
    await until(async () => (await page.textContent('#nowBar .nb-title')) !== 'second');
    assert.deepEqual(errors, []);
    await ctx.close();
  },
};
