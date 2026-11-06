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

  async 'click to edit types in the typeset row with a caret; the setting turns it all off'() {
    const { ctx, page, errors } = await openInkwell();
    await openCalc(page, ['y = x^2/4']);
    const row = '#calcRows .calc-row:nth-child(1)';
    assert.equal(await page.$eval(`${row} .row-input`, (i) => i.getBoundingClientRect().width < 5), true, 'the text input is tucked away while the row is typeset');
    await page.mouse.click(...(await page.$eval(`${row} .row-math`, (m) => { const r = m.getBoundingClientRect(); return [r.x + 20, r.y + 10]; })));
    await page.waitForTimeout(200);
    // editing happens in the typeset row itself, with a caret in it (no separate preview underneath)
    assert.equal(await page.$eval(`${row} .row-input`, (i) => i === document.activeElement), true, 'the row is focused');
    assert.equal(await page.$eval(`${row} .row-input`, (i) => i.getBoundingClientRect().width < 5), true, 'the plain box stays out of the way');
    assert.ok(await page.$(`${row} .row-math .math-caret`), 'the typeset row has a caret');
    assert.equal(await page.inputValue(`${row} .row-input`), 'y = x^2/4');
    // typing "/" gives a fraction with the caret waiting in the denominator
    await page.fill(`${row} .row-input`, 'y = t/');
    await page.waitForTimeout(150);
    assert.equal(await page.$eval(`${row} .row-math mfrac`, (f) => !!f.querySelector('.math-caret')), true, 'the caret sits in the denominator');
    await page.fill(`${row} .row-input`, 'y = sqrt(x');
    await page.waitForTimeout(150);
    assert.ok(await page.$(`${row} .row-math msqrt`), 'an unclosed bracket still shows as typeset');
    // moving the caret with the arrow keys moves it in the typeset view
    await page.fill(`${row} .row-input`, 'y = x^2/4');
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(150);
    assert.ok(await page.$(`${row} .row-math .math-caret`));
    assert.equal(await page.$eval(`${row} .row-math`, (m) => m.querySelector('mfrac').children[0].contains(m.querySelector('.math-caret'))), true, 'the caret moved out of the denominator and into the numerator');
    // text that can't be read yet is still shown in the row, as typed, with the caret in it
    await page.fill(`${row} .row-input`, 'y = x^*');
    await page.waitForTimeout(150);
    assert.match(await page.$eval(`${row} .row-math`, (m) => m.textContent), /y\s*=\s*x\^\*/);
    assert.ok(await page.$(`${row} .row-math .math-caret`));
    assert.equal(await page.$eval(`${row} .row-input`, (i) => i.getBoundingClientRect().width < 5), true, 'the plain box never comes back while typing');
    // an empty row shows just the caret
    await page.fill(`${row} .row-input`, '');
    await page.waitForTimeout(150);
    assert.ok(await page.$(`${row} .row-math .math-caret`), 'an empty row has a caret to type into');
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

  async 'typing / opens a denominator that keeps what you type, like Desmos'() {
    const { ctx, page, errors } = await openInkwell();
    await openCalc(page, ['']);
    const row = '#calcRows .calc-row:nth-child(1)';
    const input = `${row} .row-input`;
    await page.click(input, { force: true });
    await page.keyboard.type('t/2+x');
    await page.waitForTimeout(200);
    assert.equal(await page.inputValue(input), 't/(2+x)', 'the denominator took the rest');
    assert.equal(await page.$eval(`${row} .row-math mfrac`, (f) => f.children[1].textContent.replace(/\s/g, '')), '2+x');
    // → steps out of the denominator; what follows is outside the fraction
    await page.keyboard.press('ArrowRight');
    await page.keyboard.type('+1');
    await page.waitForTimeout(150);
    assert.equal(await page.inputValue(input), 't/(2+x)+1');
    // typing ")" steps over the closing bracket instead of doubling it; what follows still sits in the denominator
    await page.fill(input, '');
    await page.keyboard.type('a/(b+c)+d');
    assert.equal(await page.inputValue(input), 'a/((b+c)+d)');
    // Backspace right after the slash takes the pair away together
    await page.fill(input, '');
    await page.keyboard.type('x/');
    assert.equal(await page.inputValue(input), 'x/()');
    await page.keyboard.press('Backspace');
    assert.equal(await page.inputValue(input), 'x/');
    // nothing to divide, and d/dx, are left alone
    await page.fill(input, '');
    await page.keyboard.type('/');
    assert.equal(await page.inputValue(input), '/');
    await page.fill(input, '');
    await page.keyboard.type('d/dx x^2');
    assert.equal(await page.inputValue(input), 'd/dx x^2');
    assert.deepEqual(errors, []);
    await ctx.close();
  },

  async 'element and isotope data in rows: typed live, typeset, and answered'() {
    const { ctx, page, errors } = await openInkwell();
    await openCalc(page, ['']);
    const row = (n) => `#calcRows .calc-row:nth-child(${n})`;
    const input = `${row(1)} .row-input`;
    await page.click(input, { force: true });
    await page.keyboard.type('mass(Fe-56)');
    await page.waitForTimeout(250);
    assert.equal(await page.inputValue(input), 'mass(Fe-56)');
    assert.ok(await page.$(`${row(1)} .row-math .math-caret`), 'the caret stays in the typeset row');
    assert.equal(await page.$$eval(`${row(1)} .row-math mi`, (m) => m.filter((x) => x.textContent === 'Fe').length), 1, 'Fe is one upright symbol, not F times e');
    await page.keyboard.press('Enter');
    await page.keyboard.type('molar(Ca(OH)2)');
    await page.keyboard.press('Enter');
    await page.keyboard.type('EN(oxygen)');
    await page.keyboard.press('Enter');
    await page.keyboard.type('halflife(C-14)');
    await page.keyboard.press('Enter');
    await page.keyboard.type('mass(Fe, 999)');
    await page.keyboard.press('Escape');
    await page.click(`${row(5)} .row-math`).catch(() => {});
    await page.click('#calcTitle, .editor-head', { timeout: 1000 }).catch(() => {});
    await page.waitForTimeout(300);
    const out = await extra(page);
    assert.match(out[0], /55\.93493/, 'the isotope mass');
    assert.match(out[1], /74\.09/, 'molar mass of calcium hydroxide');
    assert.match(out[2], /3\.44/, 'electronegativity by element name');
    assert.match(out[3].replace(/[\s,]/g, ''), /1799\d*/, 'the half-life of carbon-14 in seconds (about 1.8e11)');
    assert.match(out[4], /Fe-999 isn’t in the isotope data|isotope/, 'a clear message for an isotope that does not exist');
    // the formula is typeset with a subscript
    assert.ok(await page.$(`${row(2)} .row-math msub`), 'subscripts in the formula');
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
