const assert = require('node:assert');
const { openInkwell, until } = require('./lib');

// Headless Chromium won't let a page read the clipboard, so record what is written to it instead.
const clip = (page) => page.evaluate(() => window.__clip);
const toast = (page) => page.$eval('.toast', (t) => t.textContent).catch(() => '');
const name = (page) => page.textContent('#ptable .pt-name b');

module.exports = {
  async 'periodic table: open from the header, find an element, copy numbers, isotopes, corners, it stays open'() {
    const { ctx, page, errors } = await openInkwell({ width: 1100 });
    await page.evaluate(() => {
      window.__clip = null;
      navigator.clipboard.writeText = async (t) => {
        window.__clip = t;
      };
    });
    assert.equal(await page.isVisible('#ptable'), false, 'closed to start with');
    await page.click('#ptableBtn2');
    await page.waitForSelector('#ptable:not([hidden])');
    assert.equal((await page.$$('#ptable .pt-cell[data-z]')).length, 118);
    assert.equal(await page.getAttribute('#ptableBtn2', 'aria-pressed'), 'true');
    // laid out like the real table: He top right, Og bottom right of the main block
    const pos = (z) => page.$eval(`#ptable .pt-cell[data-z="${z}"]`, (e) => [e.style.gridRow, e.style.gridColumn]);
    assert.deepEqual(await pos(2), ['1', '18']);
    assert.deepEqual(await pos(118), ['7', '18']);

    // compact: the chips copy bare numbers
    await page.fill('#ptable .pt-search', 'oxygen');
    await page.keyboard.press('Enter');
    assert.equal(await name(page), 'Oxygen');
    await page.click('#ptable .pt-chip >> text=Mass');
    await until(async () => (await clip(page)) === '15.999', { what: 'the mass on the clipboard' });
    assert.match(await toast(page), /Copied Atomic mass: 15\.999/);
    await page.click('#ptable .pt-chip >> text=EN');
    await until(async () => (await clip(page)) === '3.44');
    await page.click('#ptable .pt-chip >> text=Z');
    await until(async () => (await clip(page)) === '8');
    // by symbol and number, and by clicking a cell
    await page.fill('#ptable .pt-search', 'Fe');
    await page.keyboard.press('Enter');
    assert.equal(await name(page), 'Iron');
    await page.fill('#ptable .pt-search', '79');
    await page.keyboard.press('Enter');
    assert.equal(await name(page), 'Gold');
    await page.click('#ptable .pt-cell[data-z="26"]');
    assert.equal(await name(page), 'Iron');
    assert.equal((await page.$$('#ptable .pt-iso')).length, 0, 'compact mode has no isotope list');

    // full: every property and the isotopes
    await page.click('#ptable .pt-btn >> nth=0');
    await page.waitForSelector('#ptable .pt-iso');
    const rows = await page.$$eval('#ptable .pt-iso-row:not(.pt-iso-h)', (r) => r.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
    assert.equal(rows.length, 4, 'Fe-54, 56, 57 and 58 are the key isotopes');
    assert.match(rows[1], /56Fe\s*55\.934936\s*91\.754%\s*stable/);
    await page.click('#ptable .pt-iso-row:nth-child(3) .pt-val >> nth=0'); // Fe-56 mass
    await until(async () => (await clip(page)) === '55.934936', { what: 'the isotope mass' });
    await page.click('#ptable .pt-iso-row:nth-child(3) .pt-val >> nth=1');
    await until(async () => (await clip(page)) === '91.754');
    await page.click('#ptable .pt-prop:has-text("Melting point") .pt-val >> nth=1'); // the °C value
    await until(async () => (await clip(page)) === '1538.05');
    await page.click('#ptable .pt-prop:has-text("Electron configuration") .pt-val');
    await until(async () => (await clip(page)) === '[Ar] 3d6 4s2');
    await page.click('#ptable >> text=Show all');
    assert.ok((await page.$$('#ptable .pt-iso-row')).length > 20, 'all of the known isotopes');
    // an element with no natural isotopes lists its longest-lived ones
    await page.fill('#ptable .pt-search', 'tc');
    await page.keyboard.press('Enter');
    const tc = await page.$$eval('#ptable .pt-iso-row:not(.pt-iso-h)', (r) => r.map((x) => x.textContent));
    assert.ok(tc.length >= 1 && tc.length <= 5 && tc.every((t) => !/stable/.test(t)));

    // corners, and it stays after a reload
    const corner = () => page.getAttribute('#ptable', 'data-corner');
    assert.equal(await corner(), 'br');
    await page.click('#ptable .pt-btn >> nth=1');
    assert.equal(await corner(), 'bl');
    await page.waitForTimeout(500);
    await page.reload();
    await page.waitForSelector('#ptable:not([hidden])');
    assert.equal(await corner(), 'bl');
    assert.equal(await name(page), 'Technetium');
    // arrow keys move between elements
    await page.focus('#ptable .pt-cell[data-z="26"]');
    await page.keyboard.press('ArrowRight');
    assert.equal(await name(page), 'Cobalt');
    await page.keyboard.press('ArrowDown');
    assert.equal(await name(page), 'Rhodium');
    // Esc closes it, and closed stays closed
    await page.keyboard.press('Escape');
    await page.waitForSelector('#ptable', { state: 'hidden' });
    await page.waitForTimeout(400);
    await page.reload();
    await page.waitForTimeout(800);
    assert.equal(await page.isVisible('#ptable'), false);
    assert.deepEqual(errors, []);
    await ctx.close();
  },
};
