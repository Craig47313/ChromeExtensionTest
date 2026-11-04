const test = require('node:test');
const assert = require('node:assert');
globalThis.self = globalThis;
require('../lib/elements.js');
const { util } = require('../lib/ptable.js');
const E = globalThis.InkElements;

test('118 elements in order, each with the basics', () => {
  assert.equal(E.length, 118);
  E.forEach((e, i) => {
    assert.equal(e.z, i + 1);
    assert.ok(e.s && e.n && e.m > 0, `${e.z} has a symbol, name and mass`);
    assert.ok(e.cat, `${e.s} has a category`);
  });
  assert.equal(E[0].s, 'H');
  assert.equal(E[117].s, 'Og');
});

test('known values (spot checks)', () => {
  const by = (s) => E.find((e) => e.s === s);
  assert.equal(by('O').m.toFixed(3), '15.999');
  assert.equal(by('F').en, 3.98);
  assert.equal(by('Fe').en, 1.83);
  assert.equal(by('C').z, 6);
  assert.ok(Math.abs(by('Na').mp - 370.9) < 0.5);
  assert.ok(Math.abs(by('H').iso.find((i) => i[0] === 1)[2] - 99.9885) < 0.01);
  assert.equal(by('Fe').iso.find((i) => i[0] === 56)[3], 0, 'Fe-56 is stable');
  const c14 = by('C').iso.find((i) => i[0] === 14);
  assert.ok(Math.abs(c14[3] / (365.25 * 86400) - 5700) < 100, 'C-14 half-life about 5700 years');
});

test('every element has its own place on the grid, inside it', () => {
  const seen = new Set();
  for (const e of E) {
    const [r, c] = util.position(e.z);
    assert.ok(r >= 1 && r <= 10 && c >= 1 && c <= 18, `${e.s} inside the grid`);
    assert.ok(r !== 8, 'row 8 is the gap');
    const k = `${r},${c}`;
    assert.ok(!seen.has(k), `${e.s} doesn't share a cell (${k})`);
    seen.add(k);
  }
  // the shape of the table
  const at = (s) => util.position(E.find((e) => e.s === s).z);
  assert.deepEqual(at('H'), [1, 1]);
  assert.deepEqual(at('He'), [1, 18]);
  assert.deepEqual(at('B'), [2, 13]);
  assert.deepEqual(at('Al'), [3, 13]);
  assert.deepEqual(at('Fe'), [4, 8]);
  assert.deepEqual(at('Hf'), [6, 4]);
  assert.deepEqual(at('Rf'), [7, 4]);
  assert.deepEqual(at('Og'), [7, 18]);
  assert.deepEqual(at('La'), [9, 3]);
  assert.deepEqual(at('Lu'), [9, 17]);
  assert.deepEqual(at('Lr'), [10, 17]);
});

test('half-lives read as people say them', () => {
  assert.equal(util.fmtHalfLife(0), 'stable');
  assert.equal(util.fmtHalfLife(null), '?');
  assert.equal(util.fmtHalfLife(12.32 * 365.25 * 86400), '12.3 y');
  assert.equal(util.fmtHalfLife(4.5e9 * 365.25 * 86400), '4.5 Gy');
  assert.equal(util.fmtHalfLife(3600 * 2), '2 h');
  assert.equal(util.fmtHalfLife(0.021), '21 ms');
});

test('key isotopes: natural ones, or the longest-lived few', () => {
  const by = (s) => E.find((e) => e.s === s);
  assert.deepEqual(util.keyIsotopes(by('Fe')).map((i) => i[0]), [54, 56, 57, 58]);
  const tc = util.keyIsotopes(by('Tc'));
  assert.ok(tc.length > 0 && tc.length <= 5 && tc.every((i) => i[3] > 0));
  assert.ok(tc.some((i) => i[0] === 97 || i[0] === 98), 'Tc-97/98 are the long-lived ones');
});

test('find: symbol, name, start of a name, number', () => {
  assert.equal(util.find(E, 'fe').s, 'Fe');
  assert.equal(util.find(E, 'Iron').s, 'Fe');
  assert.equal(util.find(E, 'oxy').s, 'O');
  assert.equal(util.find(E, '79').s, 'Au');
  assert.equal(util.find(E, 'nothing'), null);
  assert.equal(util.find(E, ''), null);
});

test('facts copy bare numbers, and leave out what is missing', () => {
  const he = util.facts(E[1]);
  assert.equal(he.find((f) => f.key === 'en').copy, null);
  const o = util.facts(E.find((e) => e.s === 'O'));
  assert.equal(o.find((f) => f.key === 'm').copy, '15.999');
  assert.equal(o.find((f) => f.key === 'z').copy, '8');
  assert.match(util.summary(E.find((e) => e.s === 'O')), /Oxygen \(O\), Z = 8, M = 15\.999 u, EN = 3\.44/);
});
