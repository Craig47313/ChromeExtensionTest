const assert = require('node:assert');
const { openInkwell, until } = require('./lib');

// Find a colour on the drawing canvas: its bounding box in page coordinates (so tests don't depend on the view).
async function findColor(page, rgb, tol = 24) {
  return page.evaluate(
    ([rgb, tol]) => {
      const c = document.querySelector('#drawPane canvas');
      const ctx = c.getContext('2d');
      const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
      let x1 = 1e9, y1 = 1e9, x2 = -1, y2 = -1;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          if (Math.abs(data[i] - rgb[0]) < tol && Math.abs(data[i + 1] - rgb[1]) < tol && Math.abs(data[i + 2] - rgb[2]) < tol && data[i + 3] > 200) {
            if (x < x1) x1 = x;
            if (x > x2) x2 = x;
            if (y < y1) y1 = y;
            if (y > y2) y2 = y;
          }
        }
      }
      if (x2 < 0) return null;
      const r = c.getBoundingClientRect();
      const k = c.width / r.width;
      return { x: r.left + x1 / k, y: r.top + y1 / k, w: (x2 - x1) / k, h: (y2 - y1) / k };
    },
    [rgb, tol]
  );
}
const center = (b) => [b.x + b.w / 2, b.y + b.h / 2];

