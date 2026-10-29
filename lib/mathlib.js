// InkMath: a small, safe math language for the calculator (no eval).
//
//   2+3*4          → value              f(x) = x^2 + 1   → function (graphed)
//   a = 3          → variable (slider)   y = sin(a x)     → graph
//   x^2 - 4        → graph (uses x)      (1, 2)           → point
//   x = 2          → vertical line       2pi, 3(x+1), |x| → implicit multiplication, abs bars
(function () {
  'use strict';
  if (globalThis.InkMath) return;
  const root = globalThis;

  class MathError extends Error {
    constructor(message, extra = {}) {
      super(message);
      Object.assign(this, extra);
    }
  }

  // ---------- builtins ----------

  function gamma(z) {
    if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
    const g = 7;
    const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61503916999185, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    z -= 1;
    let x = c[0];
    for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
    const t = z + g + 0.5;
    return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
  }

  function factorial(n) {
    if (Number.isInteger(n)) {
      if (n < 0) return NaN;
      if (n > 170) return Infinity;
      let r = 1;
      for (let i = 2; i <= n; i++) r *= i;
      return r;
    }
    return gamma(n + 1);
  }

  function gcd(a, b) {
    a = Math.abs(Math.round(a));
    b = Math.abs(Math.round(b));
    while (b) [a, b] = [b, a % b];
    return a;
  }

  // name → [minArgs, maxArgs, (angle) => fn]
  const BUILTINS = {
    sin: [1, 1, (d) => (v) => Math.sin(d.in(v))],
    cos: [1, 1, (d) => (v) => Math.cos(d.in(v))],
    tan: [1, 1, (d) => (v) => Math.tan(d.in(v))],
    sec: [1, 1, (d) => (v) => 1 / Math.cos(d.in(v))],
    csc: [1, 1, (d) => (v) => 1 / Math.sin(d.in(v))],
    cot: [1, 1, (d) => (v) => 1 / Math.tan(d.in(v))],
    asin: [1, 1, (d) => (v) => d.out(Math.asin(v))],
    acos: [1, 1, (d) => (v) => d.out(Math.acos(v))],
    atan: [1, 2, (d) => (a, b) => d.out(b === undefined ? Math.atan(a) : Math.atan2(a, b))],
    sinh: [1, 1, () => Math.sinh],
    cosh: [1, 1, () => Math.cosh],
    tanh: [1, 1, () => Math.tanh],
    sqrt: [1, 1, () => Math.sqrt],
    cbrt: [1, 1, () => Math.cbrt],
    abs: [1, 1, () => Math.abs],
    ln: [1, 1, () => Math.log],
    log: [1, 2, () => (v, b) => (b === undefined ? Math.log10(v) : Math.log(v) / Math.log(b))],
    exp: [1, 1, () => Math.exp],
    floor: [1, 1, () => Math.floor],
    ceil: [1, 1, () => Math.ceil],
    round: [1, 2, () => (v, n = 0) => Math.round(v * 10 ** n) / 10 ** n],
    sign: [1, 1, () => Math.sign],
    min: [1, 99, () => Math.min],
    max: [1, 99, () => Math.max],
    mod: [2, 2, () => (a, b) => ((a % b) + b) % b],
    gcd: [2, 2, () => gcd],
    lcm: [2, 2, () => (a, b) => Math.abs(Math.round(a) * Math.round(b)) / gcd(a, b)],
    nCr: [2, 2, () => (n, r) => Math.round(factorial(n) / (factorial(r) * factorial(n - r)))],
    nPr: [2, 2, () => (n, r) => Math.round(factorial(n) / factorial(n - r))],
    gamma: [1, 1, () => gamma],
  };
  const ALIASES = { arcsin: 'asin', arccos: 'acos', arctan: 'atan', choose: 'nCr', lg: 'log' };
  const CONSTANTS = { pi: Math.PI, tau: Math.PI * 2, e: Math.E, phi: (1 + Math.sqrt(5)) / 2, inf: Infinity };
  // Calculus words: handled by the parser rather than as ordinary functions.
  const SPECIAL = new Set(['int', 'diff']);
  ALIASES.integral = 'int';
  ALIASES.derivative = 'diff';
  ALIASES.deriv = 'diff';
  ALIASES.infinity = 'inf';
  const RESERVED = new Set([...Object.keys(BUILTINS), ...Object.keys(ALIASES), ...Object.keys(CONSTANTS), ...SPECIAL]);

  // ---------- tokenizer ----------

  function normalize(src) {
    return src
      .replace(/[×·∙⋅]/g, '*')
      .replace(/÷/g, '/')
      .replace(/[−–]/g, '-')
      .replace(/π/g, ' pi ')
      .replace(/τ/g, ' tau ')
      .replace(/√/g, ' sqrt ')
      .replace(/∞/g, ' inf ')
      .replace(/∫/g, ' int ')
      .replace(/[′’]/g, "'")
      .replace(/²/g, '^2')
      .replace(/³/g, '^3');
  }

  // Split a run of letters into known names or single letters: "pix" → pi·x.
  function splitIdent(word, known) {
    if (known.has(word) || word.includes('_')) return [word];
    const out = [];
    let i = 0;
    while (i < word.length) {
      let match = word[i];
      for (let j = word.length; j > i + 1; j--) {
        const part = word.slice(i, j);
        if (known.has(part)) {
          match = part;
          break;
        }
      }
      out.push(match);
      i += match.length;
    }
    return out;
  }

  function tokenize(src, known) {
    const s = normalize(src);
    const toks = [];
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) {
        i++;
        continue;
      }
      const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/.exec(s.slice(i)); // 1e3 = 1000, but 2e = 2·e
      if (num) {
        toks.push({ t: 'num', v: parseFloat(num[0]) });
        i += num[0].length;
        continue;
      }
      const id = /^[a-zA-Z]+(_[a-zA-Z0-9]+)?/.exec(s.slice(i));
      if (id) {
        for (const name of splitIdent(id[0], known)) toks.push({ t: 'id', v: ALIASES[name] || name });
        i += id[0].length;
        continue;
      }
      if (s.startsWith('**', i)) {
        toks.push({ t: 'op', v: '^' });
        i += 2;
        continue;
      }
      if ("+-*/^!(),=|%'".includes(c)) {
        toks.push({ t: 'op', v: c });
        i++;
        continue;
      }
      throw new MathError(`Unexpected “${c}”`);
    }
    return toks;
  }

  // ---------- parser ----------

  function parseTokens(toks) {
    let pos = 0;
    let absDepth = 0;
    const peek = () => toks[pos];
    const isOp = (v) => peek() && peek().t === 'op' && peek().v === v;
    const expectOp = (v) => {
      if (!isOp(v)) throw new MathError(peek() ? `Expected “${v}”` : `Missing “${v}”`);
      pos++;
    };
    const startsPrimary = () => {
      const tk = peek();
      if (!tk) return false;
      if (tk.t === 'num' || tk.t === 'id') return true;
      return tk.t === 'op' && (tk.v === '(' || (tk.v === '|' && absDepth === 0));
    };

    function expr() {
      let node = mul();
      while (isOp('+') || isOp('-')) {
        const op = toks[pos++].v;
        node = { t: 'bin', op, a: node, b: mul() };
      }
      return node;
    }

    function mul() {
      let node = unary();
      for (;;) {
        if (isOp('*') || isOp('/')) {
          const op = toks[pos++].v;
          node = { t: 'bin', op, a: node, b: unary() };
        } else if (startsPrimary()) {
          node = { t: 'bin', op: '*', a: node, b: power(), imp: true }; // implicit: 2x, 3(x+1), x sin x
        } else return node;
      }
    }

    function unary() {
      if (isOp('-')) {
        pos++;
        return { t: 'neg', a: unary() };
      }
      if (isOp('+')) {
        pos++;
        return unary();
      }
      return power();
    }

    function power() {
      const base = postfix();
      if (isOp('^')) {
        pos++;
        return { t: 'bin', op: '^', a: base, b: unary() };
      }
      return base;
    }

    function postfix() {
      let node = primary();
      for (;;) {
        if (isOp('!')) {
          pos++;
          node = { t: 'fact', a: node };
        } else if (isOp('%')) {
          pos++;
          node = { t: 'bin', op: '/', a: node, b: { t: 'num', v: 100 } };
        } else return node;
      }
    }

    function primary() {
      const tk = peek();
      if (!tk) throw new MathError('Incomplete expression');
      if (tk.t === 'num') {
        pos++;
        return { t: 'num', v: tk.v };
      }
      if (tk.t === 'id') {
        pos++;
        // d/dx operand: a derivative.
        const at = (i) => toks[pos + i];
        if (tk.v === 'd' && isOp('/') && at(1) && at(1).t === 'id' && at(1).v === 'd' && at(2) && at(2).t === 'id' && /^[a-zA-Z]$/.test(at(2).v)) {
          const save = pos;
          pos += 3;
          if (startsPrimary()) {
            // The derivative takes the whole product that follows: d/dx 5x is 5, d/dx x^2 sin x is a product rule.
            let body = power();
            while (startsPrimary()) body = { t: 'bin', op: '*', a: body, b: power(), imp: true };
            return { t: 'deriv', body, v: toks[save + 2].v };
          }
          pos = save;
        }
        // f'(x), f''(x): the derivative of f.
        let order = 0;
        while (isOp("'")) {
          pos++;
          order++;
        }
        if (order) {
          if (!isOp('(')) throw new MathError(`Write ${tk.v}${"′".repeat(order)}(x) with an argument`);
          pos++;
          const args = list();
          expectOp(')');
          return { t: 'prime', n: tk.v, order, args };
        }
        if (isOp('(')) {
          pos++;
          const args = isOp(')') ? [] : list();
          expectOp(')');
          if (tk.v === 'int') {
            const named = args.length === 4 && args[1].t === 'var';
            if (args.length !== 3 && !named) throw new MathError('int needs (expression, from, to) or (expression, variable, from, to)');
            return named ? { t: 'int', body: args[0], v: args[1].n, lo: args[2], hi: args[3] } : { t: 'int', body: args[0], v: 'x', lo: args[1], hi: args[2] };
          }
          if (tk.v === 'diff') {
            if (args.length < 1 || args.length > 2 || (args[1] && args[1].t !== 'var')) throw new MathError('diff needs (expression) or (expression, variable)');
            return { t: 'deriv', body: args[0], v: args[1] ? args[1].n : 'x' };
          }
          return { t: 'call', n: tk.v, args };
        }
        if (SPECIAL.has(tk.v)) throw new MathError(tk.v === 'int' ? 'int needs (expression, from, to)' : 'diff needs (expression)');
        // "sin x", "sqrt 2": builtin applied to the next factor.
        if (BUILTINS[tk.v] && startsPrimary()) return { t: 'call', n: tk.v, args: [power()] };
        return { t: 'var', n: tk.v };
      }
      if (tk.v === '(') {
        pos++;
        const items = list();
        expectOp(')');
        if (items.length === 1) return items[0];
        if (items.length === 2) return { t: 'tuple', items };
        throw new MathError('Points need exactly two coordinates');
      }
      if (tk.v === '|') {
        pos++;
        absDepth++;
        const inner = expr();
        absDepth--;
        expectOp('|');
        return { t: 'call', n: 'abs', args: [inner] };
      }
      throw new MathError(`Unexpected “${tk.v}”`);
    }

    function list() {
      const items = [expr()];
      while (isOp(',')) {
        pos++;
        items.push(expr());
      }
      return items;
    }

    const node = expr();
    if (pos < toks.length) throw new MathError(`Unexpected “${toks[pos].v}”`);
    return node;
  }

  // ---------- rows ----------

  const LHS_RE = /^\s*([a-zA-Z]+(?:_[a-zA-Z0-9]+)?)\s*(?:\(\s*([a-zA-Z](?:\s*,\s*[a-zA-Z])*)\s*\))?\s*=(?!=)/;

  // "int_0^1 x^2 dx" or "∫_a^(b+1) f(t) dt" → int((x^2), x, 0, 1).
  const INT_OP = /^\s*(?:∫|int(?:egral)?)\s*_\s*(\([^)]*\)|[-\w.∞]+)\s*\^\s*(\([^)]*\)|[-\w.∞]+)\s+(.+?)\s*d([a-zA-Z])\s*$/;
  function rewriteIntegral(src) {
    const m = INT_OP.exec(src);
    return m ? `int((${m[3]}), ${m[4]}, ${m[1]}, ${m[2]})` : src;
  }

  // Parse one row into { kind, name, params, ast }.
  function parseRow(text, known) {
    const src = text.trim();
    if (!src) return { kind: 'empty' };
    const m = LHS_RE.exec(src);
    if (m) {
      const name = m[1];
      const params = m[2] ? m[2].split(',').map((p) => p.trim()) : null;
      const rhs = rewriteIntegral(src.slice(m[0].length));
      if (!rhs.trim()) throw new MathError('Nothing after “=”');
      if (rhs.includes('=')) throw new MathError('Only one “=” allowed');
      const inner = new Set(known);
      if (params) params.forEach((p) => inner.add(p));
      const ast = parseTokens(tokenize(rhs, inner));
      if (name === 'y' && !params) return { kind: 'graph', ast };
      if (name === 'x' && !params) return { kind: 'vline', ast };
      if (RESERVED.has(name)) throw new MathError(`“${name}” is a built-in name`);
      if (params) {
        if (new Set(params).size !== params.length) throw new MathError('Repeated parameter');
        return { kind: 'func', name, params, ast };
      }
      return { kind: 'var', name, ast };
    }
    if (src.includes('=')) throw new MathError('Equations like this aren’t supported yet — try “y = …”');
    return { kind: 'expr', ast: parseTokens(tokenize(rewriteIntegral(src), known)) };
  }

  // Visit every node; `bound` holds the names an enclosing integral binds (they aren't free).
  function walk(node, fn, bound = new Set()) {
    fn(node, bound);
    if (node.a) walk(node.a, fn, bound);
    if (node.b) walk(node.b, fn, bound);
    if (node.args) node.args.forEach((n) => walk(n, fn, bound));
    if (node.items) node.items.forEach((n) => walk(n, fn, bound));
    if (node.t === 'deriv') walk(node.body, fn, bound);
    if (node.t === 'int') {
      walk(node.lo, fn, bound);
      walk(node.hi, fn, bound);
      walk(node.body, fn, new Set([...bound, node.v]));
    }
  }

  function usesX(ast) {
    let found = false;
    walk(ast, (n, bound) => {
      if (n.t === 'var' && n.n === 'x' && !bound.has('x')) found = true;
    });
    return found;
  }

  const hasVar = (ast, v) => {
    let found = false;
    walk(ast, (n, bound) => {
      if (n.t === 'var' && n.n === v && !bound.has(v)) found = true;
    });
    return found;
  };

  // ---------- symbolic derivatives ----------

  const N = (v) => ({ t: 'num', v });
  const V = (n) => ({ t: 'var', n });
  const isNum = (n, v) => n.t === 'num' && (v === undefined || n.v === v);

  // Build with light simplification so results read like a person wrote them.
  const add = (a, b) => (isNum(a, 0) ? b : isNum(b, 0) ? a : isNum(a) && isNum(b) ? N(a.v + b.v) : { t: 'bin', op: '+', a, b });
  const sub = (a, b) => (isNum(b, 0) ? a : isNum(a, 0) ? neg(b) : isNum(a) && isNum(b) ? N(a.v - b.v) : { t: 'bin', op: '-', a, b });
  const neg = (a) => (isNum(a) ? N(-a.v) : a.t === 'neg' ? a.a : { t: 'neg', a });
  function mul(a, b) {
    if (isNum(a, 0) || isNum(b, 0)) return N(0);
    if (isNum(a, 1)) return b;
    if (isNum(b, 1)) return a;
    if (isNum(a, -1)) return neg(b);
    if (isNum(b, -1)) return neg(a);
    if (isNum(a) && isNum(b)) return N(a.v * b.v);
    if (a.t === 'neg') return neg(mul(a.a, b));
    if (b.t === 'neg') return neg(mul(a, b.a));
    if (isNum(b) && !isNum(a)) return mul(b, a); // coefficient first: 2x, not x·2
    if (isNum(a) && b.t === 'bin' && b.op === '*' && isNum(b.a)) return mul(N(a.v * b.a.v), b.b);
    return { t: 'bin', op: '*', a, b, imp: true };
  }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const div = (a, b) => (isNum(a, 0) ? N(0) : isNum(b) && b.v !== 0 && a.t === 'bin' && a.op === '*' && isNum(a.a) && Number.isInteger(a.a.v / b.v) ? mul(N(a.a.v / b.v), a.b) : isNum(b, 1) ? a : same(a, b) && !isNum(a) ? N(1) : isNum(a) && isNum(b) && b.v !== 0 && Number.isInteger(a.v / b.v) ? N(a.v / b.v) : { t: 'bin', op: '/', a, b });
  const pow = (a, b) => (isNum(b, 1) ? a : isNum(b, 0) ? N(1) : isNum(a, 1) ? N(1) : isNum(a) && isNum(b) && Number.isFinite(Math.pow(a.v, b.v)) ? N(Math.pow(a.v, b.v)) : { t: 'bin', op: '^', a, b });
  const call = (n, ...args) => ({ t: 'call', n, args });

  // The derivative of `node` with respect to variable `v`. `deg` rescales trig functions (degrees mode).
  function derive(node, v, deg) {
    const k = deg ? div(V('pi'), N(180)) : N(1); // d/dx sin(x°) = cos(x°)·π/180
    switch (node.t) {
      case 'num':
        return N(0);
      case 'var':
        return N(node.n === v ? 1 : 0);
      case 'neg':
        return neg(derive(node.a, v, deg));
      case 'fact':
        throw new MathError('Can’t take the derivative of a factorial');
      case 'tuple':
        throw new MathError('Can’t take the derivative of a point');
      case 'deriv':
        return derive(expand(node, deg), v, deg);
      case 'int': {
        // Leibniz: d/dv ∫_lo^hi f dt = f(hi)·hi' − f(lo)·lo' (+ ∫ ∂f/∂v, only when f doesn't use v)
        if (hasVar(node.body, v) && node.v !== v) throw new MathError('Can’t differentiate under an integral yet');
        const at = (e) => subst(node.body, node.v, e);
        return sub(mul(at(node.hi), derive(node.hi, v, deg)), mul(at(node.lo), derive(node.lo, v, deg)));
      }
      case 'prime': {
        if (node.args.length !== 1) throw new MathError('Derivatives need a function of one variable');
        return mul({ ...node, order: node.order + 1 }, derive(node.args[0], v, deg));
      }
      case 'bin': {
        const { a, b } = node;
        const da = derive(a, v, deg);
        const db = derive(b, v, deg);
        switch (node.op) {
          case '+': return add(da, db);
          case '-': return sub(da, db);
          case '*': return add(mul(da, b), mul(a, db));
          case '/': return !hasVar(b, v) ? div(da, b) : div(sub(mul(da, b), mul(a, db)), pow(b, N(2)));
          case '^': {
            if (!hasVar(b, v)) return mul(mul(b, pow(a, sub(b, N(1)))), da);
            if (!hasVar(a, v)) return mul(mul(node, call('ln', a)), db);
            return mul(node, add(mul(db, call('ln', a)), div(mul(b, da), a)));
          }
        }
        throw new MathError('Unknown operator');
      }
      case 'call': {
        const u = node.args[0];
        const du = u ? derive(u, v, deg) : N(0);
        const chain = (f) => mul(f, du);
        switch (node.n) {
          case 'sin': return chain(mul(k, call('cos', u)));
          case 'cos': return chain(neg(mul(k, call('sin', u))));
          case 'tan': return chain(mul(k, pow(call('sec', u), N(2))));
          case 'sec': return chain(mul(k, mul(call('sec', u), call('tan', u))));
          case 'csc': return chain(neg(mul(k, mul(call('csc', u), call('cot', u)))));
          case 'cot': return chain(neg(mul(k, pow(call('csc', u), N(2)))));
          case 'asin': return chain(div(deg ? div(N(180), V('pi')) : N(1), call('sqrt', sub(N(1), pow(u, N(2))))));
          case 'acos': return chain(neg(div(deg ? div(N(180), V('pi')) : N(1), call('sqrt', sub(N(1), pow(u, N(2)))))));
          case 'atan': {
            const s2 = deg ? div(N(180), V('pi')) : N(1);
            if (node.args.length === 1) return chain(div(s2, add(N(1), pow(u, N(2)))));
            const w = node.args[1];
            const dw = derive(w, v, deg);
            return mul(s2, div(sub(mul(w, du), mul(u, dw)), add(pow(u, N(2)), pow(w, N(2)))));
          }
          case 'sinh': return chain(call('cosh', u));
          case 'cosh': return chain(call('sinh', u));
          case 'tanh': return chain(sub(N(1), pow(call('tanh', u), N(2))));
          case 'sqrt': return chain(div(N(1), mul(N(2), call('sqrt', u))));
          case 'cbrt': return chain(div(N(1), mul(N(3), pow(call('cbrt', u), N(2)))));
          case 'abs': return chain(call('sign', u));
          case 'ln': return chain(div(N(1), u));
          case 'exp': return chain(node);
          case 'log': {
            if (node.args.length === 1) return chain(div(N(1), mul(u, call('ln', N(10)))));
            const b = node.args[1];
            if (hasVar(b, v)) return derive(div(call('ln', u), call('ln', b)), v, deg);
            return chain(div(N(1), mul(u, call('ln', b))));
          }
          case 'floor': case 'ceil': case 'round': case 'sign': return N(0);
          case 'mod': return hasVar(node.args[1], v) ? (() => { throw new MathError('Can’t differentiate mod by a variable'); })() : du;
        }
        if (BUILTINS[node.n]) throw new MathError(`Can’t take the derivative of ${node.n}`);
        // A function you defined: f(u) → f′(u)·u′
        if (node.args.length !== 1) throw new MathError(`Can’t take the derivative of ${node.n} with several arguments`);
        return mul({ t: 'prime', n: node.n, order: 1, args: [u] }, du);
      }
    }
    throw new MathError('Can’t take this derivative');
  }

  // Replace x with `e` in `node` (used for integral limits); respects bound names.
  function subst(node, name, e) {
    const go = (n, bound) => {
      if (n.t === 'var') return n.n === name && !bound.has(name) ? e : n;
      const out = { ...n };
      for (const key of ['a', 'b', 'lo', 'hi']) if (n[key]) out[key] = go(n[key], bound);
      if (n.args) out.args = n.args.map((x) => go(x, bound));
      if (n.items) out.items = n.items.map((x) => go(x, bound));
      if (n.t === 'deriv') out.body = go(n.body, bound);
      if (n.t === 'int') out.body = go(n.body, new Set([...bound, n.v]));
      return out;
    };
    return go(node, new Set());
  }

  // Turn every derivative operator inside `node` into explicit algebra.
  function expand(node, deg) {
    if (node.t === 'deriv') return simp(derive(expand(node.body, deg), node.v, deg));
    const out = { ...node };
    for (const key of ['a', 'b', 'lo', 'hi', 'body']) if (node[key]) out[key] = expand(node[key], deg);
    if (node.args) out.args = node.args.map((x) => expand(x, deg));
    if (node.items) out.items = node.items.map((x) => expand(x, deg));
    return out;
  }

  // Re-run the smart constructors over a finished tree.
  function simp(node) {
    switch (node.t) {
      case 'neg': return neg(simp(node.a));
      case 'bin': {
        const a = simp(node.a);
        const b = simp(node.b);
        switch (node.op) {
          case '+': return add(a, b);
          case '-': return sub(a, b);
          case '*': return node.imp ? mul(a, b) : { ...node, a, b };
          case '/': return div(a, b);
          case '^': return pow(a, b);
        }
        return { ...node, a, b };
      }
      case 'call': return { ...node, args: node.args.map(simp) };
      case 'fact': return { ...node, a: simp(node.a) };
      case 'tuple': return { ...node, items: node.items.map(simp) };
      case 'int': return { ...node, body: simp(node.body), lo: simp(node.lo), hi: simp(node.hi) };
      case 'prime': return { ...node, args: node.args.map(simp) };
    }
    return node;
  }

  const hasCalculus = (ast) => {
    let found = false;
    walk(ast, (n) => {
      if (n.t === 'deriv' || n.t === 'prime') found = true;
    });
    return found;
  };

  // ---------- numeric integrals ----------

  // Adaptive Gauss–Kronrod (7, 15): accurate for smooth functions, copes with endpoints and infinite limits.
  const XGK = [0.991455371120812639206854697526329, 0.949107912342758524526189684047851, 0.864864423359769072789712788640926, 0.741531185599394439863864773280788, 0.58608723546769113029414483825873, 0.405845151377397166906606412076961, 0.207784955007898467600689403773245, 0];
  const WGK = [0.022935322010529224963732008058970, 0.063092092629978553290700663189204, 0.104790010322250183839876322541518, 0.140653259715525918745189590510238, 0.16900472663926790282658342659855, 0.190350578064785409913256402421014, 0.204432940075298892414161999234649, 0.209482141084727828012999174891714];
  const WG = [0, 0.129484966168869693270611432679082, 0, 0.27970539148927666790146777142378, 0, 0.381830050505118944950369775488975, 0, 0.417959183673469387755102040816327];

  function gk15(f, a, b) {
    const c = (a + b) / 2;
    const h = (b - a) / 2;
    const fc = f(c);
    let k = fc * WGK[7];
    let g = fc * WG[7];
    for (let j = 0; j < 7; j++) {
      const dx = h * XGK[j];
      const s = f(c - dx) + f(c + dx);
      k += WGK[j] * s;
      if (WG[j]) g += WG[j] * s;
    }
    return { value: k * h, err: Math.abs((k - g) * h) };
  }

  function integrate(f, a, b) {
    if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
    if (a === b) return 0;
    if (a > b) return -integrate(f, b, a);
    if (a === -Infinity && b === Infinity) return integrate((t) => f(t / (1 - t * t)) * ((1 + t * t) / ((1 - t * t) * (1 - t * t))), -1, 1);
    if (b === Infinity) return integrate((t) => f(a + t / (1 - t)) / ((1 - t) * (1 - t)), 0, 1);
    if (a === -Infinity) return integrate((t) => f(b - t / (1 - t)) / ((1 - t) * (1 - t)), 0, 1);
    // Start from a handful of pieces so a narrow feature in the middle isn't missed.
    let parts = [];
    for (let i = 0; i < 4; i++) {
      const lo = a + ((b - a) * i) / 4;
      const hi = a + ((b - a) * (i + 1)) / 4;
      parts.push({ lo, hi, ...gk15(f, lo, hi) });
    }
    for (let iter = 0; iter < 400; iter++) {
      const total = parts.reduce((s, p) => s + p.value, 0);
      const err = parts.reduce((s, p) => s + p.err, 0);
      if (!Number.isFinite(total)) return total;
      if (err <= 1e-10 * Math.max(1, Math.abs(total))) return total;
      let worst = 0;
      for (let i = 1; i < parts.length; i++) if (parts[i].err > parts[worst].err) worst = i;
      const p = parts[worst];
      const mid = (p.lo + p.hi) / 2;
      parts.splice(worst, 1, { lo: p.lo, hi: mid, ...gk15(f, p.lo, mid) }, { lo: mid, hi: p.hi, ...gk15(f, mid, p.hi) });
    }
    return parts.reduce((s, p) => s + p.value, 0);
  }

  // Evaluate a whole list of rows. Returns per-row results plus graphables.
  function evaluate(rows, { angle = 'rad' } = {}) {
    const deg = angle === 'deg';
    const ang = { in: (v) => (deg ? (v * Math.PI) / 180 : v), out: (v) => (deg ? (v * 180) / Math.PI : v) };

    // Pass 1: find user-defined names so "speed*2" isn't split into letters.
    const known = new Set([...RESERVED, 'x', 'y']);
    for (const r of rows) {
      const m = LHS_RE.exec(r.text || '');
      if (m) known.add(m[1]);
    }

    // Pass 2: parse.
    const parsed = rows.map((r) => {
      try {
        return parseRow(r.text || '', known);
      } catch (err) {
        return { kind: 'error', error: err };
      }
    });

    const defs = new Map(); // name → parsed row
    const dupes = new Set();
    for (const p of parsed) {
      if (p.kind !== 'var' && p.kind !== 'func') continue;
      if (defs.has(p.name)) dupes.add(p.name);
      defs.set(p.name, p);
    }

    const varCache = new Map();
    const funcCache = new Map();
    const visiting = new Set();

    function getVar(name) {
      if (varCache.has(name)) return varCache.get(name);
      if (dupes.has(name)) throw new MathError(`“${name}” is defined more than once`);
      const def = defs.get(name);
      if (visiting.has(name)) throw new MathError(`“${name}” depends on itself`);
      visiting.add(name);
      try {
        if (usesX(def.ast)) throw new MathError(`“${name}” can’t depend on x — try ${name}(x) = …`);
        const v = compile(def.ast, new Set())({});
        varCache.set(name, v);
        return v;
      } finally {
        visiting.delete(name);
      }
    }

    function getFunc(name) {
      if (funcCache.has(name)) return funcCache.get(name);
      if (dupes.has(name)) throw new MathError(`“${name}” is defined more than once`);
      const def = defs.get(name);
      if (visiting.has(name)) throw new MathError(`“${name}” depends on itself`);
      visiting.add(name);
      try {
        const body = compile(def.ast, new Set(def.params));
        const fn = (args) => {
          const scope = {};
          def.params.forEach((p, i) => (scope[p] = args[i]));
          return body(scope);
        };
        fn.arity = def.params.length;
        funcCache.set(name, fn);
        return fn;
      } finally {
        visiting.delete(name);
      }
    }

    // The exact form of a row that uses derivatives: operators expanded, f′(x) worked out from f's definition.
    function symbolicOf(ast) {
      const resolve = (n) => {
        const out = { ...n };
        for (const key of ['a', 'b', 'lo', 'hi', 'body']) if (n[key]) out[key] = resolve(n[key]);
        if (n.args) out.args = n.args.map(resolve);
        if (n.items) out.items = n.items.map(resolve);
        if (n.t !== 'prime' || n.args.length !== 1) return out;
        const def = defs.get(n.n);
        let body;
        let param;
        if (def && def.kind === 'func' && def.params.length === 1) {
          body = def.ast;
          param = def.params[0];
        } else if (BUILTINS[n.n]) {
          body = { t: 'call', n: n.n, args: [V('_t')] };
          param = '_t';
        } else return out;
        for (let i = 0; i < n.order; i++) body = simp(derive(expand(body, deg), param, deg));
        return subst(resolve(body), param, out.args[0]);
      };
      return simp(resolve(expand(ast, deg)));
    }

    // Compile an AST into a closure over a scope object of bound params.
    function compile(node, params) {
      switch (node.t) {
        case 'num':
          return () => node.v;
        case 'var': {
          const n = node.n;
          if (params.has(n)) return (s) => s[n];
          if (n in CONSTANTS) return () => CONSTANTS[n];
          if (defs.has(n) && defs.get(n).kind === 'var') {
            const v = getVar(n);
            return () => v;
          }
          if (defs.has(n)) throw new MathError(`“${n}” is a function — use ${n}(…)`);
          if (n === 'x' || n === 'y') throw new MathError(`“${n}” isn’t defined here`);
          throw new MathError(`Undefined variable “${n}”`, { missing: n });
        }
        case 'neg': {
          const a = compile(node.a, params);
          return (s) => -a(s);
        }
        case 'fact': {
          const a = compile(node.a, params);
          return (s) => factorial(a(s));
        }
        case 'bin': {
          const a = compile(node.a, params);
          const b = compile(node.b, params);
          switch (node.op) {
            case '+': return (s) => a(s) + b(s);
            case '-': return (s) => a(s) - b(s);
            case '*': return (s) => a(s) * b(s);
            case '/': return (s) => a(s) / b(s);
            case '^': return (s) => {
              const base = a(s);
              const ex = b(s);
              // Real odd roots of negatives, e.g. (-8)^(1/3) = -2.
              if (base < 0 && !Number.isInteger(ex)) {
                const inv = 1 / ex;
                if (Math.abs(inv - Math.round(inv)) < 1e-9 && Math.round(inv) % 2) return -Math.pow(-base, ex);
              }
              return Math.pow(base, ex);
            };
          }
          throw new MathError('Unknown operator');
        }
        case 'call': {
          const n = node.n;
          const args = node.args.map((x) => compile(x, params));
          const b = BUILTINS[n];
          if (b) {
            if (args.length < b[0] || args.length > b[1]) throw new MathError(`${n} takes ${b[0] === b[1] ? b[0] : `${b[0]}–${b[1]}`} argument${b[1] === 1 ? '' : 's'}`);
            const fn = b[2](ang);
            return (s) => fn(...args.map((a) => a(s)));
          }
          if (defs.has(n) && defs.get(n).kind === 'func') {
            const f = getFunc(n);
            if (args.length !== f.arity) throw new MathError(`${n} takes ${f.arity} argument${f.arity === 1 ? '' : 's'}`);
            return (s) => f(args.map((a) => a(s)));
          }
          // Not a function: "a(2+1)" means a·(2+1).
          if (args.length === 1) return compile({ t: 'bin', op: '*', a: { t: 'var', n }, b: node.args[0] }, params);
          throw new MathError(`Unknown function “${n}”`, { missing: n.length === 1 ? n : undefined });
        }
        case 'deriv':
          return compile(expand(node, deg), params);
        case 'int': {
          const body = compile(node.body, new Set([...params, node.v]));
          const lo = compile(node.lo, params);
          const hi = compile(node.hi, params);
          const name = node.v;
          return (s) => {
            const scope = Object.assign({}, s);
            return integrate((t) => {
              scope[name] = t;
              return body(scope);
            }, lo(s), hi(s));
          };
        }
        case 'prime': {
          if (node.args.length !== 1) throw new MathError('Derivatives need a function of one variable');
          const arg = compile(node.args[0], params);
          const def = defs.get(node.n);
          let ast;
          let param;
          let inner;
          if (def && def.kind === 'func') {
            if (def.params.length !== 1) throw new MathError(`${node.n} needs exactly one variable to take its derivative`);
            param = def.params[0];
            ast = def.ast;
            inner = new Set(def.params);
          } else if (BUILTINS[node.n]) {
            param = '_t';
            ast = { t: 'call', n: node.n, args: [V('_t')] };
            inner = new Set(['_t']);
          } else throw new MathError(`Unknown function “${node.n}”`);
          const key = `prime:${node.n}`;
          if (visiting.has(key)) throw new MathError(`“${node.n}” depends on itself`);
          visiting.add(key);
          try {
            for (let i = 0; i < node.order; i++) ast = simp(derive(expand(ast, deg), param, deg));
            const body = compile(ast, inner);
            return (s) => body({ [param]: arg(s) });
          } finally {
            visiting.delete(key);
          }
        }
        case 'tuple':
          throw new MathError('Points can only be used on their own');
      }
      throw new MathError('Invalid expression');
    }

    // Names that could become sliders: single letters that aren't defined.
    function missingNames(ast, params) {
      const out = new Set();
      walk(ast, (n, bound) => {
        const name = n.t === 'var' ? n.n : n.t === 'call' && n.args.length === 1 && !BUILTINS[n.n] && !defs.has(n.n) ? n.n : null;
        if (!name || bound.has(name) || params.has(name) || name in CONSTANTS || defs.has(name) || name === 'x' || name === 'y') return;
        if (/^[a-zA-Z](_[a-zA-Z0-9]+)?$/.test(name)) out.add(name);
      });
      return [...out];
    }

    const X = new Set(['x']);
    return parsed.map((p) => {
      if (p.kind === 'empty') return { kind: 'empty' };
      if (p.kind === 'error') return { kind: 'error', message: p.error.message };
      try {
        switch (p.kind) {
          case 'var': {
            const value = getVar(p.name);
            const plain = p.ast.t === 'num' || (p.ast.t === 'neg' && p.ast.a.t === 'num');
            return { kind: plain ? 'slider' : 'def', name: p.name, value };
          }
          case 'func': {
            const f = getFunc(p.name);
            const graph = p.params.length === 1 && p.params[0] === 'x';
            const symbolic = hasCalculus(p.ast) ? symbolicOf(p.ast) : undefined;
            return graph ? { kind: 'graph', fn: (x) => f([x]), name: p.name, symbolic } : { kind: 'def', name: p.name, symbolic };
          }
          case 'graph': {
            const body = compile(p.ast, X);
            return { kind: 'graph', fn: (x) => body({ x }), symbolic: hasCalculus(p.ast) ? symbolicOf(p.ast) : undefined };
          }
          case 'vline': {
            if (usesX(p.ast)) throw new MathError('x = … must be a number');
            return { kind: 'vline', value: compile(p.ast, new Set())({}) };
          }
          case 'expr': {
            if (p.ast.t === 'tuple') {
              const [a, b] = p.ast.items.map((n) => compile(n, new Set())({}));
              return { kind: 'point', point: [a, b] };
            }
            const symbolic = hasCalculus(p.ast) ? symbolicOf(p.ast) : undefined;
            if (usesX(p.ast)) {
              const body = compile(p.ast, X);
              return { kind: 'graph', fn: (x) => body({ x }), symbolic };
            }
            return { kind: 'value', value: compile(p.ast, new Set())({}), symbolic };
          }
        }
      } catch (err) {
        const params = p.params ? new Set(p.params) : p.kind === 'graph' || (p.ast && usesX(p.ast)) ? X : new Set();
        const missing = p.ast ? missingNames(p.ast, params) : [];
        return { kind: 'error', message: err.message, missing };
      }
      return { kind: 'empty' };
    });
  }

  // ---------- typesetting (MathML) ----------

  const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const DISPLAY_NAMES = { asin: 'arcsin', acos: 'arccos', atan: 'arctan' };
  const GREEK = { pi: 'π', tau: 'τ', phi: 'φ', inf: '∞' };
  const mrow = (...p) => `<mrow>${p.join('')}</mrow>`;
  const mo = (t) => `<mo>${esc(t)}</mo>`;
  const mn = (t) => `<mn>${esc(t)}</mn>`;
  const mi = (t, upright) => `<mi${upright ? ' mathvariant="normal"' : ''}>${esc(t)}</mi>`;
  const paren = (inner) => mrow(mo('('), inner, mo(')'));

  function numText(v) {
    if (!Number.isFinite(v)) return v > 0 ? '∞' : '−∞';
    const t = String(parseFloat(v.toPrecision(12)));
    return t.replace('-', '−');
  }

  // How tightly a node binds: 1 sum, 2 product or sign, 3 power, 5 atom.
  function prec(n) {
    switch (n.t) {
      case 'bin': return n.op === '+' || n.op === '-' ? 1 : n.op === '*' ? 2 : n.op === '/' ? 4 : 3;
      case 'neg': case 'deriv': case 'int': return 2;
      case 'num': return n.v < 0 ? 2 : 5;
      default: return 5;
    }
  }

  function varML(name) {
    if (GREEK[name]) return mi(GREEK[name]);
    const m = /^([a-zA-Z]+)_([a-zA-Z0-9]+)$/.exec(name);
    if (m) return `<msub>${mi(m[1], m[1].length > 1)}${mi(m[2], true)}</msub>`;
    return mi(name, name.length > 1);
  }

  function toML(n) {
    const wrap = (c, min) => (prec(c) < min ? paren(toML(c)) : toML(c));
    switch (n.t) {
      case 'num': return n.v < 0 ? mrow(mo('−'), mn(numText(-n.v))) : mn(numText(n.v));
      case 'var': return varML(n.n);
      case 'neg': return mrow(mo('−'), wrap(n.a, 3));
      case 'fact': return mrow(wrap(n.a, 5), mo('!'));
      case 'tuple': return paren(n.items.map(toML).join(mo(',')));
      case 'bin': {
        const { a, b } = n;
        if (n.op === '+') return mrow(toML(a), mo('+'), toML(b));
        if (n.op === '-') return mrow(toML(a), mo('−'), wrap(b, 2));
        if (n.op === '/') return `<mfrac>${toML(a)}${toML(b)}</mfrac>`;
        if (n.op === '^') return `<msup>${wrap(a, 4)}${toML(b)}</msup>`;
        const left = wrap(a, 2);
        const right = prec(b) < 3 || (b.t === 'num' && !n.imp) ? paren(toML(b)) : toML(b);
        const tight = n.imp && !(b.t === 'num') && !(a.t === 'num' && b.t === 'num');
        return mrow(left, tight ? '' : mo('·'), right);
      }
      case 'call': {
        if (n.n === 'sqrt' && n.args.length === 1) return `<msqrt>${toML(n.args[0])}</msqrt>`;
        if (n.n === 'cbrt' && n.args.length === 1) return `<mroot>${toML(n.args[0])}${mn('3')}</mroot>`;
        if (n.n === 'abs' && n.args.length === 1) return mrow(mo('|'), toML(n.args[0]), mo('|'));
        if (n.n === 'exp' && n.args.length === 1) return `<msup>${mi('e')}${toML(n.args[0])}</msup>`;
        const builtin = BUILTINS[n.n];
        const head = builtin ? mi(DISPLAY_NAMES[n.n] || n.n, true) : varML(n.n);
        return mrow(head, paren(n.args.map(toML).join(mo(','))));
      }
      case 'prime': return mrow(`<msup>${varML(n.n)}${mo("′".repeat(n.order))}</msup>`, paren(n.args.map(toML).join(mo(','))));
      case 'deriv': return mrow(`<mfrac>${mi('d')}${mrow(mi('d'), varML(n.v))}</mfrac>`, wrap(n.body, 3));
      case 'int': return mrow(`<msubsup>${mo('∫')}${toML(n.lo)}${toML(n.hi)}</msubsup>`, toML(n.body), mi('d'), varML(n.v));
    }
    return '';
  }

  // The math inside <math>…</math>, ready for innerHTML.
  const toMathML = (ast) => `<math>${toML(ast)}</math>`;

  // Typeset one row as typed, or null when it can't be read yet (empty or mid-typing).
  // `allTexts` is every row's text, so names defined elsewhere split the way they do when evaluating.
  function typeset(text, allTexts = [text]) {
    const src = String(text || '').trim();
    if (!src) return null;
    const known = new Set([...RESERVED, 'x', 'y']);
    for (const t of allTexts) {
      const m = LHS_RE.exec(t || '');
      if (m) known.add(m[1]);
    }
    try {
      const m = LHS_RE.exec(src);
      if (m) {
        const params = m[2] ? m[2].split(',').map((p) => p.trim()) : null;
        const inner = new Set(known);
        if (params) params.forEach((p) => inner.add(p));
        const rhs = parseTokens(tokenize(rewriteIntegral(src.slice(m[0].length)), inner));
        const lhs = params ? mrow(varML(m[1]), paren(params.map(varML).join(mo(',')))) : varML(m[1]);
        return `<math>${mrow(lhs, mo('='), toML(rhs))}</math>`;
      }
      if (src.includes('=')) return null;
      return toMathML(parseTokens(tokenize(rewriteIntegral(src), known)));
    } catch (_) {
      return null;
    }
  }

  // ---------- formatting ----------

  const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };

  function format(v, digits = 10) {
    if (typeof v !== 'number' || Number.isNaN(v)) return 'undefined';
    if (!Number.isFinite(v)) return v > 0 ? '∞' : '−∞';
    if (v === 0 || Object.is(v, -0)) return '0';
    const abs = Math.abs(v);
    if (abs >= 1e12 || abs < 1e-6) {
      const [m, e] = v.toExponential(digits - 1).split('e');
      const mant = parseFloat(m).toString();
      return `${mant.replace('-', '−')} × 10${String(parseInt(e, 10)).split('').map((c) => SUP[c]).join('')}`;
    }
    const s = parseFloat(v.toPrecision(digits)).toString();
    return s.replace('-', '−');
  }

  // Evaluate a one-off expression (search-box calculator). Returns null unless it's a plain number.
  function quick(src) {
    try {
      const [res] = evaluate([{ text: src }]);
      return res.kind === 'value' && Number.isFinite(res.value) ? res.value : null;
    } catch (_) {
      return null;
    }
  }

  root.InkMath = { evaluate, format, quick, typeset, toMathML, integrate, MathError };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.InkMath;
})();
