const assert = require('node:assert');
const { openInkwell, until } = require('./lib');

async function openNote(page, html, title = 'Note test') {
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 300;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 400, 300);
    g.addColorStop(0, '#e03131');
    g.addColorStop(1, '#1971c2');
    x.fillStyle = g;
    x.fillRect(0, 0, 400, 300);
    return c.toDataURL('image/png');
  });
  const id = await page.evaluate(
    async ([html, src, title]) => {
      const n = Store.createNote({ type: 'text', title, html: html.replace('SRC', src), text: 'text' });
      await Store.put(n);
      await Store.requestOpen(n.id);
      return n.id;
    },
    [html, png, title]
  );
  await page.waitForSelector('#rich figure img');
  await page.waitForTimeout(500);
  return id;
}
const FIG = '<p>before</p><figure class="media" contenteditable="false"><img src="SRC" alt=""></figure><p>after</p>';
const size = (page) => page.$eval('#rich figure.media img', (i) => [i.naturalWidth, i.naturalHeight]);
const menu = (page) => page.$$eval('.tc-menu:not(.tc-sub) .tc-item', (b) => b.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));

module.exports = {
  async 'crop window: aspect, steppers, move, apply, re-crop from the original, rotate, reset, undo'() {
    const { ctx, page, errors } = await openInkwell();
    const id = await openNote(page, FIG);
    assert.deepEqual(await size(page), [400, 300]);
    await page.hover('#rich figure.media img');
    await page.waitForSelector('#figTools:not([hidden])');
    await page.click('#figTools [data-fig=crop]');
    await page.waitForSelector('#cropDialog[open]');
    assert.deepEqual([await page.inputValue('#cropW input'), await page.inputValue('#cropH input')], ['400', '300']);
    await page.click('#cropAspect [data-aspect="1:1"]');
    assert.deepEqual([await page.inputValue('#cropW input'), await page.inputValue('#cropH input')], ['300', '300'], '1:1 fits inside the box');
    const box = await (await page.$('#cropBox')).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 20, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    await page.fill('#cropW input', '200');
    await page.keyboard.press('Enter');
    assert.deepEqual([await page.inputValue('#cropW input'), await page.inputValue('#cropH input')], ['200', '200'], 'the shape stays square when you change the width');
    await page.click('#cropApply');
    await until(async () => (await size(page))[0] === 200, { what: 'the cropped image' });
    assert.deepEqual(await size(page), [200, 200]);
    await page.waitForTimeout(1300);
    const note = await page.evaluate(async (id) => {
      const n = await Store.get(id);
      const o = Object.values(n.originals || {})[0];
      return { n: Object.keys(n.originals || {}).length, big: o && o.src.length > 1000, tagged: /data-img/.test(n.html) };
    }, id);
    assert.deepEqual(note, { n: 1, big: true, tagged: true }, 'the original is kept beside the note');
    // the window opens on the box you left, over the original
    await page.dblclick('#rich figure.media img');
    await page.waitForSelector('#cropDialog[open]');
    assert.deepEqual([await page.inputValue('#cropW input'), await page.inputValue('#cropH input')], ['200', '200']);
    await page.click('#cropRotate');
    await page.click('#cropApply');
    await page.waitForTimeout(400);
    assert.deepEqual(await size(page), [200, 200]);
    // Reset brings the original back; the toast's Undo puts the crop back again
    await page.dblclick('#rich figure.media img');
    await page.waitForSelector('#cropDialog[open]');
    await page.click('#cropReset');
    await page.click('#cropApply');
    await until(async () => (await size(page))[0] === 400);
    await page.click('.toast button');
    await until(async () => (await size(page))[0] === 200, { what: 'undo' });
    // Esc cancels without changing anything
    await page.dblclick('#rich figure.media img');
    await page.waitForSelector('#cropDialog[open]');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#cropDialog', { state: 'hidden' });
    assert.deepEqual(await size(page), [200, 200]);
    assert.deepEqual(errors, []);
    await ctx.close();
  },

  async 'right-click menus in notes: images, text, the notes list'() {
    const { ctx, page, errors } = await openInkwell();
    const id = await openNote(page, FIG);
    const fig = await (await page.$('#rich figure img')).boundingBox();
    await page.mouse.click(fig.x + 50, fig.y + 50, { button: 'right' });
    await page.waitForSelector('.tc-menu');
    assert.deepEqual(await menu(page), ['Crop', 'Size›', 'Copy image', 'Save image as…', 'Replace…', 'Delete image']);
    await page.click('.tc-menu .tc-item:has-text("Size")');
    await page.click('.tc-sub .tc-item:has-text("Small")');
    await page.waitForTimeout(400);
    const small = await (await page.$('#rich figure img')).boundingBox();
    assert.ok(small.width < fig.width / 2, `small is a quarter of the width (${small.width} of ${fig.width})`);
    await page.waitForTimeout(1300);
    assert.ok(await page.evaluate(async (id) => /data-size="s"/.test((await Store.get(id)).html), id), 'the size is saved with the note');
    // text keeps the browser's menu; Shift+right-click on an image does too
    const prevented = await page.evaluate(() => {
      const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 150 });
      document.querySelector('#rich p').dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    assert.equal(prevented, false);
    const f2 = await (await page.$('#rich figure img')).boundingBox();
    const shifted = await page.evaluate(([x, y]) => {
      const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, shiftKey: true });
      document.elementFromPoint(x, y).dispatchEvent(ev);
      return ev.defaultPrevented;
    }, [f2.x + 10, f2.y + 10]);
    assert.equal(shifted, false);
    // delete, then Undo
    await page.mouse.click(f2.x + 10, f2.y + 10, { button: 'right' });
    await page.click('.tc-menu .tc-item:has-text("Delete image")');
    assert.equal((await page.$$('#rich figure')).length, 0);
    await page.click('.toast button');
    assert.equal((await page.$$('#rich figure')).length, 1);
    // the notes list
    await page.evaluate(() => document.querySelector('.sidebar-toggle')?.click());
    await page.waitForTimeout(400);
    const row = await (await page.$('.note-item')).boundingBox();
    await page.mouse.click(row.x + 40, row.y + 20, { button: 'right' });
    await page.waitForSelector('.tc-menu');
    const items = await menu(page);
    assert.deepEqual(items.filter((t) => !/Unpin|Pin to top/.test(t)).slice(0, 2), ['Open in a tab', 'Duplicate']);
    assert.ok(items.includes('Export') && items.includes('Delete note'));
    const count = await page.evaluate(async () => (await Store.all()).length);
    await page.click('.tc-menu .tc-item:has-text("Duplicate")');
    await until(async () => (await page.evaluate(async () => (await Store.all()).length)) === count + 1, { what: 'the copy' });
    assert.deepEqual(errors, []);
    await ctx.close();
  },
};