async function openDrawing(page, shapes, picture) {
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 200;
    const x = c.getContext('2d');
    x.fillStyle = '#2f9e44';
    x.fillRect(0, 0, 400, 200);
    x.fillStyle = '#000';
    x.fillRect(0, 0, 200, 200); // the left half is black, the right half green
    x.fillStyle = '#2f9e44';
    x.fillRect(200, 0, 200, 200);
    return c.toDataURL('image/png');
  });
  const id = await page.evaluate(
    async ([shapes, src]) => {
      const list = shapes.map((s) => (s === 'IMG' ? { type: 'image', src, x: 220, y: 100, w: 200, h: 100 } : s));
      const n = Store.createNote({ type: 'drawing', title: 'Draw test', drawing: { v: 1, background: 'none', shapes: list } });
      await Store.put(n);
      await Store.requestOpen(n.id);
      return n.id;
    },
    [shapes, png]
  );
  await page.waitForSelector('#drawPane canvas');
  await page.waitForTimeout(900);
  return id;
}
const rect = (x, y, w, h, color) => ({ type: 'rect', color, size: 6, x1: x, y1: y, x2: x + w, y2: y + h });
const saved = (page, id) => page.evaluate(async (id) => (await Store.get(id)).drawing.shapes, id);
const menuItems = (page) => page.$$eval('.tc-menu:not(.tc-sub) .tc-item', (b) => b.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
const settle = (page) => page.waitForTimeout(1300); // saves are debounced

module.exports = {
  async 'crop an image shape: handles, widening again, Reset, one undo step, nothing cut away'() {
    const { ctx, page, errors } = await openInkwell();
    const id = await openDrawing(page, ['IMG']);
    await page.keyboard.press('v');
    let pic = await findColor(page, [47, 158, 68]); // the green half
    assert.ok(pic, 'the picture is on the canvas');
    const [px, py] = center(pic);
    await page.mouse.click(px, py);
    await page.keyboard.press('Enter');
    await page.waitForSelector('#cropHint:not([hidden])');
    await page.waitForTimeout(400);
    // drag the east handle of the box (right edge of the picture) to its middle
    const full = await findColor(page, [47, 158, 68]);
    const left = full.x - 100; // the black half sits to the left of the green one
    const east = { x: full.x + full.w, y: full.y + full.h / 2 };
    await page.mouse.move(east.x, east.y);
    await page.mouse.down();
    await page.mouse.move(east.x - full.w * 0.9, east.y, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.press('Enter');
    await settle(page);
    let shape = (await saved(page, id))[0];
    assert.ok(shape.crop && shape.crop.w < 0.75 && shape.crop.w > 0.4, `cropped to part of the width: ${JSON.stringify(shape.crop)}`);
    assert.ok(shape.w < 200, 'the shape is narrower');
    assert.ok(shape.src.length > 100, 'the picture still has all its pixels');
    // double-click re-opens it and the full picture is there to widen again
    const now = await findColor(page, [0, 0, 0], 40);
    await page.mouse.dblclick(now.x + now.w / 2, now.y + now.h / 2);
    await page.waitForSelector('#cropHint:not([hidden])');
    await page.click('#cropResetBtn');
    await page.click('#cropApplyBtn');
    await settle(page);
    shape = (await saved(page, id))[0];
    assert.equal(shape.crop, undefined, 'Reset then Apply restores the whole picture');
    assert.equal(shape.w, 200);
    // a crop is one undo step
    await page.mouse.dblclick(...center(await findColor(page, [0, 0, 0], 40)));
    await page.waitForSelector('#cropHint:not([hidden])');
    await page.waitForTimeout(400);
    const box = await findColor(page, [47, 158, 68]);
    await page.mouse.move(box.x + box.w, box.y + box.h / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.w / 2, box.y + box.h / 2, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.press('Enter');
    await settle(page);
    assert.ok((await saved(page, id))[0].crop);
    await page.keyboard.press('Control+z');
    await settle(page);
    assert.equal((await saved(page, id))[0].crop, undefined, 'one Ctrl+Z undoes the whole crop');
    // Esc cancels
    await page.mouse.dblclick(...center(await findColor(page, [0, 0, 0], 40)));
    await page.waitForSelector('#cropHint:not([hidden])');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#cropHint', { state: 'hidden' });
    assert.deepEqual(errors, []);
    await ctx.close();
  },

  async 'the right-click menus: layer steps and shortcuts, opacity, flip, lock, copy and paste'() {
    const { ctx, page, errors } = await openInkwell();
    const id = await openDrawing(page, [rect(100, 100, 80, 60, '#e03131'), 'IMG', rect(460, 140, 60, 90, '#1971c2')]);
    await page.keyboard.press('v');
    const empty = await page.mouse.click(60, 700, { button: 'right' }).then(() => page.waitForSelector('.tc-menu')).then(() => menuItems(page));
    assert.deepEqual(empty, ['PasteCtrl+V', 'Select allCtrl+A', 'Insert image…', 'Paper›', 'Zoom to fit']);
    await page.keyboard.press('Escape');
    // a shape: the red box (an edge pixel)
    const red = await findColor(page, [224, 49, 49]);
    const onRed = [red.x + red.w / 2, red.y + 2];
    await page.mouse.click(...onRed, { button: 'right' });
    await page.waitForSelector('.tc-menu');
    const items = await menuItems(page);
    assert.deepEqual(items, ['Layer›', 'CutCtrl+X', 'CopyCtrl+C', 'PasteCtrl+V', 'DuplicateCtrl+D', 'DeleteDel', 'Colour›', 'Stroke width›', 'Opacity›', 'Flip horizontal', 'Flip vertical', 'Lock']);
    // layer: bring to front moves the red box last
    await page.click('.tc-menu .tc-item:has-text("Layer")');
    await page.waitForSelector('.tc-sub');
    assert.deepEqual(await page.$$eval('.tc-sub .tc-item', (b) => b.map((x) => x.textContent.replace(/\s+/g, ' ').trim())), ['Bring to frontCtrl+Shift+]', 'Bring forwardCtrl+]', 'Send backwardCtrl+[', 'Send to backCtrl+Shift+[']);
    await page.click('.tc-sub .tc-item:has-text("Bring to front")');
    await settle(page);
    let order = (await saved(page, id)).map((s) => (s.type === 'image' ? 'image' : s.color));
    assert.deepEqual(order, ['image', '#1971c2', '#e03131'], 'Bring to front puts the red box on top');
    // Ctrl+[ one step back, Ctrl+Shift+[ to the back (the box stays selected)
    await page.keyboard.press('Control+[');
    await settle(page);
    order = (await saved(page, id)).map((s) => (s.type === 'image' ? 'image' : s.color));
    assert.deepEqual(order, ['image', '#e03131', '#1971c2'], 'Ctrl+[ goes back one step');
    await page.keyboard.press('Control+Shift+[');
    await settle(page);
    order = (await saved(page, id)).map((s) => (s.type === 'image' ? 'image' : s.color));
    assert.deepEqual(order, ['#e03131', 'image', '#1971c2'], 'Ctrl+Shift+[ goes all the way back');
    await page.keyboard.press('Control+]');
    await settle(page);
    order = (await saved(page, id)).map((s) => (s.type === 'image' ? 'image' : s.color));
    assert.deepEqual(order, ['image', '#e03131', '#1971c2']);
    // opacity, flip and lock on the red box
    await page.mouse.click(...onRed, { button: 'right' });
    await page.click('.tc-menu .tc-item:has-text("Opacity")');
    await page.click('.tc-sub .tc-item:has-text("50%")');
    await page.mouse.click(...onRed, { button: 'right' });
    await page.click('.tc-menu .tc-item:has-text("Stroke width")');
    await page.click('.tc-sub .tc-item:has-text("Extra thick")');
    await settle(page);
    let box = (await saved(page, id)).find((s) => s.color === '#e03131');
    assert.equal(box.opacity, 0.5);
    assert.equal(box.size, 14);
    await page.mouse.click(...onRed, { button: 'right' });
    await page.click('.tc-menu .tc-item:has-text("Lock")');
    await settle(page);
    assert.equal((await saved(page, id)).find((s) => s.color === '#e03131').locked, true);
    // a locked shape can't be picked, dragged, erased or drag-selected; its menu offers Unlock only
    await page.mouse.click(...onRed);
    assert.equal(await page.$('.delete-sel:not([hidden])'), null, 'clicking a locked shape selects nothing');
    await page.mouse.click(...onRed, { button: 'right' });
    await page.waitForSelector('.tc-menu');
    assert.deepEqual(await menuItems(page), ['Unlock']);
    await page.click('.tc-menu .tc-item');
    await settle(page);
    assert.equal((await saved(page, id)).find((s) => s.color === '#e03131').locked, undefined);
    // flip the picture: it remembers, and the left/right halves swap sides on screen
    const before = await findColor(page, [47, 158, 68]);
    await page.mouse.click(...center(before), { button: 'right' });
    await page.click('.tc-menu .tc-item:has-text("Flip horizontal")');
    await settle(page);
    const after = await findColor(page, [47, 158, 68]);
    assert.ok((await saved(page, id)).find((s) => s.type === 'image').flipX);
    assert.ok(after.x < before.x - 20, 'the green half is now on the left');
    // copy, then paste with the keyboard: a new shape appears, selected
    await page.mouse.click(...center(after), { button: 'right' });
    await page.click('.tc-menu .tc-item:has-text("Copy")');
    await page.keyboard.press('Control+v');
    await settle(page);
    assert.equal((await saved(page, id)).length, 4);
    assert.deepEqual(errors, []);
    await ctx.close();
  },

  async 'align, distribute, and the picture-only items'() {
    const { ctx, page, errors } = await openInkwell();
    const id = await openDrawing(page, [rect(100, 100, 40, 40, '#e03131'), rect(180, 130, 60, 40, '#1971c2'), rect(330, 160, 40, 60, '#7048e8')]);
    await page.keyboard.press('v');
    await page.keyboard.press('Control+a');
    await page.keyboard.press('ContextMenu');
    await page.waitForSelector('.tc-menu');
    assert.ok((await menuItems(page)).includes('Align›') && (await menuItems(page)).includes('Distribute›'));
    await page.click('.tc-menu .tc-item:has-text("Align")');
    await page.click('.tc-sub .tc-item:has-text("Top")');
    await settle(page);
    const ys = (await saved(page, id)).map((s) => Math.min(s.y1, s.y2));
    assert.equal(new Set(ys).size, 1, 'all tops line up');
    await page.keyboard.press('ContextMenu');
    await page.click('.tc-menu .tc-item:has-text("Distribute")');
    await page.click('.tc-sub .tc-item:has-text("Across")');
    await settle(page);
    const xs = (await saved(page, id)).map((s) => [Math.min(s.x1, s.x2), Math.max(s.x1, s.x2)]).sort((a, b) => a[0] - b[0]);
    const gap1 = xs[1][0] - xs[0][1];
    const gap2 = xs[2][0] - xs[1][1];
    assert.ok(Math.abs(gap1 - gap2) < 0.6, `equal gaps (${gap1} vs ${gap2})`);
    // keyboard in a submenu: → opens, ← closes, Esc closes the menu
    await page.keyboard.press('ContextMenu');
    await page.waitForSelector('.tc-menu');
    await page.keyboard.press('ArrowRight'); // the first item, Layer, is focused
    await page.waitForSelector('.tc-sub');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.$('.tc-sub'), null);
    await page.keyboard.press('Escape');
    assert.equal(await page.$('.tc-menu'), null);
    assert.deepEqual(errors, []);
    await ctx.close();
  },
};
