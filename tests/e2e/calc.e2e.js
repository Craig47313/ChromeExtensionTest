const assert = require('node:assert');
const { openInkwell, until } = require('./lib');

async function openCalc(page, rows) {
  await page.evaluate(async (rows) => {
    const n = Store.createNote({ type: 'calc', title: 'Calc test', calc: { v: 2, rows: rows.map((text) => ({ text })) } });
    await Store.put(n);
    await Store.requestOpen(n.id);
  }, rows);
  await page.waitForSelector('#calcRows .calc-row');
  await page.waitForTimeout(600);
}
async function openAppearance(page) {
  await page.evaluate(() => document.querySelector('#appMenuBtn').click());
  await page.click('.menu >> text=Appearance');
  await page.waitForSelector('#appearanceDialog[open]');
}
const extra = (page) => page.$$eval('#calcRows .row-extra', (r) => r.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));

module.exports = {
  async 'rows are typeset, derivatives show their exact form, integrals give numbers'() {
    const { ctx, page, errors } = await openInkwell();
    await openCalc(page, ['f(x) = x^3/3 - 2x', "f'(x)", 'd/dx sin(2x)', 'int_0^1 x^2 dx', 'F(x) = int(cos(t), t, 0, x)', 'a = 2', 'sqrt(x+1) + a/2', 'int(e^(-x^2), x, -inf, inf)']);
    assert.equal(await page.$$eval('#calcRows .calc-row.has-math', (r) => r.length), 8, 'every filled row is typeset');
    assert.ok((await page.$$eval('#calcRows .row-math math mfrac', (m) => m.length)) >= 3, 'fractions are drawn as fractions');
    assert.ok(await page.$('#calcRows .row-math math msqrt'), 'roots get a radical');
    assert.ok(await page.$('#calcRows .row-math math msubsup'), 'the integral has limits');
    const out = await extra(page);
    assert.match(out[1], /^=.*x2.*2/, 'f′ shows x² − 2');
    assert.match(out[2], /2cos\(2x\)/, 'd/dx sin(2x) shows 2cos(2x)');
    assert.match(out[3], /0\.3333333333/);
    assert.match(out[7], /1\.772453851/);
    // curves for f, f′, d/dx, and the integral function: the sliders and numbers are not graphed
    assert.equal(await page.$$eval('#calcRows .row-icon.graphable', (r) => r.length), 5, 'the five curves have their colour dot; sliders and plain numbers don’t');
    assert.deepEqual(errors, []);
    await ctx.close();
  },

  async 'click to edit shows the plain text with a preview; typing updates; the setting turns it all off'() {
    const { ctx, page, errors } = await openInkwell();
    await openCalc(page, ['y = x^2/4']);
    const row = '#calcRows .calc-row:nth-child(1)';
    assert.equal(await page.$eval(`${row} .row-input`, (i) => i.getBoundingClientRect().width < 5), true, 'the text input is tucked away while the row is typeset');
    await page.mouse.click(...(await page.$eval(`${row} .row-math`, (m) => { const r = m.getBoundingClientRect(); return [r.x + 20, r.y + 10]; })));
    await page.waitForTimeout(200);
    assert.equal(await page.$eval(`${row} .row-input`, (i) => i.getBoundingClientRect().width > 50), true, 'clicking reveals the plain text');
    assert.equal(await page.inputValue(`${row} .row-input`), 'y = x^2/4');
    await page.fill(`${row} .row-input`, 'y = sqrt(x)');
    await page.waitForTimeout(150);
    assert.ok(await page.$(`${row} .row-math msqrt`), 'the preview follows what you type');
    // a half-typed row can't be typeset: it stays as text until it parses
    await page.fill(`${row} .row-input`, 'y = x^');
    await page.waitForTimeout(150);
    assert.equal(await page.$eval(`${row} .row-math`, (m) => m.innerHTML), '');
    await page.fill(`${row} .row-input`, 'y = x^2');
    await page.keyboard.press('Tab');
    // turn it off in Appearance
    await page.evaluate(() => Store.setSettings({ typesetMath: false }));
    await until(async () => (await page.$$('#calcRows .calc-row.has-math')).length === 0, { what: 'plain rows' });
    assert.equal(await page.$eval(`${row} .row-input`, (i) => i.getBoundingClientRect().width > 50), true);
    await page.evaluate(() => Store.setSettings({ typesetMath: true }));
    await until(async () => (await page.$$('#calcRows .calc-row.has-math')).length === 1, { what: 'typeset rows again' });
    assert.deepEqual(errors, []);
    await ctx.close();
  },

  async 'the Appearance dialog has the typeset switch and it sticks'() {
    const { ctx, page, errors } = await openInkwell();
    await openAppearance(page);
    assert.equal(await page.isChecked('#typesetMath'), true, 'on by default');
    await page.uncheck('#typesetMath');
    await until(async () => (await page.evaluate(() => Store.getSettings())).typesetMath === false);
    await page.reload();
    await page.waitForTimeout(800);
    await openAppearance(page);
    assert.equal(await page.isChecked('#typesetMath'), false);
    assert.deepEqual(errors, []);
    await ctx.close();
  },
};
