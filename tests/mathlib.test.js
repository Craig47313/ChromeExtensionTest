// Run with: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert');
const M = require('../lib/mathlib.js');

const one = (text, opts) => M.evaluate([{ text }], opts)[0];
const value = (text, opts) => {
  const r = one(text, opts);
  assert.equal(r.kind, 'value', `${text} → ${r.kind} ${r.message || ''}`);
  return r.value;
};
const at = (text, x, opts) => {
  const r = one(text, opts);
  assert.equal(r.kind, 'graph', `${text} → ${r.kind} ${r.message || ''}`);
  return r.fn(x);
};
const near = (a, b, tol = 1e-7) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≈ ${b}`);

test('the old language still works', () => {
  near(value('2+3*4'), 14);
  near(value('2pi'), 2 * Math.PI);
  near(at('x^2 - 4', 3), 5);
  assert.equal(M.evaluate([{ text: 'a = 3' }, { text: 'a x' }])[1].kind, 'graph');
});

test('derivatives: d/dx, diff() and f′(x)', () => {
  near(at('d/dx x^2', 3), 6);
  near(at('d/dx sin(2x)', 0.7), 2 * Math.cos(1.4));
  near(at('d/dx 5x', 2), 5);
  near(at('d/dx x^2 sin(x)', 1), 2 * Math.sin(1) + Math.cos(1));
  near(at('d/dx x^x', 1.5), Math.pow(1.5, 1.5) * (Math.log(1.5) + 1));
  near(at('d/dx ln(x)', 4), 0.25);
  near(at('d/dx sqrt(x)', 4), 0.25);
  near(at('d/dx (1/x)', 2), -0.25); // d/dx applies to the next factor, like a function name
  near(at('d/dx atan(x)', 1), 0.5);
  near(at('d/dx tanh(x)', 0), 1);
  near(at('d/dx e^(3x)', 0), 3);
  near(at('diff(x^3, x)', 2), 12);
  near(at('derivative(x^3)', 2), 12);
  near(at('d/dx d/dx x^4', 2), 48);
  near(at('d/dx abs(x)', -3), -1);
  const f = M.evaluate([{ text: 'f(x) = x^3 + 2x' }, { text: "f'(x)" }, { text: "f''(2)" }, { text: "sin'(0)" }]);
  near(f[1].fn(2), 14);
  near(f[2].value, 12);
  near(f[3].value, 1);
  // The chain rule through a function you defined.
  const g = M.evaluate([{ text: 'g(x) = x^2' }, { text: 'd/dx g(3x)' }]);
  near(g[1].fn(1), 18);
});

test('degrees mode scales trig derivatives', () => {
  near(at('d/dx sin(x)', 0, { angle: 'deg' }), Math.PI / 180);
  near(at('d/dx asin(x)', 0, { angle: 'deg' }), 180 / Math.PI);
});

test('a derivative shows its exact form', () => {
  const r = one('d/dx x^3');
  assert.ok(r.symbolic);
  const html = M.toMathML(r.symbolic);
  assert.ok(html.includes('<msup>') && html.includes('3'), html);
  assert.equal(one('2 + 2').symbolic, undefined);
});

test('derivatives come out tidy', () => {
  const text = (src, rows = []) => {
    const res = M.evaluate([...rows, { text: src }]).pop();
    return M.toMathML(res.symbolic).replace(/<\/?m(row|n|i|ath)[^>]*>/g, '');
  };
  assert.equal(text('d/dx x^3/3'), '<msup>x2</msup>');
  assert.equal(text('d/dx (x^3/3 - 2x)'), '<msup>x2</msup><mo>−</mo>2');
  assert.equal(text('d/dx 5x'), '5');
  assert.equal(text('d/dx 7'), '0');
});

test('what can’t be differentiated says so', () => {
  assert.match(one('d/dx max(x, 1)').message, /derivative/);
  assert.match(one('d/dx x!').message, /factorial/);
});

test('definite integrals, in both spellings', () => {
  near(value('int(x^2, x, 0, 1)'), 1 / 3, 1e-9);
  near(value('int_0^1 x^2 dx'), 1 / 3, 1e-9);
  near(value('∫_0^pi sin(x) dx'), 2, 1e-9);
  near(value('integral(cos(t), t, 0, pi/2)'), 1, 1e-9);
  near(value('int(1/x, x, 1, e)'), 1, 1e-9);
  near(value('int_(-1)^1 x^3 dx'), 0, 1e-9);
  near(value('int(sqrt(x), x, 0, 4)'), 16 / 3, 1e-8); // an endpoint where the slope blows up
  near(value('int(x, x, 3, 0)'), -4.5, 1e-9);
  near(value('int(x, x, 2, 2)'), 0);
});

test('integrals with infinite limits', () => {
  near(value('int(e^(-x^2), x, -inf, inf)'), Math.sqrt(Math.PI), 1e-8);
  near(value('int(e^(-x), x, 0, ∞)'), 1, 1e-8);
  near(value('int(1/(1+x^2), x, -inf, 0)'), Math.PI / 2, 1e-8);
});

test('an integral can have x as a limit, and its variable isn’t "x"', () => {
  const r = M.evaluate([{ text: 'F(x) = int(sin(t), t, 0, x)' }])[0];
  assert.equal(r.kind, 'graph');
  near(r.fn(Math.PI), 2, 1e-9);
  const dummy = one('int(x^2, x, 0, 3)'); // x inside is the integration variable, so this is a number
  assert.equal(dummy.kind, 'value');
  near(dummy.value, 9, 1e-9);
  const two = M.evaluate([{ text: 'a = 2' }, { text: 'int(a t, t, 0, 3)' }])[1];
  near(two.value, 9, 1e-9);
});

test('the integrator is exact on polynomials', () => {
  near(M.integrate((x) => x ** 8, -1, 1), 2 / 9, 1e-12);
  near(M.integrate((x) => Math.exp(x), 0, 1), Math.E - 1, 1e-12);
});

test('typeset: fractions, powers, roots, calculus', () => {
  assert.equal(M.typeset(''), null);
  assert.equal(M.typeset('x^'), null); // still being typed
  assert.match(M.typeset('y = x^2 / 3'), /<mfrac><msup>.*<\/msup>.*<\/mfrac>/);
  assert.match(M.typeset('sqrt(x+1)'), /<msqrt>/);
  assert.match(M.typeset('2pi r'), /π/);
  assert.match(M.typeset('f(x) = sin(2x)'), /<mi>f<\/mi>/);
  assert.match(M.typeset('d/dx x^2'), /<mfrac><mi>d<\/mi>/);
  assert.match(M.typeset('int_0^1 x^2 dx'), /<msubsup><mo>∫<\/mo>/);
  assert.match(M.typeset("f'(x)", [`f(x) = x`]), /′/);
  assert.match(M.typeset('(1, 2)'), /<mo>,<\/mo>/);
  // Names defined elsewhere stay whole: "speed" isn't s·p·e·e·d.
  assert.ok(!M.typeset('speed*2', ['speed = 3']).includes('<mi>s</mi><mi>p</mi>'));
});

// ---------- element and isotope data ----------
globalThis.self = globalThis;
require('../lib/elements.js');

test('elements: mass, number, electronegativity and friends take a symbol or a name', () => {
  near(value('mass(Fe)'), 55.845);
  near(value('mass(iron)'), 55.845);
  near(value('mass(26)'), 55.845);
  assert.equal(value('protons(Au)'), 79);
  near(value('EN(O)'), 3.44);
  near(value('EN(fluorine)'), 3.98);
  near(value('IE(Na)'), 5.139, 1e-3);
  near(value('mp(Fe)'), 1811.2, 1e-4);
  near(value('bp(water)'.replace('water', 'O')), 90.2, 0.05);
  assert.ok(value('density(Au)') > 19);
  near(value('radius(Cs)'), 260);
  near(value('mass(aluminium)'), 26.98, 1e-3);
});

test('isotopes: mass, abundance, half-life, neutrons — by number or as Fe-56', () => {
  near(value('mass(Fe, 56)'), 55.934936, 1e-6);
  near(value('mass(Fe-56)'), 55.934936, 1e-6);
  near(value('abundance(Fe, 56)'), 91.754, 1e-4);
  assert.equal(value('abundance(Fe-55)'.replace('Fe-55', 'Fe, 55')), 0);
  assert.equal(value('neutrons(Fe, 56)'), 30);
  assert.equal(value('neutrons(C-14)'), 8);
  assert.equal(value('neutrons(C)'), 6, 'the most abundant isotope when none is given');
  near(value('halflife(C, 14)') / (365.25 * 86400), 5700, 0.02);
  assert.equal(value('halflife(Fe, 56)'), Infinity, 'stable');
});

test('elements and isotopes work inside bigger expressions and definitions', () => {
  near(value('2*mass(O) + mass(H)*2'), 2 * 15.999 + 2 * 1.008, 1e-3);
  const r = M.evaluate([{ text: 'm = mass(C, 12)' }, { text: 'm / 12' }]);
  near(r[1].value, 1, 1e-6);
  near(M.evaluate([{ text: 'f(x) = x * EN(O)' }, { text: 'f(2)' }])[1].value, 6.88);
});

test('molar mass of a formula', () => {
  near(value('molar(H2O)'), 18.015, 1e-3);
  near(value('molar(CO2)'), 44.009, 1e-3);
  near(value('molar(Ca(OH)2)'), 74.093, 1e-3);
  near(value('molar(Al2(SO4)3)'), 342.15, 1e-3);
  near(value('molar(CuSO4.5H2O)'), 249.68, 1e-3);
  near(value('molar(NaCl) * 2'), 116.88, 1e-3);
  near(value('molar(C6H12O6)'), 180.156, 1e-3);
});

test('element errors say what is wrong, and ordinary names keep working', () => {
  assert.match(one('mass(Fe, 999)').message, /Fe-999 isn’t in the isotope data/);
  assert.match(one('EN(He)').message, /Helium has no electronegativity/);
  assert.match(one('mass(200)').message, /no element with atomic number 200/);
  assert.equal(one('molar(Xx2)').kind, 'error');
  // a variable called mass or radius is still just a variable
  const r = M.evaluate([{ text: 'mass = 5' }, { text: 'radius = 2' }, { text: 'mass * radius' }]);
  assert.equal(r[2].value, 10);
});

test('element rows are typeset with upright symbols and subscripted formulas', () => {
  const t = M.typeset('mass(Fe, 56)');
  assert.match(t, /<mi[^>]*>mass<\/mi>/);
  assert.match(t, /<mi mathvariant="normal">Fe<\/mi>/);
  const f = M.typeset('molar(Ca(OH)2)');
  assert.match(f, /<msub>.*OH.*<\/msub>|<msub><mrow><mo>\(<\/mo>/);
  assert.match(f, /<mi mathvariant="normal">Ca<\/mi>/);
  // still readable while typing, with the caret inside
  assert.ok(M.typeset('mass(F)', ['mass(F)'], 6));
});
