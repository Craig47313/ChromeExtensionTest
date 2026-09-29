// InkMath: a small, safe math language for the calculator (no eval).
//
//   2+3*4          → value              f(x) = x^2 + 1   → function (graphed)
//   a = 3          → variable (slider)   y = sin(a x)     → graph
//   x^2 - 4        → graph (uses x)      (1, 2)           → point
//   x = 2          → vertical line       2pi, 3(x+1), |x| → implicit multiplication, abs bars
(function () {
  'use strict';
  if (globalThis.InkMath) return;

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
  const CONSTANTS = { pi: Math.PI, tau: Math.PI * 2, e: Math.E, phi: (1 + Math.sqrt(5)) / 2 };
  const RESERVED = new Set([...Object.keys(BUILTINS), ...Object.keys(ALIASES), ...Object.keys(CONSTANTS)]);

  // ---------- tokenizer ----------

  function normalize(src) {
    return src
      .replace(/[×·∙⋅]/g, '*')
      .replace(/÷/g, '/')
      .replace(/[−–]/g, '-')
      .replace(/π/g, ' pi ')
      .replace(/τ/g, ' tau ')
      .replace(/√/g, ' sqrt ')
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
      if ('+-*/^!(),=|%'.includes(c)) {
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
          node = { t: 'bin', op: '*', a: node, b: power() }; // implicit: 2x, 3(x+1), x sin x
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
        if (isOp('(')) {
          pos++;
          const args = isOp(')') ? [] : list();
          expectOp(')');
          return { t: 'call', n: tk.v, args };
        }
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

  // Parse one row into { kind, name, params, ast }.
  function parseRow(text, known) {
    const src = text.trim();
    if (!src) return { kind: 'empty' };
    const m = LHS_RE.exec(src);
    if (m) {
      const name = m[1];
      const params = m[2] ? m[2].split(',').map((p) => p.trim()) : null;
      const rhs = src.slice(m[0].length);
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
    return { kind: 'expr', ast: parseTokens(tokenize(src, known)) };
  }

  function walk(node, fn) {
    fn(node);
    if (node.a) walk(node.a, fn);
    if (node.b) walk(node.b, fn);
    if (node.args) node.args.forEach((n) => walk(n, fn));
    if (node.items) node.items.forEach((n) => walk(n, fn));
  }

  function usesX(ast) {
    let found = false;
    walk(ast, (n) => {
      if (n.t === 'var' && n.n === 'x') found = true;
    });
    return found;
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
        case 'tuple':
          throw new MathError('Points can only be used on their own');
      }
      throw new MathError('Invalid expression');
    }

    // Names that could become sliders: single letters that aren't defined.
    function missingNames(ast, params) {
      const out = new Set();
      walk(ast, (n) => {
        const name = n.t === 'var' ? n.n : n.t === 'call' && n.args.length === 1 && !BUILTINS[n.n] && !defs.has(n.n) ? n.n : null;
        if (!name || params.has(name) || name in CONSTANTS || defs.has(name) || name === 'x' || name === 'y') return;
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
            return graph ? { kind: 'graph', fn: (x) => f([x]), name: p.name } : { kind: 'def', name: p.name };
          }
          case 'graph': {
            const body = compile(p.ast, X);
            return { kind: 'graph', fn: (x) => body({ x }) };
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
            if (usesX(p.ast)) {
              const body = compile(p.ast, X);
              return { kind: 'graph', fn: (x) => body({ x }) };
            }
            return { kind: 'value', value: compile(p.ast, new Set())({}) };
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

  globalThis.InkMath = { evaluate, format, quick, MathError };
})();
